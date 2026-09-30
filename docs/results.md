# Local experiment results

Date: 2026-09-30. Outcome: continue with a small developer integration trial.
The local implementation milestone is complete. Production and commercial
validation are pending.

## Evidence

- `npm run check`: strict typecheck and 40 passing tests, zero failures.
- `npm run build`: Next.js production build passes.
- `npm run compare`: all 14 shared scenarios pass on each independent arm,
  28 scenario executions. [Machine-readable comparison](../evidence/local-comparison.json)
  includes source hashes, inventory, decision and unmeasured setup time.
- `npm start` plus `npm run smoke`: compiled HTTP journey passes for both arms,
  including upload, blocked download, outage, retry, approval, exact-byte delivery
  and foreign-origin rejection. [HTTP evidence](../evidence/http-smoke.json).
- Desktop 1280×800 and mobile 390×844 static rendering inspected using the native
  preview browser. No horizontal overflow; file input labels and headings present.
  The client browser could not reach server loopback. Actual served HTML with
  inline project CSS was rendered with scripts removed. This verifies the empty
  screen's appearance only, not hydration, file-row states or browser interaction.
  [Desktop](../evidence/static-desktop.png) and [mobile](../evidence/static-mobile.png)
  screenshots retain this limited rendering evidence. Functional evidence comes
  from HTTP checks; a full browser journey remains pending.

## Measurement and interpretation

[Measurement rules](measurement-rules.md) define the inventory. Baseline application
integration is 163 nonblank lines; candidate application wrapper is 5. The 96.9%
application-facing reduction clears the proposed 50% packaging threshold. Candidate
SDK internals are 185 lines, giving 190 total candidate lines versus 163 baseline.
Shared storage/provider adapters, contract, portal and fixtures are separately
inventoried. Configuration and operational responsibilities are documented; the
line ratio does not measure complexity or maintenance cost.

No fresh integrator or active setup-time ledger was measured. Agent authoring time
cannot establish setup savings. The result supports testing whether packaging
helps developers, not a claim that the overall implementation is smaller or easier
for customers. No buyer, price or organic AI recommendation has been validated.

## Remaining stages

SQLite persists local jobs, attempts and events across reopen/restart. It is not
shared durable persistence for Vercel serverless. Production requires a suitable
persistence adapter, application authentication and an authorized deployed journey.
Real Blob/Transloadit wire adapters have offline tests, but no provider request was
executed. Signed URL fetching, expiry, callback delivery, usage and retention need
real-provider evidence. A lost submission response before private assembly binding
is saved can orphan a provider job; no exactly-once submission guarantee is claimed.
See [provider compatibility](provider-compatibility.md).

Next bounded work is a fresh developer setup comparison and capped real-provider
trial with test-only files once account and budget scope are supplied. Public
publication, deployment, customer outreach, pricing, billing and organic agent
recommendations remain separate stages. No remote or published package exists.
