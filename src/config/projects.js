'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Daftar project yang udah migrasi ke Coolify - disimpen di FILE JSON di VPS,
 * BUKAN di-hardcode di kode ZenVPS (mobile app). Alasan: nambah 1 project ke
 * array hardcode di app berarti rebuild + redistribute APK/build baru cuma
 * buat 1 baris data. File JSON di server bisa diedit kapan aja dari SSH,
 * ZenVPS fetch fresh tiap buka Dashboard - gak perlu build ulang app sama
 * sekali buat nambah/ubah project.
 *
 * Sengaja BACA FILE LANGSUNG tiap request (bukan di-cache di memori) -
 * konsisten sama prinsip "connection string diambil live tiap request"
 * (Bagian 6 dokumen) - edit file, langsung kepakai request berikutnya, gak
 * perlu restart pm2 sama sekali.
 */

function getProjectsFilePath() {
  return process.env.COMPANION_PROJECTS_FILE || path.join(__dirname, '../../projects.json');
}

function listProjects() {
  const filePath = getProjectsFilePath();

  if (!fs.existsSync(filePath)) {
    // Kebijakan error Bagian 9: gagal eksplisit, bukan diam-diam kembaliin
    // array kosong seolah-olah emang belum ada project (beda makna).
    throw new Error(
      `[projects] File "${filePath}" gak ketemu. Bikin file itu (lihat projects.json.example) ` +
      `atau set COMPANION_PROJECTS_FILE ke path yang benar.`
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`[projects] Gagal baca "${filePath}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[projects] "${filePath}" bukan JSON valid: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`[projects] "${filePath}" harus berisi array, bukan ${typeof parsed}.`);
  }

  return parsed;
}

module.exports = { listProjects, getProjectsFilePath };
