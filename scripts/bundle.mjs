// Bundles the worker and migrate entry points into single files for the container image.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // pg's optional native binding is never installed.
  external: ["pg-native"],
  banner: {
    // Some CommonJS dependencies call require(); give ESM bundles a require().
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
};

await build({ ...common, entryPoints: ["packages/jobs/src/bin/worker.ts"], outfile: "dist/worker.mjs" });
await build({ ...common, entryPoints: ["packages/jobs/src/bin/migrate.ts"], outfile: "dist/migrate.mjs" });
