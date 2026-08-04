'use strict';

const config = require('../config/config');
const { docker } = require('../docker/docker');

/**
 * TEMUAN PENTING (tes nyata, bukan asumsi): Companion API jalan sebagai proses
 * Node biasa di HOST VPS (via pm2/npm start, sesuai Bagian 7 dokumen), BUKAN
 * sebagai container Docker. Hostname di "internal_db_url" (mis.
 * "w9j9c3qkkpfg9r3tco4st5f8") itu Docker-internal DNS name -- cuma bisa
 * di-resolve dari DALAM container yang nempel ke Docker network yang sama
 * (embedded DNS Docker di 127.0.0.11). Proses host biasa gak punya akses ke
 * situ -- gagal dengan getaddrinfo EAI_AGAIN, bukan bug di kode ini.
 *
 * Fix: resolve IP container-nya manual lewat Docker API (docker inspect via
 * dockerode), ganti hostname di connection string jadi IP langsung sebelum
 * connect -- bypass DNS OS sepenuhnya.
 */
async function resolveDockerHostToIp(hostname) {
  const containers = await docker.listContainers({ all: false });

  const match = containers.find((c) => {
    const nameMatch = c.Names.some((n) => n.replace(/^\//, '') === hostname);
    const aliasMatch = Object.values(c.NetworkSettings?.Networks || {}).some((net) =>
      (net.Aliases || []).includes(hostname)
    );
    return nameMatch || aliasMatch;
  });

  if (!match) {
    throw new Error(
      `Hostname Docker "${hostname}" gak ketemu sebagai container/network alias di host ini -- ` +
      `pastikan Companion API jalan di VPS yang sama dengan database-nya.`
    );
  }

  const networks = match.NetworkSettings?.Networks || {};
  const ip = Object.values(networks)[0]?.IPAddress;
  if (!ip) {
    throw new Error(`Container buat hostname "${hostname}" ketemu, tapi gak punya IP address di network manapun.`);
  }

  return ip;
}

async function rewriteConnectionStringHost(connectionString) {
  const url = new URL(connectionString);
  const originalHost = url.hostname;

  try {
    const ip = await resolveDockerHostToIp(originalHost);
    url.hostname = ip;
    return url.toString();
  } catch (err) {
    throw new Error(`[dbBrowser] Gagal resolve hostname Docker "${originalHost}": ${err.message}`);
  }
}

/**
 * CONFIRMED Fase 1 (2026-08-03, tes langsung ke instance Coolify nyata):
 * GET /api/v1/databases mengembalikan field "internal_db_url" berisi
 * connection string LENGKAP siap pakai (termasuk kredensial). Desain Bagian 6
 * "ambil live dari Coolify API tiap request" -- terkonfirmasi, bukan lagi asumsi.
 *
 * PERINGATAN KEAMANAN: response /api/v1/databases juga balikin field lain yang
 * berisi password PLAINTEXT (mysql_password, mysql_root_password, dst).
 * Companion API HANYA boleh ambil field "internal_db_url" dari response ini --
 * field lainnya TIDAK BOLEH disimpan, di-log, atau diteruskan ke response
 * Companion API sendiri. Jangan pernah audit.record() connection string utuh.
 */

async function fetchDatabaseByUuid(uuid) {
  const res = await fetch(`${config.coolify.apiBaseUrl}/api/v1/databases/${uuid}`, {
    headers: { Authorization: `Bearer ${config.coolify.apiToken}` },
  });

  if (!res.ok) {
    throw new Error(`[dbBrowser] Coolify API balas status ${res.status} untuk database "${uuid}".`);
  }

  return res.json();
}

/**
 * Beda dari getLiveConnectionString() lama -- fungsi ini juga butuh
 * database_type buat milih driver (mysql2 vs pg). Tetap pegang prinsip yang
 * sama: cuma field yang dibutuhkan yang di-pull keluar, sisanya (password
 * plaintext dll) dibuang begitu fungsi ini selesai, gak pernah disimpan.
 */
async function fetchConnectionInfo(databaseUuid) {
  if (!config.coolify.apiBaseUrl || !config.coolify.apiToken) {
    throw new Error('[dbBrowser] COOLIFY_API_BASE_URL / COOLIFY_API_TOKEN belum diisi.');
  }

  const data = await fetchDatabaseByUuid(databaseUuid);

  if (!data.internal_db_url) {
    throw new Error(
      `[dbBrowser] Database "${databaseUuid}" tidak punya "internal_db_url" -- ` +
      `cek apakah tipe database ini (${data.database_type || 'unknown'}) punya field yang sama.`
    );
  }

  return {
    connectionString: data.internal_db_url,
    databaseType: data.database_type || '',
  };
}

async function getLiveConnectionString(databaseUuid) {
  const { connectionString } = await fetchConnectionInfo(databaseUuid);
  return connectionString;
}

/**
 * startsWith('select') doang gampang dibobol: comment sebelum keyword
 * (/*x*\/SELECT), CTE yang isinya mutasi (WITH x AS (INSERT ...) SELECT ...),
 * atau multi-statement (SELECT 1; DROP TABLE ...). Validasi ini bukan pengganti
 * DB user read-only (itu tetap wajib di production), tapi menutup bypass paling
 * gampang di level aplikasi.
 */
function assertSafeSelect(sql) {
  // Buang comment -- , /* */ dulu supaya gak bisa nyembunyiin keyword berbahaya.
  const stripped = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (!stripped) {
    throw new Error('[dbBrowser] Query kosong setelah comment dibuang.');
  }

  // Tolak multi-statement: cuma boleh ada 1 statement (';' opsional di akhir).
  const withoutTrailingSemicolon = stripped.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    throw new Error('[dbBrowser] Multi-statement tidak diizinkan (ada ";" di tengah query).');
  }

  const lower = withoutTrailingSemicolon.trim().toLowerCase();

  if (!lower.startsWith('select') && !lower.startsWith('with')) {
    throw new Error('[dbBrowser] Hanya query SELECT (boleh diawali WITH/CTE) yang diizinkan lewat endpoint ini.');
  }

  // Kata kunci mutasi/berbahaya -- ditolak di mana pun posisinya, termasuk di
  // dalam CTE (WITH x AS (INSERT ...) SELECT ...) atau lewat INTO OUTFILE.
  const forbidden = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|replace|merge|call|exec|execute|into\s+outfile|into\s+dumpfile|copy\s)\b/i;
  if (forbidden.test(lower)) {
    throw new Error('[dbBrowser] Query mengandung keyword yang tidak diizinkan (bukan SELECT murni).');
  }
}

/**
 * Koneksi dibuat baru tiap request, ditutup begitu selesai -- prinsip Bagian 6:
 * "connection string tidak disimpan di Companion API, diambil live tiap request",
 * jadi wajar koneksinya juga gak di-pool/disimpan lama di memori.
 */
async function executeMysql(connectionString, sql) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(connectionString);
  try {
    const [rows, fields] = await conn.query(sql);
    return { rows, columns: fields?.map((f) => f.name) ?? [] };
  } finally {
    await conn.end().catch(() => {});
  }
}

async function executePostgres(connectionString, sql) {
  const { Client } = require('pg');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(sql);
    return { rows: result.rows, columns: result.fields?.map((f) => f.name) ?? [] };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * database_type dari Coolify API belum pernah dicek nilai persisnya buat
 * SEMUA tipe (baru confirmed lewat instance yang ada: mysql & postgres).
 * Sengaja match longgar pakai includes() (bukan exact-match daftar tetap),
 * supaya varian penamaan (mis. "standalone-mysql" vs "mysql") tetap kena --
 * tapi tetap default ke error eksplisit kalau gak dikenali sama sekali,
 * BUKAN nebak salah satu driver secara diam-diam.
 */
function pickDriver(databaseType) {
  const t = (databaseType || '').toLowerCase();
  if (t.includes('postgres')) return executePostgres;
  if (t.includes('mysql') || t.includes('mariadb')) return executeMysql;
  throw new Error(
    `[dbBrowser] database_type "${databaseType}" belum didukung driver-nya -- ` +
    `baru mysql/mariadb & postgres yang di-wire. Tolak eksekusi daripada nebak driver.`
  );
}

async function runSelectQuery(databaseUuid, sql) {
  assertSafeSelect(sql);

  const { connectionString, databaseType } = await fetchConnectionInfo(databaseUuid);
  const resolvedConnectionString = await rewriteConnectionStringHost(connectionString);
  const execute = pickDriver(databaseType);

  const { rows, columns } = await execute(resolvedConnectionString, sql);

  const truncated = rows.length > config.db.maxRows;
  return {
    columns,
    rows: truncated ? rows.slice(0, config.db.maxRows) : rows,
    rowCount: rows.length,
    truncated,
  };
}

/**
 * SENGAJA fungsi TERPISAH dari runSelectQuery, BUKAN buka pintu mutation
 * umum. Cuma bisa jalanin 1 hal spesifik: ALTER USER buat ganti password
 * user yang sama persis kayak yang ada di internal_db_url (username diambil
 * dari situ, BUKAN dari input user - user cuma kasih password baru).
 * confirmed:true wajib (lihat commandPolicy.js) - ganti password disconnect
 * semua koneksi yang masih pakai password lama sampai env di-update.
 */
async function resetPassword(databaseUuid, newPassword) {
  const { connectionString, databaseType } = await fetchConnectionInfo(databaseUuid);
  const resolvedConnectionString = await rewriteConnectionStringHost(connectionString);
  const username = decodeURIComponent(new URL(connectionString).username);

  const t = (databaseType || '').toLowerCase();

  if (t.includes('mysql') || t.includes('mariadb')) {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection(resolvedConnectionString);
    try {
      // Placeholder ? di posisi account-spec ('user'@'host') tetap aman --
      // mysql2 auto-quote string value, hasilnya persis syntax yang dibutuhin.
      await conn.query('ALTER USER ?@? IDENTIFIED BY ?', [username, '%', newPassword]);
      await conn.query('FLUSH PRIVILEGES');
    } finally {
      await conn.end().catch(() => {});
    }
  } else if (t.includes('postgres')) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: resolvedConnectionString });
    await client.connect();
    try {
      // Postgres: password BISA di-parameterize ($1), username (identifier)
      // gak bisa -- tapi itu dari internal_db_url Coolify sendiri (trusted),
      // bukan input user, jadi aman di-embed langsung (tetap di-escape kutip).
      await client.query(`ALTER USER "${username.replace(/"/g, '""')}" WITH PASSWORD $1`, [newPassword]);
    } finally {
      await client.end().catch(() => {});
    }
  } else {
    throw new Error(`[dbBrowser] Reset password belum didukung buat database_type "${databaseType}".`);
  }

  return { username };
}

module.exports = { getLiveConnectionString, runSelectQuery, resetPassword };
