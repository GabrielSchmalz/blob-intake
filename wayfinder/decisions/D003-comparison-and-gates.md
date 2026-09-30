# D003: Comparable experiment and decision gates

Status: resolved as proposed internal thresholds. Date: 2026-09-30.

Gate 1 compares documented incumbent Blob + Transloadit with the proposed layer,
same app shell, same provider, identical contract and scenario fixtures. Existing
documentation suggests compatibility but no provider execution is verified.

Proposed threshold: at least 50% less app-specific integration code **or** active
setup time, with equivalent behavior and no correctness regression. Report both
metrics even when only one clears the threshold. Separate reusable SDK internals,
baseline helpers, configuration, hosting/accounts and total maintenance burden;
moving complexity behind an API does not make it disappear. Small-sample results
are exploratory, not a universal improvement claim.

Do not score speed until both arms pass behavior checks. If neither effort metric
clears the proposed threshold, simplify to a template or stop; no hosted product
commitment. If another account makes the workflow harder, include that evidence.

Gate 2, future authorized buyer validation: ten relevant teams, five independently
report the same costly existing problem, three accept a concrete priced pilot,
and two pay after successful delivery. These thresholds are hypotheses, not
current commitments. No outreach or payment collection has occurred.

Gate 3, future agent evidence: twelve unbranded prompts in fresh target GPT/Claude
sessions, with model/tool/date/browsing recorded. Measure unsolicited mention and
selection separately from supplied-doc integration. Repeat sessions and record
incumbent/free DIY recommendations. No minimum discovery rate has been established;
choose one before running a scored trial after public availability.

Successful buyer validation can justify another acquisition channel if agent
discovery fails. Agent mentions alone cannot justify pricing or demand claims.
