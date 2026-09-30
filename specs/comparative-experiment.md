# Comparative experiment: private file acceptance

Version: local experiment v1, 2026-09-30. Local implementation complete.
Evidence and limits: [results](../docs/results.md). Real-provider execution pending.
Canonical scope: [D001](../wayfinder/decisions/D001-scope.md).
Canonical behavior: [D002](../wayfinder/decisions/D002-acceptance-contract.md).
Canonical scoring: [D003](../wayfinder/decisions/D003-comparison-and-gates.md).

## Question and arms

Does the proposed adapter materially reduce app-specific integration work while
matching a competent documented Blob + Transloadit implementation?

Baseline A: ordinary Next.js app implements upload registration, processing jobs,
callback validation, persistence, reconciliation and authorized file delivery.
Candidate B: same app uses the proposed package for processing/persistence/recovery,
with application authentication/ownership/delivery checks remaining explicit.

Both use identical Next.js version, app shell, database capabilities, test files,
provider type/size/scan configuration and storage region where applicable. Pin
versions at implementation time. Use one provider/account configuration and do
not claim superiority by assigning weaker checks to A. Allow reasonable baseline
helpers and official examples. Share fixtures and assertions, not candidate logic.

## App contract

- Register: authenticated tenant/user context plus app file ID; server resolves
  the private object and content identity. Returns job ID and pending status.
- Submit: persist provider attempt/job association before handing over scoped
  source access. Repeated registration uses a stable idempotency key scoped to
  tenant, file and content version; another tenant cannot deduplicate into it.
- Status: authenticated same-tenant lookup returns state/check reason and attempt
  metadata, never source URLs or credentials.
- Callback: authenticate and externally validate event; transactionally record
  identity and permitted state change. Unknown job/attempt has no acceptance effect.
- Reconcile: a scheduled or explicitly invoked worker polls overdue provider jobs;
  verify current content/attempt bindings before applying outcomes. A process
  restart must not lose overdue work. Prototype can invoke worker manually.
- Deliver: recheck current tenant membership, content identity and approved result
  before server-side retrieval or issuing scoped temporary download access.
  Replacement revokes the old decision; business approval may add another gate.

Persist tenant/user/file/content ID, policy version, job/attempt/provider ID,
timestamps, state/check results, event identities and recovery schedule. Provider
secrets and short-lived access URLs are not durable job/log fields. Persist a safe
failure code rather than arbitrary provider text containing sensitive data.

File limits proposed: PDF, PNG, JPEG; 20 MiB maximum. Validate actual bytes/type,
not filename or declared MIME. The same accepted format constraints apply to both
arms. Where provider result semantics are unknown, mark the job inaccessible and
record a compatibility question rather than inventing approval.

## Required scenario manifest

| ID | Stimulus | Required outcome |
| --- | --- | --- |
| S01 | Valid PDF/image, completed checks | Same content approved; authorized access succeeds |
| S02 | Disallowed actual type/oversize/mismatch | Rejected with check reason; no downloadable approval |
| S03 | Provider reports detected threat | Rejected; no approval; test uses local fixture until real test authorized |
| S04 | Timeout/outage/unknown result | Failed or unresolved processing; inaccessible; eligible reconciliation |
| S05 | Duplicate authenticated event | One state effect; stable receipt; no duplicate business action |
| S06 | Forged/malformed callback | No state effect; safe observable error |
| S07 | Lost callback after completed job | Polling resolves exact attempt; same terminal result |
| S08 | Expired source signed URL | Inaccessible failure; bounded retry/recovery; no implied scan success |
| S09 | Late event from previous attempt | Cannot approve current attempt; event recorded/ignored safely |
| S10 | Replace content after approval | Previous decision invalid; new content inaccessible pending checks |
| S11 | Different tenant guesses file/job/URL | Registration, status and download deny unauthorized access |
| S12 | Crash between submit/receipt or state/delivery | Durable identity enables reconciliation; no duplicate approval action |
| S13 | Contradictory results for one attempt | Conflict keeps access closed; reconciliation required |
| S14 | Restart worker with overdue work | Work rediscovered from durable metadata; unknown remains inaccessible |

For S12, document provider submission idempotency/recovery capabilities. If a
provider can create duplicates after a lost submission response, report that
limitation and its cost; do not imply exactly-once provider execution.

## Measurements and scoring

Record active setup time from an identical starting app to all local scenarios
passing, excluding waits but listing them separately. Distinguish first author
build time from fresh developer integration time. Run order creates familiarity
bias; use a fresh integrator or swap order for a second attempt when practicable.
With one integrator, label measurements exploratory.

Inventory maintained app-specific integration files/lines, excluding shared app
shell, fixtures, generated files and lockfiles. Count required configuration and
baseline custom helpers; report candidate SDK implementation separately. Record
number of accounts, secrets, persistence/worker setup, and ongoing operational
responsibilities. Exclusion rules must be identical across arms and set before
scoring, not changed to improve a result.

Reduction = `(baseline - candidate) / baseline`; report undefined if baseline is
zero. Gate 1 requires behavior equivalence and proposed >=50% reduction in either
app-specific integration code or active setup time. Report the other metric and
total complexity too. Failure leads to simplify-to-template or stop, not a feature
expansion to rescue the outcome.

## Evidence package and remaining boundaries

Produce a dated results note with pinned versions, setup ledgers, inventory rules,
scenario outcomes, redacted fixture metadata, metrics and limitations. Store no
signed URLs, credentials, raw customer documents or private provider receipts in
Git. Use synthetic files, local fixtures and sanitized summaries.

Stages: local mock equivalence -> authorized real Blob/provider compatibility ->
separately authorized deployment behavior -> buyer/agent validation. Each stage
retains its own pending/pass/fail status; a local pass does not complete later ones.
No priced provider or model batches, publication or outreach in the planning setup.
