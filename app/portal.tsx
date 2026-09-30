"use client";
import { Effect, Schema } from "effect";
import { useEffect, useState } from "react";
const Status = Schema.Struct({ jobId: Schema.String, state: Schema.Literal("pending", "processing", "approved", "rejected", "failed"), reason: Schema.NullOr(Schema.String) });
const Snapshot = Schema.Struct({ providerJobs: Schema.Number, items: Schema.Array(Schema.Struct({ fileId: Schema.String, name: Schema.String, type: Schema.String, status: Status })) });
type Snapshot = typeof Snapshot.Type;
type Arm = "baseline" | "candidate";
const messages: Record<string, string> = { type: "Unsupported file type", size: "File exceeds size limit", mismatch: "Declared type differs from content", threat: "Simulated threat result", outage: "Simulated provider outage", expired: "Processing expired", unknown: "Result not established", conflict: "Conflicting results", changed: "Content changed" };
const request = (url: string, init?: RequestInit) => Effect.tryPromise({ try: () => fetch(url, init), catch: () => new Error("Could not reach local server.") }).pipe(Effect.flatMap(response => Effect.tryPromise({ try: () => response.json(), catch: () => new Error("Invalid server response.") }).pipe(Effect.flatMap((body: unknown) => response.ok ? Effect.succeed(body) : Effect.fail(new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Request failed."))))));
export default function Portal() {
  const [arm, setArm] = useState<Arm>("candidate");
  const [data, setData] = useState<Snapshot>({ providerJobs: 0, items: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = (selected: Arm) => request(`/api/demo/state?arm=${selected}`).pipe(Effect.flatMap(Schema.decodeUnknown(Snapshot)), Effect.map(snapshot => { setData(snapshot); }));
  useEffect(() => {
    let active = true;
    const program = request(`/api/demo/state?arm=${arm}`).pipe(Effect.flatMap(Schema.decodeUnknown(Snapshot)), Effect.match({ onFailure: () => { if (active) setError("Unable to load the local experiment."); }, onSuccess: snapshot => { if (active) { setData(snapshot); setError(""); } } }));
    void Effect.runPromise(program);
    return () => { active = false; };
  }, [arm]);
  const execute = (program: Effect.Effect<unknown, unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    void Effect.runPromise(program.pipe(Effect.flatMap(() => refresh(arm)), Effect.match({ onFailure: error => { setError(error instanceof Error ? error.message : "Unable to complete this action."); setBusy(false); }, onSuccess: () => { setNotice(success); setBusy(false); } })));
  };
  const action = (jobId: string, action: string) => execute(request("/api/demo/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ arm, jobId, action }) }), "Local fixture state updated.");
  return <div className="frame">
    <aside><a className="brand" href="/">▤ <span>Blob Intake</span></a><p className="eyebrow">LOCAL EXPERIMENT</p><div className="nav-current">File acceptance</div><p className="aside-note">One portal. Two implementations. The same acceptance contract.</p><div className="identity"><span className="avatar">LO</span><div>Local organization<small>Server-owned demo session</small></div></div></aside>
    <main>
      <div className="topline"><span>Workspace / File acceptance</span><span className="pill">Local simulation</span></div>
      <header><p className="eyebrow">PRIVATE FILE WORKFLOW</p><h1>Files, with a clear decision.</h1><p className="intro">Upload a document, simulate a processing result, and download it only after approval.</p></header>
      <div className="simulation"><strong>This is a local simulation.</strong> No malware scanner or cloud provider is called. Approval below reflects fixture results, not evidence that a file is safe. Files and metadata stay in this repository’s ignored runtime directory.</div>
      <section className="toolbar" aria-label="Implementation selection"><label htmlFor="arm">Implementation<select id="arm" value={arm} disabled={busy} onChange={event => { setArm(event.target.value === "baseline" ? "baseline" : "candidate"); setNotice(""); }}><option value="candidate">Candidate adapter</option><option value="baseline">Incumbent baseline</option></select></label><div className="toolbar-note">Same UI and local provider.<br/>Independent acceptance databases.</div><div className="stat"><strong>{data.providerJobs}</strong><span>Stored fixture jobs · both arms</span></div></section>
      <section className="upload-card"><div><h2>Add a private file</h2><p>PDF, PNG, or JPEG. Up to 20 MiB. Actual content is checked against the declared type.</p></div><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set("arm", arm); execute(request("/api/demo/upload", { method: "POST", body: form }), "File registered. Review its status below."); }}><label className="file-label" htmlFor="file">Choose file<input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required disabled={busy}/></label><button className="primary" disabled={busy} type="submit">{busy ? "Working…" : "Upload & check"}</button></form></section>
      {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
      <section className="files"><div className="section-title"><h2>Your files <span className="count">{data.items.length}</span></h2><button disabled={busy} onClick={() => execute(Effect.void, "File list refreshed.")}>Refresh</button></div>
      {!data.items.length ? <div className="empty"><span className="empty-icon">▤</span><h3>No files in this implementation yet</h3><p>Upload a file to walk through acceptance and recovery.</p></div> : <ul className="file-list">{data.items.map(item => <li key={item.fileId}><div className="file-main"><div className="file-symbol">▤</div><div className="file-info"><h3>{item.name}</h3><p>{item.type} · Private upload</p>{item.status.reason && <p className="reason">{messages[item.status.reason] ?? item.status.reason}</p>}</div><span className={`status ${item.status.state}`}>{item.status.state === "approved" ? "Fixture approved" : item.status.state}</span></div><div className="file-actions">{item.status.state === "processing" && <><span className="control-label">Simulate result:</span><button disabled={busy} onClick={() => action(item.status.jobId, "clean")}>Clean</button><button disabled={busy} onClick={() => action(item.status.jobId, "threat")}>Threat</button><button disabled={busy} onClick={() => action(item.status.jobId, "outage")}>Outage</button></>}{item.status.state === "failed" && <button disabled={busy} onClick={() => action(item.status.jobId, "retry")}>Retry processing</button>}<button disabled={busy} onClick={() => action(item.status.jobId, "reconcile")}>Reconcile</button>{item.status.state === "approved" ? <a className="download" href={`/api/demo/download?arm=${arm}&fileId=${encodeURIComponent(item.fileId)}`}>Download file ↓</a> : <span className="download-disabled">Download unavailable</span>}</div></li>)}</ul>}
      </section><footer>Fixture controls advance a simulated clock by 61 seconds. Illustrative single-organization session; production authentication is not included.</footer>
    </main>
  </div>;
}
