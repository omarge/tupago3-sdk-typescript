import * as grpc from "@grpc/grpc-js";
import { PENDING_RECONCILIATION_CODE, TupagoException, isTransientCode } from "./TupagoException.js";
import { TupagoNotFoundException } from "./TupagoStandardExceptions.js";
import { TupagoInvalidArgumentException } from "./TupagoStandardExceptions.js";
import { TupagoPermissionDeniedException } from "./TupagoStandardExceptions.js";
import { TupagoUnauthenticatedException } from "./TupagoStandardExceptions.js";
import { TupagoAlreadyExistsException } from "./TupagoStandardExceptions.js";
import { TupagoFailedPreconditionException } from "./TupagoStandardExceptions.js";
import { TupagoInternalException } from "./TupagoStandardExceptions.js";
import { TupagoTransientException } from "./TupagoTransientException.js";
import { TupagoAbortedException } from "./TupagoAbortedException.js";

/**
 * Maps a gRPC error (ServiceError or generic Error) to the SDK exception hierarchy, preserving
 * the backend's frozen error matrix (section 2/8). The original status code and description are
 * carried verbatim so TUPAGO_PENDING_RECONCILIATION stays machine-detectable.
 *
 * The seven preserved gRPC states surfaced to callers:
 *   UNAUTHENTICATED, PERMISSION_DENIED, INVALID_ARGUMENT, ALREADY_EXISTS,
 *   FAILED_PRECONDITION, NOT_FOUND, ABORTED (pending reconciliation).
 * Plus transient UNAVAILABLE / DEADLINE_EXCEEDED (read-retryable) and INTERNAL.
 */
export class StatusMapper {
  private constructor() {}

  static map(err: unknown): TupagoException {
    if (err instanceof TupagoException) {
      return err;
    }

    const serviceError = err as Partial<grpc.ServiceError> | null;
    const code: grpc.status =
      typeof serviceError?.code === "number" ? (serviceError.code as grpc.status) : grpc.status.UNKNOWN;
    const description = extractDescription(serviceError);

    if (description.includes(PENDING_RECONCILIATION_CODE)) {
      // ABORTED + pending-reconciliation marker takes precedence over the bare code.
      return new TupagoAbortedException(grpc.status.ABORTED, description, err);
    }

    switch (code) {
      case grpc.status.UNAUTHENTICATED:
        return new TupagoUnauthenticatedException(code, description, err);
      case grpc.status.PERMISSION_DENIED:
        return new TupagoPermissionDeniedException(code, description, err);
      case grpc.status.INVALID_ARGUMENT:
        return new TupagoInvalidArgumentException(code, description, err);
      case grpc.status.ALREADY_EXISTS:
        return new TupagoAlreadyExistsException(code, description, err);
      case grpc.status.FAILED_PRECONDITION:
        return new TupagoFailedPreconditionException(code, description, err);
      case grpc.status.NOT_FOUND:
        return new TupagoNotFoundException(code, description, err);
      case grpc.status.ABORTED:
        return new TupagoAbortedException(code, description, err);
      case grpc.status.UNAVAILABLE:
      case grpc.status.DEADLINE_EXCEEDED:
        return new TupagoTransientException(code, description, err);
      case grpc.status.INTERNAL:
        return new TupagoInternalException(code, description, err);
      default:
        return new TupagoException({
          code,
          description,
          message: `${grpc.status[code] ?? code}: ${description}`,
          retryable: isTransientCode(code),
          pendingReconciliation: false,
          cause: err,
        });
    }
  }
}

function extractDescription(err: Partial<grpc.ServiceError> | null): string {
  if (!err) return "";
  if (typeof err.details === "string" && err.details.length > 0) {
    return err.details;
  }
  if (typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  return "";
}
