# Comparative measurement rules

Set before the final inventory, 2026-09-30.

Both arms use the same shell, contract, fixture provider/storage, database engine,
file policy, provider wire adapters and scenario suite. Shared files are excluded
from the app-specific comparison and reported separately. Neither arm may import
the other's processing implementation.

- Baseline application integration: all `.ts` files under `src/baseline`.
- Candidate application integration: all `.ts` files under `src/candidate`.
- Candidate SDK internals: all `.ts` files under `src/adapter`, separately reported.
- Shared contract/integrations, local demo and fixtures: separately inventoried.
- Count nonblank source lines, including comments, to avoid subjective exclusions.
  This is a packaging measure, not a complexity or code-quality metric.
- Generated files, lockfiles, tests and configuration are excluded from the source
  ratio, but required configuration, commands and operational responsibilities
  are described in the setup documentation.

Behavior equivalence requires all S01–S14 on both independent arms. The proposed
50% code threshold considers application-facing code only. Total candidate code
(SDK plus wrapper) must be shown alongside it: hiding work in a library is not
evidence of lower total maintenance or customer value.

Parallel agent implementation does not yield a reliable active setup-time or
fresh-developer measurement. Those measurements are unavailable in this run;
do not substitute elapsed wall time or test duration. No improvement percentage
for setup time will be asserted. Real provider, deployment and market evidence
remain separate from fixture results.
