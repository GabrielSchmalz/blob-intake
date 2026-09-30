import { Effect, Schema } from "effect";
import { Pool } from "pg";
import { IntakeError, type AuthContext, type ProviderEvent } from "../contract/index";
import { ManagedScanSubmission, validateManagedSource } from "../integrations/managed-scanner";
import { createManagedQueue, initializeScanner } from "../scanner/queue";
import { authenticate, type AuthConfiguration } from "./auth";
import { readBoundedBody } from "./http";
export interface ManagedQueue { readonly submit:(context:AuthContext,input:ManagedScanSubmission)=>Effect.Effect<string,IntakeError>; readonly poll:(context:AuthContext,attemptId:string)=>Effect.Effect<ProviderEvent|null,IntakeError> }
export interface ManagedHttpDependencies {readonly auth?:AuthConfiguration;readonly queue?:()=>Effect.Effect<ManagedQueue,IntakeError>;readonly now?:()=>number}
let pool:Pool|undefined;
let initializedSchema:string|undefined;
const queue=()=>Effect.gen(function*(){
 if(!process.env.DATABASE_URL||!process.env.CALLBACK_SECRET||process.env.CALLBACK_SECRET.length<32)return yield* Effect.fail(new IntakeError({code:"persistence"}));
 pool??=new Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
 const options={pool,schema:process.env.BLOB_INTAKE_SCHEMA??"blob_intake",now:Date.now,callbackSecret:process.env.CALLBACK_SECRET};
 if(initializedSchema!==options.schema){yield* initializeScanner(options);initializedSchema=options.schema;}
 return createManagedQueue(options);
});
const denied=()=>new IntakeError({code:"denied"});
export function handleManagedScan(request:Request,deps:ManagedHttpDependencies={}):Promise<Response>{
 const program=Effect.gen(function*(){
  if(request.method!=="GET"&&request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"GET, POST"}});
  if(!request.headers.get("authorization")?.startsWith("Bearer "))return yield* Effect.fail(denied());
  const auth=deps.auth??{keysJson:process.env.BLOB_INTAKE_KEYS_JSON,sessionSecret:process.env.SESSION_SECRET};
  const context=yield* authenticate(request,auth,request.method==="POST");
  if(request.method==="POST"){
   const input=yield* Schema.decodeUnknown(Schema.parseJson(ManagedScanSubmission))(yield* readBoundedBody(request,16384)).pipe(Effect.mapError(denied));
   yield* validateManagedSource(input.source,(deps.now??Date.now)()).pipe(Effect.mapError(denied));
   const service=yield* (deps.queue??queue)();return Response.json({attemptId:yield* service.submit(context,input)});
  }
  const attemptId=yield* Schema.decodeUnknown(Schema.String.pipe(Schema.minLength(1),Schema.maxLength(128),Schema.pattern(/^[A-Za-z0-9._:-]+$/)))(new URL(request.url).searchParams.get("attemptId")).pipe(Effect.mapError(denied));
  const service=yield* (deps.queue??queue)();return Response.json({event:yield* service.poll(context,attemptId)});
 });
 return Effect.runPromise(program.pipe(Effect.catchAll(error=>Effect.succeed(Response.json({error:error.code},{status:error.code==="denied"?403:error.code==="not_found"?404:503}))),Effect.map(response=>{response.headers.set("Cache-Control","no-store");response.headers.set("X-Content-Type-Options","nosniff");return response;})));
}
