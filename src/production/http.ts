import { handleUpload } from "@vercel/blob/client";
import { Effect, Schema } from "effect";
import { IntakeError, MAX_BYTES } from "../contract/index";
import { authenticate, authenticateKey, constantEqual, sameOrigin, sessionCookie, type AuthConfiguration } from "./auth";
import { productionRuntime, type ProductionRuntime } from "./runtime";
const Id=Schema.String.pipe(Schema.pattern(/^[a-f0-9-]{36}$/));
const Mime=Schema.Literal("application/pdf","image/png","image/jpeg");
const Prepare=Schema.Struct({name:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(240)),declaredType:Mime});
const FileInput=Schema.Struct({fileId:Id});
const Action=Schema.Struct({jobId:Id,action:Schema.Literal("retry")});
const UploadBody=Schema.Union(Schema.Struct({type:Schema.Literal("blob.generate-client-token"),payload:Schema.Struct({pathname:Schema.String,multipart:Schema.Boolean,clientPayload:Schema.NullOr(Schema.String)})}),Schema.Struct({type:Schema.Literal("blob.upload-completed"),payload:Schema.Struct({blob:Schema.Struct({url:Schema.String,downloadUrl:Schema.String,pathname:Schema.String,contentType:Schema.String,contentDisposition:Schema.String,etag:Schema.String}),tokenPayload:Schema.optional(Schema.NullOr(Schema.String))})}));
const TokenPayload=Schema.Struct({fileId:Id,tenantId:Schema.NonEmptyString,userId:Schema.NonEmptyString});
const deny=()=>new IntakeError({code:"denied"});
export const readBoundedBody=(request:Request,limit:number)=>Effect.gen(function*(){
  if(Number(request.headers.get("content-length"))>limit)return yield* Effect.fail(deny());
  if(!request.body)return "";
  const reader=request.body.getReader();
  return yield* Effect.acquireUseRelease(Effect.succeed(reader),reader=>Effect.gen(function*(){const chunks:Uint8Array[]=[];let size=0;for(;;){const part=yield* Effect.tryPromise({try:()=>reader.read(),catch:deny});if(part.done)break;size+=part.value.length;if(size>limit)return yield* Effect.fail(deny());chunks.push(part.value);}return Buffer.concat(chunks).toString();}),reader=>Effect.tryPromise({try:()=>reader.cancel(),catch:deny}).pipe(Effect.ignore));
});
const json=<A,I>(schema:Schema.Schema<A,I>,body:string)=>Schema.decodeUnknown(Schema.parseJson(schema))(body).pipe(Effect.mapError(deny));
export const parseUploadBody=(body:string)=>json(Schema.Unknown,body).pipe(Effect.flatMap(value=>Schema.is(UploadBody)(value)?Effect.succeed(value):Effect.fail(deny())));
export type Operation="session"|"prepare"|"upload"|"finish"|"state"|"action"|"download"|"callback"|"reconcile";
export interface HttpDependencies { readonly auth?:AuthConfiguration; readonly runtime?:()=>Effect.Effect<ProductionRuntime,IntakeError> }
export function handleIntake(request:Request,operation:Operation,deps:HttpDependencies={}):Promise<Response>{
 const auth=deps.auth??{keysJson:process.env.BLOB_INTAKE_KEYS_JSON,sessionSecret:process.env.SESSION_SECRET};
 const program=Effect.gen(function*(){
  if(operation==="session"){
   if(!sameOrigin(request))return yield* Effect.fail(deny());
   if(request.method==="DELETE")return Response.json({ok:true},{headers:{"Set-Cookie":"intake_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"}});
   const input=yield* json(Schema.Struct({key:Schema.String}),yield* readBoundedBody(request,1024));
   const context=yield* authenticateKey(input.key,auth);const cookie=yield* sessionCookie(context,auth);
   return Response.json({ok:true},{headers:{"Set-Cookie":cookie}});
  }
  if(operation==="callback"){
   const body=yield* readBoundedBody(request,65536);const signature=request.headers.get("x-intake-signature")??"";
   const runtime=yield* (deps.runtime??productionRuntime)();
   return Response.json(yield* runtime.app.callback({body,signature}));
  }
  let uploadBody:typeof UploadBody.Type|undefined;
  if(operation==="upload")uploadBody=yield* parseUploadBody(yield* readBoundedBody(request,16384));
  // Blob completion callbacks are authenticated by the official Blob SDK, not a browser session.
  if(uploadBody?.type==="blob.upload-completed"){
   const runtime=yield* (deps.runtime??productionRuntime)();
   const result=yield* Effect.tryPromise({try:()=>handleUpload({request,body:uploadBody,token:runtime.token,onBeforeGenerateToken:async()=>{throw new Error("denied");},onUploadCompleted:async payload=>{
    const binding=yieldPayload(payload.tokenPayload);await Effect.runPromise(Effect.gen(function*(){const file=yield* runtime.owned(binding,binding.fileId);if(file.pathname!==payload.blob.pathname)return yield* Effect.fail(deny());yield* runtime.finish(binding,binding.fileId);}));
   }}),catch:deny});return Response.json(result);
  }
  if(operation==="reconcile"&&process.env.CRON_SECRET&&constantEqual(request.headers.get("authorization")??"",`Bearer ${process.env.CRON_SECRET}`)){const runtime=yield* (deps.runtime??productionRuntime)();return Response.json({reconciled:yield* runtime.app.reconcile()});}
  if(operation==="reconcile"&&request.method!=="POST")return yield* Effect.fail(deny());
  const context=yield* authenticate(request,auth,!["state","download"].includes(operation));
  const runtime=yield* (deps.runtime??productionRuntime)();
  if(operation==="state"){
   const files=yield* runtime.files.listOwnedFiles(context);
   const result=yield* Effect.forEach(files,file=>Effect.gen(function*(){const status=file.jobId?yield* runtime.app.status(context,file.jobId).pipe(Effect.catchAll(()=>Effect.succeed(null))):null;return {fileId:file.fileId,name:file.name,declaredType:file.declaredType,job:status?{jobId:status.jobId,state:status.state,reason:status.reason,updatedAt:status.updatedAt}:null};}));
   return Response.json({files:result});
  }
  if(operation==="prepare"){const input=yield* json(Prepare,yield* readBoundedBody(request,2048));if(/[\u0000-\u001f]/.test(input.name))return yield* Effect.fail(deny());return Response.json(yield* runtime.prepare(context,input.name,input.declaredType));}
  if(operation==="upload"){
   if(uploadBody?.type!=="blob.generate-client-token")return yield* Effect.fail(deny());
   const body=uploadBody;
   return Response.json(yield* Effect.tryPromise({try:()=>handleUpload({request,body,token:runtime.token,onBeforeGenerateToken:async(pathname,payload)=>Effect.runPromise(Effect.gen(function*(){const input=yield* json(FileInput,payload??"");const file=yield* runtime.owned(context,input.fileId);if(pathname!==file.pathname||file.digest!==null)return yield* Effect.fail(deny());return {maximumSizeInBytes:MAX_BYTES,allowedContentTypes:[file.declaredType],allowOverwrite:false,addRandomSuffix:false,validUntil:Date.now()+300000,tokenPayload:JSON.stringify({...context,fileId:input.fileId})};})),onUploadCompleted:async()=>{throw new Error("wrong event");}}),catch:deny}));
  }
  if(operation==="finish"){const input=yield* json(FileInput,yield* readBoundedBody(request,1024));const job=yield* runtime.finish(context,input.fileId);return Response.json({job:{jobId:job.jobId,state:job.state,reason:job.reason}});}
  if(operation==="action"){const input=yield* json(Action,yield* readBoundedBody(request,1024));const job=yield* runtime.app.retry(context,input.jobId);return Response.json({job:{jobId:job.jobId,state:job.state,reason:job.reason}});}
  if(operation==="reconcile")return Response.json({reconciled:yield* runtime.app.reconcileFor(context)});
  const fileId=new URL(request.url).searchParams.get("fileId");const id=yield* Schema.decodeUnknown(Id)(fileId).pipe(Effect.mapError(deny));return Response.json(yield* runtime.download(context,id));
 });
 return Effect.runPromise(program.pipe(Effect.catchAll(error=>Effect.succeed(Response.json({error:error.code},{status:error.code==="denied"||error.code==="invalid_callback"?403:error.code==="not_found"?404:error.code==="inaccessible"?409:503}))),Effect.map(response=>{response.headers.set("Cache-Control","no-store");response.headers.set("X-Content-Type-Options","nosniff");return response;})));
}
function yieldPayload(payload:string|null|undefined){return Schema.decodeUnknownSync(Schema.parseJson(TokenPayload))(payload??"");}
