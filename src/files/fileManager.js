'use strict';

const path = require('path').posix;
const tar = require('tar-stream');
const { docker, resolveContainerIdByAppUuid } = require('../docker/docker');
const config = require('../config/config');

/**
 * REDESIGN (pasca Fase 1 nyata): asumsi awal "baca file lewat host volume
 * Docker" TERBUKTI SALAH -- container app (Nixpacks) itu stateless, gak
 * punya named volume sama sekali (dicek langsung: `docker volume ls` cuma
 * nunjukin volume database, bukan volume app). Cuma DB yang persist.
 *
 * Tujuan sebenarnya fitur ini (dikonfirmasi user): bandingin isi source di
 * VPS/container yang lagi jalan vs GitHub, buat debug kalau ada bug yang
 * kelihatannya beda padahal harusnya sama. Itu gak butuh volume -- cukup
 * baca filesystem container yang lagi live lewat Docker API.
 *
 * Sengaja PAKAI getArchive/putArchive (setara `docker cp`), BUKAN `docker exec
 * cat <path>`. Alasan (Bagian 8 dokumen -- least privilege): exec+shell buka
 * kemungkinan command injection kalau path gak divalidasi sempurna. Archive
 * API terima path sebagai parameter Docker API, bukan string yang di-parse
 * shell -- kelas risiko yang beda total, bukan cuma soal validasi lebih ketat.
 */

function resolveSafePath(relativePath) {
  const root = config.files.containerAppRoot;
  const resolved = path.normalize(path.join(root, relativePath || '.'));

  // Cegah path traversal (../../) -- sama prinsip kayak sebelumnya, tapi
  // sekarang scope-nya filesystem container, bukan host. Tetap wajib:
  // container yang sama bisa punya file sensitif (.env, credential lain)
  // di luar folder source app.
  const boundary = root.endsWith('/') ? root : root + '/';
  if (resolved !== root && !resolved.startsWith(boundary)) {
    throw new Error(`[fileManager] Path "${relativePath}" keluar dari root app "${root}".`);
  }

  return resolved;
}

/**
 * Ekstrak isi 1 file dari tar stream yang dikembalikan getArchive().
 * getArchive selalu bungkus hasilnya sebagai tar walau cuma diminta 1 file.
 */
function extractSingleFileFromTar(tarStream) {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    let fileContent = null;
    let sawEntry = false;

    extract.on('entry', (header, stream, next) => {
      if (header.type === 'file' && !sawEntry) {
        sawEntry = true;
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          fileContent = Buffer.concat(chunks).toString('utf8');
          next();
        });
        stream.on('error', reject);
      } else {
        stream.on('end', next);
        stream.resume();
      }
    });

    extract.on('finish', () => {
      if (fileContent === null) {
        reject(new Error('Tidak ada file ditemukan di response archive (mungkin path itu folder, bukan file).'));
      } else {
        resolve(fileContent);
      }
    });

    extract.on('error', reject);
    tarStream.pipe(extract);
  });
}

/**
 * Ekstrak isi 1 file dari tar stream sebagai Buffer mentah (bukan string) --
 * dipakai buat /proc/1/environ yang separator-nya NUL byte, bukan newline,
 * jadi gak bisa asal di-toString('utf8') dulu terus split('\n').
 */
function extractSingleFileFromTarAsBuffer(tarStream) {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    let fileBuffer = null;
    let sawEntry = false;

    extract.on('entry', (header, stream, next) => {
      if (header.type === 'file' && !sawEntry) {
        sawEntry = true;
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
          next();
        });
        stream.on('error', reject);
      } else {
        stream.on('end', next);
        stream.resume();
      }
    });

    extract.on('finish', () => {
      if (fileBuffer === null) {
        reject(new Error('Tidak ada file ditemukan di response archive.'));
      } else {
        resolve(fileBuffer);
      }
    });

    extract.on('error', reject);
    tarStream.pipe(extract);
  });
}

/**
 * Bungkus 1 file jadi tar stream, siap dikirim ke putArchive().
 */
function buildSingleFileTar(filename, content) {
  const pack = tar.pack();
  pack.entry({ name: filename }, content);
  pack.finalize();
  return pack;
}

/**
 * Baca env var PROSES YANG BENERAN JALAN, bukan konfigurasi Coolify (beda
 * sumber, beda makna). Alasan (4 Agustus 2026): Coolify API-nya (GET /envs)
 * SENGAJA gak pernah kirim field "value" -- keputusan keamanan Coolify,
 * bukan bug kita. Filesystem app juga gak punya file .env fisik (dicek
 * langsung lewat file explorer, kosong) -- confirmed env disuntik sebagai
 * process env var langsung (docker run -e), bukan file.
 *
 * /proc/1/environ SELALU ada di container Linux manapun (mekanisme kernel,
 * bukan tergantung cara inject Coolify) -- baca file spesial ini buat lihat
 * value ASLI yang beneran aktif di proses yang jalan sekarang.
 *
 * SENGAJA di luar resolveSafePath (root /app) -- WHITELIST EKSPLISIT 1 path
 * doang, bukan buka akses baca semua file di container. Beda total dari
 * proteksi umum readFile/writeFile.
 */
async function readProcessEnviron(applicationUuid) {
  const PROC_ENVIRON_PATH = '/proc/1/environ';
  try {
    const containerId = await resolveContainerIdByAppUuid(applicationUuid);
    const container = docker.getContainer(containerId);
    const stream = await container.getArchive({ path: PROC_ENVIRON_PATH });
    const buffer = await extractSingleFileFromTarAsBuffer(stream);

    // Format /proc/*/environ: "KEY1=VAL1\0KEY2=VAL2\0...\0" -- pisah NUL byte,
    // BUKAN newline (value env bisa aja ngandung newline literal di dalamnya).
    return buffer
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const idx = entry.indexOf('=');
        if (idx === -1) return { key: entry, value: '' };
        return { key: entry.slice(0, idx), value: entry.slice(idx + 1) };
      });
  } catch (err) {
    throw new Error(
      `Gagal baca /proc/1/environ di app "${applicationUuid}" -- cek app masih jalan. (${err.message})`
    );
  }
}

async function readFile(applicationUuid, relativePath) {
  const target = resolveSafePath(relativePath);
  try {
    // Resolve container ID aktif dulu dari applicationUuid (stabil) -- ID
    // Docker mentah BERUBAH tiap redeploy (temuan sama kayak restart-count,
    // lihat docker.js). Jangan pernah terima/percaya container ID mentah
    // dari caller lagi.
    const containerId = await resolveContainerIdByAppUuid(applicationUuid);
    const container = docker.getContainer(containerId);
    const stream = await container.getArchive({ path: target });
    return await extractSingleFileFromTar(stream);
  } catch (err) {
    throw new Error(
      `Tidak bisa akses "${relativePath}" di app "${applicationUuid}" -- ` +
      `cek app masih jalan & path benar. (${err.message})`
    );
  }
}

async function writeFile(applicationUuid, relativePath, content) {
  const target = resolveSafePath(relativePath);
  const dir = path.dirname(target);
  const filename = path.basename(target);

  try {
    const containerId = await resolveContainerIdByAppUuid(applicationUuid);
    const container = docker.getContainer(containerId);
    const tarStream = buildSingleFileTar(filename, content);
    await container.putArchive(tarStream, { path: dir });
    return true;
  } catch (err) {
    throw new Error(
      `Gagal tulis "${relativePath}" di app "${applicationUuid}" -- ` +
      `cek app masih jalan & folder tujuan ada. (${err.message})`
    );
  }
}

module.exports = { readFile, writeFile, resolveSafePath, readProcessEnviron };
