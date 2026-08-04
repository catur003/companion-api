'use strict';

const express = require('express');
const { listProjects, upsertProject, deleteProject } = require('../../config/projects');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// GET /projects - daftar project yang udah migrasi ke Coolify, dibaca dari
// projects.json di VPS. Read-only, gak butuh entry di commandPolicy.js
// (bukan action berbahaya, cuma baca daftar nama+UUID).
router.get('/projects', (req, res) => {
  try {
    const projects = listProjects();
    return res.json({ success: true, message: 'OK', code: 'OK', data: { projects } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message, code: 'PROJECTS_READ_FAILED', data: null });
  }
});

// POST /projects   body: { key, name, applicationUuid, databaseUuid? }
// Tambah/update 1 mapping - dipanggil dari UI ZenVPS "Kelola Mapping Project"
// (4 Agustus 2026), gantiin ritual SSH+nano manual. applicationUuid/
// databaseUuid WAJIB dipilih user dari data Coolify asli di ZenVPS (lewat
// picker), Companion API di sini gak nebak/validasi ulang ke Coolify API --
// murni nyimpen apa yang dikirim.
router.post('/projects', (req, res) => {
  const policy = checkPolicy('projects:write');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const projects = upsertProject(req.body);
    audit.record({ action: 'projects:write', entry: req.body, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'Tersimpan.', code: 'OK', data: { projects } });
  } catch (err) {
    audit.record({ action: 'projects:write', entry: req.body, ok: false, error: err.message });
    return res.status(400).json({ success: false, message: err.message, code: 'BAD_REQUEST', data: null });
  }
});

// DELETE /projects/:key
router.delete('/projects/:key', (req, res) => {
  const policy = checkPolicy('projects:write');
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }

  try {
    const projects = deleteProject(req.params.key);
    audit.record({ action: 'projects:write', deletedKey: req.params.key, ok: true, auditLevel: policy.auditLevel });
    return res.json({ success: true, message: 'Terhapus.', code: 'OK', data: { projects } });
  } catch (err) {
    audit.record({ action: 'projects:write', deletedKey: req.params.key, ok: false, error: err.message });
    return res.status(400).json({ success: false, message: err.message, code: 'BAD_REQUEST', data: null });
  }
});

module.exports = router;
