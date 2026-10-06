import type { TenantKind } from '@simrs/shared';
import type { NavGroup, NavItem } from '@simrs/ui';
import { screenById, screenOpen } from './screens';
import type { DataSource } from './server/web-env';

/** Menu web: `requires` = izin (`sumber.aksi`) yang harus dimiliki peran aktif agar menu tampil. */
export type WebNavItem = NavItem & { requires?: string };
export interface WebNavGroup extends NavGroup {
  items: WebNavItem[];
}

/**
 * Peta menu → rute (docs/08-desain-ui.md §4). Untuk layar fase 2–10, `available` dihitung dari registri `SCREENS`
 * (`lib/screens.ts`, ADR-0023): `belum` redup, `demo` hanya di mode presentasi, `api` selalu.
 * Menyembunyikan menu hanya kenyamanan; setiap halaman dan endpoint API tetap memeriksa izinnya sendiri.
 */
export const NAV_GROUPS: WebNavGroup[] = [
  {
    title: 'UMUM',
    items: [
      { id: 'beranda', label: 'Beranda', href: '/', icon: 'home', available: true },
      { id: 'simulasi', label: 'Simulasi pasien', href: '/simulasi', icon: 'play', available: false },
    ],
  },
  {
    title: 'FRONT OFFICE',
    items: [
      { id: 'daftar', label: 'Pendaftaran', href: '/pendaftaran', icon: 'userPlus', available: false },
      { id: 'kendali', label: 'Kendali antrean', href: '/antrean', icon: 'list', available: false },
      { id: 'antrean', label: 'Antrean', href: '/display/antrean', icon: 'list', available: false },
      { id: 'jadwal', label: 'Jadwal dokter', href: '/jadwal', icon: 'cal', available: false },
      // FE1 · front office (mode presentasi)
      { id: 'rujukan', label: 'Rujukan', href: '/rujukan', icon: 'arrowRight', available: false },
      {
        id: 'info-publik',
        label: 'Info publik',
        href: '/pratinjau/info-publik',
        icon: 'info',
        available: false,
      },
      // FE1 · akhir
    ],
  },
  {
    title: 'KLINIS',
    items: [
      { id: 'poli', label: 'Pasien saya', href: '/klinis/poli', icon: 'users', available: false },
      { id: 'igd', label: 'IGD', href: '/klinis/igd', icon: 'pulse', available: false },
      { id: 'ranap', label: 'Rawat inap', href: '/klinis/rawat-inap', icon: 'bed', available: false },
      { id: 'bed', label: 'Tempat tidur', href: '/klinis/tempat-tidur', icon: 'layout', available: false },
    ],
  },
  {
    title: 'PENUNJANG',
    items: [
      { id: 'lab', label: 'Laboratorium', href: '/penunjang/lab', icon: 'flask', available: false },
      { id: 'rad', label: 'Radiologi', href: '/penunjang/radiologi', icon: 'scan', available: false },
      { id: 'farmasi', label: 'Farmasi', href: '/penunjang/farmasi', icon: 'pill', available: false },
      { id: 'ok', label: 'Kamar operasi', href: '/penunjang/kamar-operasi', icon: 'cut', available: false },
    ],
  },
  {
    title: 'KEUANGAN',
    items: [
      { id: 'kasir', label: 'Kasir', href: '/keuangan/kasir', icon: 'wallet', available: false },
      { id: 'klaim', label: 'Klaim & koding', href: '/keuangan/klaim', icon: 'fileCheck', available: false },
      {
        id: 'pembayaran',
        label: 'Pembayaran digital',
        href: '/keuangan/pembayaran',
        icon: 'card',
        available: false,
      },
      {
        id: 'pembiayaan',
        label: 'Pembiayaan BTN',
        href: '/keuangan/pembiayaan',
        icon: 'bank',
        available: false,
      },
      { id: 'akuntansi', label: 'Akuntansi', href: '/keuangan/akuntansi', icon: 'book', available: false },
    ],
  },
  {
    title: 'MANAJEMEN',
    items: [
      { id: 'dasbor', label: 'Dasbor eksekutif', href: '/manajemen/dasbor', icon: 'chart', available: false },
      {
        id: 'rm',
        label: 'Rekam medis',
        href: '/rekam-medis/mpi',
        icon: 'folder',
        available: true,
        requires: 'patient.merge',
      },
      // FE1 · dokumen rekam medis (mode presentasi)
      {
        id: 'dokumen',
        label: 'Dokumen & TTE',
        href: '/rekam-medis/dokumen',
        icon: 'fileCheck',
        available: false,
      },
      // FE1 · akhir
      { id: 'logistik', label: 'Logistik', href: '/manajemen/logistik', icon: 'box', available: false },
      { id: 'mutu', label: 'Mutu & keselamatan', href: '/manajemen/mutu', icon: 'award', available: false },
    ],
  },
  {
    title: 'SISTEM',
    items: [
      {
        id: 'akses',
        label: 'Pengguna & akses',
        href: '/sistem/akses',
        icon: 'shield',
        available: true,
        requires: 'iam.users.read',
      },
      {
        id: 'audit',
        label: 'Jejak audit',
        href: '/sistem/audit',
        icon: 'history',
        available: true,
        requires: 'audit.read',
      },
      {
        id: 'formulir',
        label: 'Formulir klinis',
        href: '/sistem/formulir',
        icon: 'layout',
        available: true,
        requires: 'forms.definition.write',
      },
      { id: 'integrasi', label: 'Integrasi', href: '/sistem/integrasi', icon: 'plug', available: false },
      // FE1 · platform dan operasional (mode presentasi)
      { id: 'struktur', label: 'Struktur RS', href: '/sistem/struktur', icon: 'layout', available: false },
      {
        id: 'pengaturan',
        label: 'Pengaturan RS',
        href: '/sistem/pengaturan',
        icon: 'menu',
        available: false,
      },
      {
        id: 'terminologi',
        label: 'Data rujukan',
        href: '/sistem/terminologi',
        icon: 'book',
        available: false,
      },
      {
        id: 'penjadwal',
        label: 'Penjadwal pekerjaan',
        href: '/sistem/penjadwal',
        icon: 'clock',
        available: false,
      },
      { id: 'downtime', label: 'Mode downtime', href: '/sistem/downtime', icon: 'alert', available: false },
      {
        id: 'cadangan',
        label: 'Cadangan & pemulihan',
        href: '/sistem/cadangan',
        icon: 'box',
        available: false,
      },
      { id: 'golive', label: 'Kesiapan go-live', href: '/sistem/go-live', icon: 'check', available: false },
      // FE1 · akhir
    ],
  },
];

/** Area superadmin platform; hanya untuk peran superadmin_platform di tenant PLATFORM (ADR-0010, ADR-0013). */
export const SUPERADMIN_GROUP: WebNavGroup = {
  title: 'SUPERADMIN',
  items: [
    { id: 'panduan', label: 'Panduan sistem', href: '/superadmin/panduan', icon: 'info', available: true },
    { id: 'devui', label: 'Fondasi UI', href: '/dev/ui', icon: 'palette', available: true },
  ],
};

/** Menu RS yang relevan bagi operator platform (tanpa modul klinis/keuangan). */
const PLATFORM_ITEM_IDS = new Set(['beranda', 'akses', 'audit']);

/**
 * Grup menu untuk sesi saat ini: menu ber-`requires` hanya tampil bila peran memegang izinnya; tenant PLATFORM
 * hanya melihat menu sistem; grup superadmin hanya untuk superadmin platform. Layar ber-data dummy di mode
 * presentasi hanya tampil untuk posisi yang memakainya (layar lain disembunyikan, bukan diredupkan). Layar hibrida
 * front office dan klinis (`permission` di registri) di mode api tampil hanya bagi peran yang memegang izinnya.
 */
export function navGroups(opts: {
  kind: TenantKind;
  superadmin: boolean;
  permissions: readonly string[];
  dataSource: DataSource;
  /** Kode peran posisi aktif (null bila belum memilih). */
  role: string | null;
}): WebNavGroup[] {
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.flatMap((item): WebNavItem[] => {
      if (item.requires && !opts.permissions.includes(item.requires)) return [];
      if (opts.kind === 'platform' && !PLATFORM_ITEM_IDS.has(item.id)) return [];
      const screen = screenById(item.id);
      if (!screen) return [item];
      const open = screenOpen(screen, opts);
      // Mode presentasi: layar posisi lain disembunyikan. Layar hibrida (ber-izin) di mode api mengikuti izin
      // sungguhan seperti menu ber-`requires`: tanpa izin, menu tidak tampil.
      if (!open && (screen.permission || (screen.status === 'demo' && opts.dataSource === 'demo'))) return [];
      return [{ ...item, available: open }];
    }),
  })).filter((g) => g.items.length > 0);
  return opts.superadmin ? [...groups, SUPERADMIN_GROUP] : groups;
}

/** Cari menu aktif dari pathname: cocokkan prefix terpanjang. */
export function activeNavId(pathname: string): string | undefined {
  let best: { id: string; len: number } | undefined;
  for (const g of [...NAV_GROUPS, SUPERADMIN_GROUP]) {
    for (const item of g.items) {
      const match =
        item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.len)) best = { id: item.id, len: item.href.length };
    }
  }
  return best?.id;
}
