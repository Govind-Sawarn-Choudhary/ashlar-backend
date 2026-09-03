const { verifyToken } = require('../services/token.service');

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  try {
    const payload = verifyToken(token);

    if (payload.type !== 'admin') {
      return res.status(403).json({ error: 'Invalid admin token' });
    }

    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

module.exports = {
  requireAdmin,
};
