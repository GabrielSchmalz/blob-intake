# W007: Shared persistence, authentication and Vercel deployment

State: complete bounded authenticated deployed pilot. Recorded: 2026-10-01.
Public origin: https://blob-intake.vercel.app. Verified source commit: `869b481`.
Dedicated private Blob and Neon shared metadata support the actual managed scan
journey. Provisioned identities authenticate with secure sessions; tenant checks,
blocked delivery and authenticated polling recovery pass. Evidence:
[live workflow](../../evidence/managed-live.json),
[real-Neon persistence](../../evidence/neon-contract.json), and
[actual rendered origin](../../evidence/browser-rendered.json).
Depends on: D005 scope, D002 invariants, W004 local evidence, W006 real scanner.
This is a bounded verified pilot, not automatic signup/membership provisioning or
an uptime/security certification. [Launch results](../../docs/launch-results.md)
owns the combined interpretation and limitations.

Choose an available Vercel-compatible shared persistence service and authentication
boundary after checking account resources and current official docs. Keep the
existing application acceptance API and injected provider/storage boundaries.
Do not rely on process-local SQLite, memory or fixture identities for the deployed
path. An example may use a bounded verified identity/session configuration if
clearly documented; tenant ownership must remain server-authoritative.

Provision/configure only the required example resources and server-side secrets.
Build and deploy the exact scoped commit. Keep public docs separate from restricted
private-file access. Test the deployed origin with authenticated approval/download,
unauthenticated and wrong-tenant rejection, duplicate callback/recovery, and metadata
surviving a new invocation. Verify the relevant rendered page and interaction if
browser automation can access it. Record any missing visual evidence explicitly.

Done when shared persistence and authenticated deployed behavior have real evidence,
provider callbacks reach and are verified at the deployed endpoint, deployment/ref
and configuration requirements are documented, and temporary validation work stops.
Deployment success alone does not satisfy the workflow checks.
