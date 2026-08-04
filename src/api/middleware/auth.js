'use strict';

const crypto = require('crypto');
const config = require('../../config/config');

/**
 * Bearer token auth -- pola sama seperti vps-manager sekarang, supaya ZenVPS
 * app gak perlu logic auth baru buat manggil Companion API.
 */
function tokensMatch(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Panjang beda pasti gak match -- tapi tetap jangan short-circuit sebelum
  // timingSafeEqual supaya gak bocorin info panjang lewat timing juga.
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // buang waktu yang setara, hasil diabaikan
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
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
