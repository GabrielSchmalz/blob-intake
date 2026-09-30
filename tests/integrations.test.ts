import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { IntakeError, type Submission } from "../src/contract/index.js";
import { createTransloaditProvider, type AssemblyBinding, type AssemblyRegistry } from "../src/integrations/transloadit.js";
import { openAssemblyRegistry } from "../src/integrations/assembly-registry.js";
import { createPrivateBlobIntegration } from "../src/integrations/vercel-blob.js";
const bytes = new TextEncoder().encode("%PDF-1.7\nfixture");
const digest = createHash("sha256").update(bytes).digest("hex");
const assemblyId = "a".repeat(32);
const submission: Submission = { attemptId: "attempt-1", tenantId: "tenant", fileId: "file", bytes, digest, declaredType: "application/pdf" };
const binding: AssemblyBinding = { attemptId: submission.attemptId, tenantId: "tenant", fileId: "file", digest, assemblyId };
const file = { original_id: "original-1", mime: "application/pdf", meta: { hash: digest } };
const completed = { assembly_id: assemblyId, ok: "ASSEMBLY_COMPLETED", results: { verified: [file], scanned: [file], hashed: [file] } };
const sign = (body: string) => ({ body, signature: createHmac("sha1", "test-secret").update(body).digest("hex") });
function harness(initial: AssemblyBinding | null = binding) {
  const bindings = new Map<string, AssemblyBinding>();
  if (initial) bindings.set(initial.attemptId, initial);
  const captures: { url: string; init: RequestInit }[] = [];
  let wire = JSON.stringify(completed);
  const registry: AssemblyRegistry = {
    byAttempt: (id) => Effect.succeed(bindings.get(id) ?? null),
    byAssembly: (id) => Effect.succeed([...bindings.values()].find((value) => value.assemblyId === id) ?? null),
    save: (value) => Effect.sync(() => { bindings.set(value.attemptId, value); }),
  };
  const provider = createTransloaditProvider({ authKey: "test-key", authSecret: "test-secret", notifyUrl: "https://example.com/callback", registry,
    source: () => Effect.succeed({ url: "https://store.private.blob.vercel-storage.com/file?secret=source", validUntil: 900000, digest }), now: () => 0,
    fetch: async (input, init) => { captures.push({ url: String(input), init: init ?? {} }); return new Response(wire); },
  });
  return { provider, captures, bindings, wire: (value: unknown) => { wire = JSON.stringify(value); } };
}
test("signed callback accepts only known matching completed verify/scan/full hash results", async () => {
  const { provider } = harness();
  const result = await Effect.runPromise(provider.verifyCallback(sign(JSON.stringify(completed))));
  assert.equal(result.outcome, "clean");
  assert.equal(result.attemptId, submission.attemptId);
  for (const value of [
    { ...completed, results: {} },
    { ...completed, ignored_error_count: 1 },
    { ...completed, ignored_errors: [{}] },
    { ...completed, error: "ROBOT_FAILED" },
    { ...completed, ok: "ASSEMBLY_CANCELED" },
    { ...completed, results: { ...completed.results, scanned: [] } },
    { ...completed, results: { ...completed.results, scanned: [{ ...file, original_id: "different" }] } },
    { ...completed, results: { ...completed.results, hashed: [{ ...file, meta: { hash: "wrong" } }] } },
    { ...completed, results: { ...completed.results, hashed: [{ ...file, meta: { hash: digest, hash_partial: "first" } }] } },
  ]) assert.notEqual((await Effect.runPromise(provider.verifyCallback(sign(JSON.stringify(value))))).outcome, "clean");
});
test("callback rejects bad/malformed signatures, malformed JSON, and unknown assembly", async () => {
  const { provider } = harness();
  for (const raw of [
    { body: "not json", signature: "0".repeat(40) },
    sign("not json"),
    { body: JSON.stringify(completed), signature: "abc" },
    { ...sign(JSON.stringify(completed)), body: JSON.stringify(completed) + " " },
    sign(JSON.stringify({ ...completed, assembly_id: "b".repeat(32) })),
  ]) assert.equal((await Effect.runPromiseExit(provider.verifyCallback(raw)))._tag, "Failure");
});
test("poll ignores status URL and keeps original attempt binding", async () => {
  const h = harness();
  h.wire({ ...completed, assembly_ssl_url: "https://evil.example/secret", fields: { attemptId: "forged" } });
  const result = await Effect.runPromise(h.provider.poll(submission.attemptId));
  assert.equal(result?.attemptId, submission.attemptId);
  assert.equal(h.captures[0]?.url, `https://api2.transloadit.com/assemblies/${assemblyId}`);
  h.wire({ ...completed, ok: "ASSEMBLY_EXECUTING" });
  assert.equal(await Effect.runPromise(h.provider.poll(submission.attemptId)), null);
  h.wire({ ...completed, assembly_id: "b".repeat(32) });
  assert.notEqual((await Effect.runPromise(h.provider.poll(submission.attemptId)))?.outcome, "clean");
});
test("submit signs exact params, configures fail-closed pipeline, persists no source credentials", async () => {
  const h = harness(null);
  h.wire({ assembly_id: assemblyId, ok: "ASSEMBLY_EXECUTING" });
  assert.equal(await Effect.runPromise(h.provider.submit(submission)), submission.attemptId);
  const body = h.captures[0]?.init.body;
  assert.ok(body instanceof FormData);
  const params = body.get("params");
  assert.equal(typeof params, "string");
  if (typeof params !== "string") throw new Error("params");
  assert.equal(body.get("signature"), `sha384:${createHmac("sha384", "test-secret").update(params).digest("hex")}`);
  const parsed = JSON.parse(params);
  assert.equal(parsed.steps.imported.max_file_size, 20 * 1024 * 1024);
  assert.equal(parsed.steps.scanned.error_on_decline, true);
  assert.equal(parsed.steps.verified.error_on_decline, true);
  assert.equal(parsed.steps.hashed.partial, "full");
  assert.deepEqual(parsed.notification_payload, ["without_params", "without_uploads"]);
  assert.equal(JSON.stringify([...h.bindings.values()]).includes("source"), false);
  await Effect.runPromise(h.provider.submit(submission));
  assert.equal(h.captures.length, 1);
  assert.equal((await Effect.runPromiseExit(h.provider.submit({ ...submission, tenantId: "other" })))._tag, "Failure");
});
test("submit refuses locally mismatched bytes before source access/network", async () => {
  const h = harness(null);
  assert.equal((await Effect.runPromiseExit(h.provider.submit({ ...submission, digest: "0".repeat(64) })))._tag, "Failure");
  assert.equal(h.captures.length, 0);
});
test("private Blob reads immutable reference and source resolver checks digest before granting scoped URL", async () => {
  const context = { tenantId: "tenant", userId: "user" };
  const ref = { pathname: "tenant/file.pdf", digest };
  let resolveSourceCalls = 0;
  const blob = createPrivateBlobIntegration({ token: "test-only", now: () => 0,
    resolve: (auth, id) => auth.tenantId === "tenant" && id === "file" ? Effect.succeed(ref) : Effect.fail(new IntakeError({ code: "denied" })),
    resolveSource: () => { resolveSourceCalls++; return Effect.succeed(ref); },
    sdk: {
      get: async (pathname, options) => {
        assert.equal(pathname, ref.pathname); assert.equal(options.access, "private"); assert.equal(options.useCache, false);
        return { statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), headers: new Headers(),
          blob: { url: "https://store.private.blob.vercel-storage.com/file", downloadUrl: "", pathname, contentDisposition: "", cacheControl: "", uploadedAt: new Date(0), etag: "etag", contentType: "application/pdf", size: bytes.length } };
      },
      issueSignedToken: async (options) => {
        assert.equal(options.pathname, ref.pathname); assert.deepEqual(options.operations, ["get"]);
        return { delegationToken: "delegate", clientSigningToken: "signing", validUntil: options.validUntil ?? 0 };
      },
      presignUrl: async (_, options) => { assert.equal(options.operation, "get"); assert.equal(options.access, "private"); return { presignedUrl: "https://store.private.blob.vercel-storage.com/file?signed=test" }; },
    },
  });
  assert.deepEqual((await Effect.runPromise(blob.storage.read(context, "file"))).bytes, Buffer.from(bytes));
  assert.equal((await Effect.runPromiseExit(blob.storage.read({ ...context, tenantId: "other" }, "file")))._tag, "Failure");
  assert.equal((await Effect.runPromise(blob.source(submission))).digest, digest);
  assert.equal(resolveSourceCalls, 1);
  assert.equal((await Effect.runPromiseExit(blob.source({ ...submission, digest: "wrong" })))._tag, "Failure");
});

test("assembly registry survives close/reopen and rejects binding reassignment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blob-intake-provider-"));
  try {
    const path = join(directory, "provider.sqlite");
    const first = await Effect.runPromise(openAssemblyRegistry(path));
    await Effect.runPromise(first.save(binding));
    await Effect.runPromise(first.close());
    const recovered = await Effect.runPromise(openAssemblyRegistry(path));
    try {
      assert.deepEqual(await Effect.runPromise(recovered.byAttempt(binding.attemptId)), binding);
      assert.deepEqual(await Effect.runPromise(recovered.byAssembly(binding.assemblyId)), binding);
      await Effect.runPromise(recovered.save(binding));
      assert.equal((await Effect.runPromiseExit(recovered.save({ ...binding, digest: "changed" })))._tag, "Failure");
    } finally { await Effect.runPromise(recovered.close()); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
