# Wayfinder map

Updated: 2026-09-30. Phase: local implementation and comparison complete; external validation pending.

Destination and exclusions are canonical in [D001](decisions/D001-scope.md).
The next bounded milestone is a fresh integration trial with real-provider evidence. No commercial winner, price or agent-distribution outcome is established.

## Resolved decisions

| Decision | Gist |
| --- | --- |
| [D001](decisions/D001-scope.md) | Local experiment; one provider; no hosted launch or spending |
| [D002](decisions/D002-acceptance-contract.md) | App authorization; immutable content binding; fail closed; durable recovery |
| [D003](decisions/D003-comparison-and-gates.md) | Same provider and behavior; proposed 50% effort reduction; independent market/agent gates |
| [D004](decisions/D004-commercial-options.md) | BYO provider first; license, hosted offering and price remain hypotheses |

## Actionable work and actual dependencies

Local work is verified by [results](../docs/results.md). Provider, production and
commercial stages remain separate; a local pass does not establish those outcomes.

| Item | State | Depends on | Result |
| --- | --- | --- | --- |
| [W001](work/W001-contract-fixtures.md) | Complete locally | None | Shared contract and deterministic scenario fixtures |
| [W002](work/W002-incumbent-baseline.md) | Complete locally | W001 | Documented incumbent app implementing the shared contract |
| [W003](work/W003-proposed-adapter.md) | Complete locally | W001 | Proposed adapter/example implementing the same contract |
| [W004](work/W004-comparative-evidence.md) | Local evidence complete | W002, W003 | Reproducible equivalence and effort measurements; continue/stop decision |
| [W005](work/W005-market-and-distribution.md) | External evidence pending | W004 | Separate buyer, pricing and agent-distribution evidence |

W002 and W003 were implemented independently against the common contract, with
shared fixtures and separate processing engines. W004 local evidence is complete;
actual provider validation needs provider/account/budget scope.
W005 includes independent lanes and does not imply that paying customers require
organic agent recommendations, or that recommendations prove willingness to pay.

## Uncertain future decisions

- Actual SDK/provider semantics and signed URL expiry compatibility: W002/W004.
- App-facing code threshold passes; fresh setup-time savings remain unmeasured: W004.
- Input/output handling, region, retention and provider terms: W004 before real data.
- Buyer urgency, pilot price and viability: W005.
- Public brand, licensing, docs publication and distribution channel: D004/W005.
- Production metadata persistence and host: local SQLite is implemented;
  choose shared production infrastructure before a deployed reliability trial.

## Excluded scope

No scanner engine, archives, office conversion, OCR, previews, payments, automatic
deployment, Marketplace/Connect submission, public repo/package publication or
customer contact in this setup. CSV imports remain outside this repository.

The [experiment spec](../specs/comparative-experiment.md) owns acceptance details;
[sources](../research/SOURCES.md) owns evidence status; [resume](RESUME.md) owns
the concise next-action pointer. Avoid duplicating decisions in new summaries.
