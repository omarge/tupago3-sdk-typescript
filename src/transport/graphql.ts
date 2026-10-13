/**
 * GraphQL / JSON transport for the six TUPAGO3 payment operations.
 *
 * Wire authority: backend3 @ bbf06c02 (Spring GraphQL @ /graphql). All responses are mapped to
 * the SAME core domain types as the gRPC and REST transports. Financial-safety laws are enforced
 * identically: bearer auth, caller-owned idempotency key (passed as a GraphQL argument, NOT an
 * HTTP header), NO blind retry on creates (transient/network -> UNKNOWN OUTCOME), PENDING_RECONCILIATION
 * (HTTP 202 or a GraphQL error with extensions.code === "PAYMENT_PENDING_RECONCILIATION"), and
 * fail-closed runtime validation.
 *
 * GraphQL operation -> backend field mapping (from live introspection):
 *   C5 getCliente            -> Query.cliente(id: ID!)                -> { cliente, catalogoInstitucion }
 *   C6 getCatalogo           -> Query.catalogoInstitucion(claveInstitucion: String!)
 *   C3 getQrStatus           -> Query.pagoQrEstatusByCuenta(idc: String!, idCuenta: ID!)   (JSON leaf)
 *   C4 getTelefonicoStatus   -> Query.pagoTelefonicoEstatusByCuenta(idc: String!, idCuenta: ID!) (JSON leaf)
 *   C1 createQr              -> Mutation.createPagoQr(input: PagoQrInput!, idempotencyKey: String) (JSON leaf)
 *   C2 createTelefonico      -> Mutation.createPagoTelefonico(input: PagoTelefonicoInput!, idempotencyKey: String)
 */
import * as grpc from "@grpc/grpc-js";

import type { CredentialProvider } from "../auth/index.js";
import {
  PENDING_RECONCILIATION_CODE,
  TupagoException,
  TupagoUnauthenticatedException,
  TupagoNotFoundException,
  TupagoInvalidArgumentException,
  TupagoInternalException,
  TupagoAbortedException,
  TupagoUnknownOutcomeException,
} from "../error/index.js";
import { BackoffRetryPolicy, RetryPolicy } from "../retry/index.js";
import { CreateQrParams, CreateTelefonicoParams, CallOptions } from "../client/types.js";
import { JsonResponseView } from "../client/JsonResponseView.js";
import { ClientePerfil, CatalogoInstitucion } from "../generated/tupago/api/v1/payment.js";
import { PaymentTransport, TransportDeps, jsonResponseViewFromValue } from "./types.js";
import { requireNonDefaultCliente, requireNonDefaultCatalogo } from "./validate.js";
import {
  NetworkError,
  bearerHeader,
  rawFetch,
  mapHttpStatusError,
  networkToException,
  parseJsonOrFail,
  requireValue,
} from "./httpCommon.js";

const GQL_PENDING_CODE = "PAYMENT_PENDING_RECONCILIATION";
const ALIAS = "q";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateAmount(field: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number (wire type is double); got ${value}`);
  }
}

/** Convenience factory mirroring the gRPC/REST construction. `target` is the base URL. */
export function createGraphqlTransport(deps: TransportDeps): GraphqlPaymentTransport {
  return new GraphqlPaymentTransport(deps);
}

export class GraphqlPaymentTransport implements PaymentTransport {
  private readonly base: string;
  private readonly credentials: CredentialProvider;
  private readonly deadlineMillis: number;
  private readonly readRetryPolicy: RetryPolicy;

  constructor(deps: TransportDeps) {
    if (!deps.target) throw new Error("target (GraphQL base URL) is required");
    if (!deps.credentials) throw new Error("credentials is required");
    this.base = deps.target.replace(/\/+$/, "");
    this.credentials = deps.credentials;
    this.deadlineMillis = deps.deadlineMillis && deps.deadlineMillis > 0 ? deps.deadlineMillis : 10_000;
    this.readRetryPolicy = deps.readRetryPolicy ?? BackoffRetryPolicy.of(3);
  }

  // ---- reads (transient-retryable) ----

  async getCliente(id: bigint, opts?: CallOptions): Promise<ClientePerfil> {
    const query = `query($id:ID!){ ${ALIAS}: cliente(id:$id){ cliente{ id nombre claveInstitucion key } catalogoInstitucion{ id claveInstitucion nombreCorto } } }`;
    return this.dispatchRead("GetCliente", opts, { query, variables: { id: String(id) } }, (data) => {
      requireValue(data?.cliente, "getCliente.cliente");
      requireValue(data?.catalogoInstitucion, "getCliente.catalogoInstitucion");
      const perfil = ClientePerfil.fromJSON({ cliente: data.cliente, catalogoInstitucion: data.catalogoInstitucion });
      requireNonDefaultCliente(perfil.cliente, "getCliente");
      requireNonDefaultCatalogo(perfil.catalogoInstitucion, "getCliente");
      return perfil;
    });
  }

  async getCatalogo(claveInstitucion: string, opts?: CallOptions): Promise<CatalogoInstitucion> {
    const query = `query($c:String!){ ${ALIAS}: catalogoInstitucion(claveInstitucion:$c){ id claveInstitucion nombreCorto } }`;
    return this.dispatchRead("GetCatalogo", opts, { query, variables: { c: claveInstitucion ?? "" } }, (data) => {
      requireValue(data, "getCatalogo");
      const cat = CatalogoInstitucion.fromJSON(data);
      requireNonDefaultCatalogo(cat, "getCatalogo");
      return cat;
    });
  }

  async getQrStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    const query = `query($idc:String!,$idCuenta:ID!){ ${ALIAS}: pagoQrEstatusByCuenta(idc:$idc,idCuenta:$idCuenta) }`;
    return this.dispatchRead("GetQrStatus", opts, { query, variables: { idc: idc ?? "", idCuenta: String(idCuenta) } }, (data) =>
      jsonResponseViewFromValue(data),
    );
  }

  async getTelefonicoStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    const query = `query($idc:String!,$idCuenta:ID!){ ${ALIAS}: pagoTelefonicoEstatusByCuenta(idc:$idc,idCuenta:$idCuenta) }`;
    return this.dispatchRead("GetTelefonicoStatus", opts, { query, variables: { idc: idc ?? "", idCuenta: String(idCuenta) } }, (data) =>
      jsonResponseViewFromValue(data),
    );
  }

  // ---- creates (NEVER auto-retried) ----

  async createQr(req: CreateQrParams, opts?: CallOptions): Promise<JsonResponseView> {
    validateAmount("monto", req.monto);
    const query = `mutation($in:PagoQrInput!,$k:String){ ${ALIAS}: createPagoQr(input:$in,idempotencyKey:$k) }`;
    const input = {
      idCuenta: String(req.idCuenta),
      monto: req.monto,
      concepto: req.concepto,
      referenciaNumerica: req.referenciaNumerica,
      nombreCliente: req.nombreCliente,
      email: req.email,
      tipoPago: req.tipoPago,
      vigencia: req.vigencia,
    };
    return this.dispatchCreate("CreateQr", opts, { query, variables: { in: input, k: req.idempotencyKey } }, (data) =>
      jsonResponseViewFromValue(data),
    );
  }

  async createTelefonico(req: CreateTelefonicoParams, opts?: CallOptions): Promise<JsonResponseView> {
    validateAmount("monto", req.monto);
    const query = `mutation($in:PagoTelefonicoInput!,$k:String){ ${ALIAS}: createPagoTelefonico(input:$in,idempotencyKey:$k) }`;
    const input = {
      key: req.key,
      monto: req.monto,
      concepto: req.concepto,
      referenciaNumerica: req.referenciaNumerica,
      numeroCelular: req.numeroCelular,
      vigencia: req.vigencia,
    };
    return this.dispatchCreate("CreateTelefonico", opts, { query, variables: { in: input, k: req.idempotencyKey } }, (data) =>
      jsonResponseViewFromValue(data),
    );
  }

  close(): void {
    /* GraphQL is stateless; nothing to release. */
  }

  // ---- internals ----

  private async post(body: unknown, opts?: CallOptions): Promise<any> {
    const headers = bearerHeader(this.credentials);
    headers["Content-Type"] = "application/json";
    const res = await rawFetch(
      `${this.base}/graphql`,
      { method: "POST", headers, body: JSON.stringify(body) },
      opts,
      this.deadlineMillis,
    );
    if (res.status >= 400) throw mapHttpStatusError(res.status, res.text);
    return parseJsonOrFail(res.text, "graphql");
  }

  private resultOrThrow(payload: any, _isCreate: boolean): any {
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
      const pending = payload.errors.find((e: any) => e?.extensions?.code === GQL_PENDING_CODE);
      if (pending) {
        throw new TupagoAbortedException(
          grpc.status.ABORTED,
          `${PENDING_RECONCILIATION_CODE}: ${pending.message ?? "payment pending reconciliation"}`,
        );
      }
      throw mapGraphQLError(payload.errors);
    }
    if (payload == null || typeof payload !== "object" || !("data" in payload) || payload.data == null) {
      throw new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, "GraphQL response missing data envelope");
    }
    return (payload.data as Record<string, unknown>)[ALIAS];
  }

  private async dispatchRead<T>(
    _method: string,
    opts: CallOptions | undefined,
    body: unknown,
    adapt: (data: any) => T,
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        const payload = await this.post(body, opts);
        return adapt(this.resultOrThrow(payload, false));
      } catch (e) {
        const te = this.normalizeReadError(e);
        if (this.readRetryPolicy.shouldRetry(attempt, te)) {
          await sleep(this.readRetryPolicy.delayMillis(attempt));
          attempt++;
          continue;
        }
        throw te;
      }
    }
  }

  private async dispatchCreate<T>(
    _method: string,
    opts: CallOptions | undefined,
    body: unknown,
    adapt: (data: any) => T,
  ): Promise<T> {
    try {
      const payload = await this.post(body, opts);
      return adapt(this.resultOrThrow(payload, true));
      } catch (e) {
        if (e instanceof NetworkError) throw networkToException(e, true);
        if (e instanceof TupagoException) throw e;
        throw new TupagoUnknownOutcomeException(
          grpc.status.UNKNOWN,
          `ambiguous create outcome: ${(e as Error)?.message ?? e}`,
          e,
        );
      }
    }

  /**
   * Normalize any read failure into a {@link TupagoException} so the configured readRetryPolicy can
   * make a single, uniform retry decision. A transport/network failure (NetworkError) becomes a
   * retryable TransientException; this is what makes GraphQL reads retry transient failures through
   * BackoffRetryPolicy (mirroring the REST transport's toReadError). Creates do NOT use this path.
   */
  private normalizeReadError(e: unknown): TupagoException {
    if (e instanceof NetworkError) return networkToException(e, false);
    if (e instanceof TupagoException) return e;
    return new TupagoInvalidArgumentException(
      grpc.status.INVALID_ARGUMENT,
      `unexpected read failure: ${(e as Error)?.message ?? e}`,
      e,
    );
  }
}

function mapGraphQLError(errors: any[]): TupagoException {
  const e0 = errors[0] ?? {};
  const code: string = e0?.extensions?.code ?? e0?.extensions?.classification ?? "";
  const msg: string = e0?.message ?? "GraphQL error";
  if (code === "UNAUTHENTICATED" || /unauth/i.test(msg)) {
    return new TupagoUnauthenticatedException(grpc.status.UNAUTHENTICATED, msg);
  }
  if (code === "NOT_FOUND" || /not found/i.test(msg)) {
    return new TupagoNotFoundException(grpc.status.NOT_FOUND, msg);
  }
  if (code === "INTERNAL" || /internal/i.test(msg)) {
    return new TupagoInternalException(grpc.status.INTERNAL, msg);
  }
  return new TupagoInvalidArgumentException(grpc.status.INVALID_ARGUMENT, msg);
}
