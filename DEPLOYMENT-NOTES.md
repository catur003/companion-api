# Catatan Deployment — Companion API & Coolify

Kumpulan hal yang ketemu pas testing beneran (bukan di dokumen konsep awal).
Update file ini tiap kali nemu gotcha baru — jangan cuma diomongin di chat.

## 1. Docker socket — wajib masuk grup `docker`

Companion API butuh akses `/var/run/docker.sock` buat restart-count & file manager.
User yang jalanin `node`/`npm start` HARUS ada di grup `docker`, defaultnya cuma
`root`.

```bash
sudo usermod -aG docker $USER
newgrp docker        # atau logout-login ulang
```

**PENTING:** kalau proses Companion API udah kadung jalan SEBELUM `newgrp`,
proses lama TETAP gak punya akses — grup baru cuma kepake buat proses yang
di-start SETELAH grup aktif di sesi itu. Harus kill proses lama, start ulang.

Cek keanggotaan grup: `id` → harus muncul `docker` di daftar `groups=`.

**Resiko keamanan (bukan cuma detail teknis):** akses ke Docker socket setara
akses root ke host — bukan cuma "baca doang" walau kode Companion API sendiri
cuma manggil `inspect()`/`getArchive()`. Kalau nanti serius production,
pertimbangkan docker-socket-proxy (Tecnativa) buat restrict scope di level
proxy, bukan percaya validasi kode doang.

## 2. Password DB gak bisa diganti lewat form Coolify

Field "Root Password" / "Normal User Password" di form resource database
Coolify **cuma nyimpen apa yang Coolify catat**, BUKAN apa yang beneran aktif
di dalam container database. MySQL/Postgres cuma set user & password sekali,
pas volume-nya pertama kali di-inisialisasi (`initdb`).

- Edit form SETELAH container pernah start = gak ngefek ke DB asli, cuma bikin
  form & DB nyata jadi gak sinkron (persis warning kuning yang Coolify sendiri
  kasih di form itu).
- **Cara ganti password beneran:** masuk terminal container DB (tombol
  Terminal di resource-nya), lalu:
  ```sql
  ALTER USER 'mysql'@'%' IDENTIFIED BY 'password_baru';
  FLUSH PRIVILEGES;
  ```
  Baru update form Coolify manual biar sinkron — bukan sebaliknya.
- **Kalau DB testing/kosong, lebih gampang:** delete resource + volume-nya,
  bikin baru, biarin Coolify generate password sendiri, JANGAN diedit manual.
- **Cara ambil connection string yang BENER:** selalu copy dari field
  "MySQL URL (internal)" / "Internal Connection String" di dashboard Coolify,
  jangan pernah ketik manual dari asumsi.

## 3. HTTPS wajib buat cookie login (secure cookie flag)

Kalau app pakai `secure: process.env.NODE_ENV === "production"` di cookie
session (pola umum Next.js), cookie itu **gak akan tersimpan di browser**
kalau domain masih `http://`. Login POST sukses, cookie di-set server, tapi
browser diam-diam buang cookie Secure di koneksi non-HTTPS — gejalanya:
balik ke halaman login tanpa notif error apapun (password salah tetap
kasih notif eksplisit, ini beda jalur).

**Fix:** di Coolify, ganti domain app dari `http://...` → `https://...`
(SSL Let's Encrypt otomatis jalan begitu prefix domain diganti — Coolify versi
sekarang gak ada toggle SSL terpisah, itu implisit dari cara nulis domain).
Syarat: port 80 VPS harus kebuka ke publik buat ACME challenge.

## 4. Base Directory wajib diisi buat repo monorepo

Kalau repo bukan 1 app di root (banyak folder contoh/chapter), Nixpacks gagal
build kalau Base Directory dibiarin `/`. Isi sesuai folder app yang mau
dideploy.

## 5. Post-deployment Command ≠ Build Command

Command DB push/seed wajib ditaruh di field **Post-deployment Command**
(jalan SETELAH container start), bukan Build Command (jalan pas image
di-build, DB kadang belum ready — pola sama kayak Bug #2 vps-manager lama).

`npx prisma db seed` BEDA dari script `db:seed` custom — command itu baca
config `"prisma": { "seed": "..." }` di `package.json`, bukan otomatis pakai
script manapun. Kalau project gak punya config itu, panggil langsung script-nya:
```
npx prisma db push && node prisma/seed.js
```

## 6. `npm ci` gagal aneh (dump usage/help) = lockfile gak sinkron

Kalau `package.json` diedit manual (nambah dependency) tanpa `npm install`,
`package-lock.json` jadi gak sinkron → `npm ci` di build Coolify gagal,
kadang errornya nyasar jadi dump help text `npm ci` (bukan pesan "out of
sync" yang jelas). Fix: `npm install` (bukan `ci`) lokal, commit ulang
`package-lock.json`.

## 7. Ports Exposes default Coolify itu `80`, bukan hasil deteksi

Field "Ports Exposes" di form New Resource defaultnya `80` — itu asumsi
generik, BUKAN auto-detect dari project. Buat Next.js (`next start`), ganti
manual ke `3000`. Cek port asli app kalau beda framework.

## 8. Field API Coolify yang udah confirmed nyata (bukan asumsi OpenAPI spec)

- `GET /api/v1/databases/{uuid}` → field `internal_db_url` (connection string
  lengkap siap pakai). **PERINGATAN:** response ini juga balikin
  `mysql_password`/`mysql_root_password` PLAINTEXT — Companion API cuma boleh
  ambil `internal_db_url`, field lain jangan pernah disimpan/di-log/diteruskan.
- `GET /api/v1/applications/{uuid}` → field `post_deployment_command` ada &
  ke-baca bener.
- PATCH ke field yang sama **belum diverifikasi end-to-end** — baru tes GET,
  belum ada bukti langsung PATCH beneran tersimpan (bisa aja read-only/butuh
  field lain bareng). Wajib dites sekali ke app non-production sebelum
  dianggap aman.

## 9. VPS 2GB RAM / 2 core — cek OOM vs error build biasa

Build gagal exit code **137** = kena OOM killer (kehabisan RAM).
Exit code **1** = error build biasa (syntax, dependency, dll) — BUKAN
otomatis soal resource. Jangan buru-buru nambah swap tanpa cek exit code-nya
dulu, bisa nutupin masalah sebenarnya.

Swap tetap disaranin dipasang dari awal buat VPS 2GB ini (mitigasi, bukan
solusi permanen buat production beneran):
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 10. Kredensial yang udah pernah diketik di chat/terminal = anggap terekspos

Kalau password/token pernah di-paste manual (ke chat AI, ke command line
riwayat, dll), jangan pakai itu buat production beneran — generate ulang.
Bukan soal chat-nya bocor, tapi kebiasaan aman: sekali ketik plain, ganti.
