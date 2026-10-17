// Bundles the worker and migrate entry points into single files for the container image.
// Native and asset-carrying packages stay external; dist/package.json lists them (exact versions
// from the workspace) so the Dockerfile installs them next to the bundles.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const versionOf = (pkgJson, name) => JSON.parse(readFileSync(pkgJson, "utf8")).dependencies[name];
const WORKER_EXTERNALS = {
  sharp: versionOf("packages/integrations/ai/package.json", "sharp"),
  "@napi-rs/canvas": versionOf("packages/integrations/ai/package.json", "@napi-rs/canvas"),
  "pdfjs-dist": versionOf("packages/integrations/ai/package.json", "pdfjs-dist"),
  "heic-convert": versionOf("packages/integrations/ai/package.json", "heic-convert"),
  "@node-rs/argon2": versionOf("packages/auth/package.json", "@node-rs/argon2"),
  // google-gax based clients read proto files relative to __dirname, which a bundle breaks.
  "@google-cloud/kms": versionOf("packages/auth/package.json", "@google-cloud/kms"),
  "@google-cloud/storage": versionOf("packages/integrations/storage/package.json", "@google-cloud/storage"),
  "google-auth-library": versionOf("packages/integrations/storage/package.json", "google-auth-library"),
  "@google/genai": versionOf("packages/integrations/ai/package.json", "@google/genai"),
};
mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/package.json",
  JSON.stringify({ name: "verilo-dist", private: true, type: "module", dependencies: WORKER_EXTERNALS }, null, 2) + "\n",
);

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // pg's optional native binding is never installed.
  external: ["pg-native", ...Object.keys(WORKER_EXTERNALS)],
  banner: {
    // Some CommonJS dependencies call require(); give ESM bundles a require().
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: ["apps/web/src/worker.ts"],
  outfile: "dist/worker.mjs",
  alias: { "@": "./apps/web/src" },
});
await build({ ...common, entryPoints: ["packages/jobs/src/bin/migrate.ts"], outfile: "dist/migrate.mjs" });
