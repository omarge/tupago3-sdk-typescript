import * as grpc from "@grpc/grpc-js";
import { TupagoException } from "./TupagoException.js";

/** Absent result (backend -> NOT_FOUND). Never auto-retried. */
export class TupagoNotFoundException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `NOT_FOUND: ${description}`, retryable: false, pendingReconciliation: false, cause });
  }
}

/** Invalid argument (backend -> INVALID_ARGUMENT). Never auto-retried. */
export class TupagoInvalidArgumentException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `INVALID_ARGUMENT: ${description}`, retryable: false, pendingReconciliation: false, cause });
  }
}

/** Permission denied (backend -> PERMISSION_DENIED). Never auto-retried. */
export class TupagoPermissionDeniedException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `PERMISSION_DENIED: ${description}`, retryable: false, pendingReconciliation: false, cause });
  }
}

/** Missing/invalid credentials (backend -> UNAUTHENTICATED). Never auto-retried. */
export class TupagoUnauthenticatedException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `UNAUTHENTICATED: ${description}`, retryable: false, pendingReconciliation: false, cause });
  }
}

/** Resource already exists (backend -> ALREADY_EXISTS). Never auto-retried. */
export class TupagoAlreadyExistsException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `ALREADY_EXISTS: ${description}`, retryable: false, pendingReconciliation: false, cause });
  }
}

/** Failed precondition (backend -> FAILED_PRECONDITION). Never auto-retried. */
export class TupagoFailedPreconditionException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `FAILED_PRECONDITION: ${description}`, retryable: false, pendingReconciliation: false, cause });
  }
}

/** Server-side internal error (backend -> INTERNAL). Never auto-retried. */
export class TupagoInternalException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `INTERNAL: ${description}`, retryable: false, pendingReconciliation: false, cause });
  }
}
