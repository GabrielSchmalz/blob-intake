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
import { createPostgresIntake } from "./src/production/acceptance";

// pool, storage and provider are server-owned services.
// The factory initializes its schema unless initialize: false.
const intake = await Effect.runPromise(createPostgresIntake({
  pool, schema: "blob_intake", storage, provider,
  clock: { now: () => Date.now() },
}));

// Derive context from your authenticated session and membership.
const job = await Effect.runPromise(intake.register(context, fileId));
await Effect.runPromise(intake.submit(context, job.jobId));
// A later request can use the same shared database state.
const status = await Effect.runPromise(intake.status(context, job.jobId));
// Still performs authorization and immutable-content checks.
const bytes = await Effect.runPromise(intake.deliver(context, fileId));`;
export const guideMarkdown = `# Blob Intake

Provider-agnostic acceptance and recovery for private Vercel Blob files in Next.js applications. Early MIT source integration, not a published npm package or security certification.

## When to use it
Use this when an authenticated app accepts private PDF, PNG or JPEG uploads and must prevent download until checks finish. Blob Intake packages content-bound acceptance state, verified callback handling, missed-callback polling and fail-closed delivery. Transloadit is optional; a Provider implementation supplies submit, poll and verifyCallback. The app owns users, membership, upload metadata and file access.

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

## Production workflow
Use createPostgresIntake from src/production/acceptance with a shared pg Pool, authorized Storage, Provider and Clock. The factory initializes its schema by default. To apply it separately, use initializePostgres({pool,schema}) from src/persistence/postgres.ts. SQLite is local-only and must not be used for shared serverless state. Keep database, storage and scanner secrets in server-only environment configuration. No browser receives database credentials, Blob read tokens or scanner secrets.

\`\`\`ts
${productionExample}
\`\`\`

## Integrating private Vercel Blob
createPrivateBlobIntegration in src/integrations/vercel-blob requires token, resolve(context,fileId), resolveSource(tenantId,fileId), and now. The resolvers must return an exact immutable private pathname and expected SHA256 digest using server-owned metadata. The authenticated resolver independently checks membership and file ownership on each read. Its storage member implements Storage; source creates a short-lived, exact-path signed source for a compatible remote provider. A scanner can instead consume the already-read Submission.bytes without any signed URL. Never overwrite a pathname to reuse approval or trust upload JSON to establish a tenant.

## Provider interface
submit receives attemptId, tenantId, fileId, SHA256 digest, bytes and declaredType and returns a provider receipt. poll(attemptId) returns a ProviderEvent or null. verifyCallback validates the exact raw callback body and signature before returning a ProviderEvent. Each event binds eventId, attemptId, digest, outcome (clean, threat, failed or unknown) and reason. Unknown checks never grant access. A clean result requires actual successful configured checks. Do not implement a provider that always reports clean.

## HTTP integration
Authenticate before register, submit, status, retry or deliver. Resolve a server-owned fileId and context. Pass untouched callback body/signature to callback through a provider-specific verified ingress. Invoke reconcile from an authenticated maintenance path or bounded scheduler to recover missed results. Retry outages after checking state; rejected or conflicted content requires explicit remediation rather than bypass. Return bytes only through deliver and set private/no-store and nosniff headers.

## Limits and launch boundaries
PDF, PNG and JPEG; 20 MiB maximum. Content signatures are a format gate, not a full parser or malware detector. Rehashing binds decisions to bytes, declared type and policy version. Authentication, business approval, tenant policy, encryption/residency choices, quotas and customer billing remain application-owned. Provider execution can repeat around a crash; do not assume exactly-once billable processing. Retention and scanner coverage depend on the chosen provider. Tests and simulations do not prove production security. There are no validated customer-demand or organic AI recommendation claims.

## Useful links
- https://github.com/GabrielSchmalz/blob-intake: MIT source and runnable example
- /docs: integration guide
- /pilot: deployment pilot
- /local: local fixture UI; mutation APIs reject non-loopback requests
- /llms.txt: agent-oriented discovery index
`;
