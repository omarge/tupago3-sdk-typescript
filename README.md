# TUPAGO3 SDK para TypeScript

Cliente gRPC bloqueante/async para el `PaymentService` de TUPAGO3, generado 1:1 desde el contrato Protobuf congelado.

El SDK está destinado a **distribución interna controlada únicamente** — **NO** se publica en ningún registro público y lleva licencia **Propietaria**.

## Operaciones

| RPC | Tipo | Notas |
|-----|------|-------|
| `GetCliente` | lectura | perfil + catálogo de institución |
| `GetCatalogo` | lectura | catálogo por `clave_institucion` |
| `GetQrStatus` | lectura | estatus Banxico (JSON) para QR |
| `GetTelefonicoStatus` | lectura | estatus Banxico (JSON) para telefónico |
| `CreateQr` | **create** | **nunca auto-reintentado** (single-attempt / no-blind-retry) |
| `CreateTelefonico` | **create** | **nunca auto-reintentado** (single-attempt / no-blind-retry) |

## Invariantes financieras

- `CreateQr` / `CreateTelefonico` son intencionalmente **no reintentables**. Un fallo de transporte transitorio en un create se reporta como `TupagoUnknownOutcomeException` y **no** debe reenviarse a ciegas; reutilizar la misma `idempotencyKey` o consultar el estatus.
- No hay garantía de resultado financiero exitoso si la red cae a mitad de un create. El SDK preserva la idempotency key y la señal de unknown-outcome para que el caller reconcilie.

## Estado

**Actualización de estado (2026-10):** gRPC, REST y GraphQL están implementados. El contrato se verifica contra backend3 `bbf06c02`; véase el manual bilingüe y la tabla wire al final.

## Licencia

Propietaria. Distribución interna controlada únicamente.
\n\n---\n\n# Implementation manual / Manual de implementación\n\n## Manual ES — Implementación paso a paso\n\n**Índice:** [1. Requisitos](#manual-es--implementación-paso-a-paso) · [2. Instalación](#manual-es--implementación-paso-a-paso) · [3. Configuración](#manual-es--implementación-paso-a-paso) · [4. Ejemplo](#manual-es--implementación-paso-a-paso) · [5. Contrato C1–C6](#contrato-de-referencia--reference-contract) · [6. Seguridad y errores](#reglas-financieras--financial-safety-rules) · [7. Pruebas y distribución](#pruebas-y-aceptación--testing-and-acceptance)\n\n1. **Requisitos:** TypeScript / npm. Disponer de acceso autorizado a backend3, credenciales JWT válidas y ambiente HTTPS, o laboratorio loopback explícitamente habilitado.\n2. **Instalación:** Use Node.js 22+ as appropriate for the repository's lockfile; `npm ci && npm run typecheck && npm run lint && npm test && npm pack`. Install the generated `tupago-tupago3-sdk-typescript-0.1.0.tgz` in a separate consumer with `npm install /absolute/path/to/package.tgz`. Check `package.json` exports before importing.\n3. **Configuración:** seleccionar el transporte soportado; suministrar endpoint real y JWT mediante variable de entorno o proveedor de credenciales. No usar puertos de laboratorio como defaults productivos.\n4. **Ejemplo de inicio:** ejecutar el ejemplo de abajo con los imports/exports públicos propios del SDK; sustituir los hostnames de ejemplo y consultar primero C5/C6.\n5. **Contrato:** consultar tabla C1–C6; en C3 y C4 conservar `idc` e `idCuenta`, y en C5 exigir perfil compuesto.\n6. **Errores y seguridad:** diferenciar `UnknownOutcome`, `PendingReconciliation`, `NOT_FOUND`, autenticación y permisos. Nunca reintentar creaciones automáticamente.\n7. **Validación:** `npm ci && npm run typecheck && npm run lint && npm test && npm pack`; ESM, CJS, `.d.ts`, C1–C6 exports and JWT/unknown-outcome tests. Excel vendors the **certified exact tarball**, not arbitrary source files.\n\n### Ejemplo / Example (TypeScript / npm)\n\n\`\`\`bash\n# Independent consumer; do not import from src/ or use a workspace link
mkdir -p ../tupago3-ts-consumer && cd ../tupago3-ts-consumer
npm init -y
npm install /absolute/path/to/tupago-tupago3-sdk-typescript-0.1.0.tgz
node -e "console.log(Object.keys(require('@tupago/tupago3-sdk-typescript')))"
# Also test ESM import and TypeScript declarations in separate files.\n\`\`\`\n\n## Manual EN — Step-by-step implementation\n\n**Contents:** [1. Prerequisites](#manual-en--step-by-step-implementation) · [2. Install](#manual-en--step-by-step-implementation) · [3. Configure](#manual-en--step-by-step-implementation) · [4. Example](#manual-en--step-by-step-implementation) · [5. C1–C6 wire contract](#contrato-de-referencia--reference-contract) · [6. Safety and errors](#reglas-financieras--financial-safety-rules) · [7. Verify and distribute](#pruebas-y-aceptación--testing-and-acceptance)\n\n1. **Prerequisites:** TypeScript / npm; authorized backend3 credentials and a TLS-enabled endpoint (or explicitly authorized loopback lab).\n2. **Install:** Use Node.js 22+ as appropriate for the repository's lockfile; `npm ci && npm run typecheck && npm run lint && npm test && npm pack`. Install the generated `tupago-tupago3-sdk-typescript-0.1.0.tgz` in a separate consumer with `npm install /absolute/path/to/package.tgz`. Check `package.json` exports before importing.\n3. **Configure:** choose a supported transport; supply the endpoint and JWT through environment-backed credential providers. Do not copy lab hosts or ports into production.\n4. **Minimal example:** follow the SDK-specific example below. Replace placeholder endpoints and start with a C5/C6 read.\n5. **Contract:** consult the exact C1–C6 wire table. Preserve `idc`/`idCuenta` and require the full composed C5 profile.\n6. **Errors and security:** distinguish unknown financial outcomes, pending reconciliation, not-found and auth/ownership failures. Never automatically replay creates.\n7. **Verification:** `npm ci && npm run typecheck && npm run lint && npm test && npm pack`; ESM, CJS, `.d.ts`, C1–C6 exports and JWT/unknown-outcome tests. Excel vendors the **certified exact tarball**, not arbitrary source files.\n\n## Contrato de referencia / Reference contract

**ES.** Autoridad: backend3 `omarge/tupagoback3` `bbf06c02bda06221b2f214075a4bf2bdf3345eb0`. El JWT determina identidad y alcance de propietario; jamás hardcodear secretos. `idc`, `idCuenta` y claves bancarias son identificadores: conservar su representación y ceros iniciales.

**EN.** Authority: backend3 at the pinned commit above. JWT determines caller identity/ownership. Never hardcode credentials. Preserve IDs and leading zeros; do not coerce long IDs through floating-point numbers.

| Operación / Operation | REST backend3 | GraphQL backend3 | gRPC |
|---|---|---|---|
| C1 CreateQr | `POST /api/payments/msjpagoqrusuario` | `createPagoQr` | `CreateQr` |
| C2 CreateTelefonico | `POST /api/payments/msjpagotelefonicousuario` | `createPagoTelefonico` | `CreateTelefonico` |
| C3 GetQrStatus | `POST /api/payments/estatusmsjqr` JSON `{"idc":"...","idCuenta":42}` | `pagoQrEstatusByCuenta(idc,idCuenta)` | `GetQrStatus` |
| C4 GetTelefonicoStatus | `POST /api/payments/estatusmsjcobrotelefonico` JSON `{"idCuenta":42,"idMsjdeCobro":"..."}` | `pagoTelefonicoEstatusByCuenta(idc,idCuenta)` | `GetTelefonicoStatus` |
| C5 GetCliente | `GET /api/clientes/{id}` **then** `GET /api/catalogo-institucions/clave/{claveInstitucion}` | `getCliente`/equivalent schema query | `GetCliente` |
| C6 GetCatalogo | `GET /api/catalogo-institucions/clave/{clave}` | `catalogoInstitucion` | `GetCatalogo` |

**ES.** En C4, `idMsjdeCobro` corresponde al `idc` público. C5 debe devolver `ClientePerfil` **compuesto**, no solamente el `ClienteDTO`. Los nombres de métodos del SDK pueden diferir de los nombres wire; usar las APIs públicas mostradas abajo.

**EN.** In C4, `idMsjdeCobro` is the public request's `idc`. C5 must return the **composed** `ClientePerfil`, not just `ClienteDTO`. SDK method names and wire operation names may differ.

### Reglas financieras / Financial safety rules

1. **ES:** C1/C2 tienen **un solo intento** por llamada; nunca activar reintentos automáticos de creación. **EN:** C1/C2 are single-attempt; never enable automatic creation retries.
2. **ES:** Guardar la clave de idempotencia original de cada pago. Un timeout, corte de conexión, 5xx, redirección o respuesta de éxito inválida después del posible envío es `UnknownOutcome`: **consultar estado/reconciliar**, no reenviar ciegamente ni generar otra clave. **EN:** Persist the caller-owned idempotency key. Post-dispatch ambiguity is `UnknownOutcome`: reconcile with the original identity, never blindly resend or mint a different key.
3. **ES:** `PendingReconciliation` (REST 202 autorizado, GraphQL `PAYMENT_PENDING_RECONCILIATION`, gRPC `ABORTED` + `TUPAGO_PENDING_RECONCILIATION`) no significa éxito ni autoriza reintento. **EN:** Pending is neither success nor permission to retry.
4. **ES:** C3–C6 son lecturas; sólo los errores transitorios elegibles pueden reintentarse dentro del límite de política. Errores de JWT, permisos, validación, conflicto o inexistencia no. **EN:** Only eligible transient read errors may be retried within a bounded policy; deterministic failures must not.
5. **ES:** TLS con verificación de identidad fuera de loopback; plaintext únicamente en laboratorio local explícito cuando el adaptador lo permita. Tokens sólo por proveedor seguro/entorno. **EN:** Verify TLS identity for remote targets; explicit local loopback lab exceptions only. Never ship lab keys or tokens.
6. **ES:** Backend3/PostgreSQL sigue siendo la autoridad financiera; el SDK no confirma liquidaciones. **EN:** Backend3/PostgreSQL remains the financial authority; an SDK response is not settlement proof.

### Pruebas y aceptación / Testing and acceptance

**ES — Secuencia:** (1) compilar y ejecutar tests, (2) construir paquete exacto, (3) instalarlo en consumidor **fuera del árbol fuente**, (4) probar JWT válido/ausente/inválido y C3–C6 contra backend3 aislado, (5) verificar ownership y `NOT_FOUND`, (6) C1/C2 solamente en sandbox aprobado sin pagos reales, (7) registrar HEAD, CI y SHA256. No afirmar E2E de transportes no probados.

**EN — Sequence:** (1) build and test, (2) produce the exact artifact, (3) install into a separate **out-of-tree** consumer, (4) verify valid/missing/invalid JWT and C3–C6 against an isolated real backend3, (5) verify ownership and typed `NOT_FOUND`, (6) test C1/C2 only in an explicitly approved non-production financial sandbox, (7) record HEAD, CI and SHA256. Do not claim untested transports as E2E-certified.

**Estado / Status:** local and read-only E2E certificates cover their **documented transports**, not production financial writes, Banxico/STP external calls, or real Microsoft Office host validation.
\n