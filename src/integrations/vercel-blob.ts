import { createHash } from "node:crypto";
import { get, issueSignedToken, presignUrl } from "@vercel/blob";
import { Effect } from "effect";
import { IntakeError, MAX_BYTES, type AuthContext, type Storage, type Submission } from "../contract/index";
import type { ScopedSource } from "./transloadit";

/** Resolve using authenticated app metadata; upload JSON cannot supply path/tenant. */
export interface PrivateBlobReference { readonly pathname: string; readonly digest: string }
export interface BlobOptions {
  readonly token: string;
  readonly resolve: (context: AuthContext, fileId: string) => Effect.Effect<PrivateBlobReference, IntakeError>;
  readonly resolveSource: (tenantId: string, fileId: string) => Effect.Effect<PrivateBlobReference, IntakeError>;
  readonly now: () => number;
  readonly timeoutMs?: number;
  readonly sdk?: { readonly get: typeof get; readonly issueSignedToken: typeof issueSignedToken; readonly presignUrl: typeof presignUrl };
}
const storageError = () => new IntakeError({ code: "storage" });
const validateReference = (reference: PrivateBlobReference) => {
  const parts = reference.pathname.split("/");
  return reference.pathname.length > 0 && !reference.pathname.includes(":") && !reference.pathname.includes("\\")
    && !reference.pathname.includes("*") && !parts.some((part) => part === "" || part === "." || part === "..")
    && /^[0-9a-f]{64}$/.test(reference.digest);
};
export const createPrivateBlobIntegration = (options: BlobOptions): {
  readonly storage: Storage;
  readonly source: (submission: Submission) => Effect.Effect<ScopedSource, IntakeError>;
} => {
  const sdk = options.sdk ?? { get, issueSignedToken, presignUrl };
  const reference = (context: AuthContext, fileId: string) => options.resolve(context, fileId).pipe(
    Effect.flatMap((value) => validateReference(value) ? Effect.succeed(value) : Effect.fail(storageError())),
  );
  return {
    storage: {
      read: (context, fileId) => Effect.gen(function* () {
        const ref = yield* reference(context, fileId);
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const result = await sdk.get(ref.pathname, { access: "private", token: options.token, useCache: false, abortSignal: signal });
            if (!result || result.statusCode !== 200) throw new Error("missing blob");
            const reader = result.stream.getReader();
            try {
              if (result.blob.size > MAX_BYTES) throw new Error("size");
              const chunks: Uint8Array[] = [];
              let size = 0;
              for (;;) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.byteLength;
                if (size > MAX_BYTES) throw new Error("size");
                chunks.push(part.value);
              }
              const bytes = Buffer.concat(chunks);
              if (createHash("sha256").update(bytes).digest("hex") !== ref.digest) throw new Error("changed blob");
              return { bytes, declaredType: result.blob.contentType };
            } finally { await reader.cancel(); }
          },
          catch: storageError,
        }).pipe(Effect.timeoutFail({ duration: options.timeoutMs ?? 10_000, onTimeout: storageError }));
      }),
    },
    source: (submission) => Effect.gen(function* () {
      // The backend already established tenant authority when submitting. This
      // resolver must authorize service access for that tenant, never wildcard it.
      const ref = yield* options.resolveSource(submission.tenantId, submission.fileId);
      if (!validateReference(ref)) return yield* Effect.fail(storageError());
      if (ref.digest !== submission.digest || createHash("sha256").update(submission.bytes).digest("hex") !== submission.digest) return yield* Effect.fail(storageError());
      const validUntil = options.now() + 15 * 60_000;
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const signed = await sdk.issueSignedToken({ pathname: ref.pathname, operations: ["get"], validUntil, token: options.token, abortSignal: signal });
          const url = await sdk.presignUrl(signed, { operation: "get", pathname: ref.pathname, validUntil: Math.min(validUntil, signed.validUntil), access: "private", useCache: false });
          return { url: url.presignedUrl, digest: ref.digest, validUntil: Math.min(validUntil, signed.validUntil) };
        },
        catch: storageError,
      }).pipe(Effect.timeoutFail({ duration: options.timeoutMs ?? 10_000, onTimeout: storageError }));
    }),
  };
};
