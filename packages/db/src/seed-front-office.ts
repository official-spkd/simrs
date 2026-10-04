import { newId } from '@simrs/shared';
import { type PrismaClient, type TenantTx, withTenant } from './client';
import { SEED_STAFF } from './seed-data';

/**
 * Fase 2 · potongan 0b · Seed front office per RS (data fiktif, selaras layar mode presentasi
 * `apps/web/src/lib/demo/fixtures/{rs,staf,front-office}.ts`): layanan antrean poli PD/JT/SR/PR + loket A + farmasi F,
 * kode poli BPJS, praktisi, templat jadwal mingguan, penjamin, dan papan "Rawat Jalan Lantai 2".
 * Sesi per tanggal TIDAK di-seed: dibangkitkan job jadwal (potongan 2) dari templat.
 */

export interface SeedQueueService {
  code: string;
  name: string;
  kind: 'poli' | 'loket' | 'farmasi';
  unitCode: string;
  room: string;
  floor: number;
  /** Kode poli BPJS (referensi poli VClaim/Antrean), disimpan di `external_ids` sistem `bpjs:poli`. */
  bpjsPoli: string | null;
}

export const SEED_QUEUE_SERVICES: readonly SeedQueueService[] = [
  {
    code: 'PD',
    name: 'Penyakit Dalam',
    kind: 'poli',
    unitCode: 'POLI-DALAM',
    room: 'Ruang 2',
    floor: 2,
    bpjsPoli: 'INT',
  },
  {
    code: 'JT',
    name: 'Jantung',
    kind: 'poli',
    unitCode: 'POLI-JANTUNG',
    room: 'Ruang 4',
    floor: 2,
    bpjsPoli: 'JAN',
  },
  {
    code: 'SR',
    name: 'Saraf',
    kind: 'poli',
    unitCode: 'POLI-SARAF',
    room: 'Ruang 5',
    floor: 2,
    bpjsPoli: 'SAR',
  },
  {
    code: 'PR',
    name: 'Paru',
    kind: 'poli',
    unitCode: 'POLI-PARU',
    room: 'Ruang 6',
    floor: 2,
    bpjsPoli: 'PAR',
  },
  {
    code: 'A',
    name: 'Loket Pendaftaran',
    kind: 'loket',
    unitCode: 'REKAM-MEDIS',
    room: 'Lobi Utama',
    floor: 1,
    bpjsPoli: null,
  },
  {
    code: 'F',
    name: 'Farmasi Rawat Jalan',
    kind: 'farmasi',
    unitCode: 'FARMASI',
    room: 'Depo Farmasi Rawat Jalan',
    floor: 1,
    bpjsPoli: null,
  },
];

export interface SeedPractitioner {
  /** Kunci seed (dipakai templat jadwal), sama dengan ID dokter di fixture mode presentasi tanpa awalan `dr-`. */
  key: string;
  /** NIP staf seed (`SEED_STAFF`) bila praktisi punya akun; nama diambil dari sana. */
  nip: string | null;
  /** Nama untuk praktisi tanpa akun seed. */
  name?: string;
  specialty: string;
  /**
   * Kode dokter HFIS fiktif (sistem `bpjs:hfis-dokter`), sama dengan mock BPJS (`apps/mock/src/systems/bpjs/master.ts`,
   * 99001–99006). Hanya dokter yang praktik di poli rawat jalan BPJS.
   */
  hfisCode?: string;
}

/**
 * Praktisi seed: dokter dan residen staf seed (tertaut akunnya), ditambah dokter yang tampil di layar mode presentasi
 * tetapi tidak di-seed sebagai akun (dr. Andini = akun presentasi, dibuat `pnpm db:akun-presentasi`).
 * Urutan menentukan nomor fiktif (IHS = kunci alami seed): tambahkan di akhir, jangan disisipkan atau diurutkan ulang.
 */
export const SEED_PRACTITIONERS: readonly SeedPractitioner[] = [
  { key: 'rahmat', nip: '999905172008031001', specialty: 'Penyakit dalam', hfisCode: '99002' },
  { key: 'sinta', nip: '999911022010012002', specialty: 'Penyakit dalam (ginjal hipertensi)' },
  { key: 'nadia', nip: '999908242012032003', specialty: 'Anak' },
  { key: 'yohanes', nip: '999903092006041004', specialty: 'Bedah' },
  { key: 'ferry', nip: '999907212011021005', specialty: 'Anestesi' },
  { key: 'hana', nip: '999901152009022006', specialty: 'Kebidanan dan kandungan' },
  { key: 'maya', nip: '999912062013052007', specialty: 'Patologi klinik' },
  { key: 'arman', nip: '999904302007021008', specialty: 'Radiologi' },
  { key: 'damar', nip: '999909112019031009', specialty: 'Dokter umum (IGD)' },
  { key: 'reza', nip: '999902282022011010', specialty: 'Residen emergensi' },
  { key: 'laila', nip: '999906132022012011', specialty: 'Residen penyakit dalam' },
  {
    key: 'andini',
    nip: null,
    name: 'dr. Andini Prameswari, Sp.PD',
    specialty: 'Penyakit dalam',
    hfisCode: '99001',
  },
  { key: 'bagus', nip: null, name: 'dr. Bagus Santoso, Sp.JP', specialty: 'Jantung', hfisCode: '99003' },
  {
    key: 'melati',
    nip: null,
    name: 'dr. Melati Kusumawardani, Sp.JP',
    specialty: 'Jantung',
    hfisCode: '99004',
  },
  { key: 'yudha', nip: null, name: 'dr. Yudha Pratama, Sp.N', specialty: 'Saraf', hfisCode: '99005' },
  { key: 'kartika', nip: null, name: 'dr. Kartika Sari, Sp.P', specialty: 'Paru', hfisCode: '99006' },
];

/**
 * Templat mingguan = jadwal layar Jadwal mode presentasi (Senin–Sabtu, kuota bawaan 80% JKN / 20% non-JKN):
 * [kunci praktisi, kode layanan, hari ISO, mulai, selesai, kuota JKN, kuota non-JKN].
 */
export const SEED_SCHEDULE_TEMPLATES: ReadonlyArray<
  readonly [
    key: string,
    service: string,
    weekdays: readonly number[],
    start: string,
    end: string,
    jkn: number,
    nonJkn: number,
  ]
> = [
  ['andini', 'PD', [1, 2, 3, 4], '08:00', '12:00', 24, 6],
  ['andini', 'PD', [6], '08:00', '11:00', 16, 4],
  ['rahmat', 'PD', [1, 3, 4, 5], '13:00', '16:00', 20, 5],
  ['bagus', 'JT', [1, 2, 3, 4, 5], '09:00', '12:00', 16, 4],
  ['melati', 'JT', [2, 4], '13:00', '15:00', 12, 3],
  ['melati', 'JT', [6], '08:00', '10:00', 8, 2],
  ['yudha', 'SR', [1, 2, 3, 5], '09:30', '12:00', 16, 4],
  ['kartika', 'PR', [1, 2, 3, 4, 5], '08:00', '11:00', 16, 4],
  ['kartika', 'PR', [6], '08:00', '10:00', 8, 2],
];

/** Awal berlaku templat seed (tanggal kalender). */
export const SEED_SCHEDULE_VALID_FROM = '2026-01-01';

export const SEED_PAYERS: ReadonlyArray<{ code: string; name: string; kind: 'bpjs' | 'umum' | 'asuransi' }> =
  [
    { code: 'BPJS', name: 'BPJS Kesehatan (JKN)', kind: 'bpjs' },
    { code: 'UMUM', name: 'Umum (bayar sendiri)', kind: 'umum' },
    { code: 'ASR-FIKTIF', name: 'Asuransi Fiktif Sentosa', kind: 'asuransi' },
  ];

export const SEED_QUEUE_DISPLAYS: ReadonlyArray<{ code: string; name: string; services: readonly string[] }> =
  [{ code: 'RJ-LT2', name: 'Rawat Jalan Lantai 2', services: ['PD', 'JT', 'SR', 'PR'] }];

/** Nomor fiktif praktisi ke-n (1-based): IHS `9999xxxxxx`, SIP `9999/SIP/2026/nnn`. */
export function seedPractitionerNumbers(n: number) {
  const pad = (v: number, w: number) => String(v).padStart(w, '0');
  return { ihsId: `9999${pad(n, 6)}`, sipNumber: `9999/SIP/2026/${pad(n, 3)}` };
}

/** Jam dinding `HH:MM` sebagai nilai kolom `time` (sesi DB UTC, ADR-0014). */
const wallClock = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

export interface SeedFrontOfficeResult {
  services: number;
  practitioners: number;
  schedules: number;
  payers: number;
  displays: number;
}

/** Nilai `external_ids` dibuat bila belum ada untuk entitas × sistem itu (tidak menimpa koreksi admin). */
async function ensureExternalId(
  tx: TenantTx,
  tenantId: string,
  entity: string,
  entityId: string,
  system: string,
  value: string,
) {
  await tx.externalId.upsert({
    where: { tenantId_entity_entityId_system: { tenantId, entity, entityId, system } },
    update: {},
    create: { id: newId(), tenantId, entity, entityId, system, value },
  });
}

/**
 * Seed front office satu RS. Idempoten dengan kunci alami (kode layanan, kode penjamin, kode papan, IHS praktisi,
 * templat praktisi × layanan × hari × jam × awal berlaku); baris yang sudah ada tidak diubah. Satu transaksi per RS.
 * Butuh struktur RS (`seedHospitalStructure`) lebih dulu; staf seed opsional (praktisi tertaut bila akunnya ada).
 */
export async function seedFrontOffice(
  prisma: PrismaClient,
  tenantId: string,
): Promise<SeedFrontOfficeResult> {
  const result: SeedFrontOfficeResult = {
    services: 0,
    practitioners: 0,
    schedules: 0,
    payers: 0,
    displays: 0,
  };
  await withTenant(
    prisma,
    tenantId,
    async (tx) => {
      const units = new Map(
        (await tx.unit.findMany({ select: { id: true, code: true } })).map((u) => [u.code, u.id]),
      );

      const services = new Map<string, string>();
      for (const s of SEED_QUEUE_SERVICES) {
        const unitId = units.get(s.unitCode);
        if (!unitId) throw new Error(`Unit seed ${s.unitCode} belum ada (seed struktur RS lebih dulu)`);
        const existing = await tx.queueService.findUnique({
          where: { tenantId_code: { tenantId, code: s.code } },
          select: { id: true },
        });
        const id = existing?.id ?? newId();
        if (!existing) {
          await tx.queueService.create({
            data: {
              id,
              tenantId,
              code: s.code,
              name: s.name,
              kind: s.kind,
              unitId,
              room: s.room,
              floor: s.floor,
            },
          });
          result.services++;
        }
        services.set(s.code, id);
        if (s.bpjsPoli) await ensureExternalId(tx, tenantId, 'queue_service', id, 'bpjs:poli', s.bpjsPoli);
      }

      const staffNames = new Map(SEED_STAFF.map((m) => [m.nip, m.displayName]));
      const accounts = new Map(
        (
          await tx.user.findMany({
            where: { username: { in: SEED_PRACTITIONERS.flatMap((p) => (p.nip ? [p.nip] : [])) } },
            select: { id: true, username: true },
          })
        ).map((u) => [u.username, u.id]),
      );
      const practitioners = new Map<string, string>();
      for (const [i, p] of SEED_PRACTITIONERS.entries()) {
        const nums = seedPractitionerNumbers(i + 1);
        const name = p.nip ? staffNames.get(p.nip) : p.name;
        if (!name) throw new Error(`Praktisi seed ${p.key} tanpa nama`);
        const existing = await tx.practitioner.findUnique({
          where: { tenantId_ihsId: { tenantId, ihsId: nums.ihsId } },
          select: { id: true },
        });
        const id = existing?.id ?? newId();
        if (!existing) {
          await tx.practitioner.create({
            data: {
              id,
              tenantId,
              userId: p.nip ? (accounts.get(p.nip) ?? null) : null,
              name,
              profession: 'dokter',
              specialty: p.specialty,
              sipNumber: nums.sipNumber,
              sipValidUntil: new Date('2030-12-31T00:00:00.000Z'),
              ihsId: nums.ihsId,
            },
          });
          result.practitioners++;
        }
        practitioners.set(p.key, id);
        if (p.hfisCode)
          await ensureExternalId(tx, tenantId, 'practitioner', id, 'bpjs:hfis-dokter', p.hfisCode);
      }

      const validFrom = new Date(`${SEED_SCHEDULE_VALID_FROM}T00:00:00.000Z`);
      for (const [key, serviceCode, weekdays, start, end, quotaJkn, quotaNonJkn] of SEED_SCHEDULE_TEMPLATES) {
        const practitionerId = practitioners.get(key);
        const serviceId = services.get(serviceCode);
        if (!practitionerId || !serviceId)
          throw new Error(`Templat jadwal ${key}/${serviceCode} tidak lengkap`);
        for (const weekday of weekdays) {
          const startTime = wallClock(start);
          const exists = await tx.practitionerSchedule.findFirst({
            where: { practitionerId, serviceId, weekday, startTime, validFrom },
            select: { id: true },
          });
          if (exists) continue;
          await tx.practitionerSchedule.create({
            data: {
              id: newId(),
              tenantId,
              practitionerId,
              serviceId,
              weekday,
              startTime,
              endTime: wallClock(end),
              quotaJkn,
              quotaNonJkn,
              validFrom,
            },
          });
          result.schedules++;
        }
      }

      for (const p of SEED_PAYERS) {
        const existing = await tx.payer.findUnique({
          where: { tenantId_code: { tenantId, code: p.code } },
          select: { id: true },
        });
        if (existing) continue;
        await tx.payer.create({ data: { id: newId(), tenantId, ...p } });
        result.payers++;
      }

      for (const d of SEED_QUEUE_DISPLAYS) {
        const existing = await tx.queueDisplay.findUnique({
          where: { tenantId_code: { tenantId, code: d.code } },
          select: { id: true },
        });
        const displayId = existing?.id ?? newId();
        if (!existing) {
          await tx.queueDisplay.create({ data: { id: displayId, tenantId, code: d.code, name: d.name } });
          result.displays++;
        }
        for (const [i, code] of d.services.entries()) {
          const serviceId = services.get(code);
          if (!serviceId) throw new Error(`Papan ${d.code}: layanan ${code} tidak ada`);
          await tx.queueDisplayService.upsert({
            where: { displayId_serviceId: { displayId, serviceId } },
            update: {},
            create: { tenantId, displayId, serviceId, position: i + 1 },
          });
        }
      }
    },
    { timeoutMs: 60_000 },
  );
  return result;
}
