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
 * TEMUAN PENTING (tes nyata, 4 Agustus 2026): container app (Nixpacks) itu
 * stateless DAN ID-nya berubah tiap redeploy -- container lama dihapus,
 * dibuat baru dengan ID Docker baru. Container ID mentah (dipakai
 * getRestartCount di bawah) jadi "basi" begitu ada redeploy pertama setelah
 * ID itu dicatat di client (ZenVPS). applicationUuid Coolify TETAP, gak
 * pernah berubah -- jadi resolve container ID dari applicationUuid dulu tiap
 * request, bukan simpan/percaya container ID lama.
 *
 * Konvensi nama container Coolify: "{applicationUuid}-{timestamp}" (dikonfirmasi
 * dari 2 observasi nyata: "bxpbj2db8xneyfquv7o9l1bk-210125729979" lalu setelah
 * redeploy jadi "bxpbj2db8xneyfquv7o9l1bk-082640147852"). Kalau pola ini berubah
 * di versi Coolify lain, fungsi ini gagal eksplisit (bukan nebak container salah).
 */
async function resolveContainerIdByAppUuid(applicationUuid) {
  const containers = await docker.listContainers({ all: false });
  const prefix = `/${applicationUuid}-`;

  const matches = containers.filter((c) => c.Names.some((n) => n.startsWith(prefix)));

  if (matches.length === 0) {
    throw new Error(
      `Gak ada container yang lagi jalan buat applicationUuid "${applicationUuid}" -- ` +
      `app mungkin lagi stopped, atau baru aja redeploy (tunggu sebentar, coba lagi).`
    );
  }

  // Kalau ada lebih dari 1 (kemungkinan kecil, mis. lagi transisi redeploy),
  // ambil yang paling baru dibuat -- itu yang aktif sekarang.
  matches.sort((a, b) => b.Created - a.Created);
  return matches[0].Id;
}

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

/** Wrapper: resolve applicationUuid -> container ID aktif dulu, baru getRestartCount. */
async function getRestartCountByAppUuid(applicationUuid) {
  try {
    const containerId = await resolveContainerIdByAppUuid(applicationUuid);
    return await getRestartCount(containerId);
  } catch (err) {
    return {
      ok: false,
      error: `Gagal resolve container buat applicationUuid "${applicationUuid}": ${err.message}`,
    };
  }
}

module.exports = { docker, getRestartCount, getRestartCountByAppUuid, resolveContainerIdByAppUuid };
