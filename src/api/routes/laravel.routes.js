'use strict';

const express = require('express');
const { resolveContainerIdByAppUuid, execWhitelistedCommand } = require('../../docker/docker');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// POST /laravel/generate-key { applicationUuid }
// `php artisan key:generate --show` - CUMA nge-print key, TIDAK nulis ke
// .env apapun (container Coolify stateless, gak ada .env buat ditulis pun).
// Nge-SET key ini jadi APP_KEY beneran itu LANGKAH TERPISAH, dilakuin lewat
// endpoint Coolify env vars yang UDAH ADA (setCoolifyApplicationEnvsBulk di
// ZenVPS) - sengaja dipisah karena ganti APP_KEY app yang udah jalan
// ngerusak semua session/cookie/data terenkripsi lama.
router.post('/laravel/generate-key', async (req, res) => {
  const policy = checkPolicy('laravel:key-generate');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  const { applicationUuid } = req.body || {};
  if (!applicationUuid) {
    return res.status(400).json({ success: false, message: 'Field wajib: applicationUuid.', code: 'BAD_REQUEST', data: null });
  }

  try {
    const containerId = await resolveContainerIdByAppUuid(applicationUuid);
    const output = await execWhitelistedCommand(containerId, 'key:generate:show');
    audit.record({ action: 'laravel:key-generate', ok: true, applicationUuid });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { key: output } });
  } catch (err) {
    audit.record({ action: 'laravel:key-generate', ok: false, applicationUuid, error: err.message });
    return res.status(502).json({ success: false, message: err.message, code: 'LARAVEL_KEY_GENERATE_FAILED', data: null });
  }
});

module.exports = router;
