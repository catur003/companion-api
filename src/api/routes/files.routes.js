'use strict';

const express = require('express');
const fileManager = require('../../files/fileManager');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /files?applicationUuid=<uuid_coolify>&path=Y
// UBAH (4 Agustus 2026): dulu "container" (Docker container ID mentah) --
// BASI begitu ada redeploy, ID-nya berubah tiap kali (lihat docker.js).
// Sekarang applicationUuid Coolify (stabil), resolve container aktif di
// server tiap request.
router.get('/files', async (req, res) => {
  const { applicationUuid, path: relativePath } = req.query;
  const policy = checkPolicy('files:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const content = await fileManager.readFile(applicationUuid, relativePath);
    audit.record({ action: 'files:read', applicationUuid, path: relativePath, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { content } });
  } catch (err) {
    audit.record({ action: 'files:read', applicationUuid, path: relativePath, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

// PUT /files?applicationUuid=<uuid_coolify>&path=Y   body: { content }
router.put('/files', async (req, res) => {
  const { applicationUuid, path: relativePath } = req.query;
  const policy = checkPolicy('files:write');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  if (policy.confirmRequired && !req.body?.confirmed) {
    return res.status(409).json({
      success: false,
      message: 'Tulis file butuh konfirmasi eksplisit. Kirim ulang dengan "confirmed": true.',
      code: 'CONFIRMATION_REQUIRED',
      data: null,
    });
  }

  try {
    await fileManager.writeFile(applicationUuid, relativePath, req.body?.content ?? '');
    audit.record({ action: 'files:write', applicationUuid, path: relativePath, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'Tersimpan.', code: 'OK', data: null });
  } catch (err) {
    audit.record({ action: 'files:write', applicationUuid, path: relativePath, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

module.exports = router;
