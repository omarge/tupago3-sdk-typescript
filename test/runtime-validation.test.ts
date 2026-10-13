import { describe, expect, it } from "vitest";
import * as http from "node:http";
import {
  createRestTransport,
  createGraphqlTransport,
  TupagoInvalidArgumentException,
  CredentialProvider,
} from "../src/index.js";

function creds(): CredentialProvider {
  return { token: () => "eyJ.test.jwt" };
}

function startRest(handler: (url: string) => unknown): { readonly base: string; ready: Promise<void>; close: () => void } {
  const server = http.createServer((req, res) => {
    const body = handler(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  let base = "";
  const ready = new Promise<void>((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    r();
  }));
  return { get base() { return base; }, ready, close: () => server.close() };
}

function startGql(handler: (query: string) => unknown): { readonly base: string; ready: Promise<void>; close: () => void } {
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const q = JSON.parse(b).query as string;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(handler(q)));
    });
  });
  let base = "";
  const ready = new Promise<void>((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    r();
  }));
  return { get base() { return base; }, ready, close: () => server.close() };
}

const CAT_OK = { id: 9, claveInstitucion: "301", nombreCorto: "MEMBER_A" };
const CLIENTE_OK = { cliente: { id: 1, nombre: "X", claveInstitucion: "301", key: "K" }, catalogoInstitucion: CAT_OK };

describe("Runtime fail-closed validation — REST", () => {
  it("getCliente: id defaulted to 0 -> InvalidArgument", async () => {
    const s = startRest(() => ({ cliente: { id: 0 }, catalogoInstitucion: CAT_OK }));
    await s.ready;
    const t = createRestTransport({ target: s.base, credentials: creds() });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCliente: empty nombre -> InvalidArgument", async () => {
    const s = startRest(() => ({ cliente: { id: 1, nombre: "" }, catalogoInstitucion: CAT_OK }));
    await s.ready;
    const t = createRestTransport({ target: s.base, credentials: creds() });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCliente: empty claveInstitucion -> InvalidArgument", async () => {
    const s = startRest(() => ({ cliente: { id: 1, nombre: "X", claveInstitucion: "" }, catalogoInstitucion: CAT_OK }));
    await s.ready;
    const t = createRestTransport({ target: s.base, credentials: creds() });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCliente: valid JSON wrong shape (no cliente) -> InvalidArgument", async () => {
    const s = startRest(() => ({ foo: "bar" }));
    await s.ready;
    const t = createRestTransport({ target: s.base, credentials: creds() });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCatalogo: id defaulted to 0 -> InvalidArgument", async () => {
    const s = startRest(() => ({ id: 0, claveInstitucion: "301", nombreCorto: "Y" }));
    await s.ready;
    const t = createRestTransport({ target: s.base, credentials: creds() });
    await expect(t.getCatalogo("301")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCatalogo: empty claveInstitucion -> InvalidArgument", async () => {
    const s = startRest(() => ({ id: 9, claveInstitucion: "", nombreCorto: "Y" }));
    await s.ready;
    const t = createRestTransport({ target: s.base, credentials: creds() });
    await expect(t.getCatalogo("301")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCatalogo: empty nombreCorto -> InvalidArgument", async () => {
    const s = startRest(() => ({ id: 9, claveInstitucion: "301", nombreCorto: "" }));
    await s.ready;
    const t = createRestTransport({ target: s.base, credentials: creds() });
    await expect(t.getCatalogo("301")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
});

describe("Runtime fail-closed validation — GraphQL", () => {
  const clientEnv = (cliente: unknown, cat: unknown) => ({ data: { q: { cliente, catalogoInstitucion: cat } } });
  it("getCliente: id defaulted to 0 -> InvalidArgument", async () => {
    const s = startGql((q) => (q.includes("cliente(id:$id)") ? clientEnv({ id: 0 }, CAT_OK) : { data: { q: CAT_OK } }));
    await s.ready;
    const t = createGraphqlTransport({ target: s.base, credentials: creds() });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCliente: empty nombre -> InvalidArgument", async () => {
    const s = startGql((q) => (q.includes("cliente(id:$id)") ? clientEnv({ id: "1", nombre: "", claveInstitucion: "301", key: "K" }, CAT_OK) : { data: { q: CAT_OK } }));
    await s.ready;
    const t = createGraphqlTransport({ target: s.base, credentials: creds() });
    await expect(t.getCliente(1n)).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCatalogo: id defaulted to 0 -> InvalidArgument", async () => {
    const s = startGql((q) => (q.includes("catalogoInstitucion") ? { data: { q: { id: 0, claveInstitucion: "301", nombreCorto: "Y" } } } : { data: { q: CLIENTE_OK } }));
    await s.ready;
    const t = createGraphqlTransport({ target: s.base, credentials: creds() });
    await expect(t.getCatalogo("301")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
  it("getCatalogo: empty nombreCorto -> InvalidArgument", async () => {
    const s = startGql((q) => (q.includes("catalogoInstitucion") ? { data: { q: { id: "9", claveInstitucion: "301", nombreCorto: "" } } } : { data: { q: CLIENTE_OK } }));
    await s.ready;
    const t = createGraphqlTransport({ target: s.base, credentials: creds() });
    await expect(t.getCatalogo("301")).rejects.toBeInstanceOf(TupagoInvalidArgumentException);
    s.close();
  });
});
