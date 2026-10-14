/**
 * REST / JSON transport for the six TUPAGO3 payment operations.
 *
 * Wire authority: backend3 @ bbf06c02.
 * C2 uses /msjpagotelefonicousuario (resolveSingleOwnedCliente).
 * C4 body uses idMsjdeCobro (NOT idc).
 * Status routes prefer ByCuenta when idCuenta is explicit.
 * Creates are single-attempt / no-blind-retry.
 */
import * as grpc from "@grpc/grpc-js";
import {
  CatalogoInstitucion,
  ClientePerfil,
} from "../generated/tupago/api/v1/payment.js";
import type { CredentialProvider } from "../auth/index.js";
import {
  TupagoException,
  TupagoUnknownOutcomeException,
} from "../error/index.js";
import { BackoffRetryPolicy, RetryPolicy } from "../retry/index.js";
import { CreateQrParams, CreateTelefonicoParams, CallOptions } from "../client/types.js";
import { JsonResponseView } from "../client/JsonResponseView.js";
import { PaymentTransport, TransportDeps, jsonResponseViewFromValue } from "./types.js";
import {
  NetworkError,
  bearerHeader,
  rawFetch,
  mapHttpStatusError,
  networkToException,
  parseJsonOrFail,
  requireValue,
} from "./httpCommon.js";
import { requireNonDefaultCliente, requireNonDefaultCatalogo } from "./validate.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateAmount(field: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number (wire type is double); got ${value}`);
  }
}

export function createRestTransport(deps: TransportDeps): RestPaymentTransport {
  return new RestPaymentTransport(deps);
}

export class RestPaymentTransport implements PaymentTransport {
  private readonly base: string;
  private readonly credentials: CredentialProvider;
  private readonly deadlineMillis: number;
  private readonly readRetryPolicy: RetryPolicy;

  constructor(deps: TransportDeps) {
    if (!deps.target) throw new Error("target (REST base URL) is required");
    if (!deps.credentials) throw new Error("credentials is required");
    this.base = deps.target.replace(/\/+$/, "");
    this.credentials = deps.credentials;
    this.deadlineMillis = deps.deadlineMillis && deps.deadlineMillis > 0 ? deps.deadlineMillis : 10_000;
    this.readRetryPolicy = deps.readRetryPolicy ?? BackoffRetryPolicy.of(3);
  }

  async getCliente(id: bigint, opts?: CallOptions): Promise<ClientePerfil> {
    const idStr = String(id);
    return this.dispatchRead("GetCliente", opts, async () => {
      const raw = await this.getJson(`/api/clientes/${encodeURIComponent(idStr)}`);
      requireValue(raw, "getCliente");
      requireNonDefaultCliente(raw, "getCliente");
      // Compose catalog if claveInstitucion present.
      let catalogo = {};
      if (raw.claveInstitucion) {
        try {
          catalogo = await this.getJson(`/api/catalogo-institucions/clave/${encodeURIComponent(raw.claveInstitucion)}`);
          requireNonDefaultCatalogo(catalogo, "getCliente.catalogo");
        } catch { /* catalog composition is best-effort */ }
      }
      return ClientePerfil.fromJSON({ cliente: raw, catalogoInstitucion: catalogo });
    });
  }

  async getCatalogo(claveInstitucion: string, opts?: CallOptions): Promise<CatalogoInstitucion> {
    const clave = claveInstitucion ?? "";
    return this.dispatchRead("GetCatalogo", opts, async () => {
      const raw = await this.getJson(`/api/catalogo-institucions/clave/${encodeURIComponent(clave)}`);
      requireValue(raw, "getCatalogo");
      requireNonDefaultCatalogo(raw, "getCatalogo");
      return CatalogoInstitucion.fromJSON(raw);
    });
  }

  async getQrStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    return this.dispatchRead("GetQrStatus", opts, async () => {
      const raw = await this.postJson("/api/payments/estatusmsjqr", { idc: idc ?? "", idCuenta: idCuenta.toString() });
      const value = parseJsonOrFail(typeof raw === "string" ? raw : JSON.stringify(raw), "getQrStatus");
      requireValue(value, "getQrStatus");
      return jsonResponseViewFromValue(value);
    });
  }

  async getTelefonicoStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    return this.dispatchRead("GetTelefonicoStatus", opts, async () => {
      // C4 body uses idMsjdeCobro (NOT idc) per backend3 DTO.
      const raw = await this.postJson("/api/payments/estatusmsjcobrotelefonico", {
        idCuenta: idCuenta.toString(),
        idMsjdeCobro: idc ?? "",
      });
      const value = parseJsonOrFail(typeof raw === "string" ? raw : JSON.stringify(raw), "getTelefonicoStatus");
      requireValue(value, "getTelefonicoStatus");
      return jsonResponseViewFromValue(value);
    });
  }

  async createQr(req: CreateQrParams, opts?: CallOptions): Promise<JsonResponseView> {
    validateAmount("monto", req.monto);
    const body = {
      idCuenta: req.idCuenta.toString(),
      monto: req.monto,
      concepto: req.concepto,
      referenciaNumerica: req.referenciaNumerica,
      nombreCliente: req.nombreCliente,
      email: req.email,
      tipoPago: req.tipoPago,
      vigencia: req.vigencia,
    };
    return this.dispatchCreate("CreateQr", opts, req.idempotencyKey, body, (payload) => {
      const qr = payload && typeof payload === "object" && "mensaje" in payload ? (payload as any).mensaje : payload;
      requireValue(qr, "createQr.mensaje");
      return jsonResponseViewFromValue(qr);
    });
  }

  async createTelefonico(req: CreateTelefonicoParams, opts?: CallOptions): Promise<JsonResponseView> {
    validateAmount("monto", req.monto);
    const body = {
      key: req.key,
      monto: req.monto,
      concepto: req.concepto,
      referenciaNumerica: req.referenciaNumerica,
      numeroCelular: req.numeroCelular,
      vigencia: req.vigencia,
    };
    return this.dispatchCreate("CreateTelefonico", opts, req.idempotencyKey, body, (payload) => {
      requireValue(payload, "createTelefonico");
      return jsonResponseViewFromValue(payload);
    });
  }

  close(): void {}

  private async getJson(path: string): Promise<any> {
    const res = await rawFetch(
      `${this.base}${path}`,
      { method: "GET", headers: this.headers() },
      undefined,
      this.deadlineMillis,
    );
    if (res.status >= 400) throw mapHttpStatusError(res.status, res.text);
    return parseJsonOrFail(res.text, path);
  }

  private async postJson(path: string, body: unknown, idempotencyKey?: string): Promise<any> {
    const headers = this.headers();
    headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await rawFetch(
      `${this.base}${path}`,
      { method: "POST", headers, body: JSON.stringify(body) },
      undefined,
      this.deadlineMillis,
    );
    if (res.status >= 400) throw mapHttpStatusError(res.status, res.text);
    return parseJsonOrFail(res.text, path);
  }

  private headers(): Record<string, string> {
    return bearerHeader(this.credentials);
  }

  private async dispatchRead<T>(_method: string, opts: CallOptions | undefined, op: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await op();
      } catch (e) {
        const te = this.toReadError(e);
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
    idempotencyKey: string,
    body: unknown,
    adapt: (payload: any) => T,
  ): Promise<T> {
    // C2 CANONICAL: /msjpagotelefonicousuario (resolveSingleOwnedCliente)
    const path = _method === "CreateQr" ? "/api/payments/msjpagoqrusuario" : "/api/payments/msjpagotelefonicousuario";
    try {
      const headers = this.headers();
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = idempotencyKey;
      const res = await rawFetch(
        `${this.base}${path}`,
        { method: "POST", headers, body: JSON.stringify(body) },
        opts,
        this.deadlineMillis,
      );
      if (res.status === 202) throw mapHttpStatusError(202, res.text);
      if (res.status >= 400) throw mapHttpStatusError(res.status, res.text);
      const payload = parseJsonOrFail(res.text, path);
      return adapt(payload);
    } catch (e) {
      if (e instanceof NetworkError) throw networkToException(e, true);
      if (e instanceof TupagoException) throw e;
      throw new TupagoUnknownOutcomeException(grpc.status.UNKNOWN, `ambiguous create outcome: ${(e as Error).message}`, e);
    }
  }

  private toReadError(e: unknown): TupagoException {
    if (e instanceof TupagoException) return e;
    if (e instanceof NetworkError) return networkToException(e, false);
    return new TupagoException({
      code: grpc.status.UNKNOWN,
      description: (e as Error)?.message ?? String(e),
      message: `UNKNOWN: ${(e as Error)?.message ?? e}`,
      retryable: false,
      pendingReconciliation: false,
      cause: e,
    });
  }
}
