'use strict';

const path = require('path').posix;
const tar = require('tar-stream');
const { docker } = require('../docker/docker');
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
 * Bungkus 1 file jadi tar stream, siap dikirim ke putArchive().
 */
function buildSingleFileTar(filename, content) {
  const pack = tar.pack();
  pack.entry({ name: filename }, content);
  pack.finalize();
  return pack;
}

async function readFile(containerId, relativePath) {
  const target = resolveSafePath(relativePath);
  try {
    const container = docker.getContainer(containerId);
    const stream = await container.getArchive({ path: target });
    return await extractSingleFileFromTar(stream);
  } catch (err) {
    throw new Error(
      `Tidak bisa akses "${relativePath}" di container "${containerId}" -- ` +
      `cek container masih jalan & path benar. (${err.message})`
    );
  }
}

async function writeFile(containerId, relativePath, content) {
  const target = resolveSafePath(relativePath);
  const dir = path.dirname(target);
  const filename = path.basename(target);

  try {
    const container = docker.getContainer(containerId);
    const tarStream = buildSingleFileTar(filename, content);
    await container.putArchive(tarStream, { path: dir });
    return true;
  } catch (err) {
    throw new Error(
      `Gagal tulis "${relativePath}" di container "${containerId}" -- ` +
      `cek container masih jalan & folder tujuan ada. (${err.message})`
    );
  }
}

module.exports = { readFile, writeFile, resolveSafePath };
