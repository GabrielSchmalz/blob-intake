# D001: Experiment destination and scope

Status: historical local experiment decision; launch scope superseded by D005
and scanner backend by D008. Date: 2026-09-30.

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

Repository setup, local implementation/comparison and ordered scoped commits
are authorized by subsequent user instructions. This local milestone is complete.
Paid jobs, remote publication, outreach and deployment remain unexecuted and
outside that scope. No new external tracker is necessary.

Excluded initial local version: scan engine operations (now authorized as the
isolated managed ClamAV boundary in D008), archives, office/video formats,
OCR, image previews, generic storage adapters, billing and a hosted dashboard.
Do not add these to make the benchmark look compelling.

Consequences: the work can be abandoned cheaply after comparison. Workflows for
CSV, customer credits, PDF rendering and notifications are separate candidates.
