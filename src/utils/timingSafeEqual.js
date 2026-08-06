'use strict';

const crypto = require('crypto');

/**
 * Timing-safe string compare - extract dari auth.js (6 Agustus 2026) supaya
 * bisa dipakai ulang di webhook.routes.js juga, bukan pola aman cuma di 1
 * tempat doang. String compare `!==` biasa bocorin info lewat timing
 * (byte pertama beda balik lebih cepat dari byte terakhir beda) - kecil
 * dampaknya buat secret acak+panjang, tapi gak ada alasan buat gak
 * konsisten pakai pola aman di semua tempat yang cocokin secret.
 */
function timingSafeEqual(a, b) {
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

module.exports = { timingSafeEqual };
