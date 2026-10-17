/** The worker's job table (section 14): each queue's processor, bound to the app's Deps. */
import type { Processors } from "@verilo/jobs";
import type { Deps } from "../deps";
import { runExtractionJob } from "./extraction";
import { processInboundEmailJob } from "./inbound";
import { createPeriodTimesheetsJob, runTimesheetChecksJob, timesheetRemindersJob } from "./scheduled";

export function processors(d: Deps): Processors {
  return {
    run_extraction: (p) => runExtractionJob(d, p),
    run_timesheet_checks: (p) => runTimesheetChecksJob(d, p),
    process_inbound_email: (p) => processInboundEmailJob(d, p),
    create_period_timesheets: async () => void (await createPeriodTimesheetsJob(d)),
    timesheet_reminders: async () => void (await timesheetRemindersJob(d)),
  };
}

/** Tests: run everything queued in a MemoryQueue until it's empty. */
export async function drainJobs(d: Deps, maxRounds = 20): Promise<number> {
  const { MemoryQueue } = await import("@verilo/jobs");
  if (!(d.jobs instanceof MemoryQueue)) throw new Error("drainJobs needs a MemoryQueue");
  const p = processors(d);
  let ran = 0;
  for (let i = 0; i < maxRounds; i++) {
    const batch = d.jobs.take();
    if (batch.length === 0) return ran;
    for (const j of batch) {
      await (p[j.name] as (x: unknown) => Promise<void>)(j.data);
      ran++;
    }
  }
  throw new Error("drainJobs: jobs kept re-queuing");
}
