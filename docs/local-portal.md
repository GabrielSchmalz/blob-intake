# Local portal

Run `npm run dev` and open `http://127.0.0.1:3087`. The same App Router portal
selects the independently implemented baseline or candidate. Both use the same
local fixture provider and server-owned illustrative tenant/user context.
No cloud provider is called and no malware scan is performed.

Upload a PDF, PNG or JPEG (20 MiB maximum). Uploads first remain unavailable.
Choose Clean, Threat or Outage to emit a deterministic fixture result and reconcile.
An outage permits Retry processing. Clean approval enables an attachment download;
threat, invalid type, mismatch, pending and failed states keep delivery closed.
Reconcile polls without generating a new result. Fixture controls advance a persisted
simulated clock by 61 seconds, so reconciliation eligibility needs no real-time wait.
This clock advancement applies across both arms; wall-clock behavior is covered by
the separate shared acceptance scenarios.

Files, names, provider attempts/results and a simulated clock live in SQLite at
`runtime/demo/portal.sqlite`. Acceptance state lives in separate `baseline.sqlite`
and `candidate.sqlite` files. Every HTTP operation opens and closes its databases;
the next operation recovers persisted state. `BLOB_INTAKE_DEMO_DIR` optionally selects
another owner-local runtime directory. The directory is created with mode 0700.
The configured runtime directory is not an upload destination chosen by clients.

This is a single-organization local example, not production authentication. Tenant
and user authority come from a fixed backend context, never request fields. Loopback
hosts are required; mutations additionally require an exact same-origin Origin header.
The default dev/start commands bind to 127.0.0.1. Do not expose this fixture-control
portal through a public proxy. Do not use sensitive uploads in the local experiment.

## HTTP surface

- `GET /api/demo/state?arm=baseline|candidate`: file metadata and acceptance status.
- `POST /api/demo/upload`: multipart `arm` and `file`. Only PDF/PNG/JPEG declared types.
- `POST /api/demo/action`: JSON `arm`, `jobId`, `action` (clean/threat/outage/reconcile/retry).
- `GET /api/demo/download?arm=...&fileId=...`: authorized acceptance-gated attachment.

Unknown JSON is parsed with Effect Schema. Multipart parsing is bounded to 21 MiB,
action JSON to 8 KiB, and actual file bytes to 20 MiB. File identifiers are generated
server-side and used in SQL parameters; no client identifier becomes a disk path.
Responses contain no provider credentials, source URLs or signed source capabilities.
Direct-download responses disable caching and content sniffing.

`tests/demo-http.test.ts` drives the actual shared route boundary for same-origin
rejection, server-owned tenant identity, outage/retry/approval, cross-arm isolation,
gated delivery and original bytes. Browser appearance/interaction evidence belongs
to the final verification record; this HTTP test alone does not prove rendering.
