# Baseline A: ordinary application implementation

The baseline owns its SQL tables, transition handling, file validation and recovery
inside `src/baseline/index.ts`. It imports contract types, not candidate logic.
It uses the same authenticated application context and injected storage/provider
as the candidate. This is a competent local implementation, not a deliberately
incomplete competitor.

## Local setup

Use the pinned Node 24 runtime and `npm ci`. Construct `createBaseline` with a
writable SQLite database path, authenticated storage adapter, provider adapter,
and clock. Run its returned Effect at the application boundary. SQLite uses WAL
and immediate transactions; a stable local filesystem must retain its database,
WAL and shared-memory files across restarts. Call `close` when shutting down.

Run `npx tsx --test tests/baseline.test.ts` for the shared scenario manifest.
The synthetic fixture provider authenticates callbacks locally and lets tests
control lost receipts, outages, threats and conflicting terminal events. These
results prove the local state/recovery contract, not paid provider compatibility.

## Application responsibilities

The backend supplies tenant/user context after authentication, implements storage
ownership checks, schedules `reconcile`, invokes explicit `retry`, and routes
signed callbacks through `callback`. Registration reads authoritative bytes and
checks PDF/PNG/JPEG signatures, claimed MIME and the 20 MiB limit. Signature
checking identifies the format; it does not prove the entire document is valid.
SHA-256 binds a decision to exact bytes. Delivery reads authorized current bytes
and checks the matching approved digest before returning those same bytes.

The job/attempt association commits before external submission. Concurrent
submissions claim one pending job transactionally. A lost provider receipt leaves
the persisted attempt available for polling instead of blindly resubmitting.
This does not promise exactly-once provider execution: a real provider must expose
recovery by that attempt identity, or the integration must durably resolve it.
Retries explicitly create another attempt; older events cannot approve it.
Callback identity and transition commit together. Contradictory terminal results
close access and remain conflicted across polling and restarts.

## Production and external compatibility still pending

SQLite here is durable on a persistent single-host filesystem. An ephemeral Vercel
function filesystem is not a production database. Production needs a database
with equivalent transaction/uniqueness guarantees, separate worker scheduling,
and verified deployment behavior. No deployment is represented by this setup.

A real Blob/Transloadit run requires separately authorized credentials, budget,
callback origin and tests of signed source access, exact scan result semantics,
provider retry/recovery capabilities and retention. No paid requests or private
files were used to validate the baseline. See the integration compatibility
notes for the remaining provider-specific checks.
