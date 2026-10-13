import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as grpc from "@grpc/grpc-js";
import {
  ChannelSecurity,
  TlsConfig,
  TupagoPaymentClient,
  TupagoUnauthenticatedException,
  CredentialProvider,
} from "../src/index.js";
import { ClientePerfil, GetClienteRequest } from "../src/generated/tupago/api/v1/payment.js";
import { MockPaymentServer, SERVICE_DEFINITION } from "./support/mockServer.js";
import { generateTlsFixture } from "./support/tlsFixture.js";

function provider(): CredentialProvider {
  return { token: () => "jwt" };
}

function providerNull(): CredentialProvider {
  return { token: () => null };
}

let server: MockPaymentServer;
let fixture: ReturnType<typeof generateTlsFixture>;

afterEach(async () => {
  if (server) await server.stop();
});

describe("TLS fail-closed (real handshake)", () => {
  beforeEach(async () => {
    fixture = generateTlsFixture();
    server = new MockPaymentServer({
      credentials: grpc.ServerCredentials.createSsl(null, [
        { private_key: Buffer.from(fixture.keyPem), cert_chain: Buffer.from(fixture.certPem) },
      ]),
    });
    await server.start();
  });

  it("trusting the server cert yields a successful TLS RPC (no plaintext fallback)", async () => {
    const creds = ChannelSecurity.tls(TlsConfig.trustCertChainBytes(Buffer.from(fixture.certPem)));
    const raw = new grpc.Client(server.target, creds);
    const value = await new Promise<ClientePerfil>((resolve, reject) => {
      raw.makeUnaryRequest<Uint8Array, ClientePerfil>(
        SERVICE_DEFINITION.GetCliente!.path,
        (m: Uint8Array) => Buffer.from(m),
        (b: Buffer) => ClientePerfil.decode(new Uint8Array(b)),
        GetClienteRequest.encode({ id: 1n }).finish(),
        new grpc.Metadata(),
        {},
        (err, v) => (err ? reject(err) : resolve(v as ClientePerfil)),
      );
    });
    expect(value.cliente?.id).toBe(1n);
    raw.close();
  });

  it("system trust (no CA) to a self-signed server fails closed", async () => {
    const creds = ChannelSecurity.tls(TlsConfig.systemTrust());
    const raw = new grpc.Client(server.target, creds);
    const err = await new Promise<unknown>((resolve) => {
      raw.makeUnaryRequest<Uint8Array, ClientePerfil>(
        SERVICE_DEFINITION.GetCliente!.path,
        (m: Uint8Array) => Buffer.from(m),
        (b: Buffer) => ClientePerfil.decode(new Uint8Array(b)),
        GetClienteRequest.encode({ id: 1n }).finish(),
        new grpc.Metadata(),
        {},
        (e) => resolve(e),
      );
    });
    expect(err).toBeTruthy();
    raw.close();
  });
});

describe("ChannelSecurity.forTarget rules", () => {
  it("rejects plaintext to non-loopback (gate G8)", () => {
    expect(() => ChannelSecurity.forTarget("10.0.0.5:443")).toThrow();
  });

  it("allows plaintext to loopback", () => {
    expect(() => ChannelSecurity.forTarget("127.0.0.1:50051")).not.toThrow();
  });

  it("requires TLS for non-loopback", () => {
    expect(() => ChannelSecurity.forTarget("api.tupago.example:443", TlsConfig.systemTrust())).not.toThrow();
  });

  it("TlsConfig.trustCertChainFile rejects empty path", () => {
    expect(() => TlsConfig.trustCertChainFile("")).toThrow();
  });

  it("TupagoPaymentClient build for remote without tls throws", () => {
    expect(
      () => new TupagoPaymentClient({ target: "api.tupago.example:443", credentials: provider() }),
    ).toThrow(/TLS required|gate G8/i);
  });

  it("explicit TLS on loopback is honored (no plaintext downgrade)", () => {
    // Regression for F03 TLS-on-loopback: when a TlsConfig is provided, the channel
    // MUST use TLS even on a loopback target. We assert the returned credentials are
    // the SSL/TLS variant (carry a secureContext) and NOT the insecure/plaintext
    // variant. Verification is never disabled.
    const tlsCreds = ChannelSecurity.forTarget("127.0.0.1:29091", TlsConfig.systemTrust());
    const insecureCreds = ChannelSecurity.plaintextLoopback("127.0.0.1:29091");
    expect(tlsCreds).toHaveProperty("secureContext");
    expect(insecureCreds).not.toHaveProperty("secureContext");
  });

  it("missing bearer token surfaces UNAUTHENTICATED without dispatching a request", async () => {
    // Regression for F03-R3: a null/empty token must fail fast with gRPC code
    // UNAUTHENTICATED (mapped to TupagoUnauthenticatedException), and must never send an
    // unauthenticated request to a financial endpoint. No server is contacted.
    const anon = new TupagoPaymentClient({
      target: "127.0.0.1:1",
      credentials: providerNull(),
    });
    await expect(anon.getCatalogo("301")).rejects.toBeInstanceOf(TupagoUnauthenticatedException);
  });

});
