import { describe, expect, it } from "vitest";
import { metaFromHeaders } from "./context-headers";

describe("metaFromHeaders", () => {
  it("uses the address appended by Google's front end, not client-supplied entries", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "user-agent": "ua" });
    expect(metaFromHeaders(h, 1)).toEqual({ ip: "203.0.113.9", userAgent: "ua" });
  });
  it("skips the load balancer hop when configured", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 35.191.0.1" });
    expect(metaFromHeaders(h, 2).ip).toBe("203.0.113.9");
  });
  it("handles a missing header", () => {
    expect(metaFromHeaders(new Headers(), 1).ip).toBeNull();
  });
});
