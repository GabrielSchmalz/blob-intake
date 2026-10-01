import { Effect,Fiber,Schema } from "effect";
import pg from "pg";
import { IntakeError } from "../src/contract/index";
import { createScannerWorker } from "../src/scanner/worker";

const Environment=Schema.Struct({DATABASE_URL:Schema.NonEmptyString,BLOB_READ_WRITE_TOKEN:Schema.NonEmptyString,CALLBACK_SECRET:Schema.String.pipe(Schema.minLength(32)),BLOB_INTAKE_CALLBACK_URL:Schema.NonEmptyString,BLOB_INTAKE_SCHEMA:Schema.optionalWith(Schema.String,{default:()=>"blob_intake"}),CLAMAV_HOST:Schema.optionalWith(Schema.String,{default:()=>"127.0.0.1"}),CLAMAV_PORT:Schema.optionalWith(Schema.NumberFromString,{default:()=>3310}),SCANNER_IDLE_SECONDS:Schema.optionalWith(Schema.NumberFromString,{default:()=>600}),BLOB_INTAKE_WORKER_IDLE_MS:Schema.optional(Schema.NumberFromString)});
const program=Effect.gen(function*(){
 const env=yield* Schema.decodeUnknown(Environment)(process.env).pipe(Effect.mapError(()=>new IntakeError({code:"provider"})));
 const args=process.argv.slice(2),once=args.includes("--once");
 const idleMs=env.BLOB_INTAKE_WORKER_IDLE_MS??env.SCANNER_IDLE_SECONDS*1000;
 const numberOption=(name:string)=>{const index=args.indexOf(name);if(index<0)return null;const value=Number(args[index+1]);if(!Number.isSafeInteger(value)||value<=0)throw new IntakeError({code:"provider"});return value;};
 const limits=yield* Effect.try({try:()=>{for(let i=0;i<args.length;i++){if(args[i]==="--once")continue;if(args[i]==="--max-tasks"||args[i]==="--duration"){i++;continue;}throw new IntakeError({code:"provider"});}return {maxTasks:numberOption("--max-tasks"),durationSeconds:numberOption("--duration")};},catch:()=>new IntakeError({code:"provider"})});
 if(idleMs<1000||idleMs>3600000)return yield* Effect.fail(new IntakeError({code:"provider"}));
 const execution=Effect.acquireUseRelease(Effect.sync(()=>new pg.Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,query_timeout:15000})),pool=>Effect.gen(function*(){
  const worker=yield* createScannerWorker({pool,schema:env.BLOB_INTAKE_SCHEMA,now:Date.now,callbackSecret:env.CALLBACK_SECRET,blobToken:env.BLOB_READ_WRITE_TOKEN,callbackUrl:env.BLOB_INTAKE_CALLBACK_URL,clam:{host:env.CLAMAV_HOST,port:env.CLAMAV_PORT,timeoutMs:60000}});
  const started=Date.now();let processed=0;
  for(;;){
   if(limits.durationSeconds!==null&&Date.now()-started>=limits.durationSeconds*1000)break;
   const tick=yield* worker.runOnce().pipe(Effect.catchAll(()=>Effect.succeed({processed:false,outcome:"worker_error",callbackDelivered:false})));
   if(tick.processed)processed++;
   yield* Effect.logInfo("Scanner tick").pipe(Effect.annotateLogs({processed:tick.processed,outcome:tick.outcome??"idle",callbackDelivered:tick.callbackDelivered,processedTasks:processed}));
   if(once||limits.maxTasks!==null&&processed>=limits.maxTasks)break;
   const durationRemaining=limits.durationSeconds===null?Infinity:Math.max(0,limits.durationSeconds*1000-(Date.now()-started));
   const sleepMs=Math.min(tick.processed?100:idleMs,durationRemaining);
   if(sleepMs===0)break;
   yield* Effect.sleep(sleepMs);
  }
 }),pool=>Effect.tryPromise({try:()=>pool.end(),catch:()=>new IntakeError({code:"persistence"})}).pipe(Effect.ignore));
 if(limits.durationSeconds===null)yield* execution;else yield* execution.pipe(Effect.timeoutOption(limits.durationSeconds*1000));
});
const fiber=Effect.runFork(program.pipe(Effect.catchAll(error=>Effect.sync(()=>{process.stderr.write(`Scanner worker stopped: ${error.code}\n`);process.exitCode=1;}))));
const stop=()=>{void Effect.runPromise(Fiber.interrupt(fiber));};
process.once("SIGTERM",stop);process.once("SIGINT",stop);
await Effect.runPromise(Fiber.await(fiber));
