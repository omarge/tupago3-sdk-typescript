import * as grpc from "@grpc/grpc-js";
import {
  CatalogoInstitucion,
  ClientePerfil,
  Cliente,
  CreateQrRequest,
  CreateTelefonicoRequest,
  GetCatalogoRequest,
  GetClienteRequest,
  GetStatusRequest,
  JsonResponse,
} from "../../src/generated/tupago/api/v1/payment.js";

export interface CapturedCall {
  method: string;
  request: unknown;
  authorization: string | undefined;
}

export type BehaviorResult =
  | { kind: "response"; json?: string; message?: object }
  | { kind: "error"; code: grpc.status; details: string }
  | { kind: "delay"; ms: number; then: BehaviorResult };

export type MethodBehavior = (req: any, md: grpc.Metadata) => BehaviorResult;

export interface MockServerOptions {
  behaviors?: Partial<Record<string, MethodBehavior>>;
  credentials?: grpc.ServerCredentials;
}


function defaultBehavior(method: string, req: any): BehaviorResult {
  switch (method) {
    case "GetCliente":
      return {
        kind: "response",
        message: ClientePerfil.create({
          cliente: Cliente.create({ id: req.id, nombre: "Juan", claveInstitucion: "BANX", key: "k1" }),
          catalogoInstitucion: CatalogoInstitucion.create({ id: 9n, claveInstitucion: "BANX", nombreCorto: "Banco X" }),
        }),
      };
    case "GetCatalogo":
      return {
        kind: "response",
        message: CatalogoInstitucion.create({ id: 9n, claveInstitucion: req.claveInstitucion, nombreCorto: "Banco X" }),
      };
    case "GetQrStatus":
    case "GetTelefonicoStatus":
      return { kind: "response", json: JSON.stringify({ status: "PAGADO", method }) };
    case "CreateQr":
    case "CreateTelefonico":
      return { kind: "response", json: JSON.stringify({ folio: "F-1", method, idempotencyKey: req.idempotencyKey }) };
    default:
      return { kind: "error", code: grpc.status.UNIMPLEMENTED, details: "unknown method" };
  }
}

export class MockPaymentServer {
  readonly captured: CapturedCall[] = [];
  private server: grpc.Server;
  private behaviors: Partial<Record<string, MethodBehavior>>;
  private credentials: grpc.ServerCredentials | undefined;
  private port = 0;

  constructor(opts: MockServerOptions = {}) {
    this.behaviors = opts.behaviors ?? {};
    this.credentials = opts.credentials;
    this.server = new grpc.Server();
    this.server.addService(SERVICE_DEFINITION, this.buildImplementation());
  }

  get address(): string {
    return `127.0.0.1:${this.port}`;
  }

  /** Loopback target as the SDK expects (host:port). */
  get target(): string {
    return this.address;
  }

  async start(): Promise<void> {
    const creds = this.credentials ?? grpc.ServerCredentials.createInsecure();
    await new Promise<void>((resolve) => {
      this.server.bindAsync("127.0.0.1:0", creds, (err, port) => {
        if (err) throw err;
        this.port = port;
        this.server.start();
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.tryShutdown(() => resolve()));
  }

  private dispatch(method: string, call: grpc.ServerUnaryCall<any, any>): BehaviorResult {
    const behavior = this.behaviors[method];
    const result = behavior ? behavior(call.request, call.metadata) : defaultBehavior(method, call.request);
    this.captured.push({
      method,
      request: call.request,
      authorization: call.metadata.get("authorization")[0] as string | undefined,
    });
    return result;
  }

  private run(result: BehaviorResult, callback: grpc.sendUnaryData<any>): void {
    if (result.kind === "delay") {
      setTimeout(() => this.run(result.then, callback), result.ms);
      return;
    }
    if (result.kind === "error") {
      callback({ code: result.code, details: result.details });
      return;
    }
    if (result.kind === "response") {
      if (result.json !== undefined) {
        callback(null, JsonResponse.create({ json: result.json }));
      } else {
        callback(null, result.message);
      }
    }
  }

  private buildImplementation(): grpc.UntypedServiceImplementation {
    const make = (method: string) => (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      this.run(this.dispatch(method, call), callback);
    };
    return {
      GetCliente: make("GetCliente"),
      GetCatalogo: make("GetCatalogo"),
      GetQrStatus: make("GetQrStatus"),
      GetTelefonicoStatus: make("GetTelefonicoStatus"),
      CreateQr: make("CreateQr"),
      CreateTelefonico: make("CreateTelefonico"),
    };
  }
}

type Encoder<T> = (m: T) => { finish(): Uint8Array };

function unary<I, O>(
  path: string,
  reqEnc: Encoder<I>,
  reqDec: (b: Uint8Array) => I,
  resEnc: Encoder<O>,
  resDec: (b: Uint8Array) => O,
): grpc.MethodDefinition<I, O> {
  return {
    path,
    requestStream: false,
    responseStream: false,
    requestSerialize: (m: I) => Buffer.from(reqEnc(m).finish()),
    requestDeserialize: (b: Buffer) => reqDec(new Uint8Array(b)),
    responseSerialize: (m: O) => Buffer.from(resEnc(m).finish()),
    responseDeserialize: (b: Buffer) => resDec(new Uint8Array(b)),
  };
}

const P = "/tupago.api.v1.PaymentService";
export const SERVICE_DEFINITION: grpc.ServiceDefinition = {
  GetCliente: unary<I, O>(`${P}/GetCliente`, GetClienteRequest.encode, GetClienteRequest.decode, ClientePerfil.encode, ClientePerfil.decode),
  GetCatalogo: unary(`${P}/GetCatalogo`, GetCatalogoRequest.encode, GetCatalogoRequest.decode, CatalogoInstitucion.encode, CatalogoInstitucion.decode),
  GetQrStatus: unary(`${P}/GetQrStatus`, GetStatusRequest.encode, GetStatusRequest.decode, JsonResponse.encode, JsonResponse.decode),
  GetTelefonicoStatus: unary(`${P}/GetTelefonicoStatus`, GetStatusRequest.encode, GetStatusRequest.decode, JsonResponse.encode, JsonResponse.decode),
  CreateQr: unary(`${P}/CreateQr`, CreateQrRequest.encode, CreateQrRequest.decode, JsonResponse.encode, JsonResponse.decode),
  CreateTelefonico: unary(`${P}/CreateTelefonico`, CreateTelefonicoRequest.encode, CreateTelefonicoRequest.decode, JsonResponse.encode, JsonResponse.decode),
};

type I = any;
type O = any;
