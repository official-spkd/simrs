import { describe, expect, it } from 'vitest';
import { CAPTURE_EVENTS } from './demo/fixtures/charge-capture';
import { TARIF_ITEMS, TARIF_PAKET, TARIF_PENJAMIN } from './demo/fixtures/tarif';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  byEncounter,
  captureActions,
  captureReconciliation,
  type EventCapture,
  lineConsistent,
  netCaptured,
  repriceNetLine,
  resolveHold,
  voidManualLine,
} from './keuangan-charge';
import { activeVersion, type KelasTarif, payerPrice } from './keuangan-tarif';

const ev = (id: string): EventCapture => {
  const e = CAPTURE_EVENTS.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e;
};

const KELAS: Record<string, KelasTarif> = { 'Kelas 1': 'k1', 'Kelas 2': 'k2', 'Kelas 3': 'k3', VIP: 'vip' };

describe('data dummy charge capture', () => {
  it('setiap baris: jumlah = kuantitas × harga satuan (termasuk pembalik dan reprice)', () => {
    for (const e of CAPTURE_EVENTS) {
      for (const l of [
        e.line,
        e.hold?.resolution,
        ...(e.hold?.reprice ?? []).flatMap((p) => [p.before, p.after]),
      ]) {
        if (l) expect(lineConsistent(l), e.id).toBe(true);
      }
    }
  });

  it('harga satuan = tarif berlaku pada kelas pasien (layar Tarif); reprice memakai tarif kontrak asuransi', () => {
    const asuransi = TARIF_PENJAMIN.find((p) => p.id === 'asuransi')?.bp ?? 0;
    for (const e of CAPTURE_EVENTS) {
      const lines = [e.line, ...(e.hold?.reprice ?? []).map((p) => p.before)];
      for (const l of lines) {
        const item = l && TARIF_ITEMS.find((i) => i.code === l.itemCode);
        if (!l || !item || l.qty < 0) continue;
        const kelas = Object.entries(KELAS).find(([k]) => l.name.includes(k))?.[1] ?? 'k2';
        expect(l.unitPrice, `${e.id} ${l.name}`).toBe(activeVersion(item, DEMO_TODAY)?.prices[kelas]);
      }
      for (const p of e.hold?.reprice ?? []) {
        expect(p.after.unitPrice, p.after.name).toBe(payerPrice(p.before.unitPrice, asuransi));
      }
    }
    const paket = TARIF_PAKET.find((p) => p.code === 'PKT-OK-051');
    expect(ev('cc-13').line?.unitPrice).toBe(paket?.prices.k1);
  });

  it('rekonsiliasi: setiap event menjadi baris bersumber atau pengecualian beralasan', () => {
    expect(captureReconciliation(CAPTURE_EVENTS)).toEqual({
      total: 17,
      billed: 10,
      held: 4,
      reversed: 3,
      unexplained: 0,
    });
    // Pembalik HbA1c menetralkan baris asalnya.
    expect((ev('cc-05').line?.amount ?? 0n) + (ev('cc-08').line?.amount ?? 1n)).toBe(0n);
  });

  it('kelengkapan per kunjungan: kunjungan dengan event tertahan menahan finalisasi', () => {
    const enc = byEncounter(CAPTURE_EVENTS);
    expect(enc.filter((k) => k.held > 0).map((k) => k.patient.name)).toEqual([
      'An. Raka Pratama',
      'Ny. Fransiska Lumbantobing',
      'Ny. Siti Aminah',
      'Tn. Sutan Batubara',
    ]);
    const endang = enc.find((k) => k.patient.name === 'Ny. Endang Wijaya');
    expect(endang?.net).toBe(180_000n + 35_000n + 240_000n + 25_000n - 64_000n);
    expect(netCaptured(CAPTURE_EVENTS)).toBe(enc.reduce((s, k) => s + k.net, 0n));
  });
});

describe('tindakan charge capture', () => {
  it('coba ulang hanya bila tarif sudah disetujui; kelas ditetapkan admisi', () => {
    expect(captureActions(ev('cc-12')).retry).toBeNull();
    expect(captureActions(ev('cc-14')).retry).toMatch(/Tarif belum disetujui/);
    expect(captureActions(ev('cc-11')).retry).toMatch(/admisi/);
    expect(captureActions(ev('cc-15')).retry).toBeNull();
    expect(captureActions(ev('cc-03')).retry).toBe('Event sudah tertagih.');
  });

  it('kasir hanya membatalkan baris manual; baris klinis dikoreksi di unit asal', () => {
    expect(captureActions(ev('cc-16')).voidManual).toBeNull();
    expect(captureActions(ev('cc-03')).voidManual).toMatch(/unit asal/);
    expect(captureActions(ev('cc-03')).correction).toBeNull();
    expect(captureActions(ev('cc-16')).correction).not.toBeNull();
  });

  it('coba ulang membentuk baris dari tarif baru; reprice menyisakan selisih bersih', () => {
    const [sutan] = resolveHold(ev('cc-12'));
    expect(sutan).toMatchObject({ status: 'tertagih', hold: undefined });
    expect(sutan?.line?.amount).toBe(400_000n);
    const [fr] = resolveHold(ev('cc-15'));
    expect(fr?.line?.amount).toBe(105_000n);
    expect(repriceNetLine(ev('cc-15').hold?.reprice ?? []).name).toMatch(/3 baris/);
  });

  it('batal baris manual: asal ditandai dibalik dan baris pembalik ditambahkan, jejak tetap', () => {
    const out = voidManualLine(
      ev('cc-16'),
      '2026-10-05T10:55:00+07:00',
      'Kasir uji',
      'Kursi roda milik keluarga',
    );
    expect(out.map((e) => e.status)).toEqual(['dibalik', 'dibalik']);
    expect(out[1]?.line?.amount).toBe(-25_000n);
    expect(out[1]?.reverses).toBe('cc-16');
    expect(voidManualLine(ev('cc-03'), '', '', '')).toEqual([ev('cc-03')]);
  });
});
