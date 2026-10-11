import * as grpc from "@grpc/grpc-js";
import { TupagoException } from "./TupagoException.js";

/**
 * Unknown financial outcome for a CREATE operation. A transient transport error
 * (UNAVAILABLE / DEADLINE_EXCEEDED) observed on CreateQr / CreateTelefonico means the server
 * may or may not have persisted the payment — the result is UNKNOWN. Because blind resubmission
 * is financially dangerous, this is deliberately NON-retryable (gate G4) and signals the caller
 * to (a) re-invoke with the SAME idempotency_key so the server dedupes, or (b) call Get*Status.
 */
export class TupagoUnknownOutcomeException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({
      code,
      description,
      message:
        `UNKNOWN_OUTCOME: ${grpc.status[code]}: ${description} — do not blind-resubmit; ` +
        `reuse the same idempotency_key or query status`,
      retryable: false,
      pendingReconciliation: false,
      cause,
    });
  }
}
