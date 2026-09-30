# Wayfinder map

Updated: 2026-09-30. Phase: authorized launch milestone in progress.

Destination: complete real Blob/scanner validation, an authenticated shared-persistence
Vercel deployment, an independent agent setup comparison, and public docs/example
with an unprompted recommendation trial. [D005](decisions/D005-launch-scope.md)
owns latest scope and completion boundaries; [D001](decisions/D001-scope.md)
retains the initial workflow choice. No commercial winner is established.

## Resolved decisions

| Decision | Gist |
| --- | --- |
| [D001](decisions/D001-scope.md) | Initial Blob acceptance experiment and bounded formats |
| [D002](decisions/D002-acceptance-contract.md) | App authorization; immutable content binding; fail closed; durable recovery |
| [D003](decisions/D003-comparison-and-gates.md) | Same-provider behavior and effort gates; independent buyer/agent evidence |
| [D004](decisions/D004-commercial-options.md) | BYO provider; pricing and managed offering remain hypotheses |
| [D005](decisions/D005-launch-scope.md) | All four next stages authorized; launch does not establish commercial demand |
| [D006](decisions/D006-launch-evidence.md) | Real/deployed evidence, independent agent measurements and preregistered discovery |
| [D007](decisions/D007-public-license.md) | MIT source/example license; accurate public integration documentation |
| [D008](decisions/D008-scanner-backend.md) | Pending choice: our hosted ClamAV worker or optional Transloadit |

## Actionable work and actual dependencies

| Item | State | Depends on | Result |
| --- | --- | --- | --- |
| [W001](work/W001-contract-fixtures.md) | Complete locally | None | Contract and deterministic fixtures |
| [W002](work/W002-incumbent-baseline.md) | Complete locally | W001 | Independent incumbent baseline |
| [W003](work/W003-proposed-adapter.md) | Complete locally | W001 | Reusable adapter and candidate |
| [W004](work/W004-comparative-evidence.md) | Local evidence complete | W002, W003 | [Local results](../docs/results.md), provider/time evidence still pending |
| [W006](work/W006-real-provider-trial.md) | Scanner choice pending; private Blob provisioned | W004, D005, D008 | Real signed-source/scanner/recovery evidence and usage |
| [W007](work/W007-vercel-production-path.md) | Meima project/private Blob/Neon free provisioned; 17 real-Neon fixture checks pass; deployment pending | D002, D005, W004; final scanner D008/W006 | Shared persistence, auth and deployed functional evidence |
| [W008](work/W008-agent-setup-comparison.md) | Independent agents complete; evidence save pending | D006, stable arms | Both 14-case arms pass; 184 vs 3 app lines; 177.341 vs 54.271 seconds; SDK 185 lines |
| [W009](work/W009-public-docs-and-recommendations.md) | Source/docs and copyable SDK example implemented; publication/trial pending | D005, D006; tested claims W006–W008 | Public docs/example and scored unbranded discovery trial |
| [W005](work/W005-market-and-distribution.md) | Buyer/payment lanes deferred | Experiment evidence | Buyer urgency, pilot/payment and economic validation |

W006 initial submission/polling can precede W007; actual callback delivery needs
W007's reachable endpoint. W007 deployment/authentication can proceed while scanner hosting is resolved.
W008 agents have completed their isolated measured integrations; root evidence
recording and W009 public deployment/prompt preparation can proceed independently. Final claims must wait for their supporting evidence.
W009 recommendation trial starts only after public docs verification. A negative
recommendation result is evidence, not a blocker to reporting the four tasks done.

## Unresolved resource and implementation choices

- Vercel Meima project, dedicated private Blob and Neon free shared database are
  provisioned. Real-Neon fixture tests pass; actual scanner and deployment proof
  remain pending. Model API access remains a separate check.
- Resolve D008: SDK scanner boundary is optional/pluggable; the recommended hosted
  ClamAV worker needs an explicit hosting choice and actual capacity check.
- Neon shared persistence is selected; finish the authentication boundary and
  deployed multi-invocation verification while preserving D002 invariants.
- Determine scanner request inventory, resource use and incremental cost;
  no unlimited paid batch or watcher is authorized.
- MIT source/example license is resolved in D007; verify the publication origin
  and public source availability before the discovery trial.
- Model-session availability and immediate public indexing affect discovery coverage;
  record them without substituting supplied-doc integration for discovery.

## Completion and remaining exclusions

Finish W006–W009 with inspected evidence and ordered scoped commits. Final report
must distinguish success, executed negative outcomes and concrete missing dependency.
Keep concise status here; item notes own acceptance and evidence links.

Custom scanner-engine development, archives/office/OCR/previews, customer outreach, payments,
subscription billing, Marketplace/Connect submission and a managed SaaS expansion
remain outside this milestone. [Resume](RESUME.md) owns the next-action pointer.
