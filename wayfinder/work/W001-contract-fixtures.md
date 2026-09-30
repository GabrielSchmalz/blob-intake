# W001: Shared contract and fixture harness

State: complete locally. Depends on: none.

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
Implemented in `src/contract`, `fixtures` and `tests/scenarios.ts`. Both arms pass
the shared suite. See [results](../../docs/results.md) for execution evidence.
