'use strict';

const express = require('express');
const { listAllContainers, getContainerDetail } = require('../../docker/docker');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /diagnostics/containers -- docker ps (semua container, termasuk infra
// Coolify sendiri: coolify-db, coolify-proxy, dst -- tab ini diagnostik VPS
// secara umum, bukan scoped per-app).
router.get('/diagnostics/containers', async (req, res) => {
  const policy = checkPolicy('diagnostics:containers:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const containers = await listAllContainers();
    audit.record({ action: 'diagnostics:containers:read', ok: true, count: containers.length });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { containers } });
  } catch (err) {
    audit.record({ action: 'diagnostics:containers:read', ok: false, error: err.message });
    return res.status(502).json({
      success: false,
      message: `Gagal ambil daftar container: ${err.message}`,
      code: 'DOCKER_PS_FAILED',
      data: null,
    });
  }
});

// GET /diagnostics/containers/:id -- inspect + stats digabung, di-flatten
// jadi field manusiawi. :id boleh short ID (12 char) atau full ID.
router.get('/diagnostics/containers/:id', async (req, res) => {
  const policy = checkPolicy('diagnostics:containers:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const detail = await getContainerDetail(req.params.id);
    audit.record({ action: 'diagnostics:containers:read', ok: true, containerId: req.params.id });
    return res.json({ success: true, message: 'OK', code: 'OK', data: detail });
  } catch (err) {
    audit.record({ action: 'diagnostics:containers:read', ok: false, containerId: req.params.id, error: err.message });
    return res.status(502).json({
      success: false,
      message: err.message,
      code: 'DOCKER_INSPECT_FAILED',
      data: null,
    });
  }
});

module.exports = router;
