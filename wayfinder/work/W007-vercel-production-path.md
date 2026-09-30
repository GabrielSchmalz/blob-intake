# W007: Shared persistence, authentication and Vercel deployment

State: Vercel Meima project, dedicated private Blob and Neon free database created;
deployment and authenticated real-scanner journey pending.
Depends on: D005 scope; D002 acceptance invariants; W004 local regression evidence.
Final deployed scanner journey depends on W006 hosted scanner configuration;
D008 selects our isolated ClamAV/worker services.
Seventeen real-Neon fixture contract checks pass. This establishes shared database
behavior for the tested fixture path, not actual scanning or deployed approval.

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
