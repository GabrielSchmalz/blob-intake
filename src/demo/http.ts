import { Effect, Schema } from "effect";
import { IntakeError } from "../contract/index";
import { Arm, act, download, guard, state, upload } from "./runtime";

const parseArm = (value: unknown) => Schema.decodeUnknown(Arm)(value).pipe(Effect.mapError(() => new IntakeError({ code: "denied" })));
const bodyTooLarge = new IntakeError({ code: "storage" });
const readBody = (request: Request, limit: number) => Effect.gen(function* () {
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  return yield* Effect.acquireUseRelease(Effect.succeed(reader), reader => Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => new IntakeError({ code: "storage" }) });
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) return yield* Effect.fail(bodyTooLarge);
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }), reader => Effect.tryPromise({ try: () => reader.cancel(), catch: () => new IntakeError({ code: "storage" }) }).pipe(Effect.ignore));
});
export function handleDemo(request: Request, operation: "state" | "upload" | "action" | "download"): Promise<Response> {
  if (!guard(request, operation === "upload" || operation === "action")) return Promise.resolve(Response.json({ error: "Local demo access requires a loopback host and same-origin mutations." }, { status: 403 }));
  const program = Effect.gen(function* () {
    const url = new URL(request.url);
    if (operation === "action") {
      const bytes = yield* readBody(request, 8192);
      const input: unknown = yield* Schema.decodeUnknown(Schema.parseJson(Schema.Unknown))(new TextDecoder().decode(bytes)).pipe(Effect.mapError(() => new IntakeError({ code: "denied" })));
      return Response.json({ result: yield* act(input) });
    }
    if (operation === "upload") {
      const length = Number(request.headers.get("content-length"));
      if (length > 21 * 1024 * 1024) return Response.json({ error: "Maximum upload is 20 MiB." }, { status: 413 });
      const bytes = yield* readBody(request, 21 * 1024 * 1024);
      const form = yield* Effect.tryPromise({ try: () => new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(), catch: () => new IntakeError({ code: "storage" }) });
      const arm = yield* parseArm(form.get("arm"));
      const file = form.get("file");
      if (file instanceof File && file.size > 20 * 1024 * 1024) return Response.json({ error: "Maximum upload is 20 MiB." }, { status: 413 });
      if (!(file instanceof File)) return yield* Effect.fail(new IntakeError({ code: "storage" }));
      return Response.json({ result: yield* upload(arm, file) });
    }
    const arm = yield* parseArm(url.searchParams.get("arm"));
    if (operation === "state") return Response.json(yield* state(arm), { headers: { "Cache-Control": "no-store" } });
    const fileId = url.searchParams.get("fileId");
    if (!fileId || fileId.length > 100) return yield* Effect.fail(new IntakeError({ code: "not_found" }));
    const file = yield* download(arm, fileId);
    return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  });
  return Effect.runPromise(program.pipe(Effect.catchAll(error => Effect.succeed(Response.json({ error: error.code }, { status: error === bodyTooLarge ? 413 : error.code === "denied" ? 403 : error.code === "not_found" ? 404 : error.code === "inaccessible" ? 409 : 400 })))));
}
