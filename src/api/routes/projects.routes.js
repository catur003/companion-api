'use strict';

const express = require('express');
const { listProjects } = require('../../config/projects');

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

module.exports = router;
