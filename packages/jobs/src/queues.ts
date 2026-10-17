/**
 * Job definitions (section 14). Queues are created by the migrate job (as the owner role), because
 * pg-boss creates a partition table per queue. Processors live with the app's server code
 * (apps/web/src/server/jobs) and are registered by the worker entry point.
 */
export const JOB = {
  runExtraction: "run_extraction",
  runTimesheetChecks: "run_timesheet_checks",
  processInboundEmail: "process_inbound_email",
  createPeriodTimesheets: "create_period_timesheets",
  timesheetReminders: "timesheet_reminders",
} as const;
export type JobName = (typeof JOB)[keyof typeof JOB];

export interface JobPayloads {
  run_extraction: { firmId: string; extractionId: string };
  run_timesheet_checks: { firmId: string; timesheetId: string };
  process_inbound_email: { firmId: string; inboundEmailId: string };
  create_period_timesheets: Record<string, never>;
  timesheet_reminders: Record<string, never>;
}

export const QUEUES: readonly JobName[] = Object.values(JOB);

/**
 * Section 14 asks for 01:00 (periods) and 09:00 (reminders) in each firm's time zone. One hourly
 * schedule runs for every firm and acts on firms whose local hour has reached the target; both
 * jobs are idempotent (unique periods; one reminder per timesheet per day), so a missed hour is
 * caught up on the next run.
 */
export const SCHEDULES: readonly { name: JobName; cron: string }[] = [
  { name: JOB.createPeriodTimesheets, cron: "5 * * * *" },
  { name: JOB.timesheetReminders, cron: "15 * * * *" },
];

/** Enqueues jobs. pg-boss in the app; an in-memory queue in tests. */
export interface JobQueue {
  send<K extends JobName>(name: K, data: JobPayloads[K], opts?: { singletonKey?: string }): Promise<void>;
}
