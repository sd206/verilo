/**
 * Queue names. Queues are created by the migrate job (as the owner role), because pg-boss
 * creates a partition table per queue. No jobs exist in M0; extraction, email intake,
 * QBO sync, reminders and aging are added in later milestones (section 14).
 */
export const QUEUES: readonly string[] = [];
