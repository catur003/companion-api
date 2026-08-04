'use strict';

const config = require('../config/config');

/**
 * Batch B -- endpoint & field name TERVERIFIKASI lewat GET nyata ke instance
 * Coolify (Fase 1, 4 Agustus 2026): GET /api/v1/applications/{uuid} memang
 * mengembalikan field "post_deployment_command". Field READ sudah pasti benar.
 *
 * CATATAN JUJUR: yang diverifikasi baru arah BACA (GET). Belum ada bukti
 * langsung bahwa PATCH ke field yang sama benar-benar tersimpan (misal:
 * apakah field ini read-only/computed, apakah PATCH butuh field wajib lain
 * dikirim bareng). Wajib dites sekali dengan aplikasi non-production
 * (PORTOFOLIO) dan dicek ulang via GET setelah PATCH, baru boleh dianggap
 * verified end-to-end -- bukan diasumsikan cuma karena field-nya kebaca sama.
 */
async function sendPostDeploymentCommand({ applicationUuid, command }) {
  if (!config.coolify.apiBaseUrl || !config.coolify.apiToken) {
    throw new Error(
      '[coolifyDeploy] COOLIFY_API_BASE_URL / COOLIFY_API_TOKEN belum diisi.'
    );
  }
  if (!applicationUuid) {
    throw new Error('[coolifyDeploy] applicationUuid wajib diisi.');
  }

  const url = `${config.coolify.apiBaseUrl}/api/v1/applications/${applicationUuid}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${config.coolify.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ post_deployment_command: command }),
    });
  } catch (err) {
    throw new Error(`[coolifyDeploy] Gagal hubungi Coolify API: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `[coolifyDeploy] Coolify API balas ${res.status} -- gagal update post_deployment_command. ${body}`
    );
  }

  return res.json();
}

module.exports = { sendPostDeploymentCommand };
