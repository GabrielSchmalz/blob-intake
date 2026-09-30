import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Schema } from "effect";
import { createBaseline } from "../baseline/index";
import { createCandidate } from "../candidate/index";
import { IntakeError, MAX_BYTES, type AcceptanceApp, type AuthContext, type Provider, type ProviderEvent, type StoredFile } from "../contract/index";

export const Arm = Schema.Literal("baseline", "candidate");
export type Arm = typeof Arm.Type;
const Action = Schema.Struct({ arm: Arm, jobId: Schema.String.pipe(Schema.minLength(1)), action: Schema.Literal("clean", "threat", "outage", "reconcile", "retry") });
const Event = Schema.Struct({ eventId: Schema.String, attemptId: Schema.String, digest: Schema.String, outcome: Schema.Literal("clean", "threat", "failed", "unknown"), reason: Schema.NullOr(Schema.Literal("type", "size", "mismatch", "threat", "outage", "expired", "unknown", "conflict", "changed")) });
const FileRow = Schema.Struct({ id: Schema.String, name: Schema.String, declared_type: Schema.String, arm: Arm, job_id: Schema.String });
const context: AuthContext = { tenantId: "local-example-organization", userId: "local-example-user" };
const io = <A>(f: () => A) => Effect.try({ try: f, catch: () => new IntakeError({ code: "persistence" }) });

function openDatabase() {
  const directory = process.env.BLOB_INTAKE_DEMO_DIR ?? join(process.cwd(), "runtime", "demo");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(join(directory, "portal.sqlite"));
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS demo_files (id TEXT PRIMARY KEY, name TEXT NOT NULL, declared_type TEXT NOT NULL, bytes BLOB NOT NULL, arm TEXT NOT NULL, job_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS demo_attempts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, event TEXT); CREATE TABLE IF NOT EXISTS demo_clock (id INTEGER PRIMARY KEY CHECK(id=1), offset INTEGER NOT NULL); INSERT OR IGNORE INTO demo_clock VALUES(1,0);");
  return { database, directory };
}
function provider(database: DatabaseSync): Provider {
  return {
    submit: request => io(() => {
      database.prepare("INSERT OR IGNORE INTO demo_attempts(id,digest) VALUES (?,?)").run(request.attemptId, request.digest);
      return `fixture-${request.attemptId}`;
    }),
    poll: attemptId => Effect.gen(function* () {
      const row = yield* io(() => database.prepare("SELECT event FROM demo_attempts WHERE id=?").get(attemptId));
      if (!row || typeof row.event !== "string") return null;
      return yield* Schema.decodeUnknown(Schema.parseJson(Event))(row.event).pipe(Effect.mapError(() => new IntakeError({ code: "provider" })));
    }),
    verifyCallback: () => Effect.fail(new IntakeError({ code: "invalid_callback" }))
  };
}
function scoped<A>(arm: Arm, action: (app: AcceptanceApp, db: DatabaseSync) => Effect.Effect<A, IntakeError>) {
  return Effect.acquireUseRelease(io(openDatabase), ({ database, directory }) => Effect.gen(function* () {
    const storage = { read: (_auth: AuthContext, fileId: string): Effect.Effect<StoredFile, IntakeError> => Effect.gen(function* () {
      if (_auth.tenantId !== context.tenantId || _auth.userId !== context.userId) return yield* Effect.fail(new IntakeError({ code: "denied" }));
      const row = yield* io(() => database.prepare("SELECT bytes, declared_type FROM demo_files WHERE id=? AND arm=?").get(fileId, arm));
      if (!row || !(row.bytes instanceof Uint8Array) || typeof row.declared_type !== "string") return yield* Effect.fail(new IntakeError({ code: "not_found" }));
      return { bytes: row.bytes, declaredType: row.declared_type };
    }) };
    const factory = arm === "baseline" ? createBaseline : createCandidate;
    return yield* Effect.acquireUseRelease(factory({ databasePath: join(directory, `${arm}.sqlite`), storage, provider: provider(database), clock: { now: () => { const row = database.prepare("SELECT offset FROM demo_clock WHERE id=1").get(); return Date.now() + Number(row?.offset ?? 0); } } }), app => action(app, database), app => app.close().pipe(Effect.orDie));
  }), ({ database }) => Effect.sync(() => database.close()));
}

export function guard(request: Request, mutation: boolean) {
  const url = new URL(request.url);
  let authority: URL;
  try { authority = new URL(`${url.protocol}//${request.headers.get("host") ?? url.host}`); }
  catch { return false; }
  const local = authority.hostname === "localhost" || authority.hostname === "127.0.0.1" || authority.hostname === "[::1]";
  if (!local) return false;
  return !mutation || request.headers.get("origin") === authority.origin;
}
export const state = (arm: Arm) => scoped(arm, (app, database) => Effect.gen(function* () {
  const rows = yield* io(() => database.prepare("SELECT id,name,declared_type,arm,job_id FROM demo_files WHERE arm=? ORDER BY rowid DESC").all(arm));
  const files = yield* Schema.decodeUnknown(Schema.Array(FileRow))(rows).pipe(Effect.mapError(() => new IntakeError({ code: "persistence" })));
  const items = yield* Effect.forEach(files, file => app.status(context, file.job_id).pipe(Effect.map(status => ({ fileId: file.id, name: file.name, type: file.declared_type, status }))));
  const count = yield* io(() => database.prepare("SELECT COUNT(*) AS count FROM demo_attempts").get());
  return { arm, items, providerJobs: Number(count?.count ?? 0), mode: "local simulation" };
}));
export const upload = (arm: Arm, file: File) => scoped(arm, (app, database) => Effect.gen(function* () {
  if (file.size > MAX_BYTES || file.size === 0 || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) return yield* Effect.fail(new IntakeError({ code: "storage" }));
  const bytes = yield* Effect.tryPromise({ try: () => file.arrayBuffer(), catch: () => new IntakeError({ code: "storage" }) });
  const id = randomUUID();
  const name = file.name.replace(/[\r\n\u0000-\u001f]/g, "").slice(0, 200) || "upload";
  yield* io(() => database.prepare("INSERT INTO demo_files VALUES (?,?,?,?,?,?)").run(id, name, file.type, new Uint8Array(bytes), arm, ""));
  const job = yield* app.register(context, id).pipe(Effect.tapError(() => io(() => database.prepare("DELETE FROM demo_files WHERE id=?").run(id))));
  yield* io(() => database.prepare("UPDATE demo_files SET job_id=? WHERE id=?").run(job.jobId, id));
  return yield* app.submit(context, job.jobId);
}));
export const act = (input: unknown) => Schema.decodeUnknown(Action)(input).pipe(Effect.mapError(() => new IntakeError({ code: "denied" })), Effect.flatMap(input => scoped(input.arm, (app, database) => Effect.gen(function* () {
  if (input.action === "retry") return yield* app.retry(context, input.jobId);
  if (input.action === "reconcile") { yield* app.status(context, input.jobId); yield* io(() => database.prepare("UPDATE demo_clock SET offset=offset+61000 WHERE id=1").run()); return yield* app.reconcile(); }
  const job = yield* app.status(context, input.jobId);
  if (job.attemptId === null) return yield* Effect.fail(new IntakeError({ code: "provider" }));
  const event: ProviderEvent = { eventId: randomUUID(), attemptId: job.attemptId, digest: job.digest, outcome: input.action === "outage" ? "failed" : input.action, reason: input.action === "outage" ? "outage" : input.action === "threat" ? "threat" : null };
  const attemptId = job.attemptId;
  yield* io(() => database.prepare("UPDATE demo_attempts SET event=? WHERE id=?").run(JSON.stringify(event), attemptId));
  yield* io(() => database.prepare("UPDATE demo_clock SET offset=offset+61000 WHERE id=1").run());
  return yield* app.reconcile();
}))));
export const download = (arm: Arm, fileId: string) => scoped(arm, (app, database) => Effect.gen(function* () {
  const bytes = yield* app.deliver(context, fileId);
  const raw = yield* io(() => database.prepare("SELECT id,name,declared_type,arm,job_id FROM demo_files WHERE id=? AND arm=?").get(fileId, arm));
  const file = yield* Schema.decodeUnknown(FileRow)(raw).pipe(Effect.mapError(() => new IntakeError({ code: "not_found" })));
  return { bytes, name: file.name, type: file.declared_type, checksum: createHash("sha256").update(bytes).digest("hex") };
}));
