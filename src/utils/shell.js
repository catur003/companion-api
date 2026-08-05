'use strict';

const { execFileSync } = require('child_process');

/**
 * Shell wrapper buat Companion API - VERSI SEDERHANA dari punya vps-manager
 * (yang punya runAsUser/multi-user, karena PM2 fork-mode banyak user beda).
 * Companion API SELALU jalan sebagai 1 user (siapapun yang pm2-start dia,
 * gak ada konsep multi-user kayak vps-manager lama) - jadi runAsUser gak
 * relevan/gak di-port, cukup jalanin command apa adanya.
 *
 * SENGAJA execFileSync (argv terpisah), BUKAN execSync/shell string - sama
 * prinsip least-privilege yang dipegang di seluruh Companion API (docker.js,
 * fileManager.js), walau command2 di module ini semua FIXED (gak ada input
 * dari request), tetep dipertahankan demi konsistensi/defense-in-depth.
 */
function run(file, args = [], options = {}) {
  const { timeoutMs = 10000 } = options;
  try {
    const output = execFileSync(file, args, { stdio: 'pipe', timeout: timeoutMs }).toString().trim();
    return { ok: true, output };
  } catch (err) {
    const stderrText = err.stderr && err.stderr.length > 0 ? err.stderr.toString().trim() : '';
    return { ok: false, output: err.stdout ? err.stdout.toString() : '', errorMessage: stderrText || err.message };
  }
}

module.exports = { run };
