import { describe, expect, it } from "vitest";
import { authState, requireFirmContext, sessionCookieName, type AuthContext } from "./session";
import { MfaRequiredError, UnauthenticatedError } from "./errors";

describe("authState", () => {
  const base = { userStatus: "ACTIVE" as const, mfaEnabled: false, mfaVerified: false };

  it("requires MFA setup for ADMIN and FINANCE without MFA", () => {
    expect(authState({ ...base, role: "ADMIN" })).toBe("MFA_SETUP_REQUIRED");
    expect(authState({ ...base, role: "FINANCE" })).toBe("MFA_SETUP_REQUIRED");
  });

  it("lets MANAGER and CONSULTANT in without MFA", () => {
    expect(authState({ ...base, role: "MANAGER" })).toBe("OK");
    expect(authState({ ...base, role: "CONSULTANT" })).toBe("OK");
  });

  it("requires the TOTP step whenever MFA is enabled", () => {
    expect(authState({ ...base, mfaEnabled: true, role: "MANAGER" })).toBe("MFA_REQUIRED");
    expect(authState({ ...base, mfaEnabled: true, mfaVerified: true, role: "ADMIN" })).toBe("OK");
  });

  it("requires MFA setup when the firm's Admin required it for a Manager", () => {
    expect(authState({ ...base, role: "MANAGER", mfaRequiredByFirm: true })).toBe("MFA_SETUP_REQUIRED");
    expect(authState({ ...base, role: "MANAGER", mfaRequiredByFirm: true, mfaEnabled: true, mfaVerified: true })).toBe("OK");
  });

  it("blocks users who are not ACTIVE", () => {
    expect(authState({ ...base, userStatus: "DISABLED", role: "ADMIN" })).toBe("DISABLED");
    expect(authState({ ...base, userStatus: "INVITED", role: "MANAGER" })).toBe("DISABLED");
  });

  it("reports NO_FIRM when the user has no membership in the active firm", () => {
    expect(authState({ ...base, role: null })).toBe("NO_FIRM");
  });
});

describe("requireFirmContext", () => {
  const auth = (over: Partial<AuthContext>): AuthContext => ({
    sessionId: "s",
    expiresAt: new Date(),
    user: { id: "u", email: "a@b.c", name: "A", status: "ACTIVE", mfaEnabled: true },
    firmId: "f",
    role: "ADMIN",
    consultantId: null,
    mfaVerified: true,
    state: "OK",
    ...over,
  });

  it("returns the firm, user and role from the session", () => {
    expect(requireFirmContext(auth({}))).toMatchObject({ firmId: "f", userId: "u", role: "ADMIN" });
  });
  it("throws when not signed in", () => {
    expect(() => requireFirmContext(null)).toThrow(UnauthenticatedError);
  });
  it("throws MfaRequiredError until MFA is done", () => {
    expect(() => requireFirmContext(auth({ state: "MFA_REQUIRED" }))).toThrow(MfaRequiredError);
    expect(() => requireFirmContext(auth({ state: "MFA_SETUP_REQUIRED" }))).toThrow(MfaRequiredError);
  });
  it("throws for NO_FIRM and DISABLED", () => {
    expect(() => requireFirmContext(auth({ state: "NO_FIRM" }))).toThrow(UnauthenticatedError);
    expect(() => requireFirmContext(auth({ state: "DISABLED" }))).toThrow(UnauthenticatedError);
  });
});

describe("session cookie", () => {
  it("uses the __Host- prefix over HTTPS", () => {
    expect(sessionCookieName(true)).toBe("__Host-verilo_session");
    expect(sessionCookieName(false)).toBe("verilo_session");
  });
});
