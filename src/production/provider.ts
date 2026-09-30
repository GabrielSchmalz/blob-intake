import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { Pool } from "pg";
import { IntakeError, type Provider } from "../contract/index";

export interface ProductionProviderOptions {
  readonly pool: Pool;
  readonly schema: string;
  readonly resolveSource: (tenantId: string, fileId: string, digest: string) => Effect.Effect<{ readonly pathname: string; readonly digest: string }, IntakeError>;
  readonly now: () => number;
}
/** Unconfigured scanners fail closed. An actual provider must be selected to submit. */
export const createProductionProvider = (_options: ProductionProviderOptions): Effect.Effect<Provider, IntakeError> => Effect.succeed({
  submit: request => createHash("sha256").update(request.bytes).digest("hex") !== request.digest
    ? Effect.fail(new IntakeError({ code: "storage" })) : Effect.fail(new IntakeError({ code: "provider" })),
  poll: () => Effect.fail(new IntakeError({ code: "provider" })),
  verifyCallback: () => Effect.fail(new IntakeError({ code: "invalid_callback" })),
});
