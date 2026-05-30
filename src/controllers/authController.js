'use strict';

const auth = require('../services/authService');
const { users } = require('../services/dbService');

async function postLogin(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const result = await auth.login(email, password, res);
    if (!result.ok) return res.status(401).json({ error: result.error });
    const next = req.query.next || (result.user.role === 'admin' ? '/admin' : '/tool');
    res.json({ ok: true, user: result.user, redirect: next });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
}

async function postLogout(req, res) {
  await auth.logout(req, res);
  res.json({ ok: true });
}

async function getMe(req, res) {
  res.json({ user: req.sessionUser });
}

async function postImpersonate(req, res) {
  try {
    const result = await auth.buildImpersonationToken(req.sessionUser, req.params.userId, res);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, redirect: '/tool' });
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

async function postExitImpersonate(req, res) {
  try {
    const adminId = req.sessionUser.viewingAs?.adminId;
    if (!adminId) return res.status(400).json({ error: 'Not in impersonation session.' });
    const result = await auth.exitImpersonation(adminId, res);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, redirect: '/admin' });
  } catch { res.status(500).json({ error: 'Server error.' }); }
}

module.exports = { postLogin, postLogout, getMe, postImpersonate, postExitImpersonate };
