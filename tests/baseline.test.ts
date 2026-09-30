import { test } from "node:test";
import { createBaseline } from "../src/baseline/index.js";
import { scenarios } from "./scenarios.js";

for (const scenario of scenarios) test(`baseline ${scenario.id} ${scenario.name}`, () => scenario.run(createBaseline));

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { FixtureClock, FixtureProvider, FixtureStorage, signed, tenantA } from "../fixtures/dependencies.js";

test("baseline concurrent instances claim one attempt and polling cannot erase conflict", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-concurrent-"));
  const storage = new FixtureStorage();
  storage.put(tenantA, "file");
  const provider = new FixtureProvider();
  const dependencies = { databasePath: join(directory, "state.sqlite"), storage, provider, clock: new FixtureClock() };
  const first = await Effect.runPromise(createBaseline(dependencies));
  const second = await Effect.runPromise(createBaseline(dependencies));
  try {
    const registered = await Effect.runPromise(Effect.all([first.register(tenantA, "file"), second.register(tenantA, "file")], { concurrency: "unbounded" }));
    assert.equal(registered[0].jobId, registered[1].jobId);
    const jobs = await Effect.runPromise(Effect.all([first.submit(tenantA, registered[0].jobId), second.submit(tenantA, registered[0].jobId)], { concurrency: "unbounded" }));
    assert.equal(provider.submitCalls, 1);
    assert.equal(jobs[0].attemptId, jobs[1].attemptId);
    const clean = provider.event(jobs[0], "clean");
    await Effect.runPromise(first.callback(signed(clean)));
    const collision = await Effect.runPromise(Effect.either(second.callback(signed({ ...clean, outcome: "threat" }))));
    assert.equal(collision._tag, "Left");
    if (collision._tag === "Left") assert.equal(collision.left.code, "invalid_callback");
    await Effect.runPromise(second.callback(signed(provider.event(jobs[0], "threat"))));
    provider.outage = true;
    await Effect.runPromise(first.reconcile());
    assert.equal((await Effect.runPromise(first.status(tenantA, jobs[0].jobId))).reason, "conflict");
    assert.equal(await Effect.runPromise(Effect.isFailure(second.deliver(tenantA, "file"))), true);
  } finally {
    await Effect.runPromise(first.close());
    await Effect.runPromise(second.close());
    await rm(directory, { recursive: true, force: true });
  }
});
