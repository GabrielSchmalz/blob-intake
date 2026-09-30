# Managed scanner operations

The Vercel project runs the API and shared acceptance state. The isolated host worker polls its dedicated Neon scanner queue and streams bounded immutable bytes to ClamAV on localhost. No scanner or worker endpoint is public.

ClamAV uses the official digest-pinned image, nonroot UID100, dropped capabilities, a read-only root filesystem, one CPU, four GiB RAM and a dedicated signature volume. FreshClam checks for signatures 12 times daily. Worker freshness checks must pass before approval. The daily signature timestamp, rather than the rarely updated main archive timestamp, determines freshness. Configuration is in `compose.yaml` and `clamd.conf`. Official reference: https://docs.clamav.net/manual/Installing/Docker.html.

Create the named signature volume once with `docker volume create blob-intake-clamav-db`, then `docker compose -f ops/compose.yaml up -d`. Keep private worker configuration under ignored `runtime/worker.env` with mode600; never commit it.

Worker startup, recovery and measured live results will be recorded here after verification. Customer onboarding is operator provisioned. There is no automated billing or uptime SLA. Updating engine images requires selecting a supported official version, checking release/security notes, changing the pinned digest, restarting only this container, and rerunning the clean/threat/fail-closed smoke check. Signature refresh is automatic; engine upgrades are operator-owned.
