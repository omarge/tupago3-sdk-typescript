/**
 * Operator-supplied TLS material for a non-loopback gRPC target. No secret is ever embedded in
 * the SDK or repo (gate G3); paths/certificates are provided at runtime by the calling
 * application (file path or in-memory PEM).
 */
export class TlsConfig {
  readonly trustCertChainPath?: string;
  readonly trustCertChainBytes?: Uint8Array;
  readonly useSystemTrust: boolean;

  private constructor(opts: {
    trustCertChainPath?: string;
    trustCertChainBytes?: Uint8Array;
    useSystemTrust: boolean;
  }) {
    this.trustCertChainPath = opts.trustCertChainPath;
    this.trustCertChainBytes = opts.trustCertChainBytes;
    this.useSystemTrust = opts.useSystemTrust;
  }

  /** Use the runtime's default CA trust store (typical for public CAs). */
  static systemTrust(): TlsConfig {
    return new TlsConfig({ useSystemTrust: true });
  }

  /** Trust an explicit PEM certificate chain file. */
  static trustCertChainFile(path: string): TlsConfig {
    if (!path) throw new Error("trustCertChainFile requires a non-empty path");
    return new TlsConfig({ trustCertChainPath: path, useSystemTrust: false });
  }

  /** Trust an explicit PEM certificate chain supplied in memory. */
  static trustCertChainBytes(bytes: Uint8Array): TlsConfig {
    if (!bytes || bytes.length === 0) throw new Error("trustCertChainBytes requires non-empty bytes");
    return new TlsConfig({ trustCertChainBytes: bytes, useSystemTrust: false });
  }
}
