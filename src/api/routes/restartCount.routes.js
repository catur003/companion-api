'use strict';

const express = require('express');
const { getRestartCount } = require('../../docker/docker');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /containers/:id/restart-count
// Batch A -- fungsional sekarang, gak bergantung Coolify API.
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
