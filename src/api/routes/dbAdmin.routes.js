'use strict';

const express = require('express');
const dbBrowser = require('../../db/dbBrowser');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// POST /db/reset-password   body: { databaseUuid, newPassword, confirmed }
// SENGAJA endpoint TERPISAH dari /db/query - cuma bisa ALTER USER, gak buka
// mutation umum. Lihat catatan detail di dbBrowser.js (resetPassword).
router.post('/db/reset-password', async (req, res) => {
  const { databaseUuid, newPassword } = req.body || {};
  if (!databaseUuid || !newPassword) {
    return res.status(400).json({ success: false, message: 'Field wajib: databaseUuid, newPassword.', code: 'BAD_REQUEST', data: null });
  }

  const policy = checkPolicy('db:reset-password');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }
  if (policy.confirmRequired && !req.body.confirmed) {
    return res.status(409).json({
      success: false,
      message: 'Reset password butuh konfirmasi eksplisit. Kirim ulang dengan "confirmed": true.',
      code: 'CONFIRMATION_REQUIRED',
      data: null,
    });
  }

  try {
    const result = await dbBrowser.resetPassword(databaseUuid, newPassword);
    // PENTING: jangan pernah audit.record() password-nya - cuma catat username & bahwa aksi ini kejadian.
    audit.record({ action: 'db:reset-password', databaseUuid, username: result.username, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'Password berhasil diganti.', code: 'OK', data: { username: result.username } });
  } catch (err) {
    audit.record({ action: 'db:reset-password', databaseUuid, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

module.exports = router;
