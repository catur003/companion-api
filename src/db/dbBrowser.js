'use strict';

const config = require('../config/config');

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
  const execute = pickDriver(databaseType);

  const { rows, columns } = await execute(connectionString, sql);

  const truncated = rows.length > config.db.maxRows;
  return {
    columns,
    rows: truncated ? rows.slice(0, config.db.maxRows) : rows,
    rowCount: rows.length,
    truncated,
  };
}

module.exports = { getLiveConnectionString, runSelectQuery };
