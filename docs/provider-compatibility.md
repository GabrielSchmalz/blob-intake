# Provider compatibility, 2026-09-30

These adapters implement documented wire behavior and pass injected, offline tests.
No Transloadit Assembly, Blob store, customer upload, or credentials were used.
Real provider execution and deployed reliability remain pending.

## Modules and composition

- `src/integrations/vercel-blob.ts`: pinned `@vercel/blob` 2.8.0 `get`,
  `issueSignedToken`, and `presignUrl` API declarations are the implementation
  authority. The application must supply authenticated `resolve(context,fileId)`
  and backend-only `resolveSource(tenantId,fileId)` functions. They resolve an
  exact immutable private pathname and expected SHA256 digest from app metadata,
  never directly from upload JSON. `resolveSource` must enforce service tenant
  access independently; no synthetic user identity or bypass is provided.
- `src/integrations/transloadit.ts`: accepts injected fetch, scoped-source
  resolver, clock and registry. Supply `blob.source` from the Blob integration.
- `src/integrations/assembly-registry.ts`: SQLite persistent registry for a
  single-host local app, with explicit close. Keep its database/directory private.
  The registry stores only attempt, assembly, tenant, file and digest identifiers.
  Submit returns the opaque local attempt receipt, never the raw Assembly ID.
  Assembly IDs themselves are secret status capabilities. Do not return them to
  unauthorized clients. This registry is not a serverless production database.

The application can pass `blob.storage` and the provider to either experiment
arm through the shared dependency contract. The demo deliberately uses fixtures.
A provider-compatible configuration must be selected explicitly outside that demo.
The provider receives the signed source URL; it is never logged or written into
our registry. Private Blob credentials remain in the Blob adapter boundary.

## Documented requests and results

[Authentication](https://transloadit.com/docs/api/authentication/) specifies
multipart `params` as the exact JSON string signed with prefixed SHA384 HMAC for
new keys. [Assembly creation](https://transloadit.com/docs/api/assemblies-post/)
specifies `notify_url`, random nonce and `quiet`. The pipeline is HTTP import →
file verify → virus scan → full SHA256 hash. HTTP import sets `max_file_size` to 20 MiB as documented by the
[import Robot](https://transloadit.com/docs/robots/http-import/), bounding a
source replaced after the local snapshot. Named verification, scan and hash
steps request results explicitly. Verification and scanning use
`error_on_decline:true`, no ignored errors, and PDF repair is disabled to keep
content immutable. Interpolation is disabled for the source URL.

Approval requires `ASSEMBLY_COMPLETED`, no error or ignored errors, exactly one
result in each named check, matching `original_id` and supported MIME type,
and `hashed[0].meta.hash` equal to the app's digest. Missing/partial/ambiguous
results remain unknown. Error responses conservatively become failed/outage,
rather than guessing that a generic Robot error specifically means malware.

[Webhooks](https://transloadit.com/docs/api/webhooks/) are form-urlencoded.
The framework adapter must extract the untouched `transloadit` field as `body`
and `signature` field separately. The signature is **unprefixed HMAC-SHA1** of
that exact string, unlike Assembly request authentication. Verification precedes
JSON/schema parsing, checks lowercase hex length, and compares timing-safely.
A known server-side Assembly binding is mandatory. Untrusted payload fields do
not select credentials or override an attempt. Additive wire fields are ignored.

Polling constructs a fixed `https://api2.transloadit.com/assemblies/{id}` URL,
never follows a returned status URL, and refuses redirects. This documented GET
uses the Assembly's secret capability ID, not a fabricated query-signature flow.
[Status endpoint](https://transloadit.com/docs/api/assemblies-assembly-id-get/),
[matching results](https://transloadit.com/docs/api/assembly-status-response/).
All external calls have abort-aware timeouts. Status payloads are bounded to
1 MiB; private Blob streams are bounded to the contract's 20 MiB file maximum.

## Real-provider checks still required

1. Signed private Blob URLs must work with HTTP import, including TLS hostname,
   redirect handling, expiry and provider queue latency. The adapter scopes GET
   to one pathname for 15 minutes; it refuses sources with less than one minute
   remaining, which is a defensive floor, not proven queue compatibility.
2. Confirm the exact result MIME, original_id and full-hash fields for PDF, PNG
   and JPEG. The parser intentionally fails closed on unexpected shapes.
   [File verify](https://transloadit.com/docs/robots/file-verify/),
   [virus scan](https://transloadit.com/docs/robots/file-virusscan/),
   [file hash](https://transloadit.com/docs/robots/file-hash/).
3. Verify benign/EICAR behavior, rejection, missing results, interrupted jobs,
   callback ordering, retries and polling with an authorized account and budget.
4. A crash after Assembly creation but before registry save may leave an orphan
   and a retry may create duplicate billable work. Stable attempt IDs deduplicate
   only already-saved bindings; this code does not claim provider exactly-once
   creation. A production design needs a verified supplied-ID/recovery strategy.
5. This verifier accepts one configured Auth Secret. Key rotation and historical
   notification/replay secrets require an explicitly trusted keyring. It never
   obtains keys from unverified JSON. Current docs describe replay-key nuances.
6. `notification_payload:["without_params","without_uploads"]` keeps source
   instruction URLs out of normal callback bodies. Provider status capabilities
   may still expose params and output URLs. Neither filters nor absence of an
   export step establish deletion, zero retention, region or residency guarantees.
   Validate provider retention/terms before customer data.

[Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk),
[signed URLs](https://vercel.com/docs/vercel-blob/vercel-signed-urls).
Immutable app metadata and rehashing on every delivery are necessary even with
scoped URLs; a pathname must never be overwritten as a way to reuse approval.
