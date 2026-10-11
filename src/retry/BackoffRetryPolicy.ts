import { randomInt } from "node:crypto";
import { TupagoException } from "../error/TupagoException.js";
import { RetryPolicy } from "./RetryPolicy.js";

/**
 * Capped exponential backoff with jitter, retrying ONLY genuinely transient transport errors
 * (UNAVAILABLE / DEADLINE_EXCEEDED, i.e. TupagoException.isRetryable() === true).
 * Used for idempotent read operations. It never retries create operations (callers must pass
 * {@link NoRetryPolicy} there) and never retries TUPAGO_PENDING_RECONCILIATION.
 */
export class BackoffRetryPolicy implements RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMillis: number;
  private readonly maxDelayMillis: number;

  constructor(maxAttempts: number, baseDelayMillis: number, maxDelayMillis: number) {
    if (maxAttempts < 1) {
      throw new Error("maxAttempts must be >= 1");
    }
    this.maxAttempts = maxAttempts;
    this.baseDelayMillis = Math.max(1, baseDelayMillis);
    this.maxDelayMillis = Math.max(baseDelayMillis, maxDelayMillis);
  }

  static of(maxAttempts: number): BackoffRetryPolicy {
    return new BackoffRetryPolicy(maxAttempts, 200, 2000);
  }

  shouldRetry(attempt: number, error: TupagoException): boolean {
    if (attempt >= this.maxAttempts - 1) {
      return false;
    }
    // Only retry if the error is explicitly marked retryable (transient transport).
    // TUPAGO_PENDING_RECONCILIATION / ALREADY_EXISTS / others are never retried.
    return error.isRetryable();
  }

  delayMillis(attempt: number): number {
    const exp = this.baseDelayMillis * Math.pow(2, attempt);
    const capped = Math.min(exp, this.maxDelayMillis);
    const jitter = randomInt(0, Math.max(1, Math.floor(capped / 2)));
    return capped + jitter;
  }
}
