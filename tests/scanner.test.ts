import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { Effect } from "effect";
import pg from "pg";
import { createClamClient,parseClamHealth,ScannerError } from "../src/scanner/clamav";
import { createManagedQueue,createScannerQueue,decryptSource,encryptSource,initializeScanner,managedTaskId,signScannerCallback,validPrivateSource,type ScanBinding,type QueueOptions } from "../src/scanner/queue";
import { createScannerWorker,validateScanBytes } from "../src/scanner/worker";
import type { ProviderEvent } from "../src/contract/index";
import { pdf,tenantA,tenantB } from "../fixtures/dependencies";

const run=<A>(effect:Effect.Effect<A,unknown>)=>Effect.runPromise(effect);
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const secret="synthetic-scanner-secret-32-characters-not-a-key";
const fixedNow=Date.UTC(2026,8,30,12);
const sourceUrl="https://store-a.private.blob.vercel-storage.com/source.pdf?signature=fixture";
async function clamFixture(reply="stream: OK",date=Date.UTC(2026,8,30,10)){
 let streams=0;let seen=Buffer.alloc(0);
 const server=createServer(socket=>{
  let bytes=Buffer.alloc(0),commandParsed=false,position=0;const chunks:Uint8Array[]=[];
  socket.on("error",()=>undefined);
  socket.on("data",chunk=>{
   bytes=Buffer.concat([bytes,typeof chunk==="string"?Buffer.from(chunk):chunk]);
   if(!commandParsed){const end=bytes.indexOf(0);if(end<0)return;const command=bytes.subarray(0,end).toString();position=end+1;commandParsed=true;
    if(command==="zVERSION"){socket.end(`ClamAV 1.4.3/99999/${new Date(date).toUTCString()}\0`);return;}
    assert.equal(command,"zINSTREAM");
   }
   while(bytes.length>=position+4){const size=bytes.readUInt32BE(position);if(bytes.length<position+4+size)return;position+=4;if(size===0){streams++;seen=Buffer.concat(chunks);socket.end(`${reply}\0`);return;}chunks.push(bytes.subarray(position,position+size));position+=size;}
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const address=server.address();assert.ok(address&&typeof address!=="string");
 return {port:address.port,streams:()=>streams,seen:()=>seen,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}

test("Clam signature date rejects stale, unknown and future definitions",()=>{
 assert.equal(parseClamHealth("ClamAV 1.4.3/99999/Wed Sep 30 10:00:00 2026",fixedNow).signatureVersion,"99999");
 assert.throws(()=>parseClamHealth("ClamAV 1.4.3/99999/Sat Sep 26 10:00:00 2026",fixedNow),ScannerError);
 assert.throws(()=>parseClamHealth("ClamAV 1.4.3/99999/Thu Oct 01 10:00:00 2026",fixedNow),ScannerError);
 assert.throws(()=>parseClamHealth("ClamAV unsupported",fixedNow),ScannerError);
});
test("Clam INSTREAM uses bounded real TCP framing and classifies only complete clean/threat replies",async()=>{
 const clean=await clamFixture();try{const client=createClamClient({host:"127.0.0.1",port:clean.port,now:()=>fixedNow});assert.equal((await run(client.health())).engine,"1.4.3");assert.equal(await run(client.scan(pdf)),"clean");assert.deepEqual(clean.seen(),Buffer.from(pdf));}finally{await clean.close();}
 const threat=await clamFixture("stream: Synthetic-Test FOUND");try{assert.equal(await run(createClamClient({host:"127.0.0.1",port:threat.port,now:()=>fixedNow}).scan(pdf)),"threat");}finally{await threat.close();}
 const unknown=await clamFixture("stream: internal failure ERROR");try{assert.equal(await run(Effect.isFailure(createClamClient({host:"127.0.0.1",port:unknown.port,now:()=>fixedNow}).scan(pdf))),true);}finally{await unknown.close();}
});
test("capabilities are encrypted, tampering fails and source URLs reject SSRF/expiry",()=>{
 const cipher=encryptSource(sourceUrl,secret);assert.equal(cipher.includes(sourceUrl),false);assert.equal(decryptSource(cipher,secret),sourceUrl);
 const tampered=Buffer.from(cipher,"base64url");const last=tampered[tampered.length-1];assert.notEqual(last,undefined);tampered[tampered.length-1]=(last??0)^1;assert.throws(()=>decryptSource(tampered.toString("base64url"),secret));
 assert.equal(validPrivateSource(sourceUrl,fixedNow+900000,fixedNow),true);
 for(const url of ["http://store.private.blob.vercel-storage.com/a","https://127.0.0.1/a","https://store.private.blob.vercel-storage.com.attacker.test/a","https://u:p@store.private.blob.vercel-storage.com/a","https://store.private.blob.vercel-storage.com:8443/a","https://store.private.blob.vercel-storage.com/a#x"]){assert.equal(validPrivateSource(url,fixedNow+900000,fixedNow),false);}
 assert.equal(validPrivateSource(sourceUrl,fixedNow+30_000,fixedNow),false);assert.equal(validPrivateSource(sourceUrl,fixedNow+900001,fixedNow),false);
});
test("worker independently rejects MIME disguise, changed digest and invalid magic",()=>{
 assert.doesNotThrow(()=>validateScanBytes(pdf,"application/pdf",digest(pdf)));
 assert.throws(()=>validateScanBytes(pdf,"image/png",digest(pdf)),ScannerError);
 assert.throws(()=>validateScanBytes(pdf,"application/pdf","a".repeat(64)),ScannerError);
 const text=new TextEncoder().encode("ordinary text without a PDF header");assert.throws(()=>validateScanBytes(text,"application/pdf",digest(text)),ScannerError);
});

const connectionString=process.env.BLOB_INTAKE_TEST_DATABASE_URL;
const enabled=typeof connectionString==="string"&&connectionString.length>0;
const schemaName=()=>`blob_intake_test_${randomUUID().replaceAll("-","")}`;
async function databaseTest(fn:(options:QueueOptions,advance:(ms:number)=>void)=>Promise<void>){
 const pool=new pg.Pool({connectionString,max:5,connectionTimeoutMillis:15000,query_timeout:15000}),schema=schemaName();let now=fixedNow;
 const options={pool,schema,callbackSecret:secret,now:()=>now};
 try{await run(initializeScanner(options));await fn(options,ms=>{now+=ms;});}finally{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();}
}
const internalBinding=(attemptId:string,bytes=pdf):ScanBinding=>({attemptId,tenantId:tenantA.tenantId,ownerId:null,fileId:`file-${attemptId}`,digest:digest(bytes),declaredType:"application/pdf",sourceIdentity:digest(new TextEncoder().encode(attemptId)),source:{kind:"pathname",pathname:`tenant/${attemptId}.pdf`},callbackEnabled:true});

test("scanner Postgres namespaces caller IDs, deduplicates renewed capabilities and wipes terminal source",{skip:!enabled},()=>databaseTest(async options=>{
 const managed=createManagedQueue(options),queue=createScannerQueue(options);
 const input={attemptId:"attempt-1",fileId:"file",digest:digest(pdf),declaredType:"application/pdf",source:{url:sourceUrl,validUntil:options.now()+900000}};
 assert.equal(await run(managed.submit(tenantA,input)),input.attemptId);
 assert.equal(await run(managed.submit(tenantA,{...input,source:{url:sourceUrl+"-renewed",validUntil:options.now()+800000}})),input.attemptId);
 assert.equal(await run(managed.submit(tenantB,input)),input.attemptId);
 assert.notEqual(managedTaskId(tenantA,input.attemptId),managedTaskId(tenantB,input.attemptId));
 assert.equal(await run(Effect.isFailure(managed.submit(tenantA,{...input,fileId:"another-file"}))),true);
 assert.equal(await run(Effect.isFailure(managed.submit(tenantA,{...input,source:{...input.source,url:sourceUrl.replace("source.pdf","other.pdf")}}))),true);
 const task=await run(queue.claim(managedTaskId(tenantA,input.attemptId)));assert.ok(task);
 await run(queue.finish(task,{eventId:"event-a",attemptId:task.data.attemptId,digest:input.digest,outcome:"clean",reason:null}));
 const a=await run(managed.poll(tenantA,input.attemptId));assert.equal(a?.attemptId,input.attemptId);assert.equal(a?.outcome,"clean");assert.equal(await run(managed.poll(tenantB,input.attemptId)),null);
 assert.equal(await run(Effect.isFailure(managed.poll({...tenantA,userId:"other-user"},input.attemptId))),true);
 const completed=await run(queue.lookup(task.data.attemptId));assert.ok(completed);assert.equal(completed.data.source.kind,"capability");if(completed.data.source.kind==="capability")assert.equal(completed.data.source.ciphertext,"");
 assert.equal(await run(queue.callbackPending()),null);
}));

test("scanner Postgres leases reject stale workers and callback signatures bind durable result",{skip:!enabled},()=>databaseTest(async(options,advance)=>{
 const queue=createScannerQueue(options);await run(queue.enqueue(internalBinding("lease")));
 const [first,second]=await Promise.all([run(queue.claim("lease")),run(queue.claim("lease"))]);assert.equal([first,second].filter(Boolean).length,1);
 const old=first??second;assert.ok(old);advance(120001);const fresh=await run(queue.claim("lease"));assert.ok(fresh);assert.notEqual(old.lease_token,fresh.lease_token);
 const event:ProviderEvent={eventId:"event-lease",attemptId:"lease",digest:old.data.digest,outcome:"clean" satisfies "clean",reason:null};
 assert.equal(await run(queue.finish(old,event)),false);assert.equal(await run(queue.finish(fresh,event)),true);
 const body=JSON.stringify({issuedAt:options.now(),event}),signature=signScannerCallback(body,secret);
 assert.deepEqual(await run(queue.verifyCallback(body,signature)),event);
 assert.equal(await run(Effect.isFailure(queue.verifyCallback(body,"0".repeat(64)))),true);
 const forged=JSON.stringify({issuedAt:options.now(),event:{...event,outcome:"threat"}});assert.equal(await run(Effect.isFailure(queue.verifyCallback(forged,signScannerCallback(forged,secret)))),true);
 advance(300001);assert.equal(await run(Effect.isFailure(queue.verifyCallback(body,signature))),true);
 for(let count=0;count<5;count++){assert.ok(await run(queue.callbackPending("lease")));advance(600001);}
 assert.equal(await run(queue.callbackPending("lease")),null);assert.equal((await run(queue.pollInternal("lease")))?.outcome,"clean");
}));

test("scanner worker never scans MIME-disguised bytes and transient failures exhaust closed",{skip:!enabled},()=>databaseTest(async(options,advance)=>{
 const fixture=await clamFixture();const queue=createScannerQueue(options);const text=new TextEncoder().encode("not a PDF despite its declared content type");
 let storageFails=false;
 try{
  const worker=await run(createScannerWorker({...options,blobToken:"fixture-only",callbackUrl:"https://intake.example/api/intake/callback",clam:{host:"127.0.0.1",port:fixture.port},blobGet:async pathname=>{if(storageFails)throw new Error("synthetic unavailable");return {statusCode:200,stream:new ReadableStream({start(controller){controller.enqueue(text);controller.close();}}),headers:new Headers(),blob:{url:"https://store.private.blob.vercel-storage.com/file",downloadUrl:"",pathname,contentDisposition:"",cacheControl:"",uploadedAt:new Date(0),etag:"fixture",contentType:"application/pdf",size:text.length}};},fetch:async()=>Response.json({ok:false},{status:503})}));
  await run(queue.enqueue(internalBinding("disguised",text)));const rejected=await run(worker.runOnce({attemptId:"disguised",deliverCallbacks:false}));assert.equal(rejected.outcome,"failed");assert.equal(fixture.streams(),0);assert.equal((await run(queue.pollInternal("disguised")))?.reason,"type");
  storageFails=true;await run(queue.enqueue(internalBinding("outage")));
  for(let attempt=0;attempt<3;attempt++){const tick=await run(worker.runOnce({attemptId:"outage",deliverCallbacks:false}));assert.equal(tick.outcome,attempt===2?"failed":"retry");advance(30001);}
  assert.equal((await run(queue.pollInternal("outage")))?.outcome,"failed");assert.equal((await run(queue.pollInternal("outage")))?.reason,"outage");
 }finally{await fixture.close();}
}));
