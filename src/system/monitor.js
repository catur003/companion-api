'use strict';

const shell = require('../utils/shell');

/**
 * Port dari vps-manager (src/monitor/monitor.js), 4 Agustus 2026 - logic
 * PERSIS sama, cuma adaptasi ke shell.run() versi Companion API (execFileSync
 * argv-based, bukan execSync shell-pipe). Untuk `top`/`free` yang aslinya
 * pakai pipe shell (`top -bn1 | grep 'Cpu(s)'`), parsing 'Cpu(s)' dipindah
 * ke JS (ambil semua output `top`, cari baris yang cocok sendiri) - gak
 * ngurangin kemampuan, cuma pindah tempat parsing dari shell ke Node.
 */

function getCpuUsage() {
  const result = shell.run('top', ['-bn1']);
  if (!result.ok) return null;
  const line = result.output.split('\n').find((l) => l.includes('Cpu(s)'));
  if (!line) return null;
  const match = line.match(/(\d+\.\d+)\s*id/);
  if (!match) return null;
  const idle = parseFloat(match[1]);
  return Math.round((100 - idle) * 10) / 10;
}

function getRam() {
  const result = shell.run('free', ['-m']);
  if (!result.ok) return null;
  const lines = result.output.split('\n');
  const memLine = lines.find((l) => l.startsWith('Mem:'));
  if (!memLine) return null;
  const parts = memLine.split(/\s+/).map(Number);
  const [, total, used, , , available] = parts;
  return {
    totalMB: total,
    usedMB: used,
    availableMB: available || total - used,
    percent: Math.round((used / total) * 1000) / 10,
  };
}

function getSwap() {
  const result = shell.run('free', ['-m']);
  if (!result.ok) return null;
  const lines = result.output.split('\n');
  const swapLine = lines.find((l) => l.startsWith('Swap:'));
  if (!swapLine) return null;
  const parts = swapLine.split(/\s+/).map(Number);
  const [, total, used, free] = parts;
  if (!total) return { totalMB: 0, usedMB: 0, freeMB: 0, percent: 0 };
  return {
    totalMB: total,
    usedMB: used,
    freeMB: free ?? total - used,
    percent: Math.round((used / total) * 1000) / 10,
  };
}

function getDisk() {
  const result = shell.run('df', ['-h', '/']);
  if (!result.ok) return null;
  const lastLine = result.output.split('\n').pop();
  const parts = lastLine.trim().split(/\s+/);
  return {
    total: parts[1],
    used: parts[2],
    available: parts[3],
    percent: parseInt(parts[4], 10),
  };
}

function getUptime() {
  const result = shell.run('uptime', ['-p']);
  return result.ok ? result.output.replace(/^up\s*/, '') : null;
}

function getLoadAverage() {
  const result = shell.run('uptime');
  if (!result.ok) return null;
  const match = result.output.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!match) return null;
  return { '1min': match[1], '5min': match[2], '15min': match[3] };
}

function getStatus() {
  return {
    cpuPercent: getCpuUsage(),
    ram: getRam(),
    swap: getSwap(),
    disk: getDisk(),
    uptime: getUptime(),
    loadAverage: getLoadAverage(),
  };
}

module.exports = { getCpuUsage, getRam, getSwap, getDisk, getUptime, getLoadAverage, getStatus };
