#!/usr/bin/env bash
set -euo pipefail

# Setup sudoers buat Companion API - VERSI RINGKAS dari punya vps-manager
# (yang isinya jauh lebih banyak: nginx, certbot, pm2, dst - gak relevan
# buat Companion API). Cuma 4 command yang dibutuhin fitur Diagnostik
# (system/security.js): ufw status, ss -tlnp, fail2ban-client status,
# baca /etc/ssh/sshd_config.
#
# Jalankan sebagai user yang SAMA dengan yang menjalankan `pm2 start
# bin/companion-api.js` (biasanya user non-root biasa, mis. "ubuntu").
#
# Usage: sudo bash scripts/setup-sudoers.sh <nama_user_companion_api>

API_USER="${1:-$(whoami)}"

resolve_bin() {
  command -v "$1" 2>/dev/null || echo "/usr/bin/$1"
}

BIN_UFW="$(resolve_bin ufw)"
BIN_SS="$(resolve_bin ss)"
BIN_FAIL2BAN="$(resolve_bin fail2ban-client)"
BIN_GREP="$(resolve_bin grep)"

SUDOERS_FILE="/etc/sudoers.d/companion-api-${API_USER}"

cat > "${SUDOERS_FILE}" <<RULES
# Auto-generated oleh scripts/setup-sudoers.sh - JANGAN edit manual, jalanin
# ulang script ini kalau perlu update (mis. abis install fail2ban baru).
#
# Di-scope KETAT ke argumen spesifik (bukan "ufw ALL"/"ss ALL") - default-deny
# sesuai prinsip least-privilege yang dipegang Companion API.
${API_USER} ALL=(root) NOPASSWD: ${BIN_UFW} status, ${BIN_SS} -tlnp, ${BIN_FAIL2BAN} status, ${BIN_GREP} -E * /etc/ssh/sshd_config
RULES

chmod 440 "${SUDOERS_FILE}"
visudo -c -f "${SUDOERS_FILE}" && echo "Sudoers OK: ${SUDOERS_FILE}" || {
  echo "Syntax sudoers salah, file dihapus." >&2
  rm -f "${SUDOERS_FILE}"
  exit 1
}

echo "Selesai. User '${API_USER}' sekarang bisa jalanin 4 command di atas via sudo tanpa password."
