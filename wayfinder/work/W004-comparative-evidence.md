# W004: Equivalence, effort and provider evidence

State: waiting. Depends on: W002, W003.

Run both arms with the same scenario manifest; compare [D003](../decisions/D003-comparison-and-gates.md)
metrics using the [spec](../../specs/comparative-experiment.md). Resolve every
behavior difference before scoring integration effort. Record reproducibility,
learning/order effects and setup accounts explicitly.

Local completion: scenario results, app/config/SDK code inventory, active setup
minutes and limitations produce a continue/simplify/stop decision. No automatic
market launch follows a local pass.

Separate real-provider stage: identify permitted project/account, quote expected
budget using current fees, capped job/byte count and test-only fixture files; run
only within explicit authorization. Record actual bytes_usage, expiry, callbacks,
poll reconciliation, retention and input/output semantics. Stop at the cap.
EICAR or other antivirus test fixtures require explicit provider/test-policy
compatibility; default local rejected fixtures are sufficient for the mock stage.

Provider execution and deployment are separate evidence labels. A deployment
must demonstrate authorized access and recovery; neither compilation nor a
mocked callback proves deployed/provider behavior. If future live authorization
is unavailable, finish local results and mark this stage pending.
