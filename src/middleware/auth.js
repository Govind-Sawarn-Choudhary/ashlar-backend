const db = require('../db');
const { verifyToken } = require('../services/token.service');

function resolveAuthUser(payload, res) {
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({ error: 'Session expired. Please login again.' });
    return null;
  }

  const user = db
    .prepare('SELECT id, phone, role FROM users WHERE id = ?')
    .get(userId);

  if (!user) {
    res.status(401).json({ error: 'Session expired. Please login again.' });
    return null;
  }

  if (payload.role && user.role !== payload.role) {
    res.status(403).json({ error: 'Invalid token role' });
    return null;
  }

  return {
    sub: user.id,
    phone: user.phone,
    role: user.role,
    type: payload.type,
  };
}

function extractAuth(req, res) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  try {
    const payload = verifyToken(token);

    if (payload.type !== 'user') {
      res.status(403).json({ error: 'Invalid token type' });
      return null;
    }

    const auth = resolveAuthUser(payload, res);
    if (!auth) {
      return null;
    }

    req.auth = auth;
    return auth;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

function requireAuth(req, res, next) {
  if (extractAuth(req, res)) {
    next();
  }
}

function requireLawyer(req, res, next) {
  const payload = extractAuth(req, res);
  if (!payload) {
    return;
  }

  if (payload.role !== 'lawyer') {
    return res.status(403).json({ error: 'Lawyer access only' });
  }

  next();
}

module.exports = {
  requireAuth,
  requireLawyer,
};
