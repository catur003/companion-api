'use strict';

const express = require('express');
const fileManager = require('../../files/fileManager');
const { listDirectoryByAppUuid } = require('../../docker/docker');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /files/list?applicationUuid=<uuid>&path=<relatif ke root app, kosong = root>
// Beda dari GET /files (baca 1 file) - ini list isi FOLDER, buat file explorer
// di ZenVPS biar user gak perlu tau/ngetik nama file duluan. Pakai `ls`
// non-recursive (bukan Docker Archive API) - lihat catatan di docker.js
// kenapa (listing lewat archive API berat kalau kena node_modules).
router.get('/files/list', async (req, res) => {
  const { applicationUuid, path: relativePath } = req.query;
  const policy = checkPolicy('files:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const target = fileManager.resolveSafePath(relativePath || '.');
    const entries = await listDirectoryByAppUuid(applicationUuid, target);
    audit.record({ action: 'files:list', applicationUuid, path: relativePath, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { path: target, entries } });
  } catch (err) {
    audit.record({ action: 'files:list', applicationUuid, path: relativePath, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

// GET /files/process-env?applicationUuid=<uuid>
// Baca /proc/1/environ (env var PROSES YANG BENERAN JALAN, bukan config
// Coolify) - Coolify API GET /envs sengaja gak pernah kirim field "value"
// (keputusan keamanan mereka). Whitelist eksplisit 1 path ini doang, di
// luar root /app - lihat catatan detail di fileManager.js.
router.get('/files/process-env', async (req, res) => {
  const { applicationUuid } = req.query;
  const policy = checkPolicy('files:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const envs = await fileManager.readProcessEnviron(applicationUuid);
    audit.record({ action: 'files:process-env', applicationUuid, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { envs } });
  } catch (err) {
    audit.record({ action: 'files:process-env', applicationUuid, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

// GET /files?applicationUuid=<uuid_coolify>&path=Y
// UBAH (4 Agustus 2026): dulu "container" (Docker container ID mentah) --
// BASI begitu ada redeploy, ID-nya berubah tiap kali (lihat docker.js).
// Sekarang applicationUuid Coolify (stabil), resolve container aktif di
// server tiap request.
router.get('/files', async (req, res) => {
  const { applicationUuid, path: relativePath } = req.query;
  const policy = checkPolicy('files:read');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const content = await fileManager.readFile(applicationUuid, relativePath);
    audit.record({ action: 'files:read', applicationUuid, path: relativePath, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'OK', code: 'OK', data: { content } });
  } catch (err) {
    audit.record({ action: 'files:read', applicationUuid, path: relativePath, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

// PUT /files?applicationUuid=<uuid_coolify>&path=Y   body: { content }
router.put('/files', async (req, res) => {
  const { applicationUuid, path: relativePath } = req.query;
  const policy = checkPolicy('files:write');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  if (policy.confirmRequired && !req.body?.confirmed) {
    return res.status(409).json({
      success: false,
      message: 'Tulis file butuh konfirmasi eksplisit. Kirim ulang dengan "confirmed": true.',
      code: 'CONFIRMATION_REQUIRED',
      data: null,
    });
  }

  try {
    await fileManager.writeFile(applicationUuid, relativePath, req.body?.content ?? '');
    audit.record({ action: 'files:write', applicationUuid, path: relativePath, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'Tersimpan.', code: 'OK', data: null });
  } catch (err) {
    audit.record({ action: 'files:write', applicationUuid, path: relativePath, ok: false, error: err.message });
    return res.status(501).json({ success: false, message: err.message, code: 'NOT_READY', data: null });
  }
});

module.exports = router;
