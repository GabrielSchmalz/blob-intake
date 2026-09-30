import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Effect, Schema } from "effect";
import { IntakeError, MAX_BYTES, POLICY_VERSION, type AcceptanceApp, type AppFactory, type AuthContext, type JobStatus, type ProviderEvent, type StoredFile } from "../contract/index.js";

const ReasonSchema = Schema.Literal("type", "size", "mismatch", "threat", "outage", "expired", "unknown", "conflict", "changed");
const StatusSchema = Schema.Struct({ jobId: Schema.String, tenantId: Schema.String, fileId: Schema.String, digest: Schema.String, declaredType: Schema.String, policyVersion: Schema.String, state: Schema.Literal("pending", "processing", "approved", "rejected", "failed"), reason: Schema.NullOr(ReasonSchema), attemptId: Schema.NullOr(Schema.String), providerId: Schema.NullOr(Schema.String), updatedAt: Schema.Number });
const RowSchema = Schema.Struct({ status: StatusSchema, userId: Schema.String });
const EventSchema = Schema.Struct({ eventId: Schema.String, attemptId: Schema.String, digest: Schema.String, outcome: Schema.Literal("clean", "threat", "failed", "unknown"), reason: Schema.NullOr(ReasonSchema) });
const AttemptSchema = Schema.Struct({ jobId: Schema.String, outcome: Schema.NullOr(Schema.Literal("clean", "threat")) });
const TextRow = Schema.Struct({ value: Schema.String });
const error = (code: IntakeError["code"]) => new IntakeError({ code });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function rejection(file: StoredFile): JobStatus["reason"] {
  if (file.bytes.length > MAX_BYTES) return "size";
  const b = file.bytes;
  const type = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d ? "application/pdf"
    : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a ? "image/png"
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg" : null;
  return type === null ? "type" : type !== file.declaredType ? "mismatch" : null;
}

export const createBaseline: AppFactory = (dependencies) => Effect.gen(function* () {
  const db = yield* Effect.try({ try: () => {
    const database = new DatabaseSync(dependencies.databasePath);
    database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS baseline_jobs (id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS baseline_attempts (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS baseline_events (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    return database;
  }, catch: () => error("persistence") });
  const persistence = <A>(operation: () => A) => Effect.try({ try: operation, catch: (cause) => cause instanceof IntakeError ? cause : error("persistence") });
  const parse = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A => Schema.decodeUnknownSync(schema)(value);
  const readRow = (id: string) => {
    const row = db.prepare("SELECT value FROM baseline_jobs WHERE id=?").get(id);
    return row === undefined ? null : parse(RowSchema, JSON.parse(parse(TextRow, row).value));
  };
  const save = (row: Schema.Schema.Type<typeof RowSchema>) => db.prepare("UPDATE baseline_jobs SET value=? WHERE id=?").run(JSON.stringify(row), row.status.jobId);
  const transaction = <A>(operation: () => A): A => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); db.exec("COMMIT"); return result; }
    catch (cause) { db.exec("ROLLBACK"); throw cause; }
  };
  const authorized = (context: AuthContext, jobId: string) => Effect.gen(function* () {
    const row = yield* persistence(() => readRow(jobId));
    if (row === null || row.status.tenantId !== context.tenantId) return yield* Effect.fail(error("denied"));
    yield* dependencies.storage.read(context, row.status.fileId);
    return row;
  });
  const invalidate = (jobId: string, reason: "changed" | "outage") => persistence(() => transaction(() => {
    const row = readRow(jobId);
    if (row !== null && row.status.reason !== "conflict" && (reason === "changed" || row.status.state === "processing" || row.status.state === "failed")) save({ ...row, status: { ...row.status, state: "failed", reason, updatedAt: dependencies.clock.now() } });
  }));
  const apply = (input: ProviderEvent) => Effect.gen(function* () {
    const event = yield* Schema.decodeUnknown(EventSchema)(input).pipe(Effect.mapError(() => error("invalid_callback")));
    const binding = yield* persistence(() => {
      const raw = db.prepare("SELECT value FROM baseline_attempts WHERE id=?").get(event.attemptId);
      return raw === undefined ? null : parse(AttemptSchema, JSON.parse(parse(TextRow, raw).value));
    });
    if (binding === null) return yield* Effect.fail(error("invalid_callback"));
    const row = yield* persistence(() => readRow(binding.jobId));
    if (row === null || row.status.digest !== event.digest) return yield* Effect.fail(error("invalid_callback"));
    const file = row.status.attemptId === event.attemptId
      ? yield* dependencies.storage.read({ tenantId: row.status.tenantId, userId: row.userId }, row.status.fileId).pipe(Effect.tapError(() => invalidate(row.status.jobId, "outage")))
      : null;
    const changed = file !== null && (digest(file.bytes) !== row.status.digest || file.declaredType !== row.status.declaredType || rejection(file) !== null || row.status.policyVersion !== POLICY_VERSION);
    return yield* persistence(() => transaction(() => {
      const previous = db.prepare("SELECT value FROM baseline_events WHERE id=?").get(event.eventId);
      if (previous !== undefined) {
        const existing = parse(EventSchema, JSON.parse(parse(TextRow, previous).value));
        if (JSON.stringify(existing) !== JSON.stringify(event)) throw error("invalid_callback");
        return { eventId: event.eventId, applied: false };
      }
      const current = readRow(row.status.jobId);
      if (current === null) throw error("persistence");
      db.prepare("INSERT INTO baseline_events VALUES (?,?)").run(event.eventId, JSON.stringify(event));
      if (current.status.attemptId !== event.attemptId) return { eventId: event.eventId, applied: false };
      let state: JobStatus["state"] = event.outcome === "clean" ? "approved" : event.outcome === "threat" ? "rejected" : "failed";
      let reason: JobStatus["reason"] = event.outcome === "clean" ? null : event.outcome === "threat" ? "threat" : event.reason ?? "unknown";
      const freshRaw = db.prepare("SELECT value FROM baseline_attempts WHERE id=?").get(event.attemptId);
      const attempt = parse(AttemptSchema, JSON.parse(parse(TextRow, freshRaw).value));
      if (current.status.reason === "conflict" || (attempt.outcome !== null && (event.outcome === "clean" || event.outcome === "threat") && attempt.outcome !== event.outcome)) { state = "failed"; reason = "conflict"; }
      else if (attempt.outcome !== null) { state = attempt.outcome === "clean" ? "approved" : "rejected"; reason = attempt.outcome === "clean" ? null : "threat"; }
      else if (event.outcome === "clean" || event.outcome === "threat") db.prepare("UPDATE baseline_attempts SET value=? WHERE id=?").run(JSON.stringify({ jobId: current.status.jobId, outcome: event.outcome }), event.attemptId);
      if (changed && reason !== "conflict") { state = "failed"; reason = "changed"; }
      save({ ...current, status: { ...current.status, state, reason, updatedAt: dependencies.clock.now() } });
      return { eventId: event.eventId, applied: true };
    }));
  });
  const submit: AcceptanceApp["submit"] = (context, jobId) => Effect.gen(function* () {
    const row = yield* authorized(context, jobId);
    const file = yield* dependencies.storage.read(context, row.status.fileId);
    if (digest(file.bytes) !== row.status.digest || file.declaredType !== row.status.declaredType || row.status.policyVersion !== POLICY_VERSION || rejection(file) !== null) { yield* invalidate(jobId, "changed"); return yield* app.status(context, jobId); }
    const claimed = yield* persistence(() => transaction(() => {
      const current = readRow(jobId);
      if (current === null) throw error("persistence");
      if (current.status.state !== "pending") return null;
      const attemptId = randomUUID();
      db.prepare("INSERT INTO baseline_attempts VALUES (?,?)").run(attemptId, JSON.stringify({ jobId, outcome: null }));
      save({ ...current, status: { ...current.status, state: "processing", attemptId, updatedAt: dependencies.clock.now() } });
      return attemptId;
    }));
    if (claimed === null) return yield* app.status(context, jobId);
    const receipt = yield* dependencies.provider.submit({ attemptId: claimed, tenantId: context.tenantId, fileId: row.status.fileId, digest: row.status.digest, bytes: file.bytes, declaredType: file.declaredType }).pipe(Effect.either);
    yield* persistence(() => transaction(() => {
      const current = readRow(jobId);
      if (current === null || current.status.attemptId !== claimed) return;
      save({ ...current, status: receipt._tag === "Right" ? { ...current.status, providerId: receipt.right, updatedAt: dependencies.clock.now() } : current.status.state === "processing" ? { ...current.status, state: "failed", reason: "outage", updatedAt: dependencies.clock.now() } : current.status });
    }));
    return yield* app.status(context, jobId);
  });
  const app: AcceptanceApp = {
    register: (context, fileId) => Effect.gen(function* () {
      const file = yield* dependencies.storage.read(context, fileId);
      const hash = digest(file.bytes);
      return yield* persistence(() => transaction(() => {
        const identity = JSON.stringify([context.tenantId, fileId, hash, file.declaredType, POLICY_VERSION]);
        const found = db.prepare("SELECT value FROM baseline_jobs WHERE identity=?").get(identity);
        if (found !== undefined) return parse(RowSchema, JSON.parse(parse(TextRow, found).value)).status;
        const reason = rejection(file);
        const status: JobStatus = { jobId: randomUUID(), tenantId: context.tenantId, fileId, digest: hash, declaredType: file.declaredType, policyVersion: POLICY_VERSION, state: reason === null ? "pending" : "rejected", reason, attemptId: null, providerId: null, updatedAt: dependencies.clock.now() };
        db.prepare("INSERT INTO baseline_jobs VALUES (?,?,?)").run(status.jobId, identity, JSON.stringify({ status, userId: context.userId }));
        return status;
      }));
    }),
    submit,
    status: (context, jobId) => Effect.gen(function* () {
      const row = yield* authorized(context, jobId);
      const file = yield* dependencies.storage.read(context, row.status.fileId);
      if (digest(file.bytes) !== row.status.digest || file.declaredType !== row.status.declaredType || row.status.policyVersion !== POLICY_VERSION || (row.status.state === "approved" && rejection(file) !== null)) yield* invalidate(jobId, "changed");
      return (yield* authorized(context, jobId)).status;
    }),
    callback: (raw) => dependencies.provider.verifyCallback(raw).pipe(Effect.flatMap(apply)),
    reconcile: () => Effect.gen(function* () {
      const rows = yield* persistence(() => db.prepare("SELECT value FROM baseline_jobs").all().map((raw) => parse(RowSchema, JSON.parse(parse(TextRow, raw).value))));
      let count = 0;
      for (const row of rows) {
        if (row.status.attemptId === null || (row.status.state !== "processing" && row.status.state !== "failed")) continue;
        const event = yield* dependencies.provider.poll(row.status.attemptId).pipe(Effect.either);
        if (event._tag === "Left") { yield* invalidate(row.status.jobId, "outage"); continue; }
        if (event.right !== null) {
          if (event.right.attemptId !== row.status.attemptId) return yield* Effect.fail(error("invalid_callback"));
          const result = yield* apply(event.right); if (result.applied) count++;
        }
      }
      return count;
    }),
    retry: (context, jobId) => Effect.gen(function* () {
      const previous = yield* app.status(context, jobId);
      if (previous.state !== "failed" || previous.reason === "conflict" || previous.reason === "changed") return yield* Effect.fail(error("inaccessible"));
      yield* persistence(() => transaction(() => {
        const row = readRow(jobId);
        if (row !== null && row.status.state === "failed" && row.status.reason !== "conflict" && row.status.reason !== "changed") save({ ...row, status: { ...row.status, state: "pending", reason: null, attemptId: null, providerId: null, updatedAt: dependencies.clock.now() } });
      }));
      return yield* submit(context, jobId);
    }),
    deliver: (context, fileId) => Effect.gen(function* () {
      const file = yield* dependencies.storage.read(context, fileId);
      if (rejection(file) !== null) return yield* Effect.fail(error("inaccessible"));
      const hash = digest(file.bytes);
      const rows = yield* persistence(() => db.prepare("SELECT value FROM baseline_jobs WHERE identity=?").all(JSON.stringify([context.tenantId, fileId, hash, file.declaredType, POLICY_VERSION])).map((raw) => parse(RowSchema, JSON.parse(parse(TextRow, raw).value))));
      if (!rows.some((row) => row.status.state === "approved" && row.status.reason === null)) return yield* Effect.fail(error("inaccessible"));
      return file.bytes;
    }),
    close: () => persistence(() => db.close()),
  };
  return app;
});
