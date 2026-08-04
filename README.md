# Companion API

Companion API kecil untuk ZenVPS di atas Coolify. Menutup gap fitur yang gak ada
di Coolify native: file manager, DB browser, generate command db/migrate,
restart-count fallback. **Bukan** vps-manager versi 2 — scope sengaja dibatasi
sekecil mungkin (lihat Bagian 6, dokumen migrasi Coolify).

## Status implementasi (jujur, bukan checklist "selesai semua")

Skeleton project ini **sudah lengkap strukturnya**, tapi 2 dari 4 fungsi
sengaja **belum diimplementasikan penuh** — bukan bug, tapi karena memang
belum bisa diverifikasi:

| Fungsi | Status | Kenapa |
|---|---|---|
| `GET /containers/:id/restart-count` | ✅ Fungsional | Cuma butuh Docker socket di host, gak butuh Coolify API |
| `POST /db/migrate` (generate command) | ✅ Fungsional | Command generator murni logic, gak butuh Coolify API |
| `POST /db/migrate` (kirim ke Coolify) | 🚧 Belum bisa | Butuh shape response API Coolify nyata — belum ada instance Coolify buat dites |
| `GET/PUT /files` | 🚧 Belum bisa | Path konvensi volume Docker per-project di Coolify belum diverifikasi |
| `POST /db/query` | 🚧 Belum bisa | Butuh connection string "live" dari Coolify API — sama, belum diverifikasi |

Endpoint yang "belum bisa" akan **menjawab error 501 dengan pesan jelas**
(bukan pura-pura sukses atau nebak-nebak), sesuai kebijakan error di Bagian 9
dokumen migrasi.

## Yang wajib dikerjakan dulu sebelum Batch B bisa diisi (= Fase 1 dokumen)

1. Setup Coolify di VPS terpisah (Fase 0).
2. Panggil `/api/v1` Coolify beneran, catat shape response untuk:
   - endpoint yang expose restart count container (kalau ada)
   - endpoint ambil env/connection string per aplikasi
   - endpoint update Post-deployment Command
3. Cek langsung struktur folder volume Docker per-project di host (isi
   `COOLIFY_VOLUMES_BASE_PATH` di `.env` berdasarkan hasil cek ini, JANGAN
   ditebak dari dokumentasi).
4. Setelah itu, isi implementasi nyata di:
   - `src/migrate/coolifyDeploy.js`
   - `src/db/dbBrowser.js`
   - `src/files/fileManager.js` (path validation sudah ada, tinggal isi `basePath`)

## Menjalankan

```bash
cp .env.example .env
# isi COMPANION_API_TOKEN minimal, sisanya boleh kosong dulu (Batch A tetap jalan)
npm install
npm start
```

## Struktur folder

```
bin/companion-api.js       entry point
src/config/config.js       loader env var, fail-fast kalau wajib kosong
src/api/server.js          wiring express + auth + routes
src/api/middleware/auth.js Bearer token (pola sama vps-manager)
src/api/commandPolicy.js   whitelist action + confirmRequired + audit level
src/api/routes/*           4 endpoint gap
src/docker/docker.js       Batch A — restart-count via docker inspect
src/migrate/*              command generator (Batch A) + kirim ke Coolify (Batch B)
src/files/fileManager.js   Batch B — file manager, path traversal guard sudah ada
src/db/dbBrowser.js        Batch B — DB browser
src/utils/audit.js         audit trail, append-only JSON log
```

## Prinsip yang dipegang (diwarisi dari dokumen migrasi & vps-manager lama)

- Semua config lewat environment variable, tidak ada hardcode path/kredensial.
- Gagal harus eksplisit dengan pesan jelas — tidak ada silent fail, tidak ada
  angka default yang menyesatkan (mis. restart-count gagal ≠ 0).
- Default-deny: action yang gak terdaftar di `commandPolicy.js` ditolak.
- Connection string DB tidak pernah disimpan permanen di Companion API — selalu
  diambil live dari Coolify per-request (begitu Batch B siap).
- Command yang dikirim/dieksekusi selalu tercatat ke audit log.
