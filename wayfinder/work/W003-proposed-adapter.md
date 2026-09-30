# W003: Proposed acceptance adapter

State: waiting. Depends on: W001.

Implement the same portal contract through a small proposed integration package
with a Blob adapter, one Transloadit provider adapter, durable job/event storage,
callback verification and polling reconciliation. Prefer one repository-local
package and example; no public package or hosted account is needed.

Use one documented persistence adapter for the comparative prototype, selected
for reproducible local execution. State its production limitations; no in-memory
state masquerading as durable recovery. Follow the shared Effect runtime guidance
for fallible asynchronous TypeScript. Avoid inventing multiple storage integrations.

Expose stable file/job/attempt identities, clear reason codes and an authenticated
status/delivery path. Keep app-specific authorization explicit. SDK internals and
database setup count in maintenance/cost analysis even if app code shrinks.

Done locally when shared scenarios pass and a fresh developer can follow documented
setup using fixtures. No live provider/deployment reliability is implied.
