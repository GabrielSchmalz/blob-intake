import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
const origin = "http://127.0.0.1:3087";
const fixture = "%PDF-1.7\nlocal synthetic document\n%%EOF";
const request = (path: string, init?: RequestInit) => Effect.tryPromise({ try: () => fetch(origin + path, { ...init, signal: AbortSignal.timeout(10000) }), catch: () => new Error("Local server unavailable; run npm start or npm run dev first") });
const checked = (path: string, expected: number, init?: RequestInit) => request(path, init).pipe(Effect.tap(response => Effect.try({ try: () => assert.equal(response.status, expected, path), catch: () => new Error(`Unexpected response status for ${path.split("?")[0]}`) })));
const main = Effect.gen(function* () {
  const results: Array<{ arm: string; upload: string; pendingDownloadBlocked: string; outageRetryClean: string; byteExactDownload: string; foreignOriginDenied: string }> = [];
  for (const arm of ["baseline", "candidate"]) {
    const form = new FormData(); form.set("arm", arm); form.set("file", new File([fixture], "fixture.pdf", { type: "application/pdf" }));
    const response = yield* checked("/api/demo/upload", 200, { method: "POST", headers: { Origin: origin }, body: form });
    const body: unknown = yield* Effect.tryPromise({ try: () => response.json(), catch: () => new Error("Malformed local upload response") });
    const upload = yield* Schema.decodeUnknown(Schema.Struct({ result: Schema.Struct({ jobId: Schema.String, fileId: Schema.String }) }))(body);
    const download = "/api/demo/download?" + new URLSearchParams({ arm, fileId: upload.result.fileId });
    yield* checked(download, 409);
    for (const action of ["outage", "retry", "clean"]) yield* checked("/api/demo/action", 200, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ arm, jobId: upload.result.jobId, action }) });
    const delivered = yield* checked(download, 200);
    const text = yield* Effect.tryPromise({ try: () => delivered.text(), catch: () => new Error("Missing delivery bytes") });
    yield* Effect.try({ try: () => assert.equal(text, fixture), catch: () => new Error("Delivered bytes differ from uploaded fixture") });
    yield* checked("/api/demo/action", 403, { method: "POST", headers: { Origin: "https://example.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ arm, jobId: upload.result.jobId, action: "clean" }) });
    results.push({ arm, upload: "pass", pendingDownloadBlocked: "pass", outageRetryClean: "pass", byteExactDownload: "pass", foreignOriginDenied: "pass" });
  }
  const evidence = { createdAt: new Date().toISOString(), stage: "local compiled Next.js HTTP smoke; fixture provider", results };
  yield* Effect.tryPromise({ try: () => writeFile("evidence/http-smoke.json", JSON.stringify(evidence, null, 2) + "\n"), catch: () => new Error("Evidence write failed") });
  yield* Effect.log("Compiled HTTP journey passes both arms; evidence/http-smoke.json");
});
Effect.runPromise(main).catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
