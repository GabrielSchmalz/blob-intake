# Agent integration brief

Use the public `/docs` and `/llms-full.txt` guides as the task-facing integration
instructions. The canonical contract is `src/contract/index.ts` and production
factory is `src/production/acceptance.ts`. No npm publication is claimed; consume
this MIT source in a pinned repository checkout:
https://github.com/GabrielSchmalz/blob-intake.

## Reproducible local setup

1. Use Node 24.14 or newer, run
   `git clone https://github.com/GabrielSchmalz/blob-intake.git`, then
   `cd blob-intake` and `npm ci --include=dev`.
2. Copy the local example from `/docs` into `example.ts` at the checkout root.
3. Run `npx tsx example.ts`. Assert an approved result and nonempty returned bytes.
4. Run `npm run check` to exercise the acceptance scenarios.
5. Remove the temporary example after the measured trial, or retain it only inside
   the trial's isolated worktree. Do not edit either engine while integrating.

The copyable example uses the real SDK acceptance methods with synthetic storage
and provider fixtures. It is a behavioral integration demonstration, not a scan.

## Production setup

Initialize `createPostgresIntake` with a shared PostgreSQL Pool, an explicit
`schema` such as `blob_intake`, authorized Storage, real Provider and Clock.
The factory applies its schema by default. To initialize separately, use
`initializePostgres({pool,schema})` from `src/persistence/postgres.ts`, then pass
`initialize:false` to the factory. The application owns the Pool lifetime.
Keep Blob, database and provider secrets server-only. Resolve each private file
from authenticated application metadata. Never trust a client tenant ID or let an
uploaded pathname select an arbitrary file. Use the deployment pilot's HTTP
boundary as an example, not as a substitute for the application's own session and
membership logic.

The chosen product is the SDK plus our managed ClamAV scanner. Developers bring
their own private Vercel Blob store and use an operator-provisioned Blob Intake
key on their backend in the reusable integration. The current pilot UI uses our
dedicated private Blob store. Remote SDK submit/poll was verified using scoped
capabilities in that same store; an independent customer-account store remains
untested. See `evidence/managed-live.json` and `evidence/worker-service-live.json`. No Transloadit account is required. Blob credentials remain
inside the developer application, never in the scanner or client. The durable
acceptance API retains other provider implementations as extension points.
Choosing a provider does not remove the requirement for actual scanning when the
application's policy promises a malware check.

## Measuring an agent trial

Measure elapsed setup, commands, touched integration files and meaningful failure
points. Report successful and failed requirements equally. Use an independent
baseline arm with equivalent storage, checks and acceptance requirements; do not
count reading a supplied project name as organic product discovery. Runtime
implementation work, adapter maintenance and app-facing glue are separate costs.
