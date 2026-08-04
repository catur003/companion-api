'use strict';

const express = require('express');
const { generateCommand } = require('../../migrate/commandGenerator');
const { sendPostDeploymentCommand } = require('../../migrate/coolifyDeploy');
const { checkPolicy } = require('../commandPolicy');
const audit = require('../../utils/audit');

const router = express.Router();

// POST /db/migrate
// Nama endpoint sengaja generik (bukan /prisma/run), sesuai Bagian 3.3 dokumen --
// supaya Laravel bisa masuk nanti tanpa bikin endpoint baru.
// body: { projectType: 'nextjs-prisma' | 'laravel', mode: string, applicationUuid: string }
router.post('/db/migrate', async (req, res) => {
  const { projectType, mode, applicationUuid } = req.body || {};

  if (!projectType || !mode || !applicationUuid) {
    return res.status(400).json({
      success: false,
      message: 'Field wajib: projectType, mode, applicationUuid.',
      code: 'BAD_REQUEST',
      data: null,
    });
  }

  const action = `db:migrate:${mode}`;
  const policy = checkPolicy(action);
  if (!policy.allowed) {
    return res.status(403).json({ success: false, message: policy.reason, code: 'POLICY_DENIED', data: null });
  }
  if (policy.confirmRequired && !req.body.confirmed) {
    return res.status(409).json({
      success: false,
      message: `Action "${action}" butuh konfirmasi eksplisit. Kirim ulang dengan "confirmed": true.`,
      code: 'CONFIRMATION_REQUIRED',
      data: null,
    });
  }

  let command;
  try {
    command = generateCommand({ projectType, mode });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message, code: 'INVALID_MODE', data: null });
  }

  audit.record({ action, projectType, mode, applicationUuid, command, auditLevel: policy.auditLevel });

  try {
    // Batch B -- diimplementasi & endpoint-nya sudah confirmed (Fase 1, GET).
    // PATCH-nya sendiri belum diverifikasi end-to-end (lihat catatan di
    // coolifyDeploy.js) -- tes sekali dulu ke PORTOFOLIO sebelum dianggap aman.
    await sendPostDeploymentCommand({ applicationUuid, command });
  } catch (err) {
    return res.status(501).json({
      success: false,
      message: err.message,
      code: 'COOLIFY_INTEGRATION_NOT_READY',
      data: { generatedCommand: command },
    });
  }

  return res.json({ success: true, message: 'Command terkirim.', code: 'OK', data: { command } });
});

module.exports = router;
