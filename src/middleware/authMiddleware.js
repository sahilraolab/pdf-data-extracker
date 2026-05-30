'use strict';

const { getSessionUser } = require('../services/authService');

/**
 * Requires a valid session. Returns 401 JSON for API routes,
 * redirects to /login for page routes.
 */
function requireAuth(req, res, next) {
  getSessionUser(req).then(user => {
    if (!user) {
      const isApi = req.path.startsWith('/api/') || req.xhr || (req.headers.accept || '').includes('application/json');
      if (isApi) return res.status(401).json({ error: 'Unauthorised.' });
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    req.sessionUser = user;
    next();
  }).catch(next);
}

/**
 * Requires admin role. Must be used after requireAuth.
 */
function requireAdmin(req, res, next) {
  if (req.sessionUser?.role !== 'admin') {
    const isApi = req.path.startsWith('/api/') || (req.headers.accept || '').includes('application/json');
    if (isApi) return res.status(403).json({ error: 'Forbidden.' });
    return res.redirect('/tool');
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
