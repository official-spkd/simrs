import { CARE_CLASSES, type CareClass, FACILITY_CODE, type UnitKind } from '@simrs/shared';

/**
 * P01 · Struktur RS (mode presentasi, ADR-0023): faskes → unit → ruang → kamar → bed, kelas rawat, status aktif.
 * Logika murni (tanpa React) agar aturan tambah/nonaktifkan teruji: kode mengikuti `FACILITY_CODE` bersama API,
 * kamar rawat inap wajib kelas rawat, dan simpul yang masih punya bed terisi tidak bisa dinonaktifkan.
 * Struktur tidak pernah dihapus: nonaktif = tidak tampil di pilihan baru, riwayat tetap.
 */

export const STRUCT_KINDS = ['faskes', 'unit', 'ruang', 'kamar', 'bed'] as const;
export type StructKind = (typeof STRUCT_KINDS)[number];

export interface StructNode {
  id: string;
  kind: StructKind;
  parentId: string | null;
  code: string;
  name: string;
  /** Hanya unit. */
  unitKind?: UnitKind;
  /** Kamar dan bed (bed mewarisi kelas kamarnya). */
  careClass?: CareClass;
  active: boolean;
  /** Bed: sedang ditempati pasien (hari demo). */
  occupied?: boolean;
}

export const KIND_LABEL: Record<StructKind, string> = {
  faskes: 'Faskes',
  unit: 'Unit',
  ruang: 'Ruang',
  kamar: 'Kamar',
  bed: 'Bed',
};

export const CHILD_KIND: Record<StructKind, StructKind | null> = {
  faskes: 'unit',
  unit: 'ruang',
  ruang: 'kamar',
  kamar: 'bed',
  bed: null,
};

export const UNIT_KIND_LABEL: Record<UnitKind, string> = {
  instalasi: 'Instalasi',
  poli: 'Poli rawat jalan',
  igd: 'Gawat darurat',
  rawat_inap: 'Rawat inap',
  penunjang: 'Penunjang',
  farmasi: 'Farmasi',
  kamar_operasi: 'Kamar operasi',
  administrasi: 'Administrasi',
};

export const CARE_CLASS_LABEL: Record<CareClass, string> = {
  vvip: 'VVIP',
  vip: 'VIP',
  kelas_1: 'Kelas 1',
  kelas_2: 'Kelas 2',
  kelas_3: 'Kelas 3',
  icu: 'ICU',
  hcu: 'HCU',
  nicu: 'NICU',
  picu: 'PICU',
  isolasi: 'Isolasi',
  tanpa_kelas: 'Tanpa kelas',
};

export function childrenOf(nodes: readonly StructNode[], parentId: string | null): StructNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

/** Semua keturunan (tanpa simpul itu sendiri). */
export function descendantsOf(nodes: readonly StructNode[], id: string): StructNode[] {
  const out: StructNode[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const c of nodes.filter((n) => n.parentId === cur)) {
      out.push(c);
      stack.push(c.id);
    }
  }
  return out;
}

/** Jalur dari faskes sampai simpul (untuk breadcrumb detail). */
export function pathOf(nodes: readonly StructNode[], id: string): StructNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: StructNode[] = [];
  let cur = byId.get(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Unit tempat simpul berada (unit itu sendiri bila simpulnya unit). */
export function unitOf(nodes: readonly StructNode[], id: string): StructNode | undefined {
  return pathOf(nodes, id).find((n) => n.kind === 'unit');
}

export interface BedCount {
  careClass: CareClass;
  total: number;
  occupied: number;
  inactive: number;
}

/**
 * Rekap bed per kelas rawat (bahan Aplicare/SIRANAP): hanya bed yang jalur induknya aktif dihitung tersedia;
 * bed di bawah simpul nonaktif dihitung `inactive`.
 */
export function bedSummary(nodes: readonly StructNode[]): BedCount[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const effectiveActive = (n: StructNode): boolean => {
    let cur: StructNode | undefined = n;
    while (cur) {
      if (!cur.active) return false;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return true;
  };
  const map = new Map<CareClass, BedCount>();
  for (const b of nodes.filter((n) => n.kind === 'bed')) {
    const cls = b.careClass ?? 'tanpa_kelas';
    const row = map.get(cls) ?? { careClass: cls, total: 0, occupied: 0, inactive: 0 };
    if (effectiveActive(b)) {
      row.total += 1;
      if (b.occupied) row.occupied += 1;
    } else row.inactive += 1;
    map.set(cls, row);
  }
  return CARE_CLASSES.flatMap((c) => {
    const row = map.get(c);
    return row ? [row] : [];
  });
}

export type Check = { ok: true } | { ok: false; reason: string };

/** Boleh dinonaktifkan? Faskes utama tidak; simpul dengan bed terisi (diri atau keturunan) tidak. */
export function canDeactivate(nodes: readonly StructNode[], id: string): Check {
  const node = nodes.find((n) => n.id === id);
  if (!node) return { ok: false, reason: 'Simpul tidak ditemukan.' };
  if (!node.active) return { ok: false, reason: `${KIND_LABEL[node.kind]} ini sudah nonaktif.` };
  if (node.kind === 'faskes' && node.parentId === null && childrenOf(nodes, null)[0]?.id === id) {
    return { ok: false, reason: 'Faskes utama tidak bisa dinonaktifkan (tenant RS tetap berjalan).' };
  }
  const beds = [node, ...descendantsOf(nodes, id)].filter((n) => n.kind === 'bed' && n.active && n.occupied);
  if (beds.length > 0) {
    return {
      ok: false,
      reason: `${beds.length} bed masih terisi pasien (${beds
        .slice(0, 3)
        .map((b) => b.name)
        .join(', ')}). Pindahkan atau pulangkan pasien lewat ADT dulu.`,
    };
  }
  return { ok: true };
}

/** Nonaktifkan simpul beserta seluruh keturunannya (tidak dihapus). */
export function deactivate(nodes: readonly StructNode[], id: string): StructNode[] {
  const ids = new Set([id, ...descendantsOf(nodes, id).map((n) => n.id)]);
  return nodes.map((n) => (ids.has(n.id) ? { ...n, active: false } : n));
}

export function canReactivate(nodes: readonly StructNode[], id: string): Check {
  const node = nodes.find((n) => n.id === id);
  if (!node) return { ok: false, reason: 'Simpul tidak ditemukan.' };
  if (node.active) return { ok: false, reason: `${KIND_LABEL[node.kind]} ini sudah aktif.` };
  const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
  if (parent && !parent.active) {
    return { ok: false, reason: `${KIND_LABEL[parent.kind]} induk (${parent.name}) masih nonaktif.` };
  }
  return { ok: true };
}

/** Aktifkan kembali satu simpul (keturunan tetap pada status masing-masing; induk harus aktif). */
export function reactivate(nodes: readonly StructNode[], id: string): StructNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, active: true } : n));
}

export interface NewChildInput {
  code: string;
  name: string;
  unitKind?: UnitKind;
  careClass?: CareClass;
}

export type AddResult =
  | { ok: true; nodes: StructNode[]; node: StructNode }
  | { ok: false; field: 'code' | 'name' | 'careClass' | 'unitKind' | 'parent'; message: string };

/**
 * Tambah simpul anak. Kode divalidasi skema bersama API (`FACILITY_CODE`) dan unik per tenant (unit) atau per
 * induk (ruang/kamar/bed). Kamar di unit rawat inap wajib kelas rawat; bed mewarisi kelas kamarnya.
 */
export function addChild(nodes: readonly StructNode[], parentId: string, input: NewChildInput): AddResult {
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent) return { ok: false, field: 'parent', message: 'Induk tidak ditemukan.' };
  if (!parent.active) {
    return {
      ok: false,
      field: 'parent',
      message: `${KIND_LABEL[parent.kind]} induk nonaktif; aktifkan dulu.`,
    };
  }
  const kind = CHILD_KIND[parent.kind];
  if (!kind) return { ok: false, field: 'parent', message: 'Bed tidak punya simpul anak.' };
  const code = FACILITY_CODE.safeParse(input.code);
  if (!code.success) {
    return { ok: false, field: 'code', message: code.error.issues[0]?.message ?? 'Kode tidak valid' };
  }
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, field: 'name', message: 'Nama minimal 2 karakter' };
  const scope = kind === 'unit' ? nodes.filter((n) => n.kind === 'unit') : childrenOf(nodes, parentId);
  if (scope.some((n) => n.code === code.data)) {
    return {
      ok: false,
      field: 'code',
      message:
        kind === 'unit'
          ? `Kode unit ${code.data} sudah dipakai`
          : `Kode ${code.data} sudah ada di bawah ${parent.name}`,
    };
  }
  if (kind === 'unit' && !input.unitKind)
    return { ok: false, field: 'unitKind', message: 'Pilih jenis unit' };
  const unit = unitOf(nodes, parentId);
  let careClass: CareClass | undefined;
  if (kind === 'kamar') {
    careClass = input.careClass;
    if (unit?.unitKind === 'rawat_inap' && !careClass) {
      return { ok: false, field: 'careClass', message: 'Kamar rawat inap wajib punya kelas rawat' };
    }
  }
  if (kind === 'bed') careClass = parent.careClass ?? 'tanpa_kelas';
  const node: StructNode = {
    id: `${parentId}/${code.data.toLowerCase()}`,
    kind,
    parentId,
    code: code.data,
    name,
    active: true,
    ...(kind === 'unit' ? { unitKind: input.unitKind } : {}),
    ...(careClass ? { careClass } : {}),
    ...(kind === 'bed' ? { occupied: false } : {}),
  };
  return { ok: true, nodes: [...nodes, node], node };
}

/** Jumlah bed aktif/terisi di bawah simpul (untuk baris pohon). */
export function bedCountUnder(nodes: readonly StructNode[], id: string): { total: number; occupied: number } {
  const beds = [nodes.find((n) => n.id === id), ...descendantsOf(nodes, id)].filter(
    (n): n is StructNode => !!n && n.kind === 'bed' && n.active,
  );
  return { total: beds.length, occupied: beds.filter((b) => b.occupied).length };
}
