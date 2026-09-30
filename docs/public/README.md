# Public documentation surface

The public entry point is `/`; the integration guide is `/docs`. `/llms.txt` links
agent-facing material, and `/llms-full.txt` serves the same operational guide as
plain text. `app/docs/content.ts` owns the copyable examples and machine-readable
guide. `app/docs/page.tsx` owns the human-readable presentation.

`BLOB_INTAKE_PUBLIC_URL` controls canonical sitemap and agent-index link origins.
The verified public primary origin is `https://blob-intake.vercel.app`. The public pilot is `/pilot`, owned by the production
HTTP implementation. `/local` retains the existing fixture UI and is excluded
from indexing; its API mutations independently reject external origins.

The public MIT source is https://github.com/GabrielSchmalz/blob-intake. The guide
and agent index link the repository explicitly and include clone/install commands.

These surfaces describe an early MIT source integration. They claim no published
npm package, scanner certification, customer demand or organic AI recommendation.
Provider costs, coverage and retention remain provider-dependent.

The user selected SDK plus our managed ClamAV scanner. Public copy distinguishes
the current central-store pilot from the reusable customer-store adapter, which
requires separate live verification. Pilot access is operator-provisioned; signup
and billing are not automated. No Transloadit account is required.
