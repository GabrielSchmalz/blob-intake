import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { MAX_BYTES, POLICY_VERSION, type AcceptanceApp, type AppFactory, type Dependencies, type JobStatus } from "../src/contract/index.js";
import { FixtureClock, FixtureProvider, FixtureStorage, jpeg, pdf, png, signed, tenantA, tenantB } from "../fixtures/dependencies.js";

interface Harness {
  app: AcceptanceApp;
  readonly storage: FixtureStorage;
  readonly provider: FixtureProvider;
  readonly clock: FixtureClock;
  readonly restart: () => Promise<void>;
}
const run = Effect.runPromise;
async function inaccessible(app: AcceptanceApp, fileId = "file"): Promise<void> {
  assert.equal(await run(Effect.isFailure(app.deliver(tenantA, fileId))), true, "Unapproved or replaced content must not be delivered");
}
async function submitted(h: Harness, fileId = "file"): Promise<JobStatus> {
  const registered = await run(h.app.register(tenantA, fileId));
  assert.equal(registered.state, "pending");
  return run(h.app.submit(tenantA, registered.jobId));
}
async function approve(h: Harness, job: JobStatus): Promise<void> {
  await run(h.app.callback(signed(h.provider.complete(job))));
  assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "approved");
}
async function fixture(factory: AppFactory, body: (h: Harness) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blob-intake-"));
  const storage = new FixtureStorage();
  storage.put(tenantA, "file");
  const provider = new FixtureProvider();
  const clock = new FixtureClock();
  const dependencies: Dependencies = { databasePath: join(directory, "state.sqlite"), storage, provider, clock };
  let app: AcceptanceApp | undefined;
  try {
    app = await run(factory(dependencies));
    const harness: Harness = {
      app, storage, provider, clock,
      restart: async () => {
        await run(harness.app.close());
        app = await run(factory(dependencies));
        harness.app = app;
      },
    };
    await body(harness);
  } finally {
    if (app) await run(app.close());
    await rm(directory, { recursive: true, force: true });
  }
}
export interface Scenario { readonly id: string; readonly name: string; readonly run: (factory: AppFactory) => Promise<void> }
const scenario = (id: string, name: string, body: (h: Harness) => Promise<void>): Scenario => ({ id, name, run: (factory) => fixture(factory, body) });

export const scenarios: readonly Scenario[] = [
  scenario("S01", "valid formats and stable same-content registration", async (h) => {
    for (const [id, bytes, type] of [["pdf", pdf, "application/pdf"], ["png", png, "image/png"], ["jpeg", jpeg, "image/jpeg"]] satisfies [string, Uint8Array, string][]) {
      h.storage.put(tenantA, id, bytes, type);
      const registered = await run(h.app.register(tenantA, id));
      assert.equal((await run(h.app.register(tenantA, id))).jobId, registered.jobId);
      assert.match(registered.digest, /^[a-f0-9]{64}$/);
      assert.equal(registered.policyVersion, POLICY_VERSION);
      assert.equal(registered.declaredType, type);
      await inaccessible(h.app, id);
      const job = await run(h.app.submit(tenantA, registered.jobId));
      assert.ok(job.attemptId);
      await approve(h, job);
      assert.deepEqual(await run(h.app.deliver(tenantA, id)), bytes);
    }
  }),
  scenario("S02", "actual bytes, size and declared-type mismatch reject", async (h) => {
    const cases: readonly [string, Uint8Array, string, string][] = [
      ["type", new TextEncoder().encode("<script>alert(1)</script>"), "application/pdf", "type"],
      ["mismatch", png, "application/pdf", "mismatch"],
      ["size", new Uint8Array(MAX_BYTES + 1), "application/pdf", "size"],
    ];
    for (const [id, bytes, type, reason] of cases) {
      h.storage.put(tenantA, id, bytes, type);
      const job = await run(h.app.register(tenantA, id));
      assert.equal(job.state, "rejected");
      assert.equal(job.reason, reason);
      await inaccessible(h.app, id);
    }
    assert.equal(h.provider.submitCalls, 0);
    const approved = await submitted(h);
    await approve(h, approved);
    h.storage.put(tenantA, "file", pdf, "image/png");
    await inaccessible(h.app);
    const changedMetadata = await run(h.app.register(tenantA, "file"));
    assert.equal(changedMetadata.state, "rejected");
    assert.equal(changedMetadata.reason, "mismatch");
    assert.equal(changedMetadata.declaredType, "image/png");
    await inaccessible(h.app);
    h.storage.put(tenantA, "file", pdf, "application/pdf");
    const restored = await run(h.app.register(tenantA, "file"));
    assert.equal(restored.declaredType, "application/pdf");
    assert.notEqual(restored.reason, "mismatch");
  }),
  scenario("S03", "synthetic threat rejects", async (h) => {
    const job = await submitted(h);
    await run(h.app.callback(signed(h.provider.complete(job, "threat", "threat"))));
    assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "rejected");
    await inaccessible(h.app);
  }),
  scenario("S04", "outage and unknown result fail closed", async (h) => {
    const job = await submitted(h);
    h.provider.outage = true;
    h.clock.advance();
    await run(Effect.either(h.app.reconcile()));
    await inaccessible(h.app);
    h.provider.outage = false;
    await run(h.app.callback(signed(h.provider.complete(job, "unknown", "unknown"))));
    assert.notEqual((await run(h.app.status(tenantA, job.jobId))).state, "approved");
    await inaccessible(h.app);
    await approve(h, job);
    for (const outcome of ["unknown", "failed"] satisfies ["unknown", "failed"]) {
      await run(h.app.callback(signed(h.provider.event(job, outcome, outcome === "unknown" ? "unknown" : "outage"))));
      assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "approved", "Nonterminal uncertainty must not clear a terminal successful verdict");
      assert.deepEqual(await run(h.app.deliver(tenantA, "file")), pdf);
    }
  }),
  scenario("S05", "duplicate authenticated event has one state effect", async (h) => {
    const job = await submitted(h);
    const callback = signed(h.provider.complete(job));
    const first = await run(h.app.callback(callback));
    const second = await run(h.app.callback(callback));
    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.eventId, first.eventId);
    assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "approved");
  }),
  scenario("S06", "forged, malformed, unknown and content-mismatched callbacks have no effect", async (h) => {
    const job = await submitted(h);
    const good = signed(h.provider.event(job, "clean"));
    assert.equal(await run(Effect.isFailure(h.app.callback({ ...good, signature: "forged" }))), true);
    const malformed = signed({ ...h.provider.event(job, "clean"), digest: "invalid" });
    assert.equal(await run(Effect.isFailure(h.app.callback(malformed))), true);
    await run(Effect.either(h.app.callback(signed({ ...h.provider.event(job, "clean"), attemptId: "unknown-attempt" }))));
    const contentBoundEvent = h.provider.event(job, "clean");
    await run(Effect.either(h.app.callback(signed({ ...contentBoundEvent, digest: "0".repeat(64) }))));
    assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "processing");
    await inaccessible(h.app);
    const corrected = await run(h.app.callback(signed(contentBoundEvent)));
    assert.equal(corrected.applied, true, "Invalid digest must not consume the valid event identity");
    assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "approved");
    const collision = await run(Effect.either(h.app.callback(signed({ ...contentBoundEvent, outcome: "threat", reason: "threat" }))));
    assert.equal(collision._tag, "Left", "Mutated canonical event identity must reject without a state effect");
    if (collision._tag === "Left") assert.equal(collision.left.code, "invalid_callback");
    assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "approved");
    assert.deepEqual(await run(h.app.deliver(tenantA, "file")), pdf);
  }),
  scenario("S07", "lost callback recovered by exact-attempt polling", async (h) => {
    const job = await submitted(h);
    h.provider.complete(job);
    h.clock.advance();
    await run(h.app.reconcile());
    assert.ok(h.provider.pollCalls > 0);
    assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "approved");
    assert.deepEqual(await run(h.app.deliver(tenantA, "file")), pdf);
  }),
  scenario("S08", "expired access requires explicit new attempt", async (h) => {
    const job = await submitted(h);
    await run(h.app.callback(signed(h.provider.complete(job, "failed", "expired"))));
    assert.equal((await run(h.app.status(tenantA, job.jobId))).reason, "expired");
    await inaccessible(h.app);
    const retried = await run(h.app.retry(tenantA, job.jobId));
    assert.notEqual(retried.attemptId, job.attemptId);
    await approve(h, retried);
    assert.deepEqual(await run(h.app.deliver(tenantA, "file")), pdf);
  }),
  scenario("S09", "late previous-attempt success cannot approve retry", async (h) => {
    const job = await submitted(h);
    await run(h.app.callback(signed(h.provider.event(job, "failed", "outage"))));
    const retried = await run(h.app.retry(tenantA, job.jobId));
    await run(h.app.callback(signed(h.provider.event(job, "clean"))));
    const current = await run(h.app.status(tenantA, job.jobId));
    assert.equal(current.attemptId, retried.attemptId);
    assert.notEqual(current.state, "approved");
    await inaccessible(h.app);
    await approve(h, retried);
  }),
  scenario("S10", "replacement invalidates previously approved digest", async (h) => {
    const old = await submitted(h);
    await approve(h, old);
    h.storage.put(tenantA, "file", png, "image/png");
    await inaccessible(h.app);
    const replacement = await run(h.app.register(tenantA, "file"));
    assert.notEqual(replacement.digest, old.digest);
    assert.notEqual(replacement.jobId, old.jobId);
    await run(h.app.callback(signed(h.provider.event(old, "clean"))));
    await inaccessible(h.app);
    await approve(h, await run(h.app.submit(tenantA, replacement.jobId)));
    assert.deepEqual(await run(h.app.deliver(tenantA, "file")), png);
  }),
  scenario("S11", "tenant guesses cannot register, inspect, retry or deliver", async (h) => {
    const job = await submitted(h);
    await approve(h, job);
    for (const operation of [h.app.register(tenantB, "file").pipe(Effect.asVoid), h.app.status(tenantB, job.jobId).pipe(Effect.asVoid), h.app.submit(tenantB, job.jobId).pipe(Effect.asVoid), h.app.retry(tenantB, job.jobId).pipe(Effect.asVoid), h.app.deliver(tenantB, "file").pipe(Effect.asVoid)]) {
      assert.equal(await run(Effect.isFailure(operation)), true);
    }
    h.storage.put(tenantB, "file");
    const other = await run(h.app.register(tenantB, "file"));
    assert.notEqual(other.jobId, job.jobId, "Identical bytes must not deduplicate across tenants");
    assert.equal(other.state, "pending");
    assert.equal(await run(Effect.isFailure(h.app.deliver(tenantB, "file"))), true);
    h.storage.revoke(tenantA, "file");
    assert.equal(await run(Effect.isFailure(h.app.status(tenantA, job.jobId))), true, "Current membership must gate metadata too");
    await inaccessible(h.app);
  }),
  scenario("S12", "lost submit receipt and committed state survive restart", async (h) => {
    const registered = await run(h.app.register(tenantA, "file"));
    h.provider.loseNextReceipt = true;
    await run(Effect.either(h.app.submit(tenantA, registered.jobId)));
    const durable = await run(h.app.status(tenantA, registered.jobId));
    assert.ok(durable.attemptId, "Attempt identity must be durable before provider invocation");
    assert.equal(h.provider.submissions.size, 1);
    h.provider.complete(durable);
    await h.restart();
    h.clock.advance();
    await run(h.app.reconcile());
    assert.equal((await run(h.app.status(tenantA, registered.jobId))).state, "approved");
    assert.equal(h.provider.submitCalls, 1, "Reconciliation should not resubmit an accepted attempt");
    await h.restart();
    assert.deepEqual(await run(h.app.deliver(tenantA, "file")), pdf);
    const duplicate = signed(h.provider.complete(durable));
    await run(h.app.callback(duplicate));
    assert.equal((await run(h.app.callback(duplicate))).applied, false);
  }),
  scenario("S13", "contradictory terminal results close access", async (h) => {
    const job = await submitted(h);
    await approve(h, job);
    await run(h.app.callback(signed(h.provider.event(job, "threat", "threat"))));
    const conflicted = await run(h.app.status(tenantA, job.jobId));
    assert.notEqual(conflicted.state, "approved");
    assert.equal(conflicted.reason, "conflict");
    await inaccessible(h.app);
    assert.equal(await run(Effect.isFailure(h.app.retry(tenantA, job.jobId))), true, "Retry cannot erase contradictory terminal evidence");
    h.clock.advance();
    await run(h.app.reconcile());
    await inaccessible(h.app);
    await h.restart();
    await inaccessible(h.app);
  }),
  scenario("S14", "restarted worker rediscovers overdue work and preserves unknown", async (h) => {
    const job = await submitted(h);
    await h.restart();
    h.clock.advance();
    await run(h.app.reconcile());
    assert.ok(h.provider.pollCalls > 0);
    await inaccessible(h.app);
    h.provider.complete(job);
    h.clock.advance();
    await run(h.app.reconcile());
    assert.equal((await run(h.app.status(tenantA, job.jobId))).state, "approved");
    assert.deepEqual(await run(h.app.deliver(tenantA, "file")), pdf);
  }),
];
