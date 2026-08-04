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

/**
 * List isi 1 folder di dalam container - pakai `ls -la` lewat Docker exec,
 * TAPI dalam bentuk ARRAY Cmd (['ls', '-la', '--', path]), BUKAN string
 * shell ('sh -c "ls " + path). Beda kelas risiko total (Bagian 8, least
 * privilege): array-Cmd dieksekusi LANGSUNG oleh Docker tanpa shell di
 * tengah -- karakter shell metachar (;, $(), backtick, dst) di path TIDAK
 * pernah diinterpretasi jadi command, karena gak ada shell yang mem-parse-nya
 * sama sekali. "--" mencegah path yang kebetulan diawali "-" dibaca sebagai
 * flag oleh `ls`. Ini KENAPA fitur ini beda dari peringatan "jangan pakai
 * docker exec shell" yang ditulis di fileManager.js -- itu soal string shell,
 * ini murni array argv ke binary.
 *
 * Sengaja TIDAK pakai getArchive (Docker Archive API) buat listing -- itu
 * narik SELURUH isi folder termasuk semua subfolder (bisa ribuan file kalau
 * kena node_modules), berat & boros. `ls` non-recursive jauh lebih ringan.
 */
async function listDirectoryByContainerId(containerId, targetPath) {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: ['ls', '-la', '--', targetPath],
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({});
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  // Output dari exec pakai Docker stream multiplexing format (8-byte header
  // per frame) kalau container gak di-attach TTY -- demux manual biar gak
  // kecampur byte header aneh di teks hasil `ls`.
  const raw = Buffer.concat(chunks);
  let text = '';
  let offset = 0;
  while (offset + 8 <= raw.length) {
    const frameLength = raw.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + frameLength;
    text += raw.slice(start, Math.min(end, raw.length)).toString('utf8');
    offset = end;
  }
  if (!text && raw.length > 0) {
    // Fallback kalau ternyata bukan format multiplexed (container attach TTY) -- pakai raw apa adanya.
    text = raw.toString('utf8');
  }

  const info = await exec.inspect();
  if (info.ExitCode !== 0) {
    throw new Error(`ls "${targetPath}" gagal (exit code ${info.ExitCode}): ${text.trim() || '(no output)'}`);
  }

  return parseLsOutput(text);
}

/** Parse output `ls -la` jadi array {name, isDirectory, raw} - format standar GNU coreutils (base image Nixpacks pakai Debian/Ubuntu). */
function parseLsOutput(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('total '))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const name = parts.slice(8).join(' ');
      return {
        name,
        isDirectory: line.startsWith('d'),
        raw: line,
      };
    })
    .filter((entry) => entry.name && entry.name !== '.' && entry.name !== '..');
}

/** Wrapper: resolve applicationUuid -> container ID aktif, baru list folder. */
async function listDirectoryByAppUuid(applicationUuid, targetPath) {
  const containerId = await resolveContainerIdByAppUuid(applicationUuid);
  return listDirectoryByContainerId(containerId, targetPath);
}

module.exports = {
  docker,
  getRestartCount,
  getRestartCountByAppUuid,
  resolveContainerIdByAppUuid,
  listDirectoryByAppUuid,
};
