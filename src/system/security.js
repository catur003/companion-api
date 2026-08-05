'use strict';

const shell = require('../utils/shell');

/**
 * Port dari vps-manager (src/security/security.js), 4 Agustus 2026.
 *
 * UBAH (5 Agustus 2026, keputusan user): firewall (ufw) & fail2ban DIBUANG
 * total dari sini - dua-duanya SECARA TEKNIS gak bisa dicek tanpa sudo sama
 * sekali (ufw sengaja di-gate root oleh developernya, fail2ban komunikasi
 * lewat socket root-only) - bukan soal males setup, itu batasan OS. User
 * milih skip daripada nambah privilege footprint Companion API buat sudoers.
 *
 * Yang tersisa (ssh-config, open-ports) TANPA sudo - konsekuensinya:
 * - ssh-config: baca /etc/ssh/sshd_config langsung, cuma jalan kalau file
 *   itu world-readable (default banyak distro, tapi gak dijamin semua)
 * - open-ports: `ss -tlnp` tanpa sudo TETAP jalan, tapi nama proses/PID
 *   cuma kebaca buat proses MILIK USER YANG SAMA - proses punya user lain
 *   (mis. nginx/mysqld kalau jalan sebagai root/user beda) bakal blank.
 */

function parseSsLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const addrPortTokens = tokens.filter((t) => /:(\d+|\*)$/.test(t));
  const localAddress = addrPortTokens[0] || null;
  const portMatch = localAddress ? localAddress.match(/:(\d+)$/) : null;
  const processTokenIdx = tokens.findIndex((t) => t.startsWith('users:'));
  const rawProcess = processTokenIdx !== -1 ? tokens.slice(processTokenIdx).join(' ') : null;
  let processName = null;
  let pid = null;
  if (rawProcess) {
    const match = rawProcess.match(/\(\("([^"]+)",pid=(\d+)/);
    if (match) {
      processName = match[1];
      pid = match[2];
    }
  }
  return { port: portMatch ? portMatch[1] : '-', address: localAddress || '-', processName, pid };
}

function listOpenPorts() {
  const result = shell.run('ss', ['-tlnp']);
  if (!result.ok) return { ok: false, ports: [], error: result.errorMessage };

  const lines = result.output.split('\n').filter(Boolean).slice(1);
  const ports = lines.map((line) => {
    const parsed = parseSsLine(line);
    return {
      port: parsed.port,
      address: parsed.address,
      processName: parsed.processName,
      pid: parsed.pid,
      process: parsed.processName
        ? `${parsed.processName} (pid ${parsed.pid})`
        : 'tidak diketahui (proses milik user lain, butuh sudo buat lihat)',
    };
  });

  return { ok: true, ports };
}

function checkSshConfig() {
  const result = shell.run('grep', ['-E', '^(PermitRootLogin|PasswordAuthentication|Port)\\s', '/etc/ssh/sshd_config']);
  if (!result.ok || !result.output) {
    return {
      ok: false,
      errorMessage: 'Gagal baca /etc/ssh/sshd_config (mungkin file gak world-readable di setup ini, butuh sudo) atau setting masih default.',
    };
  }

  const settings = {};
  result.output.split('\n').forEach((line) => {
    const [key, value] = line.trim().split(/\s+/);
    if (key) settings[key] = value;
  });

  return { ok: true, settings };
}

module.exports = { listOpenPorts, checkSshConfig };
