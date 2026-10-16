import { describe, expect, it } from "vitest";
import { isRole, roleRequiresMfa, ROLES } from "./roles";

describe("roles", () => {
  it("recognises the four roles and nothing else", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
    expect(isRole("OWNER")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("requires MFA for ADMIN and FINANCE only", () => {
    expect(roleRequiresMfa("ADMIN")).toBe(true);
    expect(roleRequiresMfa("FINANCE")).toBe(true);
    expect(roleRequiresMfa("MANAGER")).toBe(false);
    expect(roleRequiresMfa("CONSULTANT")).toBe(false);
  });
});
