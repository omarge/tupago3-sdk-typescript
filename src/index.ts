/**
 * TUPAGO3 gRPC TypeScript SDK — controlled internal distribution only.
 *
 * Frozen contract: payment.proto @ backend3 22ad947. Node.js 22+ baseline, TypeScript strict.
 */

export { TupagoPaymentClient } from "./client/TupagoPaymentClient.js";
export { JsonResponseView } from "./client/JsonResponseView.js";
export type { CreateQrParams, CreateTelefonicoParams, CallOptions } from "./client/types.js";

// Transport-neutral contract + REST transport (Phase E). The gRPC transport is the default
// inside TupagoPaymentClient; REST/GraphQL transports plug in via the `transport` option.
export {
  RestPaymentTransport,
  createRestTransport,
} from "./transport/rest.js";
export {
  GrpcPaymentTransport,
} from "./transport/grpc.js";
export {
  GraphqlPaymentTransport,
  createGraphqlTransport,
} from "./transport/graphql.js";
export type {
  PaymentTransport,
  TransportDeps,
} from "./transport/types.js";

export type { CredentialProvider } from "./auth/CredentialProvider.js";
export { BearerCallCredentials } from "./auth/BearerCallCredentials.js";

export { TlsConfig } from "./security/TlsConfig.js";
export { ChannelSecurity } from "./security/ChannelSecurity.js";

export {
  TupagoException,
  TupagoNotFoundException,
  TupagoInvalidArgumentException,
  TupagoPermissionDeniedException,
  TupagoUnauthenticatedException,
  TupagoAlreadyExistsException,
  TupagoFailedPreconditionException,
  TupagoInternalException,
  TupagoTransientException,
  TupagoAbortedException,
  TupagoUnknownOutcomeException,
  StatusMapper,
  PENDING_RECONCILIATION_CODE,
} from "./error/index.js";

export {
  RetryPolicy,
  NoRetryPolicy,
  BackoffRetryPolicy,
} from "./retry/index.js";

// Generated protobuf message types (re-exported for advanced callers). int64 fields are bigint.
// Re-exported as values so callers can build/inspect wire messages (e.g. a mock server).
export {
  GetClienteRequest,
  GetCatalogoRequest,
  GetStatusRequest,
  CreateQrRequest,
  CreateTelefonicoRequest,
  ClientePerfil,
  Cliente,
  CatalogoInstitucion,
  JsonResponse,
} from "./generated/tupago/api/v1/payment.js";
