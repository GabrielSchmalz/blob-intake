import { createHash } from "node:crypto";
import { Effect,Schema } from "effect";
import type { Pool } from "pg";
import { IntakeError,type Provider } from "../contract/index";
import { createScannerQueue,initializeScanner,TaskBinding } from "../scanner/queue";

export interface ProductionProviderOptions {
 readonly pool:Pool;readonly schema:string;
 readonly resolveSource:(tenantId:string,fileId:string,digest:string)=>Effect.Effect<{readonly pathname:string;readonly digest:string},IntakeError>;
 readonly now:()=>number;
 readonly callbackSecret?:string;
}
const initialized=new WeakMap<Pool,Set<string>>();
const fail=()=>new IntakeError({code:"provider"});
/** Managed scanner queue. Only verified worker results can approve content. */
export const createProductionProvider=(options:ProductionProviderOptions):Effect.Effect<Provider,IntakeError>=>Effect.gen(function*(){
 const callbackSecret=options.callbackSecret??process.env.CALLBACK_SECRET;
 if(!callbackSecret||callbackSecret.length<32)return yield* Effect.fail(fail());
 const queueOptions={...options,callbackSecret};
 let schemas=initialized.get(options.pool);if(!schemas){schemas=new Set();initialized.set(options.pool,schemas);}
 if(!schemas.has(options.schema)){yield* initializeScanner(queueOptions);schemas.add(options.schema);}
 const queue=createScannerQueue(queueOptions);
 return {
  submit:request=>Effect.gen(function*(){
   if(createHash("sha256").update(request.bytes).digest("hex")!==request.digest)return yield* Effect.fail(new IntakeError({code:"storage"}));
   const source=yield* options.resolveSource(request.tenantId,request.fileId,request.digest);
   const parts=source.pathname.split("/");
   if(source.digest!==request.digest||!source.pathname||source.pathname.includes(":")||source.pathname.includes("\\")||source.pathname.includes("*")||parts.some(part=>part===""||part==="."||part===".."))return yield* Effect.fail(new IntakeError({code:"storage"}));
   const declaredType=yield* Schema.decodeUnknown(TaskBinding.fields.declaredType)(request.declaredType).pipe(Effect.mapError(fail));
   return yield* queue.enqueue({attemptId:request.attemptId,tenantId:request.tenantId,ownerId:null,fileId:request.fileId,digest:request.digest,declaredType,sourceIdentity:createHash("sha256").update(JSON.stringify([source.pathname,request.digest])).digest("hex"),source:{kind:"pathname",pathname:source.pathname},callbackEnabled:true});
  }),
  poll:queue.pollInternal,
  verifyCallback:raw=>queue.verifyCallback(raw.body,raw.signature),
 };
});
