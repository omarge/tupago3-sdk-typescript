/**
 * Public, stable, typed request shapes for the financial create operations.
 *
 * int64 fields (idCuenta) are exposed as `bigint` to avoid unsafe JavaScript number coercion
 * (see SDK contract section 4). The wire protobuf encodes them as 64-bit integers; ts-proto
 * was generated with `forceLong=bigint` so decode/encode is lossless.
 *
 * `monto` is a `number` because the wire contract is `double` (payment.proto). Doubles cannot
 * represent all decimal fractions exactly. Callers MUST treat `monto` as a minor-unit-safe value
 * (e.g. integer centavos) or an already-rounded decimal, and validate it before sending. The SDK
 * validates finiteness and rejects `NaN`/`Infinity`; it does NOT silently round. See README
 * "Monetary precision" for the conversion matrix and limits.
 */
export interface CreateQrParams {
  idCuenta: bigint;
  monto: number;
  concepto: string;
  referenciaNumerica: number;
  nombreCliente: string;
  email: string;
  tipoPago: number;
  vigencia: number;
  /** Stable idempotency key. Preserved verbatim on the wire and by the SDK (gate G9). */
  idempotencyKey: string;
}

export interface CreateTelefonicoParams {
  key: string;
  monto: number;
  concepto: string;
  referenciaNumerica: number;
  numeroCelular: string;
  vigencia: number;
  /** Stable idempotency key. Preserved verbatim on the wire and by the SDK (gate G9). */
  idempotencyKey: string;
}

export interface CallOptions {
  /** AbortSignal to cancel an in-flight RPC (gate G10). */
  signal?: AbortSignal;
  /** Per-call deadline override in milliseconds (defaults to client deadlineMillis). */
  deadlineMillis?: number;
}
