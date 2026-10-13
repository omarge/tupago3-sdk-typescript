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

Actualmente solo gRPC. El proto referenciado puede estar desactualizado respecto al anchor actual de backend3 (`bbf06c02`). REST y GraphQL están pendientes.

## Licencia

Propietaria. Distribución interna controlada únicamente.
