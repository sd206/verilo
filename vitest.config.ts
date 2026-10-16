import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@/": path.resolve(__dirname, "apps/web/src") + "/" };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["packages/**/src/**/*.test.ts", "apps/web/src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          // next-auth imports "next/server" without an extension; let Vite resolve it.
          server: { deps: { inline: ["next-auth", "@auth/core"] } },
          include: ["packages/**/src/**/*.int.test.ts", "apps/web/src/**/*.int.test.ts"],
          exclude: ["**/node_modules/**"],
          environment: "node",
          globalSetup: ["./packages/db/test/global-setup.ts"],
          setupFiles: ["./packages/db/test/setup-env.ts"],
          // One shared database; files run one at a time so the T12 fixtures stay simple.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
