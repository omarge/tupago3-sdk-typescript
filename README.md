# TUPAGO3 SDK for TypeScript

Blocking/async gRPC client for the TUPAGO3 `PaymentService`, generated **1:1 from the frozen
backend contract** (`payment.proto`, backend3 `22ad947`). The SDK is intended for
**controlled internal distribution only** — it is **NOT published to any public registry** and
carries a **Proprietary** license (see `LICENSE`).

---

## 1. Description and limits

The SDK exposes the six RPCs of the backend `PaymentService`:

| RPC | Kind | Notes |
|-----|------|-------|
| `GetCliente` | read | profile + institution catalog |
| `GetCatalogo` | read | institution catalog by `clave_institucion` |
| `GetQrStatus` | read | Banxico status (JSON) for a QR |
| `GetTelefonicoStatus` | read | Banxico status (JSON) for a telefónico |
| `CreateQr` | **create** | **never auto-retried** |
| `CreateTelefonico` | **create** | **never auto-retried** |

Limits:

- The contract is frozen; the SDK does not add or rename RPCs/fields.
- `CreateQr` / `CreateTelefonico` are intentionally **non-retryable** (gate G4). A transient
  transport failure on a create is surfaced as `TupagoUnknownOutcomeException` and must NOT be
  blind-resubmitted; reuse the same `idempotencyKey` or query status.
- There is **no guaranteed successful financial outcome** if the network drops mid-create. The
  SDK preserves the idempotency key and the unknown-outcome signal so the caller can reconcile.
- No real Banxico/PSP calls are made by the SDK itself; financial creates require a reachable,
  authorized backend in your environment.

## 2. Requirements

- **Minimum: Node.js 22.** Certified on **Node.js 22 and 24** runtimes.
- Build tooling: `npm`, `protoc` (via `grpc-tools`), `ts-proto`, `tsup`.

## 3. Install (internal distribution)

```bash
# From the published internal tarball:
npm install ./tupago3-sdk-typescript-0.1.0.tgz
```

> Public publication (`npm publish` to npmjs.com) is **PROHIBITED** without written authorization.

## 4. TLS configuration (fail-closed)

Plaintext is permitted **only** to a loopback target (`127.0.0.1`, `::1`, `localhost`). Any
non-loopback target **requires** TLS or the client fails closed (gate G8).

```ts
import { TupagoPaymentClient, TlsConfig } from "@tupago/tupago3-sdk-typescript";

// Public CA (system trust store):
const tls = TlsConfig.systemTrust();

// Or an explicit PEM file / in-memory PEM:
// const tls = TlsConfig.trustCertChainFile("/etc/tupago/ca.pem");
// const tls = TlsConfig.trustCertChainBytes(pemBytes);

const client = new TupagoPaymentClient({
  target: "tupago.example.com:443",
  credentials: credentials,   // dynamic JWT provider
  tls,
  deadlineMillis: 10_000,
});
```

There is **no TLS bypass**. To a loopback target you may omit `.tls(...)` and it uses a
plaintext channel (local development only).

## 5. CredentialProvider (dynamic JWT)

The SDK **never embeds credentials** (gate G3). You supply a `CredentialProvider` that returns a
current Bearer JWT per call:

```ts
import { CredentialProvider } from "@tupago/tupago3-sdk-typescript";

const credentials: CredentialProvider = {
  token: () => fetchTokenFromVault(),   // NEVER hard-code the secret here
};
```

The token is attached as an `Authorization: Bearer <jwt>` header on every RPC. Returning `null`
yields `UNAUTHENTICATED` on the next call.

## 6. Secure `GetCatalogo` example

```ts
const cat = await client.getCatalogo("BANX");
console.log(cat.nombreCorto);
```

## 7. Financial create (NoRetry + UnknownOutcome)

```ts
import { TupagoUnknownOutcomeException } from "@tupago/tupago3-sdk-typescript";

try {
  const res = await client.createQr({
    idCuenta: 77n,
    monto: 150.5,
    concepto: "Pago",
    referenciaNumerica: 1,
    nombreCliente: "Maria",
    email: "maria@example.com",
    tipoPago: 1,
    vigencia: 60,
    idempotencyKey: "stable-idempotency-key",
  });
  console.log(res.json());
} catch (e) {
  if (e instanceof TupagoUnknownOutcomeException) {
    // transport dropped mid-create: DO NOT resubmit blindly.
    // reuse the same idempotencyKey or call getQrStatus.
  }
  throw e;
}
```

## 8. Error matrix (seven preserved gRPC states + transient)

| gRPC status | SDK exception | Retryable | Notes |
|-------------|--------------|-----------|-------|
| `UNAUTHENTICATED` | `TupagoUnauthenticatedException` | no | missing/invalid JWT |
| `PERMISSION_DENIED` | `TupagoPermissionDeniedException` | no | |
| `INVALID_ARGUMENT` | `TupagoInvalidArgumentException` | no | |
| `ALREADY_EXISTS` | `TupagoAlreadyExistsException` | no | |
| `FAILED_PRECONDITION` | `TupagoFailedPreconditionException` | no | |
| `NOT_FOUND` | `TupagoNotFoundException` | no | read not found |
| `ABORTED` (+`TUPAGO_PENDING_RECONCILIATION`) | `TupagoAbortedException` | no | reconcile, never resubmit |
| `UNAVAILABLE` / `DEADLINE_EXCEEDED` (read) | `TupagoTransientException` | **yes (reads only)** | |
| `UNAVAILABLE` / `DEADLINE_EXCEEDED` (create) | `TupagoUnknownOutcomeException` | no | blind-resubmit forbidden |
| `INTERNAL` | `TupagoInternalException` | no | |

`TUPAGO_PENDING_RECONCILIATION` is preserved verbatim in the exception `description` and is
machine-detectable via `err.isPendingReconciliation()`.

## 9. Monetary precision (important)

`CreateQr.monto` / `CreateTelefonico.monto` are `double` on the wire (payment.proto). Doubles
cannot represent every decimal fraction exactly. The SDK:

- accepts `number` for `monto`, validates finiteness (`NaN`/`Infinity` rejected), and
- does **not** silently round or re-scale the value.

**Recommendation:** pass integer minor units (centavos) as a `number` (e.g. `15050` for 150.50),
or pre-round to the backend's accepted scale, and validate bounds before calling. int64 fields
(`id`, `idCuenta`) are exposed and serialized as `bigint` end-to-end (no precision loss).

## 10. int64 strategy

All `int64`/`uint64` contract fields are generated with `forceLong=bigint` (ts-proto). They are
exposed as `bigint` in the public API and serialized losslessly over the wire. Never coerce them
to `number` for values that may exceed `Number.MAX_SAFE_INTEGER`.

## 11. Cancellation & deadlines

```ts
const ac = new AbortController();
const p = client.getCliente(1n, { signal: ac.signal, deadlineMillis: 2000 });
setTimeout(() => ac.abort(), 100);
```

## 12. Build / test

```bash
npm install
npm run proto        # regenerate protobuf/grpc-js bindings from proto/
npm run typecheck
npm run lint
npm test
npm run build        # ESM (.mjs) + CJS (.cjs) + .d.ts via tsup
npm pack
```

## 13. Distribution note

This package is **release-ready for controlled internal distribution**. It is **not** published
to npmjs.com and **no public release** is created without express authorization.
