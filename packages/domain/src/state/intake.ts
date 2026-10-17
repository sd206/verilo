import { defineMachine } from "./machine";

/**
 * extraction.status (5.4). QUEUED → RUNNING when a worker claims it; RUNNING → QUEUED only when a
 * crashed attempt is retried. DONE and FAILED are final: a re-read is a new extraction.
 */
export const EXTRACTION_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED"] as const;
export type ExtractionStatusValue = (typeof EXTRACTION_STATUSES)[number];
export const extractionStatusMachine = defineMachine<ExtractionStatusValue>({
  name: "extraction.status",
  states: EXTRACTION_STATUSES,
  initial: "QUEUED",
  transitions: {
    QUEUED: ["RUNNING", "FAILED"],
    RUNNING: ["DONE", "FAILED", "QUEUED"],
    DONE: [],
    FAILED: [],
  },
});

/**
 * inbound_email.status (5.4, section 9). RECEIVED until its attachments are matched; UNMATCHED
 * waits for Finance to assign them (then PROCESSED).
 */
export const INBOUND_EMAIL_STATUSES = ["RECEIVED", "PROCESSED", "UNMATCHED", "REJECTED"] as const;
export type InboundEmailStatus = (typeof INBOUND_EMAIL_STATUSES)[number];
export const inboundEmailMachine = defineMachine<InboundEmailStatus>({
  name: "inbound_email.status",
  states: INBOUND_EMAIL_STATUSES,
  initial: "RECEIVED",
  transitions: {
    RECEIVED: ["PROCESSED", "UNMATCHED", "REJECTED"],
    UNMATCHED: ["PROCESSED"],
    PROCESSED: [],
    REJECTED: [],
  },
});
