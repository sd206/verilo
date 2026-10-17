/**
 * Timesheet status machine (6.1), in the `transition(current, event, context)` form the spec asks for.
 * A pair that isn't listed throws InvalidTransitionError; a listed pair whose guard fails throws
 * TransitionGuardError. Guards fail closed: missing context never lets a transition through.
 */
import type { Role } from "../roles";
import { InvalidTransitionError } from "./machine";

export const TIMESHEET_STATUSES = [
  "NOT_STARTED",
  "DRAFT",
  "SUBMITTED",
  "NEEDS_REVIEW",
  "VERIFIED",
  "RETURNED",
  "INVOICED",
] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const TIMESHEET_EVENTS = [
  "save_entries",
  "submit",
  "checks_pass",
  "checks_fail",
  "resolve_all",
  "return",
  "add_to_approved_invoice",
] as const;
export type TimesheetEvent = (typeof TIMESHEET_EVENTS)[number];

export class TransitionGuardError extends Error {
  constructor(
    public readonly from: TimesheetStatus,
    public readonly event: TimesheetEvent,
    message: string,
  ) {
    super(message);
    this.name = "TransitionGuardError";
  }
}

export interface GuardCheck {
  severity: "BLOCK" | "WARN" | "INFO";
  resolved: boolean;
  reason: string | null;
  resolvedByRole: Role | null;
}

export interface TimesheetGuardContext {
  entryCount?: number;
  evidenceCount?: number;
  evidenceRequired?: boolean;
  /** Current check results (after the latest run). */
  checks?: readonly GuardCheck[];
  reason?: string | null;
  onApprovedInvoice?: boolean;
}

const REVIEWER_ROLES: readonly Role[] = ["ADMIN", "MANAGER", "FINANCE"];

type Guard = (ctx: TimesheetGuardContext) => string | null;

const unresolvedBlocks = (ctx: TimesheetGuardContext) =>
  ctx.checks ? ctx.checks.filter((c) => c.severity === "BLOCK" && !c.resolved).length : null;

const hasReason = (r: string | null | undefined) => typeof r === "string" && r.trim().length > 0;

const GUARDS = {
  submit: (ctx) => {
    if (ctx.entryCount === undefined || ctx.evidenceRequired === undefined || ctx.evidenceCount === undefined) {
      return "Can't check this timesheet before submitting";
    }
    if (ctx.entryCount < 1) return "Enter your hours before submitting";
    if (ctx.evidenceRequired && ctx.evidenceCount < 1) return "Attach a screenshot of the approved timesheet before submitting";
    return null;
  },
  checks_pass: (ctx) => {
    const n = unresolvedBlocks(ctx);
    if (n === null) return "Checks haven't run";
    return n === 0 ? null : "There are unresolved blocking checks";
  },
  checks_fail: (ctx) => {
    const n = unresolvedBlocks(ctx);
    if (n === null) return "Checks haven't run";
    return n > 0 ? null : "No blocking checks are open";
  },
  resolve_all: (ctx) => {
    if (!ctx.checks) return "Checks haven't run";
    for (const c of ctx.checks) {
      if (c.severity !== "BLOCK") continue;
      if (!c.resolved) return "Resolve every blocking check first";
      if (!hasReason(c.reason)) return "Every resolved blocking check needs a reason";
      if (!c.resolvedByRole || !REVIEWER_ROLES.includes(c.resolvedByRole)) {
        return "Blocking checks must be resolved by a Manager, Finance or Admin";
      }
    }
    return null;
  },
} satisfies Partial<Record<TimesheetEvent, Guard>>;

const returnGuard =
  (fromVerified: boolean): Guard =>
  (ctx) => {
    if (!hasReason(ctx.reason)) return "Give a reason for returning the timesheet";
    if (fromVerified) {
      if (ctx.onApprovedInvoice === undefined) return "Can't tell whether the timesheet is on an approved invoice";
      if (ctx.onApprovedInvoice) return "This timesheet is on an approved invoice; correct it with an adjustment instead";
    }
    return null;
  };

interface Edge {
  to: TimesheetStatus;
  guard?: Guard;
}

/** The spec table. DRAFT → DRAFT on save_entries is the editor's own save (no status change). */
const TABLE: { [S in TimesheetStatus]: Partial<Record<TimesheetEvent, Edge>> } = {
  NOT_STARTED: { save_entries: { to: "DRAFT" } },
  DRAFT: { save_entries: { to: "DRAFT" }, submit: { to: "SUBMITTED", guard: GUARDS.submit } },
  SUBMITTED: {
    checks_pass: { to: "VERIFIED", guard: GUARDS.checks_pass },
    checks_fail: { to: "NEEDS_REVIEW", guard: GUARDS.checks_fail },
    return: { to: "RETURNED", guard: returnGuard(false) },
  },
  NEEDS_REVIEW: {
    resolve_all: { to: "VERIFIED", guard: GUARDS.resolve_all },
    return: { to: "RETURNED", guard: returnGuard(false) },
  },
  VERIFIED: {
    return: { to: "RETURNED", guard: returnGuard(true) },
    add_to_approved_invoice: { to: "INVOICED" },
  },
  RETURNED: { save_entries: { to: "DRAFT" } },
  INVOICED: {},
};

export function timesheetEventsFrom(status: TimesheetStatus): TimesheetEvent[] {
  return TIMESHEET_EVENTS.filter((e) => TABLE[status][e] !== undefined);
}

export function transitionTimesheet(
  current: TimesheetStatus,
  event: TimesheetEvent,
  context: TimesheetGuardContext = {},
): TimesheetStatus {
  const edge = TABLE[current]?.[event];
  if (!edge) throw new InvalidTransitionError("timesheet", current, event);
  const failure = edge.guard?.(context) ?? null;
  if (failure) throw new TransitionGuardError(current, event, failure);
  return edge.to;
}

/** Entries can change only where save_entries is allowed. */
export function isTimesheetEditable(status: TimesheetStatus): boolean {
  return TABLE[status].save_entries !== undefined;
}

/** INVOICED timesheets are immutable (R4). */
export function isTimesheetLocked(status: TimesheetStatus): boolean {
  return status === "INVOICED";
}

/** Evidence can be added while the timesheet is still being worked on or reviewed. */
export function canAttachEvidence(status: TimesheetStatus): boolean {
  return ["NOT_STARTED", "DRAFT", "RETURNED", "SUBMITTED", "NEEDS_REVIEW"].includes(status);
}
