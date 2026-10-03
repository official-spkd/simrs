import type { NavGroup } from '@simrs/ui';

/**
 * Peta menu → rute (docs/08-desain-ui.md §4). `available` dinyalakan saat layar fase terkait selesai.
 */
export const NAV_GROUPS: NavGroup[] = [
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
      { id: 'antrean', label: 'Antrean', href: '/display/antrean', icon: 'list', available: false },
      { id: 'jadwal', label: 'Jadwal dokter', href: '/jadwal', icon: 'cal', available: false },
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
      { id: 'rm', label: 'Rekam medis', href: '/rekam-medis/mpi', icon: 'folder', available: false },
      { id: 'logistik', label: 'Logistik', href: '/manajemen/logistik', icon: 'box', available: false },
      { id: 'mutu', label: 'Mutu & keselamatan', href: '/manajemen/mutu', icon: 'award', available: false },
    ],
  },
  {
    title: 'SISTEM',
    items: [
      { id: 'akses', label: 'Pengguna & akses', href: '/sistem/akses', icon: 'shield', available: false },
      { id: 'audit', label: 'Jejak audit', href: '/sistem/audit', icon: 'history', available: false },
      {
        id: 'formulir',
        label: 'Formulir klinis',
        href: '/sistem/formulir',
        icon: 'layout',
        available: false,
      },
      { id: 'integrasi', label: 'Integrasi', href: '/sistem/integrasi', icon: 'plug', available: false },
    ],
  },
];

/** Cari menu aktif dari pathname: cocokkan prefix terpanjang. */
/** Area superadmin platform; hanya tampil bila `superadminAccess()` mengizinkan (lihat lib/access.ts). */
export const SUPERADMIN_GROUP: NavGroup = {
  title: 'SUPERADMIN',
  items: [
    { id: 'panduan', label: 'Panduan sistem', href: '/superadmin/panduan', icon: 'info', available: true },
    { id: 'devui', label: 'Fondasi UI', href: '/dev/ui', icon: 'palette', available: true },
  ],
};

/** Grup menu untuk pengguna saat ini. Grup superadmin disembunyikan bila aksesnya tertutup. */
export function navGroups(opts: { superadmin: boolean }): NavGroup[] {
  return opts.superadmin ? [...NAV_GROUPS, SUPERADMIN_GROUP] : NAV_GROUPS;
}

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
