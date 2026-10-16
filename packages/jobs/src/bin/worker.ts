/**
 * Cloud Run worker pool `worker` (section 24.3). Runs pg-boss and writes a heartbeat log
 * line every 60 seconds (section 24.8). Finishes in-flight jobs on SIGTERM (section 24.7).
 */
import { createBoss } from "../boss";
import { createLogger } from "../logger";

const log = createLogger({ service: "worker" });
const HEARTBEAT_MS = 60_000;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const boss = createBoss(url, { supervise: true, schedule: true });
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();
  log.info("worker started");

  // Job handlers are registered here from M2 onward (section 14).

  const beat = () => log.info({ event: "worker.heartbeat" }, "worker.heartbeat");
  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "worker stopping");
    clearInterval(timer);
    await boss.stop({ graceful: true, timeout: 25_000, close: true });
    log.info("worker stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  log.error({ err }, "worker failed to start");
  process.exit(1);
});
