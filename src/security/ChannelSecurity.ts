import * as grpc from "@grpc/grpc-js";
import { readFileSync } from "node:fs";
import { TlsConfig } from "./TlsConfig.js";

/**
 * Builds gRPC channels with the same FAIL-CLOSED posture as the backend's
 * GrpcTransportSecurity: plaintext is permitted ONLY to a loopback target; any non-loopback
 * target REQUIRES TLS (gate G3/G8). The SDK never opens an unencrypted, off-host financial
 * transport.
 */
export class ChannelSecurity {
  private constructor() {}

  /** @return true if the host resolves to a loopback address (127.0.0.1 / ::1 / localhost). */
  static isLoopback(host: string): boolean {
    if (!host) return false;
    const h = hostOf(host);
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") {
      return true;
    }
    // Defensive: keep it strict; only the well-known literals above are loopback without DNS.
    return false;
  }

  /** Plaintext channel for LOCAL development only (loopback target). Fails closed otherwise. */
  static plaintextLoopback(target: string): grpc.ChannelCredentials {
    if (!ChannelSecurity.isLoopback(hostOf(target))) {
      throw new Error(
        `Plaintext channel refused: target '${target}' is not loopback (gate G8). Use TLS.`,
      );
    }
    return grpc.credentials.createInsecure();
  }

  /** TLS channel credentials for any target (required for non-loopback). */
  static tls(tls: TlsConfig): grpc.ChannelCredentials {
    let rootCerts: Buffer | undefined;
    try {
      if (tls.useSystemTrust) {
        rootCerts = undefined; // createSsl() with no args uses the system trust store
      } else if (tls.trustCertChainBytes) {
        rootCerts = Buffer.from(tls.trustCertChainBytes);
      } else if (tls.trustCertChainPath) {
        rootCerts = Buffer.from(readFileSync(tls.trustCertChainPath));
      } else {
        throw new Error("TlsConfig has no usable trust material");
      }
    } catch (e) {
      throw new Error(`Failed to load TLS trust material: ${(e as Error).message}`);
    }
    // No client certificate: we only verify the server. privateKey/ certChain omitted.
    return grpc.credentials.createSsl(rootCerts);
  }

  /**
   * Convenience: choose transport by target. Loopback -> insecure (local dev); otherwise -> TLS.
   */
  static forTarget(target: string, tls?: TlsConfig): grpc.ChannelCredentials {
    // Explicit TLS configuration is ALWAYS honored, including on loopback. A loopback
    // address must never downgrade an explicitly-requested TLS transport to plaintext
    // (fail-closed: verification is preserved). Verification is never disabled and no
    // loopback exception is introduced.
    if (tls) {
      return ChannelSecurity.tls(tls);
    }
    if (ChannelSecurity.isLoopback(hostOf(target))) {
      return ChannelSecurity.plaintextLoopback(target);
    }
    throw new Error(
      `TLS required for non-loopback target '${target}' (gate G8). Provide a TlsConfig.`,
    );
  }
}

function hostOf(target: string): string {
  if (!target) return "";
  let t = target;
  const schemeIdx = t.indexOf("://");
  if (schemeIdx >= 0) t = t.substring(schemeIdx + 3);
  if (t.startsWith("/")) t = t.substring(1);
  if (t.startsWith("[")) {
    const end = t.indexOf("]");
    return end > 0 ? t.substring(1, end) : t;
  }
  const colon = t.indexOf(":");
  return colon > 0 ? t.substring(0, colon) : t;
}
