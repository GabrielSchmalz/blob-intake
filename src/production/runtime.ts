import { createHash, randomUUID } from "node:crypto";
import { get, issueSignedToken, presignUrl } from "@vercel/blob";
import { Effect } from "effect";
import { Pool } from "pg";
import { IntakeError, MAX_BYTES, type AuthContext } from "../contract/index";
import { createPrivateBlobIntegration } from "../integrations/vercel-blob";
import { createPostgresFiles, initializePostgres } from "../persistence/postgres";
import { createPostgresIntake } from "./acceptance";
import { createProductionProvider } from "./provider";
const failure=()=>new IntakeError({code:"storage"});
let pool:Pool|undefined;
let initialized=false;
export const productionRuntime=()=>Effect.gen(function*(){
  if(!process.env.DATABASE_URL||!process.env.BLOB_READ_WRITE_TOKEN)return yield* Effect.fail(new IntakeError({code:"persistence"}));
  pool??=new Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  const options={pool,schema:process.env.BLOB_INTAKE_SCHEMA??"blob_intake"};
  if(!initialized){yield* initializePostgres(options);initialized=true;}
  const files=createPostgresFiles(options);const token=process.env.BLOB_READ_WRITE_TOKEN;
  const owned=(ctx:AuthContext,fileId:string)=>files.getOwnedFile(ctx,fileId).pipe(Effect.flatMap(file=>file?Effect.succeed(file):Effect.fail(new IntakeError({code:"not_found"}))));
  const blobs=createPrivateBlobIntegration({token,now:Date.now,resolve:(ctx,id)=>owned(ctx,id).pipe(Effect.flatMap(file=>file.digest?Effect.succeed({pathname:file.pathname,digest:file.digest}):Effect.fail(failure()))),resolveSource:(tenant,id)=>files.resolveSource(tenant,id).pipe(Effect.flatMap(file=>file?.digest?Effect.succeed({pathname:file.pathname,digest:file.digest}):Effect.fail(failure())))});
  const provider=yield* createProductionProvider({...options,now:Date.now,resolveSource:(tenant,id,digest)=>files.resolveSource(tenant,id).pipe(Effect.flatMap(file=>file?.digest===digest?Effect.succeed({pathname:file.pathname,digest}):Effect.fail(failure())))});
  const app=yield* createPostgresIntake({...options,storage:blobs.storage,provider,clock:{now:Date.now},initialize:false});
  const finish=(ctx:AuthContext,fileId:string)=>Effect.gen(function*(){
    const file=yield* owned(ctx,fileId);
    const actual=yield* Effect.tryPromise({try:async(signal)=>{
      const result=await get(file.pathname,{token,access:"private",useCache:false,abortSignal:signal});
      if(!result||result.statusCode!==200||result.blob.size>MAX_BYTES||result.blob.contentType!==file.declaredType)throw new Error("file");
      const reader=result.stream.getReader();const chunks:Uint8Array[]=[];let size=0;
      try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_BYTES)throw new Error("size");chunks.push(part.value);}return createHash("sha256").update(Buffer.concat(chunks)).digest("hex");}finally{await reader.cancel();}
    },catch:failure}).pipe(Effect.timeoutFail({duration:15000,onTimeout:failure}));
    yield* files.completeFile(ctx,fileId,actual,null);
    const job=yield* app.register(ctx,fileId);
    yield* files.completeFile(ctx,fileId,actual,job.jobId);
    return yield* app.submit(ctx,job.jobId);
  });
  return {app,files,owned,token,finish,
    prepare:(ctx:AuthContext,name:string,declaredType:string)=>Effect.gen(function*(){const fileId=randomUUID(),pathname=`intake/${randomUUID()}/${fileId}`;yield* files.storePendingFile(ctx,{fileId,pathname,name,declaredType});return {fileId,pathname};}),
    download:(ctx:AuthContext,fileId:string)=>Effect.gen(function*(){const file=yield* owned(ctx,fileId);yield* app.deliver(ctx,fileId);const validUntil=Date.now()+60000;return yield* Effect.tryPromise({try:async()=>{const signed=await issueSignedToken({token,pathname:file.pathname,operations:["get"],validUntil});const result=await presignUrl(signed,{pathname:file.pathname,operation:"get",access:"private",validUntil:Math.min(validUntil,signed.validUntil),useCache:false});return {url:result.presignedUrl,expiresAt:Math.min(validUntil,signed.validUntil)};},catch:failure});})};
});
export type ProductionRuntime=Effect.Effect.Success<ReturnType<typeof productionRuntime>>;
