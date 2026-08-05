'use strict';

/**
 * Semua konfigurasi lewat environment variable -- prinsip "no hardcode"
 * yang dipegang di seluruh dokumen migrasi (arsip SEA + PDF migrasi Coolify).
 *
 * Kebijakan error (Bagian 9 dokumen): gagal HARUS eksplisit & jelas, bukan diam-diam.
 * Kalau env var wajib kosong, Companion API menolak start sama sekali -- lebih baik
 * gagal keras di awal daripada gagal aneh di tengah request nanti.
 */

function requireEnv(name, { optional = false } = {}) {
  const value = process.env[name];
  if (!value && !optional) {
    throw new Error(
      `[config] Env var wajib "${name}" kosong. Cek file .env kamu (lihat .env.example). ` +
      `Companion API sengaja menolak start daripada jalan dengan config gak lengkap.`
    );
  }
  return value;
}

const config = {
  port: parseInt(process.env.PORT || '4100', 10),

  auth: {
    token: requireEnv('COMPANION_API_TOKEN'),
  },

  coolify: {
    // TODO(Fase 1): shape response Coolify /api/v1 belum pernah diverifikasi langsung
    // ke instance nyata. Field-field yang dipakai di src/db/dbBrowser.js dan
    // src/migrate/*.js masih ASUMSI dari OpenAPI spec, wajib dicek ulang begitu
    // ada instance Coolify hidup (Fase 0-1).
    // .replace(/\/+$/, '') -- buang trailing slash biar gak double-slash pas
    // di-gabung sama path /api/v1/... di tempat lain (dbBrowser.js, coolifyDeploy.js).
    apiBaseUrl: (requireEnv('COOLIFY_API_BASE_URL', { optional: true }) || '').replace(/\/+$/, '') || undefined,
    apiToken: requireEnv('COOLIFY_API_TOKEN', { optional: true }),
  },

  files: {
    // Root folder di DALAM container tempat source app di-build (konvensi
    // Nixpacks/Coolify: /app). Beda dari COOLIFY_VOLUMES_BASE_PATH lama --
    // itu asumsi host-volume yang terbukti SALAH (Fase 1: app container
    // stateless, gak ada named volume sama sekali, cuma DB yang ada).
    containerAppRoot: process.env.COMPANION_CONTAINER_APP_ROOT || '/app',
  },

  docker: {
    socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  },

  db: {
    // Cap hasil query di level aplikasi -- bukan ganti SQL user (resiko salah
    // rewrite buat query kompleks), cukup potong hasilnya & kasih tau kepotong.
    maxRows: parseInt(process.env.COMPANION_DB_MAX_ROWS || '500', 10),
  },

  audit: {
    logDir: process.env.AUDIT_LOG_DIR || './logs',
  },

  // Webhook Coolify -> push notification (5 Agustus 2026). Optional secara
  // teknis (requireEnv optional:true) TAPI endpoint webhook menolak semua
  // request kalau ini kosong (lihat webhook.routes.js) - lebih baik fitur
  // gak aktif sama sekali daripada endpoint publik tanpa proteksi sama
  // sekali (endpoint ini SENGAJA di luar authMiddleware Bearer token biasa,
  // karena Coolify manggil webhook custom gak selalu bisa disetel kirim
  // header Authorization).
  webhook: {
    secret: requireEnv('COOLIFY_WEBHOOK_SECRET', { optional: true }),
  },
};

module.exports = config;
