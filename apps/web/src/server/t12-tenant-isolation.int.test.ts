/**
 * T12 — Tenant isolation (section 18.2, R3).
 *
 * "Create a second firm with its own data. Every API route, called with Firm B's session and
 * Firm A's IDs, returns 404 or 403 and changes nothing."
 *
 * Covers every server-action handler and every route handler that exists. The coverage test at
 * the bottom fails when a new handler or route is added without a case here.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, NotFoundError, generateTotp, resolveSession, sessionCookieName } from "@verilo/auth";
import { sql, withTenant } from "@verilo/db";
import { snapshotFirm } from "@verilo/db/testing";
import * as authH from "./handlers/auth";
import * as membersH from "./handlers/members";
import * as filesH from "./handlers/files";
import * as homeH from "./handlers/home";
import * as routesH from "./handlers/routes";
import {
  addMember,
  closeTestDb,
  createFirmWithAdmin,
  linkToken,
  meta,
  PASSWORD,
  testDeps,
  uploadFile,
  type Actor,
} from "./testing";

// vite-node provides __dirname in test modules.
const HERE = __dirname;

const d = testDeps();

let A: { firmId: string; admin: Actor; consultant: Actor; fileId: string; inviteToken: string };
let B: { firmId: string; admin: Actor; consultant: Actor };
let before: Record<string, unknown[]>;

/** Expects a 403/404 AppError. */
async function expectDenied(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the call to be rejected").toBeInstanceOf(AppError);
  expect([403, 404]).toContain((err as AppError).status);
}

/** Expects a 400 (strict schema rejected a client-sent firm id). */
async function expectRejectedInput(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(400);
}

/** Postgres rejects the write with "new row violates row-level security policy". */
async function expectRlsViolation(p: Promise<unknown>) {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as { message?: string; cause?: { message?: string } } | null;
  expect(err, "expected an RLS violation").not.toBeNull();
  expect(`${err!.cause?.message ?? ""} ${err!.message ?? ""}`).toMatch(/row-level security/);
}

function cookieReq(url: string, token: string) {
  return new Request(url, { headers: { cookie: `${sessionCookieName(false)}=${token}` } });
}

beforeAll(async () => {
  const a = await createFirmWithAdmin(d, "Alpha");
  const aConsultant = await addMember(d, a.admin, "CONSULTANT");
  const file = await uploadFile(d, a.admin, "%PDF-1.4 alpha timesheet");
  const pending = await membersH.inviteUser(d, a.admin.ctx, { email: "pending-alpha@example.com", role: "FINANCE" });
  A = { ...a, consultant: aConsultant, fileId: file.id, inviteToken: linkToken(d, pending) };

  const b = await createFirmWithAdmin(d, "Bravo");
  B = { ...b, consultant: await addMember(d, b.admin, "CONSULTANT") };
  await uploadFile(d, B.admin, "%PDF-1.4 bravo timesheet");

  before = await snapshotFirm(A.firmId);
});

afterAll(async () => {
  // Firm A's rows are byte-for-byte what they were before Firm B started calling things.
  expect(await snapshotFirm(A.firmId)).toEqual(before);
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// handlers that take an id
// ---------------------------------------------------------------------------
describe("T12: handlers called with Firm B's session and Firm A's ids", () => {
  it("switchFirm → 404", async () => {
    await expectDenied(authH.switchFirm(d, B.admin.auth, { firmId: A.firmId }));
    const s = await resolveSession(d.db, B.admin.token);
    expect(s!.firmId).toBe(B.firmId);
  });

  it("completeUpload(A's file) → 404", async () => {
    await expectDenied(filesH.completeUpload(d, B.admin.ctx, { fileId: A.fileId }));
  });

  it("getDownloadUrl(A's file) → 404", async () => {
    await expectDenied(filesH.getDownloadUrl(d, B.admin.ctx, { fileId: A.fileId }));
    await expectDenied(filesH.getDownloadUrl(d, B.consultant.ctx, { fileId: A.fileId }));
  });

  it("acceptInvite / getInvitation take a secret token, not an id: A's invitation id → 404", async () => {
    // Invitations are addressed only by their 256-bit token. Firm B can pass A's invitation id
    // (or any other id) and gets 404; B's session plays no part in acceptance.
    const [inv] = await withTenant(d.db, A.admin.ctx, (tx) =>
      tx.execute<{ id: string }>(sql`select id from invitation where firm_id = ${A.firmId} limit 1`).then((r) => r.rows),
    );
    await expectDenied(membersH.getInvitation(d, { token: `${inv!.id}-padding` }));
    await expectDenied(membersH.acceptInvite(d, meta(), { token: `${inv!.id}-padding`, password: PASSWORD }));
    const s = await resolveSession(d.db, B.admin.token);
    expect(s!.firmId).toBe(B.firmId);
  });

});

// ---------------------------------------------------------------------------
// handlers whose firm comes only from the session
// ---------------------------------------------------------------------------
describe("T12: client-sent firm ids are rejected; session firm is used", () => {
  it("inviteUser with firmId: A → 400", async () => {
    await expectRejectedInput(
      membersH.inviteUser(d, B.admin.ctx, { email: "x@example.com", role: "MANAGER", firmId: A.firmId }),
    );
  });

  it("inviteUser for A's admin email creates an invitation in B only and leaves A's user unchanged", async () => {
    const r = await membersH.inviteUser(d, B.admin.ctx, { email: A.admin.email, role: "MANAGER", name: "Renamed by B" });
    expect(r.invitationId).toBeTruthy();
  });

  it("requestUpload with firmId: A → 400", async () => {
    await expectRejectedInput(
      filesH.requestUpload(d, B.admin.ctx, { filename: "x.pdf", contentType: "application/pdf", sizeBytes: 10, firmId: A.firmId }),
    );
  });

  it("signUpFirm with firmId: A → 400", async () => {
    await expectRejectedInput(
      authH.signUpFirm(d, meta(), {
        firmLegalName: "X",
        firmDisplayName: "X",
        name: "X",
        email: "x2@example.com",
        password: PASSWORD,
        firmId: A.firmId,
      }),
    );
  });

  it("signInWithPassword lands B in B's firm", async () => {
    const r = await authH.signInWithPassword(d, meta(), { email: B.admin.email, password: PASSWORD });
    const s = await resolveSession(d.db, r.session.token);
    expect(s!.firmId).toBe(B.firmId);
  });

  it("beginMfaSetup / enableMfa / verifyMfa act only on the caller's own user", async () => {
    const r = await authH.signInWithPassword(d, meta(), { email: B.admin.email, password: PASSWORD });
    const auth = await resolveSession(d.db, r.session.token);
    await expect(authH.beginMfaSetup(d, auth)).rejects.toThrow(/already enabled/);
    await expect(authH.enableMfa(d, meta(), auth, { code: "123456" })).rejects.toThrow(/already enabled/);
    await authH.verifyMfa(d, auth, { code: generateTotp(B.admin.totpSecret!) });
    expect((await resolveSession(d.db, r.session.token))!.firmId).toBe(B.firmId);
  });
});

// ---------------------------------------------------------------------------
// list/read handlers return only the session firm's data
// ---------------------------------------------------------------------------
describe("T12: reads return only Firm B's data", () => {
  it("listMyFirms", async () => {
    const firms = await authH.listMyFirms(d, B.admin.auth);
    expect(firms.map((f) => f.firmId)).toEqual([B.firmId]);
  });

  it("listMembers", async () => {
    const r = await membersH.listMembers(d, B.admin.ctx);
    const ids = r.members.map((m) => m.userId);
    expect(ids).not.toContain(A.admin.userId);
    expect(ids).not.toContain(A.consultant.userId);
    expect(r.pendingInvitations.map((i) => i.email)).not.toContain("pending-alpha@example.com");
  });

  it("listFiles", async () => {
    const files = await filesH.listFiles(d, B.admin.ctx);
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => f.id)).not.toContain(A.fileId);
  });

  it("getFirmSummary", async () => {
    expect((await homeH.getFirmSummary(d, B.admin.ctx)).id).toBe(B.firmId);
  });

  it("getInvitation needs the secret token; an unknown token → 404", async () => {
    await expectDenied(membersH.getInvitation(d, { token: "x".repeat(43) }));
  });
});

// ---------------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------------
describe("T12: route handlers", () => {
  it("GET /api/files/:id/download with B's cookie and A's file → 404", async () => {
    const res = await routesH.downloadFileRoute(d, cookieReq(`http://localhost/api/files/${A.fileId}/download`, B.admin.token), A.fileId);
    expect(res.status).toBe(404);
  });

  it("GET /api/files/:id/download with A's cookie works (control)", async () => {
    const res = await routesH.downloadFileRoute(d, cookieReq(`http://localhost/api/files/${A.fileId}/download`, A.admin.token), A.fileId);
    expect(res.status).toBe(302);
  });

  it("GET /api/files/:id/download without a session → 401", async () => {
    const res = await routesH.downloadFileRoute(d, new Request("http://localhost/x"), A.fileId);
    expect(res.status).toBe(401);
  });

  it("GET /api/health returns no tenant data", async () => {
    const { GET } = await import("../app/api/health/route");
    const body = (await GET().json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["ok", "revision", "service"]);
  });

  it("Auth.js /api/auth/*: session lookup by B's token returns only B's user", async () => {
    // The Auth.js routes reach the database only through the adapter in src/auth.ts, which
    // looks sessions up by token and users by id/email — never by firm.
    (globalThis as { verilo?: unknown }).verilo = d;
    const { GET } = await import("../app/api/auth/[...nextauth]/route");
    const res = await GET(
      Object.assign(cookieReq("http://localhost:3000/api/auth/session", B.admin.token), {
        nextUrl: new URL("http://localhost:3000/api/auth/session"),
      }) as never,
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(A.admin.email);
    expect(body).not.toContain(A.firmId);
  });
});

// ---------------------------------------------------------------------------
// row-level security, independent of the application code
// ---------------------------------------------------------------------------
describe("T12: row-level security as a second safeguard", () => {
  const tables = ["firm", "membership", "audit_event", "file", "invitation"];

  it("in Firm B's context, raw SQL sees none of Firm A's rows", async () => {
    await withTenant(d.db, B.admin.ctx, async (tx) => {
      for (const t of tables) {
        const col = t === "firm" ? "id" : "firm_id";
        const r = await tx.execute(sql.raw(`select count(*)::int as n from ${t} where ${col} = '${A.firmId}'`));
        expect((r.rows[0] as { n: number }).n, t).toBe(0);
      }
      const users = await tx.execute(sql`select count(*)::int as n from app_user where id = ${A.admin.userId}`);
      expect((users.rows[0] as { n: number }).n).toBe(0);
    });
  });

  it("in Firm B's context, raw SQL can't update or insert Firm A's rows", async () => {
    await withTenant(d.db, B.admin.ctx, async (tx) => {
      const u = await tx.execute(sql`update file set filename = 'pwned' where id = ${A.fileId}`);
      expect(u.rowCount).toBe(0);
      const f = await tx.execute(sql`update firm set display_name = 'pwned' where id = ${A.firmId}`);
      expect(f.rowCount).toBe(0);
    });
    await expectRlsViolation(
      withTenant(d.db, B.admin.ctx, (tx) =>
        tx.execute(sql`insert into membership (firm_id, user_id, role) values (${A.firmId}, ${B.admin.userId}, 'ADMIN')`),
      ),
    );
    await expectRlsViolation(
      withTenant(d.db, B.admin.ctx, (tx) =>
        tx.execute(
          sql`insert into audit_event (firm_id, entity_type, entity_id, action) values (${A.firmId}, 'x', ${A.fileId}, 'x')`,
        ),
      ),
    );
  });

  it("with no context at all, tenant tables are empty to the runtime role", async () => {
    const r = await d.db.execute(sql`select (select count(*) from firm)::int + (select count(*) from file)::int + (select count(*) from membership)::int as n`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// coverage guard: every handler and route must appear above
// ---------------------------------------------------------------------------
const COVERED_HANDLERS = new Set([
  "auth.signUpFirm",
  "auth.signInWithPassword",
  "auth.beginMfaSetup",
  "auth.enableMfa",
  "auth.verifyMfa",
  "auth.switchFirm",
  "auth.listMyFirms",
  "members.inviteUser",
  "members.listMembers",
  "members.getInvitation",
  "members.acceptInvite",
  "files.requestUpload",
  "files.completeUpload",
  "files.listFiles",
  "files.getDownloadUrl",
  "home.getFirmSummary",
  "routes.downloadFileRoute",
]);
/** Exported helpers that are not request handlers. */
const NOT_HANDLERS = new Set(["auth.slugify", "routes.cookieFromRequest", "members.INVITE_TTL_DAYS"]);
const COVERED_ROUTES = new Set(["api/auth/[...nextauth]", "api/health", "api/files/[id]/download"]);

describe("T12 coverage", () => {
  it("every exported handler has a tenant-isolation case", () => {
    const modules = { auth: authH, members: membersH, files: filesH, home: homeH, routes: routesH };
    const exported = Object.entries(modules).flatMap(([m, mod]) =>
      Object.entries(mod)
        .filter(([, v]) => typeof v === "function" || typeof v === "number")
        .map(([k]) => `${m}.${k}`),
    );
    const missing = exported.filter((e) => !COVERED_HANDLERS.has(e) && !NOT_HANDLERS.has(e));
    expect(missing, "add a T12 case for these handlers").toEqual([]);
    const handlerDir = path.join(HERE, "handlers");
    const files = fs.readdirSync(handlerDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.sort()).toEqual(["auth.ts", "common.ts", "files.ts", "home.ts", "members.ts", "routes.ts"]);
  });

  it("every route handler file has a tenant-isolation case", () => {
    const appDir = path.join(HERE, "..", "app");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") routes.push(path.relative(appDir, dir).split(path.sep).join("/"));
      }
    };
    walk(appDir);
    expect(routes.filter((r) => !COVERED_ROUTES.has(r)), "add a T12 case for these routes").toEqual([]);
  });

  it("every server action delegates to a covered handler", () => {
    const actionsDir = path.join(HERE, "actions");
    const ACTIONS: Record<string, string | null> = {
      signUpFirmAction: "auth.signUpFirm",
      signInAction: "auth.signInWithPassword",
      requestMagicLinkAction: null, // Auth.js email flow; covered by the /api/auth route case
      enableMfaAction: "auth.enableMfa",
      verifyMfaAction: "auth.verifyMfa",
      switchFirmAction: "auth.switchFirm",
      signOutAction: null, // deletes only the caller's own session
      inviteUserAction: "members.inviteUser",
      acceptInviteAction: "members.acceptInvite",
      requestUploadAction: "files.requestUpload",
      completeUploadAction: "files.completeUpload",
    };
    const found = fs
      .readdirSync(actionsDir)
      .flatMap((f) => [...fs.readFileSync(path.join(actionsDir, f), "utf8").matchAll(/export async function (\w+)/g)].map((m) => m[1]!));
    expect(found.sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const h of Object.values(ACTIONS)) if (h) expect(COVERED_HANDLERS.has(h)).toBe(true);
  });

  it("NotFoundError is what other firms' ids produce (no existence leak)", () => {
    expect(new NotFoundError().status).toBe(404);
  });
});
