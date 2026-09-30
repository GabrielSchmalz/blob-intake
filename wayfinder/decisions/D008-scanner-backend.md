# D008: Scanner implementation and operational responsibility

Status: pending consequential hosting choice. Date: 2026-09-30.

The user asks whether Transloadit can be removed. It can: the SDK owns acceptance
state/recovery and calls a pluggable scanner boundary. It need not require a
customer Transloadit account. Authentication, private Blob and shared metadata
on Vercel remain the application path in either case.

The current recommendation is our hosted ClamAV backend with a queue and bounded
polling/callback result binding. A worker would run outside Vercel serverless on
the existing host; it needs roughly 4 GiB RAM and 1 GiB disk plus signature update
and scanner maintenance. These are planning estimates, not allocated or measured
resources. This removes the Transloadit account/subscription dependency, but
introduces our operational responsibility. Do not imply the user has selected
or approved this host footprint before an explicit answer to the pending choice.

If selected, prefer worker-initiated queue polling and result submission, without
a public worker endpoint. Keep scoped temporary private-file access, exact digest/
attempt binding, server-side worker authentication and fail-closed delivery.
Review actual host capacity and bound scanner resources before installation.

Transloadit remains an optional BYO implementation if selected or useful for
comparison. Its current wire adapters are offline-tested; that does not prove
real scanning. Until the choice is resolved, W006 final scanner execution and
W007's real approval journey remain pending. Shared database, SDK, public docs
and agent measurements can progress independently.
