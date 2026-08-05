'use strict';

const express = require('express');
const authMiddleware = require('./middleware/auth');

const restartCountRoutes = require('./routes/restartCount.routes');
const dbMigrateRoutes = require('./routes/dbMigrate.routes');
const filesRoutes = require('./routes/files.routes');
const dbQueryRoutes = require('./routes/dbQuery.routes');
const dbAdminRoutes = require('./routes/dbAdmin.routes');
const dbImportExportRoutes = require('./routes/dbImportExport.routes');
const systemRoutes = require('./routes/system.routes');
const projectsRoutes = require('./routes/projects.routes');

function createServer() {
  const app = express();
  app.use(express.json());

  // Health check -- gak butuh auth, buat cek Companion API hidup atau gak.
  app.get('/health', (req, res) => {
    res.json({ success: true, message: 'Companion API jalan.', code: 'OK', data: null });
  });

  app.use(authMiddleware);

  app.use(restartCountRoutes);
  app.use(dbMigrateRoutes);
  app.use(filesRoutes);
  app.use(dbQueryRoutes);
  app.use(dbAdminRoutes);
  app.use(dbImportExportRoutes);
  app.use(systemRoutes);
  app.use(projectsRoutes);

  // 404 eksplisit -- bukan HTML default Express.
  app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.', code: 'NOT_FOUND', data: null });
  });

  // Error handler terakhir -- kebijakan Bagian 9: gagal harus jelas, bukan diam-diam.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[unhandled error]', err);
    res.status(500).json({
      success: false,
      message: `Kesalahan internal: ${err.message}`,
      code: 'INTERNAL_ERROR',
      data: null,
    });
  });

  return app;
}

module.exports = createServer;
