'use strict';

const config = require('../../config/config');
const { timingSafeEqual } = require('../../utils/timingSafeEqual');

/**
 * Bearer token auth -- pola sama seperti vps-manager sekarang, supaya ZenVPS
 * app gak perlu logic auth baru buat manggil Companion API.
 */
function tokensMatch(a, b) {
  return timingSafeEqual(a, b);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || !tokensMatch(token, config.auth.token)) {
    return res.status(401).json({
      success: false,
      message: 'Token tidak valid atau tidak ada.',
      code: 'UNAUTHORIZED',
      data: null,
    });
  }

  next();
}

module.exports = authMiddleware;
