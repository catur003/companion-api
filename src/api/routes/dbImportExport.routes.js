'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const dbBrowser = require('../../db/dbBrowser');
const jobs = require('../../config/jobs');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// Folder sementara buat file upload - dihapus otomatis abis import selesai
// (sukses ATAU gagal), gak dibiarin numpuk.
const TMP_IMPORT_DIR = process.env.COMPANION_IMPORT_TMP_DIR || path.join(os.tmpdir(), 'companion-imports');
fs.mkdirSync(TMP_IMPORT_DIR, { recursive: true });

const MAX_IMPORT_SIZE_BYTES = parseInt(process.env.COMPANION_IMPORT_MAX_SIZE_MB || '50', 10) * 1024 * 1024;
const ERROR_TAIL_MAX_CHARS = 6000; // ~6 KB terakhir dari pesan error, biar response gak berat

const upload = multer({ dest: TMP_IMPORT_DIR, limits: { fileSize: MAX_IMPORT_SIZE_BYTES } });

function truncateTail(text, maxChars) {
  if (!text) return text;
  return text.length > maxChars ? `...(dipotong, ${text.length - maxChars} karakter pertama dibuang)\n` + text.slice(-maxChars) : text;
}

// POST /db/containers/:databaseUuid/databases/:name/import
// multipart/form-data, field "file" + field "confirmed" ("true"/"false" string)
// Balas jobId LANGSUNG (gak nunggu import selesai) - proses jalan di
// background, HP polling GET /jobs/:jobId buat cek status.
router.post('/db/containers/:databaseUuid/databases/:name/import', upload.single('file'), async (req, res) => {
  const { databaseUuid, name } = req.params;
  const confirmed = req.body?.confirmed === 'true' || req.body?.confirmed === true;

  const policy = checkPolicy('db:import');
  if (!policy.allowed) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'File .sql wajib diupload (field "file").', code: 'BAD_REQUEST', data: null });
  }
  if (policy.confirmRequired && !confirmed) {
    fs.unlink(req.file.path, () => {});
    return res.status(409).json({
      success: false,
      message: 'Import butuh konfirmasi eksplisit. Kirim ulang dengan field "confirmed": "true".',
      code: 'CONFIRMATION_REQUIRED',
      data: null,
    });
  }

  const jobId = jobs.createJob('db-import', { databaseUuid, dbName: name, originalFilename: req.file.originalname });
  audit.record({ action: 'db:import', databaseUuid, dbName: name, jobId, ok: true, auditLevel: policy.auditLevel });

  // SENGAJA gak di-await - response balik duluan, proses jalan di background.
  runImportJob(jobId, databaseUuid, name, req.file.path);

  return res.json({ success: true, message: 'Import dimulai.', code: 'OK', data: { jobId } });
});

async function runImportJob(jobId, databaseUuid, dbName, filePath) {
  jobs.updateJob(jobId, { status: 'running' });
  try {
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    await dbBrowser.importSqlContent(databaseUuid, dbName, sqlContent);
    jobs.updateJob(jobId, { status: 'success' });
  } catch (err) {
    jobs.updateJob(jobId, { status: 'failed', errorTail: truncateTail(err.message, ERROR_TAIL_MAX_CHARS) });
  } finally {
    fs.unlink(filePath, () => {});
  }
}

// GET /jobs/:jobId - polling status import (queued -> running -> success/failed)
router.get('/jobs/:jobId', (req, res) => {
  const job = jobs.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Job gak ketemu.', code: 'NOT_FOUND', data: null });
  }
  return res.json({ success: true, message: 'OK', code: 'OK', data: job });
});

// GET /db/containers/:databaseUuid/databases/:name/export
// Langsung stream dump .sql sebagai file download - gak pakai job/polling
// (beda dari import), karena mysqldump biasanya cepet & gak butuh upload
// gede dari HP dulu kayak import.
router.get('/db/containers/:databaseUuid/databases/:name/export', async (req, res) => {
  const { databaseUuid, name } = req.params;

  const policy = checkPolicy('db:export');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const dump = await dbBrowser.exportDatabase(databaseUuid, name);
    audit.record({ action: 'db:export', databaseUuid, dbName: name, ok: true, auditLevel: policy.auditLevel });
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${Date.now()}.sql"`);
    return res.send(dump);
  } catch (err) {
    audit.record({ action: 'db:export', databaseUuid, dbName: name, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

module.exports = router;
