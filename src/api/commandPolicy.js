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

  'db:migrate:push': { confirmRequired: false, auditLevel: 'info' },
  'db:migrate:push_force': { confirmRequired: true, auditLevel: 'warn' },
  'db:migrate:migrate_deploy': { confirmRequired: false, auditLevel: 'info' },
  'db:migrate:seed': { confirmRequired: true, auditLevel: 'warn' },

  'container:restart-count:read': { confirmRequired: false, auditLevel: 'info' },
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
