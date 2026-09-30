# Candidate integration

The application imports `createCandidate` from `src/candidate/index.ts`. This
six-line integration wrapper delegates to `createIntake` in `src/adapter`.
The wrapper reduction packages complexity; SDK internals are reported separately
and remain part of total maintained complexity.

Run the same 14 contract scenarios with:

```sh
npx tsx --test tests/candidate.test.ts
```

The shared local UI is another runnable integration. At a server-side application
boundary, assemble the dependencies and run the Effect:

```ts
import { Effect } from "effect";
import { createCandidate } from "./src/candidate/index";

// Implement these using the application's authenticated ownership lookup,
// private-object storage and authenticated provider adapter.
const app = await Effect.runPromise(createCandidate({
  databasePath: "/durable-local-data/intake.sqlite",
  storage,
  provider,
  clock: { now: Date.now },
}));
const context = await authenticateAndAuthorizeRequest(request);
const job = await Effect.runPromise(app.register(context, applicationFileId));
await Effect.runPromise(app.submit(context, job.jobId));
```

`context` must come from the authenticated backend. Storage must independently
check current membership and ownership on every read; request JSON is insufficient.
Only the provider's authenticated callback verification yields an event. Callback
processing checks current storage bytes before atomically recording the event and
state transition. Delivery again checks authorization, the content digest, declared
MIME and the pinned `pdf-images-v1` policy. Registration dedupes exact bytes plus
declared MIME and policy version. Restoring exactly the original bytes and valid
metadata can reuse the original approval; this is digest identity rather than an
irrevocable object-version ledger.

Invoke `app.reconcile()` from a worker or the local UI. It discovers processing and
failed attempts whose persisted update time is at least 60 seconds old, polls
stable attempt IDs, and verifies current bytes and attempt identity. Retrying an
eligible failure creates a new persisted attempt; old callbacks cannot approve it.
Close the app with `Effect.runPromise(app.close())` during server shutdown.

## Boundaries

SQLite is real durable local persistence for the experiment. A local filesystem
is **not durable shared storage for Vercel serverless deployments**. Production
requires a transactional shared database and an authenticated scheduled worker.
No automatic background process or hosted service is started by this package.

Magic checks recognize PDF, PNG and JPEG signatures and enforce 20 MiB. They do
not parse complete documents or prove content harmless. Provider scan compatibility
and actual private Blob execution are separate, pending evidence. No paid request,
credential provisioning or deployment is performed by the contract fixtures.

The stable attempt is persisted before external submission. Concurrent submissions
claim it transactionally and avoid duplicate calls from this application. Recovery
polls the provider by that attempt; it does not assume exactly-once execution. A
provider lacking durable attempt lookup cannot recover a lost submission receipt
without a separate receipt/association store. A process crash before handoff can
leave a pending attempt unresolved until explicit operator recovery.

The application retains authentication, business approval and customer-facing
errors. Terminal contradictions remain inaccessible with `conflict`; this prototype
requires operator resolution rather than automatically choosing a winning event.
Old versions and event metadata have no cleanup policy implemented. No raw bytes,
signed URLs or provider secrets are written to the intake metadata tables.
