'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config/config');

/**
 * Audit trail sederhana -- append-only, 1 baris JSON per event.
 * Prinsip Bagian 6: "Command yang dikirim wajib dicatat ke log (audit trail) --
 * prinsip Bagian 7, jangan diam-diam".
 *
 * Sengaja file-based (bukan DB) -- Companion API scope-nya kecil, gak perlu
 * infra tambahan cuma buat audit log.
 */

function ensureLogDir() {
  fs.mkdirSync(config.audit.logDir, { recursive: true });
}

function record(event) {
  ensureLogDir();
  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  const file = path.join(config.audit.logDir, 'audit.log');
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

/**
 * BARU (5 Agustus 2026) - baca N entry TERAKHIR buat ditampilin di ZenVPS
 * (fitur "Audit Log" tab Diagnostik). Baca file APA ADANYA tiap request
 * (bukan cache di memori) - konsisten sama prinsip file-based config lain
 * di Companion API (projects.js). File append-only, jadi baris terakhir =
 * event terbaru; dibalik di sini (newest-first) biar ZenVPS gak perlu
 * mikirin urutan.
 *
 * CATATAN: belum ada rotasi/pembatasan ukuran file - buat pemakaian solo
 * developer skala kecil ini belum jadi masalah, tapi kalau file-nya udah
 * gede banget (ribuan baris), baca-seluruh-file-lalu-slice ini mulai boros.
 * Belum dioptimasi karena belum ada bukti itu jadi masalah nyata.
 */
function readRecent(limit = 50) {
  ensureLogDir();
  const file = path.join(config.audit.logDir, 'audit.log');
  if (!fs.existsSync(file)) return [];

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`[audit] Gagal baca "${file}": ${err.message}`);
  }

  const lines = raw.split('\n').filter((line) => line.trim());
  const recent = lines.slice(-limit);

  return recent
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        // Baris korup/gak lengkap (mis. proses mati pas nulis) - skip diam-diam,
        // JANGAN gagalin seluruh request cuma gara-gara 1 baris rusak.
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

module.exports = { record, readRecent };
