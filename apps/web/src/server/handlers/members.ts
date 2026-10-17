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
  getConsultant,
  findOrCreateInvitedUser,
  findUserForSignin,
  getFirm,
  getMembership,
  getMembershipById,
  updateMembership,
  countActiveAdmins,
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
import { email, parse, uuid, type NewSession, type RequestMeta } from "./common";

export const INVITE_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// inviteUser (ADMIN: "Manage users and roles")
// ---------------------------------------------------------------------------

const inviteSchema = z.strictObject({
  email,
  name: z.string().trim().max(200).optional(),
  role: z.enum(ROLES),
  /** Required for CONSULTANT invitations: the consultant record this login belongs to. */
  consultantId: uuid.optional(),
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

    if (data.role === "CONSULTANT") {
      if (!data.consultantId) throw new ValidationError("Choose which consultant this login is for");
      if (!(await getConsultant(tx, ctx.firmId, data.consultantId))) throw new NotFoundError("Consultant not found");
    } else if (data.consultantId) {
      throw new ValidationError("Only Consultant logins are linked to a consultant");
    }
    const displayName = data.name || data.email.split("@")[0]!;
    const userId = await findOrCreateInvitedUser(tx, data.email, displayName, ctx.userId);
    if (await getMembership(tx, ctx.firmId, userId)) {
      throw new ConflictError("That person is already a member of this firm");
    }
    const inv = await insertInvitation(tx, {
      firmId: ctx.firmId,
      email: data.email,
      role: data.role,
      consultantId: data.consultantId ?? null,
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
      consultantId: inv.consultantId,
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

// ---------------------------------------------------------------------------
// Users and roles (13.3 item 2): change role, disable, require MFA. Admin only.
// ---------------------------------------------------------------------------

const memberUpdateSchema = z.strictObject({
  membershipId: uuid,
  role: z.enum(ROLES).optional(),
  consultantId: uuid.nullable().optional(),
  disabled: z.boolean().optional(),
  mfaRequired: z.boolean().optional(),
});

export async function updateMember(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "MANAGE_FIRM");
  const data = parse(memberUpdateSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    const m = await getMembershipById(tx, ctx.firmId, data.membershipId);
    if (!m) throw new NotFoundError();
    if (m.userId === ctx.userId && (data.role !== undefined || data.disabled !== undefined)) {
      throw new ForbiddenError("You can't change your own role or disable yourself");
    }
    const role = data.role ?? m.role;
    let consultantId = data.consultantId !== undefined ? data.consultantId : m.consultantId;
    if (role === "CONSULTANT") {
      if (!consultantId) throw new ValidationError("Choose which consultant this login is for");
      if (!(await getConsultant(tx, ctx.firmId, consultantId))) throw new NotFoundError("Consultant not found");
    } else {
      consultantId = null;
    }
    const disabledAt = data.disabled === undefined ? m.disabledAt : data.disabled ? (m.disabledAt ?? new Date()) : null;
    const losingAdmin = m.role === "ADMIN" && !m.disabledAt && (role !== "ADMIN" || disabledAt !== null);
    if (losingAdmin && (await countActiveAdmins(tx, ctx.firmId)) <= 1) {
      throw new ConflictError("A firm needs at least one active Admin");
    }
    const updated = await updateMembership(tx, ctx.firmId, m.id, {
      role,
      consultantId,
      disabledAt,
      mfaRequired: data.mfaRequired ?? m.mfaRequired,
    });
    const pick = (x: typeof m) => ({ role: x.role, consultantId: x.consultantId, disabledAt: x.disabledAt, mfaRequired: x.mfaRequired });
    await writeAudit(tx, {
      firmId: ctx.firmId,
      actorUserId: ctx.userId,
      entityType: "membership",
      entityId: m.id,
      action: data.disabled !== undefined && data.disabled !== (m.disabledAt !== null) ? (data.disabled ? "disable" : "enable") : "update",
      before: pick(m),
      after: pick(updated),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return pick(updated);
  });
}
