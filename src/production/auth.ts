import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";
import { IntakeError, type AuthContext } from "../contract/index";
const Key = Schema.Struct({keyHash:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),tenantId:Schema.NonEmptyString,userId:Schema.NonEmptyString});
const Session = Schema.Struct({tenantId:Schema.NonEmptyString,userId:Schema.NonEmptyString,expires:Schema.Number});
export interface AuthConfiguration { readonly keysJson:string|undefined; readonly sessionSecret:string|undefined; readonly now?:()=>number }
const denied=()=>new IntakeError({code:"denied"});
export const constantEqual=(a:string,b:string)=>{const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function sameOrigin(request:Request) { const origin=request.headers.get("origin"); const url=new URL(request.url); return origin!==null&&origin===`${url.protocol}//${request.headers.get("host")??url.host}`; }
export const authenticateKey=(key:string,config:AuthConfiguration)=>Effect.gen(function*(){
  if(key.length<24||key.length>256)return yield* Effect.fail(denied());
  const keys=yield* Schema.decodeUnknown(Schema.parseJson(Schema.Array(Key)))(config.keysJson??"[]").pipe(Effect.mapError(denied));
  const hash=createHash("sha256").update(key).digest("hex");
  const match=keys.find(value=>constantEqual(hash,value.keyHash));
  if(!match)return yield* Effect.fail(denied());
  return {tenantId:match.tenantId,userId:match.userId};
});
export const sessionCookie=(context:AuthContext,config:AuthConfiguration)=>Effect.gen(function*(){
  if(!config.sessionSecret||config.sessionSecret.length<32)return yield* Effect.fail(denied());
  const data=Buffer.from(JSON.stringify({...context,expires:(config.now??Date.now)()+3600000})).toString("base64url");
  const signature=createHmac("sha256",config.sessionSecret).update(data).digest("base64url");
  return `intake_session=${data}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`;
});
export const authenticate=(request:Request,config:AuthConfiguration,mutation=false)=>Effect.gen(function*(){
  const bearer=request.headers.get("authorization");
  if(bearer?.startsWith("Bearer ")) { if(mutation&&request.headers.has("origin")&&!sameOrigin(request))return yield* Effect.fail(denied()); return yield* authenticateKey(bearer.slice(7),config); }
  if(mutation&&!sameOrigin(request))return yield* Effect.fail(denied());
  const cookie=request.headers.get("cookie")?.split(";").map(part=>part.trim()).find(part=>part.startsWith("intake_session="))?.slice(15);
  if(!cookie||cookie.length>2048||!config.sessionSecret||config.sessionSecret.length<32)return yield* Effect.fail(denied());
  const pieces=cookie.split(".");if(pieces.length!==2)return yield* Effect.fail(denied());
  const data=pieces[0]??"", signature=pieces[1]??"";
  if(!constantEqual(signature,createHmac("sha256",config.sessionSecret).update(data).digest("base64url")))return yield* Effect.fail(denied());
  const session=yield* Schema.decodeUnknown(Schema.parseJson(Session))(Buffer.from(data,"base64url").toString()).pipe(Effect.mapError(denied));
  if(session.expires<=(config.now??Date.now)())return yield* Effect.fail(denied());
  const keys=yield* Schema.decodeUnknown(Schema.parseJson(Schema.Array(Key)))(config.keysJson??"[]").pipe(Effect.mapError(denied));
  if(!keys.some(key=>key.tenantId===session.tenantId&&key.userId===session.userId))return yield* Effect.fail(denied());
  return {tenantId:session.tenantId,userId:session.userId};
});
