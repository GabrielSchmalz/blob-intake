import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import test from "node:test";
import { Effect } from "effect";
import { IntakeError, type ProviderEvent, type Submission } from "../src/contract/index";
import { createManagedScannerProvider, type ManagedScanSubmission } from "../src/integrations/managed-scanner";
import { handleManagedScan, type ManagedQueue } from "../src/production/managed-http";
const now=1800000000000,keyA="fixture-managed-key-aaaaaaaaaaaaaaaa",keyB="fixture-managed-key-bbbbbbbbbbbbbbbb";
const auth={keysJson:JSON.stringify([{keyHash:createHash("sha256").update(keyA).digest("hex"),tenantId:"a",userId:"u-a"},{keyHash:createHash("sha256").update(keyB).digest("hex"),tenantId:"b",userId:"u-b"}]),sessionSecret:undefined};
const bytes=Buffer.from("%PDF-1.7\nfixture");const digest=createHash("sha256").update(bytes).digest("hex");
const source={url:"https://store.private.blob.vercel-storage.com/intake/file?sig=fixture",validUntil:now+120000};
const submission:Submission={attemptId:"attempt-a",tenantId:"a",fileId:"file-a",digest,declaredType:"application/pdf",bytes};
const input:ManagedScanSubmission={attemptId:submission.attemptId,fileId:submission.fileId,digest,declaredType:"application/pdf",source};
const event:ProviderEvent={eventId:"event-a",attemptId:"attempt-a",digest,outcome:"clean",reason:null};
const request=(key:string,body?:unknown,attempt="attempt-a")=>new Request(`https://blob-intake.vercel.app/api/scans?attemptId=${attempt}`,{method:body===undefined?"GET":"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
test("managed HTTP derives authority from API key and never forwards supplied tenant",async()=>{
 let submitted:ManagedScanSubmission|undefined;let tenant="",owner="";
 const queue:ManagedQueue={submit:(ctx,value)=>{tenant=ctx.tenantId;owner=ctx.userId;submitted=value;return Effect.succeed(value.attemptId);},poll:ctx=>ctx.tenantId==="a"&&ctx.userId==="u-a"?Effect.succeed(event):Effect.fail(new IntakeError({code:"denied"}))};
 const deps={auth,now:()=>now,queue:()=>Effect.succeed(queue)};
 const response=await handleManagedScan(request(keyA,{...input,tenantId:"b",userId:"u-b"}),deps);assert.equal(response.status,200);assert.equal(tenant,"a");assert.equal(owner,"u-a");assert.deepEqual(submitted,input);assert.deepEqual(await response.json(),{attemptId:"attempt-a"});
 const own=await handleManagedScan(request(keyA),deps);assert.deepEqual(await own.json(),{event});const other=await handleManagedScan(request(keyB),deps);assert.equal(other.status,403);assert.equal((await other.text()).includes(source.url),false);
});
test("managed HTTP denies unauthenticated, unsafe or oversized submission before queue access",async()=>{
 let opened=0;const deps={auth,now:()=>now,queue:()=>{opened++;return Effect.fail(new IntakeError({code:"persistence"}));}};
 assert.equal((await handleManagedScan(request("unknown-key-xxxxxxxxxxxxxxxxxxxxxxx",input),deps)).status,403);
 assert.equal((await handleManagedScan(new Request("https://blob-intake.vercel.app/api/scans",{headers:{cookie:"intake_session=fake"}}),deps)).status,403);
 for(const url of ["http://store.private.blob.vercel-storage.com/file","https://store.public.blob.vercel-storage.com/file","https://127.0.0.1/file","https://store.private.blob.vercel-storage.com.attacker.example/file","https://user:pass@store.private.blob.vercel-storage.com/file","https://store.private.blob.vercel-storage.com:8443/file","https://store.private.blob.vercel-storage.com/file#fragment"]){assert.equal((await handleManagedScan(request(keyA,{...input,source:{...source,url}}),deps)).status,403);}
 for(const validUntil of [now+30000,now+16*60000])assert.equal((await handleManagedScan(request(keyA,{...input,source:{...source,validUntil}}),deps)).status,403);
 assert.equal((await handleManagedScan(request(keyA,{...input,padding:"x".repeat(17000)}),deps)).status,403);assert.equal(opened,0);
});
test("managed provider submits metadata only, polls bound event, and uses no redirects",async()=>{
 const calls:{url:string,method:string|undefined,redirect:RequestRedirect|undefined,body:unknown}[]=[];
 const network:typeof fetch=async(url,options)=>{calls.push({url:String(url),method:options?.method,redirect:options?.redirect,body:options?.body});assert.equal(new Headers(options?.headers).get("authorization"),`Bearer ${keyA}`);return Response.json(options?.method==="POST"?{attemptId:"attempt-a"}:{event});};
 const provider=createManagedScannerProvider({apiKey:keyA,baseUrl:"https://blob-intake.vercel.app",source:()=>Effect.succeed({...source,digest}),now:()=>now,fetch:network});
 assert.equal(await Effect.runPromise(provider.submit(submission)),"attempt-a");assert.deepEqual(await Effect.runPromise(provider.poll("attempt-a")),event);assert.equal(calls.length,2);assert.equal(calls[0]?.redirect,"error");assert.equal(calls[1]?.redirect,"error");assert.equal(calls[0]?.body,JSON.stringify(input));assert.equal(calls[1]?.url,"https://blob-intake.vercel.app/api/scans?attemptId=attempt-a");assert.equal(await Effect.runPromise(Effect.isFailure(provider.verifyCallback({body:"{}",signature:"fake"}))),true);
});
test("managed provider fails closed on digest mismatch, source policy, and mismatched remote identity",async()=>{
 let fetched=0;const network:typeof fetch=async()=>{fetched++;return Response.json({attemptId:"other-attempt"});};
 const options={apiKey:keyA,baseUrl:"https://blob-intake.vercel.app",source:()=>Effect.succeed({...source,digest}),now:()=>now,fetch:network};
 const provider=createManagedScannerProvider(options);
 assert.equal(await Effect.runPromise(Effect.isFailure(provider.submit({...submission,digest:"0".repeat(64)}))),true);assert.equal(fetched,0);
 const badSource=createManagedScannerProvider({...options,source:()=>Effect.succeed({...source,digest,url:"https://attacker.example/file"})});assert.equal(await Effect.runPromise(Effect.isFailure(badSource.submit(submission))),true);assert.equal(fetched,0);
 assert.equal(await Effect.runPromise(Effect.isFailure(provider.submit(submission))),true);assert.equal(fetched,1);
 const badPoll=createManagedScannerProvider({...options,fetch:async()=>Response.json({event:{...event,attemptId:"other-attempt"}})});assert.equal(await Effect.runPromise(Effect.isFailure(badPoll.poll("attempt-a"))),true);
 const malformed=createManagedScannerProvider({...options,fetch:async()=>Response.json({event:{...event,outcome:"approved"}})});assert.equal(await Effect.runPromise(Effect.isFailure(malformed.poll("attempt-a"))),true);
 const outage=createManagedScannerProvider({...options,fetch:async()=>new Response("Unavailable",{status:503})});assert.equal(await Effect.runPromise(Effect.isFailure(outage.poll("attempt-a"))),true);
});
