import { describe, expect, it } from "vitest";
import { defineMachine, InvalidTransitionError } from "./machine";
import { userStatusMachine } from "./user-status";
import { fileScanMachine, isFileViewable } from "./file-scan";

describe("defineMachine", () => {
  it("rejects definitions that target unknown states", () => {
    expect(() =>
      defineMachine<"A" | "B">({
        name: "bad",
        states: ["A", "B"],
        initial: "A",
        transitions: { A: ["C" as "B"], B: [] },
      }),
    ).toThrow(/unknown target state/);
  });

  it("rejects an unknown initial state", () => {
    expect(() =>
      defineMachine<"A">({ name: "bad", states: ["A"], initial: "Z" as "A", transitions: { A: [] } }),
    ).toThrow(/unknown initial state/);
  });

  it("rejects a state without a transitions entry", () => {
    expect(() =>
      defineMachine<"A" | "B">({
        name: "bad",
        states: ["A", "B"],
        initial: "A",
        transitions: { A: [] } as never,
      }),
    ).toThrow(/has no transitions entry/);
  });
});

describe("user.status machine", () => {
  it("allows INVITED → ACTIVE → DISABLED → ACTIVE", () => {
    expect(userStatusMachine.transition("INVITED", "ACTIVE")).toBe("ACTIVE");
    expect(userStatusMachine.transition("ACTIVE", "DISABLED")).toBe("DISABLED");
    expect(userStatusMachine.transition("DISABLED", "ACTIVE")).toBe("ACTIVE");
  });

  it("throws on ACTIVE → INVITED", () => {
    expect(() => userStatusMachine.transition("ACTIVE", "INVITED")).toThrow(InvalidTransitionError);
  });

  it("has no terminal states", () => {
    for (const s of userStatusMachine.states) expect(userStatusMachine.isTerminal(s)).toBe(false);
  });
});

describe("file.scan_status machine", () => {
  it("allows PENDING → CLEAN and PENDING → INFECTED", () => {
    expect(fileScanMachine.canTransition("PENDING", "CLEAN")).toBe(true);
    expect(fileScanMachine.canTransition("PENDING", "INFECTED")).toBe(true);
  });

  it("treats scan results as final", () => {
    expect(fileScanMachine.isTerminal("CLEAN")).toBe(true);
    expect(fileScanMachine.isTerminal("INFECTED")).toBe(true);
    expect(() => fileScanMachine.transition("INFECTED", "CLEAN")).toThrow(InvalidTransitionError);
    expect(() => fileScanMachine.transition("CLEAN", "INFECTED")).toThrow(InvalidTransitionError);
    expect(() => fileScanMachine.transition("CLEAN", "PENDING")).toThrow(InvalidTransitionError);
  });

  it("only CLEAN files are viewable", () => {
    expect(isFileViewable("CLEAN")).toBe(true);
    expect(isFileViewable("PENDING")).toBe(false);
    expect(isFileViewable("INFECTED")).toBe(false);
  });
});

describe("intake machines", async () => {
  const { extractionStatusMachine, inboundEmailMachine } = await import("./intake");
  it("extraction: claim, finish, and retry a crashed run", () => {
    expect(extractionStatusMachine.transition("QUEUED", "RUNNING")).toBe("RUNNING");
    expect(extractionStatusMachine.transition("RUNNING", "DONE")).toBe("DONE");
    expect(extractionStatusMachine.transition("RUNNING", "QUEUED")).toBe("QUEUED");
    expect(() => extractionStatusMachine.transition("DONE", "RUNNING")).toThrow(InvalidTransitionError);
    expect(() => extractionStatusMachine.transition("FAILED", "QUEUED")).toThrow(InvalidTransitionError);
  });
  it("inbound email: unmatched waits for assignment; processed and rejected are final", () => {
    expect(inboundEmailMachine.transition("RECEIVED", "UNMATCHED")).toBe("UNMATCHED");
    expect(inboundEmailMachine.transition("UNMATCHED", "PROCESSED")).toBe("PROCESSED");
    expect(() => inboundEmailMachine.transition("PROCESSED", "UNMATCHED")).toThrow(InvalidTransitionError);
    expect(() => inboundEmailMachine.transition("REJECTED", "PROCESSED")).toThrow(InvalidTransitionError);
  });
});
