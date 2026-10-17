/**
 * Worker runtime (Cloud Run worker pool `worker`, section 24.3): registers processors, installs the
 * schedules, writes a heartbeat every 60 s (24.8), and finishes in-flight jobs on SIGTERM (24.7).
 */
import type { Logger } from "pino";
import { createBoss } from "./boss";
import { QUEUES, SCHEDULES, type JobName, type JobPayloads } from "./queues";

export type Processors = { [K in JobName]: (data: JobPayloads[K]) => Promise<void> };

const HEARTBEAT_MS = 60_000;

export async function runWorker(opts: { databaseUrl: string; processors: Processors; log: Logger }): Promise<void> {
  const { log } = opts;
  const boss = createBoss(opts.databaseUrl, { supervise: true, schedule: true });
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();

  for (const name of QUEUES) {
    const fn = opts.processors[name] as (d: unknown) => Promise<void>;
    await boss.work<object>(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        const started = Date.now();
        try {
          await fn(job.data);
          log.info({ event: "job.done", job: name, job_id: job.id, ms: Date.now() - started }, "job done");
        } catch (err) {
          log.error({ event: "job.failed", job: name, job_id: job.id, err }, "job failed");
          throw err;
        }
      }
    });
  }
  for (const s of SCHEDULES) await boss.schedule(s.name, s.cron, {}, { tz: "UTC" });
  log.info({ queues: QUEUES }, "worker started");

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
