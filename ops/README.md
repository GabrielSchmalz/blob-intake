# Managed scanner operations

The Vercel project runs the API and shared acceptance state. The isolated host worker polls its dedicated Neon scanner queue and streams bounded immutable bytes to ClamAV on localhost. No scanner or worker endpoint is public.

ClamAV uses the official digest-pinned image, nonroot UID100, dropped capabilities, a read-only root filesystem, one CPU, four GiB RAM and a dedicated signature volume. FreshClam checks for signatures 12 times daily. Worker freshness checks must pass before approval. The daily signature timestamp, rather than the rarely updated main archive timestamp, determines freshness. Configuration is in `compose.yaml` and `clamd.conf`. Official reference: https://docs.clamav.net/manual/Installing/Docker.html.

Create the named signature volume once with `docker volume create blob-intake-clamav-db`, then `docker compose -f ops/compose.yaml up -d`. Keep private worker configuration under ignored `runtime/worker.env` with mode600; never commit it.

Worker startup, recovery and measured live results will be recorded here after verification. Customer onboarding is operator provisioned. There is no automated billing or uptime SLA. Updating engine images requires selecting a supported official version, checking release/security notes, changing the pinned digest, restarting only this container, and rerunning the clean/threat/fail-closed smoke check. Signature refresh is automatic; engine upgrades are operator-owned.

## Worker configuration

The worker reads only its dedicated private environment: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` (our pilot store only), `CALLBACK_SECRET`, `BLOB_INTAKE_SCHEMA`, `BLOB_INTAKE_CALLBACK_URL`, `CLAMAV_HOST`, `CLAMAV_PORT`, and `BLOB_INTAKE_WORKER_IDLE_MS`. Customer-store capabilities are AES-GCM encrypted in the dedicated scanner queue; the worker does not receive customer Blob store tokens.

For an idle pilot, polling is set to600000ms (10minutes) to permit Neon autosuspend. A new queued file can therefore wait up to10minutes before processing starts. Backlog processing continues promptly while work exists. Database and Blob usage still count toward their allowances; no zero-cost or unlimited-throughput claim is made. Increase polling frequency only with a suitable measured database usage budget.

`blob-intake-worker.service.example` documents the user-service template. Substitute absolute owning paths, install under the owning user's systemd configuration and enable it after bounded live verification. Check the service's status, ClamAV health and queue/error metrics after restart. Continuous worker operation is part of the selected managed service; temporary model/test batches terminate after their bounded trial.
