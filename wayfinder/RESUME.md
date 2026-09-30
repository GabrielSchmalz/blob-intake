# Resume point

Date: 2026-09-30. Authorized launch work in progress. Local implementation,
40-test/build/HTTP comparison and ordered commits are recorded in [results](../docs/results.md).
The user now requests all four follow-up stages completed and substitutes agents
for a fresh developer setup trial. [D005](decisions/D005-launch-scope.md) supersedes
older local-only authorization; deployment and useful public docs/example are
within scope. Do not re-request routine approval for those actions.

Start with [MAP](MAP.md), [D006 measurement protocol](decisions/D006-launch-evidence.md)
and W006–W009. Vercel Meima project, dedicated private Blob and Neon free shared
database exist;
17 real-Neon fixture checks pass. Deploy and verify authentication/shared metadata,
then run bounded real synthetic-file/scanner recovery checks for the selected D008 backend. Independent
agent setup is complete: both 14-case arms pass; baseline 184 application lines/
177.341 seconds; candidate 3 lines/54.271 seconds with 185 SDK lines. [Agent evidence](../evidence/agent-setup.json) exists and has been inspected;
seed setup, SDK construction and human time are excluded.
Public source/docs and copyable SDK example are implemented;
publish/verify their public origin before unbranded recommendation sessions.
D008 is resolved: user selected SDK plus our hosted scanner without a Transloadit
account. Isolated `blob-intake-clamav` (4 GiB RAM, 1 CPU; about 1 GiB disk) and
`blob-intake-worker` are authorized, subject to actual capacity checks. Announce
those services before changes; use queue polling and no public worker endpoint. Other lanes
remain independently actionable; final scanner result proof needs deployment.

Record evidence and exact deployed/commit refs as execution finishes. Real-provider
results cannot be replaced by fixtures; local SQLite is not shared serverless
persistence. Agent elapsed time is not human effort. Zero unsolicited recommendations
can be a complete negative trial; unexecuted model/provider calls remain pending.
Keep secrets/signed URLs out of logs/artifacts. Stop temporary batches/watchers at
the agreed bounded endpoint and report usage/cost basis.

Preserve incumbent differentiation caveats: Blob originals need not migrate and
No Save is not a universal 24-hour retention disadvantage. Buyer outreach,
payments and a paid commercial offering remain separate W005 follow-ups.
