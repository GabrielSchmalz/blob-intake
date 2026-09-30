# Shared Postgres persistence

`src/production/acceptance.ts` exports `createPostgresIntake`. It implements the
same `AcceptanceApp` contract as the local candidate, with shared durable metadata
rather than local SQLite. Original files remain in private Vercel Blob.

```ts
import pg from "pg";
import { Effect } from "effect";
import { createPostgresIntake } from "../src/production/acceptance";
import { createPostgresAssemblyRegistry, initializePostgres } from "../src/persistence/postgres";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const options = { pool, schema: "blob_intake" };
await Effect.runPromise(initializePostgres(options));
const registry = createPostgresAssemblyRegistry(options);
// Compose registry into the real provider; compose app-authorized Blob storage.
const app = await Effect.runPromise(createPostgresIntake({
  ...options, storage, provider, clock: { now: Date.now }, initialize: false,
}));
```

`storage` and `provider` above are application-owned contract implementations,
not globals exported by this module. Run Effects at your route, job or script
boundary. Initialization is also automatic when `initialize` is omitted, but
production requests should use already-initialized schema and `initialize: false`.
Concurrent initialization across function instances holds a dedicated migration
advisory lock on one transaction connection, preventing schema/index DDL races.
Pool lifecycle belongs to the application. `app.close()` does not end a shared
pool while other requests use it. The schema name must match
`^[a-z][a-z0-9_]{0,62}$`; no raw schema identifiers enter SQL.

## Schema and invariants

Initialization creates jobs, current-file pointers, attempts, applied events,
ignored-event audit fingerprints, private provider bindings and uploaded-file
manifests. Job and event payloads are JSONB, decoded through Effect Schema at the
persistence boundary. A registration identity pins digest, declared type and
policy version. A current pointer additionally binds tenant and application file.

Per-tenant/file transaction advisory locks serialize registration, submission
claims, invalidation, retry and callback application across independent function
instances. Callback application additionally serializes by event ID before taking
the file lock, so replay collision checking is atomic even across files. Database
constraints enforce unique registration identities, attempt IDs, event IDs,
manifest paths and assembly bindings. Transaction locks only cover metadata:
Blob reads and provider submissions/polls execute outside transactions. Submission
claims commit before the provider call, preventing duplicate local handoffs.

Access still requires current application authorization and content validation.
Unknown checks, content changes, contradictory terminal verdicts and inaccessible
storage never permit delivery. Recovery remains explicit. `app.reconcile()` is global and must be invoked only
by an authenticated scheduler or trusted operator job. The production factory
also returns `reconcileFor(context)`, filtering exact tenant and stored owner
before any storage read or provider poll. Use this scoped method for ordinary
authenticated application requests. Reading status alone need not reconcile.

## Application file manifests

`createPostgresFiles(options)` returns these Effect operations:

- `storePendingFile(context, { fileId, pathname, name, declaredType })`
- `getOwnedFile(context, fileId)`, returning `HostedFile | null`
- `resolveSource(tenantId, fileId)`, for trusted service processing only
- `completeFile(context, fileId, digest, jobId | null)`
- `listOwnedFiles(context)`

`HostedFile` includes file ID, tenant ID, user ID, exact private pathname, display
name, declared type, nullable digest/job ID and creation time. Pending files have
no digest/job binding. Read Blob bytes on the backend and calculate SHA-256 before
pinning the digest. The browser's claimed digest is never authoritative. Register
the acceptance job afterward, then persist its job ID. Digest and non-null job ID
cannot be replaced. `completeFile(..., digest, null)` followed by the same digest
and actual job ID supports this sequence idempotently.

Manifest ownership checks are deliberately stricter than the generic contract:
the pilot requires exact tenant and user ownership. A customer application can
replace its manifest resolver with explicit organization membership authorization.
Provider assembly IDs remain private capabilities. Only opaque attempt receipts
are returned through the public acceptance status.

## Verification

`tests/postgres.test.ts` runs the unchanged 14 contract scenarios against a real
Postgres database when `BLOB_INTAKE_TEST_DATABASE_URL` is set. It additionally tests
independent-pool concurrent handoff/callbacks, restart durability, terminal conflict
preservation, immutable manifests, assembly binding collisions, concurrent migration
initialization and tenant/owner-scoped recovery. Each test uses
an isolated `blob_intake_test_*` schema and drops that schema afterward. Never point this
suite at a role that cannot create/drop isolated test schemas or at an unrelated
database without authorization.

Without the environment variable, database-dependent tests are explicitly skipped;
the schema identifier validation test still runs. A skipped suite is not live
persistence evidence. Use a private environment-loading script, rather than putting
a credential-bearing connection URL in command arguments or saved logs.

## Limits

This first shared implementation has no customer signup, schema migration framework,
data retention worker or provider submission orphan repair. JSONB reconciliation
queries scan eligible job metadata and will need dedicated state/timestamp indexes
and bounded batches at larger volume. Fetching and hashing bytes remains bounded by
the 20 MiB policy. Provider network failures and lost callbacks fail closed; a lost
submission response before the private assembly binding is saved remains the
provider-specific orphan window documented in `provider-compatibility.md`.
