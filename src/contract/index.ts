import { Data, Effect } from "effect";

/** Established by the application's authenticated backend, never upload JSON. */
export interface AuthContext { readonly tenantId: string; readonly userId: string }
export type State = "pending" | "processing" | "approved" | "rejected" | "failed";
export type Reason = "type" | "size" | "mismatch" | "threat" | "outage" | "expired" | "unknown" | "conflict" | "changed";
export class IntakeError extends Data.TaggedError("IntakeError")<{
  readonly code: "denied" | "not_found" | "inaccessible" | "invalid_callback" | "storage" | "provider" | "persistence";
}> {}
export interface StoredFile { readonly bytes: Uint8Array; readonly declaredType: string }
export interface Storage {
  readonly read: (context: AuthContext, fileId: string) => Effect.Effect<StoredFile, IntakeError>;
}
export interface Submission {
  readonly attemptId: string;
  readonly tenantId: string;
  readonly fileId: string;
  readonly digest: string;
  readonly bytes: Uint8Array;
  readonly declaredType: string;
}
export interface ProviderEvent {
  readonly eventId: string;
  readonly attemptId: string;
  readonly digest: string;
  readonly outcome: "clean" | "threat" | "failed" | "unknown";
  readonly reason: Reason | null;
}
export interface RawCallback { readonly body: string; readonly signature: string }
export interface Provider {
  /** Stable attemptId is the recovery key; a real provider may not deduplicate execution. */
  readonly submit: (request: Submission) => Effect.Effect<string, IntakeError>;
  readonly poll: (attemptId: string) => Effect.Effect<ProviderEvent | null, IntakeError>;
  readonly verifyCallback: (callback: RawCallback) => Effect.Effect<ProviderEvent, IntakeError>;
}
export interface Clock { readonly now: () => number }
export interface Dependencies {
  readonly databasePath: string;
  readonly storage: Storage;
  readonly provider: Provider;
  readonly clock: Clock;
}
export interface JobStatus {
  readonly jobId: string;
  readonly tenantId: string;
  readonly fileId: string;
  readonly digest: string;
  readonly declaredType: string;
  readonly policyVersion: string;
  readonly state: State;
  readonly reason: Reason | null;
  readonly attemptId: string | null;
  readonly providerId: string | null;
  readonly updatedAt: number;
}
export interface CallbackReceipt { readonly eventId: string; readonly applied: boolean }
export interface AcceptanceApp {
  readonly register: (context: AuthContext, fileId: string) => Effect.Effect<JobStatus, IntakeError>;
  readonly submit: (context: AuthContext, jobId: string) => Effect.Effect<JobStatus, IntakeError>;
  readonly status: (context: AuthContext, jobId: string) => Effect.Effect<JobStatus, IntakeError>;
  readonly callback: (raw: RawCallback) => Effect.Effect<CallbackReceipt, IntakeError>;
  readonly reconcile: () => Effect.Effect<number, IntakeError>;
  readonly retry: (context: AuthContext, jobId: string) => Effect.Effect<JobStatus, IntakeError>;
  readonly deliver: (context: AuthContext, fileId: string) => Effect.Effect<Uint8Array, IntakeError>;
  readonly close: () => Effect.Effect<void, IntakeError>;
}
export type AppFactory = (dependencies: Dependencies) => Effect.Effect<AcceptanceApp, IntakeError>;
export const MAX_BYTES = 20 * 1024 * 1024;
export const POLICY_VERSION = "pdf-images-v1";
