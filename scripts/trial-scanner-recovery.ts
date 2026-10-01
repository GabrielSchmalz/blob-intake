import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile,writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { put,del } from "@vercel/blob";
import { Effect,Schema } from "effect";
import { Pool } from "pg";
import { createScannerWorker } from "../src/scanner/worker";
import { createClamClient } from "../src/scanner/clamav";
import { scannerTables } from "../src/scanner/queue";
import { tableNames } from "../src/persistence/postgres";
const run=promisify(execFile),origin="https://blob-intake.vercel.app";
const config=Schema.Struct({identities:Schema.Array(Schema.Struct({credential:Schema.String,tenantId:Schema.String,userId:Schema.String})),CALLBACK_SECRET:Schema.String});
let checkpoint="initialization";
const operation=<A>(f:()=>Promise<A>)=>Effect.tryPromise({try:f,catch:()=>new Error(`Recovery trial failed at ${checkpoint}; private values redacted`)});
const main=Effect.gen(function*(){
 if(process.env.BLOB_INTAKE_LIVE_TRIAL!=="authorized")return yield* Effect.fail(new Error("Explicit launch trial flag required"));
 const privateConfig=yield* Schema.decodeUnknown(Schema.parseJson(config))(yield* operation(()=>readFile("runtime/launch-private.json","utf8")));
 const identity=privateConfig.identities[0];assert(identity);
 const token=process.env.BLOB_READ_WRITE_TOKEN,database=process.env.DATABASE_URL,schema=process.env.BLOB_INTAKE_SCHEMA;assert(token&&database&&schema);
 const pool=new Pool({connectionString:database,max:2,connectionTimeoutMillis:10000,query_timeout:15000});
 const tables=tableNames(schema),scan=scannerTables(schema),bytes=Buffer.from("%PDF-1.4\n% real scanner outage recovery trial\n%%EOF\n");
 let fileId:string|undefined,path:string|undefined,attemptId:string|undefined;
 const systemEnvironment={...process.env,XDG_RUNTIME_DIR:"/run/user/1001",DBUS_SESSION_BUS_ADDRESS:"unix:path=/run/user/1001/bus"};
 const service=(verb:string)=>run("systemctl",["--user",verb,"blob-intake-worker.service"],{env:systemEnvironment});
 const call=(route:string,body?:unknown)=>fetch(origin+route,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${identity.credential}`,Origin:origin,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(30000)});
 const decode=async<A,I>(response:Response,s:Schema.Schema<A,I>)=>{assert.equal(response.status,200);const unknown:unknown=await response.json();return Schema.decodeUnknownSync(s)(unknown);};
 const evidence=yield* Effect.acquireUseRelease(Effect.succeed(pool),()=>operation(async()=>{
  checkpoint="worker pause";await service("stop");
  checkpoint="private upload";
  const file=await decode(await call("/api/intake/prepare",{name:"outage-recovery-trial.pdf",declaredType:"application/pdf"}),Schema.Struct({fileId:Schema.String,pathname:Schema.String}));fileId=file.fileId;path=file.pathname;
  await put(path,bytes,{token,access:"private",contentType:"application/pdf",allowOverwrite:false,addRandomSuffix:false});
  await decode(await call("/api/intake/finish",{fileId}),Schema.Struct({job:Schema.Struct({jobId:Schema.String,state:Schema.String})}));
  const a=(await pool.query<{id:string}>(`SELECT a.id FROM ${tables.attempts} a JOIN ${tables.jobs} j ON j.id=a.job WHERE j.tenant=$1 AND j.file=$2`,[identity.tenantId,fileId])).rows[0];assert(a);attemptId=a.id;
  checkpoint="real daemon outage";await run("docker",["stop","blob-intake-clamav"]);
  const worker=await Effect.runPromise(createScannerWorker({pool,schema,now:Date.now,callbackSecret:privateConfig.CALLBACK_SECRET,blobToken:token,callbackUrl:origin+"/api/intake/callback",clam:{host:"127.0.0.1",port:3310}}));
  const unavailable=await Effect.runPromise(worker.runOnce({attemptId,deliverCallbacks:false}));assert.equal(unavailable.outcome,"retry");assert.equal((await call(`/api/intake/download?fileId=${fileId}`)).status,409);
  const queued=(await pool.query<{status:string,event:unknown}>(`SELECT status,event FROM ${scan.tasks} WHERE attempt_id=$1`,[attemptId])).rows[0];assert(queued&&queued.status==="queued"&&queued.event===null);
  checkpoint="daemon restoration";await run("docker",["start","blob-intake-clamav"]);
  const clam=createClamClient({host:"127.0.0.1",port:3310,now:Date.now});const started=Date.now();let health;
  while(Date.now()-started<90000){const probe=await Effect.runPromise(clam.health().pipe(Effect.either));if(probe._tag==="Right"){health=probe.right;break;}await Effect.runPromise(Effect.sleep(1000));}assert(health,"Daemon must recover with fresh signatures");
  checkpoint="durable retry";const recovered=await Effect.runPromise(worker.runOnce({attemptId}));assert.equal(recovered.outcome,"clean");assert(recovered.callbackDelivered);
  const approved=await decode(await call(`/api/intake/download?fileId=${fileId}`),Schema.Struct({url:Schema.String}));const downloaded=await fetch(approved.url,{redirect:"error",signal:AbortSignal.timeout(15000)});assert.equal(downloaded.status,200);assert(Buffer.from(await downloaded.arrayBuffer()).equals(bytes));
  return {createdAt:new Date().toISOString(),stage:"actual managed ClamAV outage and restart recovery",origin,daemonStopped:true,unavailableOutcome:unavailable.outcome,downloadWhileUnavailable:409,durableQueueRetainedWithoutResult:true,recoveredOutcome:recovered.outcome,realCallbackDelivered:recovered.callbackDelivered,byteExact:true,health,syntheticBytes:bytes.length,digest:createHash("sha256").update(bytes).digest("hex"),cleanup:"Exact own trial Blob and associated acceptance/scan rows removed; daemon and worker restored",limits:"One controlled own-service outage; not sustained uptime or general recovery certification"};
 }),()=>operation(async()=>{
  try{
   await run("docker",["start","blob-intake-clamav"]);
   if(path)await del(path,{token});
   if(fileId){const client=await pool.connect();try{await client.query("BEGIN");if(attemptId){await client.query(`DELETE FROM ${tables.events} WHERE data->>'attemptId'=$1`,[attemptId]);await client.query(`DELETE FROM ${scan.tasks} WHERE attempt_id=$1 AND tenant_id=$2`,[attemptId,identity.tenantId]);await client.query(`DELETE FROM ${tables.attempts} WHERE id=$1`,[attemptId]);}await client.query(`DELETE FROM ${tables.current} WHERE tenant=$1 AND file=$2`,[identity.tenantId,fileId]);await client.query(`DELETE FROM ${tables.jobs} WHERE tenant=$1 AND file=$2`,[identity.tenantId,fileId]);await client.query(`DELETE FROM ${tables.files} WHERE tenant_id=$1 AND user_id=$2 AND id=$3`,[identity.tenantId,identity.userId,fileId]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}
  }finally{try{await service("start");}finally{await pool.end();}}
 }).pipe(Effect.orDie));
 yield* operation(()=>writeFile("evidence/scanner-recovery-live.json",JSON.stringify(evidence,null,2)+"\n"));yield* Effect.log("Actual scanner outage/recovery passed; exact trial resources removed and services restored");
});
Effect.runPromise(main).catch(()=>{process.stderr.write(`Scanner recovery trial failed at ${checkpoint}; private values redacted.\n`);process.exitCode=1;});
