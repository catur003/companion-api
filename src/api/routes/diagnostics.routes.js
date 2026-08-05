'use strict';

const express = require('express');
const { listAllContainers, getContainerDetail } = require('../../docker/docker');
const { listProjects } = require('../../config/projects');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// Nama resmi container infra Coolify sendiri (exact match, TANPA suffix
// timestamp - beda dari container app yang formatnya "{applicationUuid}-{ts}").
// Dikonfirmasi dari observasi `docker stats` manual user (5 Agustus 2026).
const KNOWN_COOLIFY_INFRA_NAMES = new Set([
  'coolify',
  'coolify-db',
  'coolify-proxy',
  'coolify-redis',
  'coolify-realtime',
  'coolify-sentinel',
]);

/**
 * Container name Coolify formatnya "{applicationUuid}-{timestamp}" - UUID
 * acak, gak kebaca manusia (feedback user 5 Agustus 2026: "susah dibedain").
 * Cocokkan ke projects.json yang UDAH ADA (dipakai fitur lain: restart-count,
 * files, dst) buat kasih nama yang dikenal, TANPA nambah sumber data baru.
 */
function enrichWithFriendlyName(containers) {
  let projects = [];
  try {
    projects = listProjects();
  } catch {
    // projects.json belum ada/gagal kebaca - bukan fatal buat fitur ini,
    // cukup semua container fallback ke "gak dikenal" (raw name apa adanya).
    projects = [];
  }

  return containers.map((c) => {
    if (KNOWN_COOLIFY_INFRA_NAMES.has(c.name)) {
      return { ...c, friendlyName: 'Infra Coolify', category: 'infra' };
    }
    const match = projects.find((p) => c.name.startsWith(`${p.applicationUuid}-`));
    if (match) {
      return { ...c, friendlyName: match.name, category: 'app' };
    }
    return { ...c, friendlyName: null, category: 'unknown' };
  });
}

// GET /diagnostics/containers -- docker ps (semua container, termasuk infra
// Coolify sendiri: coolify-db, coolify-proxy, dst -- tab ini diagnostik VPS
// secara umum, bukan scoped per-app).
router.get('/diagnostics/containers', async (req, res) => {
  const policy = checkPolicy('diagnostics:containers:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const containers = enrichWithFriendlyName(await listAllContainers());
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
    const [enriched] = enrichWithFriendlyName([detail]);
    audit.record({ action: 'diagnostics:containers:read', ok: true, containerId: req.params.id });
    return res.json({ success: true, message: 'OK', code: 'OK', data: enriched });
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
