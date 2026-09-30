import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { IntakeError, MAX_BYTES, type Provider, type Submission } from "../contract/index";
import type { ScopedSource } from "./transloadit";
const Identifier=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(128),Schema.pattern(/^[A-Za-z0-9._:-]+$/));
const Digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const ManagedScanSubmission=Schema.Struct({attemptId:Identifier,fileId:Identifier,digest:Digest,declaredType:Schema.Literal("application/pdf","image/png","image/jpeg"),source:Schema.Struct({url:Schema.String.pipe(Schema.maxLength(8192)),validUntil:Schema.Number.pipe(Schema.finite())})});
export type ManagedScanSubmission=typeof ManagedScanSubmission.Type;
const Event=Schema.Struct({eventId:Identifier,attemptId:Identifier,digest:Digest,outcome:Schema.Literal("clean","threat","failed","unknown"),reason:Schema.NullOr(Schema.Literal("type","size","mismatch","threat","outage","expired","unknown","conflict","changed"))});
const failure=()=>new IntakeError({code:"provider"});
export const validateManagedSource=(source:ManagedScanSubmission["source"],now:number)=>Effect.try({try:()=>{
 const url=new URL(source.url);
 if(source.url.length>8192||url.protocol!=="https:"||url.port!==""||url.username!==""||url.password!==""||url.hash!==""||! /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/.test(url.hostname)||url.pathname==="/"||source.validUntil<now+60000||source.validUntil>now+15*60000)throw new Error("invalid scoped source");
 return source;
},catch:failure});
export interface ManagedScannerOptions {readonly apiKey:string;readonly baseUrl:string;readonly source:(request:Submission)=>Effect.Effect<ScopedSource,IntakeError>;readonly fetch?:typeof fetch;readonly now?:()=>number;readonly timeoutMs?:number}
/** Remote managed scanning; original bytes remain in the developer's private Blob. */
export const createManagedScannerProvider=(options:ManagedScannerOptions):Provider=>{
 const now=options.now??Date.now;const http=options.fetch??fetch;
 const endpoint=(path:string)=>Effect.try({try:()=>{const url=new URL(options.baseUrl);if(url.protocol!=="https:"||url.username||url.password||url.pathname!=="/"||url.search||url.hash||options.apiKey.length<24||options.apiKey.length>256)throw new Error("invalid configuration");return `${url.origin}/api/scans${path}`;},catch:failure});
 const request=<A,I>(path:string,schema:Schema.Schema<A,I>,body?:ManagedScanSubmission)=>Effect.gen(function*(){
  const url=yield* endpoint(path);
  const raw=yield* Effect.tryPromise({try:async(signal)=>{
   const response=await http(url,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${options.apiKey}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,redirect:"error",signal});
   if(!response.ok||!response.body)throw new Error("service unavailable");
   const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
   try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)throw new Error("response limit");chunks.push(part.value);}return Buffer.concat(chunks).toString();}finally{await reader.cancel();}
  },catch:failure}).pipe(Effect.timeoutFail({duration:options.timeoutMs??10000,onTimeout:failure}));
  return yield* Schema.decodeUnknown(Schema.parseJson(schema))(raw).pipe(Effect.mapError(failure));
 });
 return {
  submit:submission=>Effect.gen(function*(){
   if(submission.bytes.byteLength>MAX_BYTES||createHash("sha256").update(submission.bytes).digest("hex")!==submission.digest)return yield* Effect.fail(new IntakeError({code:"storage"}));
   const source=yield* options.source(submission);
   if(source.digest!==submission.digest)return yield* Effect.fail(new IntakeError({code:"storage"}));
   yield* validateManagedSource(source,now());
   const body=yield* Schema.decodeUnknown(ManagedScanSubmission)({attemptId:submission.attemptId,fileId:submission.fileId,digest:submission.digest,declaredType:submission.declaredType,source:{url:source.url,validUntil:source.validUntil}}).pipe(Effect.mapError(failure));
   const result=yield* request("",Schema.Struct({attemptId:Identifier}),body);if(result.attemptId!==submission.attemptId)return yield* Effect.fail(failure());return result.attemptId;
  }),
  poll:attemptId=>Effect.gen(function*(){yield* Schema.decodeUnknown(Identifier)(attemptId).pipe(Effect.mapError(failure));const result=yield* request(`?attemptId=${encodeURIComponent(attemptId)}`,Schema.Struct({event:Schema.NullOr(Event)}));if(result.event&&result.event.attemptId!==attemptId)return yield* Effect.fail(failure());return result.event;}),
  verifyCallback:()=>Effect.fail(new IntakeError({code:"invalid_callback"})),
 };
};
