import * as grpc from "@grpc/grpc-js";

import {
  CatalogoInstitucion,
  ClientePerfil,
  CreateQrRequest,
  CreateTelefonicoRequest,
  GetCatalogoRequest,
  GetClienteRequest,
  GetStatusRequest,
  JsonResponse,
} from "../generated/tupago/api/v1/payment.js";
import type { CredentialProvider } from "../auth/index.js";
import { ChannelSecurity, TlsConfig } from "../security/index.js";
import {
  StatusMapper,
  TupagoException,
  TupagoUnauthenticatedException,
  TupagoUnknownOutcomeException,
} from "../error/index.js";
import {
  BackoffRetryPolicy,
  RetryPolicy,
} from "../retry/index.js";
import { CreateQrParams, CreateTelefonicoParams, CallOptions } from "./types.js";
import { JsonResponseView } from "./JsonResponseView.js";

const SERVICE_NAME = "tupago.api.v1.PaymentService";
const AUTHORIZATION = "authorization";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateAmount(field: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number (wire type is double); got ${value}`);
  }
}

/**
 * Async gRPC client for the TUPAGO3 {@code PaymentService}, generated 1:1 from the frozen
 * backend contract (payment.proto, backend3 22ad947). The public surface is 1:1 with the six
 * RPCs. Create operations use {@link NoRetryPolicy} (gate G4); read operations use the
 * configured {@link RetryPolicy} (transient-only).
 */
export class TupagoPaymentClient {
  private readonly client: grpc.Client;
  private readonly credentialProvider: CredentialProvider;
  private readonly deadlineMillis: number;
  private readonly readRetryPolicy: RetryPolicy;
  private closed = false;

  constructor(opts: {
    target: string;
    credentials: CredentialProvider;
    tls?: TlsConfig;
    deadlineMillis?: number;
    readRetryPolicy?: RetryPolicy;
  }) {
    if (!opts.target) throw new Error("target is required");
    if (!opts.credentials) throw new Error("credentials is required");

    const channelCreds = ChannelSecurity.forTarget(opts.target, opts.tls);

    this.client = new grpc.Client(opts.target, channelCreds, {
      "grpc.max_receive_message_length": 8 * 1024 * 1024,
      "grpc.max_send_message_length": 8 * 1024 * 1024,
    });
    this.credentialProvider = opts.credentials;
    this.deadlineMillis = opts.deadlineMillis && opts.deadlineMillis > 0 ? opts.deadlineMillis : 10_000;
    this.readRetryPolicy = opts.readRetryPolicy ?? BackoffRetryPolicy.of(3);
  }

  /** Profile + institution catalog. */
  async getCliente(id: bigint, opts?: CallOptions): Promise<ClientePerfil> {
    const req = GetClienteRequest.encode({ id }).finish();
    return this.executeRead("GetCliente", req, (b) => ClientePerfil.decode(b), opts);
  }

  /** Institution catalog by clave_institucion. */
  async getCatalogo(claveInstitucion: string, opts?: CallOptions): Promise<CatalogoInstitucion> {
    const req = GetCatalogoRequest.encode({ claveInstitucion: claveInstitucion ?? "" }).finish();
    return this.executeRead("GetCatalogo", req, (b) => CatalogoInstitucion.decode(b), opts);
  }

  /** Banxico status (JSON) for a QR. */
  async getQrStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    const req = GetStatusRequest.encode({ idc: idc ?? "", idCuenta }).finish();
    return this.executeReadView("GetQrStatus", req, opts);
  }

  /** Banxico status (JSON) for a telefónico. */
  async getTelefonicoStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    const req = GetStatusRequest.encode({ idc: idc ?? "", idCuenta }).finish();
    return this.executeReadView("GetTelefonicoStatus", req, opts);
  }

  /**
   * Creates a QR payment. NEVER auto-retried (gate G4). Idempotency: pass a stable
   * idempotencyKey; the server dedupes identical keys. A transient transport error is
   * reclassified as TupagoUnknownOutcomeException (non-retryable) — do NOT blind-resubmit;
   * reuse the same key or call getQrStatus (correction #3).
   */
  async createQr(req: CreateQrParams, opts?: CallOptions): Promise<JsonResponseView> {
    validateAmount("monto", req.monto);
    const wire = CreateQrRequest.encode({
      idCuenta: req.idCuenta,
      monto: req.monto,
      concepto: req.concepto,
      referenciaNumerica: req.referenciaNumerica,
      nombreCliente: req.nombreCliente,
      email: req.email,
      tipoPago: req.tipoPago,
      vigencia: req.vigencia,
      idempotencyKey: req.idempotencyKey,
    }).finish();
    return this.executeFinancialView("CreateQr", wire, opts);
  }

  /**
   * Creates a telefonic payment. NEVER auto-retried (gate G4). Same idempotency/unknown-outcome
   * policy as createQr.
   */
  async createTelefonico(req: CreateTelefonicoParams, opts?: CallOptions): Promise<JsonResponseView> {
    validateAmount("monto", req.monto);
    const wire = CreateTelefonicoRequest.encode({
      key: req.key,
      monto: req.monto,
      concepto: req.concepto,
      referenciaNumerica: req.referenciaNumerica,
      numeroCelular: req.numeroCelular,
      vigencia: req.vigencia,
      idempotencyKey: req.idempotencyKey,
    }).finish();
    return this.executeFinancialView("CreateTelefonico", wire, opts);
  }

  /** Shut down the underlying channel (gate G10). Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
  }

  // ---- internals ----

  private async executeRead<T>(
    method: string,
    reqBytes: Uint8Array,
    deserialize: (b: Uint8Array) => T,
    opts?: CallOptions,
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.unary<T>(method, reqBytes, deserialize, opts);
      } catch (e) {
        const te = StatusMapper.map(e);
        if (this.readRetryPolicy.shouldRetry(attempt, te)) {
          const delay = this.readRetryPolicy.delayMillis(attempt);
          await sleep(delay);
          attempt++;
          continue;
        }
        throw te;
      }
    }
  }

  private async executeReadView(method: string, reqBytes: Uint8Array, opts?: CallOptions): Promise<JsonResponseView> {
    const raw = await this.executeRead<JsonResponse>(method, reqBytes, (b) => JsonResponse.decode(b), opts);
    return new JsonResponseView(raw);
  }

  /**
   * Execute a CREATE operation. NoRetryPolicy is enforced (gate G4). Crucially, a transient
   * transport error on a financial create is reclassified as an UNKNOWN OUTCOME (non-retryable)
   * so the caller can never blind-resubmit (correction #3).
   */
  private async executeFinancial<T>(
    method: string,
    reqBytes: Uint8Array,
    deserialize: (b: Uint8Array) => T,
    opts?: CallOptions,
  ): Promise<T> {
    try {
      return await this.unary<T>(method, reqBytes, deserialize, opts);
    } catch (e) {
      const te = StatusMapper.map(e);
      if (te.isRetryable()) {
        throw new TupagoUnknownOutcomeException(te.code, te.description, te);
      }
      throw te;
    }
  }

  private async executeFinancialView(method: string, reqBytes: Uint8Array, opts?: CallOptions): Promise<JsonResponseView> {
    const raw = await this.executeFinancial<JsonResponse>(method, reqBytes, (b) => JsonResponse.decode(b), opts);
    return new JsonResponseView(raw);
  }

  private unary<T>(
    method: string,
    reqBytes: Uint8Array,
    deserialize: (b: Uint8Array) => T,
    opts?: CallOptions,
  ): Promise<T> {
    const deadlineMillis = opts?.deadlineMillis && opts.deadlineMillis > 0 ? opts.deadlineMillis : this.deadlineMillis;
    const deadline = new Date(Date.now() + deadlineMillis);
    const signal = opts?.signal;

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const metadata = new grpc.Metadata();
      const token = this.credentialProvider.token();
      if (token == null || token.trim() === "") {
        reject(
          new TupagoUnauthenticatedException(
            grpc.status.UNAUTHENTICATED,
            "No bearer token supplied by CredentialProvider",
          ),
        );
        return;
      }
      metadata.set(AUTHORIZATION, `Bearer ${token}`);

      const onAbort = () => call.cancel();
      const call = this.client.makeUnaryRequest<Uint8Array, T>(
        `/${SERVICE_NAME}/${method}`,
        (u: Uint8Array) => Buffer.from(u),
        (b: Buffer) => deserialize(new Uint8Array(b)),
        reqBytes,
        metadata,
        { deadline },
        (err: grpc.ServiceError | null, value?: T) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          if (err) {
            finish(() => reject(err));
            return;
          }
          finish(() => resolve(value as T));
        },
      );

      if (signal) {
        if (signal.aborted) {
          call.cancel();
          finish(() =>
            reject(
              new TupagoException({
                code: grpc.status.CANCELLED,
                description: "Call aborted by AbortSignal",
                message: "CANCELLED: Call aborted by AbortSignal",
                retryable: false,
                pendingReconciliation: false,
              }),
            ),
          );
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}
