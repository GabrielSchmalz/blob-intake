import { DatabaseSync } from "node:sqlite";
import { Effect, Schema } from "effect";
import { IntakeError } from "../contract/index";
import type { AssemblyBinding, AssemblyRegistry } from "./transloadit";
const Binding = Schema.Struct({ attemptId: Schema.String, assemblyId: Schema.String, tenantId: Schema.String, fileId: Schema.String, digest: Schema.String });
const persistenceError = () => new IntakeError({ code: "persistence" });
/** Single-host local adapter. Database path and directory are application-owned/private. */
export const openAssemblyRegistry = (databasePath: string): Effect.Effect<AssemblyRegistry & { readonly close: () => Effect.Effect<void, IntakeError> }, IntakeError> => Effect.try({
  try: () => {
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("CREATE TABLE IF NOT EXISTS provider_bindings (attemptId TEXT PRIMARY KEY, assemblyId TEXT UNIQUE NOT NULL, tenantId TEXT NOT NULL, fileId TEXT NOT NULL, digest TEXT NOT NULL)");
    } catch (error) { db.close(); throw error; }
    const lookup = (column: "attemptId" | "assemblyId", id: string) => Effect.try({
      try: () => db.prepare(`SELECT attemptId, assemblyId, tenantId, fileId, digest FROM provider_bindings WHERE ${column} = ?`).get(id),
      catch: persistenceError,
    }).pipe(Effect.flatMap((row) => row === undefined ? Effect.succeed(null) : Schema.decodeUnknown(Binding)(row).pipe(Effect.mapError(persistenceError))));
    return {
      byAttempt: (id) => lookup("attemptId", id),
      byAssembly: (id) => lookup("assemblyId", id),
      save: (binding: AssemblyBinding) => Effect.gen(function* () {
        const previous = yield* lookup("attemptId", binding.attemptId);
        if (previous) {
          if (previous.assemblyId !== binding.assemblyId || previous.tenantId !== binding.tenantId || previous.fileId !== binding.fileId || previous.digest !== binding.digest) return yield* Effect.fail(persistenceError());
          return;
        }
        yield* Effect.try({ try: () => { db.prepare("INSERT INTO provider_bindings VALUES (?, ?, ?, ?, ?)").run(binding.attemptId, binding.assemblyId, binding.tenantId, binding.fileId, binding.digest); }, catch: persistenceError });
      }),
      close: () => Effect.try({ try: () => db.close(), catch: persistenceError }),
    } satisfies AssemblyRegistry & { readonly close: () => Effect.Effect<void, IntakeError> };
  },
  catch: persistenceError,
});
