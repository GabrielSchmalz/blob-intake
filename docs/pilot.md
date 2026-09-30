# Authenticated Vercel pilot

The `/pilot` client uploads directly to private Vercel Blob. The Next server owns
immutable UUID pathnames, owner/tenant metadata and durable Postgres acceptance
state. File downloads require a fresh authorization, digest and policy check,
then return an exact-path private GET capability valid for at most 60 seconds.
The signed URL is delivered only to the authorized client, never in status/logs.
The application does not proxy a 20 MiB download through Vercel's response limit.

Required private environment configuration:

- `DATABASE_URL`: shared Postgres connection string.
- `BLOB_READ_WRITE_TOKEN`: this project's private Blob store token.
- `BLOB_INTAKE_KEYS_JSON`: JSON array of `{keyHash,tenantId,userId}`. `keyHash`
  is SHA-256 of a random API key of at least 24 characters. Never commit raw keys.
- `SESSION_SECRET`: random secret of at least 32 characters, signs one-hour
  HttpOnly, Secure, SameSite=Strict browser sessions. Sessions are checked against
  configured identities, so removing an identity revokes its sessions.
- `BLOB_INTAKE_SCHEMA`: optional isolated Postgres schema, default `blob_intake`.
- `CRON_SECRET`: optional bearer key for `/api/intake/reconcile` cron execution.
- Scanner/provider configuration is documented by the provider module owner.

Pilot API keys are a controlled pilot identity system, not customer signup,
organization membership management or a complete abuse/rate-limit solution.
Only files uploaded by the authenticated user within its tenant are visible.
No caller-supplied tenant or path overrides the server-owned metadata.

| Endpoint | Purpose |
| --- | --- |
| POST/DELETE `/api/intake/session` | Same-origin key login / cookie logout |
| POST `/api/intake/prepare` | Allocate owned metadata `{name,declaredType}` |
| POST `/api/intake/upload` | Official Blob SDK token issuance or signed completion |
| POST `/api/intake/finish` | Idempotently read/hash Blob, register and submit `{fileId}` |
| GET `/api/intake/state` | Sanitized owner-scoped file/check statuses |
| POST `/api/intake/action` | Retry eligible job `{jobId,action:"retry"}` |
| GET `/api/intake/download?fileId=...` | Authorized short-lived signed GET |
| POST `/api/intake/callback` | Provider authenticated exact raw body, `x-intake-signature` |
| POST `/api/intake/reconcile` | Recovery only for the authenticated owner's jobs |
| GET `/api/intake/reconcile` | Operator-only global cron recovery, `CRON_SECRET` bearer |

Browser mutations require the same Origin. API bearer calls without an Origin are
permitted; browser-origin bearer calls must also match. Upload tokens expire in
five minutes, bind the exact allocated pathname/MIME, prohibit overwrite and
random suffixes, and enforce a 20 MiB maximum. The SDK verifies Blob completion
signatures before metadata completion. Manual finish recovers a missed completion
callback by rereading the actual owned Blob, not accepting a supplied digest.
JSON request bodies are streamed with finite limits. Missing scanner availability
never approves a file. The local fixture endpoints remain loopback-only.

The normal pilot operation is upload, refresh, recover missed results if needed,
then download once approved. Failed provider work can be retried; content changes,
conflicting outcomes and threat rejection remain closed. Approved files are
reread and hashed before issuing each download capability. Capability access may
continue for its short lifetime after issuance; it is not instant revocation.
