export const localExample = `import { Effect } from "effect";
import { createIntake } from "./src/adapter/index";
import {
  FixtureStorage, FixtureProvider, FixtureClock, tenantA, signed,
} from "./fixtures/dependencies";

const storage = new FixtureStorage();
const provider = new FixtureProvider();
const clock = new FixtureClock();
storage.put(tenantA, "example-pdf");

await Effect.runPromise(Effect.gen(function* () {
  const app = yield* createIntake({
    databasePath: ":memory:", storage, provider, clock,
  });
  try {
    const job = yield* app.register(tenantA, "example-pdf");
    const processing = yield* app.submit(tenantA, job.jobId);
    // Synthetic completion only: this is NOT a malware scan.
    yield* app.callback(signed(provider.complete(processing)));
    const status = yield* app.status(tenantA, job.jobId);
    const bytes = yield* app.deliver(tenantA, "example-pdf");
    console.log(status.state, bytes.length);
  } finally {
    yield* app.close();
  }
}));`;
export const productionExample = `import { Effect } from "effect";
import { Pool } from "pg";
import { IntakeError } from "./src/contract/index";
import { createPostgresFiles } from "./src/persistence/postgres";
import { createPostgresIntake } from "./src/production/acceptance";
import { createPrivateBlobIntegration } from "./src/integrations/vercel-blob";
import { createManagedScannerProvider } from "./src/integrations/managed-scanner";

// Validate these server-only environment values at startup.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const options = { pool, schema: "blob_intake" };
const files = createPostgresFiles(options);
const blobs = createPrivateBlobIntegration({
  token: process.env.BLOB_READ_WRITE_TOKEN!,
  now: Date.now,
  resolve: (context, fileId) => files.getOwnedFile(context, fileId).pipe(
    Effect.flatMap(file => file?.digest
      ? Effect.succeed({ pathname: file.pathname, digest: file.digest })
      : Effect.fail(new IntakeError({ code: "denied" }))),
  ),
  resolveSource: (tenantId, fileId) => files.resolveSource(tenantId, fileId).pipe(
    Effect.flatMap(file => file?.digest
      ? Effect.succeed({ pathname: file.pathname, digest: file.digest })
      : Effect.fail(new IntakeError({ code: "denied" }))),
  ),
});
const provider = createManagedScannerProvider({
  apiKey: process.env.BLOB_INTAKE_API_KEY!,
  baseUrl: "https://blob-intake.vercel.app",
  source: blobs.source,
});
const intake = await Effect.runPromise(createPostgresIntake({
  ...options, storage: blobs.storage, provider, clock: { now: Date.now },
}));

// Derive context from a verified session, never upload JSON.
// Persist private upload metadata and a backend-calculated digest first.
const job = await Effect.runPromise(intake.register(context, fileId));
await Effect.runPromise(intake.submit(context, job.jobId));
// Later, recover a completed remote scan through authenticated polling.
await Effect.runPromise(intake.reconcileFor(context));
const status = await Effect.runPromise(intake.status(context, job.jobId));
// Still checks authorization and immutable content; denies until approved.
const bytes = await Effect.runPromise(intake.deliver(context, fileId));`;
export const guideMarkdown = `# Blob Intake

Blob Intake SDK plus our managed ClamAV scanner for private Vercel Blob files in Next.js applications. Early MIT source integration and operator-provisioned pilot, not a published npm package or security certification.

## When to use it
Use this when an authenticated app accepts private PDF, PNG or JPEG uploads and must prevent download until checks finish. Blob Intake packages content-bound acceptance state, verified callback handling, missed-callback polling and fail-closed delivery. The chosen integration uses our managed ClamAV scanner with a Blob Intake key; no Transloadit account is required. The Provider interface remains an extension point with submit, poll and verifyCallback. The app owns users, membership, upload metadata and file access.

## Local runnable example
Use Node 24.14+ and the MIT repository at https://github.com/GabrielSchmalz/blob-intake. Clone and install:

\`\`\`sh
git clone https://github.com/GabrielSchmalz/blob-intake.git
cd blob-intake
npm ci --include=dev
\`\`\`

Save the following as example.ts in the repository root and run npx tsx example.ts. It prints approved and the fixture byte count. This demonstrates the actual acceptance API using a synthetic provider and in-memory SQLite; it does not scan malware or call a cloud service.

\`\`\`ts
${localExample}
\`\`\`

## Managed-scanner architecture
The reusable integration targets your Next.js backend, your private Vercel Blob store and a server-only Blob Intake key. The current /pilot UI uses our dedicated private Blob store; it is not evidence of a customer-store integration. The Blob read/write token stays inside your application backend. The managed provider adapter will submit an exact-path, short-lived signed Blob URL and content digest to our scanner. Never send your Blob store token. The reusable customer-store flow remains subject to live verification. Shared PostgreSQL metadata binds the result to a tenant, immutable bytes and a scan attempt. An approved result still requires authorization and a matching content check before delivery. Pilot keys are provisioned by an operator. Automated signup, customer billing and a published npm package are not available yet. Scanner coverage, availability and live verification must be checked in the deployment evidence; this guide is not proof of a completed scan.

## Production workflow
Use createPostgresIntake from src/production/acceptance with a shared pg Pool, authorized Storage, Provider and Clock. The factory initializes its schema by default. To apply it separately, use initializePostgres({pool,schema}) from src/persistence/postgres.ts. SQLite is local-only and must not be used for shared serverless state. Keep database, storage and scanner secrets in server-only environment configuration. No browser receives database credentials, Blob read tokens or scanner secrets.

\`\`\`ts
${productionExample}
\`\`\`

## Integrating private Vercel Blob
createPrivateBlobIntegration in src/integrations/vercel-blob requires token, resolve(context,fileId), resolveSource(tenantId,fileId), and now. The resolvers must return an exact immutable private pathname and expected SHA256 digest using server-owned metadata. The authenticated resolver independently checks membership and file ownership on each read. Its storage member implements Storage; source creates a short-lived, exact-path signed source for a compatible remote provider. A scanner can instead consume the already-read Submission.bytes without any signed URL. Never overwrite a pathname to reuse approval or trust upload JSON to establish a tenant.

## Managed scanner HTTP contract
The remote MVP is polling-only. POST /api/scans authenticates with Authorization: Bearer <Blob Intake key> and accepts attemptId, fileId, digest, declaredType and source:{url,validUntil}. The tenant comes from the server-owned key context. GET /api/scans?attemptId=... returns {event:ProviderEvent|null}. Both calls use your Blob Intake key, never your Blob store token. The source URL must be an exact-path private Vercel Blob signed URL with at least 60 seconds remaining and a bounded lifetime of at most 15 minutes. Persist only necessary encrypted source capabilities inside the scanner boundary; never log them. Drive intake.reconcileFor(context) from an authenticated user route to consume remote results scoped to that tenant and owner. Global intake.reconcile() belongs only in a trusted operator job or authenticated cron boundary. This adapter does not expose an external callback workflow.

## Provider interface
submit receives attemptId, tenantId, fileId, SHA256 digest, bytes and declaredType and returns a provider receipt. poll(attemptId) returns a ProviderEvent or null. verifyCallback validates the exact raw callback body and signature before returning a ProviderEvent. Each event binds eventId, attemptId, digest, outcome (clean, threat, failed or unknown) and reason. Unknown checks never grant access. A clean result requires actual successful configured checks. Do not implement a provider that always reports clean.

## HTTP integration
Authenticate before register, submit, status, retry or deliver. Resolve a server-owned fileId and context. For a callback-capable provider, pass untouched callback body/signature to callback through verified ingress. The managed scanner MVP uses polling instead. Invoke reconcileFor(context) from an authenticated user route to recover missed results for that tenant and owner. Reserve global reconcile() for a trusted operator job or authenticated scheduler. Retry outages after checking state; rejected or conflicted content requires explicit remediation rather than bypass. Return bytes only through deliver and set private/no-store and nosniff headers.

## Pilot operating limits
The worker checks an idle queue every 600 seconds to permit free Neon autosuspend. Processing can start up to 10 minutes after submission; an active backlog is processed more frequently. No scan-throughput guarantee is offered. The signature database refreshes 12 times a day, and a database older than 72 hours is refused rather than accepted silently.

## Limits and launch boundaries
PDF, PNG and JPEG; 20 MiB maximum. Content signatures are a format gate, not a full parser or malware detector. Rehashing binds decisions to bytes, declared type and policy version. Authentication, business approval, tenant policy, encryption/residency choices, quotas and customer billing remain application-owned. Provider execution can repeat around a crash; do not assume exactly-once billable processing. Retention and scanner coverage depend on the chosen provider. Tests and simulations do not prove production security. There are no validated customer-demand or organic AI recommendation claims.

## Useful links
- https://github.com/GabrielSchmalz/blob-intake: MIT source and runnable example
- /docs: integration guide
- /pilot: deployment pilot
- /local: local fixture UI; mutation APIs reject non-loopback requests
- /llms.txt: agent-oriented discovery index
`;
