'use strict';

const express = require('express');
const config = require('../../config/config');
const { getPushToken } = require('../../config/pushToken');
const { sendExpoPush } = require('../../utils/pushNotify');
const { timingSafeEqual } = require('../../utils/timingSafeEqual');
const audit = require('../../utils/audit');

const router = express.Router();

/**
 * POST /webhooks/coolify/:secret - dipanggil COOLIFY (bukan ZenVPS), jadi
 * SENGAJA di luar authMiddleware Bearer token biasa (didaftarin sebelum
 * authMiddleware di server.js, sama kayak /health). Proteksinya lewat
 * secret di PATH, dicocokin ke COOLIFY_WEBHOOK_SECRET - dipilih path
 * (bukan header custom) karena field konfigurasi webhook custom Coolify
 * paling umum cuma "URL", belum tentu ada slot header tambahan.
 *
 * ⚠️ KNOWN RISK (dicatat dari code review 6 Agustus 2026): secret di URL
 * path berpotensi ke-CATAT di access log reverse proxy/Coolify kalau
 * logging default aktif (access log lazimnya nyatet full URL request,
 * termasuk path). Trade-off yang disengaja demi kompatibilitas config
 * webhook Coolify yang cuma terima 1 field URL - TAPI konsekuensinya perlu
 * disadari: (1) jangan expose log Coolify/Traefik ke pihak luar tanpa
 * redaksi, (2) rotate COOLIFY_WEBHOOK_SECRET berkala (ganti env var + URL
 * webhook di Coolify), bukan sekali set lalu dilupain selamanya.
 *
 * ⚠️ BELUM ADA VERIFIKASI LANGSUNG shape payload asli dari Coolify -
 * dokumentasi resmi nyebut ada "Webhook Payloads reference" tapi field
 * detailnya belum ketemu/kekonfirmasi. Parsing di bawah SENGAJA defensif:
 * coba beberapa nama field yang umum dipakai (type/event, status, nama
 * resource), kalau semua meleset tetep kirim notifikasi generik + raw
 * payload (dipotong) di badan pesan - USER WAJIB TES 1x TRIGGER ASLI buat
 * verifikasi field mana yang bener kepake, baru dianggap final.
 */
router.post('/webhooks/coolify/:secret', async (req, res) => {
  if (!config.webhook.secret) {
    return res.status(503).json({
      success: false,
      message: 'Fitur webhook belum aktif - COOLIFY_WEBHOOK_SECRET belum diset di .env Companion API.',
      code: 'WEBHOOK_NOT_CONFIGURED',
      data: null,
    });
  }

  // FIX (6 Agustus 2026, dari code review): compare timing-safe, bukan `!==`
  // biasa - konsisten sama pola tokensMatch di auth.js (sekarang sama-sama
  // pakai util timingSafeEqual.js). Resiko aslinya kecil (secret acak +
  // panjang), tapi gak ada alasan buat gak konsisten.
  if (!timingSafeEqual(req.params.secret, config.webhook.secret)) {
    // Sengaja 404, bukan 403 - jangan kasih tau penyerang bahwa endpoint
    // ini ADA tapi secret-nya salah (least information disclosure).
    return res.status(404).json({ success: false, message: 'Not found', code: 'NOT_FOUND', data: null });
  }

  const payload = req.body || {};
  const { title, body } = summarizePayload(payload);

  try {
    const token = getPushToken();
    await sendExpoPush(token, title, body, { raw: payload });
    audit.record({ action: 'webhook:coolify:received', ok: true, title });
    return res.json({ success: true, message: 'Notifikasi terkirim.', code: 'OK', data: null });
  } catch (err) {
    audit.record({ action: 'webhook:coolify:received', ok: false, error: err.message });
    // Tetap balikin 200 ke Coolify walau push gagal - Coolify gak perlu
    // tau/retry gara-gara push token kita belum disetel, itu masalah sisi
    // ZenVPS, bukan sisi pengiriman webhook-nya.
    return res.json({ success: false, message: err.message, code: 'PUSH_SEND_FAILED', data: null });
  }
});

/**
 * Coba beberapa nama field umum, urutan prioritas. Field yang PASTI ada di
 * hampir semua payload webhook: sesuatu kayak "type"/"event" - itu yang
 * dipakai buat judul kalau ketemu. Kalau semua field yang dicoba gak ada
 * satupun, fallback ke JSON mentah (dipotong) biar user tetep dapet info,
 * bukan notifikasi kosong.
 */
function summarizePayload(payload) {
  const eventType = payload.type || payload.event || payload.notification_type || payload.event_type;
  const status = payload.status || payload.deployment_status;
  const resourceName =
    payload.application_name || payload.resource_name || payload.name || payload.project_name || payload.server_name;

  if (eventType || status || resourceName) {
    const title = humanizeEventType(eventType) || 'Notifikasi Coolify';
    const bodyParts = [resourceName, status].filter(Boolean);
    return {
      title,
      body: bodyParts.length > 0 ? bodyParts.join(' - ') : 'Ada event baru dari Coolify.',
    };
  }

  // Fallback total - field yang dicoba semua meleset. Raw payload dipotong
  // biar notifikasi gak kepanjangan, tapi tetap ada info buat debug.
  const raw = JSON.stringify(payload);
  return {
    title: 'Notifikasi Coolify (format belum dikenali)',
    body: raw.length > 150 ? `${raw.slice(0, 150)}…` : raw,
  };
}

function humanizeEventType(eventType) {
  if (!eventType || typeof eventType !== 'string') return null;
  const map = {
    'deployment.success': 'Deploy Berhasil',
    'deployment.failed': 'Deploy Gagal',
    'application.deployment.success': 'Deploy Berhasil',
    'application.deployment.failed': 'Deploy Gagal',
    'server.unreachable': 'Server Tidak Terjangkau',
    'container.stopped': 'Container Berhenti',
    'backup.success': 'Backup Berhasil',
    'backup.failed': 'Backup Gagal',
  };
  return map[eventType] || eventType;
}

module.exports = router;
