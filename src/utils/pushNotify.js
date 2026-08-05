'use strict';

/**
 * Kirim push notification lewat Expo Push API (https://exp.host/--/api/v2/push/send)
 * - gak butuh SDK/dependency tambahan, cuma HTTP POST biasa (fetch bawaan
 * Node 18+, sesuai package.json "engines": {"node": ">=18"}).
 *
 * SATU device doang yang didukung (solo developer, 1 HP) - simpan token
 * TERBARU aja, bukan array banyak device. Kalau nanti butuh multi-device,
 * baru diubah jadi array.
 */
async function sendExpoPush(token, title, body, data) {
  if (!token) {
    throw new Error('[pushNotify] Belum ada push token tersimpan - user belum aktifin notifikasi di ZenVPS.');
  }

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      to: token,
      title,
      body,
      data: data ?? {},
      sound: 'default',
    }),
  });

  const json = await res.json().catch(() => null);

  // Kebijakan error Bagian 9: gagal harus eksplisit. Expo Push API balikin
  // 200 OK bahkan kalau token-nya invalid/expired - errornya ada di DALAM
  // body respons (data.status === 'error'), bukan di HTTP status code.
  if (!res.ok || json?.data?.status === 'error') {
    const msg = json?.data?.message || json?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`[pushNotify] Gagal kirim push notification: ${msg}`);
  }

  return json;
}

module.exports = { sendExpoPush };
