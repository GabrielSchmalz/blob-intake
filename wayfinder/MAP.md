# Wayfinder map

Updated: 2026-10-01. Phase: SDK plus managed scanner pilot launched; four execution
lanes complete with a negative discovery result and recorded protocol limitations.
Canonical outcome: [launch results](../docs/launch-results.md). Public app/docs:
https://blob-intake.vercel.app. MIT source: https://github.com/GabrielSchmalz/blob-intake.
Verified deployed source: `869b481`. No commercial winner is established.

## Decisions

| Decision | Gist |
| --- | --- |
| [D001](decisions/D001-scope.md) | Initial bounded Blob acceptance experiment |
| [D002](decisions/D002-acceptance-contract.md) | App authorization; content binding; fail closed; durable recovery |
| [D003](decisions/D003-comparison-and-gates.md) | Equivalent behavior; effort and independent commercial/channel gates |
| [D004](decisions/D004-commercial-options.md) | Initial BYO hypothesis; pricing/payment unvalidated |
| [D005](decisions/D005-launch-scope.md) | Four launch execution lanes authorized; success distinct from demand |
| [D006](decisions/D006-launch-evidence.md) | Real/deployed, agent effort and preregistered discovery protocol |
| [D007](decisions/D007-public-license.md) | MIT source/example |
| [D008](decisions/D008-scanner-backend.md) | SDK + our isolated hosted ClamAV/worker; no public worker endpoint |

## Work and evidence

| Item | State | Depends on | Result |
| --- | --- | --- | --- |
| [W001](work/W001-contract-fixtures.md) | Complete locally | None | Shared contract and fixtures |
| [W002](work/W002-incumbent-baseline.md) | Complete locally | W001 | Independent baseline |
| [W003](work/W003-proposed-adapter.md) | Complete locally | W001 | Adapter and candidate |
| [W004](work/W004-comparative-evidence.md) | Local comparison complete; follow-up evidence W006/W008 | W002, W003 | [Original local results](../docs/results.md) |
| [W006](work/W006-real-provider-trial.md) | Complete real managed trial | W004, D005, D008 | Blob access, real scan/rejection, recovery, scoped SDK, exact cleanup |
| [W007](work/W007-vercel-production-path.md) | Complete bounded deployed pilot | D002, D005, W006 | Vercel/private Blob/shared Neon, authenticated real workflow and rendered origin |
| [W008](work/W008-agent-setup-comparison.md) | Complete measured agents | D006, stable arms | Each 14 cases pass; baseline 184 lines/177.341s, candidate 3 lines/54.271s plus 185 SDK lines |
| [W009](work/W009-public-docs-and-recommendations.md) | Published; discovery execution complete with deviations | D005, D006, W006–W008 claims | 0/12 exploratory selections; strictly eligible 6 GPT/0 Claude; balanced gate unestablished |
| [W005](work/W005-market-and-distribution.md) | Buyer/payment lanes deferred | Product evidence | Buyer urgency, willingness to pay and economics remain unknown |

## Residual uncertainty and operations

- The immediate public-discovery trial found no unsolicited mentions. Six Claude
  responses exceed the word limit and one exceeds search count; disclose deviations
  rather than claiming the balanced preregistered gate was established. No added
  model requests or forced branded searches to manufacture a successful result.
- Agent elapsed/code measurements exclude seed setup, SDK construction and human
  effort. They do not establish production provisioning or human savings.
- Real live proof is a small synthetic trial; ClamAV is not universal malware
  detection, and one automatic worker scan does not establish uptime/throughput.
- Provisioned pilot identities are implemented; automatic customer signup,
  membership onboarding and billing are absent.
- Isolated scanner and worker remain active with 600-second idle polling and
  signature maintenance. Announce exact services before any future changes.
  Trial objects/metadata are removed; private runtime credentials stay ignored.

## Completion boundary and exclusions

W006–W009 have executed evidence. The launched pilot and public example are real;
the negative exploratory discovery outcome is also real. Strict balanced channel
validation and commercial demand have not been achieved. This completes the
requested execution milestone without asserting those positive business outcomes.

Buyer outreach/payments, npm publication, billing, Marketplace/Connect submission,
custom scan-engine development, additional formats/OCR/previews and a generic SaaS
expansion remain excluded/unexecuted. [Resume](RESUME.md) owns continuation.
