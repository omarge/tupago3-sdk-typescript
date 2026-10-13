/**
 * Transport-neutral contract for the six TUPAGO3 payment operations.
 *
 * Every transport (gRPC / REST / GraphQL) implements this interface and returns the SAME
 * core domain types (ClientePerfil, CatalogoInstitucion, JsonResponseView). This is the
 * semantic authority: a transport only adapts the wire format to/from these types and must
 * enforce the financial-safety laws (bearer auth, caller-owned idempotency key, no blind
 * retry on creates, PendingReconciliation, fail-closed on malformed responses).
 */
import type { CredentialProvider } from "../auth/index.js";
import type { ClientePerfil, CatalogoInstitucion, JsonResponse } from "../generated/tupago/api/v1/payment.js";
import { JsonResponseView } from "../client/JsonResponseView.js";
import type { CreateQrParams, CreateTelefonicoParams, CallOptions } from "../client/types.js";
import type { RetryPolicy } from "../retry/index.js";

export interface TransportDeps {
  /** gRPC: host:port. REST: base URL e.g. http://127.0.0.1:8092. GraphQL: /graphql endpoint. */
  target: string;
  credentials: CredentialProvider;
  deadlineMillis?: number;
  readRetryPolicy?: RetryPolicy;
}

export interface PaymentTransport {
  getCliente(id: bigint, opts?: CallOptions): Promise<ClientePerfil>;
  getCatalogo(claveInstitucion: string, opts?: CallOptions): Promise<CatalogoInstitucion>;
  getQrStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView>;
  getTelefonicoStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView>;
  createQr(req: CreateQrParams, opts?: CallOptions): Promise<JsonResponseView>;
  createTelefonico(req: CreateTelefonicoParams, opts?: CallOptions): Promise<JsonResponseView>;
  close(): void;
}

/** Build a JsonResponseView from a raw JSON value (object/array/string). */
export function jsonResponseViewFromValue(value: unknown): JsonResponseView {
  const raw: JsonResponse = { json: JSON.stringify(value === undefined ? null : value) };
  return new JsonResponseView(raw);
}
