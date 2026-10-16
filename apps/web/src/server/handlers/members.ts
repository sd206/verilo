import { z } from "zod";
import { ROLES, roleRequiresMfa } from "@verilo/domain";
import {
  ConflictError,
  createSession,
  enforceRateLimit,
  ForbiddenError,
  hashPassword,
  NotFoundError,
  passwordPolicyError,
  randomToken,
  requirePermission,
  sha256Hex,
  UnauthenticatedError,
  ValidationError,
  verifyPassword,
  type FirmContext,
} from "@verilo/auth";
import {
  changeUserStatus,
  findInvitationByTokenHash,
  findOrCreateInvitedUser,
  findUserForSignin,
  getFirm,
  getMembership,
  getUser,
  insertInvitation,
  insertMembership,
  listMembers as listMembersRepo,
  listPendingInvitations,
  markInvitationAccepted,
  updateUserProfile,
  withAnonymous,
  withTenant,
  writeAudit,
  type InvitationLookup,
} from "@verilo/db";
import { inviteEmail } from "@verilo/email";
import type { Deps } from "../deps";
import { email, parse, type NewSession, type RequestMeta } from "./common";

export const INVITE_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// inviteUser (ADMIN: "Manage users and roles")
// ---------------------------------------------------------------------------

const inviteSchema = z.strictObject({
  email,
  name: z.string().trim().max(200).optional(),
  role: z.enum(ROLES),
});

export async function inviteUser(
  d: Deps,
  ctx: FirmContext,
  input: unknown,
): Promise<{ invitationId: string; emailed: boolean; link: string | null }> {
  requirePermission(ctx, "MANAGE_FIRM");
  const data = parse(inviteSchema, input);
  await enforceRateLimit(d.db, "invite", ctx.userId);

  const token = randomToken();
  const result = await withTenant(d.db, ctx, async (tx) => {
    const firm = await getFirm(tx, ctx.firmId);
    const inviter = await getUser(tx, ctx.userId);
    if (!firm || !inviter) throw new NotFoundError();

    const displayName = data.name || data.email.split("@")[0]!;
    const userId = await findOrCreateInvitedUser(tx, data.email, displayName, ctx.userId);
    if (await getMembership(tx, ctx.firmId, userId)) {
      throw new ConflictError("That person is already a member of this firm");
    }
    const inv = await insertInvitation(tx, {
      firmId: ctx.firmId,
      email: data.email,
      role: data.role,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      createdBy: ctx.userId,
    });
    const { tokenHash: _t, ...after } = inv;
    await writeAudit(tx, {
      firmId: ctx.firmId,
      actorUserId: ctx.userId,
      entityType: "invitation",
      entityId: inv.id,
      action: "create",
      after,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { inv, firmName: firm.displayName, inviterName: inviter.name };
  });

  const link = `${d.config.baseUrl}/invite/${token}`;
  if (d.email.enabled) {
    await d.email.send(
      inviteEmail({
        to: data.email,
        firmName: result.firmName,
        inviterName: result.inviterName,
        role: data.role,
        link,
      }),
    );
    return { invitationId: result.inv.id, emailed: true, link: null };
  }
  // No outbound email configured (staging before Postmark exists): show the link to the
  // inviting Admin so they can pass it on. Never in production.
  if (d.config.appEnv === "production") throw new Error("Outbound email is not configured");
  return { invitationId: result.inv.id, emailed: false, link };
}

export async function listMembers(d: Deps, ctx: FirmContext) {
  requirePermission(ctx, "MANAGE_FIRM");
  return withTenant(d.db, ctx, async (tx) => ({
    members: await listMembersRepo(tx, ctx.firmId),
    pendingInvitations: await listPendingInvitations(tx, ctx.firmId),
  }));
}

// ---------------------------------------------------------------------------
// getInvitation / acceptInvite (public; the token is the credential)
// ---------------------------------------------------------------------------

const tokenSchema = z.string().min(20).max(100);

async function loadValidInvitation(d: Deps, token: string): Promise<InvitationLookup> {
  const inv = await withAnonymous(d.db, (tx) => findInvitationByTokenHash(tx, sha256Hex(token)));
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() < Date.now()) {
    throw new NotFoundError("This invitation is invalid or has expired");
  }
  return inv;
}

export async function getInvitation(
  d: Deps,
  input: unknown,
): Promise<{ firmName: string; email: string; role: string; needsPassword: boolean }> {
  const token = parse(z.strictObject({ token: tokenSchema }), input).token;
  const inv = await loadValidInvitation(d, token);
  const user = await withAnonymous(d.db, (tx) => findUserForSignin(tx, inv.email));
  if (!user) throw new NotFoundError("This invitation is invalid or has expired");
  const firm = await withTenant(d.db, { firmId: inv.firmId, userId: user.id }, (tx) => getFirm(tx, inv.firmId));
  return {
    firmName: firm?.displayName ?? "",
    email: inv.email,
    role: inv.role,
    needsPassword: !user.passwordHash,
  };
}

const acceptSchema = z.strictObject({
  token: tokenSchema,
  name: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(256),
});

export async function acceptInvite(
  d: Deps,
  meta: RequestMeta,
  input: unknown,
): Promise<{ firmId: string; userId: string; session: NewSession; next: string }> {
  const data = parse(acceptSchema, input);
  await enforceRateLimit(d.db, "acceptInvite", meta.ip ?? "unknown");
  const inv = await loadValidInvitation(d, data.token);

  // The invitation acts only on the account for the invited email address.
  const user = await withAnonymous(d.db, (tx) => findUserForSignin(tx, inv.email));
  if (!user) throw new NotFoundError("This invitation is invalid or has expired");
  if (user.status === "DISABLED") throw new ForbiddenError("This account is disabled");

  let newPasswordHash: string | null = null;
  if (!user.passwordHash) {
    const err = passwordPolicyError(data.password);
    if (err) throw new ValidationError(err);
    newPasswordHash = await hashPassword(data.password);
  } else if (!(await verifyPassword(user.passwordHash, data.password))) {
    // Existing users confirm the invitation with their current password.
    throw new UnauthenticatedError("Password is incorrect for this account");
  }

  await withTenant(d.db, { firmId: inv.firmId, userId: user.id }, async (tx) => {
    const audit = { firmId: inv.firmId, actorUserId: user.id, ip: meta.ip, userAgent: meta.userAgent };
    if (newPasswordHash) {
      await updateUserProfile(tx, user.id, {
        passwordHash: newPasswordHash,
        ...(data.name ? { name: data.name } : {}),
      });
    }
    if (user.status === "INVITED") {
      await changeUserStatus(tx, user.id, "INVITED", "ACTIVE");
      await writeAudit(tx, {
        ...audit,
        entityType: "user",
        entityId: user.id,
        action: "status_change",
        before: { status: "INVITED" },
        after: { status: "ACTIVE" },
      });
    }
    if (await getMembership(tx, inv.firmId, user.id)) {
      throw new ConflictError("You are already a member of this firm");
    }
    const m = await insertMembership(tx, {
      firmId: inv.firmId,
      userId: user.id,
      role: inv.role,
      createdBy: user.id,
    });
    const accepted = await markInvitationAccepted(tx, inv.firmId, inv.id, user.id);
    if (!accepted) throw new NotFoundError("This invitation is invalid or has expired");
    await writeAudit(tx, { ...audit, entityType: "membership", entityId: m.id, action: "create", after: m });
    await writeAudit(tx, {
      ...audit,
      entityType: "invitation",
      entityId: inv.id,
      action: "accept",
      before: { acceptedAt: null },
      after: { acceptedAt: accepted.acceptedAt },
    });
  });

  const session = await createSession(d.db, {
    userId: user.id,
    activeFirmId: inv.firmId,
    mfaVerified: false,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const next = user.mfaEnabledAt ? "/mfa/verify" : roleRequiresMfa(inv.role) ? "/mfa/setup" : "/app";
  return { firmId: inv.firmId, userId: user.id, session, next };
}
