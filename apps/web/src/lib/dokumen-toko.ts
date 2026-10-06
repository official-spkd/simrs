import { z } from 'zod';
import {
  type ActorRef,
  actorRef,
  idSchema,
  jamSchema,
  type LogLine,
  must,
  pushLog,
  roleBlock,
} from './backoffice-toko';
import { type DemoActor, defineDomain } from './demo/store/define';
import {
  ACCREDITATION_CHAPTERS,
  DISTRIBUTION_UNITS,
  READ_RECEIPTS,
  REG_DOCS,
} from './demo/fixtures/regulasi';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { publish, type RegDoc } from './dokumen';

/**
 * B12 · Domain toko demo `regulasi` (ADR-0085, CX-3): dokumen berversi `draf → telaah → disetujui → terbit`, versi
 * baru untuk tinjau ulang, pengingat baca, dan tautan bukti akreditasi. Pemisahan tugas memakai pengguna sesi (utang
 * bug 6 Okt): penyetuju ≠ penyusun (ID sesi; penyusun fixture dibandingkan dengan nama), dan versi baru disusun oleh
 * pengguna yang memulainya (tidak lagi mewarisi penyusun versi lama).
 */

export const REG_DOCS_DOMAIN = 'regulasi';
export const DOC_APPROVER_ROLES = ['auditor_mutu', 'manajemen'] as const;
export const MIN_REVIEW_NOTE = 10;

export const regDocsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('dokumen.ditelaah'), id: idSchema, jam: jamSchema }),
  z.strictObject({
    type: z.literal('dokumen.disetujui'),
    id: idSchema,
    note: z.string().trim().min(MIN_REVIEW_NOTE).max(500),
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('dokumen.diterbitkan'), id: idSchema, jam: jamSchema }),
  z.strictObject({ type: z.literal('dokumen.versi-baru'), id: idSchema, jam: jamSchema }),
  z.strictObject({
    type: z.literal('baca.diingatkan'),
    docId: idSchema,
    unit: z.string().min(1).max(80),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('bukti.ditautkan'),
    chapter: z.string().min(1).max(20),
    docId: idSchema,
    jam: jamSchema,
  }),
]);
export type RegDocsEvent = z.infer<typeof regDocsEventSchema>;

export interface StoredDoc extends RegDoc {
  /** Penyusun dari sesi (versi yang dibuat di layar); null = penyusun fixture (nama di `author`). */
  authorRef: ActorRef | null;
  approval: { by: ActorRef; note: string; jam: string } | null;
}

export interface RegDocsStoreState {
  docs: StoredDoc[];
  reads: Record<string, Record<string, number>>;
  reminded: Record<string, { jam: string; by: string }>;
  evidence: Record<string, number>;
  log: LogLine[];
}

export function initialRegDocs(): RegDocsStoreState {
  return {
    docs: REG_DOCS.map((d) => ({ ...d, authorRef: null, approval: null })),
    reads: Object.fromEntries(Object.entries(READ_RECEIPTS).map(([k, v]) => [k, { ...v }])),
    reminded: {},
    evidence: Object.fromEntries(ACCREDITATION_CHAPTERS.map((c) => [c.code, c.withEvidence])),
    log: [],
  };
}

/** Penyetuju harus pengguna lain dari penyusun (ID sesi; penyusun fixture: nama). */
export function isAuthor(
  doc: Pick<StoredDoc, 'author' | 'authorRef'>,
  actor: Pick<DemoActor, 'userId' | 'name'>,
) {
  return doc.authorRef ? doc.authorRef.userId === actor.userId : doc.author === actor.name;
}

export const remindKey = (docId: string, unit: string) => `${docId}|${unit}`;

function gate(s: RegDocsStoreState, ev: RegDocsEvent, actor: DemoActor): string | null {
  switch (ev.type) {
    case 'dokumen.ditelaah':
    case 'dokumen.disetujui':
    case 'dokumen.diterbitkan':
    case 'dokumen.versi-baru': {
      const d = s.docs.find((x) => x.id === ev.id);
      if (!d) return 'Dokumen tidak ditemukan.';
      const name = `${d.code} v${d.version}`;
      if (ev.type === 'dokumen.ditelaah') return d.status === 'draf' ? null : `${name} bukan draf.`;
      if (ev.type === 'dokumen.disetujui') {
        if (d.status !== 'telaah') return `${name} belum dikirim ke telaah atau sudah disetujui.`;
        const role = roleBlock(
          actor,
          DOC_APPROVER_ROLES,
          'Penyetuju dokumen: posisi Auditor mutu atau Manajemen.',
        );
        if (role) return role;
        return isAuthor(d, actor)
          ? 'Penyetuju harus pengguna lain dari penyusun dokumen (pemisahan tugas).'
          : null;
      }
      if (ev.type === 'dokumen.diterbitkan')
        return d.status === 'disetujui' ? null : `${name} belum disetujui.`;
      if (d.status !== 'terbit') return 'Versi baru dibuat dari versi yang sedang berlaku.';
      return s.docs.some((x) => x.code === d.code && x.version > d.version)
        ? `Versi baru ${d.code} sudah ada.`
        : null;
    }
    case 'baca.diingatkan': {
      const d = s.docs.find((x) => x.id === ev.docId && x.status === 'terbit');
      if (!d) return 'Dokumen terbit tidak ditemukan.';
      const u = DISTRIBUTION_UNITS.find((x) => x.unit === ev.unit);
      if (!u) return 'Unit tidak dikenal.';
      if ((s.reads[ev.docId]?.[ev.unit] ?? 0) >= u.staff) return 'Semua staf unit ini sudah membaca.';
      return s.reminded[remindKey(ev.docId, ev.unit)] ? 'Pengingat sudah dikirim.' : null;
    }
    case 'bukti.ditautkan': {
      const c = ACCREDITATION_CHAPTERS.find((x) => x.code === ev.chapter);
      if (!c) return 'Bab tidak dikenal.';
      if (!s.docs.some((x) => x.id === ev.docId && x.status === 'terbit'))
        return 'Bukti harus dokumen yang sedang berlaku.';
      return (s.evidence[ev.chapter] ?? 0) >= c.elements ? 'Semua elemen bab ini sudah berbukti.' : null;
    }
  }
}

export const regDocsDomain = defineDomain<RegDocsStoreState, RegDocsEvent>(REG_DOCS_DOMAIN, {
  initial: initialRegDocs,
  eventSchema: regDocsEventSchema,
  screens: ['regdok'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    const log = (text: string) => pushLog(s.log, { jam: d.jam, text, by: by.name });
    const put = (id: string, patch: Partial<StoredDoc>) =>
      s.docs.map((x) => (x.id === id ? { ...x, ...patch } : x));
    switch (d.type) {
      case 'dokumen.ditelaah':
        return { ...s, docs: put(d.id, { status: 'telaah' }), log: log(`${d.id} dikirim ke telaah`) };
      case 'dokumen.disetujui':
        return {
          ...s,
          docs: put(d.id, { status: 'disetujui', approval: { by, note: d.note.trim(), jam: d.jam } }),
          log: log(`${d.id} disetujui`),
        };
      case 'dokumen.diterbitkan': {
        const published = publish(s.docs, d.id, DEMO_TODAY) as StoredDoc[];
        return { ...s, docs: published, reads: { ...s.reads, [d.id]: {} }, log: log(`${d.id} terbit`) };
      }
      case 'dokumen.versi-baru': {
        const src = s.docs.find((x) => x.id === d.id) as StoredDoc;
        const id = `${src.id}-r${src.version + 1}`;
        return {
          ...s,
          docs: [
            ...s.docs,
            {
              ...src,
              id,
              version: src.version + 1,
              status: 'draf',
              publishedAt: null,
              reviewDue: null,
              // Penyusun versi baru = pengguna yang memulai tinjau ulang (bukan penyusun versi lama).
              author: by.name,
              authorRef: by,
              approval: null,
            },
          ],
          log: log(`Draf ${src.code} v${src.version + 1} dibuat`),
        };
      }
      case 'baca.diingatkan':
        return {
          ...s,
          reminded: { ...s.reminded, [remindKey(d.docId, d.unit)]: { jam: d.jam, by: by.name } },
        };
      case 'bukti.ditautkan':
        return {
          ...s,
          evidence: { ...s.evidence, [d.chapter]: (s.evidence[d.chapter] ?? 0) + 1 },
          log: log(`${d.docId} ditautkan sebagai bukti ${d.chapter}`),
        };
    }
  },
});
