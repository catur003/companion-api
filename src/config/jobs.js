'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Job registry buat proses background (import SQL) - JSON file biasa, BUKAN
 * SQLite (gak butuh query, cuma simpen/baca status per jobId, nambah
 * dependency baru gak sepadan). Sama pola kayak projects.json/databases.json.
 *
 * Kenapa perlu ada sama sekali (bukan cuma di-memori) - kalau pm2 restart
 * pas import lagi jalan, status TERAKHIR yang sempet ke-tulis tetap kebaca
 * (bukan ilang total kayak Map() di memori doang).
 */

function getJobsFilePath() {
  return process.env.COMPANION_JOBS_FILE || path.join(__dirname, '../../jobs.json');
}

function readAll() {
  const filePath = getJobsFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(jobs) {
  fs.writeFileSync(getJobsFilePath(), JSON.stringify(jobs, null, 2) + '\n', 'utf8');
}

function createJob(type, meta) {
  const id = crypto.randomUUID();
  const jobs = readAll();
  jobs[id] = {
    id,
    type,
    status: 'queued',
    meta,
    errorTail: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeAll(jobs);
  return id;
}

function updateJob(id, patch) {
  const jobs = readAll();
  if (!jobs[id]) return;
  jobs[id] = { ...jobs[id], ...patch, updatedAt: new Date().toISOString() };
  writeAll(jobs);
}

function getJob(id) {
  const jobs = readAll();
  return jobs[id] || null;
}

module.exports = { createJob, updateJob, getJob };
