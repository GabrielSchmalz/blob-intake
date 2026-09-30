import { createConnection } from "node:net";
import { Data,Effect } from "effect";
import { MAX_BYTES } from "../contract/index";
export class ScannerError extends Data.TaggedError("ScannerError")<{readonly reason:"scan"|"stale"|"storage"|"changed"|"expired"|"mismatch"|"type"|"size"}>{}
export interface ClamOptions {readonly host:string;readonly port:number;readonly now:()=>number;readonly timeoutMs?:number;readonly maximumSignatureAgeMs?:number}
export interface ClamHealth {readonly engine:string;readonly signatureVersion:string;readonly signatureBuiltAt:number;readonly checkedAt:number}
const failure=()=>new ScannerError({reason:"scan"});
/** ClamD z-framing with bounded TCP response and length-prefixed INSTREAM bytes. */
const command=(options:ClamOptions,command:string,bytes?:Uint8Array)=>Effect.tryPromise({try:(signal)=>new Promise<string>((resolve,reject)=>{
 if(!["127.0.0.1","localhost","::1"].includes(options.host)||!Number.isInteger(options.port)||options.port<1||options.port>65535||bytes&&bytes.length>MAX_BYTES){reject(failure());return;}
 const socket=createConnection({host:options.host,port:options.port});let done=false;let response=Buffer.alloc(0);
 const stop=(error?:unknown,value?:string)=>{if(done)return;done=true;signal.removeEventListener("abort",abort);socket.destroy();if(error)reject(error);else resolve(value??"");};
 const abort=()=>stop(failure());signal.addEventListener("abort",abort,{once:true});
 socket.setTimeout(options.timeoutMs??60_000,()=>stop(failure()));
 socket.on("error",()=>stop(failure()));socket.on("close",()=>{if(!done)stop(failure());});
 socket.on("data",chunk=>{
  if(typeof chunk==="string"){stop(failure());return;}
  response=Buffer.concat([response,chunk]);if(response.length>8192){stop(failure());return;}
  const terminator=response.indexOf(0);if(terminator>=0){if(terminator!==response.length-1){stop(failure());return;}stop(undefined,response.subarray(0,terminator).toString("utf8"));}
 });
 const write=(chunk:Uint8Array)=>new Promise<void>((accept,decline)=>socket.write(chunk,error=>error?decline(error):accept()));
 socket.on("connect",()=>{void (async()=>{
  await write(Buffer.from(`z${command}\0`));
  if(bytes){for(let offset=0;offset<bytes.length;offset+=64*1024){const chunk=bytes.subarray(offset,offset+64*1024);const length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);await write(length);await write(chunk);}await write(Buffer.alloc(4));}
 })().catch(()=>stop(failure()));});
 if(signal.aborted)abort();
}),catch:failure});
export function parseClamHealth(reply:string,now:number,maximumSignatureAgeMs=72*60*60_000):ClamHealth{
 const match=/^ClamAV ([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[a-z0-9.-]*)?)\/([0-9]+)\/(.+)$/.exec(reply);
 if(!match||!match[1]||!match[2]||!match[3])throw failure();
 const signatureBuiltAt=Date.parse(`${match[3]} UTC`);
 if(!Number.isFinite(signatureBuiltAt)||signatureBuiltAt<now-maximumSignatureAgeMs||signatureBuiltAt>now+5*60_000)throw new ScannerError({reason:"stale"});
 return {engine:match[1],signatureVersion:match[2],signatureBuiltAt,checkedAt:now};
}
export function createClamClient(options:ClamOptions){return {
 health:()=>command({...options,timeoutMs:Math.min(options.timeoutMs??5000,5000)},"VERSION").pipe(Effect.timeoutFail({duration:5000,onTimeout:failure}),Effect.flatMap(reply=>Effect.try({try:()=>parseClamHealth(reply,options.now(),options.maximumSignatureAgeMs),catch:error=>error instanceof ScannerError?error:failure()}))),
 scan:(bytes:Uint8Array)=>command(options,"INSTREAM",bytes).pipe(Effect.timeoutFail({duration:Math.min(options.timeoutMs??60_000,60_000),onTimeout:failure}),Effect.flatMap(reply=>reply==="stream: OK"?Effect.succeed<"clean"|"threat">("clean"):/^stream: [^\r\n\0]+ FOUND$/.test(reply)?Effect.succeed<"clean"|"threat">("threat"):Effect.fail(failure()))),
};}
