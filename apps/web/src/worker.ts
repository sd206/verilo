/**
 * Cloud Run worker pool `worker` (section 24.3): runs the section 14 jobs with the app's Deps.
 * Bundled to dist/worker.mjs (scripts/bundle.mjs); APP_ROLE=worker selects it.
 * WORKER_HEALTH_PORT (local and E2E only) answers 200 so a test runner can wait for it.
 */
import { createServer } from "node:http";
import { runWorker } from "@verilo/jobs";
import { deps } from "./server/deps";
import { env } from "./server/env";
import { processors } from "./server/jobs/processors";

const d = deps();
runWorker({ databaseUrl: env().DATABASE_URL, processors: processors(d), log: d.log })
  .then(() => {
    const port = Number(process.env.WORKER_HEALTH_PORT ?? 0);
    if (port) createServer((_, res) => res.end("ok")).listen(port, "127.0.0.1");
  })
  .catch((err: unknown) => {
    d.log.error({ err }, "worker failed to start");
    process.exit(1);
  });
