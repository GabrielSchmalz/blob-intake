# W006: Real Blob and scanner trial

State: Blob resources provisioned; real scanner execution pending D008 choice.
Depends on: W004 local correctness evidence; D005 execution scope.

Vercel account/project and a dedicated private Blob store are available.
Resolve [D008](../decisions/D008-scanner-backend.md), then inspect actual worker
capacity or optional external-provider access without printing credentials. Read current official API/pricing terms
needed for the exact trial. Estimate a small synthetic-file batch and prefer
existing included capacity. No open-ended batch or watcher.

Execute private upload and transient scoped signed access, real provider type/
scan/hash processing, signature-verified callback and polling/recovery, plus
content-bound gated delivery. A local callback harness is insufficient for
scanner result delivery: use the deployed authenticated result/callback path
from W007 when necessary. A queue-polling worker need not expose a public endpoint. The
initial real submission/poll trial can run before deployment; final callback
proof depends on W007's deployed endpoint. Preserve the known orphan window
rather than implying exactly-once submissions.

Done when real request evidence establishes the tested path, records failures,
expiry/retention limitations and measured usage/cost basis, and removes temporary
trial resources/watchers where appropriate. Unresolved scanner hosting choice or required scanner resources/credentials
are concrete remaining dependencies. Fixtures never satisfy this item.
