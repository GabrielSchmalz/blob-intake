import test from "node:test";
import assert from "node:assert/strict";
import { Effect } from "effect";
import { createCandidate } from "../src/candidate/index";
import { scenarios } from "./scenarios";
import { FixtureClock, FixtureProvider, FixtureStorage, pdf, signed, tenantA } from "../fixtures/dependencies";
for (const scenario of scenarios) test(`candidate ${scenario.id}: ${scenario.name}`, () => scenario.run(createCandidate));

test("candidate concurrent handoffs persist one claimed attempt", async () => {
  const storage = new FixtureStorage();
  storage.put(tenantA, "file");
  const fixture = new FixtureProvider();
  const provider = { ...fixture, poll: fixture.poll, verifyCallback: fixture.verifyCallback,
    submit: (request: Parameters<typeof fixture.submit>[0]) => Effect.sleep("10 millis").pipe(Effect.flatMap(() => fixture.submit(request))) };
  const app = await Effect.runPromise(createCandidate({ databasePath: ":memory:", storage, provider, clock: new FixtureClock() }));
  try {
    const job = await Effect.runPromise(app.register(tenantA, "file"));
    const results = await Effect.runPromise(Effect.all([app.submit(tenantA, job.jobId), app.submit(tenantA, job.jobId)], { concurrency: "unbounded" }));
    assert.equal(fixture.submitCalls, 1);
    assert.equal(results[0]?.attemptId, results[1]?.attemptId);
  } finally { await Effect.runPromise(app.close()); }
});

test("candidate callback cannot approve bytes replaced without registration", async () => {
  const storage = new FixtureStorage();
  storage.put(tenantA, "file");
  const provider = new FixtureProvider();
  const app = await Effect.runPromise(createCandidate({ databasePath: ":memory:", storage, provider, clock: new FixtureClock() }));
  try {
    const pending = await Effect.runPromise(app.register(tenantA, "file"));
    const job = await Effect.runPromise(app.submit(tenantA, pending.jobId));
    storage.put(tenantA, "file", new Uint8Array([...pdf, 32]));
    const receipt = await Effect.runPromise(app.callback(signed(provider.complete(job))));
    assert.equal(receipt.applied, false);
    assert.equal((await Effect.runPromise(app.status(tenantA, job.jobId))).reason, "changed");
    assert.equal(await Effect.runPromise(Effect.isFailure(app.deliver(tenantA, "file"))), true);
  } finally { await Effect.runPromise(app.close()); }
});
