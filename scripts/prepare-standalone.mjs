// Next's standalone output doesn't include static assets; copy them next to server.js so
// `pnpm --filter @verilo/web start` serves the same thing the container does.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const web = process.cwd();
const target = path.join(web, ".next/standalone/apps/web");
if (existsSync(target)) {
  cpSync(path.join(web, ".next/static"), path.join(target, ".next/static"), { recursive: true });
  cpSync(path.join(web, "public"), path.join(target, "public"), { recursive: true });
}
