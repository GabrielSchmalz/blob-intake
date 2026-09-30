# D002: File acceptance and recovery contract

Status: resolved for planning; implementation pending. Date: 2026-09-30.

`approved` means the configured type/size checks and scan completed without
detecting a prohibited result, for one exact content version. It is not a promise
of harmless content, business approval or unrestricted file access.

Persist a job before provider submission. Bind it to application-assigned tenant,
owner, file ID and an immutable object version or verified content digest. A URL,
client filename, claimed MIME type or client-supplied tenant ID is insufficient.
The fixture contract uses a digest; W002 must determine actual Blob immutability
and overwrite/version behavior before adopting a production identity scheme.

States: pending -> processing -> approved/rejected/failed. `rejected` requires a
specific policy/check result. `failed` records inability to obtain a valid result;
it is inaccessible and may reconcile into a terminal result for the same attempt.
Recovery/retry creates an explicit attempt identity. A late event from an earlier
attempt cannot approve a newer attempt or changed object. Approved/rejected
results are immutable for that attempt; contradictory events are recorded as a
conflict, keep access closed and require reconciliation. Replacing content creates
a new job and revokes eligibility based on the previous result.

Only the app's authenticated backend establishes tenant authority and ownership.
The delivery path checks both current authorization and the matching successful
job. Never expose a source signed URL through status or logs. Provider response
content and callbacks are externally validated; callbacks must authenticate
provider identity before state changes. Verification failure has no effects.

Store event identity and transitions atomically. Duplicates and out-of-order
events cannot repeat application business actions or downgrade a terminal result.
No exactly-once external side-effect promise: integrations expose stable event
IDs, use durable outbox/receipts where needed, and document customer idempotency.

Poll provider job identity for lost events/timeouts. Unknown provider outcome,
expired file access, provider outage and missed event never yield approval.
Reconciliation checks the current tenant/file/content/attempt binding. Cleanup
and retention cannot erase evidence required to resolve an active job.

Metadata fields and retention are part of the experiment contract. Signed URLs,
credentials and raw bytes are excluded from logs. Retention configuration cannot
claim control over provider internals; verify those separately before real data.
