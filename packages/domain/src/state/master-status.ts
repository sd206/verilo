import { defineMachine } from "./machine";

/** engagement.status (5.3). */
export const ENGAGEMENT_STATUSES = ["DRAFT", "ACTIVE", "ENDED"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];
export const engagementStatusMachine = defineMachine<EngagementStatus>({
  name: "engagement.status",
  states: ENGAGEMENT_STATUSES,
  initial: "DRAFT",
  transitions: { DRAFT: ["ACTIVE"], ACTIVE: ["ENDED"], ENDED: [] },
});

/** consultant.status (5.3). */
export const CONSULTANT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ConsultantStatus = (typeof CONSULTANT_STATUSES)[number];
export const consultantStatusMachine = defineMachine<ConsultantStatus>({
  name: "consultant.status",
  states: CONSULTANT_STATUSES,
  initial: "ACTIVE",
  transitions: { ACTIVE: ["INACTIVE"], INACTIVE: ["ACTIVE"] },
});
