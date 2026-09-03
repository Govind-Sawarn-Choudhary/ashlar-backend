const { verifyToken } = require('../services/token.service');

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

    req.auth = payload;
    return payload;
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
