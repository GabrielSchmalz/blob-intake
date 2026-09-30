import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handleDemo } from "../src/demo/http";
import { guard } from "../src/demo/runtime";

const origin = "http://127.0.0.1:3087";
test("origin checks honor the HTTP Host when Next reconstructs its internal URL", () => {
  assert.equal(guard(new Request("http://localhost:3087/api/demo/action", { headers: { host: "127.0.0.1:3087", origin } }), true), true);
  assert.equal(guard(new Request("http://localhost:3087/api/demo/action", { headers: { host: "external.example", origin: "http://external.example" } }), true), false);
  assert.equal(guard(new Request(origin, { headers: { host: "127.0.0.1:3087", origin: "http://evil.example" } }), true), false);
});
const call = (operation: "state" | "upload" | "action" | "download", init?: RequestInit, query = "") => handleDemo(new Request(`${origin}/api/demo/${operation}${query}`, init), operation);
const action = (arm: string, jobId: string, operation: string) => call("action", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ arm, jobId, action: operation }) });
test("local portal guards and durable acceptance journey for both arms", async () => {
  const directory = mkdtempSync(join(tmpdir(), "intake-portal-"));
  const previous = process.env.BLOB_INTAKE_DEMO_DIR;
  process.env.BLOB_INTAKE_DEMO_DIR = directory;
  try {
    assert.equal((await handleDemo(new Request("https://external.example/api/demo/state?arm=candidate"), "state")).status, 403);
    assert.equal((await call("action", { method: "POST", body: "{}" })).status, 403);
    assert.equal((await call("action", { method: "POST", headers: { origin: "http://evil.example" }, body: "{}" })).status, 403);
    for (const arm of ["baseline", "candidate"]) {
      const form = new FormData();
      form.set("arm", arm);
      form.set("tenantId", "attacker-tenant");
      form.set("file", new File(["%PDF-1.7\nlocal fixture\n%%EOF"], "example.pdf", { type: "application/pdf" }));
      const result = await call("upload", { method: "POST", headers: { origin }, body: form });
      assert.equal(result.status, 200);
      const { result: job } = await result.json();
      assert.equal(job.tenantId, "local-example-organization");
      assert.equal(job.state, "processing");
      assert.equal((await call("download", undefined, `?arm=${arm}&fileId=${job.fileId}`)).status, 409);
      assert.equal((await action(arm, job.jobId, "outage")).status, 200);
      assert.equal((await call("download", undefined, `?arm=${arm}&fileId=${job.fileId}`)).status, 409);
      assert.equal((await action(arm, job.jobId, "retry")).status, 200);
      assert.equal((await action(arm, job.jobId, "clean")).status, 200);
      const state = await call("state", undefined, `?arm=${arm}`);
      const snapshot = await state.json();
      assert.equal(snapshot.items[0].status.state, "approved");
      const download = await call("download", undefined, `?arm=${arm}&fileId=${job.fileId}`);
      assert.equal(download.status, 200);
      assert.equal(await download.text(), "%PDF-1.7\nlocal fixture\n%%EOF");
      assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
      assert.equal((await call("download", undefined, `?arm=${arm === "baseline" ? "candidate" : "baseline"}&fileId=${job.fileId}`)).status, 404);
    }
    const threatForm = new FormData();
    threatForm.set("arm", "candidate");
    threatForm.set("file", new File(["%PDF-1.7\nthreat fixture"], "threat.pdf", { type: "application/pdf" }));
    const threatUpload = await call("upload", { method: "POST", headers: { origin }, body: threatForm });
    const { result: threatJob } = await threatUpload.json();
    assert.equal((await action("candidate", threatJob.jobId, "threat")).status, 200);
    assert.equal((await call("download", undefined, `?arm=candidate&fileId=${threatJob.fileId}`)).status, 409);
    const mismatchForm = new FormData();
    mismatchForm.set("arm", "candidate");
    mismatchForm.set("file", new File(["ordinary text"], "pretend.pdf", { type: "application/pdf" }));
    const mismatch = await call("upload", { method: "POST", headers: { origin }, body: mismatchForm });
    const { result: mismatchJob } = await mismatch.json();
    assert.equal(mismatchJob.state, "rejected");
    assert.equal((await call("download", undefined, `?arm=candidate&fileId=${mismatchJob.fileId}`)).status, 409);
    assert.equal((await call("action", { method: "POST", headers: { origin }, body: "x".repeat(8193) })).status, 413);
    assert.equal((await call("upload", { method: "POST", headers: { origin, "content-length": String(22 * 1024 * 1024) }, body: "" })).status, 413);
    const invalid = await call("action", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ arm: "other", jobId: "fake", action: "clean" }) });
    assert.equal(invalid.status, 403);
  } finally {
    if (previous === undefined) delete process.env.BLOB_INTAKE_DEMO_DIR; else process.env.BLOB_INTAKE_DEMO_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
