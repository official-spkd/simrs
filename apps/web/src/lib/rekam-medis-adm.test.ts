import { describe, expect, it } from 'vitest';
import { RECORD_FILES, RECORD_LOANS, RETENTION_BATCHES, ROI_REQUESTS } from './demo/fixtures/rekam-medis-adm';
import { DEMO_NOW, DEMO_TODAY } from './demo/fixtures/waktu';
import {
  approvalBlock,
  deadlineText,
  deadlineTone,
  destructionActorBlock,
  destructionStepBlock,
  hoursLeft,
  inactiveYears,
  lendBlock,
  loanDueDate,
  loanStatus,
  overdueDays,
  retentionCandidates,
  roiDeadline,
  verificationBlock,
} from './rekam-medis-adm';

describe('B09 · peminjaman berkas', () => {
  it('jatuh tempo 3 hari kalender, terlambat sesudahnya, kembali menutup status', () => {
    expect(loanDueDate('2026-09-29')).toBe('2026-10-02');
    expect(loanDueDate('2026-10-30')).toBe('2026-11-02');
    const loan = { dueDate: '2026-10-02', returnedAt: null };
    expect(loanStatus(loan, '2026-10-02')).toBe('dipinjam');
    expect(loanStatus(loan, '2026-10-05')).toBe('terlambat');
    expect(overdueDays(loan, '2026-10-05')).toBe(3);
    expect(loanStatus({ ...loan, returnedAt: '2026-10-05T09:00:00+07:00' }, '2026-10-05')).toBe('kembali');
    expect(overdueDays({ ...loan, returnedAt: '2026-10-05T09:00:00+07:00' }, '2026-10-05')).toBe(0);
  });

  it('legal hold dan berkas yang sedang keluar tidak bisa dipinjamkan', () => {
    const hold = RECORD_FILES.find((f) => f.legalHold);
    const out = RECORD_FILES.find((f) => RECORD_LOANS.some((l) => l.fileId === f.id && !l.returnedAt));
    const free = RECORD_FILES.find(
      (f) => !f.legalHold && !RECORD_LOANS.some((l) => l.fileId === f.id && !l.returnedAt),
    );
    expect(hold && lendBlock(hold, RECORD_LOANS)).toMatch(/Legal hold/);
    expect(out && lendBlock(out, RECORD_LOANS)).toMatch(/sedang dipinjam/);
    expect(free && lendBlock(free, RECORD_LOANS)).toBeNull();
  });

  it('fixture hari demo: dua pinjaman terlambat, satu sudah kembali', () => {
    const st = RECORD_LOANS.map((l) => loanStatus(l, DEMO_TODAY));
    expect(st.filter((s) => s === 'terlambat')).toHaveLength(2);
    expect(st.filter((s) => s === 'kembali')).toHaveLength(1);
  });
});

describe('B09 · pelepasan informasi dan hak subjek data', () => {
  it('tenggat 3×24 jam dari diterima; nada aman/mendekati/lewat', () => {
    const d = roiDeadline('2026-10-03T14:00:00+07:00');
    expect(d).toBe('2026-10-06T07:00:00.000Z');
    expect(hoursLeft(d, DEMO_NOW)).toBe(27);
    expect(deadlineTone(27)).toBe('aman');
    expect(deadlineTone(24)).toBe('mendekati');
    expect(deadlineTone(-1)).toBe('lewat');
    expect(deadlineText(-5)).toBe('lewat 5 jam');
    expect(deadlineText(0)).toBe('kurang dari 1 jam');
  });

  it('fixture: ada permintaan yang lewat tenggat dan yang mendekati', () => {
    const tones = ROI_REQUESTS.map((r) => deadlineTone(hoursLeft(roiDeadline(r.receivedAt), DEMO_NOW)));
    expect(tones).toContain('lewat');
    expect(tones).toContain('aman');
  });

  it('verifikasi butuh ketiga centang; penyetuju wajib orang lain dari penerima', () => {
    expect(verificationBlock([true, true, false])).toMatch(/2\/3/);
    expect(verificationBlock([true, true, true])).toBeNull();
    expect(approvalBlock('A', null)).toMatch(/Pilih/);
    expect(approvalBlock('A', 'A')).toMatch(/berbeda/);
    expect(approvalBlock('A', 'B')).toBeNull();
  });
});

describe('B09 · retensi dan pemusnahan', () => {
  it('umur inaktif dihitung per ulang tahun tanggal', () => {
    expect(inactiveYears('2021-12-30', DEMO_TODAY)).toBe(4);
    expect(inactiveYears('2021-10-05', DEMO_TODAY)).toBe(5);
    expect(inactiveYears('2021-10-06', DEMO_TODAY)).toBe(4);
  });

  it('kandidat = inaktif ≥ 5 tahun; legal hold dikeluarkan dari hitungan', () => {
    const c = retentionCandidates(RETENTION_BATCHES, DEMO_TODAY);
    expect(c.map((b) => b.id)).toEqual(['ret-r12', 'ret-r13']);
    expect(c.reduce((n, b) => n + b.eligibleFiles, 0)).toBe(1238 + 979);
  });

  it('tahap pemusnahan maju satu-satu; penyetuju ≠ pengusul', () => {
    expect(destructionStepBlock(0, 1)).toBeNull();
    expect(destructionStepBlock(0, 2)).toMatch(/dilompati/);
    expect(destructionStepBlock(4, 5)).toMatch(/selesai/);
    expect(destructionActorBlock(2, 'X', 'X')).toMatch(/berbeda/);
    expect(destructionActorBlock(2, 'Y', 'X')).toBeNull();
  });
});
