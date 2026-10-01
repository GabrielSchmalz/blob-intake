# Managed scanner worker

The deployed application enqueues immutable metadata in Postgres. A separate
worker reads private Vercel Blob bytes and streams them to an isolated ClamAV
daemon over loopback TCP. Original files stay in the customer's Blob store.
No raw upload, signed URL or scanner credential is saved in logs.

The worker implements the documented [ClamD INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html): NUL-framed commands, big-endian chunk sizes, and an explicit empty final chunk. It requires
ClamAV `VERSION` to expose a signature database build no older than 72 hours,
rejects future dates beyond five minutes, validates actual byte magic, declared
MIME and SHA-256, and accepts only a complete clean or threat response. These
checks do not certify that a file is safe or structurally valid. Keep ClamAV
and FreshClam updated; stale definitions and scanner failures fail closed.

## Application and external SDK tasks

Internal tasks reference an app-owned private pathname and deliver authenticated
callbacks to the central app, with polling recovery if callbacks are lost.
External SDK tasks carry a signed exact-private-Blob URL. Source URLs are validated
both when enqueued and immediately before fetch, use HTTPS only, reject credentials,
ports and fragments, and cannot redirect. Raw capabilities are encrypted with
AES-256-GCM using a key derived from private `CALLBACK_SECRET`. They expire within
15 minutes and are erased from task JSONB on completion. Metadata and event history
remain for replay/recovery; a retention worker is not implemented.

Caller attempt IDs are namespaced by tenant and user internally. Two customers may
use `attempt-1` independently. External polling requires the same tenant and owner,
and remaps internal attempt IDs back to the caller's original ID. Repeated submissions
for the same identity and Blob pathname deduplicate even when a renewed signature
changes the URL query. The first capability is retained; source expiry needs an
explicit new attempt. A different file, pathname, digest or MIME under the same
attempt ID is denied. External tasks poll and do not send central-app callbacks.

## Operations

The private service environment needs `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`,
`CALLBACK_SECRET` of at least 32 characters, and `BLOB_INTAKE_CALLBACK_URL`.
Optional configuration includes `BLOB_INTAKE_SCHEMA=blob_intake`,
`CLAMAV_HOST=127.0.0.1`, `CLAMAV_PORT=3310`, and
`BLOB_INTAKE_WORKER_IDLE_MS=600000`. Legacy `SCANNER_IDLE_SECONDS` is also accepted.

```sh
node --env-file=/private/path/scanner.env --import tsx scripts/scanner-worker.ts --once
node --env-file=/private/path/scanner.env --import tsx scripts/scanner-worker.ts --max-tasks 4 --duration 180
node --env-file=/private/path/scanner.env --import tsx scripts/scanner-worker.ts
```

Run from this repository with dependencies installed. Keep the environment private,
never put secrets into service command arguments, and keep the ClamAV port bound to
loopback. The worker validates loopback host configuration. Isolate the daemon with
resource limits and patched official images. Signature updates require daemon egress;
untrusted files never need execution.

Idle polling defaults to ten minutes so free Postgres compute can suspend between
checks. An idle submission can wait up to ten minutes before processing, followed by
up to roughly 80 seconds of bounded Blob/scan work. Continuous backlog processes
immediately. Larger backlogs can expire 15-minute source capabilities; clients must
retry explicitly. This deployment is a bounded pilot, not a latency SLA. Idle polling
still consumes cloud compute; included/free quotas need operational monitoring.

Each task has a 120-second lease and at most three transient scan attempts. Expired
leases can be reclaimed; old workers cannot commit a result after losing their lease.
Permanent size/type/digest/mismatch/expiry failures terminate immediately. Callback
attempts use fresh HMAC-SHA256 raw envelopes, expire after five minutes, retry at
most five times with exponential backoff, and retain polling recovery afterward.
`SIGTERM` and `SIGINT` interrupt the worker and release connections.

For controlled proof, `createScannerWorker(options)` returns:

- `runOnce({ attemptId?, deliverCallbacks? })`, processing at most one task and callback.
- `dispatchCallback(attemptId?)`, retrying one eligible pending callback independently.

Use `deliverCallbacks: false` to prove lost-callback recovery without manufacturing
a scan result. `managedTaskId(context, externalAttemptId)` derives the internal queue
ID when an operator needs a bounded external-task tick. These helpers are privileged
backend operations and are not anonymous HTTP APIs.

## Verification boundaries

`tests/scanner.test.ts` covers actual loopback TCP protocol framing using a synthetic
daemon, encryption/SSRF/expiry checks, and byte policy. With a private
`BLOB_INTAKE_TEST_DATABASE_URL`, it also exercises actual Postgres namespaces,
immutable replay, capability erasure, lease fencing, authenticated callback binding,
retry exhaustion and worker rejection of MIME-disguised bytes. These fixtures are
not real malware-scanner execution proof; the separate live trial owns that evidence.
