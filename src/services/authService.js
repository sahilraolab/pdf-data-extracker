'use strict';

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const { users } = require('./dbService');
const logger  = require('../utils/logger');

// ── JWT secret (env or persisted file) ───────────────────────────────────────

const SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(__dirname, '../../data/.jwtsecret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  try { fs.writeFileSync(f, s); } catch {}
  return s;
})();

const COOKIE = 'pdfapp_token';
const TOKEN_TTL_DAYS = 14;

// ── Token helpers ─────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: `${TOKEN_TTL_DAYS}d` });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE);
}

// ── Seed admin on first start ─────────────────────────────────────────────────

async function seedAdmin() {
  const count = await users.countAsync({});
  if (count > 0) return;

  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    logger.error('[AUTH] ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env before first run.');
    process.exit(1);
  }

  if (password.length < 12) {
    logger.error('[AUTH] ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await users.insertAsync({
    email:        email.toLowerCase().trim(),
    passwordHash: hash,
    name:         'Admin',
    role:         'admin',
    active:       true,
    sessionToken: null,
    createdAt:    new Date().toISOString(),
    lastLoginAt:  null,
    uploadCount:  0,
    notes:        '',
  });
  logger.info(`[AUTH] Admin account created — ${email}`);
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(email, password, res) {
  const user = await users.findOneAsync({ email: email.toLowerCase().trim() });
  if (!user)                          return { ok: false, error: 'Invalid email or password.' };
  if (!user.active)                   return { ok: false, error: 'Account is disabled. Contact support.' };
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match)                         return { ok: false, error: 'Invalid email or password.' };

  const sessionToken = crypto.randomUUID();
  await users.updateAsync({ _id: user._id }, { $set: { sessionToken, lastLoginAt: new Date().toISOString() } }, {});

  const token = signToken({ sub: user._id, email: user.email, role: user.role, sessionToken });
  setCookie(res, token);
  return { ok: true, user: safeUser(user) };
}

async function logout(req, res) {
  const payload = verifyToken(req.cookies?.[COOKIE]);
  if (payload?.sub) {
    await users.updateAsync({ _id: payload.sub }, { $set: { sessionToken: null } }, {}).catch(() => {});
  }
  clearCookie(res);
}

// ── Session validation ────────────────────────────────────────────────────────

async function getSessionUser(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;

  const user = await users.findOneAsync({ _id: payload.sub });
  if (!user || !user.active) return null;

  // Single-session check (skip for admin-impersonation tokens)
  if (!payload.viewingAs && user.sessionToken !== payload.sessionToken) return null;

  return { ...safeUser(user), viewingAs: payload.viewingAs || null };
}

// ── Admin impersonation ───────────────────────────────────────────────────────

async function buildImpersonationToken(adminUser, targetUserId, res) {
  const target = await users.findOneAsync({ _id: targetUserId });
  if (!target) return { ok: false, error: 'User not found.' };
  if (!target.active) return { ok: false, error: 'Target user is disabled.' };

  // Impersonation token carries the target user's identity but marks the admin
  const token = signToken({
    sub:          target._id,
    email:        target.email,
    role:         target.role,
    sessionToken: target.sessionToken, // may be null — ok since we skip check
    viewingAs:    { adminId: adminUser._id, adminEmail: adminUser.email },
  });
  setCookie(res, token);
  return { ok: true };
}

async function exitImpersonation(adminId, res) {
  const admin = await users.findOneAsync({ _id: adminId });
  if (!admin || admin.role !== 'admin') return { ok: false, error: 'Admin not found.' };
  const sessionToken = crypto.randomUUID();
  await users.updateAsync({ _id: adminId }, { $set: { sessionToken } }, {});
  const token = signToken({ sub: admin._id, email: admin.email, role: admin.role, sessionToken });
  setCookie(res, token);
  return { ok: true };
}

// ── User management ───────────────────────────────────────────────────────────

async function createUser({ email, password, name, notes }) {
  const existing = await users.findOneAsync({ email: email.toLowerCase().trim() });
  if (existing) return { ok: false, error: 'Email already exists.' };
  const hash = await bcrypt.hash(password, 10);
  const doc  = await users.insertAsync({
    email:        email.toLowerCase().trim(),
    passwordHash: hash,
    name:         name?.trim() || email.split('@')[0],
    role:         'user',
    active:       true,
    sessionToken: null,
    createdAt:    new Date().toISOString(),
    lastLoginAt:  null,
    uploadCount:  0,
    notes:        notes?.trim() || '',
  });
  return { ok: true, user: safeUser(doc) };
}

async function updateUser(id, { name, email, password, notes }) {
  const $set = {};
  if (name)     $set.name  = name.trim();
  if (email)    $set.email = email.toLowerCase().trim();
  if (notes !== undefined) $set.notes = notes.trim();
  if (password) $set.passwordHash = await bcrypt.hash(password, 10);
  if (!Object.keys($set).length) return { ok: false, error: 'Nothing to update.' };
  await users.updateAsync({ _id: id }, { $set }, {});
  return { ok: true };
}

async function toggleUserActive(id) {
  const user = await users.findOneAsync({ _id: id });
  if (!user) return { ok: false, error: 'User not found.' };
  if (user.role === 'admin') return { ok: false, error: 'Cannot disable admin accounts.' };
  const active = !user.active;
  // Force-logout by clearing sessionToken when disabling
  const $set = { active };
  if (!active) $set.sessionToken = null;
  await users.updateAsync({ _id: id }, { $set }, {});
  return { ok: true, active };
}

async function deleteUser(id) {
  const user = await users.findOneAsync({ _id: id });
  if (!user) return { ok: false, error: 'User not found.' };
  if (user.role === 'admin') return { ok: false, error: 'Cannot delete admin accounts.' };
  await users.removeAsync({ _id: id }, {});
  return { ok: true };
}

async function forceLogout(id) {
  await users.updateAsync({ _id: id }, { $set: { sessionToken: null } }, {});
  return { ok: true };
}

async function incrementUploadCount(userId) {
  await users.updateAsync({ _id: userId }, { $inc: { uploadCount: 1 } }, {}).catch(() => {});
}

// ── List users ────────────────────────────────────────────────────────────────

async function listUsers() {
  const list = await users.findAsync({});
  return list.map(safeUser).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeUser(u) {
  const { passwordHash: _, ...safe } = u;
  return safe;
}

module.exports = {
  seedAdmin,
  login,
  logout,
  getSessionUser,
  buildImpersonationToken,
  exitImpersonation,
  createUser,
  updateUser,
  toggleUserActive,
  deleteUser,
  forceLogout,
  listUsers,
  incrementUploadCount,
  COOKIE,
};
