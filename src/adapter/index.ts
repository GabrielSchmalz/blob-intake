import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Effect, Schema } from "effect";
import { IntakeError, MAX_BYTES, POLICY_VERSION, type AppFactory, type AuthContext, type JobStatus, type ProviderEvent, type Reason, type StoredFile } from "../contract/index";

const ReasonSchema = Schema.Literal("type", "size", "mismatch", "threat", "outage", "expired", "unknown", "conflict", "changed");
const JobSchema = Schema.Struct({
  jobId: Schema.String, tenantId: Schema.String, fileId: Schema.String, digest: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  declaredType: Schema.String, policyVersion: Schema.String,
  state: Schema.Literal("pending", "processing", "approved", "rejected", "failed"),
  reason: Schema.NullOr(ReasonSchema), attemptId: Schema.NullOr(Schema.String),
  providerId: Schema.NullOr(Schema.String), updatedAt: Schema.Number,
});
const RowSchema = Schema.Struct({ data: Schema.String });
const EventSchema = Schema.Struct({ eventId: Schema.NonEmptyString, attemptId: Schema.NonEmptyString,
  digest: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)), outcome: Schema.Literal("clean", "threat", "failed", "unknown"), reason: Schema.NullOr(ReasonSchema) });
const FileSchema = Schema.Struct({ bytes: Schema.Uint8ArrayFromSelf, declaredType: Schema.String });
const digestOf = (file: StoredFile) => createHash("sha256").update(file.bytes).digest("hex");
const policy = (file: StoredFile): Reason | null => {
  if (file.bytes.length > MAX_BYTES) return "size";
  const b = file.bytes;
  const mime = b.length >= 5 && Buffer.from(b.subarray(0, 5)).toString() === "%PDF-" ? "application/pdf"
    : b.length >= 8 && Buffer.from(b.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255 ? "image/jpeg" : null;
  return mime === null ? "type" : mime !== file.declaredType ? "mismatch" : null;
};
const matches = (file: StoredFile, job: JobStatus) => digestOf(file) === job.digest && file.declaredType === job.declaredType && job.policyVersion === POLICY_VERSION && policy(file) === null;

/** Durable local SDK prototype. Production requires an equivalent transactional store. */
export const createIntake: AppFactory = (deps) => Effect.gen(function* () {
  const db = yield* Effect.try({ try: () => {
    const connection = new DatabaseSync(deps.databasePath);
    connection.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS intake_jobs (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, file TEXT NOT NULL, digest TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(tenant,file,digest));
      CREATE TABLE IF NOT EXISTS intake_current (tenant TEXT NOT NULL, file TEXT NOT NULL, job TEXT NOT NULL, PRIMARY KEY(tenant,file));
      CREATE TABLE IF NOT EXISTS intake_attempts (id TEXT PRIMARY KEY, job TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS intake_events (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS intake_ignored_events (fingerprint TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    return connection;
  }, catch: () => new IntakeError({ code: "persistence" }) });
  const sql = <A>(body: () => A): Effect.Effect<A, IntakeError> => Effect.try({ try: body, catch: (error) => error instanceof IntakeError ? error : new IntakeError({ code: "persistence" }) });
  const transaction = <A>(body: () => A) => sql(() => {
    db.exec("BEGIN IMMEDIATE");
    try { const value = body(); db.exec("COMMIT"); return value; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  });
  const decodeRow = (value: unknown): JobStatus | null => value === undefined ? null
    : Schema.decodeUnknownSync(JobSchema)(JSON.parse(Schema.decodeUnknownSync(RowSchema)(value).data));
  const get = (id: string) => decodeRow(db.prepare("SELECT data FROM intake_jobs WHERE id=?").get(id));
  const save = (job: JobStatus) => { db.prepare("UPDATE intake_jobs SET data=? WHERE id=?").run(JSON.stringify(job), job.jobId); return job; };
  const current = (job: JobStatus) => db.prepare("SELECT job FROM intake_current WHERE tenant=? AND file=? AND job=?").get(job.tenantId, job.fileId, job.jobId) !== undefined;
  const read = (ctx: AuthContext, fileId: string) => deps.storage.read(ctx, fileId).pipe(Effect.flatMap(value => Schema.decodeUnknown(FileSchema)(value).pipe(Effect.mapError(() => new IntakeError({ code: "storage" })))));
  const authorize = (ctx: AuthContext, id: string) => Effect.gen(function* () {
    const job = yield* sql(() => get(id));
    if (!job) return yield* Effect.fail(new IntakeError({ code: "not_found" }));
    if (job.tenantId !== ctx.tenantId) return yield* Effect.fail(new IntakeError({ code: "denied" }));
    const file = yield* read(ctx, job.fileId);
    return { job, file };
  });
  const invalidate = (job: JobStatus) => transaction(() => {
    const fresh = get(job.jobId);
    if (!fresh) throw new IntakeError({ code: "not_found" });
    if (fresh.reason === "conflict") return fresh;
    return save({ ...fresh, state: "failed", reason: "changed", updatedAt: deps.clock.now() });
  });
  const apply = (event: ProviderEvent) => transaction(() => {
    const serialized = JSON.stringify(event);
    const row = db.prepare("SELECT intake_jobs.data FROM intake_jobs JOIN intake_attempts ON intake_jobs.id=intake_attempts.job WHERE intake_attempts.id=?").get(event.attemptId);
    const job = decodeRow(row);
    if (!job || job.attemptId !== event.attemptId || job.digest !== event.digest || !current(job) || job.reason === "changed" || job.reason === "conflict") {
      db.prepare("INSERT OR IGNORE INTO intake_ignored_events VALUES (?,?)").run(createHash("sha256").update(serialized).digest("hex"), serialized);
      return { eventId: event.eventId, applied: false };
    }
    const existing = db.prepare("SELECT data FROM intake_events WHERE id=?").get(event.eventId);
    if (existing !== undefined) {
      if (Schema.decodeUnknownSync(RowSchema)(existing).data !== serialized) {
        throw new IntakeError({ code: "invalid_callback" });
      }
      return { eventId: event.eventId, applied: false };
    }
    db.prepare("INSERT INTO intake_events VALUES (?,?)").run(event.eventId, serialized);
    const state = event.outcome === "clean" ? "approved" : event.outcome === "threat" ? "rejected" : "failed";
    const reason: Reason | null = event.outcome === "clean" ? null : event.outcome === "threat" ? "threat" : event.reason ?? "unknown";
    if (job.state === "approved" || job.state === "rejected") {
      const contradiction = state !== "failed" && job.state !== state;
      if (contradiction) save({ ...job, state: "failed", reason: "conflict", updatedAt: deps.clock.now() });
      return { eventId: event.eventId, applied: contradiction };
    }
    save({ ...job, state, reason, updatedAt: deps.clock.now() });
    return { eventId: event.eventId, applied: true };
  });
  const acceptEvent = (event: ProviderEvent) => Effect.gen(function* () {
    const binding = yield* sql(() => {
      const job = decodeRow(db.prepare("SELECT intake_jobs.data FROM intake_jobs JOIN intake_attempts ON intake_jobs.id=intake_attempts.job WHERE intake_attempts.id=?").get(event.attemptId));
      if (!job || job.attemptId !== event.attemptId || job.digest !== event.digest || !current(job)) return null;
      const { owner } = Schema.decodeUnknownSync(Schema.Struct({ owner: Schema.String }))(db.prepare("SELECT owner FROM intake_jobs WHERE id=?").get(job.jobId));
      return { job, owner };
    });
    if (binding !== null) {
      const file = yield* read({ tenantId: binding.job.tenantId, userId: binding.owner }, binding.job.fileId).pipe(Effect.either);
      if (file._tag === "Left" || !matches(file.right, binding.job)) yield* invalidate(binding.job);
    }
    return yield* apply(event);
  });
  const submit = (ctx: AuthContext, id: string) => Effect.gen(function* () {
    const { job, file } = yield* authorize(ctx, id);
    if (!matches(file, job)) return job.state === "rejected" ? job : yield* invalidate(job);
    const claim = yield* transaction(() => {
      const fresh = get(id);
      if (!fresh || !current(fresh)) throw new IntakeError({ code: "inaccessible" });
      if (fresh.state !== "pending") return { job: fresh, claimed: false };
      const next: JobStatus = { ...fresh, state: "processing", attemptId: randomUUID(), providerId: null, updatedAt: deps.clock.now() };
      db.prepare("INSERT INTO intake_attempts VALUES (?,?)").run(next.attemptId, id);
      return { job: save(next), claimed: true };
    });
    if (!claim.claimed || claim.job.attemptId === null) return claim.job;
    const attemptId = claim.job.attemptId;
    const result = yield* deps.provider.submit({ attemptId, tenantId: ctx.tenantId, fileId: job.fileId, digest: job.digest, bytes: file.bytes, declaredType: file.declaredType }).pipe(
      Effect.flatMap(value => Schema.decodeUnknown(Schema.NonEmptyString)(value).pipe(Effect.mapError(() => new IntakeError({ code: "provider" })))), Effect.either);
    return yield* transaction(() => {
      const fresh = get(id);
      if (!fresh) throw new IntakeError({ code: "not_found" });
      if (fresh.attemptId !== attemptId) return fresh;
      if (result._tag === "Right") return save({ ...fresh, providerId: result.right, updatedAt: deps.clock.now() });
      if (fresh.state !== "processing") return fresh;
      return save({ ...fresh, state: "failed", reason: "outage", updatedAt: deps.clock.now() });
    });
  });
  return {
    register: (ctx, fileId) => Effect.gen(function* () {
      const file = yield* read(ctx, fileId);
      const digest = digestOf(file);
      return yield* transaction(() => {
        const identity = JSON.stringify([digest, file.declaredType, POLICY_VERSION]);
        const existing = decodeRow(db.prepare("SELECT data FROM intake_jobs WHERE tenant=? AND file=? AND digest=?").get(ctx.tenantId, fileId, identity));
        if (existing) { db.prepare("INSERT OR REPLACE INTO intake_current VALUES (?,?,?)").run(ctx.tenantId, fileId, existing.jobId); return existing; }
        const reason = policy(file);
        const job: JobStatus = { jobId: randomUUID(), tenantId: ctx.tenantId, fileId, digest, declaredType: file.declaredType, policyVersion: POLICY_VERSION, state: reason === null ? "pending" : "rejected", reason, attemptId: null, providerId: null, updatedAt: deps.clock.now() };
        db.prepare("INSERT INTO intake_jobs VALUES (?,?,?,?,?,?)").run(job.jobId, ctx.tenantId, fileId, identity, ctx.userId, JSON.stringify(job));
        db.prepare("INSERT OR REPLACE INTO intake_current VALUES (?,?,?)").run(ctx.tenantId, fileId, job.jobId);
        return job;
      });
    }),
    submit,
    status: (ctx, id) => Effect.gen(function* () {
      const { job, file } = yield* authorize(ctx, id);
      return matches(file, job) || job.state === "rejected" ? job : yield* invalidate(job);
    }),
    callback: (raw) => deps.provider.verifyCallback(raw).pipe(
      Effect.flatMap(event => Schema.decodeUnknown(EventSchema)(event).pipe(Effect.mapError(() => new IntakeError({ code: "invalid_callback" })))), Effect.flatMap(acceptEvent)),
    reconcile: () => Effect.gen(function* () {
      const jobs = yield* sql(() => db.prepare("SELECT data FROM intake_jobs").all().map(decodeRow).filter(job => job !== null && job.attemptId !== null && job.updatedAt <= deps.clock.now() - 60_000 && (job.state === "processing" || job.state === "failed")));
      let count = 0;
      for (const job of jobs) {
        if (job === null || job.attemptId === null) continue;
        const owner = yield* sql(() => Schema.decodeUnknownSync(Schema.Struct({ owner: Schema.String }))(db.prepare("SELECT owner FROM intake_jobs WHERE id=?").get(job.jobId)).owner);
        const file = yield* read({ tenantId: job.tenantId, userId: owner }, job.fileId).pipe(Effect.either);
        if (file._tag === "Left" || !matches(file.right, job)) { yield* invalidate(job); continue; }
        const result = yield* deps.provider.poll(job.attemptId).pipe(Effect.either);
        if (result._tag === "Right" && result.right !== null) {
          const event = yield* Schema.decodeUnknown(EventSchema)(result.right).pipe(Effect.mapError(() => new IntakeError({ code: "provider" })));
          if (event.attemptId !== job.attemptId || event.digest !== job.digest) continue;
          if ((yield* apply(event)).applied) count++;
        }
      }
      return count;
    }),
    retry: (ctx, id) => Effect.gen(function* () {
      const { job, file } = yield* authorize(ctx, id);
      if (!matches(file, job)) return yield* invalidate(job);
      yield* transaction(() => {
        const fresh = get(id);
        if (!fresh || !current(fresh) || fresh.state !== "failed" || fresh.reason === "changed" || fresh.reason === "conflict") throw new IntakeError({ code: "inaccessible" });
        save({ ...fresh, state: "pending", reason: null, attemptId: null, providerId: null, updatedAt: deps.clock.now() });
      });
      return yield* submit(ctx, id);
    }),
    deliver: (ctx, fileId) => Effect.gen(function* () {
      const file = yield* read(ctx, fileId);
      const job = yield* sql(() => decodeRow(db.prepare("SELECT intake_jobs.data FROM intake_jobs JOIN intake_current ON intake_current.job=intake_jobs.id WHERE intake_current.tenant=? AND intake_current.file=?").get(ctx.tenantId, fileId)));
      if (!job || job.state !== "approved") return yield* Effect.fail(new IntakeError({ code: "inaccessible" }));
      if (!matches(file, job)) { yield* invalidate(job); return yield* Effect.fail(new IntakeError({ code: "inaccessible" })); }
      return file.bytes;
    }),
    close: () => sql(() => db.close()),
  };
});
