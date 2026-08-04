'use strict';

/**
 * Batch A -- generate command string aja, TIDAK mengeksekusi apapun dan TIDAK
 * memanggil Coolify API. Bagian pengiriman ke field Post-deployment Coolify
 * ada di src/migrate/coolifyDeploy.js (Batch B, nunggu API Coolify nyata).
 *
 * Diadaptasi dari src/build/build.js (vps-manager) yang generate command
 * berdasarkan `prismaMode`. Digeneralisasi jadi `projectType` sesuai Bagian 3.3
 * dokumen migrasi -- supaya pas Laravel masuk nanti, gak perlu bikin endpoint baru,
 * cukup tambah 1 case di sini.
 */

const GENERATORS = {
  'nextjs-prisma': (mode) => {
    const commands = {
      generate: 'npx prisma generate',
      push: 'npx prisma db push',
      push_force: 'npx prisma db push --accept-data-loss',
      migrate: 'npx prisma migrate deploy',
      seed: 'npx prisma db seed',
    };
    if (!commands[mode]) {
      throw new Error(`Mode "${mode}" tidak dikenal untuk projectType nextjs-prisma.`);
    }
    return commands[mode];
  },

  // RENCANA NANTI (Bagian 3.3) -- belum dites, struktur disiapkan supaya
  // penambahan Laravel gak perlu bongkar endpoint/route yang sudah ada.
  laravel: (mode) => {
    const commands = {
      migrate: 'php artisan migrate',
      migrate_force: 'php artisan migrate --force',
      seed: 'php artisan db:seed',
    };
    if (!commands[mode]) {
      throw new Error(`Mode "${mode}" tidak dikenal untuk projectType laravel.`);
    }
    return commands[mode];
  },
};

function generateCommand({ projectType, mode }) {
  const generator = GENERATORS[projectType];
  if (!generator) {
    throw new Error(
      `projectType "${projectType}" tidak didukung. Didukung: ${Object.keys(GENERATORS).join(', ')}.`
    );
  }
  return generator(mode);
}

module.exports = { generateCommand, SUPPORTED_PROJECT_TYPES: Object.keys(GENERATORS) };
