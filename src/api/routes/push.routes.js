'use strict';

const express = require('express');
const { setPushToken } = require('../../config/pushToken');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// POST /push-token { token: "ExponentPushToken[...]" } - dipanggil ZenVPS
// pas user aktifin notifikasi. Behind auth Bearer TOKEN biasa (beda dari
// /webhooks/coolify yang sengaja di luar auth).
router.post('/push-token', (req, res) => {
  const policy = checkPolicy('push-token:write');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, message: 'Field "token" wajib diisi.', code: 'MISSING_TOKEN', data: null });
  }

  try {
    setPushToken(token);
    audit.record({ action: 'push-token:write', ok: true });
    return res.json({ success: true, message: 'Push token tersimpan.', code: 'OK', data: null });
  } catch (err) {
    audit.record({ action: 'push-token:write', ok: false, error: err.message });
    return res.status(500).json({ success: false, message: err.message, code: 'PUSH_TOKEN_SAVE_FAILED', data: null });
  }
});

module.exports = router;
