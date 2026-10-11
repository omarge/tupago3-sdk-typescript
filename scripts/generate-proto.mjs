import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projDir = path.resolve(scriptDir, "..");
const protoRoot = path.join(projDir, "proto");
const outDir = path.join(projDir, "src", "generated");
const protoc = path.join(projDir, "node_modules", ".bin", "grpc_tools_node_protoc");
const tsPlugin = path.join(projDir, "node_modules", ".bin", "protoc-gen-ts_proto");

const args = [
  `--plugin=protoc-gen-ts=${tsPlugin}`,
  `-I`, protoRoot,
  `--ts_out=${outDir}`,
  `--ts_opt=esModuleInterop=true`,
  `--ts_opt=outputClientImpl=true`,
  `--ts_opt=forceLong=bigint`,
  `--ts_opt=useOptionals=messages`,
  `tupago/api/v1/payment.proto`,
];

console.log(`[generate-proto] protoc=${protoc}`);
console.log(`[generate-proto] outDir=${outDir}`);
execFileSync(protoc, args, { stdio: "inherit" });
console.log("[generate-proto] OK");
