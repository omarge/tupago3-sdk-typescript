import { TupagoException } from "../error/TupagoException.js";

/**
 * Decides whether (and how) an operation that failed with a {@link TupagoException} may be
 * retried. This is the single seam that enforces gate G4 (no automatic retry for CreateQr /
 * CreateTelefonico) and gate G6 (TUPAGO_PENDING_RECONCILIATION never retried).
 */
export interface RetryPolicy {
  /**
   * @param attempt zero-based attempt index of the failure just observed
   * @param error   the error thrown by the failed attempt
   * @return true if another attempt should be made
   */
  shouldRetry(attempt: number, error: TupagoException): boolean;

  /** Computes the backoff delay (ms) to wait before the given (zero-based) attempt. */
  delayMillis(attempt: number): number;
}
