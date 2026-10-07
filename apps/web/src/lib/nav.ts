import type { TenantKind } from '@simrs/shared';
import type { DomainKey, IconName, NavGroup, NavItem } from '@simrs/ui';
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
      // FE2 · layar demo RME fase 3
      { id: 'worklist', label: 'Worklist klinis', href: '/klinis/worklist', icon: 'list', available: false },
      {
        id: 'ringkasan',
        label: 'Ringkasan pasien',
        href: '/klinis/ringkasan',
        icon: 'folder',
        available: false,
      },
      { id: 'paket', label: 'Paket layanan', href: '/klinis/paket-layanan', icon: 'cal', available: false },
      { id: 'konsul', label: 'Konsultasi', href: '/klinis/konsultasi', icon: 'users', available: false },
      // FE2 · akhir
      { id: 'poli', label: 'Pasien saya', href: '/klinis/poli', icon: 'users', available: false },
      { id: 'igd', label: 'IGD', href: '/klinis/igd', icon: 'pulse', available: false },
      { id: 'ranap', label: 'Rawat inap', href: '/klinis/rawat-inap', icon: 'bed', available: false },
      { id: 'bed', label: 'Tempat tidur', href: '/klinis/tempat-tidur', icon: 'layout', available: false },
      // FE5 · onkologi (B11)
      { id: 'onkologi', label: 'Onkologi', href: '/klinis/onkologi', icon: 'pulse', available: false },
      // FE5 · akhir onkologi
    ],
  },
  {
    title: 'PENUNJANG',
    items: [
      { id: 'lab', label: 'Laboratorium', href: '/penunjang/lab', icon: 'flask', available: false },
      { id: 'rad', label: 'Radiologi', href: '/penunjang/radiologi', icon: 'scan', available: false },
      { id: 'farmasi', label: 'Farmasi', href: '/penunjang/farmasi', icon: 'pill', available: false },
      { id: 'ok', label: 'Kamar operasi', href: '/penunjang/kamar-operasi', icon: 'cut', available: false },
      // FE3 · penunjang lanjutan
      {
        id: 'kritis',
        label: 'Hasil kritis',
        href: '/penunjang/hasil-kritis',
        icon: 'alert',
        available: false,
      },
      { id: 'depo', label: 'Depo & stok', href: '/penunjang/depo', icon: 'box', available: false },
      {
        id: 'bank-darah',
        label: 'Bank darah',
        href: '/penunjang/bank-darah',
        icon: 'pulse',
        available: false,
      },
      { id: 'gizi', label: 'Gizi', href: '/penunjang/gizi', icon: 'list', available: false },
      {
        id: 'mikro',
        label: 'Mikrobiologi & PA',
        href: '/penunjang/mikrobiologi',
        icon: 'flask',
        available: false,
      },
      {
        id: 'diagnostik',
        label: 'Diagnostik lain',
        href: '/penunjang/diagnostik',
        icon: 'pulse',
        available: false,
      },
      // FE3 · akhir
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
      // FE4 · keuangan lanjutan
      { id: 'tarif', label: 'Tarif & paket', href: '/keuangan/tarif', icon: 'list', available: false },
      {
        id: 'charge',
        label: 'Charge capture',
        href: '/keuangan/charge-capture',
        icon: 'pulse',
        available: false,
      },
      { id: 'piutang', label: 'Piutang', href: '/keuangan/piutang', icon: 'fileCheck', available: false },
      { id: 'koding', label: 'Workbench koder', href: '/keuangan/koding', icon: 'search', available: false },
      {
        id: 'jaspel',
        label: 'Jasa pelayanan',
        href: '/keuangan/jasa-pelayanan',
        icon: 'users',
        available: false,
      },
      { id: 'kas-bank', label: 'Kas & bank', href: '/keuangan/kas-bank', icon: 'bank', available: false },
      { id: 'hutang', label: 'Hutang usaha', href: '/keuangan/hutang', icon: 'box', available: false },
      {
        id: 'costing',
        label: 'Costing & case-mix',
        href: '/keuangan/costing',
        icon: 'chart',
        available: false,
      },
      // FE4 · akhir
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
  // FE5 · back office fase 8 (B02–B13) dan command center/dataset riset fase 9
  {
    title: 'BACK OFFICE',
    items: [
      {
        id: 'rm-adm',
        label: 'RM administratif',
        href: '/rekam-medis/administrasi',
        icon: 'folder',
        available: false,
      },
      { id: 'sdm', label: 'SDM & kepegawaian', href: '/manajemen/sdm', icon: 'users', available: false },
      {
        id: 'kredensial',
        label: 'Kredensial & kewenangan',
        href: '/manajemen/kredensial',
        icon: 'idCard',
        available: false,
      },
      { id: 'ppi', label: 'PPI', href: '/manajemen/ppi', icon: 'shield', available: false },
      { id: 'aset', label: 'Aset & pemeliharaan', href: '/manajemen/aset', icon: 'box', available: false },
      {
        id: 'penggajian',
        label: 'Penggajian',
        href: '/manajemen/penggajian',
        icon: 'wallet',
        available: false,
      },
      { id: 'ppra', label: 'PPRA', href: '/manajemen/ppra', icon: 'pill', available: false },
      {
        id: 'regdok',
        label: 'Dokumen & akreditasi',
        href: '/manajemen/dokumen',
        icon: 'fileCheck',
        available: false,
      },
      {
        id: 'pengaduan',
        label: 'Pengalaman pasien',
        href: '/manajemen/pengaduan',
        icon: 'bell',
        available: false,
      },
      {
        id: 'pendidikan',
        label: 'Pendidikan klinik',
        href: '/manajemen/pendidikan',
        icon: 'book',
        available: false,
      },
      {
        id: 'command-center',
        label: 'Command center',
        href: '/manajemen/command-center',
        icon: 'layout',
        available: false,
      },
      {
        id: 'dataset-riset',
        label: 'Dataset riset',
        href: '/manajemen/dataset-riset',
        icon: 'search',
        available: false,
      },
    ],
  },
  // FE5 · akhir
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
      // FE3 · konektor integrasi
      {
        id: 'satusehat',
        label: 'SATUSEHAT',
        href: '/sistem/integrasi/satusehat',
        icon: 'plug',
        available: false,
      },
      { id: 'bpjs', label: 'BPJS', href: '/sistem/integrasi/bpjs', icon: 'plug', available: false },
      {
        id: 'kemenkes',
        label: 'Kemenkes',
        href: '/sistem/integrasi/kemenkes',
        icon: 'plug',
        available: false,
      },
      {
        id: 'perangkat',
        label: 'Perangkat medis',
        href: '/sistem/integrasi/perangkat',
        icon: 'plug',
        available: false,
      },
      {
        id: 'api-publik',
        label: 'API publik',
        href: '/sistem/integrasi/api-publik',
        icon: 'plug',
        available: false,
      },
      // FE3 · akhir konektor
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

/**
 * Menu tambahan khusus Superadmin demo di mode presentasi (ADR-0023 keputusan 10): layar registri yang tidak punya
 * menu sendiri (sub-layar RME, layar berparameter yang dibuka lewat halaman indeks berisi contoh pasien, layar
 * perangkat/pratinjau) dan panduan sistem. Disisipkan ke grup yang sama judulnya, atau grup baru sebelum SISTEM /
 * di akhir. Posisi lain tidak melihat menu ini (mereka membuka layar itu dari worklist/alur masing-masing).
 */
export const ALL_ACCESS_NAV: ReadonlyArray<{ title: string; items: WebNavItem[] }> = [
  {
    title: 'KLINIS',
    items: [
      { id: 'order', label: 'Order & resep (CPOE)', href: '/klinis/order', icon: 'pill', available: false },
      { id: 'cppt', label: 'CPPT & serah terima', href: '/klinis/cppt', icon: 'book', available: false },
      {
        id: 'asesmen',
        label: 'Asesmen & skrining',
        href: '/klinis/asesmen',
        icon: 'fileCheck',
        available: false,
      },
      {
        id: 'diagnosis',
        label: 'Diagnosis & problem list',
        href: '/klinis/diagnosis',
        icon: 'list',
        available: false,
      },
      {
        id: 'askep',
        label: 'Asuhan keperawatan',
        href: '/klinis/asuhan-keperawatan',
        icon: 'pulse',
        available: false,
      },
      { id: 'edukasi', label: 'Edukasi pasien', href: '/klinis/edukasi', icon: 'info', available: false },
      { id: 'resume', label: 'Resume medis', href: '/klinis/resume', icon: 'fileCheck', available: false },
      {
        id: 'kelengkapan',
        label: 'Kelengkapan rekam medis',
        href: '/klinis/kelengkapan',
        icon: 'check',
        available: false,
      },
    ],
  },
  {
    title: 'PERANGKAT & PRATINJAU',
    items: [
      { id: 'kiosk', label: 'Anjungan mandiri', href: '/kiosk', icon: 'qr', available: false },
      {
        id: 'consent',
        label: 'Tablet persetujuan',
        href: '/tablet/persetujuan',
        icon: 'idCard',
        available: false,
      },
      {
        id: 'app-pasien',
        label: 'Aplikasi pasien',
        href: '/pratinjau/aplikasi-pasien',
        icon: 'phone',
        available: false,
      },
      {
        id: 'app-dokter',
        label: 'Aplikasi dokter',
        href: '/pratinjau/aplikasi-dokter',
        icon: 'phone',
        available: false,
      },
    ],
  },
  {
    title: 'PANDUAN',
    items: [
      { id: 'panduan', label: 'Panduan sistem', href: '/superadmin/panduan', icon: 'info', available: true },
    ],
  },
];

/** Gabungkan menu Superadmin demo ke menu dasar (grup bernama sama ditambah, grup baru sebelum SISTEM / di akhir). */
function withAllAccessNav(
  groups: WebNavGroup[],
  extras: ReadonlyArray<{ title: string; items: WebNavItem[] }> = ALL_ACCESS_NAV,
): WebNavGroup[] {
  const out = groups.map((g) => ({ ...g, items: [...g.items] }));
  for (const extra of extras) {
    if (extra.items.length === 0) continue;
    const same = out.find((g) => g.title === extra.title);
    if (same) {
      same.items.push(...extra.items);
      continue;
    }
    const system = out.findIndex((g) => g.title === 'SISTEM');
    const group = { title: extra.title, items: [...extra.items] };
    if (extra.title !== 'PANDUAN' && system >= 0) out.splice(system, 0, group);
    else out.push(group);
  }
  return out;
}

/**
 * Mode api: layar hibrida yang di mode presentasi hanya dibuka lewat alur (worklist, skenario) dan menu Superadmin
 * demo, mis. CPOE, Edukasi, Tablet persetujuan. Selama worklist K01 dan Pemeriksaan poli belum tersambung, tanpa menu
 * ini dokter rawat jalan tidak punya pintu masuk ke layar yang sudah tersambung. Hanya layar ber-izin sungguhan
 * (`permission`) dan bukan khusus perangkat; menu tetap disaring izin peran di `navGroups`.
 */
const API_ENTRY_NAV = ALL_ACCESS_NAV.map((g) => ({
  title: g.title,
  items: g.items.filter((i) => {
    const screen = screenById(i.id);
    return !!screen?.permission && screen.layout === 'staf';
  }),
}));

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
  /**
   * Sesi Superadmin demo yang sudah diverifikasi server (ADR-0023 keputusan 10): semua layar registri + menu
   * tambahan. Hanya berlaku di mode presentasi dan di RS; diabaikan total di mode api.
   */
  allAccess?: boolean;
  /**
   * Modul aktif RS dari toko demo (layar Pengaturan, `readActiveModules`). Mode presentasi saja: layar yang semua
   * komponennya dimatikan disembunyikan dari menu. Pengaturan sendiri tidak pernah disembunyikan agar modul bisa
   * dinyalakan lagi. Diabaikan di mode api.
   */
  modules?: Readonly<Partial<Record<string, boolean>>> | null;
}): WebNavGroup[] {
  const allAccess = opts.allAccess === true && opts.dataSource === 'demo' && opts.kind === 'hospital';
  const base = allAccess
    ? withAllAccessNav(NAV_GROUPS)
    : opts.dataSource === 'api'
      ? withAllAccessNav(NAV_GROUPS, API_ENTRY_NAV)
      : NAV_GROUPS;
  const groups = base
    .map((g) => ({
      ...g,
      items: g.items.flatMap((item): WebNavItem[] => {
        if (item.requires && !opts.permissions.includes(item.requires)) return [];
        if (opts.kind === 'platform' && !PLATFORM_ITEM_IDS.has(item.id)) return [];
        const screen = screenById(item.id);
        if (!screen) return [item];
        if (
          opts.dataSource === 'demo' &&
          opts.modules &&
          screen.id !== 'pengaturan' &&
          screen.components.length > 0 &&
          screen.components.every((c) => opts.modules?.[c] === false)
        )
          return [];
        const open = screenOpen(screen, { ...opts, allAccess });
        // Mode presentasi: layar posisi lain disembunyikan. Layar hibrida (ber-izin) di mode api mengikuti izin
        // sungguhan seperti menu ber-`requires`: tanpa izin, menu tidak tampil.
        if (!open && (screen.permission || (screen.status === 'demo' && opts.dataSource === 'demo')))
          return [];
        return [{ ...item, available: open }];
      }),
    }))
    .filter((g) => g.items.length > 0);
  const withDomain = (g: WebNavGroup): WebNavGroup => ({
    ...g,
    domain: groupDomain(g.title),
    icon: GROUP_ICON[g.title] ?? 'layout',
  });
  return (opts.superadmin ? [...groups, SUPERADMIN_GROUP] : groups).map(withDomain);
}

/**
 * Rona domain per grup menu (Pelangi Klinis, ADR-0091): front office samudra, klinis zamrud, penunjang anggrek,
 * keuangan toska, manajemen + back office bougenvil, sistem batu. Grup umum/perangkat memakai samudra (bawaan).
 */
const GROUP_DOMAIN: Readonly<Record<string, DomainKey>> = {
  UMUM: 'fo',
  'FRONT OFFICE': 'fo',
  KLINIS: 'kl',
  PENUNJANG: 'pj',
  KEUANGAN: 'ku',
  MANAJEMEN: 'mj',
  'BACK OFFICE': 'mj',
  SISTEM: 'si',
  SUPERADMIN: 'si',
  'PERANGKAT & PRATINJAU': 'fo',
  PANDUAN: 'si',
};

/** Ikon grup di dock (ADR-0092). */
const GROUP_ICON: Readonly<Record<string, IconName>> = {
  UMUM: 'home',
  'FRONT OFFICE': 'userPlus',
  KLINIS: 'pulse',
  PENUNJANG: 'flask',
  KEUANGAN: 'wallet',
  MANAJEMEN: 'chart',
  'BACK OFFICE': 'box',
  SISTEM: 'shield',
  SUPERADMIN: 'palette',
  'PERANGKAT & PRATINJAU': 'phone',
  PANDUAN: 'book',
};

export function groupDomain(title: string): DomainKey {
  return GROUP_DOMAIN[title] ?? 'fo';
}

/** Domain dan label grup menu untuk pathname (warna jendela + label di header). Tanpa menu cocok: samudra. */
export function navContext(pathname: string): { domain: DomainKey; label: string } {
  const id = activeNavId(pathname);
  const group = id
    ? [...NAV_GROUPS, SUPERADMIN_GROUP, ...ALL_ACCESS_NAV].find((g) => g.items.some((i) => i.id === id))
    : undefined;
  if (!group) return { domain: 'fo', label: '' };
  const t = group.title;
  return { domain: groupDomain(t), label: t.charAt(0) + t.slice(1).toLowerCase() };
}

/** Cari menu aktif dari pathname: cocokkan prefix terpanjang. */
export function activeNavId(pathname: string): string | undefined {
  let best: { id: string; len: number } | undefined;
  for (const g of [...NAV_GROUPS, SUPERADMIN_GROUP, ...ALL_ACCESS_NAV]) {
    for (const item of g.items) {
      const match =
        item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.len)) best = { id: item.id, len: item.href.length };
    }
  }
  return best?.id;
}
