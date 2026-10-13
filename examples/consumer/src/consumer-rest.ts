import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RestPaymentTransport, createRestTransport } from "@tupago/tupago3-sdk-typescript";

/**
 * Independent-consumer demonstration of the REST / JSON transport. Mirrors the gRPC consumer
 * but talks to a local mock HTTP server using the same six-method surface. Shows REST works
 * from an external project (ESM + CJS) with no gRPC involvement.
 */
async function main(): Promise<void> {
  const received: Array<{ method: string; path: string; idem?: string }> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method ?? "", path: req.url ?? "", idem: req.headers["idempotency-key"] as string | undefined });
      const ok = (obj: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      switch (req.url) {
        case "/api/clientesadd/1":
          return ok({ cliente: { id: 1, nombre: "PRODTEST01", claveInstitucion: "123", key: "k" }, catalogoInstitucion: { id: 9, claveInstitucion: "123", nombreCorto: "BANCO X" } });
        case "/api/catalogo-institucions/clave/BANX":
          return ok({ id: 9, claveInstitucion: "BANX", nombreCorto: "BANCO X" });
        case "/api/payments/estatusmsjqrusuario":
        case "/api/payments/estatusmsjcobrotelefonicousuario":
          return ok([{ estado: "PENDIENTE" }]);
        case "/api/payments/msjpagoqrusuario":
          return ok({ mensaje: { id: "QR1", cadena: "abc" } });
        case "/api/payments/msjpagotelefonicousuario":
          return ok({ id: "T1" });
        default:
          res.writeHead(404);
          return res.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const transport = createRestTransport({
    target: base,
    credentials: { token: () => "eyJhbGciOiJIUzI1NiJ9.example" },
    deadlineMillis: 5000,
  });

  console.log("[consumer:rest] GetCliente(1n) ...");
  const perfil = await transport.getCliente(1n);
  console.log("[consumer:rest]   cliente.id =", perfil.cliente?.id, "(bigint)");
  if (perfil.cliente?.id !== 1n) throw new Error("int64 fidelity lost over REST");

  console.log("[consumer:rest] GetCatalogo(BANX) ...");
  const cat = await transport.getCatalogo("BANX");
  console.log("[consumer:rest]   nombreCorto =", cat.nombreCorto);

  console.log("[consumer:rest] GetQrStatus ...");
  const view = await transport.getQrStatus("IDC", 55n);
  console.log("[consumer:rest]   json =", view.json());

  console.log("[consumer:rest] CreateQr (idempotency key preserved) ...");
  const created = await transport.createQr({
    idCuenta: 77n,
    monto: 150.5,
    concepto: "Pago de prueba",
    referenciaNumerica: 1,
    nombreCliente: "Maria",
    email: "maria@example.com",
    tipoPago: 1,
    vigencia: 60,
    idempotencyKey: "CONSUMER-REST-KEY-001",
  });
  console.log("[consumer:rest]   json =", created.json());
  const createReq = received.find((r) => r.path === "/api/payments/msjpagoqrusuario");
  if (createReq?.idem !== "CONSUMER-REST-KEY-001") throw new Error("Idempotency-Key not propagated over REST");

  transport.close();
  server.close();
  console.log("[consumer:rest] OK — REST transport consumed successfully from an independent project.");
}

main().catch((e) => {
  console.error("[consumer:rest] FAILED:", e);
  process.exit(1);
});
