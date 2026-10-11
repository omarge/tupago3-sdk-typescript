import { TupagoException } from "../error/TupagoException.js";
import { RetryPolicy } from "./RetryPolicy.js";

/**
 * Never retries. Used for the financial create operations (CreateQr / CreateTelefonico) so the
 * SDK can never resubmit a payment automatically (gate G4). The caller is responsible for
 * deciding what to do next (e.g. query status with the same idempotency key).
 */
export class NoRetryPolicy implements RetryPolicy {
  static readonly INSTANCE = new NoRetryPolicy();

  shouldRetry(_attempt: number, _error: TupagoException): boolean {
    return false;
  }

  delayMillis(_attempt: number): number {
    return 0;
  }
}
