/**
 * Shared HTTP-ish plumbing for the REST and GraphQL transports (both use the platform
 * `fetch`). Encapsulates: bearer auth, deadline/abort handling, network-failure
 * classification (the financial-safety critical path), HTTP status -> SDK exception mapping,
 * and fail-closed JSON validation. NO business logic lives here.
 */
import * as grpc from "@grpc/grpc-js";
import {
  TupagoException,
  TupagoUnauthenticatedException,
  TupagoPermissionDeniedException,
  TupagoNotFoundException,
  TupagoInvalidArgumentException,
  TupagoAlreadyExistsException,
  TupagoFailedPreconditionException,
  TupagoInternalException,
  TupagoTransientException,
  TupagoAbortedException,
  TupagoUnknownOutcomeException,
  PENDING_RECONCILIATION_CODE,
} from "../error/index.js";
import type { CallOptions } from "../client/types.js";
import type { CredentialProvider } from "../auth/index.js";

/** Thrown internally for fetch-level failures (DNS, TCP, TLS, timeout, abort). */
export class NetworkError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export interface RawHttp {
  status: number;
  statusText: string;
  headers: Headers;
  text: string;
}

/** Resolve the bearer token once; fail-closed if the provider returns nothing. */
export function bearerHeader(credentials: CredentialProvider): Record<string, string> {
  const token = credentials.token();
  if (token == null || token.trim() === "") {
    throw new TupagoUnauthenticatedException(
      grpc.status.UNAUTHENTICATED,
      "No bearer token supplied by CredentialProvider",
    );
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * Combine the caller's AbortSignal with the per-call deadline. Returns the signal to pass to
 * fetch and a release() to clear the timeout. Honors a caller abort and a deadline timeout.
 */
export function resolveSignal(opts: CallOptions | undefined, deadlineMillis: number): {
  signal: AbortSignal;
  release: () => void;
} {
  const deadline = opts?.deadlineMillis && opts.deadlineMillis > 0 ? opts.deadlineMillis : deadlineMillis;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline exceeded", "TimeoutError")), deadline);
  const onCallerAbort = () => controller.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason);
    else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const release = () => {
    clearTimeout(timer);
    if (opts?.signal) opts.signal.removeEventListener("abort", onCallerAbort);
  };
  return { signal: controller.signal, release };
}

/** Perform a fetch with auth + deadline/abort. Throws {@link NetworkError} on any transport failure. */
export async function rawFetch(
  url: string,
  init: Omit<RequestInit, "url">,
  opts: CallOptions | undefined,
  deadlineMillis: number,
): Promise<RawHttp> {
  const { signal, release } = resolveSignal(opts, deadlineMillis);
  try {
    const res = await fetch(url, { ...init, signal, redirect: "manual" });
    const text = await res.text();
    return { status: res.status, statusText: res.statusText, headers: res.headers, text };
  } catch (e) {
    release();
    if (e instanceof NetworkError) throw e;
    // fetch throws TypeError on network failure; DOMException on abort/timeout.
    throw new NetworkError(`transport failure: ${(e as Error).message}`, e);
  } finally {
    release();
  }
}

/**
 * Map a definitive (non-network) HTTP status to a SDK exception, preserving the backend's
 * RFC-7807 problem+json envelope when present.
 */
export function mapHttpStatusError(status: number, text: string): TupagoException {
  let problem: any = undefined;
  try {
    if (text) problem = JSON.parse(text);
  } catch {
    /* not JSON; use status only */
  }
  const detail: string =
    (problem && (problem.detail || problem.message || problem.title)) || text || `HTTP ${status}`;

  switch (status) {
    case 401:
      return new TupagoUnauthenticatedException(grpc.status.UNAUTHENTICATED, detail);
    case 403:
      return new TupagoPermissionDeniedException(grpc.status.PERMISSION_DENIED, detail);
    case 404:
      return new TupagoNotFoundException(grpc.status.NOT_FOUND, detail);
    case 400:
      return new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, detail, problem);
    case 409: {
      const type = (problem && (problem.type || problem.title)) || "";
      if (type.includes("IDEMPOTENCY") || type.includes("idempotency")) {
        return new TupagoAlreadyExistsException(grpc.status.ALREADY_EXISTS, detail);
      }
      if (type.includes("POLICY") || type.includes("policy")) {
        return new TupagoFailedPreconditionException(grpc.status.FAILED_PRECONDITION, detail);
      }
      return new TupagoAlreadyExistsException(grpc.status.ALREADY_EXISTS, detail);
    }
    case 202:
      // PaymentPendingReconciliationException: accepted-but-unknown. Surface as ABORTED +
      // PENDING_RECONCILIATION so the caller queries status instead of resubmitting.
      return new TupagoAbortedException(
        grpc.status.ABORTED,
        `${PENDING_RECONCILIATION_CODE}: ${detail}`,
      );
    default:
      if (status >= 500) {
        return new TupagoInternalException(grpc.status.INTERNAL, detail);
      }
      return new TupagoException({
        code: grpc.status.UNKNOWN,
        description: detail,
        message: `UNKNOWN: HTTP ${status}: ${detail}`,
        retryable: false,
        pendingReconciliation: false,
        cause: problem,
      });
  }
}

/**
 * Classify a transport failure. For CREATE operations an ambiguous outcome must NEVER be
 * retried blindly: it becomes a non-retryable UNKNOWN OUTCOME. For READ operations a
 * transient failure is retryable per the configured policy.
 */
export function networkToException(err: unknown, isCreate: boolean): TupagoException {
  if (isCreate) {
    return new TupagoUnknownOutcomeException(
      grpc.status.UNKNOWN,
      `ambiguous transport result: ${(err as Error)?.message ?? err} — do not blind-resubmit; reuse the same idempotency_key or query status`,
      err,
    );
  }
  return new TupagoTransientException(grpc.status.UNAVAILABLE, `transient transport failure: ${(err as Error)?.message ?? err}`, err);
}

/** Parse a success-body JSON fail-closed: invalid JSON on a success path is a client-side defect. */
export function parseJsonOrFail(text: string, ctx: string): any {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new TupagoInvalidArgumentException(
      grpc.status.INVALID_ARGUMENT,
      `malformed JSON success body in ${ctx}: ${(e as Error).message}`,
    );
  }
}

/** Fail-closed shape assertion: a success payload must be a non-null object/array. */
export function requireValue(value: unknown, ctx: string): void {
  if (value === null || value === undefined) {
    throw new TupagoInvalidArgumentException(
      grpc.status.INVALID_ARGUMENT,
      `unexpected empty success payload in ${ctx}`,
    );
  }
}
