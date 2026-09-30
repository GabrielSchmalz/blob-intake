import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import { Effect } from "effect";
import { IntakeError,MAX_BYTES,type ProviderEvent } from "../contract/index";
import { databaseEffect } from "../persistence/postgres";
import { createClamClient,ScannerError,type ClamOptions } from "./clamav";
import { createScannerQueue,decryptSource,initializeScanner,scannerTables,signScannerCallback,validPrivateSourceUrl,type QueueOptions,type ScanTask } from "./queue";

export interface WorkerOptions extends QueueOptions {readonly blobToken:string;readonly callbackUrl:string;readonly clam:Omit<ClamOptions,"now">;readonly fetch?:typeof fetch;readonly blobGet?:typeof get}
const storageError=()=>new ScannerError({reason:"storage"});
const eventFor=(task:ScanTask,outcome:ProviderEvent["outcome"],reason:ProviderEvent["reason"]):ProviderEvent=>({eventId:`scan:${createHash("sha256").update(task.data.attemptId).digest("hex")}`,attemptId:task.data.attemptId,digest:task.data.digest,outcome,reason});
const boundedBytes=async(stream:ReadableStream<Uint8Array>,advertisedSize:number|null)=>{
 if(advertisedSize!==null&&advertisedSize>MAX_BYTES)throw new ScannerError({reason:"size"});
 const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_BYTES)throw new ScannerError({reason:"size"});chunks.push(part.value);}return Buffer.concat(chunks);}finally{await reader.cancel();}
};
const readSource=(options:WorkerOptions,task:ScanTask)=>Effect.tryPromise({try:async(signal)=>{
 let bytes:Uint8Array;let declaredType:string;
 if(task.data.source.kind==="pathname"){
  const result=await (options.blobGet??get)(task.data.source.pathname,{token:options.blobToken,access:"private",useCache:false,abortSignal:signal});
  if(!result||result.statusCode!==200)throw storageError();declaredType=result.blob.contentType;bytes=await boundedBytes(result.stream,result.blob.size);
 }else{
  if(task.data.source.validUntil<=options.now())throw new ScannerError({reason:"expired"});
  const url=decryptSource(task.data.source.ciphertext,options.callbackSecret);if(!validPrivateSourceUrl(url))throw storageError();const response=await (options.fetch??fetch)(url,{method:"GET",redirect:"error",signal,cache:"no-store"});
  if(!response.ok||!response.body)throw storageError();declaredType=response.headers.get("content-type")??"";
  const sizeHeader=response.headers.get("content-length");bytes=await boundedBytes(response.body,sizeHeader===null?null:Number(sizeHeader));
 }
 if(declaredType!==task.data.declaredType)throw new ScannerError({reason:"mismatch"});
 validateScanBytes(bytes,task.data.declaredType,task.data.digest);
 return bytes;
},catch:error=>error instanceof ScannerError?error:storageError()}).pipe(Effect.timeoutFail({duration:20_000,onTimeout:storageError}));
export function validateScanBytes(bytes:Uint8Array,declaredType:string,digest:string):void{
 if(bytes.length>MAX_BYTES)throw new ScannerError({reason:"size"});
 const mime=bytes.length>=5&&Buffer.from(bytes.subarray(0,5)).toString()==="%PDF-"?"application/pdf":bytes.length>=8&&Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?"image/jpeg":null;
 if(mime===null)throw new ScannerError({reason:"type"});if(mime!==declaredType)throw new ScannerError({reason:"mismatch"});
 if(createHash("sha256").update(bytes).digest("hex")!==digest)throw new ScannerError({reason:"changed"});
}
export interface WorkerTickOptions {readonly deliverCallbacks?:boolean;readonly attemptId?:string}
export const createScannerWorker=(options:WorkerOptions)=>Effect.gen(function*(){
 const callbackUrl=yield* Effect.try({try:()=>new URL(options.callbackUrl),catch:()=>new IntakeError({code:"provider"})});
 if(callbackUrl.protocol!=="https:"||callbackUrl.username||callbackUrl.password||callbackUrl.hash||callbackUrl.port||options.callbackSecret.length<32)return yield* Effect.fail(new IntakeError({code:"provider"}));
 yield* initializeScanner(options);const queue=createScannerQueue(options);const clam=createClamClient({...options.clam,now:options.now});const tables=scannerTables(options.schema);
 const dispatchCallback=(attemptId?:string)=>Effect.gen(function*(){
  const task=yield* queue.callbackPending(attemptId);if(!task||!task.event)return false;
  const body=JSON.stringify({issuedAt:options.now(),event:task.event});
  const signature=signScannerCallback(body,options.callbackSecret);
  const delivered=yield* Effect.tryPromise({try:async(signal)=>{
   const response=await (options.fetch??fetch)(callbackUrl,{method:"POST",headers:{"Content-Type":"application/json","x-intake-signature":signature},body,redirect:"error",signal});
   await response.body?.cancel();return response.ok;
  },catch:()=>new IntakeError({code:"provider"})}).pipe(Effect.timeoutFail({duration:10_000,onTimeout:()=>new IntakeError({code:"provider"})}),Effect.catchAll(()=>Effect.succeed(false)));
  if(delivered)yield* queue.markCallbackDelivered(task.data.attemptId);return delivered;
 });
 const runOnce=(tick:WorkerTickOptions={})=>Effect.gen(function*(){
  const task=yield* queue.claim(tick.attemptId);let outcome:string|null=null;
  if(task){
   if(task.tries>3){yield* queue.finish(task,eventFor(task,"failed","outage"));outcome="failed";}
   else{
    const result=yield* Effect.gen(function*(){
     const health=yield* clam.health();
     yield* databaseEffect(async()=>{await options.pool.query(`INSERT INTO ${tables.health} VALUES(1,$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET engine=EXCLUDED.engine,signature_version=EXCLUDED.signature_version,signature_built_at=EXCLUDED.signature_built_at,checked_at=EXCLUDED.checked_at`,[health.engine,health.signatureVersion,health.signatureBuiltAt,health.checkedAt]);});
     const bytes=yield* readSource(options,task);const verdict=yield* clam.scan(bytes);
     if(options.now()-health.signatureBuiltAt>(options.clam.maximumSignatureAgeMs??72*60*60_000))return yield* Effect.fail(new ScannerError({reason:"stale"}));return verdict;
    }).pipe(Effect.either);
    if(result._tag==="Right"){const applied=yield* queue.finish(task,eventFor(task,result.right,result.right==="threat"?"threat":null));outcome=applied?result.right:"lease_lost";}
    else{
     const reason=result.left instanceof ScannerError?result.left.reason:"scan";
     const permanent=reason==="changed"||reason==="expired"||reason==="mismatch"||reason==="type"||reason==="size";
     if(permanent||task.tries>=3){const why=permanent?reason:"outage";const applied=yield* queue.finish(task,eventFor(task,"failed",why));outcome=applied?"failed":"lease_lost";}
     else{const applied=yield* queue.retry(task);outcome=applied?"retry":"lease_lost";}
    }
   }
  }
  const callbackDelivered=tick.deliverCallbacks===false?false:yield* dispatchCallback(tick.attemptId);return {processed:task!==null,outcome,callbackDelivered};
 });
 return {runOnce,dispatchCallback};
});
