'use strict';

const express = require('express');
const monitor = require('../../system/monitor');
const security = require('../../system/security');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /system/status - Dashboard VPS info (server online/uptime/cpu/ram/disk/load average).
// Read-only, gak butuh sudo sama sekali.
router.get('/system/status', (req, res) => {
  const policy = checkPolicy('system:status:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const status = monitor.getStatus();
    audit.record({ action: 'system:status:read', ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { ...status, online: true } });
  } catch (err) {
    audit.record({ action: 'system:status:read', ok: false, error: err.message });
    return res.status(500).json({ success: false, message: err.message, code: 'MONITOR_FAILED', data: null });
  }
});

// Diagnostik keamanan - firewall (ufw) & fail2ban DIBUANG (butuh sudo,
// keputusan user: skip daripada nambah privilege footprint). Sisa 2 ini
// TANPA sudo (lihat catatan detail di system/security.js).
router.get('/system/ssh-config', (req, res) => {
  const policy = checkPolicy('system:security:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }
  const result = security.checkSshConfig();
  audit.record({ action: 'system:security:read', check: 'ssh-config', ok: result.ok, auditLevel: policy.auditLevel });
  return res.json({ success: true, message: 'OK', code: 'OK', data: result });
});

router.get('/system/open-ports', (req, res) => {
  const policy = checkPolicy('system:security:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }
  const result = security.listOpenPorts();
  audit.record({ action: 'system:security:read', check: 'open-ports', ok: result.ok, auditLevel: policy.auditLevel });
  return res.json({ success: true, message: 'OK', code: 'OK', data: result });
});

module.exports = router;
