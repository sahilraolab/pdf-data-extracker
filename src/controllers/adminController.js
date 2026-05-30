'use strict';

const auth   = require('../services/authService');
const { users } = require('../services/dbService');

async function getStats(req, res) {
  try {
    const all     = await users.findAsync({});
    const total   = all.length;
    const active  = all.filter(u => u.active && u.role !== 'admin').length;
    const online  = all.filter(u => u.sessionToken).length;
    const uploads = all.reduce((s, u) => s + (u.uploadCount || 0), 0);
    const recent  = all
      .filter(u => u.lastLoginAt)
      .sort((a, b) => new Date(b.lastLoginAt) - new Date(a.lastLoginAt))
      .slice(0, 5)
      .map(u => ({ name: u.name, email: u.email, lastLoginAt: u.lastLoginAt }));
    res.json({ total, active, online, uploads, recent });
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

async function getUsers(req, res) {
  try {
    const list = await auth.listUsers();
    res.json(list);
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

async function postUser(req, res) {
  try {
    const { email, password, name, notes } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    if (password.length < 6)  return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const result = await auth.createUser({ email, password, name, notes });
    if (!result.ok) return res.status(409).json({ error: result.error });
    res.status(201).json(result.user);
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

async function patchUser(req, res) {
  try {
    const result = await auth.updateUser(req.params.id, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

async function deleteUser(req, res) {
  try {
    const result = await auth.deleteUser(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

async function toggleUser(req, res) {
  try {
    const result = await auth.toggleUserActive(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, active: result.active });
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

async function forceLogout(req, res) {
  try {
    await auth.forceLogout(req.params.id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

module.exports = { getStats, getUsers, postUser, patchUser, deleteUser, toggleUser, forceLogout };
