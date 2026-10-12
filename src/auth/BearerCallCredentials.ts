import * as grpc from "@grpc/grpc-js";
import { CredentialProvider } from "./CredentialProvider.js";

/**
 * Attaches the `authorization: Bearer <jwt>` metadata on every RPC, mirroring the backend's
 * `JwtServerInterceptor` expectation (ASCII lowercase key). The token is read at call time so
 * rotation/refresh is transparent and the token is never cached on the channel.
 *
 * Returning a blank token fails the call fast locally with UNAUTHENTICATED (the backend would
 * also reject), so no unauthenticated request ever reaches a financial endpoint.
 */
export class BearerCallCredentials {
  /** Metadata key expected by the backend (ASCII, lowercase). */
  static readonly AUTHORIZATION = "authorization";

  static create(provider: CredentialProvider): grpc.CallCredentials {
    return grpc.credentials.createFromMetadataGenerator((_params, callback) => {
      const token = provider.token();
      if (token == null || token.trim() === "") {
        // Fail fast locally with UNAUTHENTICATED (the backend would also reject), so no
        // unauthenticated request ever reaches a financial endpoint. Surface it as gRPC code
        // UNAUTHENTICATED so the SDK maps it to TupagoUnauthenticatedException.
        const err = new Error("No bearer token supplied by CredentialProvider");
        (err as unknown as { code: number }).code = grpc.status.UNAUTHENTICATED;
        callback(err, undefined);
        return;
      }
      const metadata = new grpc.Metadata();
      metadata.set(BearerCallCredentials.AUTHORIZATION, `Bearer ${token}`);
      callback(null, metadata);
    });
  }
}
