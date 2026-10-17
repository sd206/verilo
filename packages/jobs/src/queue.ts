import type { PgBoss } from "pg-boss";
import type { JobName, JobPayloads, JobQueue } from "./queues";

/** Sends through pg-boss. Idempotency: callers pass a singletonKey for one-per-entity jobs (R7). */
export class PgBossQueue implements JobQueue {
  private started: Promise<void> | null = null;
  constructor(private readonly boss: PgBoss) {}

  private start() {
    this.started ??= this.boss.start().then(() => undefined);
    return this.started;
  }

  async send<K extends JobName>(name: K, data: JobPayloads[K], opts: { singletonKey?: string } = {}): Promise<void> {
    await this.start();
    await this.boss.send(name, data, { singletonKey: opts.singletonKey, retryLimit: 3, retryDelay: 30, retryBackoff: true });
  }
}

/** Records jobs for tests, which run them explicitly. */
export class MemoryQueue implements JobQueue {
  readonly jobs: { name: JobName; data: unknown; singletonKey?: string }[] = [];
  async send<K extends JobName>(name: K, data: JobPayloads[K], opts: { singletonKey?: string } = {}): Promise<void> {
    if (opts.singletonKey && this.jobs.some((j) => j.name === name && j.singletonKey === opts.singletonKey)) return;
    this.jobs.push({ name, data, singletonKey: opts.singletonKey });
  }
  take() {
    return this.jobs.splice(0, this.jobs.length);
  }
}
