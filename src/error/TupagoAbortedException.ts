import * as grpc from "@grpc/grpc-js";
import { TupagoException } from "./TupagoException.js";

/**
 * Non-transient unknown-remote-state (backend -> ABORTED, carries
 * TUPAGO_PENDING_RECONCILIATION). The caller MUST query status, never resubmit (gate G6).
 */
export class TupagoAbortedException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `ABORTED: ${description}`, retryable: false, pendingReconciliation: true, cause });
  }
}
