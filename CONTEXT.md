# Project context

Destination: determine whether a small Blob-specific file-acceptance integration
saves meaningful development effort and can support a paid offering that AI
assistants naturally select while building Next.js applications on Vercel.

Target workflow: one customer uploads a private PDF/image into an organization;
authorized users can download it only after configured checks finish. App-owned
business review, authentication and tenant membership remain application concerns.

The research concluded **conditional experiment, no proven commercial winner**.
Same-storage processing, scanning, type checking and callbacks already exist.
The proposed value is packaging durable state, content binding and recovery.
The chosen product is now the source SDK plus our managed ClamAV scanner.
The reusable integration targets developers’ private Vercel Blob stores and a
server-only Blob Intake key. Its remote SDK submit/poll flow has real wire proof
using scoped capabilities in the same dedicated trial store; an independent
customer-account store remains untested.
The deployed pilot UI uses our dedicated private Blob store. No Transloadit account is required; its adapter remains an optional extension.

Canonical research artifact, read-only external evidence:
`/home/arista/src/hermes/docs/html/vercel-opportunity-decision-20260930.html`.
This is an immutable planning input dated 2026-09-30, not a sibling runtime
dependency. The repository's [source ledger](research/SOURCES.md) records the
claims used here without copying the HTML or its operational state.

Local decisions and dependencies use [Wayfinder](wayfinder/MAP.md). No external
issue tracker is configured or required.

Current milestone: the shared contract, independent baseline and candidate adapter,
deterministic comparative validation and local Next.js portal are implemented.
[Results](docs/results.md) records the measured outcome and verification limits.
The `/local` portal uses an explicit fixture provider with no actual scanning or cloud calls.
The deployed `/pilot` uses private Blob, shared Postgres and the managed ClamAV
scanner, with bounded [live proof](evidence/managed-live.json). Pilot access is operator-provisioned, with
no automated signup or customer billing.
Local SQLite persists state and uploaded bytes; it is not a persistence solution
for serverless deployment. The local portal uses an illustrative server-owned session. The deployed pilot
uses operator-provisioned authenticated keys and sessions, with application
membership management remaining a separate customer concern.

Real private Blob access and shared Neon persistence have been verified.
Managed ClamAV execution and the deployed acceptance journey passed a bounded
synthetic trial: clean 5 MiB upload, compressed-PDF harmless EICAR rejection,
missed-callback poll recovery, tenant isolation and digest mismatch denial.
[Automatic worker proof](evidence/worker-service-live.json) verifies one daemon
scan; [browser evidence](evidence/browser-rendered.json) records desktop/mobile
docs and invalid-key login inspection. These are not uptime, throughput, general
detection or independent customer-store certification.
Buyer demand, pricing and organic AI recommendation outcomes remain unproven. A fixture result cannot establish them.
Public documentation/example publication and Vercel deployment are now
authorized under D005. The user selected SDK plus our managed scanner under D008. No paid
business, detection certification or organic recommendation outcome is established. Follow [README setup](README.md#run-locally) for local execution and
compiled production HTTP smoke validation.
