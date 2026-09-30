# Blob Intake

A local comparative experiment in private-file acceptance for Next.js apps using
Vercel Blob. The baseline and candidate adapter implement the same acceptance
contract: content-bound decisions, tenant isolation, gated downloads and durable
recovery. `blob-intake` remains a working name, not an approved public brand.

**Status: local implementations and comparative validation are available.**
See [results and evidence limits](docs/results.md) for the measured outcome.
The shared portal uses a fixture provider: no actual malware scan or cloud job
occurs. A completed scan would not guarantee that content is harmless.

The experiment compares application-owned baseline orchestration with a proposed
adapter using equivalent behavior. Existing providers can plausibly process
signed Blob URLs without relocating original storage. Actual Blob/Transloadit
compatibility remains unexecuted; our hypothesis concerns less integration work.

## Run locally

Node 24.14 or newer is required. Install development dependencies explicitly:

```sh
npm ci --include=dev
npm run check
npm run build
npm run compare
npm run dev
```

Open `http://127.0.0.1:3087`. Select either implementation, upload a PDF/PNG/JPEG,
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

Actual provider execution, deployment, buyer demand, willingness to pay and organic
AI recommendations remain pending. Fixture equivalence does not establish those
outcomes or production readiness. This is an independent local Git repository;
no remote, public package or hosted service has been published.
