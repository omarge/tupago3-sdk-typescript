import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TlsFixture {
  certPem: string;
  keyPem: string;
  certPath: string;
  keyPath: string;
}

/**
 * Generates a throwaway self-signed certificate for 127.0.0.1 / localhost at test time so the
 * repository never stores private keys or secrets (gate G3). The cert is its own trust anchor.
 */
export function generateTlsFixture(): TlsFixture {
  const dir = mkdtempSync(join(tmpdir(), "tupago-tls-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey", "rsa:2048",
    "-nodes",
    "-keyout", keyPath,
    "-out", certPath,
    "-days", "2",
    "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  const keyPem = readFileSync(keyPath, "utf8");
  const certPem = readFileSync(certPath, "utf8");
  return { certPem, keyPem, certPath, keyPath };
}
