'use strict';

const express = require('express');
const { getRestartCount, getRestartCountByAppUuid } = require('../../docker/docker');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /applications/:uuid/restart-count
// PAKAI INI dari ZenVPS, BUKAN /containers/:id/restart-count di bawah --
// applicationUuid Coolify stabil, container ID Docker BERUBAH tiap redeploy
// (temuan 4 Agustus 2026, lihat docker.js). Resolve container aktif dulu
// di server, bukan disimpan mentah di client.
router.get('/applications/:uuid/restart-count', async (req, res) => {
  const policy = checkPolicy('container:restart-count:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  const result = await getRestartCountByAppUuid(req.params.uuid);

  audit.record({
    action: 'container:restart-count:read',
    applicationUuid: req.params.uuid,
    ok: result.ok,
  });

  if (!result.ok) {
    return res.status(502).json({
      success: false,
      message: result.error,
      code: 'RESTART_COUNT_UNAVAILABLE',
      data: { restartCount: null },
    });
  }

  return res.json({ success: true, message: 'OK', code: 'OK', data: result });
});

// GET /containers/:id/restart-count
// LEGACY/DEBUG -- container ID mentah, BASI begitu ada redeploy. Dipertahankan
// buat debug manual lewat curl, TAPI JANGAN dipakai dari ZenVPS lagi.
router.get('/containers/:id/restart-count', async (req, res) => {
  const policy = checkPolicy('container:restart-count:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  const result = await getRestartCount(req.params.id);

  audit.record({
    action: 'container:restart-count:read',
    containerId: req.params.id,
    ok: result.ok,
  });

  if (!result.ok) {
    // Kebijakan error Bagian 9: tampilkan "-" + keterangan gagal, JANGAN 0.
    return res.status(502).json({
      success: false,
      message: result.error,
      code: 'RESTART_COUNT_UNAVAILABLE',
      data: { restartCount: null },
    });
  }

  return res.json({
    success: true,
    message: 'OK',
    code: 'OK',
    data: result,
  });
});

module.exports = router;
