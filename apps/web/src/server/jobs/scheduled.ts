/** Scheduled jobs (section 14) and run_timesheet_checks. All idempotent (R7). */
import {
  countNotifications,
  firmsForJobs,
  getFirm,
  insertNotificationOnce,
  listEngagementRows,
  listTimesheetsNeedingReminder,
  markNotificationSent,
  withAnonymous,
  withFirm,
} from "@verilo/db";
import { addDays, localDate, localHour, periodLabel } from "@verilo/domain";
import { timesheetReminderEmail } from "@verilo/email";
import type { JobPayloads } from "@verilo/jobs";
import type { Deps } from "../deps";
import { ensureTimesheets, runChecks, type Actor } from "../timesheets/service";

const system = (firmId: string): Actor => ({ firmId, userId: null, role: null });

export async function runTimesheetChecksJob(d: Deps, { firmId, timesheetId }: JobPayloads["run_timesheet_checks"]) {
  await withFirm(d.db, firmId, (tx) => runChecks(tx, system(firmId), timesheetId));
}

/** create_period_timesheets: from 01:00 firm time, NOT_STARTED timesheets for started periods (7.1). */
export async function createPeriodTimesheetsJob(d: Deps, now = new Date()) {
  const firms = await withAnonymous(d.db, (tx) => firmsForJobs(tx));
  let created = 0;
  for (const f of firms) {
    if (localHour(now, f.timezone) < 1) continue;
    created += await withFirm(d.db, f.firmId, async (tx) => {
      const firm = (await getFirm(tx, f.firmId))!;
      return ensureTimesheets(tx, system(f.firmId), firm, await listEngagementRows(tx, f.firmId, { status: "ACTIVE" }), now);
    });
  }
  return { created };
}

export const MAX_REMINDERS = 5;

/**
 * timesheet_reminders: from 09:00 firm time, remind consultants whose timesheet isn't submitted
 * one day after the period ends, then daily, at most 5 times; one per timesheet per day.
 */
export async function timesheetRemindersJob(d: Deps, now = new Date()) {
  const firms = await withAnonymous(d.db, (tx) => firmsForJobs(tx));
  let sent = 0;
  for (const f of firms) {
    if (localHour(now, f.timezone) < 9) continue;
    const today = localDate(now, f.timezone);
    const queued = await withFirm(d.db, f.firmId, async (tx) => {
      const firm = (await getFirm(tx, f.firmId))!;
      const out: { id: string; msg: ReturnType<typeof timesheetReminderEmail> }[] = [];
      for (const t of await listTimesheetsNeedingReminder(tx, f.firmId, addDays(today, -1))) {
        if ((await countNotifications(tx, f.firmId, "timesheet_reminder", t.id)) >= MAX_REMINDERS) continue;
        const to = t.emails[0]!;
        const n = await insertNotificationOnce(tx, f.firmId, {
          toEmail: to,
          type: "timesheet_reminder",
          entityType: "timesheet",
          entityId: t.id,
          channel: "EMAIL",
          dedupeKey: `timesheet_reminder:${t.id}:${today}`,
        });
        if (!n) continue;
        out.push({
          id: n.id,
          msg: timesheetReminderEmail({
            to,
            firmName: firm.displayName,
            consultantName: t.consultantName.split(" ")[0]!,
            period: periodLabel({ start: t.periodStart, end: t.periodEnd }),
            link: `${d.config.baseUrl}/app/timesheets/${t.id}`,
          }),
        });
      }
      return out;
    });
    for (const q of queued) {
      if (!d.email.enabled) continue;
      try {
        await d.email.send(q.msg);
        await withFirm(d.db, f.firmId, (tx) => markNotificationSent(tx, f.firmId, q.id));
        sent++;
      } catch (err) {
        d.log.warn({ err, firm_id: f.firmId }, "reminder email failed");
      }
    }
  }
  return { sent };
}
