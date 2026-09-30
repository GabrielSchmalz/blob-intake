import { createHmac, timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";
import { IntakeError, type AuthContext, type JobStatus, type Provider, type ProviderEvent, type RawCallback, type Storage, type StoredFile, type Submission } from "../src/contract/index.js";

export const tenantA: AuthContext = { tenantId: "tenant-a", userId: "user-a" };
export const tenantB: AuthContext = { tenantId: "tenant-b", userId: "user-b" };
export const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
export const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
export const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0]);
const secret = "synthetic-fixture-key-not-a-credential";
const reason = Schema.Literal("type", "size", "mismatch", "threat", "outage", "expired", "unknown", "conflict", "changed");
const eventSchema = Schema.Struct({
  eventId: Schema.String.pipe(Schema.minLength(1)),
  attemptId: Schema.String.pipe(Schema.minLength(1)),
  digest: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  outcome: Schema.Literal("clean", "threat", "failed", "unknown"),
  reason: Schema.NullOr(reason),
});
function signature(body: string): string { return createHmac("sha256", secret).update(body).digest("hex"); }
export function signed(event: ProviderEvent): RawCallback {
  const body = JSON.stringify(event);
  return { body, signature: signature(body) };
}

/** Storage fixture models app-established ownership, not provider-side ACLs. */
export class FixtureStorage implements Storage {
  private readonly files = new Map<string, StoredFile>();
  put(context: AuthContext, fileId: string, bytes: Uint8Array = pdf, declaredType = "application/pdf"): void {
    this.files.set(`${context.tenantId}/${fileId}`, { bytes: Uint8Array.from(bytes), declaredType });
  }
  revoke(context: AuthContext, fileId: string): void {
    this.files.delete(`${context.tenantId}/${fileId}`);
  }
  readonly read = (context: AuthContext, fileId: string): Effect.Effect<StoredFile, IntakeError> =>
    Effect.suspend(() => {
      const file = this.files.get(`${context.tenantId}/${fileId}`);
      return file ? Effect.succeed({ bytes: Uint8Array.from(file.bytes), declaredType: file.declaredType })
        : Effect.fail(new IntakeError({ code: "denied" }));
    });
}

/** Synthetic provider deliberately has no acceptance state machine. */
export class FixtureProvider implements Provider {
  readonly submissions = new Map<string, Submission>();
  readonly outcomes = new Map<string, ProviderEvent>();
  submitCalls = 0;
  pollCalls = 0;
  loseNextReceipt = false;
  outage = false;
  private nextEvent = 0;
  readonly submit = (request: Submission): Effect.Effect<string, IntakeError> => Effect.suspend(() => {
    this.submitCalls++;
    if (this.outage) return Effect.fail(new IntakeError({ code: "provider" }));
    this.submissions.set(request.attemptId, request);
    if (this.loseNextReceipt) {
      this.loseNextReceipt = false;
      return Effect.fail(new IntakeError({ code: "provider" }));
    }
    return Effect.succeed(`provider-${request.attemptId}`);
  });
  readonly poll = (attemptId: string): Effect.Effect<ProviderEvent | null, IntakeError> => Effect.suspend(() => {
    this.pollCalls++;
    return this.outage ? Effect.fail(new IntakeError({ code: "provider" })) : Effect.succeed(this.outcomes.get(attemptId) ?? null);
  });
  readonly verifyCallback = (raw: RawCallback): Effect.Effect<ProviderEvent, IntakeError> => Effect.gen(function* () {
    const expected = Buffer.from(signature(raw.body));
    const actual = Buffer.from(raw.signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return yield* Effect.fail(new IntakeError({ code: "invalid_callback" }));
    const parsed = yield* Effect.try({ try: (): unknown => JSON.parse(raw.body), catch: () => new IntakeError({ code: "invalid_callback" }) });
    return yield* Schema.decodeUnknown(eventSchema)(parsed).pipe(Effect.mapError(() => new IntakeError({ code: "invalid_callback" })));
  });
  event(job: JobStatus, outcome: ProviderEvent["outcome"], why: ProviderEvent["reason"] = null): ProviderEvent {
    if (job.attemptId === null) throw new Error("Fixture event requires a submitted attempt");
    return { eventId: `event-${++this.nextEvent}`, attemptId: job.attemptId, digest: job.digest, outcome, reason: why };
  }
  complete(job: JobStatus, outcome: ProviderEvent["outcome"] = "clean", why: ProviderEvent["reason"] = null): ProviderEvent {
    const event = this.event(job, outcome, why);
    this.outcomes.set(event.attemptId, event);
    return event;
  }
}
export class FixtureClock {
  private timestamp = 1_800_000_000_000;
  readonly now = (): number => this.timestamp;
  advance(milliseconds = 120_000): void { this.timestamp += milliseconds; }
}
