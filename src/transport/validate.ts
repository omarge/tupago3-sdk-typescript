/**
 * Minimal, fail-closed runtime guards for the structured (non-opaque) REST/GraphQL responses.
 *
 * ts-proto's fromJSON silently defaults absent proto3 fields (int64 -> 0n, string -> ""). For the
 * contract-mandatory fields below that is unsafe: a structurally invalid but HTTP-200 payload could
 * become a defaulted ClientePerfil/CatalogoInstitucion. These guards convert such cases into
 * TupagoInvalidArgumentException (fail-closed) so callers never observe silently-defaulted core data.
 *
 * Mandatory fields are derived from the backend entities (backend3 @ bbf06c02):
 *   Cliente:            id (@Id), nombre (@NotNull), claveInstitucion (@NotNull)
 *   CatalogoInstitucion:id (@Id), claveInstitucion,       nombreCorto (@NotNull)
 * Banxico/raw JSON (status + create responses) is intentionally NOT validated here — it is opaque
 * and remains a JsonResponseView.
 */
import * as grpc from "@grpc/grpc-js";
import { TupagoInvalidArgumentException } from "../error/index.js";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * A structured-response id is safe iff it is a non-zero integer. JSON numbers arrive as `number`,
 * while ts-proto-derived (gRPC/GraphQL) ids arrive as `bigint`; both must be accepted so a valid
 * id is never mistaken for a defaulted (0) value.
 */
function isNonZeroId(v: unknown): boolean {
  if (typeof v === "bigint") return v !== 0n;
  if (typeof v === "number") return Number.isInteger(v) && v !== 0;
  return false;
}

export function requireNonDefaultCliente(c: unknown, ctx: string): void {
  if (!c || typeof c !== "object") {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: cliente missing`);
  }
  const cliente = c as Record<string, unknown>;
  if (!isNonZeroId(cliente.id)) {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: cliente.id missing or defaulted to 0`);
  }
  if (!isNonEmptyString(cliente.nombre)) {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: cliente.nombre missing`);
  }
  if (!isNonEmptyString(cliente.claveInstitucion)) {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: cliente.claveInstitucion missing`);
  }
}

export function requireNonDefaultCatalogo(c: unknown, ctx: string): void {
  if (!c || typeof c !== "object") {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: catalogoInstitucion missing`);
  }
  const cat = c as Record<string, unknown>;
  if (!isNonZeroId(cat.id)) {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: catalogoInstitucion.id missing or defaulted to 0`);
  }
  if (!isNonEmptyString(cat.claveInstitucion)) {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: catalogoInstitucion.claveInstitucion missing`);
  }
  if (!isNonEmptyString(cat.nombreCorto)) {
    throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, `${ctx}: catalogoInstitucion.nombreCorto missing`);
  }
}
