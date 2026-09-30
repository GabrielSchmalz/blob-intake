# Blob Intake instructions

This dedicated Git root owns Blob Intake planning and product source.
Read [CONTEXT.md](CONTEXT.md) and [wayfinder/MAP.md](wayfinder/MAP.md) before work.
Canonical decisions live in `wayfinder/decisions`; the map links their summaries.
Update the relevant decision and dependent work items when scope changes.

Current authorization includes all four launch stages: bounded real-provider trial,
shared production persistence and authentication on the available paid Vercel team,
agent-measured integration comparison, public useful documentation/example, and
unprompted GPT/Claude discovery evaluation. Ordered scoped commits remain authorized.
See wayfinder/decisions/D005-launch-scope.md for the latest canonical scope.
No customer outreach, customer billing or recurring subscription purchase is implied.
Check resource/account identity and estimate bounded usage before paid execution.
Scanner replacement with an isolated host service is a pending explicit decision.

Preserve unrelated edits. Run `git rev-parse --show-toplevel` before Git mutations;
never stage product files in the umbrella repository. Commit/push when requested.
Root registry integration belongs to the umbrella owner.

Use proportionate verification. Planning edits need link, dependency and factual
inspection, not an application test suite. Runtime TypeScript changes
use the shared typescript-best-practices skill and Effect at fallible boundaries;
UI work uses the shared ui skill. Do not install packages merely to plan.

Implementation must preserve [D002](wayfinder/decisions/D002-acceptance-contract.md):
tenant authority comes from authenticated application context, unknown checks
never permit access, results bind to immutable content, and events/recovery are
idempotent. Do not log signed source URLs, credentials or raw uploads. Keep
fixture and mock evidence distinct from actual provider/deployed evidence.

Report completed work, verification and remaining uncertainty plainly. Do not
claim market demand, organic AI recommendations, universal retention advantage,
complete malware detection or production readiness from documentation alone.
