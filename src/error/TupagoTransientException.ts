import * as grpc from "@grpc/grpc-js";
import { TupagoException } from "./TupagoException.js";

/** Transient transport condition (UNAVAILABLE / DEADLINE_EXCEEDED). Retryable for reads only. */
export class TupagoTransientException extends TupagoException {
  constructor(code: grpc.status, description: string, cause?: unknown) {
    super({ code, description, message: `${grpc.status[code]}: ${description}`, retryable: true, pendingReconciliation: false, cause });
  }
}
