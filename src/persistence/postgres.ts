import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { IntakeError, type AuthContext } from "../contract/index";
import type { AssemblyBinding, AssemblyRegistry } from "../integrations/transloadit";

export interface PostgresOptions { readonly pool: Pool; readonly schema: string }
export const persistenceFailure = (cause: unknown) => cause instanceof IntakeError ? cause : new IntakeError({ code: "persistence" });
export const databaseEffect = <A>(operation: () => Promise<A>): Effect.Effect<A, IntakeError> => Effect.tryPromise({ try: operation, catch: persistenceFailure });
export function tableNames(schema: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new IntakeError({ code: "persistence" });
  const prefix = `"${schema}".`;
  return { jobs: `${prefix}jobs`, current: `${prefix}current_files`, attempts: `${prefix}attempts`, events: `${prefix}events`, ignored: `${prefix}ignored_events`, bindings: `${prefix}provider_bindings`, files: `${prefix}files` };
}
export const initializePostgres = (options: PostgresOptions) => postgresTransaction(options, ["migration"], async (client) => {
  const t = tableNames(options.schema);
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${options.schema}";
    CREATE TABLE IF NOT EXISTS ${t.jobs} (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, file TEXT NOT NULL, identity TEXT NOT NULL, owner_id TEXT NOT NULL, data JSONB NOT NULL, UNIQUE(tenant,file,identity));
    CREATE TABLE IF NOT EXISTS ${t.current} (tenant TEXT NOT NULL,file TEXT NOT NULL,job TEXT NOT NULL,PRIMARY KEY(tenant,file));
    CREATE TABLE IF NOT EXISTS ${t.attempts} (id TEXT PRIMARY KEY,job TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ${t.events} (id TEXT PRIMARY KEY,data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS ${t.ignored} (fingerprint TEXT PRIMARY KEY,data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS ${t.bindings} (attempt_id TEXT PRIMARY KEY,assembly_id TEXT UNIQUE NOT NULL,tenant_id TEXT NOT NULL,file_id TEXT NOT NULL,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ${t.files} (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,pathname TEXT UNIQUE NOT NULL,name TEXT NOT NULL,declared_type TEXT NOT NULL,digest TEXT,job_id TEXT,created_at BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_tenant_file ON ${t.jobs}(tenant,file);
    CREATE INDEX IF NOT EXISTS files_tenant_owner ON ${t.files}(tenant_id,user_id);`);
});
/** Lock only metadata mutations. Provider and Blob calls always occur outside. */
export const postgresTransaction = <A>(options: PostgresOptions, keys: readonly string[], operation: (client: PoolClient) => Promise<A>) => databaseEffect(async () => {
  const client = await options.pool.connect();
  let begun = false;
  try {
    await client.query("BEGIN"); begun = true;
    for (const key of keys) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${options.schema}:${key}`]);
    const result = await operation(client);
    await client.query("COMMIT"); begun = false;
    return result;
  } catch (error) {
    if (begun) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
});
export const fileLock = (tenantId: string, fileId: string) => `file:${JSON.stringify([tenantId,fileId])}`;
const BindingSchema = Schema.Struct({ attemptId: Schema.String, assemblyId: Schema.String, tenantId: Schema.String, fileId: Schema.String, digest: Schema.String });
export function createPostgresAssemblyRegistry(options: PostgresOptions): AssemblyRegistry {
  const t = tableNames(options.schema);
  const lookup = (column: "attempt_id" | "assembly_id", id: string) => databaseEffect(async () => {
    const result = await options.pool.query(`SELECT attempt_id AS "attemptId",assembly_id AS "assemblyId",tenant_id AS "tenantId",file_id AS "fileId",digest FROM ${t.bindings} WHERE ${column}=$1`, [id]);
    return result.rows[0] === undefined ? null : Schema.decodeUnknownSync(BindingSchema)(result.rows[0]);
  });
  return {
    byAttempt: id => lookup("attempt_id",id), byAssembly: id => lookup("assembly_id",id),
    save: binding => postgresTransaction(options,[`binding:${binding.attemptId}`],async client => {
      const existing = await client.query(`SELECT attempt_id AS "attemptId",assembly_id AS "assemblyId",tenant_id AS "tenantId",file_id AS "fileId",digest FROM ${t.bindings} WHERE attempt_id=$1`,[binding.attemptId]);
      if (existing.rows[0] !== undefined) {
        const old: AssemblyBinding = Schema.decodeUnknownSync(BindingSchema)(existing.rows[0]);
        if (JSON.stringify(old) !== JSON.stringify(Schema.decodeUnknownSync(BindingSchema)(binding))) throw new IntakeError({ code:"persistence" });
        return;
      }
      await client.query(`INSERT INTO ${t.bindings} VALUES($1,$2,$3,$4,$5)`,[binding.attemptId,binding.assemblyId,binding.tenantId,binding.fileId,binding.digest]);
    }),
  };
}
const FileSchema = Schema.Struct({ fileId: Schema.String,tenantId: Schema.String,userId: Schema.String,pathname: Schema.String,name: Schema.String,declaredType: Schema.String,digest: Schema.NullOr(Schema.String),jobId: Schema.NullOr(Schema.String),createdAt: Schema.NumberFromString });
export type HostedFile = typeof FileSchema.Type;
export interface PendingFile { readonly fileId: string; readonly pathname: string; readonly name: string; readonly declaredType: string }
const fileSelect = 'id AS "fileId",tenant_id AS "tenantId",user_id AS "userId",pathname,name,declared_type AS "declaredType",digest,job_id AS "jobId",created_at AS "createdAt"';
export function createPostgresFiles(options: PostgresOptions) {
  const t = tableNames(options.schema);
  const decode = (row: QueryResultRow | undefined) => row === undefined ? null : Schema.decodeUnknownSync(FileSchema)(row);
  return {
    storePendingFile: (context: AuthContext,file: PendingFile) => databaseEffect(async () => {
      await options.pool.query(`INSERT INTO ${t.files}(id,tenant_id,user_id,pathname,name,declared_type,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[file.fileId,context.tenantId,context.userId,file.pathname,file.name,file.declaredType,Date.now()]);
    }),
    getOwnedFile: (context: AuthContext,fileId: string) => databaseEffect(async () => decode((await options.pool.query(`SELECT ${fileSelect} FROM ${t.files} WHERE id=$1 AND tenant_id=$2 AND user_id=$3`,[fileId,context.tenantId,context.userId])).rows[0])),
    resolveSource: (tenantId: string,fileId: string) => databaseEffect(async () => decode((await options.pool.query(`SELECT ${fileSelect} FROM ${t.files} WHERE id=$1 AND tenant_id=$2`,[fileId,tenantId])).rows[0])),
    completeFile: (context: AuthContext,fileId: string,digest: string,jobId: string | null) => postgresTransaction(options,[fileLock(context.tenantId,fileId)],async client => {
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new IntakeError({code:"storage"});
      const row = decode((await client.query(`SELECT ${fileSelect} FROM ${t.files} WHERE id=$1 AND tenant_id=$2 AND user_id=$3`,[fileId,context.tenantId,context.userId])).rows[0]);
      if (!row) throw new IntakeError({code:"not_found"});
      if (row.digest !== null && row.digest !== digest) throw new IntakeError({code:"inaccessible"});
      if (row.jobId !== null && jobId !== null && row.jobId !== jobId) throw new IntakeError({code:"inaccessible"});
      await client.query(`UPDATE ${t.files} SET digest=$1,job_id=COALESCE(job_id,$2) WHERE id=$3`,[digest,jobId,fileId]);
    }),
    listOwnedFiles: (context: AuthContext) => databaseEffect(async () => (await options.pool.query(`SELECT ${fileSelect} FROM ${t.files} WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC`,[context.tenantId,context.userId])).rows.map(row => Schema.decodeUnknownSync(FileSchema)(row))),
  };
}
export const ignoredFingerprint = (event: unknown) => createHash("sha256").update(JSON.stringify(event)).digest("hex");
