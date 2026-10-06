import { describe, expect, it } from 'vitest';
import { type DemoActor, type DomainDef, project, type StoredEvent } from './demo/store/define';
import { DEMO_REFERRALS } from './demo/fixtures/rujukan';
import { DOWNTIME_PAPER_FORMS } from './demo/fixtures/operasional';
import { goLiveDomain } from './golive-toko';
import { backupDomain } from './operasional-backup-toko';
import { downtimeBannerOf, downtimeDomain } from './operasional-downtime-toko';
import { documentDomain, SIGN_ONLY_DOCTOR } from './platform-dokumen-toko';
import { screenHiddenByModules, settingsDomain } from './platform-pengaturan-toko';
import { jobsDomain } from './platform-penjadwal-toko';
import { structureDomain } from './platform-struktur-toko';
import { terminologyDomain } from './platform-terminologi-toko';
import { referralDomain } from './rujukan-toko';

const admin: DemoActor = { userId: 'u-a', name: 'Admin Uji', role: 'admin_tenant', baseRole: null };
const dokter: DemoActor = { userId: 'u-d', name: 'dr. Uji Fiktif', role: 'dokter', baseRole: null };
const rm: DemoActor = { userId: 'u-r', name: 'Petugas RM Uji', role: 'petugas_rm', baseRole: null };
const direksi: DemoActor = { userId: 'u-m', name: 'Direksi Uji', role: 'manajemen', baseRole: null };

let seq = 0;
const ev = (domain: string, data: unknown, actor = admin): StoredEvent => ({
  seq: ++seq,
  domain,
  at: '2026-10-05T03:50:00.000Z',
  actor,
  data,
});
const run = <S, E extends { type: string }>(def: DomainDef<S, E>, events: StoredEvent[]) =>
  project(def, { seq, resetSeq: 0, events });
const AT = '2026-10-05T10:50:00+07:00';

describe('domain toko platform: semua generic (aturan murni) dan pelaku dari sesi', () => {
  it('downtime: aktif beralasan → banner untuk layar lain; log atas nama sesi; selesai → banner hilang', () => {
    const steps = [
      ev('downtime', { type: 'activate', cause: 'bpjs', reason: 'VClaim timeout sejak 10.40' }),
      ev('downtime', { type: 'print' }),
    ];
    const p = run(downtimeDomain, steps);
    expect(downtimeDomain.generic).toBe(true);
    expect(downtimeBannerOf(p.state)).toMatchObject({ phase: 'aktif', by: 'Admin Uji', cause: 'bpjs' });
    expect(p.state.log[0]?.text).toContain('Paket cetak darurat');
    expect(p.state.log[0]?.by).toBe('Admin Uji');
    // Alasan terlalu pendek ditolak gerbang.
    expect(
      downtimeDomain.validate?.(
        downtimeDomain.initial(),
        { type: 'activate', cause: 'bpjs', reason: 'x' },
        admin,
      ),
    ).toMatch(/minimal/);
    const done = run(downtimeDomain, [
      ...steps,
      ev('downtime', { type: 'recover' }),
      ...DOWNTIME_PAPER_FORMS.map((f) =>
        ev('downtime', { type: 'back-entry', id: f.id, reason: 'Dicatat di formulir kertas darurat' }),
      ),
      ...Array.from({ length: 6 }, () => ev('downtime', { type: 'sync' })),
    ]);
    expect(done.state.s.stage).toBe(4);
    expect(downtimeBannerOf(done.state)).toBeNull();
  });

  it('pengaturan: modul inti/dependensi ditegakkan; modul mati → layar tersembunyi; template versi naik', () => {
    const s0 = settingsDomain.initial();
    expect(
      settingsDomain.validate?.(
        s0,
        { type: 'modul.disimpan', changes: [{ code: 'P01', on: false }], reason: 'uji coba', jam: '10.50' },
        admin,
      ),
    ).toMatch(/inti|butuh/);
    const p = run(settingsDomain, [
      ev('pengaturan', {
        type: 'modul.disimpan',
        changes: [{ code: 'S07', on: false }],
        reason: 'Gizi belum siap',
        jam: '10.50',
      }),
      ev('pengaturan', { type: 'pengaturan.disimpan', values: { 'session.idle_minutes': 20 }, jam: '10.51' }),
      ev('pengaturan', { type: 'pengaturan.disimpan', values: { 'session.idle_minutes': 90 }, jam: '10.52' }),
    ]);
    expect(p.state.modules.S07).toBe(false);
    expect(p.state.moduleLog[0]?.text).toContain('(Admin Uji)');
    expect(p.state.settings['session.idle_minutes']).toBe(20);
    expect(screenHiddenByModules({ components: ['S07'] }, p.state.modules)).toBe(true);
    expect(screenHiddenByModules({ components: ['S07', 'S01'] }, p.state.modules)).toBe(false);
    expect(screenHiddenByModules({ components: [] }, p.state.modules)).toBe(false);

    const gelang = s0.templates.find((t) => t.id === 'gelang');
    if (!gelang) throw new Error('fixture gelang');
    const publish = {
      type: 'template.diterbitkan',
      ...gelang,
      note: 'Catatan kaki baru',
      at: AT,
      jam: '10.53',
    };
    const bad = { ...publish, showAllergy: false };
    const { name: _n, size: _s, version: _v, publishedAt: _p, publishedBy: _b, ...ok } = publish;
    const { name: _n2, size: _s2, version: _v2, publishedAt: _p2, publishedBy: _b2, ...badOk } = bad;
    expect(settingsDomain.validate?.(s0, badOk as never, admin)).toMatch(/alergi/);
    const t = run(settingsDomain, [ev('pengaturan', ok)]);
    const after = t.state.templates.find((x) => x.id === 'gelang');
    expect(after?.version).toBe(gelang.version + 1);
    expect(after?.publishedBy).toBe('Admin Uji');
  });

  it('struktur: tambah kamar bergerbang kelas; bed terisi tidak bisa dinonaktifkan', () => {
    const melati = 'u-melati/mlt-lt3';
    const s0 = structureDomain.initial();
    expect(
      structureDomain.validate?.(
        s0,
        { type: 'simpul.ditambah', parentId: melati, code: 'M-214', name: 'Kamar M-214', jam: '10.50' },
        admin,
      ),
    ).toMatch(/kelas rawat/);
    expect(
      structureDomain.validate?.(
        s0,
        { type: 'simpul.dinonaktifkan', id: 'u-melati', reason: 'renovasi total', jam: '10.50' },
        admin,
      ),
    ).toMatch(/terisi/);
    const p = run(structureDomain, [
      ev('struktur', {
        type: 'simpul.ditambah',
        parentId: melati,
        code: 'M-214',
        name: 'Kamar M-214',
        careClass: 'kelas_2',
        jam: '10.50',
      }),
      ev('struktur', {
        type: 'simpul.dinonaktifkan',
        id: `${melati}/m-212`,
        reason: 'Renovasi kamar mandi',
        jam: '10.51',
      }),
    ]);
    expect(p.state.nodes.some((n) => n.id === `${melati}/m-214`)).toBe(true);
    expect(p.state.nodes.find((n) => n.id === `${melati}/m-212/a`)?.active).toBe(false);
    expect(p.state.log[0]?.text).toContain('Renovasi kamar mandi (Admin Uji)');
  });

  it('terminologi: berkas bergalat tidak pernah diterapkan (gagal tertutup); berkas bersih tercatat versi', () => {
    const s0 = terminologyDomain.initial();
    expect(
      terminologyDomain.validate?.(
        s0,
        { type: 'impor.diterapkan', fileId: 'loinc-galat', replace: false, at: AT },
        admin,
      ),
    ).toMatch(/Uji kering gagal/);
    const p = run(terminologyDomain, [
      ev('terminologi', { type: 'impor.diterapkan', fileId: 'loinc-bersih', replace: false, at: AT }),
    ]);
    expect(p.applied).toBe(1);
    expect(p.state.versions[0]?.appliedBy).toBe('Admin Uji');
    expect(p.state.concepts.some((c) => c.code === '10839-9')).toBe(true);
  });

  it('dokumen: TTE hanya posisi Dokter, atas nama pengguna sesi; batal wajib alasan', () => {
    const s0 = documentDomain.initial();
    const pendingDoc = s0.docs.find((d) => d.status === 'pending');
    if (!pendingDoc) throw new Error('fixture dokumen menunggu TTE');
    const sign = { type: 'tte.ditandatangani' as const, id: pendingDoc.id, at: AT, jam: '10.50' };
    expect(documentDomain.validate?.(s0, sign, rm)).toBe(SIGN_ONLY_DOCTOR);
    const p = run(documentDomain, [ev('dokumen', sign, dokter)]);
    const signed = p.state.docs.find((d) => d.id === pendingDoc.id);
    expect(signed).toMatchObject({ status: 'signed', signer: 'dr. Uji Fiktif' });
    expect(
      documentDomain.validate?.(
        p.state,
        { type: 'dokumen.dibatalkan', id: pendingDoc.id, reason: 'salah unggah pasien lain', jam: '10.51' },
        rm,
      ),
    ).toMatch(/terkunci/);
  });

  it('penjadwal, rujukan, cadangan: aksi tersimpan dengan pelaku; gerbang alasan dan urutan', () => {
    expect(
      jobsDomain.validate?.(
        jobsDomain.initial(),
        { type: 'job.dijalankan', id: 'laporan-rl', reason: '', at: AT, jam: '10.50' },
        admin,
      ),
    ).toMatch(/alasan wajib/);
    const j = run(jobsDomain, [
      ev('penjadwal', { type: 'job.dijalankan', id: 'aplicare-bed', reason: '', at: AT, jam: '10.50' }),
    ]);
    expect(j.state.jobs.find((x) => x.id === 'aplicare-bed')?.runs[0]?.message).toContain(
      'dijalankan Admin Uji',
    );

    const ref = DEMO_REFERRALS.find((r) => r.id === 'skt-0045');
    expect(ref?.sync.status).toBe('pending');
    const r = run(referralDomain, [
      ev('rujukan', { type: 'antrean.diproses', id: 'skt-0045', at: AT, jam: '10.50' }),
    ]);
    expect(r.state.referrals.find((x) => x.id === 'skt-0045')?.number).toBe('0301R0011025K000045');

    const b = run(backupDomain, [
      ev('cadangan', { type: 'restore.langkah', wrongKey: true, at: AT, jam: '10.50' }),
      ev('cadangan', { type: 'restore.langkah', wrongKey: false, at: AT, jam: '10.51' }),
    ]);
    // Pilihan kunci tidak bisa diubah di tengah uji: langkah kedua ditolak.
    expect(b.state.restoreLog).toHaveLength(1);
  });

  it('go-live: GO hanya posisi Manajemen dan setelah item kritis selesai + berpemilik', () => {
    const s0 = goLiveDomain.initial();
    const go = {
      type: 'keputusan.diambil' as const,
      kind: 'go' as const,
      note: 'Pilot mulai Senin 12 Okt',
      jam: '10.50',
    };
    expect(goLiveDomain.validate?.(s0, go, admin)).toMatch(/Manajemen/);
    expect(goLiveDomain.validate?.(s0, go, direksi)).toMatch(/Terkunci/);
    const nogo = run(goLiveDomain, [ev('golive', { ...go, kind: 'nogo' }, direksi)]);
    expect(nogo.state.decision).toMatchObject({ kind: 'nogo', by: 'Direksi Uji' });
    expect(
      goLiveDomain.validate?.(
        nogo.state,
        { type: 'item.diubah', id: 't1', done: true, owner: 'Kepala IT', jam: '10.51' },
        admin,
      ),
    ).toMatch(/buka kembali/);
  });
});
