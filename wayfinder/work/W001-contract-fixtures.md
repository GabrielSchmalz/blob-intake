# W001: Shared contract and fixture harness

State: ready for next local implementation scope. Depends on: none.

Implement the [comparative specification](../../specs/comparative-experiment.md)
as shared data types, scenario fixtures and acceptance assertions. Define storage,
provider, persistence and clock boundaries without choosing a hosted service.
Use deterministic fake Blob/provider adapters for local behavior proof.

Deliver a scenario manifest and run command both arms consume. The shared harness
must not include the proposed adapter's persistence/recovery implementation.
Use identical authenticated app context and fixture file identities in both arms.
Verify unknown outcomes, cross-tenant access, content replacement and duplicate/
late events explicitly. Record mocks as mocks, never as provider completion.

Done when both arms can target the same contract, all scenario IDs have expected
outcomes, and no external service or secret is required for local validation.
No implementation has begun; this planning item being ready is not a live-action grant.
