/** membership.role (section 5.1). */
export const ROLES = ["ADMIN", "MANAGER", "FINANCE", "CONSULTANT"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Section 17: MFA is required for ADMIN and FINANCE, optional for others. */
export function roleRequiresMfa(role: Role): boolean {
  return role === "ADMIN" || role === "FINANCE";
}
