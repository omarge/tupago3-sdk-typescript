import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import {
  createGraphqlTransport,
  TupagoException,
  TupagoUnauthenticatedException,
  TupagoNotFoundException,
  TupagoInvalidArgumentException,
  TupagoAbortedException,
  TupagoUnknownOutcomeException,
  TupagoTransientException,
  PENDING_RECONCILIATION_CODE,
  CredentialProvider,
  RetryPolicy,
} from "../src/index.js";
import type { ClientePerfil, CatalogoInstitucion } from "../src/generated/tupago/api/v1/payment.js";

interface Captured {
  body: any;
  headers: http.IncomingHttpHeaders;
}
interface Envelope {
  status?: number;
  payload: unknown;
}

let server: http.Server;
let baseUrl = "";
let lastReq: Captured | null = null;
let requestCount = 0;
let responder: (reqBody: any) => Envelope;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastReq = { body: JSON.parse(Buffer.concat(chunks).toString("utf8")), headers: req.headers };
        requestCount++;
        const env = responder(lastReq!.body);
        res.writeHead(env.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(env.payload));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

function ok(payload: unknown): Envelope {
  return { payload };
}
function httpError(status: number, payload: unknown): Envelope {
  return { status, payload };
}

function creds(token: string | null = "eyJ.test.jwt"): CredentialProvider {
  return { token: () => token };
}
function makeTransport(target = baseUrl): ReturnType<typeof createGraphqlTransport> {
  return createGraphqlTransport({ target, credentials: creds() });
}

const QR_REQ = {
  idCuenta: 1n,
  monto: 100.5,
  concepto: "pago",
  referenciaNumerica: 12345,
  nombreCliente: "JUAN",
  email: "a@b.com",
  tipoPago: 1,
  vigencia: 900,
  idempotencyKey: "gql-idem-001",
};
const TEL_REQ = {
  key: "k1",
  monto: 50,
  concepto: "pago",
  referenciaNumerica: 999,
  numeroCelular: "5512345678",
  vigencia: 900,
  idempotencyKey: "gql-idem-002",
};

beforeEach(async () => {
  lastReq = null;
  requestCount = 0;
  await startServer();
});
afterEach(() => {
  server.close();
});

describe("GraphQL transport — reads", () => {
  it("C5 getCliente maps cliente + catalogoInstitucion", async () => {
    responder = () => ok({ data: { q: { cliente: { id: "1", nombre: "PRODTEST01", claveInstitucion: "301", key: "K" }, catalogoInstitucion: { id: "1502", claveInstitucion: "301", nombreCorto: "MEMBER_A" } } } });
    const t = makeTransport();
    const r: ClientePerfil = await t.getCliente(1n);
    expect(lastReq?.body.query).toContain("cliente(id:$id)");
    expect(lastReq?.body.variables.id).toBe("1");
    expect(r.cliente?.nombre).toBe("PRODTEST01");
    expect(r.catalogoInstitucion?.nombreCorto).toBe("MEMBER_A");
    expect(lastReq?.headers["authorization"]).toBe("Bearer eyJ.test.jwt");
  });

  it("C6 getCatalogo maps institution", async () => {
    responder = () => ok({ data: { q: { id: "9", claveInstitucion: "301", nombreCorto: "MEMBER_A" } } });
    const t = makeTransport();
    const r: CatalogoInstitucion = await t.getCatalogo("301");
    expect(lastReq?.body.query).toContain("catalogoInstitucion(claveInstitucion:$c)");
    expect(lastReq?.body.variables.c).toBe("301");
    expect(r.nombreCorto).toBe("MEMBER_A");
  });

  it("C3 getQrStatus returns JSON view and uses pagoQrEstatusByCuenta", async () => {
    responder = () => ok({ data: { q: [{ estado: "PENDIENTE" }] } });
    const t = makeTransport();
    const v = await t.getQrStatus("x", 1n);
    expect(lastReq?.body.query).toContain("pagoQrEstatusByCuenta");
    expect(lastReq?.body.variables).toMatchObject({ idc: "x", idCuenta: "1" });
    expect(Array.isArray(v.parsed())).toBe(true);
  });

  it("C4 getTelefonicoStatus uses pagoTelefonicoEstatusByCuenta", async () => {
    responder = () => ok({ data: { q: [{ estado: "PENDIENTE" }] } });
    const t = makeTransport();
    const v = await t.getTelefonicoStatus("y", 1n);
    expect(lastReq?.body.query).toContain("pagoTelefonicoEstatusByCuenta");
    expect(v.parsed()).toBeDefined();
  });
});

describe("GraphQL transport — creates", () => {
  it("C1 createQr sends PagoQrInput + idempotencyKey variable", async () => {
    responder = () => ok({ data: { q: { id: "QR1", cadena: "abc" } } });
    const t = makeTransport();
    const v = await t.createQr(QR_REQ);
    expect(lastReq?.body.query).toContain("createPagoQr(input:$in,idempotencyKey:$k)");
    expect(lastReq?.body.variables.k).toBe("gql-idem-001");
    expect(lastReq?.body.variables.in.idCuenta).toBe("1");
    expect(v.json()).toContain("QR1");
  });

  it("C2 createTelefonico sends PagoTelefonicoInput + idempotencyKey variable", async () => {
    responder = () => ok({ data: { q: { id: "T1" } } });
    const t = makeTransport();
    const v = await t.createTelefonico(TEL_REQ);
    expect(lastReq?.body.query).toContain("createPagoTelefonico");
    expect(lastReq?.body.variables.k).toBe("gql-idem-002");
    expect(v.json()).toContain("T1");
  });

  it("idempotency key is a GraphQL variable, NOT an HTTP header", async () => {
    responder = () => ok({ data: { q: { id: "QR1" } } });
    const t = makeTransport();
    await t.createQr(QR_REQ);
    expect(lastReq?.headers["idempotency-key"]).toBeUndefined();
    expect(lastReq?.body.variables.k).toBe("gql-idem-001");
  });
});

describe("GraphQL transport — auth", () => {
  it("missing bearer fails closed before any request", async () => {
    const t = createGraphqlTransport({ target: baseUrl, credentials: creds(null) });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
    expect(requestCount).toBe(0);
  });
});

describe("GraphQL transport — error mapping", () => {
  it("PAYMENT_PENDING_RECONCILIATION -> Aborted + PENDING_RECONCILIATION", async () => {
    responder = () => ok({ errors: [{ message: "PAYMENT_PENDING_RECONCILIATION", extensions: { classification: "accepted", code: "PAYMENT_PENDING_RECONCILIATION" } }], data: { q: null } });
    const t = makeTransport();
    let err: any;
    try {
      await t.createQr(QR_REQ);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TupagoAbortedException);
    expect(err.pendingReconciliation).toBe(true);
    expect(err.message).toContain(PENDING_RECONCILIATION_CODE);
  });

  it("HTTP 401 -> Unauthenticated", async () => {
    responder = () => httpError(401, { errors: [{ message: "unauthorized" }] });
    const t = makeTransport();
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
  });

  it("HTTP 404 -> NotFound", async () => {
    responder = () => httpError(404, { errors: [{ message: "not found" }] });
    const t = makeTransport();
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoNotFoundException);
  });

  it("HTTP 400 -> InvalidArgument", async () => {
    responder = () => httpError(400, { errors: [{ message: "bad request", extensions: { classification: "ValidationError" } }] });
    const t = makeTransport();
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
  });

  it("GraphQL errors (200) with UNAUTHENTICATED classification -> Unauthenticated", async () => {
    responder = () => ok({ errors: [{ message: "u", extensions: { code: "UNAUTHENTICATED" } }] });
    const t = makeTransport();
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
  });

  it("malformed JSON body -> InvalidArgument (fail-closed)", async () => {
    responder = () => ({ status: 200, payload: "{not json" });
    const t = makeTransport();
    await expect(t.getCatalogo("301")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
  });

  it("missing data envelope -> InvalidArgument", async () => {
    responder = () => ok({ errors: [] });
    const t = makeTransport();
    await expect(t.getCatalogo("301")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
  });
});

describe("GraphQL transport — network safety (deterministic retry proofs)", () => {
  // Deterministic, zero-delay retry policy so tests prove ACTUAL attempt counts without real sleeps.
  class ZeroDelayRetry implements RetryPolicy {
    constructor(private max: number) {}
    shouldRetry(attempt: number, e: TupagoException): boolean {
      return e.isRetryable() && attempt < this.max - 1;
    }
    delayMillis(): number {
      return 0;
    }
  }

  function startFlaky(behavior: (count: number) => "destroy" | "respond", body: unknown): { readonly base: string; attempts: () => number; ready: Promise<void>; close: () => void } {
    let count = 0;
    const server = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        count++;
        if (behavior(count) === "destroy") {
          req.socket.destroy();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    let base = "";
    const ready = new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
      resolve();
    }));
    return {
      get base() {
        return base;
      },
      attempts: () => count,
      close: () => server.close(),
      ready,
    } as any;
  }

  const CLIENTE_OK = {
    data: {
      q: {
        cliente: { id: "1", nombre: "X", claveInstitucion: "301", key: "K" },
        catalogoInstitucion: { id: "9", claveInstitucion: "301", nombreCorto: "MEMBER_A" },
      },
    },
  };

  it("READ retries transient network failures and succeeds after N attempts (attempt count == 3)", async () => {
    const srv = startFlaky((n) => (n < 3 ? "destroy" : "respond"), CLIENTE_OK);
    await srv.ready;
    const t = createGraphqlTransport({ target: srv.base, credentials: creds(), readRetryPolicy: new ZeroDelayRetry(3) });
    const r = await t.getCliente(1n);
    expect(srv.attempts()).toBe(3);
    expect(r.cliente?.nombre).toBe("X");
    expect(r.catalogoInstitucion?.nombreCorto).toBe("MEMBER_A");
    srv.close();
  });

  it("READ retry exhaustion surfaces TransientException with policy-defined attempt count (== 3)", async () => {
    const srv = startFlaky(() => "destroy", CLIENTE_OK);
    await srv.ready;
    const t = createGraphqlTransport({ target: srv.base, credentials: creds(), readRetryPolicy: new ZeroDelayRetry(3) });
    let err: any;
    try {
      await t.getCliente(1n);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TupagoTransientException);
    expect(err.isRetryable()).toBe(true);
    expect(srv.attempts()).toBe(3);
    srv.close();
  });

  it("create network failure is NEVER retried (exactly one attempt, UnknownOutcome)", async () => {
    const srv = startFlaky(() => "destroy", CLIENTE_OK);
    await srv.ready;
    const t = createGraphqlTransport({ target: srv.base, credentials: creds() });
    let err: any;
    try {
      await t.createQr(QR_REQ);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TupagoUnknownOutcomeException);
    expect(err.isRetryable()).toBe(false);
    expect(srv.attempts()).toBe(1);
    srv.close();
  });
});
