'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Simpan push token Expo (dari ZenVPS) ke file lokal - pola sama kayak
 * projects.js (file-based, dibaca ulang tiap request, bukan di-cache).
 * SATU token doang (device terakhir yang daftar menang) - solo developer,
 * 1 HP. Kalau nanti butuh multi-device, ganti jadi array + device id.
 */
function getPushTokenFilePath() {
  return process.env.COMPANION_PUSH_TOKEN_FILE || path.join(__dirname, '../../push-token.json');
}

function getPushToken() {
  const filePath = getPushTokenFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed.token || null;
  } catch {
    return null;
  }
}

function setPushToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('[pushToken] Token wajib string, gak boleh kosong.');
  }
  const filePath = getPushTokenFilePath();
  fs.writeFileSync(filePath, JSON.stringify({ token, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  return token;
}

module.exports = { getPushToken, setPushToken, getPushTokenFilePath };
