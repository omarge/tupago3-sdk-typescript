import * as grpc from "@grpc/grpc-js";

/**
 * Stable code embedded by the backend in the ABORTED status description (gate G6).
 * Must be preserved verbatim so the caller can machine-detect a pending-reconciliation state.
 */
export const PENDING_RECONCILIATION_CODE = "TUPAGO_PENDING_RECONCILIATION";

/** Transient transport codes that may be retried for READ operations only. */
export const TRANSIENT_GRPC_CODES = new Set<grpc.status>([
  grpc.status.UNAVAILABLE,
  grpc.status.DEADLINE_EXCEEDED,
]);

export function isTransientCode(code: grpc.status): boolean {
  return TRANSIENT_GRPC_CODES.has(code);
}

/**
 * Base exception for all TUPAGO3 SDK failures. Wraps the originating gRPC status so the
 * backend's frozen error matrix is preserved verbatim (description + code carried through).
 */
export class TupagoException extends Error {
  readonly code: grpc.status;
  readonly codeName: string;
  readonly description: string;
  readonly retryable: boolean;
  readonly pendingReconciliation: boolean;
  override cause?: unknown;

  constructor(opts: {
    code: grpc.status;
    description: string;
    message: string;
    retryable: boolean;
    pendingReconciliation: boolean;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = new.target.name;
    this.code = opts.code;
    this.codeName = grpc.status[opts.code] ?? String(opts.code);
    this.description = opts.description;
    this.retryable = opts.retryable;
    this.pendingReconciliation = opts.pendingReconciliation;
    this.cause = opts.cause;
  }

  /** Whether the SDK is permitted to retry the operation that produced this error. */
  isRetryable(): boolean {
    return this.retryable;
  }

  /**
   * True only for the non-transient TUPAGO_PENDING_RECONCILIATION (ABORTED) condition.
   * When set, the caller MUST query status instead of resubmitting (gate G6).
   */
  isPendingReconciliation(): boolean {
    return this.pendingReconciliation;
  }
}
