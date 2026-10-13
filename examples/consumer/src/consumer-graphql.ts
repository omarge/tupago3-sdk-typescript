import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createGraphqlTransport } from "@tupago/tupago3-sdk-typescript";

/**
 * Independent-consumer demonstration of the GraphQL transport. Talks to a local mock GraphQL
 * server over POST /graphql using variables (idempotency key is a GraphQL argument, not an HTTP
 * header). Shows GraphQL works from an external project (ESM + CJS) with no gRPC involvement.
 */
function envelope(body: { query: string; variables: Record<string, unknown> }): unknown {
  const q = body.query;
  if (q.includes("cliente(id:$id)")) {
    return { data: { q: { cliente: { id: "1", nombre: "PRODTEST01", claveInstitucion: "301", key: "K" }, catalogoInstitucion: { id: "1502", claveInstitucion: "301", nombreCorto: "MEMBER_A" } } } };
  }
  if (q.includes("catalogoInstitucion(claveInstitucion:$c)")) {
    return { data: { q: { id: "9", claveInstitucion: "301", nombreCorto: "MEMBER_A" } } };
  }
  if (q.includes("pagoQrEstatusByCuenta")) {
    return { data: { q: [{ estado: "PENDIENTE" }] } };
  }
  if (q.includes("pagoTelefonicoEstatusByCuenta")) {
    return { data: { q: [{ estado: "PENDIENTE" }] } };
  }
  if (q.includes("createPagoQr")) {
    if (body.variables.k === "RECONCILE") {
      return { errors: [{ message: "PAYMENT_PENDING_RECONCILIATION", extensions: { classification: "accepted", code: "PAYMENT_PENDING_RECONCILIATION" } }], data: { q: null } };
    }
    return { data: { q: { id: "QR1", cadena: "abc" } } };
  }
  if (q.includes("createPagoTelefonico")) {
    return { data: { q: { id: "T1" } } };
  }
  return { errors: [{ message: "unknown" }] };
}

async function main(): Promise<void> {
  const received: Array<{ k?: string }> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      received.push({ k: parsed.variables?.k });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(envelope(parsed)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const transport = createGraphqlTransport({
    target: base,
    credentials: { token: () => "eyJhbGciOiJIUzI1NiJ9.example" },
    deadlineMillis: 5000,
  });

  console.log("[consumer:graphql] GetCliente(1n) ...");
  const perfil = await transport.getCliente(1n);
  console.log("[consumer:graphql]   cliente.id =", perfil.cliente?.id, "(bigint)");
  if (perfil.cliente?.id !== 1n) throw new Error("int64 fidelity lost over GraphQL");

  console.log("[consumer:graphql] GetCatalogo(301) ...");
  const cat = await transport.getCatalogo("301");
  console.log("[consumer:graphql]   nombreCorto =", cat.nombreCorto);

  console.log("[consumer:graphql] GetQrStatus ...");
  const view = await transport.getQrStatus("IDC", 55n);
  console.log("[consumer:graphql]   json =", view.json());

  console.log("[consumer:graphql] CreateQr (idempotency key = GraphQL variable) ...");
  const created = await transport.createQr({
    idCuenta: 77n,
    monto: 150.5,
    concepto: "Pago de prueba",
    referenciaNumerica: 1,
    nombreCliente: "Maria",
    email: "maria@example.com",
    tipoPago: 1,
    vigencia: 60,
    idempotencyKey: "CONSUMER-GQL-KEY-001",
  });
  console.log("[consumer:graphql]   json =", created.json());
  const createReq = received.find((r) => r.k === "CONSUMER-GQL-KEY-001");
  if (!createReq) throw new Error("Idempotency key not propagated as GraphQL variable");

  transport.close();
  server.close();
  console.log("[consumer:graphql] OK — GraphQL transport consumed successfully from an independent project.");
}

main().catch((e) => {
  console.error("[consumer:graphql] FAILED:", e);
  process.exit(1);
});
