import { defineMachine } from "./machine";

/** file.scan_status (section 5.1). A scan result is final. */
export const FILE_SCAN_STATUSES = ["PENDING", "CLEAN", "INFECTED"] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

export const fileScanMachine = defineMachine<FileScanStatus>({
  name: "file.scan_status",
  states: FILE_SCAN_STATUSES,
  initial: "PENDING",
  transitions: {
    PENDING: ["CLEAN", "INFECTED"],
    CLEAN: [],
    INFECTED: [],
  },
});

/** Section 17: a file may be viewed or sent to the AI provider only after a clean scan. */
export function isFileViewable(status: FileScanStatus): boolean {
  return status === "CLEAN";
}
