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
// body: { projectType, mode, applicationUuid, confirmed?, customCommand? }
//
// "customCommand" (BARU, 4 Agustus 2026): kalau diisi, dipakai APA ADANYA,
// skip generateCommand sepenuhnya -- buat 2 kasus nyata yang ketemu user:
// (1) gabung 2 command jadi 1 kirim biar gak 2x redeploy (mis. "push && seed"),
// (2) command generate defaultnya gak cocok sama struktur project (mis. seed
// file .ts butuh runner beda dari asumsi generateCommand). SELALU minta
// confirmed:true (lihat commandPolicy.js, "db:migrate:custom") -- ini
// sepenuhnya command bebas dari user, bukan hasil template yang udah divalidasi.
router.post('/db/migrate', async (req, res) => {
  const { projectType, mode, applicationUuid, customCommand } = req.body || {};

  if (!applicationUuid) {
    return res.status(400).json({ success: false, message: 'Field wajib: applicationUuid.', code: 'BAD_REQUEST', data: null });
  }

  let action;
  let command;

  if (customCommand) {
    action = 'db:migrate:custom';
    command = customCommand;
  } else {
    if (!projectType || !mode) {
      return res.status(400).json({
        success: false,
        message: 'Field wajib: projectType, mode (atau kirim customCommand).',
        code: 'BAD_REQUEST',
        data: null,
      });
    }
    action = `db:migrate:${mode}`;
    try {
      command = generateCommand({ projectType, mode });
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message, code: 'INVALID_MODE', data: null });
    }
  }

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
