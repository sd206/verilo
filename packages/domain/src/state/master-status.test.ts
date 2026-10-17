import { describe, expect, it } from "vitest";
import { consultantStatusMachine, engagementStatusMachine } from "./master-status";
import { InvalidTransitionError } from "./machine";

describe("engagement.status", () => {
  it("goes DRAFT → ACTIVE → ENDED and nowhere else", () => {
    expect(engagementStatusMachine.transition("DRAFT", "ACTIVE")).toBe("ACTIVE");
    expect(engagementStatusMachine.transition("ACTIVE", "ENDED")).toBe("ENDED");
    expect(() => engagementStatusMachine.transition("ENDED", "ACTIVE")).toThrow(InvalidTransitionError);
    expect(() => engagementStatusMachine.transition("DRAFT", "ENDED")).toThrow(InvalidTransitionError);
  });
});
describe("consultant.status", () => {
  it("toggles between ACTIVE and INACTIVE", () => {
    expect(consultantStatusMachine.transition("ACTIVE", "INACTIVE")).toBe("INACTIVE");
    expect(consultantStatusMachine.transition("INACTIVE", "ACTIVE")).toBe("ACTIVE");
  });
});
