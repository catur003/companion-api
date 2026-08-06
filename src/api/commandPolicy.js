'use strict';

/**
 * Diadaptasi dari pola commandPolicy.js di vps-manager (backend lama):
 * whitelist per-action, default-deny -- action yang gak terdaftar di sini
 * TIDAK BISA dipanggil sama sekali, walau route-nya kebetulan ada.
 *
 * Ini pola yang TIDAK disebut eksplisit di dokumen migrasi PDF, tapi konsisten
 * dengan prinsip least-privilege di Bagian 8 -- sengaja dipertahankan karena
 * lebih ketat dari sekadar "audit trail".
 *
 * confirmRequired: true  -> ZenVPS app wajib minta konfirmasi eksplisit dari user
 *                           sebelum action ini dipanggil (mis. push --accept-data-loss)
 * auditLevel: 'info' | 'warn' -> seberapa "berbahaya" action ini buat dicatat
 */

const POLICY = Object.freeze({
  'files:read': { confirmRequired: false, auditLevel: 'info' },
  'files:write': { confirmRequired: true, auditLevel: 'warn' },

  'db:query:select': { confirmRequired: false, auditLevel: 'info' },
  'db:query:mutate': { confirmRequired: true, auditLevel: 'warn' },
  // ALTER USER doang, endpoint terpisah dari mutation umum - lihat dbBrowser.js.
  'db:reset-password': { confirmRequired: true, auditLevel: 'warn' },
  // Read-only, cuma informatif (nama schema di server, bukan isi datanya).
  'db:list-schemas': { confirmRequired: false, auditLevel: 'info' },
  // CREATE DATABASE + CREATE USER + GRANT ke database itu doang (via koneksi
  // root, scoped ketat) - bikin kredensial baru, wajib konfirmasi.
  'db:create-schema': { confirmRequired: true, auditLevel: 'warn' },
  // FIX (6 Agustus 2026, dari code review): dulu DELETE database ikut numpang
  // policy 'db:create-schema' (alasan asli: "sama sensitifnya") - secara
  // proteksi gak bocor (confirmRequired sama-sama true), TAPI audit log jadi
  // menyesatkan buat forensik ("siapa hapus database X" nongolnya
  // "db:create-schema", bukan hapus). Key sendiri, severity sama.
  'db:drop-schema': { confirmRequired: true, auditLevel: 'warn' },
  // Import: eksekusi ISI FILE MENTAH (bukan query dibatasi kayak yang lain) -
  // paling "terbuka" dari semua endpoint, wajib konfirmasi.
  'db:import': { confirmRequired: true, auditLevel: 'warn' },
  // Export: read-only (dump doang), gak perlu konfirmasi.
  'db:export': { confirmRequired: false, auditLevel: 'info' },

  'db:migrate:generate': { confirmRequired: false, auditLevel: 'info' },
  'db:migrate:push': { confirmRequired: false, auditLevel: 'info' },
  'db:migrate:push_force': { confirmRequired: true, auditLevel: 'warn' },
  // FIX (4 Agustus 2026): key sebelumnya "migrate_deploy" gak pernah match --
  // commandGenerator.js makein mode "migrate" (bukan "migrate_deploy"), jadi
  // action yang dicek selalu "db:migrate:migrate", default-deny nolak semua
  // request mode ini walau harusnya diizinkan. Ketauan dari bug report user.
  'db:migrate:migrate': { confirmRequired: false, auditLevel: 'info' },
  'db:migrate:seed': { confirmRequired: true, auditLevel: 'warn' },
  // Laravel (BARU 6 Agustus 2026) - "migrate_force" = `php artisan migrate --force`,
  // WAJIB dipakai di production (Laravel nolak migrate tanpa --force kalau
  // APP_ENV=production, demi cegah migrate gak sengaja) - TAPI tetap
  // confirmRequired:true di sini karena sifatnya sama kayak push_force:
  // bisa gagal/rusak data kalau migration-nya emang destruktif (drop column dst).
  'db:migrate:migrate_force': { confirmRequired: true, auditLevel: 'warn' },
  // Command custom (bukan hasil generateCommand) - user compose/gabung sendiri
  // (mis. "push && seed" jadi 1 command biar gak 2x redeploy). SELALU minta
  // konfirmasi eksplisit, terlepas isinya apa - beda dari mode terstruktur di
  // atas yang udah diverifikasi commandGenerator.js, ini sepenuhnya kontrol user.
  'db:migrate:custom': { confirmRequired: true, auditLevel: 'warn' },

  'container:restart-count:read': { confirmRequired: false, auditLevel: 'info' },

  // Tab Diagnostik - docker ps/inspect/stats, READ-ONLY MURNI (Bagian 8).
  // Env var di-mask server-side sebelum dikirim (lihat maskEnvEntries di docker.js).
  'diagnostics:containers:read': { confirmRequired: false, auditLevel: 'info' },

  // Baca riwayat audit log (fitur Audit Log ZenVPS) - read-only murni.
  'audit:read': { confirmRequired: false, auditLevel: 'info' },

  // Simpan push token device (fitur notifikasi) - bukan aksi destruktif,
  // gak perlu konfirmasi.
  'push-token:write': { confirmRequired: false, auditLevel: 'info' },

  // Laravel (6 Agustus 2026) - `key:generate --show` doang, TIDAK nulis
  // apa-apa (lihat komentar di laravel.routes.js) - aman diulang berkali-kali,
  // gak perlu konfirmasi. Aksi DESTRUKTIF-nya (nge-set jadi APP_KEY beneran)
  // itu di sisi ZenVPS lewat endpoint Coolify env vars, bukan di sini.
  'laravel:key-generate': { confirmRequired: false, auditLevel: 'info' },

  // Dashboard VPS info (CPU/RAM/disk/dst) - read-only, gak butuh sudo.
  'system:status:read': { confirmRequired: false, auditLevel: 'info' },
  // Diagnostik keamanan (firewall/fail2ban/ssh-config/ports) - read-only,
  // TAPI butuh sudo di level OS (lihat catatan di system/security.js).
  'system:security:read': { confirmRequired: false, auditLevel: 'info' },

  // Edit mapping project (key/name/applicationUuid/databaseUuid) - bukan
  // aksi destruktif ke infra Coolify/DB manapun, cuma edit file lokal
  // projects.json. Gak butuh konfirmasi.
  'projects:write': { confirmRequired: false, auditLevel: 'info' },
});

function checkPolicy(action) {
  const rule = POLICY[action];
  if (!rule) {
    // Default-deny: action gak dikenal = ditolak, bukan diam-diam lolos.
    return { allowed: false, reason: `Action "${action}" tidak terdaftar di command policy.` };
  }
  return { allowed: true, ...rule };
}

module.exports = { checkPolicy, POLICY };
