# Public documentation surface

The public entry point is `/`; the integration guide is `/docs`. `/llms.txt` links
agent-facing material, and `/llms-full.txt` serves the same operational guide as
plain text. `app/docs/content.ts` owns the copyable examples and machine-readable
guide. `app/docs/page.tsx` owns the human-readable presentation.

`BLOB_INTAKE_PUBLIC_URL` controls canonical sitemap and agent-index link origins.
The provisional default is `https://blob-intake.vercel.app`; deployment evidence
must verify its actual alias. The public pilot is `/pilot`, owned by the production
HTTP implementation. `/local` retains the existing fixture UI and is excluded
from indexing; its API mutations independently reject external origins.

These surfaces describe an early MIT source integration. They claim no published
npm package, scanner certification, customer demand or organic AI recommendation.
Provider costs, coverage and retention remain provider-dependent.
