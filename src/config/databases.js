'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Registry database yang "numpang" di 1 Container Database (server MySQL) --
 * BEDA dari projects.json (itu mapping app ZenVPS -> resource Coolify).
 * File ini nyimpen kredensial database yang DIBUAT MANUAL lewat fitur
 * "Kelola Container Database" (4 Agustus 2026), karena Coolify SAMA SEKALI
 * GAK TAU soal database itu -- gak ada endpoint Coolify buat "ambil
 * kredensial database yang numpang", beda dari database utama yang Coolify
 * bikin sendiri (itu tetap ambil live dari internal_db_url, gak disimpen).
 *
 * PERINGATAN KEAMANAN: file ini nyimpen PASSWORD PLAINTEXT -- pengecualian
 * sengaja dari prinsip "gak pernah simpan kredensial" yang dipegang di
 * tempat lain (Bagian 6 dokumen). Gak ada pilihan lain karena Coolify gak
 * expose endpoint buat ambil ini live. Resiko diterima: siapapun yang bisa
 * baca file ini (akses SSH VPS) = udah bisa akses Companion API/DB juga.
 */

function getDatabasesFilePath() {
  return process.env.COMPANION_DATABASES_FILE || path.join(__dirname, '../../databases.json');
}

function listAllEntries() {
  const filePath = getDatabasesFilePath();
  if (!fs.existsSync(filePath)) return [];

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`[databases] Gagal baca "${filePath}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[databases] "${filePath}" bukan JSON valid: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`[databases] "${filePath}" harus berisi array.`);
  }
  return parsed;
}

function listEntriesForContainer(containerUuid) {
  return listAllEntries().filter((e) => e.containerUuid === containerUuid);
}

function findEntry(containerUuid, name) {
  return listAllEntries().find((e) => e.containerUuid === containerUuid && e.name === name);
}

function upsertEntry(entry) {
  if (!entry?.containerUuid || !entry?.name || !entry?.username || !entry?.password) {
    throw new Error('[databases] Field wajib: containerUuid, name, username, password.');
  }
  const filePath = getDatabasesFilePath();
  const current = listAllEntries();
  const idx = current.findIndex((e) => e.containerUuid === entry.containerUuid && e.name === entry.name);
  const cleaned = { containerUuid: entry.containerUuid, name: entry.name, username: entry.username, password: entry.password };
  if (idx >= 0) current[idx] = cleaned;
  else current.push(cleaned);
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2) + '\n', 'utf8');
}

function deleteEntry(containerUuid, name) {
  const filePath = getDatabasesFilePath();
  const current = listAllEntries();
  const next = current.filter((e) => !(e.containerUuid === containerUuid && e.name === name));
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

module.exports = { listEntriesForContainer, findEntry, upsertEntry, deleteEntry };
