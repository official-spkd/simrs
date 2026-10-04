import {
  type IdentifierSystem,
  MATCH_THRESHOLD,
  type MatchProfile,
  newId,
  normalizeAddress,
  normalizePersonName,
  scorePatientMatch,
} from '@simrs/shared';
import type { PatientCrypto } from '@simrs/shared/node';
import { lockTenantScope } from './authz';
import type { TenantTx } from './client';

/**
 * Kunci MPI per tenant: semua penulisan antrean rekam medis ganda (deteksi, gabung, batal, keputusan) berjalan
 * berurutan dalam satu RS. Tanpa kunci ini, dua penggabungan pasangan yang saling mirip mengunci baris kandidat
 * dalam urutan berbeda dan berakhir deadlock (dibuktikan tes API). Ambil SEBELUM mengunci/mengubah baris
 * pasien; aman dipanggil berulang dalam satu transaksi.
 */
export async function lockMpi(tx: TenantTx): Promise<void> {
  await lockTenantScope(tx, 'mpi');
}

/** Batas calon pasangan yang diskor per pasien (pra-saring SQL). */
const MAX_CANDIDATES = 50;

/** Dekripsi yang gagal (data rusak atau kunci berbeda) dianggap kosong agar pendaftaran tidak ikut gagal. */
function readable(decrypt: () => string, onFail: () => void): string | null {
  try {
    return decrypt();
  } catch {
    onFail();
    return null;
  }
}

/**
 * Profil pencocokan pasien aktif. Hanya NIK yang didekripsi (untuk mendeteksi salah ketik); identifier lain
 * cukup dibandingkan lewat hash. Alamat didekripsi lalu dinormalisasi; tidak pernah disimpan. Nilai yang tidak
 * bisa didekripsi dilaporkan lewat `onUnreadable` (ID pasien) dan diperlakukan kosong.
 */
export async function loadMatchProfiles(
  tx: TenantTx,
  crypto: PatientCrypto,
  ids: string[],
  onUnreadable: (patientId: string) => void = () => {},
): Promise<MatchProfile[]> {
  if (ids.length === 0) return [];
  const rows = await tx.patient.findMany({
    where: { id: { in: ids }, status: 'active' },
    select: {
      id: true,
      mrn: true,
      nameSearch: true,
      sex: true,
      birthDate: true,
      birthDateEstimated: true,
      motherName: true,
      phoneHash: true,
      addressEnc: true,
      identifiers: { where: { active: true }, select: { system: true, valueEnc: true, valueHash: true } },
    },
  });
  return rows.map((r) => {
    let failed = false;
    const fail = () => {
      failed = true;
    };
    const address = r.addressEnc ? readable(() => crypto.decryptContact(r.addressEnc as string), fail) : null;
    const profile: MatchProfile = {
      id: r.id,
      mrn: r.mrn,
      nameSearch: r.nameSearch,
      sex: r.sex,
      birthDate: r.birthDate ? r.birthDate.toISOString().slice(0, 10) : null,
      birthDateEstimated: r.birthDateEstimated,
      motherName: r.motherName ? normalizePersonName(r.motherName) : null,
      phoneHash: r.phoneHash,
      address: address === null ? null : normalizeAddress(address),
      identifiers: Object.fromEntries(
        r.identifiers.map((i) => [
          i.system as IdentifierSystem,
          {
            hash: i.valueHash,
            value:
              i.system === 'nik' ? (readable(() => crypto.decryptIdentifier(i.valueEnc), fail) ?? '') : '',
          },
        ]),
      ),
    };
    if (failed) onUnreadable(r.id);
    return profile;
  });
}

/**
 * Pra-saring murah di SQL: pasien aktif lain yang berbagi identifier, no. HP, tanggal lahir (bukan perkiraan),
 * atau namanya sangat mirip. Skor lengkap dihitung di aplikasi (`scorePatientMatch`).
 */
async function preselect(tx: TenantTx, patientId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    WITH me AS (
      SELECT id, name_search, birth_date, birth_date_estimated, phone_hash FROM patients WHERE id = ${patientId}::uuid
    )
    SELECT p.id::text AS id
    FROM patients p, me
    WHERE p.id <> me.id AND p.status = 'active'
      AND (
        EXISTS (
          SELECT 1 FROM patient_identifiers a
          JOIN patient_identifiers b ON b.system = a.system AND b.value_hash = a.value_hash
          WHERE a.patient_id = me.id AND a.active AND b.patient_id = p.id AND b.active)
        OR (me.phone_hash IS NOT NULL AND p.phone_hash = me.phone_hash)
        OR (me.birth_date IS NOT NULL AND NOT me.birth_date_estimated AND NOT p.birth_date_estimated
            AND p.birth_date = me.birth_date)
        OR similarity(p.name_search, me.name_search) >= 0.6
      )
    ORDER BY similarity(p.name_search, me.name_search) DESC
    LIMIT ${MAX_CANDIDATES}`;
  return rows.map((r) => r.id);
}

/**
 * Simpan/perbarui pasangan (A = nomor RM lebih kecil = rekam medis lebih lama). Pasangan yang sudah
 * diputuskan petugas (gabung / bukan orang yang sama) tidak diusulkan ulang.
 */
async function upsertCandidate(
  tx: TenantTx,
  tenantId: string,
  a: MatchProfile,
  b: MatchProfile,
  score: number,
  reasons: string[],
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO patient_match_candidates
      (id, tenant_id, patient_a_id, patient_b_id, score, reasons, status, detected_at, updated_at)
    VALUES (${newId()}::uuid, ${tenantId}::uuid, ${a.id}::uuid, ${b.id}::uuid, ${score},
            ${JSON.stringify(reasons)}::jsonb, 'open', now(), now())
    ON CONFLICT (tenant_id, (LEAST(patient_a_id, patient_b_id)), (GREATEST(patient_a_id, patient_b_id)))
    DO UPDATE SET score = EXCLUDED.score, reasons = EXCLUDED.reasons, status = 'open', updated_at = now()
    WHERE patient_match_candidates.status IN ('open', 'superseded')`;
}

export interface DetectResult {
  /** Pasangan ber-skor ≥ ambang (baru atau diperbarui). */
  proposed: number;
  /** Kandidat terbuka yang ditutup karena tidak lagi cocok. */
  superseded: number;
  /** ID pasien yang sebagian datanya tidak bisa didekripsi (indikasi kunci salah atau data rusak). */
  unreadable: string[];
}

/**
 * P05 · Hitung ulang kandidat rekam medis ganda untuk satu pasien aktif (dipanggil setelah daftar, ubah
 * identitas, gabung, dan batal gabung). Kandidat terbuka yang sudah tidak cocok ditutup (`superseded`).
 */
export async function detectDuplicates(
  tx: TenantTx,
  crypto: PatientCrypto,
  patientId: string,
): Promise<DetectResult> {
  await lockMpi(tx);
  const unreadable: string[] = [];
  const note = (id: string) => unreadable.push(id);
  const [me] = await loadMatchProfiles(tx, crypto, [patientId], note);
  if (!me) return { proposed: 0, superseded: 0, unreadable };
  const others = await loadMatchProfiles(tx, crypto, await preselect(tx, patientId), note);
  const unmatched: string[] = [];
  let proposed = 0;
  for (const other of others) {
    const { score, reasons } = scorePatientMatch(me, other);
    if (score < MATCH_THRESHOLD) {
      unmatched.push(other.id);
      continue;
    }
    const [a, b] = me.mrn < other.mrn ? [me, other] : [other, me];
    await upsertCandidate(tx, crypto.tenantId, a, b, score, reasons);
    proposed += 1;
  }
  const stale =
    unmatched.length === 0
      ? { count: 0 }
      : await tx.patientMatchCandidate.updateMany({
          where: {
            status: 'open',
            OR: [
              { patientAId: patientId, patientBId: { in: unmatched } },
              { patientBId: patientId, patientAId: { in: unmatched } },
            ],
          },
          data: { status: 'superseded' },
        });
  return { proposed, superseded: stale.count, unreadable };
}
