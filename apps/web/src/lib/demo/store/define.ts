import type { z } from 'zod';

/**
 * Toko keadaan demo bersama (ADR-0085), bagian murni: definisi domain, langganan lintas domain, dan proyeksi
 * keadaan dari log kejadian. Tanpa I/O dan tanpa `server-only`, sehingga reducer bisa diuji unit dan tipe kejadian
 * bisa diimpor komponen klien (`import type`).
 *
 * Keadaan domain = `initial()` (fixture awal) + semua kejadian di log RS demo yang relevan, diputar ulang berurutan:
 * kejadian domain itu sendiri (`reduce`) dan kejadian domain lain yang dilanggan (`on(sumber, reducer)`).
 */

/** Pelaku kejadian: selalu dari sesi server, tidak pernah dari kiriman klien. */
export interface DemoActor {
  userId: string;
  /** Nama tampilan pengguna yang masuk. */
  name: string;
  /** Posisi yang dibawakan di layar saat aksi (untuk Superadmin demo: hasil "Bertindak sebagai"). */
  role: string | null;
  /** Penugasan asli di API bila berbeda (Superadmin demo); null untuk akun biasa. */
  baseRole: string | null;
}

/** Satu baris log (bentuk berkas). `data` divalidasi skema domainnya saat ditulis dan saat diputar ulang. */
export interface StoredEvent {
  /** Nomor urut global per RS, naik terus (juga melewati mulai ulang). */
  seq: number;
  domain: string;
  /** Jam server (ISO 8601) saat kejadian dicatat. */
  at: string;
  actor: DemoActor;
  data: unknown;
}

/** Kejadian yang diterima reducer: `data` sudah lolos skema domain sumbernya. */
export interface DomainEvent<E> {
  seq: number;
  domain: string;
  at: string;
  actor: DemoActor;
  data: E;
}

/** Bagian definisi yang dibutuhkan pelanggan: nama + skema kejadian (tanpa keadaan). */
export interface DomainSource<E> {
  readonly name: string;
  readonly eventSchema: z.ZodType<E>;
}

/** Langganan: reducer domain ini untuk kejadian domain lain. Dibuat dengan `on()`. */
export interface Subscription<S> {
  readonly source: string;
  readonly apply: (state: S, event: StoredEvent) => S;
}

export interface DomainDef<S, E extends { type: string }> extends DomainSource<E> {
  /** Keadaan awal dari fixture (fungsi: tiap proyeksi mendapat salinan baru). */
  readonly initial: () => S;
  /** Reducer murni kejadian domain ini. Melempar galat = kejadian dilewati saat diputar ulang. */
  readonly reduce: (state: S, event: DomainEvent<E>) => S;
  readonly subscriptions: readonly Subscription<S>[];
  /**
   * Id layar registri (`screens.ts`) yang menampilkan domain ini: dasar `revalidatePath` dan hak kirim kejadian lewat
   * Server Action generik (posisi aktif harus memakai salah satu layar ini).
   */
  readonly screens: readonly string[];
  /**
   * Gerbang murni sebelum kejadian dicatat (aturan bisnis terhadap keadaan terkini, pelaku dari sesi). Kembalikan
   * pesan galat (Bahasa Indonesia) untuk menolak, atau null.
   */
  readonly validate?: (state: S, event: E, actor: DemoActor) => string | null;
  /**
   * true = kejadian boleh dikirim klien lewat Server Action generik (`dispatchDemoEventAction`) karena seluruh
   * aturannya ada di skema + `validate`. Bawaan false: domain yang gerbangnya butuh data server (fixture, sampel,
   * nilai kritis) wajib punya Server Action sendiri yang memeriksa lalu memanggil `commitEvent`.
   */
  readonly generic: boolean;
}

/** Nama domain: huruf kecil, angka, tanda hubung (juga dipakai di berkas dan pesan galat). */
export const DOMAIN_NAME = /^[a-z][a-z0-9-]{1,39}$/;

export function defineDomain<S, E extends { type: string }>(
  name: string,
  opts: {
    initial: () => S;
    eventSchema: z.ZodType<E>;
    reduce: (state: S, event: DomainEvent<E>) => S;
    subscriptions?: readonly Subscription<S>[];
    screens: readonly string[];
    validate?: (state: S, event: E, actor: DemoActor) => string | null;
    generic?: boolean;
  },
): DomainDef<S, E> {
  if (!DOMAIN_NAME.test(name)) throw new Error(`Nama domain toko demo tidak sah: ${name}`);
  const subscriptions = opts.subscriptions ?? [];
  if (subscriptions.some((s) => s.source === name)) {
    throw new Error(`Domain ${name} tidak boleh melanggan dirinya sendiri`);
  }
  return { name, ...opts, subscriptions, generic: opts.generic ?? false };
}

/**
 * Langganan lintas domain: `reduce` dipanggil untuk setiap kejadian domain `source` yang lolos skemanya. Cukup
 * mengimpor definisi domain sumber (modul `lib`), bukan komponen layar sumber.
 */
export function on<S, E2>(
  source: DomainSource<E2>,
  reduce: (state: S, event: DomainEvent<E2>) => S,
): Subscription<S> {
  return {
    source: source.name,
    apply: (state, ev) => {
      const parsed = source.eventSchema.safeParse(ev.data);
      return parsed.success ? reduce(state, { ...ev, data: parsed.data }) : state;
    },
  };
}

/** Domain yang terpengaruh kejadian `domain`: domain itu sendiri + semua pelanggannya. */
export function affectedBy(
  domain: string,
  defs: readonly { name: string; subscriptions: readonly { source: string }[] }[],
): string[] {
  return defs
    .filter((d) => d.name === domain || d.subscriptions.some((s) => s.source === domain))
    .map((d) => d.name);
}

/** Log satu RS demo yang diproyeksikan (bagian berkas yang dibutuhkan proyeksi). */
export interface LogView {
  /** Nomor urut kejadian terakhir yang pernah dibuat (0 = belum ada). */
  seq: number;
  /** Nilai `seq` saat mulai ulang terakhir (0 = belum pernah). */
  resetSeq: number;
  events: readonly StoredEvent[];
}

export interface Projection<S> {
  state: S;
  /**
   * Revisi domain: `seq` kejadian relevan terakhir (atau mulai ulang terakhir). Aksi membawa revisi yang dilihatnya;
   * berbeda dari revisi terkini = tampilan basi, aksi ditolak.
   */
  rev: number;
  /** Jumlah kejadian relevan yang diterapkan. */
  applied: number;
}

/**
 * Putar ulang log untuk satu domain. Kejadian yang tidak lolos skema atau membuat reducer melempar galat dilewati
 * (definisi berubah, berkas diubah tangan), sehingga toko tetap bisa dipakai.
 */
export function project<S, E extends { type: string }>(def: DomainDef<S, E>, log: LogView): Projection<S> {
  let state = def.initial();
  let rev = log.resetSeq;
  let applied = 0;
  for (const ev of log.events) {
    if (ev.domain === def.name) {
      rev = Math.max(rev, ev.seq);
      const parsed = def.eventSchema.safeParse(ev.data);
      if (!parsed.success) continue;
      try {
        state = def.reduce(state, { ...ev, data: parsed.data });
        applied++;
      } catch {
        // Kejadian yang tidak sah lagi menurut reducer: dilewati.
      }
      continue;
    }
    for (const sub of def.subscriptions) {
      if (sub.source !== ev.domain) continue;
      rev = Math.max(rev, ev.seq);
      try {
        state = sub.apply(state, ev);
        applied++;
      } catch {
        // idem
      }
    }
  }
  return { state, rev, applied };
}
