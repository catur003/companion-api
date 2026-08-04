'use strict';

const express = require('express');
const dbBrowser = require('../../db/dbBrowser');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /db/schemas?databaseUuid=<uuid_server>
// Daftar schema/database di 1 server MySQL - buat "Numpang Server yang Ada"
// (informatif, cegah tabrakan nama) dan resolve schema project yang numpang.
router.get('/db/schemas', async (req, res) => {
  const { databaseUuid } = req.query;
  if (!databaseUuid) {
    return res.status(400).json({ success: false, message: 'Field wajib: databaseUuid.', code: 'BAD_REQUEST', data: null });
  }

  const policy = checkPolicy('db:list-schemas');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const schemas = await dbBrowser.listSchemas(databaseUuid);
    audit.record({ action: 'db:list-schemas', databaseUuid, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { schemas } });
  } catch (err) {
    audit.record({ action: 'db:list-schemas', databaseUuid, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

// POST /db/create-schema   body: { databaseUuid, newDbName, newUser, newPassword, confirmed }
// Bikin schema+user baru DI SERVER MySQL yang UDAH ADA (numpang, gak bikin
// container baru) - lihat catatan detail di dbBrowser.js (createSchema).
router.post('/db/create-schema', async (req, res) => {
  const { databaseUuid, newDbName, newUser, newPassword } = req.body || {};
  if (!databaseUuid || !newDbName || !newUser || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Field wajib: databaseUuid, newDbName, newUser, newPassword.',
      code: 'BAD_REQUEST',
      data: null,
    });
  }

  const policy = checkPolicy('db:create-schema');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }
  if (policy.confirmRequired && !req.body.confirmed) {
    return res.status(409).json({
      success: false,
      message: 'Bikin schema baru butuh konfirmasi eksplisit. Kirim ulang dengan "confirmed": true.',
      code: 'CONFIRMATION_REQUIRED',
      data: null,
    });
  }

  try {
    const result = await dbBrowser.createSchema(databaseUuid, { newDbName, newUser, newPassword });
    // PENTING: jangan pernah audit.record() password-nya.
    audit.record({ action: 'db:create-schema', databaseUuid, newDbName: result.newDbName, newUser: result.newUser, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'Schema berhasil dibuat.', code: 'OK', data: result });
  } catch (err) {
    audit.record({ action: 'db:create-schema', databaseUuid, newDbName, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

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
