import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import {
  TupagoPaymentClient,
  GrpcPaymentTransport,
  createRestTransport,
  createGraphqlTransport,
  TupagoUnauthenticatedException,
  TupagoUnknownOutcomeException,
  ClientePerfil,
  CatalogoInstitucion,
  JsonResponseView,
  CredentialProvider,
} from "../src/index.js";
import { MockPaymentServer } from "./support/mockServer.js";

const CLIENTE_ID = 123n;
const CLAVE = "BANX";
const STATUS_JSON = '{"status":"PAGADO"}';
const CREATE_JSON = '{"folio":"F-1"}';

function clienteKey(p: ClientePerfil) {
  return {
    id: p.cliente?.id?.toString(),
    nombre: p.cliente?.nombre,
    clave: p.cliente?.claveInstitucion,
    catId: p.catalogoInstitucion?.id?.toString(),
    catNombre: p.catalogoInstitucion?.nombreCorto,
  };
}
function catKey(c: CatalogoInstitucion) {
  return { id: c.id?.toString(), clave: c.claveInstitucion, nombre: c.nombreCorto };
}

interface Harness {
  grpcTarget: string;
  restBase: string;
  gqlBase: string;
}

async function startHarness(): Promise<Harness> {
  const grpcServer = new MockPaymentServer({
    behaviors: {
      GetQrStatus: () => ({ kind: "response", json: STATUS_JSON }),
      GetTelefonicoStatus: () => ({ kind: "response", json: STATUS_JSON }),
      CreateQr: () => ({ kind: "response", json: CREATE_JSON }),
      CreateTelefonico: () => ({ kind: "response", json: CREATE_JSON }),
    },
  });
  await grpcServer.start();

  const rest = http.createServer((req, res) => {
    const url = req.url ?? "";
    const send = (obj: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (url.startsWith(`/api/clientesadd/`)) {
      return send({ cliente: { id: 123, nombre: "Juan", claveInstitucion: "BANX", key: "k1" }, catalogoInstitucion: { id: 9, claveInstitucion: "BANX", nombreCorto: "Banco X" } });
    }
    if (url.startsWith("/api/catalogo-institucions/clave/")) {
      return send({ id: 9, claveInstitucion: CLAVE, nombreCorto: "Banco X" });
    }
    if (url === "/api/payments/estatusmsjqrusuario" || url === "/api/payments/estatusmsjcobrotelefonicousuario") {
      return send(JSON.parse(STATUS_JSON));
    }
    if (url === "/api/payments/msjpagoqrusuario") {
      return send({ mensaje: JSON.parse(CREATE_JSON) });
    }
    if (url === "/api/payments/msjpagotelefonicousuario") {
      return send(JSON.parse(CREATE_JSON));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => rest.listen(0, "127.0.0.1", () => r()));
  const restPort = (rest.address() as any).port;

  const gql = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const q = JSON.parse(body).query as string;
      const send = (obj: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (q.includes("cliente(id:$id)")) {
        return send({ data: { q: { cliente: { id: "123", nombre: "Juan", claveInstitucion: "BANX", key: "k1" }, catalogoInstitucion: { id: "9", claveInstitucion: "BANX", nombreCorto: "Banco X" } } } });
      }
      if (q.includes("catalogoInstitucion(claveInstitucion:$c)")) {
        return send({ data: { q: { id: "9", claveInstitucion: "BANX", nombreCorto: "Banco X" } } });
      }
      if (q.includes("pagoQrEstatusByCuenta") || q.includes("pagoTelefonicoEstatusByCuenta")) {
        return send({ data: { q: JSON.parse(STATUS_JSON) } });
      }
      if (q.includes("createPagoQr") || q.includes("createPagoTelefonico")) {
        return send({ data: { q: JSON.parse(CREATE_JSON) } });
      }
      send({ errors: [{ message: "unknown" }] });
    });
  });
  await new Promise<void>((r) => gql.listen(0, "127.0.0.1", () => r()));
  const gqlPort = (gql.address() as any).port;

  return {
    grpcTarget: grpcServer.target,
    restBase: `http://127.0.0.1:${restPort}`,
    gqlBase: `http://127.0.0.1:${gqlPort}`,
    // expose private refs via closure
    _grpc: grpcServer,
    _rest: rest,
    _gql: gql,
  } as Harness & { _grpc: MockPaymentServer; _rest: http.Server; _gql: http.Server };
}

describe("Cross-transport conformance (gRPC == REST == GraphQL)", () => {
  let h: ReturnType<typeof startHarness> extends Promise<infer T> ? T : never;
  const creds: CredentialProvider = { token: () => "valid.jwt" };

  beforeAll(async () => {
    h = (await startHarness()) as any;
  });
  afterAll(async () => {
    const anyH = h as any;
    if (anyH?._grpc) await anyH._grpc.stop();
    if (anyH?._rest) anyH._rest.close();
    if (anyH?._gql) anyH._gql.close();
  });

  function transports() {
    return {
      grpc: new GrpcPaymentTransport({ target: h.grpcTarget, credentials: creds }),
      rest: createRestTransport({ target: h.restBase, credentials: creds }),
      graphql: createGraphqlTransport({ target: h.gqlBase, credentials: creds }),
    };
  }

  it("C5 getCliente produces identical core ClientePerfil on all three transports", async () => {
    const t = transports();
    const [g, r, q] = await Promise.all([t.grpc.getCliente(CLIENTE_ID), t.rest.getCliente(CLIENTE_ID), t.graphql.getCliente(CLIENTE_ID)]);
    const kg = JSON.stringify(clienteKey(g));
    expect(JSON.stringify(clienteKey(r))).toBe(kg);
    expect(JSON.stringify(clienteKey(q))).toBe(kg);
    expect(g.cliente?.id).toBe(CLIENTE_ID);
  });

  it("C6 getCatalogo produces identical core CatalogoInstitucion on all three transports", async () => {
    const t = transports();
    const [g, r, q] = await Promise.all([t.grpc.getCatalogo(CLAVE), t.rest.getCatalogo(CLAVE), t.graphql.getCatalogo(CLAVE)]);
    const kg = JSON.stringify(catKey(g));
    expect(JSON.stringify(catKey(r))).toBe(kg);
    expect(JSON.stringify(catKey(q))).toBe(kg);
  });

  it("C3 getQrStatus yields identical JsonResponseView JSON on all three transports", async () => {
    const t = transports();
    const [g, r, q] = await Promise.all([t.grpc.getQrStatus("IDC", 55n), t.rest.getQrStatus("IDC", 55n), t.graphql.getQrStatus("IDC", 55n)]);
    const expectJson = (v: JsonResponseView) => expect(v.json()).toBe(STATUS_JSON);
    expectJson(g);
    expectJson(r);
    expectJson(q);
  });

  it("C4 getTelefonicoStatus yields identical JsonResponseView JSON on all three transports", async () => {
    const t = transports();
    const [g, r, q] = await Promise.all([t.grpc.getTelefonicoStatus("IDC", 55n), t.rest.getTelefonicoStatus("IDC", 55n), t.graphql.getTelefonicoStatus("IDC", 55n)]);
    const expectJson = (v: JsonResponseView) => expect(v.json()).toBe(STATUS_JSON);
    expectJson(g);
    expectJson(r);
    expectJson(q);
  });

  it("C1 createQr yields identical JsonResponseView JSON on all three transports", async () => {
    const t = transports();
    const req = { idCuenta: 1n, monto: 100, concepto: "p", referenciaNumerica: 1, nombreCliente: "J", email: "a@b.c", tipoPago: 1, vigencia: 60, idempotencyKey: "X-KEY" };
    const [g, r, q] = await Promise.all([t.grpc.createQr(req), t.rest.createQr(req), t.graphql.createQr(req)]);
    const expectJson = (v: JsonResponseView) => expect(v.json()).toBe(CREATE_JSON);
    expectJson(g);
    expectJson(r);
    expectJson(q);
  });

  it("C2 createTelefonico yields identical JsonResponseView JSON on all three transports", async () => {
    const t = transports();
    const req = { key: "k", monto: 50, concepto: "p", referenciaNumerica: 1, numeroCelular: "5512345678", vigencia: 60, idempotencyKey: "X-KEY" };
    const [g, r, q] = await Promise.all([t.grpc.createTelefonico(req), t.rest.createTelefonico(req), t.graphql.createTelefonico(req)]);
    const expectJson = (v: JsonResponseView) => expect(v.json()).toBe(CREATE_JSON);
    expectJson(g);
    expectJson(r);
    expectJson(q);
  });

  it("missing bearer fails closed with UNAUTHENTICATED on all three transports", async () => {
    const noCreds: CredentialProvider = { token: () => null };
    const t = {
      grpc: new GrpcPaymentTransport({ target: h.grpcTarget, credentials: noCreds }),
      rest: createRestTransport({ target: h.restBase, credentials: noCreds }),
      graphql: createGraphqlTransport({ target: h.gqlBase, credentials: noCreds }),
    };
    await expect(t.grpc.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
    await expect(t.rest.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
    await expect(t.graphql.getCliente(1n)).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
  });

  it("create network failure is NEVER retried (UnknownOutcome) on all three transports", async () => {
    const dead = {
      grpc: new GrpcPaymentTransport({ target: "127.0.0.1:1", credentials: creds }),
      rest: createRestTransport({ target: "http://127.0.0.1:1", credentials: creds }),
      graphql: createGraphqlTransport({ target: "http://127.0.0.1:1", credentials: creds }),
    };
    const req = { idCuenta: 1n, monto: 100, concepto: "p", referenciaNumerica: 1, nombreCliente: "J", email: "a@b.c", tipoPago: 1, vigencia: 60, idempotencyKey: "X-KEY" };
    for (const [name, tr] of Object.entries(dead)) {
      let err: any;
      try {
        await tr.createQr(req as any);
      } catch (e) {
        err = e;
      }
      expect(err, `${name} should be UnknownOutcome`).toBeInstanceOf(TupagoUnknownOutcomeException);
      expect(err.isRetryable()).toBe(false);
    }
  });

  it("TupagoPaymentClient (default gRPC) and explicit transports share the same six-method surface", () => {
    const client = new TupagoPaymentClient({ target: h.grpcTarget, credentials: creds });
    const t = transports();
    for (const m of ["getCliente", "getCatalogo", "getQrStatus", "getTelefonicoStatus", "createQr", "createTelefonico", "close"] as const) {
      expect(typeof (client as any)[m]).toBe("function");
      expect(typeof (t.rest as any)[m]).toBe("function");
      expect(typeof (t.graphql as any)[m]).toBe("function");
    }
    client.close();
    t.grpc.close();
    t.rest.close();
    t.graphql.close();
  });
});
