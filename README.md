# Blob Intake

An early SDK plus managed ClamAV scanner for private-file acceptance in Next.js
apps using your own Vercel Blob store. The baseline and candidate adapter implement the same acceptance
contract: content-bound decisions, tenant isolation, gated downloads and durable
recovery. `blob-intake` remains a working name, not an approved public brand.

**Status: SDK, shared Postgres and managed ClamAV pilot verified in a bounded live trial.**
See [results and evidence limits](docs/results.md) for the measured outcome.
The `/local` portal uses a fixture provider; it performs no malware scan. The
`/pilot` app uses authenticated private Blob uploads and shared Postgres metadata.
The scanner runs ClamAV 1.5.4. Live tests verified a clean 5 MiB upload, rejection
of a harmless EICAR test pattern embedded in a compressed PDF, missed-callback
poll recovery and authorization/content-binding denials. A completed scan does
not guarantee that content is harmless.

The experiment compares application-owned baseline orchestration with an SDK
using equivalent behavior. The selected product combines the SDK with our managed ClamAV scanner. Developers
use their Vercel Blob store and a server-only Blob Intake key; no Transloadit
account is required. The Provider contract remains an extension point. Real private Blob access and shared Neon persistence have been verified;
the deployed acceptance journey and remote SDK submit/poll were exercised with
real scanning. This small trial is not a reliability or detection certification.

## Integration and pilot access

Public guide: https://blob-intake.vercel.app/docs. MIT source:
https://github.com/GabrielSchmalz/blob-intake. The source SDK is supported; there
is no published npm package. Pilot keys are operator-provisioned. Automated
signup and customer billing are not yet available.

Keep the Vercel Blob read/write token in your application backend. The managed-scanner adapter targets a short-lived exact-path signed Blob URL
and content digest, authenticated with a server-only Blob Intake key. This
remote SDK flow was verified using scoped signed access in the same dedicated
trial store. An independent customer-account Blob store was not tested. The
current `/pilot` UI uses our dedicated private Blob store. Never give the scanner your Blob store credentials. Shared PostgreSQL
records bind each result to a tenant and immutable content; downloads still pass
application authorization and content checks. See [live managed workflow](evidence/managed-live.json) and
[automatic worker proof](evidence/worker-service-live.json) for exact checks and
cleanup.

The pilot worker checks an idle queue every 600 seconds so the free Neon database
can autosuspend. Processing can start up to 10 minutes after submission; an active
backlog is processed more frequently. No scan-throughput guarantee is offered.
Use `reconcileFor(context)` in authenticated application routes; global
`reconcile()` belongs only to trusted operator or cron jobs.

## Run locally

Node 24.14 or newer is required. Install development dependencies explicitly:

```sh
npm ci --include=dev
npm run check
npm run build
npm run compare
npm run dev
```

Open `http://127.0.0.1:3087/local`. Select either implementation, upload a PDF/PNG/JPEG,
and simulate clean, threat or outage results. Approval gates downloads; outage
supports retry. The interface labels its illustrative server-owned session and
fixture controls. See [local portal](docs/local-portal.md) for details.

To exercise the compiled production HTTP boundary, stop the development server
and run `npm start` in one terminal. In another terminal, run:

```sh
npm run smoke
```

SQLite files and uploaded bytes stay in the ignored local `runtime` directory.
This persistence is intended for the local experiment; it is not serverless
persistence suitable for Vercel deployment. The portal has illustrative local
authority, not production authentication. Keep it bound to loopback.

## Evidence and next decisions

- [Results and evidence limits](docs/results.md)
- [Project context](CONTEXT.md)
- [Wayfinder map](wayfinder/MAP.md)
- [Comparative experiment specification](specs/comparative-experiment.md)
- [Sources and evidence limits](research/SOURCES.md)
- [Resume point](wayfinder/RESUME.md)

Public integration documentation lives at `/docs`, with machine-readable guides
at `/llms.txt` and `/llms-full.txt`. Source consumption is documented under MIT;
there is no npm package release. See [launch map](wayfinder/MAP.md),
[agent measurement](evidence/agent-setup.json), [real Blob trial](evidence/blob-live.json),
[Neon proof](evidence/neon-contract.json), [managed live proof](evidence/managed-live.json),
[automatic worker proof](evidence/worker-service-live.json),
[rendered browser checks](evidence/browser-rendered.json), and
[pilot operations](docs/pilot.md).

Buyer demand, willingness to pay and organic AI recommendations remain unproven.
A fixture pass does not establish those outcomes or production readiness.
