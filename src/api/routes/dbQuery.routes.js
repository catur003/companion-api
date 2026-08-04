'use strict';

const express = require('express');
const dbBrowser = require('../../db/dbBrowser');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// POST /db/query   body: { databaseUuid, sql, schema? }
// "schema" (BARU, 4 Agustus 2026) - buat project yang numpang 1 server MySQL
// (bukan schema default Coolify). Lihat catatan detail di runSelectQuery.
router.post('/db/query', async (req, res) => {
  const { databaseUuid, sql, schema } = req.body || {};
  if (!databaseUuid || !sql) {
    return res.status(400).json({
      success: false,
      message: 'Field wajib: databaseUuid, sql.',
      code: 'BAD_REQUEST',
      data: null,
    });
  }

  const isMutation = !sql.trim().toLowerCase().startsWith('select');
  const action = isMutation ? 'db:query:mutate' : 'db:query:select';
  const policy = checkPolicy(action);
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  if (policy.confirmRequired && !req.body.confirmed) {
    return res.status(409).json({
      success: false,
      message: `Query mutasi butuh konfirmasi eksplisit. Kirim ulang dengan "confirmed": true.`,
      code: 'CONFIRMATION_REQUIRED',
      data: null,
    });
  }

  // CATATAN: dbBrowser.runSelectQuery() sekarang cuma dukung SELECT (lihat
  // assertSafeSelect). Jalur "mutasi + confirmed:true" di atas masih dead-code
  // -- lolos gate konfirmasi tapi tetap ditolak assertSafeSelect di belakang.
  // Ini SENGAJA dibiarkan gagal eksplisit, bukan dihapus diam-diam, sampai
  // diputuskan: mutasi lewat endpoint ini benar mau didukung atau tidak
  // (desain awal Bagian 6 bilang "opsional", belum final).
  try {
    const result = await dbBrowser.runSelectQuery(databaseUuid, sql, schema);
    audit.record({ action, databaseUuid, schema, sql, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: result });
  } catch (err) {
    audit.record({ action, databaseUuid, schema, sql, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

module.exports = router;
