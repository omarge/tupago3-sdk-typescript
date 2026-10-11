import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: { resolve: true },
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
  external: ["@grpc/grpc-js", "node:*"],
  tsconfig: "tsconfig.build.json",
});
