#!/usr/bin/env node
'use strict';

require('dotenv').config();

const config = require('../src/config/config');
const createServer = require('../src/api/server');

const app = createServer();

app.listen(config.port, () => {
  console.log(`Companion API jalan di port ${config.port}`);
  console.log(`[info] File manager pakai root container: ${config.files.containerAppRoot}`);
  if (!config.coolify.apiBaseUrl) {
    console.warn(
      '[peringatan] COOLIFY_API_BASE_URL kosong -- endpoint /db/query dan bagian pengiriman ' +
      '/db/migrate akan menolak semua request sampai ini diisi.'
    );
  }
});
