import type { CredentialProvider } from "../auth/index.js";
import { TlsConfig } from "../security/index.js";
import { RetryPolicy } from "../retry/index.js";
import { CreateQrParams, CreateTelefonicoParams, CallOptions } from "./types.js";
import { JsonResponseView } from "./JsonResponseView.js";
import { ClientePerfil, CatalogoInstitucion } from "../generated/tupago/api/v1/payment.js";
import { PaymentTransport, TransportDeps } from "../transport/types.js";
import { GrpcPaymentTransport } from "../transport/grpc.js";

/**
 * Public, transport-neutral entry point for the six TUPAGO3 payment operations.
 *
 * By default it builds a gRPC transport (the original, GREEN behavior). It also accepts an
 * explicit {@link PaymentTransport} so the same six-method surface works over REST or GraphQL
 * without any change to calling code. All transports return the SAME core domain types
 * (ClientePerfil, CatalogoInstitucion, JsonResponseView) and enforce the same financial-safety
 * laws: bearer auth, caller-owned idempotency key, no blind retry on creates, PendingReconciliation,
 * and fail-closed validation.
 */
export class TupagoPaymentClient {
  private readonly transport: PaymentTransport;

  constructor(opts: {
    target: string;
    credentials: CredentialProvider;
    tls?: TlsConfig;
    deadlineMillis?: number;
    readRetryPolicy?: RetryPolicy;
    /** Build on a specific transport (REST/GraphQL). Omit to use the default gRPC transport. */
    transport?: PaymentTransport;
  }) {
    if (!opts.target) throw new Error("target is required");
    if (!opts.credentials) throw new Error("credentials is required");
    this.transport =
      opts.transport ??
      new GrpcPaymentTransport({
        target: opts.target,
        credentials: opts.credentials,
        tls: opts.tls,
        deadlineMillis: opts.deadlineMillis,
        readRetryPolicy: opts.readRetryPolicy,
      } satisfies TransportDeps & { tls?: TlsConfig });
  }

  /** Profile + institution catalog. */
  getCliente(id: bigint, opts?: CallOptions): Promise<ClientePerfil> {
    return this.transport.getCliente(id, opts);
  }

  /** Institution catalog by clave_institucion. */
  getCatalogo(claveInstitucion: string, opts?: CallOptions): Promise<CatalogoInstitucion> {
    return this.transport.getCatalogo(claveInstitucion, opts);
  }

  /** Banxico status (JSON) for a QR. */
  getQrStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    return this.transport.getQrStatus(idc, idCuenta, opts);
  }

  /** Banxico status (JSON) for a telefónico. */
  getTelefonicoStatus(idc: string, idCuenta: bigint, opts?: CallOptions): Promise<JsonResponseView> {
    return this.transport.getTelefonicoStatus(idc, idCuenta, opts);
  }

  /**
   * Creates a QR payment. NEVER auto-retried (gate G4). Idempotency: pass a stable
   * idempotencyKey; the server dedupes identical keys. A transient transport error is
   * reclassified as TupagoUnknownOutcomeException (non-retryable) — do NOT blind-resubmit;
   * reuse the same key or call getQrStatus (correction #3).
   */
  createQr(req: CreateQrParams, opts?: CallOptions): Promise<JsonResponseView> {
    return this.transport.createQr(req, opts);
  }

  /**
   * Creates a telefonic payment. NEVER auto-retried (gate G4). Same idempotency/unknown-outcome
   * policy as createQr.
   */
  createTelefonico(req: CreateTelefonicoParams, opts?: CallOptions): Promise<JsonResponseView> {
    return this.transport.createTelefonico(req, opts);
  }

  /** Shut down the underlying transport (gate G10). Idempotent. */
  close(): void {
    this.transport.close();
  }
}
