import {
  TupagoPaymentClient,
  TupagoUnauthenticatedException,
  TupagoNotFoundException,
} from "./dist/index.mjs";

const TARGET = process.env.IT_TARGET || "127.0.0.1:9090";
const JWT = process.env.IT_JWT || "";

function provider(token) {
  return { token: () => token };
}

function describeError(e) {
  if (e instanceof TupagoUnauthenticatedException) return { kind: "UNAUTHENTICATED", name: e.constructor.name, code: e.code };
  if (e instanceof TupagoNotFoundException) return { kind: "NOT_FOUND", name: e.constructor.name, code: e.code };
  return { kind: "ERROR", name: e?.constructor?.name || "Error", code: e?.code, message: String(e?.message || e) };
}

async function run(label, fn) {
  try {
    const v = await fn();
    return { label, ok: true, summary: v };
  } catch (e) {
    return { label, ok: false, error: describeError(e) };
  }
}

const valid = new TupagoPaymentClient({ target: TARGET, credentials: provider(JWT), deadlineMillis: 8000 });
const invalid = new TupagoPaymentClient({ target: TARGET, credentials: provider("not.a.valid.jwt.token"), deadlineMillis: 8000 });
const anon = new TupagoPaymentClient({ target: TARGET, credentials: provider(null), deadlineMillis: 8000 });

const results = [];
results.push(await run("getCatalogo-valid-301", async () => {
  const c = await valid.getCatalogo("301");
  return { claveInstitucion: c.claveInstitucion, nombreCorto: c.nombreCorto };
}));
results.push(await run("getCliente-valid-1", async () => {
  const p = await valid.getCliente(1n);
  return { id: p.cliente?.id?.toString?.() ?? String(p.cliente?.id), nombre: p.cliente?.nombre, claveInstitucion: p.cliente?.claveInstitucion, catalogo: p.catalogoInstitucion?.claveInstitucion };
}));
results.push(await run("getCliente-valid-999999-NOTFOUND", async () => {
  await valid.getCliente(999999n);
  return "unexpected-success";
}));
results.push(await run("getQrStatus-valid-NOEXISTE", async () => {
  const r = await valid.getQrStatus("NOEXISTE", 1n);
  return { jsonLen: r.json().length };
}));
results.push(await run("getTelefonicoStatus-valid-NOEXISTE", async () => {
  const r = await valid.getTelefonicoStatus("NOEXISTE", 1n);
  return { jsonLen: r.json().length };
}));
results.push(await run("getCatalogo-invalid-token", async () => {
  await invalid.getCatalogo("301");
  return "unexpected-success";
}));
results.push(await run("getCatalogo-missing-token (client guard)", async () => {
  await anon.getCatalogo("301");
  return "unexpected-success";
}));

valid.close(); invalid.close(); anon.close();

const summary = {
  target: TARGET,
  jwtLen: JWT.length,
  node: process.version,
  ts: new Date().toISOString(),
  results,
};
console.log(JSON.stringify(summary, null, 2));
