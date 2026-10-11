import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as grpc from "@grpc/grpc-js";
import {
  TupagoPaymentClient,
  TupagoException,
  TupagoNotFoundException,
  TupagoInvalidArgumentException,
  TupagoPermissionDeniedException,
  TupagoUnauthenticatedException,
  TupagoAlreadyExistsException,
  TupagoFailedPreconditionException,
  TupagoInternalException,
  TupagoAbortedException,
  TupagoUnknownOutcomeException,
  TupagoTransientException,
  PENDING_RECONCILIATION_CODE,
  CredentialProvider,
  NoRetryPolicy,
  BackoffRetryPolicy,
} from "../src/index.js";
import { MockPaymentServer } from "./support/mockServer.js";
import {
  GetClienteRequest,
  GetStatusRequest,
  CreateQrRequest,
} from "../src/generated/tupago/api/v1/payment.js";

function provider(token: string | null): CredentialProvider {
  return { token: () => token };
}

function makeClient(server: MockPaymentServer, token: string | null = "valid.jwt.token"): TupagoPaymentClient {
  return new TupagoPaymentClient({
    target: server.target,
    credentials: provider(token),
    deadlineMillis: 5000,
  });
}

let server: MockPaymentServer;
let client: TupagoPaymentClient;

afterEach(async () => {
  try {
    client?.close();
  } catch {
    /* noop */
  }
  if (server) await server.stop();
});

describe("1. Six RPCs and wire-level equivalence", () => {
  beforeEach(async () => {
    server = new MockPaymentServer();
    await server.start();
    client = makeClient(server);
  });

  it("GetCliente round-trips an int64 id as bigint (wire equivalent)", async () => {
    const a = GetClienteRequest.encode({ id: 123n }).finish();
    const b = GetClienteRequest.encode({ id: 123n }).finish();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const res = await client.getCliente(123n);
    expect(res.cliente?.id).toBe(123n);
    expect(server.captured[0]?.request).toMatchObject({ id: 123n });
  });

  it("GetCatalogo returns catalog", async () => {
    const res = await client.getCatalogo("BANX");
    expect(res.claveInstitucion).toBe("BANX");
  });

  it("GetQrStatus / GetTelefonicoStatus return JSON view", async () => {
    const qr = await client.getQrStatus("IDC1", 55n);
    expect(qr.parsed()).toMatchObject({ status: "PAGADO", method: "GetQrStatus" });
    const tel = await client.getTelefonicoStatus("IDC2", 56n);
    expect(tel.json()).toContain("GetTelefonicoStatus");
  });

  it("CreateQr and CreateTelefonico return JSON view", async () => {
    const qr = await client.createQr({
      idCuenta: 77n, monto: 150.5, concepto: "c", referenciaNumerica: 1,
      nombreCliente: "n", email: "e@x.com", tipoPago: 1, vigencia: 60, idempotencyKey: "K1",
    });
    expect(qr.parsed()).toMatchObject({ method: "CreateQr", idempotencyKey: "K1" });
    const tel = await client.createTelefonico({
      key: "k", monto: 200, concepto: "c", referenciaNumerica: 2,
      numeroCelular: "555", vigencia: 30, idempotencyKey: "K2",
    });
    expect(tel.parsed()).toMatchObject({ method: "CreateTelefonico" });
  });

  it("rejects non-finite monto (monetary safety)", async () => {
    await expect(
      client.createQr({
        idCuenta: 1n, monto: NaN, concepto: "c", referenciaNumerica: 1,
        nombreCliente: "n", email: "e", tipoPago: 1, vigencia: 1, idempotencyKey: "K",
      }),
    ).rejects.toThrow(/finite number/);
  });
});

describe("2. JWT valid, invalid and absent", () => {
  beforeEach(async () => {
    server = new MockPaymentServer();
    await server.start();
  });

  it("attaches Bearer token on every RPC", async () => {
    client = makeClient(server, "my.jwt");
    await client.getCliente(1n);
    expect(server.captured[0]?.authorization).toBe("Bearer my.jwt");
  });

  it("absent token fails closed with UNAUTHENTICATED before reaching server", async () => {
    client = makeClient(server, null);
    await expect(client.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
    expect(server.captured.length).toBe(0);
  });

  it("invalid token rejected by server maps to UNAUTHENTICATED", async () => {
    server = new MockPaymentServer({
      behaviors: {
        GetCliente: () => ({ kind: "error", code: grpc.status.UNAUTHENTICATED, details: "bad token" }),
      },
    });
    await server.start();
    client = makeClient(server, "bad.jwt");
    const err = await client.getCliente(1n).catch((e) => e);
    expect(err).toBeInstanceOf(TupagoUnauthenticatedException);
  });
});

describe("3. TLS fail-closed for remote endpoints", () => {
  it("non-loopback target without TLS throws (gate G8)", async () => {
    server = new MockPaymentServer();
    expect(
      () =>
        new TupagoPaymentClient({
          target: "api.tupago.example:443",
          credentials: provider("t"),
        }),
    ).toThrow(/TLS required|fail-closed|gate G8/i);
  });

  it("loopback target is allowed without TLS (local dev)", async () => {
    server = new MockPaymentServer();
    await server.start();
    expect(() => makeClient(server)).not.toThrow();
  });
});

describe("4. Reads: retry, NOT_FOUND and error mapping", () => {
  it("retries transient UNAVAILABLE on reads then succeeds", async () => {
    let calls = 0;
    server = new MockPaymentServer({
      behaviors: {
        GetCliente: () => {
          calls++;
          if (calls < 3) return { kind: "error", code: grpc.status.UNAVAILABLE, details: "transient" };
          return { kind: "response", message: { cliente: { id: 1n }, catalogoInstitucion: { id: 9n } } };
        },
      },
    });
    await server.start();
    client = makeClient(server);
    const res = await client.getCliente(1n);
    expect(calls).toBe(3);
    expect(res.cliente?.id).toBe(1n);
  });

  it("NOT_FOUND is mapped and never retried", async () => {
    server = new MockPaymentServer({
      behaviors: { GetCatalogo: () => ({ kind: "error", code: grpc.status.NOT_FOUND, details: "missing" }) },
    });
    await server.start();
    client = makeClient(server);
    const err = await client.getCatalogo("X").catch((e) => e);
    expect(err).toBeInstanceOf(TupagoNotFoundException);
    expect(server.captured.length).toBe(1);
  });
});

describe("5. The seven preserved gRPC states", () => {
  const cases: Array<[grpc.status, new (...a: any[]) => TupagoException]> = [
    [grpc.status.UNAUTHENTICATED, TupagoUnauthenticatedException],
    [grpc.status.PERMISSION_DENIED, TupagoPermissionDeniedException],
    [grpc.status.INVALID_ARGUMENT, TupagoInvalidArgumentException],
    [grpc.status.ALREADY_EXISTS, TupagoAlreadyExistsException],
    [grpc.status.FAILED_PRECONDITION, TupagoFailedPreconditionException],
    [grpc.status.NOT_FOUND, TupagoNotFoundException],
    [grpc.status.INTERNAL, TupagoInternalException],
  ];
  for (const [code, klass] of cases) {
    it(`maps ${grpc.status[code]} -> ${klass.name}`, async () => {
      server = new MockPaymentServer({
        behaviors: { GetCliente: () => ({ kind: "error", code, details: "d" }) },
      });
      await server.start();
      client = makeClient(server);
      const err = await client.getCliente(1n).catch((e) => e);
      expect(err).toBeInstanceOf(klass);
      expect((err as TupagoException).code).toBe(code);
    });
  }
});

describe("6. NoRetry on Create under any state", () => {
  it("CreateQr with NOT_FOUND is not retried (single attempt)", async () => {
    server = new MockPaymentServer({
      behaviors: { CreateQr: () => ({ kind: "error", code: grpc.status.NOT_FOUND, details: "nf" }) },
    });
    await server.start();
    client = makeClient(server);
    const err = await client
      .createQr({ idCuenta: 1n, monto: 1, concepto: "c", referenciaNumerica: 1, nombreCliente: "n", email: "e", tipoPago: 1, vigencia: 1, idempotencyKey: "K" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TupagoNotFoundException);
    expect(server.captured.length).toBe(1);
  });

  it("CreateQr never uses a retry policy even if one is supplied", async () => {
    server = new MockPaymentServer({
      behaviors: { CreateQr: () => ({ kind: "error", code: grpc.status.UNAVAILABLE, details: "x" }) },
    });
    await server.start();
    client = new TupagoPaymentClient({
      target: server.target,
      credentials: provider("t"),
      readRetryPolicy: BackoffRetryPolicy.of(5),
      deadlineMillis: 5000,
    });
    const err = await client
      .createQr({ idCuenta: 1n, monto: 1, concepto: "c", referenciaNumerica: 1, nombreCliente: "n", email: "e", tipoPago: 1, vigencia: 1, idempotencyKey: "K" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TupagoUnknownOutcomeException);
    expect(server.captured.length).toBe(1);
  });
});

describe("7. Create UNAVAILABLE/DEADLINE_EXCEEDED -> UnknownOutcome", () => {
  it("UNAVAILABLE on create -> UnknownOutcome (non-retryable)", async () => {
    server = new MockPaymentServer({
      behaviors: { CreateTelefonico: () => ({ kind: "error", code: grpc.status.UNAVAILABLE, details: "x" }) },
    });
    await server.start();
    client = makeClient(server);
    const err = await client
      .createTelefonico({ key: "k", monto: 1, concepto: "c", referenciaNumerica: 1, numeroCelular: "5", vigencia: 1, idempotencyKey: "K" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TupagoUnknownOutcomeException);
    expect((err as TupagoException).isRetryable()).toBe(false);
  });

  it("DEADLINE_EXCEEDED on create -> UnknownOutcome", async () => {
    server = new MockPaymentServer({
      behaviors: { CreateQr: () => ({ kind: "error", code: grpc.status.DEADLINE_EXCEEDED, details: "x" }) },
    });
    await server.start();
    client = makeClient(server);
    const err = await client
      .createQr({ idCuenta: 1n, monto: 1, concepto: "c", referenciaNumerica: 1, nombreCliente: "n", email: "e", tipoPago: 1, vigencia: 1, idempotencyKey: "K" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TupagoUnknownOutcomeException);
  });
});

describe("8. ABORTED / TUPAGO_PENDING_RECONCILIATION -> reconciliation", () => {
  it("surfaces pending reconciliation and is not retryable", async () => {
    server = new MockPaymentServer({
      behaviors: {
        CreateQr: () => ({ kind: "error", code: grpc.status.ABORTED, details: `${PENDING_RECONCILIATION_CODE} ref=123` }),
      },
    });
    await server.start();
    client = makeClient(server);
    const err = await client
      .createQr({ idCuenta: 1n, monto: 1, concepto: "c", referenciaNumerica: 1, nombreCliente: "n", email: "e", tipoPago: 1, vigencia: 1, idempotencyKey: "K" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(TupagoAbortedException);
    expect((err as TupagoAbortedException).isPendingReconciliation()).toBe(true);
    expect(server.captured.length).toBe(1);
  });
});

describe("9. Idempotency key preserved on the wire", () => {
  it("passes idempotencyKey verbatim", async () => {
    server = new MockPaymentServer();
    await server.start();
    client = makeClient(server);
    await client.createQr({
      idCuenta: 1n, monto: 12.34, concepto: "c", referenciaNumerica: 1,
      nombreCliente: "n", email: "e", tipoPago: 1, vigencia: 1, idempotencyKey: "STABLE-KEY-9",
    });
    expect((server.captured[0]?.request as any).idempotencyKey).toBe("STABLE-KEY-9");
    // round-trip through protobuf encode/decode loses nothing
    const enc = CreateQrRequest.encode({ idCuenta: 1n, monto: 12.34, concepto: "c", referenciaNumerica: 1, nombreCliente: "n", email: "e", tipoPago: 1, vigencia: 1, idempotencyKey: "STABLE-KEY-9" }).finish();
    const dec = CreateQrRequest.decode(enc);
    expect(dec.idempotencyKey).toBe("STABLE-KEY-9");
  });
});

describe("10. Cancellation, disconnection and deadlines", () => {
  it("AbortSignal cancels an in-flight read", async () => {
    server = new MockPaymentServer({
      behaviors: { GetCliente: () => ({ kind: "delay", ms: 3000, then: { kind: "response", message: { cliente: { id: 1n } } } }) },
    });
    await server.start();
    client = makeClient(server);
    const ac = new AbortController();
    const p = client.getCliente(1n, { signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(TupagoException);
    expect((err as TupagoException).code).toBe(grpc.status.CANCELLED);
  });

  it("deadline exceeded on a slow read maps to transient", async () => {
    server = new MockPaymentServer({
      behaviors: { GetCatalogo: () => ({ kind: "delay", ms: 1000, then: { kind: "response", message: { id: 9n } } }) },
    });
    await server.start();
    client = makeClient(server);
    const err = await client.getCatalogo("X", { deadlineMillis: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(TupagoTransientException);
    expect((err as TupagoException).code).toBe(grpc.status.DEADLINE_EXCEEDED);
  });

  it("call after close() fails (disconnection)", async () => {
    server = new MockPaymentServer();
    await server.start();
    client = makeClient(server);
    client.close();
    await expect(client.getCliente(1n)).rejects.toBeTruthy();
  });
});

describe("NoRetryPolicy is reusable and never retries", () => {
  it("shouldRetry is always false", () => {
    const p = NoRetryPolicy.INSTANCE;
    expect(p.shouldRetry(0, new TupagoTransientException(grpc.status.UNAVAILABLE, "x"))).toBe(false);
  });

  it("GetStatusRequest accepts bigint idCuenta", () => {
    const enc = GetStatusRequest.encode({ idc: "X", idCuenta: 999n }).finish();
    expect(GetStatusRequest.decode(enc).idCuenta).toBe(999n);
  });
});
