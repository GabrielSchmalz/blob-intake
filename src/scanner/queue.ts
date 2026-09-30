import { createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,randomUUID,timingSafeEqual } from "node:crypto";
import { Effect,Schema } from "effect";
import type { Pool } from "pg";
import { IntakeError,type AuthContext,type ProviderEvent } from "../contract/index";
import { databaseEffect,postgresTransaction,tableNames } from "../persistence/postgres";

const Digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const Id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const Reason=Schema.Literal("type","size","mismatch","threat","outage","expired","unknown","conflict","changed");
export const ScanEvent=Schema.Struct({eventId:Id,attemptId:Id,digest:Digest,outcome:Schema.Literal("clean","threat","failed","unknown"),reason:Schema.NullOr(Reason)});
const Source=Schema.Union(Schema.Struct({kind:Schema.Literal("pathname"),pathname:Schema.String}),Schema.Struct({kind:Schema.Literal("capability"),ciphertext:Schema.String,validUntil:Schema.Number}));
export const TaskBinding=Schema.Struct({attemptId:Id,tenantId:Id,ownerId:Schema.NullOr(Id),fileId:Id,digest:Digest,declaredType:Schema.Literal("application/pdf","image/png","image/jpeg"),sourceIdentity:Digest,source:Source,callbackEnabled:Schema.Boolean});
export type ScanBinding=typeof TaskBinding.Type;
const TaskRow=Schema.Struct({data:TaskBinding,tries:Schema.Number,event:Schema.NullOr(ScanEvent),status:Schema.Literal("queued","leased","completed"),lease_token:Schema.NullOr(Schema.String),lease_until:Schema.NullOr(Schema.NumberFromString)});
export type ScanTask=typeof TaskRow.Type;
export interface QueueOptions {readonly pool:Pool;readonly schema:string;readonly now:()=>number;readonly callbackSecret:string}
export interface ManagedInput {readonly attemptId:string;readonly fileId:string;readonly digest:string;readonly declaredType:string;readonly source:{readonly url:string;readonly validUntil:number}}
const fail=(code:IntakeError["code"]="provider")=>new IntakeError({code});
export function scannerTables(schema:string){tableNames(schema);return {tasks:`"${schema}".scan_tasks`,health:`"${schema}".scanner_health`};}
export const initializeScanner=(options:QueueOptions)=>postgresTransaction(options,["migration"],async client=>{
 const t=scannerTables(options.schema);
 await client.query(`CREATE SCHEMA IF NOT EXISTS "${options.schema}";
 CREATE TABLE IF NOT EXISTS ${t.tasks}(attempt_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,owner_id TEXT,data JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'queued',tries INTEGER NOT NULL DEFAULT 0,available_at BIGINT NOT NULL,lease_token TEXT,lease_until BIGINT,event JSONB,callback_delivered BOOLEAN NOT NULL DEFAULT false,callback_attempts INTEGER NOT NULL DEFAULT 0,callback_available_at BIGINT NOT NULL,created_at BIGINT NOT NULL);
 CREATE INDEX IF NOT EXISTS scan_tasks_ready ON ${t.tasks}(status,available_at);
 CREATE TABLE IF NOT EXISTS ${t.health}(id INTEGER PRIMARY KEY CHECK(id=1),engine TEXT NOT NULL,signature_version TEXT NOT NULL,signature_built_at BIGINT NOT NULL,checked_at BIGINT NOT NULL);`);
});
const encryptionKey=(secret:string)=>{if(secret.length<32)throw fail();return createHash("sha256").update(`blob-intake-source-v1:${secret}`).digest();};
export function encryptSource(url:string,secret:string):string{
 const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(secret),nonce);
 const bytes=Buffer.concat([cipher.update(url,"utf8"),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),bytes]).toString("base64url");
}
export function decryptSource(ciphertext:string,secret:string):string{
 const bytes=Buffer.from(ciphertext,"base64url");if(bytes.length<29||bytes.length>16*1024)throw fail();
 const decipher=createDecipheriv("aes-256-gcm",encryptionKey(secret),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString("utf8");
}
export function validPrivateSourceUrl(url:string):boolean{
 try{const parsed=new URL(url);return url.length<=12*1024&&parsed.protocol==="https:"&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.private\.blob\.vercel-storage\.com$/.test(parsed.hostname)&&!parsed.username&&!parsed.password&&!parsed.port&&!parsed.hash&&parsed.pathname.length>1;}catch{return false;}
}
export function validPrivateSource(url:string,validUntil:number,now:number):boolean{
 return validPrivateSourceUrl(url)&&Number.isFinite(validUntil)&&validUntil>=now+60_000&&validUntil<=now+15*60_000;
}

const sameBinding=(a:ScanBinding,b:ScanBinding)=>a.attemptId===b.attemptId&&a.tenantId===b.tenantId&&a.ownerId===b.ownerId&&a.fileId===b.fileId&&a.digest===b.digest&&a.declaredType===b.declaredType&&a.sourceIdentity===b.sourceIdentity&&a.callbackEnabled===b.callbackEnabled;
const serialized=(event:ProviderEvent)=>JSON.stringify(Schema.decodeUnknownSync(ScanEvent)(event));
export const signScannerCallback=(body:string,secret:string)=>{encryptionKey(secret);return createHmac("sha256",secret).update(body).digest("hex");};
export function createScannerQueue(options:QueueOptions){
 const t=scannerTables(options.schema);
 const lookup=(attemptId:string)=>databaseEffect(async()=>{const row=(await options.pool.query(`SELECT data,tries,event,status,lease_token,lease_until FROM ${t.tasks} WHERE attempt_id=$1`,[attemptId])).rows[0];return row===undefined?null:Schema.decodeUnknownSync(TaskRow)(row);});
 const enqueue=(input:ScanBinding)=>Schema.decodeUnknown(TaskBinding)(input).pipe(Effect.mapError(()=>fail()),Effect.flatMap(binding=>postgresTransaction(options,[`scan:${binding.attemptId}`],async client=>{
  const existing=(await client.query(`SELECT data FROM ${t.tasks} WHERE attempt_id=$1`,[binding.attemptId])).rows[0];
  if(existing){const old=Schema.decodeUnknownSync(Schema.Struct({data:TaskBinding}))(existing).data;if(!sameBinding(old,binding))throw fail("denied");return binding.attemptId;}
  await client.query(`INSERT INTO ${t.tasks}(attempt_id,tenant_id,owner_id,data,available_at,callback_available_at,created_at) VALUES($1,$2,$3,$4,$5,$5,$5)`,[binding.attemptId,binding.tenantId,binding.ownerId,JSON.stringify(binding),options.now()]);return binding.attemptId;
 })));
 return {
  enqueue,lookup,
  pollInternal:(attemptId:string)=>lookup(attemptId).pipe(Effect.flatMap(task=>task?.data.callbackEnabled===true?Effect.succeed(task.event):Effect.fail(fail()))),
  verifyCallback:(body:string,signature:string)=>Effect.gen(function*(){
   if(Buffer.byteLength(body)>8192||!/^[a-f0-9]{64}$/.test(signature))return yield* Effect.fail(fail("invalid_callback"));
   const expected=yield* Effect.try({try:()=>Buffer.from(signScannerCallback(body,options.callbackSecret),"hex"),catch:()=>fail("invalid_callback")});
   if(!timingSafeEqual(expected,Buffer.from(signature,"hex")))return yield* Effect.fail(fail("invalid_callback"));
   const envelope=yield* Schema.decodeUnknown(Schema.parseJson(Schema.Struct({issuedAt:Schema.Number,event:ScanEvent})))(body).pipe(Effect.mapError(()=>fail("invalid_callback")));
   if(envelope.issuedAt<options.now()-5*60_000||envelope.issuedAt>options.now()+60_000)return yield* Effect.fail(fail("invalid_callback"));
   const task=yield* lookup(envelope.event.attemptId);
   if(!task?.data.callbackEnabled||task.event===null||serialized(task.event)!==serialized(envelope.event))return yield* Effect.fail(fail("invalid_callback"));
   return envelope.event;
  }),
  claim:(attemptId?:string)=>databaseEffect(async()=>{
   const leaseToken=randomUUID(),now=options.now();
   const row=(await options.pool.query(`WITH ready AS (SELECT attempt_id FROM ${t.tasks} WHERE ((status='queued' AND available_at <= $1) OR (status='leased' AND lease_until <= $1)) AND ($4::text IS NULL OR attempt_id=$4) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ${t.tasks} AS tasks SET status='leased',tries=tries+1,lease_token=$2,lease_until=$3 FROM ready WHERE tasks.attempt_id=ready.attempt_id RETURNING tasks.data,tasks.tries,tasks.event,tasks.status,tasks.lease_token,tasks.lease_until`,[now,leaseToken,now+120_000,attemptId??null])).rows[0];
   return row===undefined?null:Schema.decodeUnknownSync(TaskRow)(row);
  }),
  finish:(task:ScanTask,event:ProviderEvent)=>databaseEffect(async()=>{
   const result=await options.pool.query(`UPDATE ${t.tasks} SET status='completed',event=$1,data=CASE WHEN data->'source'->>'kind'='capability' THEN jsonb_set(data,'{source,ciphertext}','""'::jsonb) ELSE data END,lease_token=NULL,lease_until=NULL,callback_available_at=$2 WHERE attempt_id=$3 AND status='leased' AND lease_token=$4 AND lease_until>$2`,[serialized(event),options.now(),task.data.attemptId,task.lease_token]);return result.rowCount===1;
  }),
  retry:(task:ScanTask)=>databaseEffect(async()=>{
   const result=await options.pool.query(`UPDATE ${t.tasks} SET status='queued',available_at=$1,lease_token=NULL,lease_until=NULL WHERE attempt_id=$2 AND status='leased' AND lease_token=$3 AND lease_until>$4`,[options.now()+Math.min(30_000,5_000*2**task.tries),task.data.attemptId,task.lease_token,options.now()]);return result.rowCount===1;
  }),
  callbackPending:(attemptId?:string)=>databaseEffect(async()=>{
   const now=options.now();
   const row=(await options.pool.query(`WITH ready AS(SELECT attempt_id FROM ${t.tasks} WHERE status='completed' AND data->>'callbackEnabled'='true' AND callback_delivered=false AND callback_attempts<5 AND callback_available_at<=$1 AND ($2::text IS NULL OR attempt_id=$2) ORDER BY callback_available_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ${t.tasks} AS tasks SET callback_attempts=callback_attempts+1,callback_available_at=$1+LEAST(600000,60000*power(2,callback_attempts))::bigint FROM ready WHERE tasks.attempt_id=ready.attempt_id RETURNING tasks.data,tasks.tries,tasks.event,tasks.status,tasks.lease_token,tasks.lease_until`,[now,attemptId??null])).rows[0];
   return row===undefined?null:Schema.decodeUnknownSync(TaskRow)(row);
  }),
  markCallbackDelivered:(attemptId:string)=>databaseEffect(async()=>{await options.pool.query(`UPDATE ${t.tasks} SET callback_delivered=true WHERE attempt_id=$1`,[attemptId]);}),
 };
}
export const managedTaskId=(context:AuthContext,attemptId:string)=>`managed:${createHash("sha256").update(JSON.stringify([context.tenantId,context.userId,attemptId])).digest("hex")}`;
export function createManagedQueue(options:QueueOptions){
 const queue=createScannerQueue(options);
 return {
  submit:(context:AuthContext,input:ManagedInput)=>Effect.gen(function*(){
   yield* Schema.decodeUnknown(Id)(input.attemptId).pipe(Effect.mapError(()=>fail("denied")));
   if(!validPrivateSource(input.source.url,input.source.validUntil,options.now()))return yield* Effect.fail(fail("storage"));
   const ciphertext=yield* Effect.try({try:()=>encryptSource(input.source.url,options.callbackSecret),catch:()=>fail()});
   const declaredType=yield* Schema.decodeUnknown(TaskBinding.fields.declaredType)(input.declaredType).pipe(Effect.mapError(()=>fail("storage")));
   yield* queue.enqueue({attemptId:managedTaskId(context,input.attemptId),tenantId:context.tenantId,ownerId:context.userId,fileId:input.fileId,digest:input.digest,declaredType,sourceIdentity:createHash("sha256").update(JSON.stringify([new URL(input.source.url).origin,new URL(input.source.url).pathname,input.digest,declaredType])).digest("hex"),source:{kind:"capability",ciphertext,validUntil:input.source.validUntil},callbackEnabled:false});
   return input.attemptId;
  }),
  poll:(context:AuthContext,attemptId:string)=>queue.lookup(managedTaskId(context,attemptId)).pipe(Effect.flatMap(task=>task!==null&&task.data.tenantId===context.tenantId&&task.data.ownerId===context.userId&&!task.data.callbackEnabled?Effect.succeed(task.event===null?null:{...task.event,attemptId}):Effect.fail(fail("denied")))),
 };
}
