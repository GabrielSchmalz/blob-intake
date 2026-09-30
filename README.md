# Blob Intake

A local comparative experiment in private-file acceptance for Next.js apps using
Vercel Blob. The baseline and candidate adapter implement the same acceptance
contract: content-bound decisions, tenant isolation, gated downloads and durable
recovery. `blob-intake` remains a working name, not an approved public brand.

**Status: acceptance SDK, shared Postgres workflow and integration guides implemented.**
See [results and evidence limits](docs/results.md) for the measured outcome.
The `/local` portal uses a fixture provider; it performs no malware scan. The
`/pilot` app uses authenticated private Blob uploads and shared Postgres metadata.
Its scanner backend is not configured yet, so submissions fail closed. A completed
scan would not guarantee that content is harmless.

The experiment compares application-owned baseline orchestration with an SDK
using equivalent behavior. Transloadit is an optional provider, not a mandatory
developer account. Hosted or self-hosted scanners can implement the same Provider
contract. Real private Blob access and shared Neon persistence have been verified;
actual malware scanning and the deployed acceptance journey are still pending.

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
[Neon proof](evidence/neon-contract.json), and [pilot operations](docs/pilot.md).

Buyer demand, willingness to pay and organic AI recommendations remain unproven.
A fixture pass does not establish those outcomes or production readiness.
