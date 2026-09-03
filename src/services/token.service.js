const jwt = require('jsonwebtoken');
const config = require('../config');

function signUserToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      type: 'user',
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

function signAdminToken(admin) {
  return jwt.sign(
    {
      sub: admin.id,
      email: admin.email,
      type: 'admin',
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = {
  signUserToken,
  signAdminToken,
  verifyToken,
};
