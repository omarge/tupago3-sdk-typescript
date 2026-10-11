import {
  TupagoPaymentClient,
  JsonResponseView,
  PENDING_RECONCILIATION_CODE,
  TupagoUnknownOutcomeException,
} from "@tupago/tupago3-sdk-typescript";
import { startMockServer } from "./mock.js";

async function main(): Promise<void> {
  const { server, port } = await startMockServer();
  const target = `127.0.0.1:${port}`;

  // Dynamic JWT credential provider — never embedded in the SDK.
  const client = new TupagoPaymentClient({
    target,
    credentials: { token: () => "eyJhbGciOiJIUzI1NiJ9.example" },
    deadlineMillis: 5000,
  });

  console.log("[consumer] GetCliente(123n) ...");
  const perfil = await client.getCliente(123n);
  console.log("[consumer]   cliente.id =", perfil.cliente?.id, "(bigint, lossless)");
  if (perfil.cliente?.id !== 123n) throw new Error("int64 fidelity lost");

  console.log("[consumer] GetCatalogo(BANX) ...");
  const cat = await client.getCatalogo("BANX");
  console.log("[consumer]   nombreCorto =", cat.nombreCorto);

  console.log("[consumer] GetQrStatus ...");
  const view: JsonResponseView = await client.getQrStatus("IDC", 55n);
  console.log("[consumer]   json =", view.json());

  console.log("[consumer] CreateQr (idempotency key preserved) ...");
  const created = await client.createQr({
    idCuenta: 77n,
    monto: 150.5,
    concepto: "Pago de prueba",
    referenciaNumerica: 1,
    nombreCliente: "Maria",
    email: "maria@example.com",
    tipoPago: 1,
    vigencia: 60,
    idempotencyKey: "CONSUMER-KEY-001",
  });
  console.log("[consumer]   json =", created.json());
  console.log("[consumer]   pendingReconciliationCode =", PENDING_RECONCILIATION_CODE);
  console.log("[consumer]   UnknownOutcome is non-retryable =", new TupagoUnknownOutcomeException(14, "x").isRetryable() === false);

  client.close();
  server.forceShutdown();
  console.log("[consumer] OK — SDK consumed successfully from an independent project.");
}

main().catch((e) => {
  console.error("[consumer] FAILED:", e);
  process.exit(1);
});
