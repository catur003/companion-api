'use strict';

const Docker = require('dockerode');
const config = require('../config/config');

/**
 * Batch A -- fungsi ini TIDAK bergantung ke Coolify API, cuma ke Docker socket
 * langsung di host. Bisa dites sekarang walau belum ada instance Coolify hidup.
 *
 * Scope sengaja read-only (docker inspect), sesuai Bagian 8: "kalau butuh akses
 * Docker API, scope ke read-only, bukan kemampuan start/stop/hapus container."
 */

const docker = new Docker({ socketPath: config.docker.socketPath });

/**
 * Ambil restart count container, setara pm2_env.restart_time di vps-manager lama.
 *
 * PENTING (Bagian 9, kebijakan error): kalau gagal, kembalikan error eksplisit --
 * JANGAN kembalikan 0, karena "0 restart palsu lebih berbahaya dari tidak ada
 * data sama sekali" (dikutip langsung dari dokumen migrasi).
 */
async function getRestartCount(containerId) {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    // RestartCount hanya reliable kalau container punya restart-policy aktif.
    // Kalau policy-nya "no", Docker tetap kasih angka tapi maknanya beda --
    // wajib disertakan di response biar ZenVPS bisa tampilkan konteks yang benar.
    return {
      ok: true,
      restartCount: info.RestartCount ?? null,
      restartPolicy: info.HostConfig?.RestartPolicy?.Name ?? 'unknown',
      containerState: info.State?.Status ?? 'unknown',
    };
  } catch (err) {
    return {
      ok: false,
      error: `Gagal ambil restart-count untuk container "${containerId}": ${err.message}`,
    };
  }
}

module.exports = { docker, getRestartCount };
