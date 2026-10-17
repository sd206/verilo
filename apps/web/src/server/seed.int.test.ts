/** M1 acceptance: the 18.1 seed loads, and the engagement and numbering screens show the expected values. */
import { afterAll, describe, expect, it } from "vitest";
import { generateTotp, resolveSession } from "@verilo/auth";
import * as authH from "./handlers/auth";
import * as engagementsH from "./handlers/engagements";
import * as partiesH from "./handlers/parties";
import * as settingsH from "./handlers/settings";
import * as membersH from "./handlers/members";
import { runSeed, SEED_ADMIN_EMAIL } from "./seed";
import { CapturingEmail, closeTestDb, testDeps } from "./testing";

const d = testDeps({ email: new CapturingEmail(false) });
afterAll(closeTestDb);

describe("seed (section 18.1)", () => {
  it("loads, is idempotent, and matches the M1 acceptance values", async () => {
    const r = await runSeed(d, "lonestar-dev-password");
    expect(r.status).toBe("seeded");
    expect((await runSeed(d, "x")).status).toBe("already-seeded");

    // Admin signs in with password + TOTP.
    const s = await authH.signInWithPassword(d, { ip: "10.9.9.9", userAgent: "t" }, { email: SEED_ADMIN_EMAIL, password: "lonestar-dev-password" });
    const pending = await resolveSession(d.db, s.session.token);
    await authH.verifyMfa(d, pending, { code: generateTotp(r.totpSecrets[SEED_ADMIN_EMAIL]!) });
    const auth = (await resolveSession(d.db, s.session.token))!;
    expect(auth.state).toBe("OK");
    const ctx = { sessionId: auth.sessionId, userId: auth.user.id, firmId: auth.firmId!, role: auth.role!, consultantId: null, ip: null, userAgent: null };

    const e1 = await engagementsH.getEngagementDetail(d, ctx, { engagementId: r.ids!.e1 });
    expect(e1.chain.map((n) => n.name)).toEqual(["Initech Corp", "Globex Solutions", "Lonestar Data Consulting", "Apex Talent Inc", "Ravi Kumar"]);
    expect(e1.margin).toMatchObject({ perHour: "$20.00", percent: "21.05%" });
    expect(e1.purchaseOrders[0]).toMatchObject({ poNumber: "GLX-WO-7781", amount: "$60,000.00" });
    const e2 = await engagementsH.getEngagementDetail(d, ctx, { engagementId: r.ids!.e2 });
    expect(e2.billOnly?.bill).toBe("$110.00");

    expect(
      await settingsH.previewInvoiceNumber(d, ctx, { pattern: "{CLIENT}-{YYYY}{MM}-{SEQ:4}", clientPartyId: r.ids!.globex, invoiceDate: "2026-11-01" }),
    ).toEqual({ ok: true, number: "GLBX-202611-0001" });

    const apex = await partiesH.getPartyDetail(d, ctx, { partyId: r.ids!.apex });
    expect(apex.documents.map((x) => [x.docType, x.status]).sort()).toEqual([
      ["COI", "VALID"],
      ["W9", "VALID"],
    ]);
    const globex = await partiesH.getPartyDetail(d, ctx, { partyId: r.ids!.globex });
    expect(globex.party).toMatchObject({ code: "GLBX", paymentTermsDays: 45, paysWhenPaidUpstream: true, upstreamBufferDays: 15, standardDeductionBps: 200, backupRequired: true });

    const { members } = await membersH.listMembers(d, ctx);
    expect(members.map((m) => `${m.email}:${m.role}`).sort()).toEqual([
      "admin@lonestar.test:ADMIN",
      "finance@lonestar.test:FINANCE",
      "manager@lonestar.test:MANAGER",
      "meera@lonestar.test:CONSULTANT",
      "ravi@lonestar.test:CONSULTANT",
    ]);
    expect(members.find((m) => m.email === "ravi@lonestar.test")?.consultantId).toBe(r.ids!.ravi);
  });

  it("refuses to run in staging or production", async () => {
    await expect(runSeed(testDeps({ config: { ...d.config, appEnv: "staging" } }), "x")).rejects.toThrow(/only locally/);
  });
});
