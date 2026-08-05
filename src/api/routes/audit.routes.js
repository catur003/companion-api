'use strict';

const express = require('express');
const audit = require('../../utils/audit');
const { checkPolicy } = require('../commandPolicy');

const router = express.Router();

// GET /audit/recent?limit=50 -- baca N entry terakhir dari audit.log.
// SENGAJA gak manggil audit.record() buat aksi baca ini sendiri - kalau
// dicatat, tiap buka layar Audit Log bakal nambah 1 entry baru ke log yang
// lagi dibaca (noise berulang tiap kali di-refresh/di-scroll).
router.get('/audit/recent', (req, res) => {
  const policy = checkPolicy('audit:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  const limitRaw = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

  try {
    const entries = audit.readRecent(limit);
    return res.json({ success: true, message: 'OK', code: 'OK', data: { entries } });
  } catch (err) {
    return res.status(502).json({
      success: false,
      message: err.message,
      code: 'AUDIT_READ_FAILED',
      data: null,
    });
  }
});

module.exports = router;
