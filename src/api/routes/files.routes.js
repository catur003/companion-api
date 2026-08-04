'use strict';

const express = require('express');
const fileManager = require('../../files/fileManager');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /files?container=<docker_container_id>&path=Y
// NOTE: "container" wajib ID/nama container Docker asli (ambil dari response
// Coolify API pas deploy), BUKAN nama project manusia -- sejak Fase 1
// terbukti gak ada volume per-project yang bisa dipetakan dari nama project.
router.get('/files', async (req, res) => {
  const { container, path: relativePath } = req.query;
  const policy = checkPolicy('files:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const content = await fileManager.readFile(container, relativePath);
    audit.record({ action: 'files:read', container, path: relativePath, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { content } });
  } catch (err) {
    audit.record({ action: 'files:read', container, path: relativePath, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

// PUT /files?container=<docker_container_id>&path=Y   body: { content }
router.put('/files', async (req, res) => {
  const { container, path: relativePath } = req.query;
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
    await fileManager.writeFile(container, relativePath, req.body?.content ?? '');
    audit.record({ action: 'files:write', container, path: relativePath, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'Tersimpan.', code: 'OK', data: null });
  } catch (err) {
    audit.record({ action: 'files:write', container, path: relativePath, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

module.exports = router;
