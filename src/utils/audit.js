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

module.exports = { record };
