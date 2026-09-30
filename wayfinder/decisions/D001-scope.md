# D001: Experiment destination and scope

Status: resolved for planning. Date: 2026-09-30.

Choose a bounded Blob Intake experiment because it most directly connects to
Vercel and admits a fair integration comparison. This is not a commercial win.

First implementation target: Next.js App Router example, private Vercel Blob,
Transloadit as the single BYO processing provider, PDFs/PNG/JPEG, proposed 20 MiB
maximum, actual-type checks, scan outcome and durable recovery. Both comparison
arms use identical checks and provider configuration.

The app owns users, tenant membership, upload quotas, business approval and file
delivery. The proposed integration owns processing job metadata and recovery.
Provider credentials remain in the owning server boundary. No client stores a
Blob read/write token; external processing uses scoped temporary file access.

Repository setup and planning are authorized. Implementation, paid jobs, remote
publication, outreach and deployment have not been performed or authorized by
this setup request. No new external tracker is necessary.

Excluded first version: scan engine operations, archives, office/video formats,
OCR, image previews, generic storage adapters, billing and a hosted dashboard.
Do not add these to make the benchmark look compelling.

Consequences: the work can be abandoned cheaply after comparison. Workflows for
CSV, customer credits, PDF rendering and notifications are separate candidates.
