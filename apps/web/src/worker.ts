/**
 * Cloud Run worker pool `worker` (section 24.3): runs the section 14 jobs with the app's Deps.
 * Bundled to dist/worker.mjs (scripts/bundle.mjs); APP_ROLE=worker selects it.
 */
import { runWorker } from "@verilo/jobs";
import { deps } from "./server/deps";
import { env } from "./server/env";
import { processors } from "./server/jobs/processors";

const d = deps();
runWorker({ databaseUrl: env().DATABASE_URL, processors: processors(d), log: d.log }).catch((err: unknown) => {
  d.log.error({ err }, "worker failed to start");
  process.exit(1);
});
