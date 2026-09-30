import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";
import { IntakeError, MAX_BYTES, type Provider, type ProviderEvent, type Submission } from "../contract/index.js";

export interface AssemblyBinding {
  readonly attemptId: string;
  readonly assemblyId: string;
  readonly digest: string;
  readonly fileId: string;
  readonly tenantId: string;
}
/** App-owned durable storage. Never store signed source URLs or response bodies. */
export interface AssemblyRegistry {
  readonly byAttempt: (id: string) => Effect.Effect<AssemblyBinding | null, IntakeError>;
  readonly byAssembly: (id: string) => Effect.Effect<AssemblyBinding | null, IntakeError>;
  readonly save: (binding: AssemblyBinding) => Effect.Effect<void, IntakeError>;
}
export interface ScopedSource {
  readonly url: string;
  readonly digest: string;
  readonly validUntil: number;
}
export interface TransloaditOptions {
  readonly authKey: string;
  readonly authSecret: string;
  readonly notifyUrl: string;
  readonly registry: AssemblyRegistry;
  readonly source: (submission: Submission) => Effect.Effect<ScopedSource, IntakeError>;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly timeoutMs?: number;
}
const HexId = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{32}$/));
const FileResult = Schema.Struct({
  original_id: Schema.String,
  mime: Schema.String,
  meta: Schema.optional(Schema.Struct({ hash: Schema.optional(Schema.String), hash_partial: Schema.optional(Schema.String) })),
});
const Status = Schema.Struct({
  assembly_id: HexId,
  ok: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  step: Schema.optional(Schema.String),
  ignored_error_count: Schema.optional(Schema.Number),
  ignored_errors: Schema.optional(Schema.Array(Schema.Unknown)),
  results: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Array(FileResult) })),
});
const providerError = () => new IntakeError({ code: "provider" });
const callbackError = () => new IntakeError({ code: "invalid_callback" });
const parse = (body: string) => Schema.decodeUnknown(Schema.parseJson(Status))(body).pipe(Effect.mapError(callbackError));

export const createTransloaditProvider = (options: TransloaditOptions): Provider => {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const request = (url: string, init: RequestInit) => Effect.tryPromise({
    try: async (signal) => {
      const response = await options.fetch(url, { ...init, signal, redirect: "error" });
      if (!response.ok) throw new Error("provider response");
      // Bound the status payload independently of the uploaded file size.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("empty status");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1024 * 1024) throw new Error("oversized status");
          chunks.push(part.value);
        }
        return Buffer.concat(chunks).toString("utf8");
      } finally { await reader.cancel(); }
    },
    catch: providerError,
  }).pipe(Effect.timeoutFail({ duration: timeoutMs, onTimeout: providerError }));
  const event = (status: typeof Status.Type, binding: AssemblyBinding): ProviderEvent => {
    const base = { eventId: createHash("sha256").update(JSON.stringify(status)).digest("hex"), attemptId: binding.attemptId, digest: binding.digest };
    if (status.assembly_id !== binding.assemblyId) return { ...base, outcome: "unknown", reason: "conflict" };
    if (status.error) return { ...base, outcome: "failed", reason: "outage" };
    if (status.ok !== "ASSEMBLY_COMPLETED") return { ...base, outcome: "unknown", reason: "unknown" };
    if ((status.ignored_error_count ?? 0) !== 0 || (status.ignored_errors?.length ?? 0) !== 0) return { ...base, outcome: "unknown", reason: "unknown" };
    const verified = status.results?.verified;
    const scanned = status.results?.scanned;
    const hashed = status.results?.hashed;
    const first = verified?.[0];
    const scan = scanned?.[0];
    const hash = hashed?.[0];
    if (verified?.length !== 1 || scanned?.length !== 1 || hashed?.length !== 1 || !first || !scan || !hash
      || first.original_id !== scan.original_id || first.original_id !== hash.original_id
      || !["application/pdf", "image/png", "image/jpeg"].includes(first.mime)
      || scan.mime !== first.mime || hash.mime !== first.mime
      || hash.meta?.hash !== binding.digest || (hash.meta.hash_partial !== undefined && hash.meta.hash_partial !== "full")) {
      return { ...base, outcome: "unknown", reason: "mismatch" };
    }
    return { ...base, outcome: "clean", reason: null };
  };
  return {
    submit: (submission) => Effect.gen(function* () {
      if (createHash("sha256").update(submission.bytes).digest("hex") !== submission.digest) return yield* Effect.fail(providerError());
      const previous = yield* options.registry.byAttempt(submission.attemptId);
      if (previous) {
        if (previous.digest !== submission.digest || previous.fileId !== submission.fileId || previous.tenantId !== submission.tenantId) return yield* Effect.fail(providerError());
        return submission.attemptId;
      }
      const source = yield* options.source(submission);
      const url = yield* Effect.try({ try: () => new URL(source.url), catch: providerError });
      if (source.url.includes("|") || url.hash || url.protocol !== "https:" || !url.hostname.endsWith(".private.blob.vercel-storage.com") || url.username || url.password
        || source.digest !== submission.digest || source.validUntil < options.now() + 60_000) return yield* Effect.fail(providerError());
      if (!["application/pdf", "image/png", "image/jpeg"].includes(submission.declaredType)) return yield* Effect.fail(providerError());
      const params = JSON.stringify({
        auth: { key: options.authKey, expires: new Date(options.now() + 5 * 60_000).toISOString() },
        nonce: randomUUID(), notify_url: options.notifyUrl, quiet: true, notification_payload: ["without_params", "without_uploads"],
        steps: {
          imported: { robot: "/http/import", url: source.url, max_file_size: MAX_BYTES, result: false, interpolate: false },
          verified: { robot: "/file/verify", use: "imported", verify_to_be: submission.declaredType === "application/pdf" ? "pdf" : submission.declaredType, repair_pdf: false, error_on_decline: true, result: true },
          scanned: { robot: "/file/virusscan", use: "verified", error_on_decline: true, result: true },
          hashed: { robot: "/file/hash", use: "scanned", algorithm: "sha256", partial: "full", result: true },
        },
      });
      const form = new FormData();
      form.set("params", params);
      form.set("signature", `sha384:${createHmac("sha384", options.authSecret).update(params).digest("hex")}`);
      const raw = yield* request("https://api2.transloadit.com/assemblies", { method: "POST", body: form });
      const status = yield* parse(raw).pipe(Effect.mapError(providerError));
      if (status.error || !status.ok) return yield* Effect.fail(providerError());
      yield* options.registry.save({ attemptId: submission.attemptId, assemblyId: status.assembly_id, fileId: submission.fileId, tenantId: submission.tenantId, digest: submission.digest });
      return submission.attemptId;
    }),
    poll: (attemptId) => Effect.gen(function* () {
      const binding = yield* options.registry.byAttempt(attemptId);
      if (!binding) return null;
      if (!/^[0-9a-f]{32}$/.test(binding.assemblyId)) return yield* Effect.fail(providerError());
      // Assembly IDs are secret capabilities. Ignore provider-supplied URLs.
      const raw = yield* request(`https://api2.transloadit.com/assemblies/${binding.assemblyId}`, { method: "GET" });
      const status = yield* parse(raw).pipe(Effect.mapError(providerError));
      if (["ASSEMBLY_EXECUTING", "ASSEMBLY_UPLOADING", "ASSEMBLY_REPLAYING"].includes(status.ok ?? "") && !status.error) return null;
      return event(status, binding);
    }),
    verifyCallback: ({ body, signature }) => Effect.gen(function* () {
      if (Buffer.byteLength(body) > 1024 * 1024 || !/^[0-9a-f]{40}$/.test(signature)) return yield* Effect.fail(callbackError());
      const expected = createHmac("sha1", options.authSecret).update(body, "utf8").digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return yield* Effect.fail(callbackError());
      const status = yield* parse(body);
      const binding = yield* options.registry.byAssembly(status.assembly_id);
      if (!binding) return yield* Effect.fail(callbackError());
      return event(status, binding);
    }),
  };
};
