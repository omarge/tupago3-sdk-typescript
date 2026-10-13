import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import {
  RestPaymentTransport,
  createRestTransport,
  TupagoException,
  TupagoUnauthenticatedException,
  TupagoPermissionDeniedException,
  TupagoNotFoundException,
  TupagoInvalidArgumentException,
  TupagoAlreadyExistsException,
  TupagoInternalException,
  TupagoAbortedException,
  TupagoUnknownOutcomeException,
  TupagoTransientException,
  PENDING_RECONCILIATION_CODE,
  CredentialProvider,
} from "../src/index.js";
import type { ClientePerfil, CatalogoInstitucion } from "../src/generated/tupago/api/v1/payment.js";

interface Captured {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let baseUrl = "";
let lastReq: Captured | null = null;
let requestCount = 0;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastReq = {
          method: req.method ?? "",
          path: req.url ?? "",
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        requestCount++;
        handler(req, res);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

function json(status: number, body: unknown): void {
  handler = (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
}

function raw(status: number, contentType: string, body: string): void {
  handler = (_req, res) => {
    res.writeHead(status, { "content-type": contentType });
    res.end(body);
  };
}

function reject(status: number, type = "about:blank", title = "error", detail = "boom"): void {
  handler = (_req, res) => {
    res.writeHead(status, { "content-type": "application/problem+json" });
    res.end(JSON.stringify({ type, title, detail }));
  };
}

function creds(token: string | null = "eyJ.test.jwt"): CredentialProvider {
  return { token: () => token };
}

function makeTransport(target = baseUrl): RestPaymentTransport {
  return createRestTransport({ target, credentials: creds() });
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
  idempotencyKey: "idem-001",
};
const TEL_REQ = {
  key: "k1",
  monto: 50,
  concepto: "pago",
  referenciaNumerica: 999,
  numeroCelular: "5512345678",
  vigencia: 900,
  idempotencyKey: "idem-002",
};

beforeEach(async () => {
  lastReq = null;
  requestCount = 0;
  await startServer();
});
afterEach(() => {
  server.close();
});

describe("REST transport — reads", () => {
  it("C5 getCliente maps cliente + catalogoInstitucion", async () => {
    json(200, {
      cliente: { id: 1, nombre: "PRODTEST01", claveInstitucion: "123", key: "abc" },
      catalogoInstitucion: { id: 9, claveInstitucion: "123", nombreCorto: "BANCO X" },
    });
    const t = makeTransport();
    const r: ClientePerfil = await t.getCliente(1n);
    expect(lastReq?.method).toBe("GET");
    expect(lastReq?.path).toBe("/api/clientesadd/1");
    expect(r.cliente?.nombre).toBe("PRODTEST01");
    expect(r.catalogoInstitucion?.nombreCorto).toBe("BANCO X");
    expect(lastReq?.headers["authorization"]).toBe("Bearer eyJ.test.jwt");
  });

  it("C6 getCatalogo maps institution", async () => {
    json(200, { id: 9, claveInstitucion: "123", nombreCorto: "BANCO X" });
    const t = makeTransport();
    const r: CatalogoInstitucion = await t.getCatalogo("123");
    expect(lastReq?.path).toBe("/api/catalogo-institucions/clave/123");
    expect(r.claveInstitucion).toBe("123");
    expect(r.nombreCorto).toBe("BANCO X");
  });

  it("C3 getQrStatus POSTs idc and returns JSON view", async () => {
    json(200, [{ estado: "PENDIENTE", idc: "x" }]);
    const t = makeTransport();
    const v = await t.getQrStatus("x", 1n);
    expect(lastReq?.method).toBe("POST");
    expect(lastReq?.path).toBe("/api/payments/estatusmsjqrusuario");
    expect(JSON.parse(lastReq!.body)).toEqual({ idc: "x" });
    expect(Array.isArray(v.parsed())).toBe(true);
  });

  it("C4 getTelefonicoStatus uses idMsjdeCobro wire field", async () => {
    json(200, [{ estado: "PENDIENTE" }]);
    const t = makeTransport();
    const v = await t.getTelefonicoStatus("y", 1n);
    expect(lastReq?.path).toBe("/api/payments/estatusmsjcobrotelefonicousuario");
    expect(JSON.parse(lastReq!.body)).toEqual({ idMsjdeCobro: "y" });
    expect(Array.isArray(v.parsed())).toBe(true);
  });
});

describe("REST transport — creates", () => {
  it("C1 createQr unwraps mensaje and sends Idempotency-Key", async () => {
    json(200, { mensaje: { id: "QR1", cadena: "abc" } });
    const t = makeTransport();
    const v = await t.createQr(QR_REQ);
    expect(lastReq?.method).toBe("POST");
    expect(lastReq?.path).toBe("/api/payments/msjpagoqrusuario");
    expect(lastReq?.headers["idempotency-key"]).toBe("idem-001");
    expect(JSON.parse(lastReq!.body).mensaje === undefined).toBe(true);
    expect(v.json()).toContain("QR1");
  });

  it("C2 createTelefonico sends key and Idempotency-Key", async () => {
    json(200, { id: "T1" });
    const t = makeTransport();
    const v = await t.createTelefonico(TEL_REQ);
    expect(lastReq?.path).toBe("/api/payments/msjpagotelefonicousuario");
    expect(lastReq?.headers["idempotency-key"]).toBe("idem-002");
    expect(JSON.parse(lastReq!.body).key).toBe("k1");
    expect(v.json()).toContain("T1");
  });

  it("reuses a stable idempotency key verbatim across calls", async () => {
    json(200, { mensaje: { id: "QR1" } });
    const t = makeTransport();
    await t.createQr(QR_REQ);
    await t.createQr(QR_REQ);
    expect(lastReq?.headers["idempotency-key"]).toBe("idem-001");
  });
});

describe("REST transport — auth", () => {
  it("missing bearer fails closed before any request", async () => {
    const t = createRestTransport({ target: baseUrl, credentials: creds(null) });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
    expect(requestCount).toBe(0);
  });
});

describe("REST transport — error mapping", () => {
  const cases: Array<[number, new (...a: any[]) => TupagoException, string]> = [
    [401, TupagoUnauthenticatedException, "UNAUTHENTICATED"],
    [403, TupagoPermissionDeniedException, "PERMISSION_DENIED"],
    [404, TupagoNotFoundException, "NOT_FOUND"],
    [400, TupagoInvalidArgumentException, "INVALID_ARGUMENT"],
    [409, TupagoAlreadyExistsException, "ALREADY_EXISTS"],
    [500, TupagoInternalException, "INTERNAL"],
  ];
  for (const [status, ctor, code] of cases) {
    it(`HTTP ${status} -> ${code} on a read`, async () => {
      reject(status);
      const t = makeTransport();
      let err: any;
      try {
        await t.getCliente(1n);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ctor);
    });
  }

  it("HTTP 202 on create -> Aborted + PENDING_RECONCILIATION", async () => {
    raw(202, "application/json", JSON.stringify({ estado: "RECONCILIANDO" }));
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

  it("malformed JSON on success -> InvalidArgument (fail-closed)", async () => {
    raw(200, "application/json", "{not json");
    const t = makeTransport();
    await expect(t.getCatalogo("123")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
  });

  it("empty success payload -> InvalidArgument (requireValue)", async () => {
    json(200, null);
    const t = makeTransport();
    await expect(t.getCatalogo("123")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
  });
});

describe("REST transport — network safety", () => {
  it("read transient failure is retried then surfaces as TransientException", async () => {
    const t = createRestTransport({ target: "http://127.0.0.1:1", credentials: creds() });
    let err: any;
    try {
      await t.getCliente(1n);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TupagoTransientException);
    expect(err.isRetryable()).toBe(true);
  }, 15000);

  it("create network failure is NEVER retried (UnknownOutcome)", async () => {
    const t = createRestTransport({ target: "http://127.0.0.1:1", credentials: creds() });
    let err: any;
    try {
      await t.createQr(QR_REQ);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TupagoUnknownOutcomeException);
    expect(err.isRetryable()).toBe(false);
  }, 15000);
});
