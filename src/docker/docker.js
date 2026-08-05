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

/**
 * Batch B (5 Agustus 2026) -- Tab Diagnostik: docker ps / stats / inspect,
 * READ-ONLY MURNI (prinsip Bagian 8: scope Docker API ke `docker inspect`,
 * BUKAN start/stop/exec). Beda dari restart-count/file-manager di atas --
 * ini gak resolve by applicationUuid, nunjukin SEMUA container di host
 * (termasuk infra Coolify sendiri: coolify-db, coolify-proxy, dst) apa
 * adanya, karena tujuannya diagnostik VPS secara umum, bukan per-app.
 */

/** Key env var yang nilainya WAJIB di-mask -- password/token/secret/key/credential/auth, case-insensitive. */
const SENSITIVE_ENV_KEY_PATTERN = /PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH|PRIVATE/i;

function maskEnvEntries(envArray) {
  return (envArray || []).map((line) => {
    const idx = line.indexOf('=');
    if (idx === -1) return { key: line, value: '', masked: false };
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const sensitive = SENSITIVE_ENV_KEY_PATTERN.test(key);
    return { key, value: sensitive ? '••••••••' : value, masked: sensitive };
  });
}

/** docker ps (all=true, termasuk yang stopped) -- list ringkas buat tab Diagnostik. */
async function listAllContainers() {
  const containers = await docker.listContainers({ all: true });
  return containers
    .map((c) => ({
      id: c.Id.slice(0, 12),
      fullId: c.Id,
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      image: c.Image,
      state: c.State, // 'running' | 'exited' | 'created' | dst
      status: c.Status, // human-readable, misal "Up 3 hours"
      createdAt: new Date(c.Created * 1000).toISOString(),
      ports: (c.Ports || []).map((p) => ({
        private: p.PrivatePort ?? null,
        public: p.PublicPort ?? null,
        type: p.Type ?? null,
      })),
    }))
    // Running dulu baru yang stopped, dalam tiap grup urut nama -- biar konsisten,
    // bukan urutan acak dari Docker API.
    .sort((a, b) => {
      if (a.state === 'running' && b.state !== 'running') return -1;
      if (a.state !== 'running' && b.state === 'running') return 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Gabungan inspect + stats (one-shot, BUKAN stream) buat 1 container, di-flatten
 * jadi field yang manusiawi -- ZenVPS gak perlu ngerti format mentah Docker API.
 * Kalau container gak jalan (stopped), stats-nya dilewatin (Docker API nolak
 * `stats` buat container non-running), inspect tetap jalan.
 */
async function getContainerDetail(containerId) {
  const container = docker.getContainer(containerId);

  let info;
  try {
    info = await container.inspect();
  } catch (err) {
    throw new Error(`Container "${containerId}" tidak ditemukan: ${err.message}`);
  }

  const base = {
    id: info.Id.slice(0, 12),
    fullId: info.Id,
    name: (info.Name || '').replace(/^\//, ''),
    image: info.Config?.Image ?? null,
    state: info.State?.Status ?? 'unknown',
    startedAt: info.State?.StartedAt ?? null,
    finishedAt: info.State?.Status === 'running' ? null : info.State?.FinishedAt ?? null,
    restartCount: info.RestartCount ?? null,
    restartPolicy: info.HostConfig?.RestartPolicy?.Name ?? 'unknown',
    createdAt: info.Created ?? null,
    networks: Object.keys(info.NetworkSettings?.Networks || {}),
    ports: Object.entries(info.NetworkSettings?.Ports || {}).map(([containerPort, bindings]) => ({
      containerPort,
      hostBindings: (bindings || []).map((b) => `${b.HostIp || '0.0.0.0'}:${b.HostPort}`),
    })),
    mounts: (info.Mounts || []).map((m) => ({
      type: m.Type,
      source: m.Source,
      destination: m.Destination,
      readOnly: m.RW === false,
    })),
    env: maskEnvEntries(info.Config?.Env),
    resources: null, // diisi di bawah kalau state running
  };

  if (base.state !== 'running') {
    return base;
  }

  // Container.stats({stream:false}) -- one-shot snapshot, BUKAN stream
  // kontinu (yang butuh koneksi kebuka terus, gak cocok buat 1x request REST).
  let stats;
  try {
    stats = await container.stats({ stream: false });
  } catch (err) {
    // Stats gagal (jarang, misal container baru banget transisi state) --
    // tetap balikin info dasar, jangan gagal total (kebijakan Bagian 9).
    base.resourcesError = `Gagal ambil stats: ${err.message}`;
    return base;
  }

  base.resources = computeHumanReadableStats(stats);
  return base;
}

/** Rumus sama persis kayak yang dipakai `docker stats` CLI asli, biar angkanya konsisten sama yang tim udah biasa baca manual lewat SSH. */
function computeHumanReadableStats(stats) {
  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
  const onlineCpus = stats.cpu_stats?.online_cpus ?? stats.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
  const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

  const memUsageRaw = stats.memory_stats?.usage ?? 0;
  const memCache = stats.memory_stats?.stats?.cache ?? stats.memory_stats?.stats?.inactive_file ?? 0;
  const memUsage = Math.max(memUsageRaw - memCache, 0);
  const memLimit = stats.memory_stats?.limit ?? 0;
  const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

  const netRx = Object.values(stats.networks || {}).reduce((sum, n) => sum + (n.rx_bytes || 0), 0);
  const netTx = Object.values(stats.networks || {}).reduce((sum, n) => sum + (n.tx_bytes || 0), 0);

  const blkRead = (stats.blkio_stats?.io_service_bytes_recursive || []).find((e) => e.op === 'Read')?.value ?? 0;
  const blkWrite = (stats.blkio_stats?.io_service_bytes_recursive || []).find((e) => e.op === 'Write')?.value ?? 0;

  return {
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memUsageMB: Number((memUsage / 1024 / 1024).toFixed(2)),
    memLimitMB: Number((memLimit / 1024 / 1024).toFixed(2)),
    memPercent: Number(memPercent.toFixed(2)),
    netRxMB: Number((netRx / 1024 / 1024).toFixed(2)),
    netTxMB: Number((netTx / 1024 / 1024).toFixed(2)),
    blockReadMB: Number((blkRead / 1024 / 1024).toFixed(2)),
    blockWriteMB: Number((blkWrite / 1024 / 1024).toFixed(2)),
    pids: stats.pids_stats?.current ?? null,
  };
}

module.exports = {
  docker,
  getRestartCount,
  getRestartCountByAppUuid,
  resolveContainerIdByAppUuid,
  listDirectoryByAppUuid,
  listAllContainers,
  getContainerDetail,
};
