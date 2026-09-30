import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { Effect } from "effect";
import { createPostgresIntake } from "../src/production/acceptance";
import { createPostgresAssemblyRegistry,createPostgresFiles,initializePostgres,tableNames } from "../src/persistence/postgres";
import { FixtureClock,FixtureProvider,FixtureStorage,signed,tenantA,tenantB } from "../fixtures/dependencies";
import { scenarios } from "./scenarios";

const connectionString = process.env.BLOB_INTAKE_TEST_DATABASE_URL;
const enabled = typeof connectionString === "string" && connectionString.length > 0;
const prefix = () => `blob_intake_test_${randomUUID().replaceAll("-","")}`;
const run = <A>(program:Effect.Effect<A,unknown>)=>Effect.runPromise(program);
for (const scenario of scenarios) test(`postgres ${scenario.id}: ${scenario.name}`,{skip:!enabled},async()=> {
  const pool = new pg.Pool({connectionString,max:6,connectionTimeoutMillis:15_000,query_timeout:15_000});
  const base = prefix(); const schemas = new Set<string>();
  try {
    await scenario.run(deps=>Effect.gen(function* () {
      const schema = `${base}_${createHash("sha256").update(deps.databasePath).digest("hex").slice(0,8)}`;
      if (!schemas.has(schema)) {yield* initializePostgres({pool,schema});schemas.add(schema);}
      return yield* createPostgresIntake({...deps,pool,schema,initialize:false});
    }));
  } finally {
    for (const schema of schemas) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

test("postgres independent pools claim one attempt, preserve restart and callback conflict",{skip:!enabled},async()=> {
  const first = new pg.Pool({connectionString,max:4,connectionTimeoutMillis:15_000,query_timeout:15_000}); const second = new pg.Pool({connectionString,max:4,connectionTimeoutMillis:15_000,query_timeout:15_000});
  const schema = prefix(); const storage = new FixtureStorage(); storage.put(tenantA,"file");
  const provider = new FixtureProvider(); const clock = new FixtureClock();
  try {
    await run(initializePostgres({pool:first,schema}));
    const a = await run(createPostgresIntake({pool:first,schema,initialize:false,storage,provider,clock}));
    const b = await run(createPostgresIntake({pool:second,schema,initialize:false,storage,provider,clock}));
    const registrations = await Promise.all([run(a.register(tenantA,"file")),run(b.register(tenantA,"file"))]);
    assert.equal(registrations[0].jobId,registrations[1].jobId);
    const jobs = await Promise.all([run(a.submit(tenantA,registrations[0].jobId)),run(b.submit(tenantA,registrations[0].jobId))]);
    assert.equal(provider.submitCalls,1); assert.equal(jobs[0].attemptId,jobs[1].attemptId);
    const clean = provider.complete(jobs[0]);
    const callbacks = await Promise.all([run(a.callback(signed(clean))),run(b.callback(signed(clean)))]);
    assert.equal(callbacks.filter(value=>value.applied).length,1);
    assert.equal((await run(b.status(tenantA,jobs[0].jobId))).state,"approved");
    await first.end();
    const restarted = await run(createPostgresIntake({pool:second,schema,initialize:false,storage,provider,clock}));
    assert.deepEqual(await run(restarted.deliver(tenantA,"file")),(await run(storage.read(tenantA,"file"))).bytes);
    const collision = await run(Effect.either(b.callback(signed({...clean,outcome:"threat"}))));
    assert.equal(collision._tag,"Left"); if (collision._tag === "Left") assert.equal(collision.left.code,"invalid_callback");
    await run(b.callback(signed(provider.event(jobs[0],"threat"))));
    clock.advance(61_000); provider.outage = true;
    await run(b.reconcile());
    assert.equal((await run(b.status(tenantA,jobs[0].jobId))).reason,"conflict");
    assert.equal(await run(Effect.isFailure(b.deliver(tenantA,"file"))),true);
  } finally {await second.query(`DROP SCHEMA "${schema}" CASCADE`);await second.end();if (!first.ended) await first.end();}
});

test("postgres manifests and provider bindings persist immutable scoped identities",{skip:!enabled},async()=> {
  const pool = new pg.Pool({connectionString,connectionTimeoutMillis:15_000,query_timeout:15_000});const schema = prefix();
  try {
    await run(initializePostgres({pool,schema}));
    const files = createPostgresFiles({pool,schema});const digest = "a".repeat(64);
    await run(files.storePendingFile(tenantA,{fileId:"file",pathname:"tenant/file.pdf",name:"file.pdf",declaredType:"application/pdf"}));
    assert.equal(await run(files.getOwnedFile(tenantB,"file")),null);
    await run(files.completeFile(tenantA,"file",digest,null));
    await run(files.completeFile(tenantA,"file",digest,"job"));
    assert.equal(await run(Effect.isFailure(files.completeFile(tenantA,"file","b".repeat(64),"job"))),true);
    assert.equal(await run(Effect.isFailure(files.completeFile(tenantA,"file",digest,"another-job"))),true);
    assert.equal((await run(files.listOwnedFiles(tenantA)))[0]?.jobId,"job");
    const registry = createPostgresAssemblyRegistry({pool,schema});
    const binding = {attemptId:"attempt",assemblyId:"a".repeat(32),tenantId:tenantA.tenantId,fileId:"file",digest};
    await Promise.all([run(registry.save(binding)),run(registry.save(binding))]);
    assert.deepEqual(await run(registry.byAssembly(binding.assemblyId)),binding);
    assert.equal(await run(Effect.isFailure(registry.save({...binding,digest:"b".repeat(64)}))),true);
  } finally {await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();}
});

test("postgres schema identifiers reject SQL metacharacters",()=> {
  assert.throws(()=>tableNames('bad";DROP SCHEMA public;--'));
  assert.throws(()=>tableNames(""));
  assert.equal(tableNames("blob_intake").jobs,'"blob_intake".jobs');
});

test("postgres scoped recovery cannot poll another tenant or same-tenant owner",{skip:!enabled},async()=> {
  const pool = new pg.Pool({connectionString,connectionTimeoutMillis:15_000,query_timeout:15_000});
  const schema = prefix(); const storage = new FixtureStorage();const provider = new FixtureProvider(); const clock = new FixtureClock();
  const otherOwner = {...tenantA,userId:"another-user"};
  try {
    await run(initializePostgres({pool,schema}));
    const app = await run(createPostgresIntake({pool,schema,initialize:false,storage,provider,clock}));
    const contexts = [tenantA,tenantB,otherOwner];
    const jobs = [];
    for (const [index,context] of contexts.entries()) {
      const fileId = `scoped-${index}`;storage.put(context,fileId);
      const registered = await run(app.register(context,fileId));
      const job = await run(app.submit(context,registered.jobId));provider.complete(job);jobs.push(job);
    }
    const [ownJob,otherTenantJob,otherOwnerJob] = jobs;
    assert.ok(ownJob);assert.ok(otherTenantJob);assert.ok(otherOwnerJob);
    clock.advance(61_000);
    assert.equal(await run(app.reconcileFor(tenantA)),1);
    assert.equal(provider.pollCalls,1);
    assert.equal((await run(app.status(tenantA,ownJob.jobId))).state,"approved");
    assert.equal((await run(app.status(tenantB,otherTenantJob.jobId))).state,"processing");
    assert.equal((await run(app.status(otherOwner,otherOwnerJob.jobId))).state,"processing");
    assert.equal(await run(app.reconcileFor({...tenantB,userId:tenantA.userId})),0);
    assert.equal(provider.pollCalls,1);
    assert.equal(await run(app.reconcile()),2);
    assert.equal(provider.pollCalls,3);
  } finally {await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();}
});

test("postgres concurrent migrations serialize across independent pools",{skip:!enabled},async()=> {
  const first = new pg.Pool({connectionString,connectionTimeoutMillis:15_000,query_timeout:15_000});
  const second = new pg.Pool({connectionString,connectionTimeoutMillis:15_000,query_timeout:15_000});
  const schema = prefix();
  try {
    await Promise.all([run(initializePostgres({pool:first,schema})),run(initializePostgres({pool:second,schema}))]);
    const tables = await first.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=$1",[schema]);
    assert.equal(tables.rows[0]?.count,7);
  } finally {await first.query(`DROP SCHEMA "${schema}" CASCADE`);await first.end();await second.end();}
});
