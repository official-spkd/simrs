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
 *
 * Hash di profil selalu berbentuk kunci hash AKTIF: hash tersimpan yang belum dienkripsi ulang (rotasi kunci
 * berjalan) dihitung ulang dari nilai terdekripsi, agar dua pasien tetap terbanding meski versi kuncinya berbeda.
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
      phoneEnc: true,
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
    const phoneHash =
      r.phoneHash && r.phoneEnc && !crypto.isCurrentHash(r.phoneHash)
        ? (readable(() => crypto.phoneHash(crypto.decryptContact(r.phoneEnc as string)), fail) ?? r.phoneHash)
        : r.phoneHash;
    const identifierHash = (
      i: { system: string; valueEnc: string; valueHash: string },
      value: string | null,
    ) => {
      if (crypto.isCurrentHash(i.valueHash)) return i.valueHash;
      const plain = value ?? readable(() => crypto.decryptIdentifier(i.valueEnc), fail);
      return plain === null ? i.valueHash : crypto.identifierHash(i.system as IdentifierSystem, plain);
    };
    const profile: MatchProfile = {
      id: r.id,
      mrn: r.mrn,
      nameSearch: r.nameSearch,
      sex: r.sex,
      birthDate: r.birthDate ? r.birthDate.toISOString().slice(0, 10) : null,
      birthDateEstimated: r.birthDateEstimated,
      motherName: r.motherName ? normalizePersonName(r.motherName) : null,
      phoneHash,
      address: address === null ? null : normalizeAddress(address),
      identifiers: Object.fromEntries(
        r.identifiers.map((i) => {
          const value =
            i.system === 'nik' ? readable(() => crypto.decryptIdentifier(i.valueEnc), fail) : null;
          return [i.system as IdentifierSystem, { hash: identifierHash(i, value), value: value ?? '' }];
        }),
      ),
    };
    if (failed) onUnreadable(r.id);
    return profile;
  });
}

/** Hash pasien ini untuk dicari di pasien lain: hash tersimpan + hash nilai yang sama untuk semua kunci di cincin. */
interface ProbeHashes {
  /** Pasangan sejajar sistem identifier × hash. */
  systems: string[];
  hashes: string[];
  phone: string[];
}

async function probeHashes(tx: TenantTx, crypto: PatientCrypto, patientId: string): Promise<ProbeHashes> {
  const row = await tx.patient.findUnique({
    where: { id: patientId },
    select: {
      phoneEnc: true,
      phoneHash: true,
      identifiers: { where: { active: true }, select: { system: true, valueEnc: true, valueHash: true } },
    },
  });
  const probe: ProbeHashes = { systems: [], hashes: [], phone: [] };
  if (!row) return probe;
  for (const i of row.identifiers) {
    const plain = readable(
      () => crypto.decryptIdentifier(i.valueEnc),
      () => {},
    );
    const all = plain === null ? [] : crypto.identifierHashes(i.system as IdentifierSystem, plain);
    for (const h of new Set([i.valueHash, ...all])) {
      probe.systems.push(i.system);
      probe.hashes.push(h);
    }
  }
  if (row.phoneHash) {
    const plain = row.phoneEnc
      ? readable(
          () => crypto.decryptContact(row.phoneEnc as string),
          () => {},
        )
      : null;
    probe.phone = [...new Set([row.phoneHash, ...(plain === null ? [] : crypto.phoneHashes(plain))])];
  }
  return probe;
}

/**
 * Pra-saring murah di SQL: pasien aktif lain yang berbagi identifier, no. HP, tanggal lahir (bukan perkiraan),
 * atau namanya sangat mirip. Skor lengkap dihitung di aplikasi (`scorePatientMatch`).
 *
 * Urutan sebelum `LIMIT` mengikuti kekuatan bukti: identifier sama, lalu jumlah kesamaan HP/tanggal lahir, baru
 * kemiripan nama. Dulu hanya kemiripan nama: di RS dengan ≥ 50 pasien bernama persis sama (nama umum), duplikat
 * sungguhan yang ejaannya sedikit beda tetapi HP dan tanggal lahirnya sama terpotong dan tidak pernah diskor.
 *
 * Identifier dan no. HP dicocokkan dengan hash nilai pasien ini untuk SEMUA kunci di cincin (`probeHashes`), bukan
 * kesamaan kolom antar-baris: selama rotasi kunci, baris lama dan baru bisa memakai versi kunci berbeda.
 */
async function preselect(tx: TenantTx, patientId: string, probe: ProbeHashes): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    WITH me AS (
      SELECT id, name_search, birth_date, birth_date_estimated FROM patients WHERE id = ${patientId}::uuid
    ),
    c AS (
      SELECT p.id,
        EXISTS (
          SELECT 1 FROM patient_identifiers b
          JOIN unnest(${probe.systems}::text[], ${probe.hashes}::text[]) AS m(system, hash)
            ON b.system = m.system AND b.value_hash = m.hash
          WHERE b.patient_id = p.id AND b.active) AS same_identifier,
        -- COALESCE: kolom kosong (NULL) harus jadi false, bukan NULL — ORDER BY ... DESC menaruh NULL di atas.
        COALESCE(p.phone_hash = ANY(${probe.phone}::text[]), false) AS same_phone,
        COALESCE(NOT me.birth_date_estimated AND NOT p.birth_date_estimated AND p.birth_date = me.birth_date, false)
          AS same_birth,
        COALESCE(similarity(p.name_search, me.name_search), 0) AS name_similarity
      FROM patients p, me
      WHERE p.id <> me.id AND p.status = 'active'
    )
    SELECT id::text AS id FROM c
    WHERE same_identifier OR same_phone OR same_birth OR name_similarity >= 0.6
    ORDER BY same_identifier DESC, (same_phone::int + same_birth::int) DESC, name_similarity DESC NULLS LAST, id
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
  const probe = await probeHashes(tx, crypto, patientId);
  const others = await loadMatchProfiles(tx, crypto, await preselect(tx, patientId, probe), note);
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
