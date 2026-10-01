# W006: Real Blob and hosted scanner trial

State: complete real Blob and managed scanner trial. Recorded: 2026-10-01.
Evidence: [deployed real workflow](../../evidence/managed-live.json),
[exact-path/expiry](../../evidence/blob-live.json), and
[automatic worker service](../../evidence/worker-service-live.json), and
[actual scanner outage/restart](../../evidence/scanner-recovery-live.json).
Clean approval, real safe-test-specimen rejection, digest mismatch denial,
missed-callback recovery and exact cleanup pass. See [launch results](../../docs/launch-results.md)
for cost/resource and detection limitations.
Depends on: W004 local correctness, D005 execution scope, D008 host boundary.

Vercel account/project and a dedicated private Blob store are available. The user
selected SDK plus our hosted ClamAV scanner. Verify actual host capacity, announce
`blob-intake-clamav` and `blob-intake-worker`, and install/configure only those
isolated services within D008 bounds. No Transloadit account/subscription is needed.
Read current scanner/security/Blob docs for the exact trial. Use a small request
inventory with synthetic files and a safe standard scanner test specimen; record
resource/usage basis rather than treating existing host cost as zero operating cost.

Execute private upload, temporary authorized private source access, real file-type/
scan/hash processing and authenticated digest/attempt-bound results, plus polling/
recovery and gated delivery. The worker polls the queue and submits results without
a public worker endpoint. Its deployed authenticated result path depends on W007.
Test clean approval, detected specimen rejection, outage/unknown denial and recovery
without bypassing policy. Fixture malware outcomes cannot establish real detection.

Done when real scanner/file evidence establishes the tested path, records failures,
source expiry, signature/retention/resource limits and usage basis, and stops
temporary validation work. Do not claim exactly-once processing, unlimited detection
or production reliability from a small trial. Transloadit wire adapters remain
optional offline-tested compatibility, not a prerequisite for this milestone.
