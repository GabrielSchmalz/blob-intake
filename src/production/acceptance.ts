import { createHash, randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import type { PoolClient, QueryResultRow } from "pg";
import { IntakeError, MAX_BYTES, POLICY_VERSION, type AcceptanceApp, type AuthContext, type Clock, type JobStatus, type Provider, type ProviderEvent, type Reason, type Storage, type StoredFile } from "../contract/index";
import { databaseEffect, fileLock, ignoredFingerprint, initializePostgres, postgresTransaction, tableNames, type PostgresOptions } from "../persistence/postgres";

const ReasonSchema = Schema.Literal("type","size","mismatch","threat","outage","expired","unknown","conflict","changed");
const JobSchema = Schema.Struct({ jobId: Schema.String,tenantId: Schema.String,fileId: Schema.String,digest: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),declaredType: Schema.String,policyVersion: Schema.String,state: Schema.Literal("pending","processing","approved","rejected","failed"),reason: Schema.NullOr(ReasonSchema),attemptId: Schema.NullOr(Schema.String),providerId: Schema.NullOr(Schema.String),updatedAt: Schema.Number });
const EventSchema = Schema.Struct({ eventId: Schema.NonEmptyString,attemptId: Schema.NonEmptyString,digest: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),outcome: Schema.Literal("clean","threat","failed","unknown"),reason: Schema.NullOr(ReasonSchema) });
const FileSchema = Schema.Struct({bytes:Schema.Uint8ArrayFromSelf,declaredType:Schema.String});
const RowSchema = Schema.Struct({data:JobSchema,owner_id:Schema.String});
const digestOf = (file: StoredFile) => createHash("sha256").update(file.bytes).digest("hex");
function policy(file: StoredFile): Reason | null {
  if (file.bytes.length > MAX_BYTES) return "size";
  const b = file.bytes;
  const mime = b.length >= 5 && Buffer.from(b.subarray(0,5)).toString() === "%PDF-" ? "application/pdf"
    : b.length >= 8 && Buffer.from(b.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255 ? "image/jpeg" : null;
  return mime === null ? "type" : mime !== file.declaredType ? "mismatch" : null;
}
const matches = (file:StoredFile,job:JobStatus) => digestOf(file) === job.digest && file.declaredType === job.declaredType && job.policyVersion === POLICY_VERSION && policy(file) === null;
export interface PostgresIntakeOptions extends PostgresOptions { readonly storage: Storage; readonly provider: Provider; readonly clock: Clock; readonly initialize?: boolean }
/** Shared metadata, independent function instances, app-owned connection lifecycle. */
export interface ProductionAcceptanceApp extends AcceptanceApp { readonly reconcileFor: (context: AuthContext) => Effect.Effect<number,IntakeError> }
export const createPostgresIntake = (deps: PostgresIntakeOptions): Effect.Effect<ProductionAcceptanceApp,IntakeError> => Effect.gen(function* () {
  if (deps.initialize !== false) yield* initializePostgres(deps);
  const t = yield* Effect.try({try:()=>tableNames(deps.schema),catch:()=>new IntakeError({code:"persistence"})});
  type Client = Pick<PoolClient,"query">;
  const decode = (row: QueryResultRow | undefined) => row === undefined ? null : Schema.decodeUnknownSync(RowSchema)(row);
  const get = async (client: Client,id:string) => decode((await client.query(`SELECT data,owner_id FROM ${t.jobs} WHERE id=$1`,[id])).rows[0]);
  const save = async (client:Client,job:JobStatus) => { await client.query(`UPDATE ${t.jobs} SET data=$1 WHERE id=$2`,[JSON.stringify(job),job.jobId]); return job; };
  const current = async (client:Client,job:JobStatus) => (await client.query(`SELECT job FROM ${t.current} WHERE tenant=$1 AND file=$2 AND job=$3`,[job.tenantId,job.fileId,job.jobId])).rowCount !== 0;
  const read = (ctx:AuthContext,fileId:string) => deps.storage.read(ctx,fileId).pipe(Effect.flatMap(file=>Schema.decodeUnknown(FileSchema)(file).pipe(Effect.mapError(()=>new IntakeError({code:"storage"})))));
  const authorize = (ctx:AuthContext,id:string) => Effect.gen(function* () {
    const row = yield* databaseEffect(()=>get(deps.pool,id));
    if (!row) return yield* Effect.fail(new IntakeError({code:"not_found"}));
    if (row.data.tenantId !== ctx.tenantId) return yield* Effect.fail(new IntakeError({code:"denied"}));
    return {job:row.data,file:yield* read(ctx,row.data.fileId)};
  });
  const mutate = <A>(job:JobStatus,fn:(client:PoolClient,fresh:JobStatus)=>Promise<A>) => postgresTransaction(deps,[fileLock(job.tenantId,job.fileId)],async client=> {
    const row = await get(client,job.jobId);
    if (!row) throw new IntakeError({code:"not_found"});
    return fn(client,row.data);
  });
  const invalidate = (job:JobStatus) => mutate(job,async (client,fresh)=>fresh.reason === "conflict" ? fresh : save(client,{...fresh,state:"failed",reason:"changed",updatedAt:deps.clock.now()}));
  const eventJob = (attemptId:string) => databaseEffect(async()=>decode((await deps.pool.query(`SELECT j.data,j.owner_id FROM ${t.jobs} j JOIN ${t.attempts} a ON a.job=j.id WHERE a.id=$1`,[attemptId])).rows[0]));
  const apply = (event:ProviderEvent) => Effect.gen(function* () {
    const binding = yield* eventJob(event.attemptId);
    const keys = [`event:${event.eventId}`,...binding ? [fileLock(binding.data.tenantId,binding.data.fileId)] : []];
    return yield* postgresTransaction(deps,keys,async client=> {
      const row = decode((await client.query(`SELECT j.data,j.owner_id FROM ${t.jobs} j JOIN ${t.attempts} a ON a.job=j.id WHERE a.id=$1`,[event.attemptId])).rows[0]);
      const job = row?.data;
      if (!job || job.attemptId !== event.attemptId || job.digest !== event.digest || !(await current(client,job)) || job.reason === "changed" || job.reason === "conflict") {
        await client.query(`INSERT INTO ${t.ignored} VALUES($1,$2) ON CONFLICT DO NOTHING`,[ignoredFingerprint(event),JSON.stringify(event)]);
        return {eventId:event.eventId,applied:false};
      }
      const previous = (await client.query(`SELECT data FROM ${t.events} WHERE id=$1`,[event.eventId])).rows[0];
      if (previous !== undefined) {
        const old = Schema.decodeUnknownSync(Schema.Struct({data:EventSchema}))(previous).data;
        if (JSON.stringify(old) !== JSON.stringify(event)) throw new IntakeError({code:"invalid_callback"});
        return {eventId:event.eventId,applied:false};
      }
      await client.query(`INSERT INTO ${t.events} VALUES($1,$2)`,[event.eventId,JSON.stringify(event)]);
      const state = event.outcome === "clean" ? "approved" : event.outcome === "threat" ? "rejected" : "failed";
      const reason:Reason|null = event.outcome === "clean" ? null : event.outcome === "threat" ? "threat" : event.reason ?? "unknown";
      if (job.state === "approved" || job.state === "rejected") {
        const contradiction = state !== "failed" && job.state !== state;
        if (contradiction) await save(client,{...job,state:"failed",reason:"conflict",updatedAt:deps.clock.now()});
        return {eventId:event.eventId,applied:contradiction};
      }
      await save(client,{...job,state,reason,updatedAt:deps.clock.now()});
      return {eventId:event.eventId,applied:true};
    });
  });
  const accept = (event:ProviderEvent) => Effect.gen(function* () {
    const binding = yield* eventJob(event.attemptId);
    if (binding && binding.data.attemptId === event.attemptId && binding.data.digest === event.digest) {
      const file = yield* read({tenantId:binding.data.tenantId,userId:binding.owner_id},binding.data.fileId).pipe(Effect.either);
      if (file._tag === "Left" || !matches(file.right,binding.data)) yield* invalidate(binding.data);
    }
    return yield* apply(event);
  });
  const submit:AcceptanceApp["submit"] = (ctx,id) => Effect.gen(function* () {
    const {job,file} = yield* authorize(ctx,id);
    if (!matches(file,job)) return job.state === "rejected" ? job : yield* invalidate(job);
    const claim = yield* mutate(job,async(client,fresh)=> {
      if (!(await current(client,fresh))) throw new IntakeError({code:"inaccessible"});
      if (fresh.state !== "pending") return {job:fresh,claimed:false};
      const next:JobStatus = {...fresh,state:"processing",attemptId:randomUUID(),providerId:null,updatedAt:deps.clock.now()};
      await client.query(`INSERT INTO ${t.attempts} VALUES($1,$2)`,[next.attemptId,id]);
      return {job:await save(client,next),claimed:true};
    });
    if (!claim.claimed || claim.job.attemptId === null) return claim.job;
    const attemptId = claim.job.attemptId;
    const result = yield* deps.provider.submit({attemptId,tenantId:ctx.tenantId,fileId:job.fileId,digest:job.digest,bytes:file.bytes,declaredType:file.declaredType}).pipe(Effect.flatMap(value=>Schema.decodeUnknown(Schema.NonEmptyString)(value).pipe(Effect.mapError(()=>new IntakeError({code:"provider"})))),Effect.either);
    return yield* mutate(job,async(client,fresh)=> {
      if (fresh.attemptId !== attemptId) return fresh;
      if (result._tag === "Right") return save(client,{...fresh,providerId:result.right,updatedAt:deps.clock.now()});
      if (fresh.state !== "processing") return fresh;
      return save(client,{...fresh,state:"failed",reason:"outage",updatedAt:deps.clock.now()});
    });
  });
  const reconcile = (context?:AuthContext) => Effect.gen(function* () {
      const rows = yield* databaseEffect(async()=> (await deps.pool.query(`SELECT data,owner_id FROM ${t.jobs} WHERE data->>'attemptId' IS NOT NULL AND (data->>'updatedAt')::bigint <= $1 AND data->>'state' IN ('processing','failed') ${context ? "AND tenant=$2 AND owner_id=$3" : ""}`,context ? [deps.clock.now()-60_000,context.tenantId,context.userId] : [deps.clock.now()-60_000])).rows.map(row=>Schema.decodeUnknownSync(RowSchema)(row)));
      let count = 0;
      for (const row of rows) {
        const job = row.data; if (job.attemptId === null) continue;
        const file = yield* read({tenantId:job.tenantId,userId:row.owner_id},job.fileId).pipe(Effect.either);
        if (file._tag === "Left" || !matches(file.right,job)) {yield* invalidate(job);continue;}
        const result = yield* deps.provider.poll(job.attemptId).pipe(Effect.either);
        if (result._tag === "Right" && result.right !== null) {
          const event = yield* Schema.decodeUnknown(EventSchema)(result.right).pipe(Effect.mapError(()=>new IntakeError({code:"provider"})));
          if (event.attemptId !== job.attemptId || event.digest !== job.digest) continue;
          if ((yield* apply(event)).applied) count++;
        }
      }
      return count;
  });
  const app:ProductionAcceptanceApp = {
    register:(ctx,fileId)=>Effect.gen(function* () {
      const file = yield* read(ctx,fileId); const digest = digestOf(file);
      return yield* postgresTransaction(deps,[fileLock(ctx.tenantId,fileId)],async client=> {
        const identity = JSON.stringify([digest,file.declaredType,POLICY_VERSION]);
        const old = decode((await client.query(`SELECT data,owner_id FROM ${t.jobs} WHERE tenant=$1 AND file=$2 AND identity=$3`,[ctx.tenantId,fileId,identity])).rows[0]);
        let job:JobStatus;
        if (old) job = old.data;
        else {
          const reason = policy(file);
          job = {jobId:randomUUID(),tenantId:ctx.tenantId,fileId,digest,declaredType:file.declaredType,policyVersion:POLICY_VERSION,state:reason === null ? "pending" : "rejected",reason,attemptId:null,providerId:null,updatedAt:deps.clock.now()};
          await client.query(`INSERT INTO ${t.jobs} VALUES($1,$2,$3,$4,$5,$6)`,[job.jobId,ctx.tenantId,fileId,identity,ctx.userId,JSON.stringify(job)]);
        }
        await client.query(`INSERT INTO ${t.current} VALUES($1,$2,$3) ON CONFLICT(tenant,file) DO UPDATE SET job=EXCLUDED.job`,[ctx.tenantId,fileId,job.jobId]);
        return job;
      });
    }),
    submit,
    status:(ctx,id)=>Effect.gen(function* () { const {job,file} = yield* authorize(ctx,id); return matches(file,job) || job.state === "rejected" ? job : yield* invalidate(job); }),
    callback:raw=>deps.provider.verifyCallback(raw).pipe(Effect.flatMap(value=>Schema.decodeUnknown(EventSchema)(value).pipe(Effect.mapError(()=>new IntakeError({code:"invalid_callback"})))),Effect.flatMap(accept)),
    reconcile:()=>reconcile(),
    reconcileFor:context=>reconcile(context),
    retry:(ctx,id)=>Effect.gen(function* () {
      const {job,file} = yield* authorize(ctx,id);
      if (!matches(file,job)) return yield* invalidate(job);
      yield* mutate(job,async(client,fresh)=> {
        if (!(await current(client,fresh)) || fresh.state !== "failed" || fresh.reason === "changed" || fresh.reason === "conflict") throw new IntakeError({code:"inaccessible"});
        await save(client,{...fresh,state:"pending",reason:null,attemptId:null,providerId:null,updatedAt:deps.clock.now()});
      });
      return yield* submit(ctx,id);
    }),
    deliver:(ctx,fileId)=>Effect.gen(function* () {
      const file = yield* read(ctx,fileId);
      const row = yield* databaseEffect(async()=>decode((await deps.pool.query(`SELECT j.data,j.owner_id FROM ${t.jobs} j JOIN ${t.current} c ON c.job=j.id WHERE c.tenant=$1 AND c.file=$2`,[ctx.tenantId,fileId])).rows[0]));
      if (!row || row.data.state !== "approved") return yield* Effect.fail(new IntakeError({code:"inaccessible"}));
      if (!matches(file,row.data)) {yield* invalidate(row.data);return yield* Effect.fail(new IntakeError({code:"inaccessible"}));}
      return file.bytes;
    }),
    close:()=>Effect.void,
  };
  return app;
});
