# D008: SDK plus our hosted scanner

Status: resolved by explicit user selection. Date: 2026-09-30.

The user selected the second model: SDK plus our hosted scanner. The SDK owns
acceptance state/recovery and calls a pluggable scanner boundary. Customers need
no Transloadit account. App authentication, private Blob and shared metadata stay
on Vercel. Transloadit remains an optional adapter, not a launch dependency.

Operate isolated host services `blob-intake-clamav` and `blob-intake-worker` for
this project. The scanner boundary is 4 GiB RAM and 1 CPU, with approximately
1 GiB disk expected for software/signatures; check actual host capacity before
allocation and record measured resource use. The explicit selection authorizes
this footprint and our signature-update/scanner maintenance responsibility.
Announce the exact services before changes; preserve unrelated host services.
No new provider subscription or recurring paid purchase is required or implied.

The worker initiates queue polling and authenticated result submission; expose
no public worker endpoint. Keep bounded retries, private file access, exact
digest/attempt binding, worker authentication and fail-closed delivery. Treat
worker death, stale leases and signature freshness as operational failure paths,
not clean scan results. Persist and reconcile queue state in the shared database.

The selected architecture is resolved; successful installation, resource bounds,
real scanner execution and the deployed approval journey remain unproven until
W006/W007 evidence exists. ClamAV detects configured known threats; this selection
does not guarantee every malicious document is caught. Billing, customer demand
and a general hosted SaaS business remain separate validation.
