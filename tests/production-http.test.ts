import { strict as assert } from "node:assert";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { Effect } from "effect";
import { handleUpload } from "@vercel/blob/client";
import { IntakeError } from "../src/contract/index";
import { authenticate, authenticateKey, sessionCookie } from "../src/production/auth";
import { handleIntake, parseUploadBody, readBoundedBody } from "../src/production/http";
const keyA="fixture-key-aaaaaaaaaaaaaaaaaaaaaaaa",keyB="fixture-key-bbbbbbbbbbbbbbbbbbbbbbbb";
const identities=[{keyHash:createHash("sha256").update(keyA).digest("hex"),tenantId:"a",userId:"u-a"},{keyHash:createHash("sha256").update(keyB).digest("hex"),tenantId:"b",userId:"u-b"}];
const auth={keysJson:JSON.stringify(identities),sessionSecret:"fixture-session-secret-32-characters-long",now:()=>100000};
const origin="https://pilot.example";
const req=(method="GET",headers:HeadersInit={},body?:string)=>new Request(`${origin}/api/intake/state`,{method,headers,body});
test("production keys establish distinct tenant authority and reject unknown credentials",async()=>{
 assert.deepEqual(await Effect.runPromise(authenticateKey(keyA,auth)),{tenantId:"a",userId:"u-a"});
 assert.deepEqual(await Effect.runPromise(authenticateKey(keyB,auth)),{tenantId:"b",userId:"u-b"});
 assert.equal(Effect.runSync(Effect.isFailure(authenticateKey("fixture-key-xxxxxxxxxxxxxxxxxxxxxxxx",auth))),true);
 assert.equal(Effect.runSync(Effect.isFailure(authenticateKey(keyA,{...auth,keysJson:"{bad"}))),true);
});
test("signed cookies enforce expiration, signature, identity revocation and mutation Origin",async()=>{
 const cookie=(await Effect.runPromise(sessionCookie({tenantId:"a",userId:"u-a"},auth))).split(";")[0]??"";
 assert.deepEqual(await Effect.runPromise(authenticate(req("GET",{cookie}),auth)),{tenantId:"a",userId:"u-a"});
 for(const [request,config,mutation] of [[req("POST",{cookie,origin:"https://foreign.example"},"{}"),auth,true],[req("POST",{cookie},"{}"),auth,true],[req("GET",{cookie:cookie+"x"}),auth,false],[req("GET",{cookie}),{...auth,now:()=>4000000},false],[req("GET",{cookie}),{...auth,keysJson:"[]"},false]] as const){assert.equal(await Effect.runPromise(Effect.isFailure(authenticate(request,config,mutation))),true);}
 assert.deepEqual(await Effect.runPromise(authenticate(req("POST",{cookie,origin},"{}"),auth,true)),{tenantId:"a",userId:"u-a"});
 assert.deepEqual(await Effect.runPromise(authenticate(req("POST",{authorization:`Bearer ${keyA}`},"{}"),auth,true)),{tenantId:"a",userId:"u-a"});
 assert.equal(await Effect.runPromise(Effect.isFailure(authenticate(req("POST",{authorization:`Bearer ${keyA}`,origin:"https://foreign.example"},"{}"),auth,true))),true);
});
test("HTTP authentication is checked before runtime and missing infrastructure fails closed",async()=>{
 let opened=0;const runtime=()=>{opened++;return Effect.fail(new IntakeError({code:"persistence"}));};
 for(const op of ["prepare","finish","state","action","download","reconcile"] as const){const response=await handleIntake(req(op==="state"||op==="download"?"GET":"POST",{},op==="state"||op==="download"?undefined:"{}"),op,{auth,runtime});assert.equal(response.status,403);}
 assert.equal(opened,0);
 const response=await handleIntake(req("GET",{authorization:`Bearer ${keyA}`}),"state",{auth,runtime});assert.equal(response.status,503);assert.equal(opened,1);
});
test("session HTTP issues secure cookie without disclosing identity or keys and rejects foreign login",async()=>{
 const response=await handleIntake(req("POST",{origin,"content-type":"application/json"},JSON.stringify({key:keyA})),"session",{auth});assert.equal(response.status,200);const cookie=response.headers.get("set-cookie")??"";for(const flag of ["HttpOnly","Secure","SameSite=Strict"])assert.ok(cookie.includes(flag));assert.deepEqual(await response.json(),{ok:true});assert.equal(cookie.includes(keyA),false);
 const denied=await handleIntake(req("POST",{origin:"https://foreign.example"},JSON.stringify({key:keyA})),"session",{auth});assert.equal(denied.status,403);
});
test("streamed JSON bodies cannot bypass byte limit without content-length",async()=>{
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode("12345"));controller.enqueue(new TextEncoder().encode("67890"));controller.close();}});
 const init={method:"POST",body:stream,duplex:"half"};const request=new Request(origin,init);assert.equal(await Effect.runPromise(Effect.isFailure(readBoundedBody(request,8))),true);
});

test("official Blob callback verification preserves signed field ordering and additive fields",async()=>{
 const token="vercel_blob_rw_fixture_secret_for_offline_test";
 const original={extra:"signed-additive-field",payload:{tokenPayload:JSON.stringify({fileId:"a0ccf36c-d923-493e-9745-cff139d38f43",userId:"u-a",tenantId:"a"}),blob:{etag:"fixture-etag",contentDisposition:"attachment",contentType:"application/pdf",pathname:"intake/fixture",downloadUrl:"https://fixture.example/download",url:"https://fixture.example/blob"}},type:"blob.upload-completed"};
 const body=JSON.stringify(original),signature=createHmac("sha256",token).update(body).digest("hex");
 const parsed=await Effect.runPromise(parseUploadBody(body));assert.equal(JSON.stringify(parsed),body);let completed=false;
 const result=await handleUpload({token,body:parsed,request:new Request(origin,{method:"POST",headers:{"x-vercel-signature":signature},body}),onBeforeGenerateToken:async()=>{throw new Error("unexpected issuance");},onUploadCompleted:async()=>{completed=true;}});assert.equal(result.type,"blob.upload-completed");assert.equal(completed,true);
 await assert.rejects(()=>handleUpload({token,body:parsed,request:new Request(origin,{method:"POST",headers:{"x-vercel-signature":"00"},body}),onBeforeGenerateToken:async()=>({})}));
});
test("non-operator GET cannot trigger reconciliation",async()=>{let opened=0;const response=await handleIntake(req("GET",{authorization:`Bearer ${keyA}`}),"reconcile",{auth,runtime:()=>{opened++;return Effect.fail(new IntakeError({code:"persistence"}));}});assert.equal(response.status,403);assert.equal(opened,0);});
