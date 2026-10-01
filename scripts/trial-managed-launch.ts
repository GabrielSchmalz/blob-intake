import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { upload } from "@vercel/blob/client";
import { Effect, Schema } from "effect";
import { Pool } from "pg";
import { createManagedScannerProvider } from "../src/integrations/managed-scanner";
import { managedTaskId, scannerTables } from "../src/scanner/queue";
import { createScannerWorker } from "../src/scanner/worker";
import { tableNames } from "../src/persistence/postgres";
import { IntakeError } from "../src/contract/index";
import { createClamClient } from "../src/scanner/clamav";
let checkpoint = "initialization";

const Identity = Schema.Struct({ credential: Schema.String, tenantId: Schema.String, userId: Schema.String });
const Private = Schema.Struct({ identities: Schema.Array(Identity), CALLBACK_SECRET: Schema.String });
const origin = "https://blob-intake.vercel.app";
const failure = () => new Error("Managed launch trial failed; private credentials and capabilities are redacted");
const operation = <A>(body: () => Promise<A>) => Effect.tryPromise({ try: body, catch: failure });
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown) => Schema.decodeUnknownSync(schema)(value);
const Prepared = Schema.Struct({ fileId: Schema.String, pathname: Schema.String });
const State = Schema.Struct({ files: Schema.Array(Schema.Struct({ fileId: Schema.String, job: Schema.NullOr(Schema.Struct({ jobId: Schema.String, state: Schema.String, reason: Schema.NullOr(Schema.String) })) })) });
const Download = Schema.Struct({ url: Schema.String, expiresAt: Schema.Number });

const main = Effect.gen(function* () {
  if (process.env.BLOB_INTAKE_LIVE_TRIAL !== "authorized") return yield* Effect.fail(new Error("Set BLOB_INTAKE_LIVE_TRIAL=authorized only after deployed app and bounded scanner are ready"));
  const secrets = decode(Schema.parseJson(Private), yield* operation(() => readFile("runtime/launch-private.json", "utf8")));
  const first = secrets.identities[0], second = secrets.identities[1];
  assert(first && second && first.tenantId !== second.tenantId, "Two isolated trial identities required");
  const databaseUrl = process.env.DATABASE_URL, token = process.env.BLOB_READ_WRITE_TOKEN;
  assert(databaseUrl && token, "Owning project environment required");
  const schema = process.env.BLOB_INTAKE_SCHEMA ?? "blob_intake";
  const tables = tableNames(schema), scanner = scannerTables(schema);
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 10000 });
  const paths: string[] = [], fileIds: string[] = [], sdkAttempts: string[] = [];
  const checks: Record<string, unknown> = {};
  let uploadedBytes = 0;
  const http = (path: string, key?: string, body?: unknown, extra: Record<string, string> = {}) => fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  const json = async (response: Response) => { assert.equal(response.status, 200, "Expected successful deployed JSON response"); const data: unknown = await response.json(); return data; };
  const tick = async (attemptIds: string[], deliverCallbacks = true) => {
    const worker = await Effect.runPromise(createScannerWorker({ pool, schema, now: Date.now, callbackSecret: secrets.CALLBACK_SECRET, blobToken: token, callbackUrl: `${origin}/api/intake/callback`, clam: { host: "127.0.0.1", port: Number(process.env.CLAM_PORT ?? "3310") } }));
    for (const attemptId of attemptIds) {
      const result = await Effect.runPromise(worker.runOnce({ attemptId, deliverCallbacks }));
      assert(result.processed, "Exact trial attempt must be processed by the bounded real worker");
      if (deliverCallbacks) assert(result.callbackDelivered, "Real result callback must reach the deployed app");
    }
  };
  const ownAttempts = async (id: string) => {
    const rows = await pool.query<{ id: string }>(`SELECT a.id FROM ${tables.attempts} a JOIN ${tables.jobs} j ON j.id=a.job WHERE j.tenant=$1 AND j.file=$2`, [first.tenantId, id]);
    assert(rows.rows.length > 0, "Submitted file must have durable attempt"); return rows.rows.map(row => row.id);
  };
  const status = async (fileId: string) => decode(State, await json(await http("/api/intake/state", first.credential))).files.find(file => file.fileId === fileId)?.job;
  const pilot = async (label: string, bytes: Uint8Array) => {
    const prepared = decode(Prepared, await json(await http("/api/intake/prepare", first.credential, { name: `managed-trial-${label}.pdf`, declaredType: "application/pdf" })));
    fileIds.push(prepared.fileId); paths.push(prepared.pathname);
    await upload(prepared.pathname, Buffer.from(bytes), { access: "private", contentType: "application/pdf", handleUploadUrl: `${origin}/api/intake/upload`, clientPayload: JSON.stringify({ fileId: prepared.fileId }), headers: { Authorization: `Bearer ${first.credential}`, Origin: origin }, multipart: false });
    uploadedBytes += bytes.length;
    await json(await http("/api/intake/finish", first.credential, { fileId: prepared.fileId }));
    assert.equal((await http(`/api/intake/download?fileId=${prepared.fileId}`, first.credential)).status, 409, "Pending scan must deny delivery");
    return prepared;
  };
  const result = yield* Effect.acquireUseRelease(Effect.succeed(pool), () => operation(async () => {
    checkpoint = "public origin";
    for (const path of ["/", "/docs", "/pilot", "/llms.txt", "/robots.txt", "/sitemap.xml"]) {
      const response = await http(path); assert.equal(response.status, 200, "Public origin must serve actual content without redirect");
      const body = await response.text(); assert(body.length > 60, "Public body must contain real content");
      if (path === "/robots.txt" || path === "/sitemap.xml") assert(body.includes(origin), "Discovery origins must be canonical");
      if (path === "/docs") assert(/Blob Intake|private.*Blob/i.test(body), "Docs must explain actual integration");
    }
    checks.publicOrigins = "six deployed pages/indexes return 200 actual content; robots/sitemap canonical";
    checkpoint = "authentication";
    assert.equal((await http("/api/intake/state")).status, 403);
    assert.equal((await http("/api/intake/reconcile", first.credential)).status, 403);
    assert.equal((await http("/api/demo/state")).status, 403);
    assert.equal((await http("/api/intake/prepare", first.credential, { name: "denied.pdf", declaredType: "application/pdf" }, { Origin: "https://foreign.invalid" })).status, 403);
    const session = await http("/api/intake/session", undefined, { key: first.credential }); assert.equal(session.status, 200);
    const cookie = session.headers.get("set-cookie"); assert(cookie && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie));
    assert.equal((await http("/api/intake/state", undefined, undefined, { Cookie: cookie.split(";")[0]! })).status, 200);
    checks.authentication = "unauthenticated, cross-origin, global reconcile and fixture endpoint denied; secure authenticated session succeeds";
    const clean = Buffer.alloc(5 * 1024 * 1024, 32); clean.set(Buffer.from("%PDF-1.4\n% synthetic large direct-client-upload\n")); clean.set(Buffer.from("\n%%EOF\n"), clean.length - 8);
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const compressed = deflateSync(Buffer.from(eicar));
    const threat = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(eicar.com) 3 0 R] >> >> >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /Type /Filespec /F (eicar.com) /EF << /F 4 0 R >> >>\nendobj\n4 0 obj\n<< /Type /EmbeddedFile /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`), compressed, Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")]);
    checkpoint = "direct upload";
    const accepted = await pilot("clean", clean), rejected = await pilot("test-specimen", threat);
    const foreign = decode(State, await json(await http("/api/intake/state", second.credential))); assert(!foreign.files.some(file => file.fileId === accepted.fileId));
    assert([403, 404].includes((await http(`/api/intake/download?fileId=${accepted.fileId}`, second.credential)).status));
    const cleanAttempts = await ownAttempts(accepted.fileId), threatAttempts = await ownAttempts(rejected.fileId);
    checkpoint = "threat scan callback";
    await tick(threatAttempts, true); assert.equal((await status(rejected.fileId))?.state, "rejected");
    assert.equal((await http(`/api/intake/download?fileId=${rejected.fileId}`, first.credential)).status, 409);
    checkpoint = "clean scan and missed callback recovery";
    await tick(cleanAttempts, false); assert.equal((await status(accepted.fileId))?.state, "processing", "Suppressed callback must leave app processing until real polling recovery");
    await Effect.runPromise(Effect.sleep("61 seconds"));
    await json(await http("/api/intake/reconcile", first.credential, {}));
    assert.equal((await status(accepted.fileId))?.state, "approved");
    const approved = decode(Download, await json(await http(`/api/intake/download?fileId=${accepted.fileId}`, first.credential)));
    const downloaded = await fetch(approved.url, { redirect: "error", signal: AbortSignal.timeout(30000) }); assert.equal(downloaded.status, 200); assert(Buffer.from(await downloaded.arrayBuffer()).equals(clean));
    const other = new URL(approved.url); other.pathname = `/${rejected.pathname}`; assert.notEqual((await fetch(other, { redirect: "manual", signal: AbortSignal.timeout(15000) })).status, 200);
    checks.pilot = { largeUploadBytes: clean.length, directBlobClientUpload: true, preScanDenied: true, wrongTenantDenied: true, realThreatRejected: true, suppressedCallbackRecoveredByAuthenticatedPolling: true, cleanByteExact: true, exactPathDownloadIsolation: true };
    checkpoint = "managed SDK and content mismatch";
    for (const mismatch of [false, true]) {
      const bytes = Buffer.from("%PDF-1.4\n% external SDK source synthetic file\n%%EOF\n");
      const pathname = `trial-managed/${randomUUID()}.pdf`; paths.push(pathname);
      await put(pathname, bytes, { token, access: "private", contentType: "application/pdf", addRandomSuffix: false, allowOverwrite: false }); uploadedBytes += bytes.length;
      const validUntil = Date.now() + 10 * 60000, signed = await issueSignedToken({ token, pathname, operations: ["get"], validUntil });
      const capability = await presignUrl(signed, { pathname, operation: "get", access: "private", validUntil: Math.min(validUntil, signed.validUntil), useCache: false });
      const attemptId = `trial-${randomUUID()}`; sdkAttempts.push(managedTaskId(first, attemptId));
      const digest = mismatch ? "0".repeat(64) : sha(bytes);
      // For mismatch, raw HTTP intentionally bypasses the SDK's local hash guard
      // so the actual worker is challenged against untrusted submitted metadata.
      if (mismatch) await json(await http("/api/scans", first.credential, { attemptId, fileId: randomUUID(), digest, declaredType: "application/pdf", source: { url: capability.presignedUrl, validUntil: Math.min(validUntil, signed.validUntil) } }));
      else {
        const provider = createManagedScannerProvider({ baseUrl: `${origin}/`, apiKey: first.credential, source: () => Effect.succeed({ url: capability.presignedUrl, validUntil: Math.min(validUntil, signed.validUntil), digest }) });
        assert.equal(await Effect.runPromise(provider.submit({ attemptId, tenantId: first.tenantId, fileId: randomUUID(), digest, bytes, declaredType: "application/pdf" })), attemptId);
      }
      assert.equal((await http(`/api/scans?attemptId=${attemptId}`, second.credential)).status, 403);
      await tick([managedTaskId(first, attemptId)], false);
      const provider = createManagedScannerProvider({ baseUrl: `${origin}/`, apiKey: first.credential, source: () => Effect.fail(new IntakeError({code:"provider"})) });
      const event = await Effect.runPromise(provider.poll(attemptId)); assert(event); assert.equal(event.outcome, mismatch ? "failed" : "clean"); if (mismatch) assert(event.reason === "mismatch" || event.reason === "changed");
    }
    checks.externalSdk = { realSubmitAndPoll: true, digestMismatchDenied: true, tenantIsolation: true, sourceStore: "same dedicated trial store with exact-file signed access; not an independent customer-store trial" };
    const scannerHealth = await Effect.runPromise(createClamClient({host:"127.0.0.1",port:3310,now:Date.now}).health());
    checkpoint = "cleanup";
    return { scannerHealth, createdAt: new Date().toISOString(), stage: "actual deployed Vercel/private Blob/Neon/hosted ClamAV workflow", origin, syntheticFileCount: 4, totalUploadBytes: uploadedBytes, checks, limitations: ["Small synthetic trial, not universal detection or reliability certification", "Agent setup is separate fixture evidence", "Previously measured source expiry is separate evidence/blob-live.json", "Public discovery evaluation recorded separately"], cleanup: "exact captured trial Blob paths and associated metadata removed", costBasis: "four files about 5 MiB; bounded operations below one cent at ordinary Blob operation/transfer rates, existing hosting and maintenance excluded" };
  }), () => operation(async () => {
    try {
      if (paths.length) await del(paths, { token });
      if (fileIds.length) {
        const attempts = await pool.query<{ id: string }>(`SELECT a.id FROM ${tables.attempts} a JOIN ${tables.jobs} j ON j.id=a.job WHERE j.tenant=$1 AND j.file=ANY($2::text[])`, [first.tenantId, fileIds]);
        const ids = [...attempts.rows.map(row => row.id), ...sdkAttempts];
        const client = await pool.connect();
        await client.query("BEGIN");
        try {
          await client.query(`DELETE FROM ${tables.events} WHERE data->>'attemptId'=ANY($1::text[])`, [ids]);
          await client.query(`DELETE FROM ${scanner.tasks} WHERE attempt_id=ANY($1::text[]) AND tenant_id=$2`, [ids, first.tenantId]);
          await client.query(`DELETE FROM ${tables.attempts} WHERE id=ANY($1::text[])`, [attempts.rows.map(row => row.id)]);
          await client.query(`DELETE FROM ${tables.current} WHERE tenant=$1 AND file=ANY($2::text[])`, [first.tenantId, fileIds]);
          await client.query(`DELETE FROM ${tables.jobs} WHERE tenant=$1 AND file=ANY($2::text[])`, [first.tenantId, fileIds]);
          await client.query(`DELETE FROM ${tables.files} WHERE tenant_id=$1 AND user_id=$2 AND id=ANY($3::text[])`, [first.tenantId, first.userId, fileIds]);
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      } else if (sdkAttempts.length) await pool.query(`DELETE FROM ${scanner.tasks} WHERE attempt_id=ANY($1::text[]) AND tenant_id=$2`, [sdkAttempts, first.tenantId]);
    } finally { await pool.end(); }
  }).pipe(Effect.orDie));
  yield* operation(() => writeFile("evidence/managed-live.json", JSON.stringify(result, null, 2) + "\n"));
  yield* Effect.log("Deployed managed workflow verified and exact trial resources removed; evidence/managed-live.json");
});
Effect.runPromise(main).catch(() => { process.stderr.write(`Managed launch trial failed at ${checkpoint}; secrets and file capabilities are not printed.\n`); process.exitCode = 1; });
