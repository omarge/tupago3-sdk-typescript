import * as grpc from "@grpc/grpc-js";
import {
  GetClienteRequest,
  ClientePerfil,
  CatalogoInstitucion,
  GetCatalogoRequest,
  JsonResponse,
  GetStatusRequest,
  CreateQrRequest,
} from "@tupago/tupago3-sdk-typescript";

const SERVICE = "/tupago.api.v1.PaymentService";

function method<I, O>(
  path: string,
  reqEnc: (m: I) => { finish(): Uint8Array },
  reqDec: (b: Uint8Array) => I,
  resEnc: (m: O) => { finish(): Uint8Array },
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

const definition: grpc.ServiceDefinition = {
  GetCliente: method(`${SERVICE}/GetCliente`, GetClienteRequest.encode, GetClienteRequest.decode, ClientePerfil.encode, ClientePerfil.decode),
  GetCatalogo: method(`${SERVICE}/GetCatalogo`, GetCatalogoRequest.encode, GetCatalogoRequest.decode, CatalogoInstitucion.encode, CatalogoInstitucion.decode),
  GetQrStatus: method(`${SERVICE}/GetQrStatus`, GetStatusRequest.encode, GetStatusRequest.decode, JsonResponse.encode, JsonResponse.decode),
  GetTelefonicoStatus: method(`${SERVICE}/GetTelefonicoStatus`, GetStatusRequest.encode, GetStatusRequest.decode, JsonResponse.encode, JsonResponse.decode),
  CreateQr: method(`${SERVICE}/CreateQr`, CreateQrRequest.encode, CreateQrRequest.decode, JsonResponse.encode, JsonResponse.decode),
  CreateTelefonico: method(`${SERVICE}/CreateTelefonico`, CreateQrRequest.encode, CreateQrRequest.decode, JsonResponse.encode, JsonResponse.decode),
};

export async function startMockServer(): Promise<{ server: grpc.Server; port: number }> {
  const server = new grpc.Server();
  server.addService(definition, {
    GetCliente: (call, cb) =>
      cb(null, ClientePerfil.create({ cliente: { id: call.request.id, nombre: "Cliente X", claveInstitucion: "BANX", key: "k" }, catalogoInstitucion: { id: 9n, claveInstitucion: "BANX", nombreCorto: "Banco X" } })),
    GetCatalogo: (call, cb) => cb(null, CatalogoInstitucion.create({ id: 9n, claveInstitucion: call.request.claveInstitucion, nombreCorto: "Banco X" })),
    GetQrStatus: (_c, cb) => cb(null, JsonResponse.create({ json: JSON.stringify({ status: "PAGADO" }) })),
    GetTelefonicoStatus: (_c, cb) => cb(null, JsonResponse.create({ json: JSON.stringify({ status: "PAGADO" }) })),
    CreateQr: (call, cb) => cb(null, JsonResponse.create({ json: JSON.stringify({ folio: "F-1", idempotencyKey: call.request.idempotencyKey }) })),
    CreateTelefonico: (call, cb) => cb(null, JsonResponse.create({ json: JSON.stringify({ folio: "F-2", idempotencyKey: call.request.idempotencyKey }) })),
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, p) => {
      if (err) reject(err);
      else resolve(p);
    });
  });
  server.start();
  return { server, port };
}
