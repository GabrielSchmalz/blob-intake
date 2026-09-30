import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { put, del, issueSignedToken, presignUrl } from "@vercel/blob";
import { Effect } from "effect";
const operation=<A>(body:()=>Promise<A>)=>Effect.tryPromise({try:body,catch:()=>new Error("Private Blob trial failed; no source capability is logged")});
const main=Effect.gen(function*(){
 const token=process.env.BLOB_READ_WRITE_TOKEN;if(!token)return yield* Effect.fail(new Error("Missing project Blob credential"));
 const base=`trial/${randomUUID()}`;const bytes=Buffer.from("%PDF-1.4\n% synthetic private Blob acceptance trial\n%%EOF\n");
 const locations:string[]=[];
 const evidence=yield* Effect.acquireUseRelease(Effect.succeed(locations),()=>Effect.gen(function*(){
  const a=yield* operation(()=>put(`${base}/a.pdf`,bytes,{token,access:"private",contentType:"application/pdf",addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:60}));locations.push(a.url);
  const b=yield* operation(()=>put(`${base}/b.pdf`,bytes,{token,access:"private",contentType:"application/pdf",addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:60}));locations.push(b.url);
  const unsigned=yield* operation(()=>fetch(a.url));if(unsigned.status===200) return yield* Effect.fail(new Error("Unsigned private read unexpectedly succeeded"));
  const expiresAt=Date.now()+10000;
  const signed=yield* operation(()=>issueSignedToken({token,pathname:a.pathname,operations:["get"],validUntil:expiresAt}));
  const scoped=yield* operation(()=>presignUrl(signed,{operation:"get",pathname:a.pathname,validUntil:Math.min(expiresAt,signed.validUntil),access:"private",useCache:false}));
  const download=yield* operation(()=>fetch(scoped.presignedUrl));if(download.status!==200)return yield* Effect.fail(new Error("Signed read unavailable"));
  const actual=yield* operation(async()=>Buffer.from(await download.arrayBuffer()));if(!actual.equals(bytes))return yield* Effect.fail(new Error("Digest mismatch"));
  const other=new URL(scoped.presignedUrl);other.pathname=new URL(b.url).pathname;
  const denied=yield* operation(()=>fetch(other));if(denied.status===200)return yield* Effect.fail(new Error("Exact-path scope failed"));
  yield* Effect.sleep(11000);
  const expired=yield* operation(()=>fetch(scoped.presignedUrl));if(expired.status===200)return yield* Effect.fail(new Error("Expired source access accepted"));
  const evidence={createdAt:new Date().toISOString(),stage:"actual Vercel private Blob trial",region:"iad1",syntheticFiles:2,totalUploadBytes:bytes.length*2,digest:createHash("sha256").update(bytes).digest("hex"),unsignedReadStatus:unsigned.status,signedReadStatus:download.status,exactPathIsolationStatus:denied.status,expiredReadStatus:expired.status,expiryWaitMs:11000,byteExact:true,cleanup:"exact two trial blobs deleted",scan:"not executed; independent of pending scanner choice",incrementalCostEstimate:"Two tiny writes and bounded reads, below one cent at ordinary published operation rates; included-plan allowance not separately measured"};
  return evidence;
 }),paths=>operation(()=>del(paths,{token})).pipe(Effect.tap(()=>Effect.log("Exact synthetic trial blobs removed")),Effect.orDie));
 yield* operation(()=>writeFile("evidence/blob-live.json",JSON.stringify(evidence,null,2)+"\n"));
 yield* Effect.log("Actual private Blob access, path scope and expiry verified; evidence/blob-live.json");
});
Effect.runPromise(main).catch(()=>{process.stderr.write("Private Blob trial failed; inspect implementation without printing capabilities.\n");process.exitCode=1;});
