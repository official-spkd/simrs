import { type FormSchema, formSchemaSchema, MORSE_FALL_SCALE } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  addField,
  addOption,
  addSection,
  bandSummary,
  canMove,
  canRemoveSection,
  fieldHint,
  firstIncomplete,
  historyRows,
  keyProblem,
  moveField,
  newField,
  parseShowWhen,
  removeField,
  removeOption,
  removeSection,
  renameField,
  showWhenChoices,
  showWhenLabel,
  updateField,
  updateOption,
  writeRoleOptions,
} from './forms';

const morse = formSchemaSchema.parse(MORSE_FALL_SCALE.schema);
/** Setiap hasil operasi harus tetap lolos validasi skema API. */
const valid = (s: FormSchema) => formSchemaSchema.parse(s);

describe('pembuat formulir (lib)', () => {
  it('field baru: kunci unik, pilihan diberi dua opsi, ditambahkan ke bagian yang dituju', () => {
    const a = newField('single', morse);
    expect(a).toMatchObject({ key: 'f_baru_1', label: 'Pilihan tunggal (field baru)', required: false });
    expect(a.options).toHaveLength(2);
    const s1 = valid(addField(morse, a, { section: 0 }));
    const b = newField('text', s1);
    expect(b.key).toBe('f_baru_2');
    expect(b.options).toBeUndefined();
    const s2 = valid(addField(s1, b, { section: 99 }));
    expect(s2.sections[0]?.fields.at(-1)?.key).toBe('f_baru_2');
    // Dari palet: disisipkan tepat di bawah field yang sedang dipilih.
    const s3 = valid(addField(s2, newField('number', s2), { after: 'q_riwayat_jatuh' }));
    expect(s3.sections[0]?.fields.map((f) => f.key).slice(0, 3)).toEqual([
      'q_riwayat_jatuh',
      'f_baru_3',
      'q_diag_sekunder',
    ]);
    expect(addField(s2, newField('text', s2), { after: 'tidak_ada' }).sections[0]?.fields.at(-1)?.key).toBe(
      'f_baru_3',
    );
    expect(morse.sections[0]?.fields).toHaveLength(7);
  });

  it('hapus/ganti kunci field ikut membereskan logika tampil yang merujuknya', () => {
    const withLogic = valid(
      updateField(addField(morse, newField('text', morse), { section: 0 }), 'f_baru_1', {
        showWhen: { field: 'q_riwayat_jatuh', equals: 'ya' },
      }),
    );
    expect(showWhenLabel(withLogic, withLogic.sections[0]?.fields.at(-1) as never)).toBe(
      'Tampil bila "Riwayat jatuh dalam 3 bulan" = Ya',
    );
    const renamed = valid(renameField(withLogic, 'q_riwayat_jatuh', 'q_jatuh'));
    expect(renamed.sections[0]?.fields.at(-1)?.showWhen).toEqual({ field: 'q_jatuh', equals: 'ya' });
    const removed = valid(removeField(renamed, 'q_jatuh'));
    expect(removed.sections[0]?.fields.at(-1)?.showWhen).toBeUndefined();
    // Opsi yang ditunggu logika tampil dihapus → logika dilepas; minimal dua opsi tetap dijaga.
    const alat = valid(
      updateField(withLogic, 'f_baru_1', { showWhen: { field: 'q_alat_bantu', equals: 'kruk' } }),
    );
    const noKruk = valid(removeOption(alat, 'q_alat_bantu', 'kruk'));
    expect(noKruk.sections[0]?.fields.at(-1)?.showWhen).toBeUndefined();
    expect(removeOption(noKruk, 'q_alat_bantu', 'furnitur')).toBe(noKruk);
  });

  it('updateField: nilai undefined menghapus properti opsional', () => {
    const s = updateField(morse, 'q_infus', { terminology: undefined, unit: undefined });
    const f = s.sections[0]?.fields.find((x) => x.key === 'q_infus');
    expect(f && 'terminology' in f).toBe(false);
  });

  it('geser field di dalam bagian dan menyeberang ke bagian sebelah', () => {
    const two = valid(addSection(morse));
    expect(canMove(two, 'q_riwayat_jatuh', -1)).toBe(false);
    expect(canMove(two, 'skor_total', 1)).toBe(true);
    const down = valid(moveField(two, 'skor_total', 1));
    expect(down.sections[1]?.fields.map((f) => f.key)).toEqual(['skor_total']);
    expect(canMove(down, 'skor_total', 1)).toBe(false);
    const up = valid(moveField(down, 'q_mental', 1));
    expect(up.sections[0]?.fields.at(-1)?.key).toBe('q_gaya_jalan');
    expect(up.sections[1]?.fields.map((f) => f.key)).toEqual(['q_mental', 'skor_total']);
    expect(canRemoveSection(up, 1)).toBe(false);
    expect(removeSection(up, 1)).toBe(up);
    expect(canRemoveSection(two, 1)).toBe(true);
    expect(removeSection(two, 1).sections).toHaveLength(1);
  });

  it('opsi: nilai unik, skor kosong = tidak berskor', () => {
    const s = valid(addOption(morse, 'q_infus'));
    const f = s.sections[0]?.fields.find((x) => x.key === 'q_infus');
    expect(f?.options?.at(-1)).toEqual({ value: 'opsi_1', label: 'Opsi 3' });
    const scored = valid(updateOption(s, 'q_infus', 'opsi_1', { label: 'Heparin lock', score: 20 }));
    const noScore = valid(updateOption(scored, 'q_infus', 'opsi_1', { score: undefined }));
    expect(noScore.sections[0]?.fields.find((x) => x.key === 'q_infus')?.options?.at(-1)).toEqual({
      value: 'opsi_1',
      label: 'Heparin lock',
    });
  });

  it('kunci field: format dan keunikan', () => {
    expect(keyProblem('q_baru', morse, 'f_baru_1')).toBeNull();
    expect(keyProblem('q_infus', morse, 'f_baru_1')).toMatch(/sudah dipakai/);
    expect(keyProblem('q_infus', morse, 'q_infus')).toBeNull();
    expect(keyProblem('Baru', morse, 'x')).toMatch(/huruf kecil/);
  });

  it('tampilan: ringkasan kategori skor, petunjuk angka, pilihan logika tampil', () => {
    expect(bandSummary(morse.scoring?.bands ?? [])).toBe('0–24 rendah · 25–44 sedang · ≥ 45 tinggi');
    expect(
      bandSummary([
        { min: 10, label: 'Tinggi' },
        { min: 0, label: 'Aman' },
      ]),
    ).toBe('0–9 aman · ≥ 10 tinggi');
    expect(fieldHint({ key: 'td', type: 'number', label: 'TD', required: false, summary: false })).toBe(
      'Angka · satuan',
    );
    expect(
      fieldHint({
        key: 'nyeri',
        type: 'number',
        label: 'Skala',
        required: false,
        summary: false,
        min: 0,
        max: 10,
      }),
    ).toBe('Angka 0–10 · satuan');
    const choices = showWhenChoices(morse, 'q_infus');
    expect(choices).toContainEqual({
      value: 'q_riwayat_jatuh=ya',
      label: 'Bila "Riwayat jatuh dalam 3 bulan" = Ya',
    });
    expect(choices.some((c) => c.value.startsWith('q_infus='))).toBe(false);
    expect(parseShowWhen('q_riwayat_jatuh=ya')).toEqual({ field: 'q_riwayat_jatuh', equals: 'ya' });
    expect(parseShowWhen('')).toBeUndefined();
  });

  it('field belum lengkap pertama dan riwayat versi', () => {
    expect(firstIncomplete(morse)).toBeNull();
    const blank = updateField(morse, 'q_mental', { label: '' });
    expect(firstIncomplete(blank)).toEqual({ kind: 'field', key: 'q_mental' });
    expect(firstIncomplete({ ...blank, sections: [{ ...morse.sections[0], title: '' } as never] })).toEqual({
      kind: 'section',
      index: 0,
    });
    expect(
      historyRows([
        {
          version: 1,
          status: 'archived',
          changeNote: 'Impor',
          createdAt: '2026-01-10T03:00:00Z',
          publishedAt: '2026-01-10T03:00:00Z',
        },
        {
          version: 2,
          status: 'draft',
          changeNote: 'Tambah bundle',
          createdAt: '2026-10-04T03:00:00Z',
          publishedAt: null,
        },
      ]).map((r) => [r.title, r.status]),
    ).toEqual([
      ['v2 · draf', 'Draf'],
      ['v1 · 10 Jan 2026', 'Arsip'],
    ]);
  });

  it('profesi pengisi: peran klinis berizin isi + peran yang sudah tercantum', () => {
    const codes = writeRoleOptions(['peran_khusus']).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['perawat', 'bidan', 'dokter', 'peran_khusus']));
    expect(codes).not.toContain('kasir');
    expect(writeRoleOptions().find((r) => r.code === 'perawat')?.label).toBe('Perawat');
  });
});
