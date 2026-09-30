import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { createBaseline } from "../src/baseline/index";
import { createCandidate } from "../src/candidate/index";
import { scenarios } from "../tests/scenarios";

const io = <A>(operation: () => Promise<A>) => Effect.tryPromise({ try: operation, catch: () => new Error("Comparison I/O failed") });
const inventory = (directory: string): Effect.Effect<Array<{ path: string; nonblankLines: number; sha256: string }>, Error> => Effect.gen(function* () {
  const entries = yield* io(() => readdir(directory, { withFileTypes: true }));
  const rows: Array<{ path: string; nonblankLines: number; sha256: string }> = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...yield* inventory(path));
    else if (/\.tsx?$/.test(path)) {
      const source = yield* io(() => readFile(path, "utf8"));
      rows.push({ path, nonblankLines: source.split("\n").filter(line => line.trim() !== "").length, sha256: createHash("sha256").update(source).digest("hex") });
    }
  }
  return rows;
});
const main = Effect.gen(function* () {
  const results: Array<{ arm: string; scenario: string; result: "pass" }> = [];
  for (const [arm, factory] of [["baseline", createBaseline], ["candidate", createCandidate]] as const) {
    for (const scenario of scenarios) {
      yield* Effect.tryPromise({ try: () => scenario.run(factory), catch: () => new Error(`${arm} ${scenario.id} failed; comparison is not scored`) });
      results.push({ arm, scenario: scenario.id, result: "pass" });
    }
  }
  const baseline = yield* inventory("src/baseline");
  const candidate = yield* inventory("src/candidate");
  const sdk = yield* inventory("src/adapter");
  const shared = [...yield* inventory("src/contract"), ...yield* inventory("src/integrations"), ...yield* inventory("src/demo"), ...yield* inventory("app"), ...yield* inventory("fixtures")];
  const total = (rows: typeof baseline) => rows.reduce((n, row) => n + row.nonblankLines, 0);
  const reduction = total(baseline) === 0 ? null : (total(baseline) - total(candidate)) / total(baseline);
  const evidence = {
    createdAt: new Date().toISOString(), node: process.version, stage: "local synthetic experiment",
    results, inventory: { baseline, candidate, sdk, shared },
    measurement: { baselineAppLines: total(baseline), candidateAppLines: total(candidate), candidateSdkLines: total(sdk), candidateTotalLines: total(candidate) + total(sdk), appFacingReduction: reduction, setupTime: null, setupTimeReason: "No fresh integrator or measured active-time ledger; parallel agent authoring cannot establish setup-time savings." },
    gate: { localEquivalent: true, proposedAppCodeThresholdMet: reduction !== null && reduction >= 0.5, decision: "continue only with a small integration trial; no hosted-business or production claim" },
    pending: ["real Blob/Transloadit execution and cost/retention measurements", "deployment with shared production persistence and application authentication", "fresh developer setup-time comparison", "buyer willingness to pay", "unprompted agent recommendations"]
  };
  yield* io(() => mkdir("evidence", { recursive: true }));
  yield* io(() => writeFile("evidence/local-comparison.json", JSON.stringify(evidence, null, 2) + "\n"));
  yield* Effect.log(`Both arms pass ${scenarios.length} scenarios. App-facing source reduction ${(100 * (reduction ?? 0)).toFixed(1)}%; candidate SDK ${total(sdk)} lines also maintained. Evidence: evidence/local-comparison.json`);
});
Effect.runPromise(main).catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
