// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppShell,
  Button,
  Field,
  FilterChip,
  SafetyGate,
  Segmented,
  Sidebar,
  TabList,
  type TabListItem,
  TabPanel,
  Tabs,
  type TabsVariant,
  tabIds,
  tabKeyTarget,
} from './index';

/**
 * Primitif tab bersama (pola tab ARIA, keyboard, panel tetap terpasang) dan target sentuh ≥ 44 px semua kontrol
 * interaktif `packages/ui` (CLAUDE.md §6, token `touchMin`). jsdom tanpa tata letak: ukuran diperiksa dari kelas
 * tinggi; ukuran nyata di peramban diuji E2E `/dev/ui`.
 */

afterEach(cleanup);

const ITEMS: TabListItem[] = [
  { id: 'cppt', label: 'CPPT' },
  { id: 'emar', label: 'eMAR', badge: '2 terlambat', badgeTone: 'danger' },
  { id: 'hasil', label: 'Hasil' },
];

function ListHarness({ variant, start = 'cppt' }: { variant?: TabsVariant; start?: string }) {
  const [v, setV] = useState(start);
  return (
    <>
      <TabList label="Rekam" idBase="uji" variant={variant} items={ITEMS} value={v} onChange={setV} />
      <TabPanel idBase="uji" value={v}>
        isi {v}
      </TabPanel>
    </>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

describe('TabList + TabPanel · pola tab ARIA', () => {
  it('tab aktif menunjuk panelnya; panel berlabel tabnya; hanya tab aktif dalam urutan Tab', () => {
    render(<ListHarness />);
    const list = screen.getByRole('tablist', { name: 'Rekam' });
    expect(list.getAttribute('aria-orientation')).toBe('horizontal');
    const cppt = tab('CPPT');
    const panel = screen.getByRole('tabpanel');
    expect(cppt.getAttribute('aria-selected')).toBe('true');
    expect(cppt.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(cppt.id);
    expect(cppt.tabIndex).toBe(0);
    expect(tab('eMAR').tabIndex).toBe(-1);
    // Panel tab lain belum ada di DOM: tab tidak aktif tidak menunjuk id yang tidak ada.
    expect(tab('eMAR').getAttribute('aria-controls')).toBeNull();
    expect(tab('eMAR').textContent).toBe('eMAR2 terlambat');
  });

  it('panah berputar di ujung, Home/End ke ujung; pilihan mengikuti fokus', () => {
    render(<ListHarness />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(tab('Hasil').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Hasil'));
    expect(screen.getByRole('tabpanel').textContent).toBe('isi hasil');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(tab('CPPT').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'End' });
    expect(tab('Hasil').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(tab('CPPT'));
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(tab('CPPT').getAttribute('aria-selected')).toBe('true');
  });

  it('klik tab yang sudah aktif tidak memanggil onChange; nonaktif mengabaikan keyboard', () => {
    const calls: string[] = [];
    const { rerender } = render(
      <TabList label="Rentang" items={ITEMS} value="cppt" onChange={(id) => calls.push(id)} />,
    );
    fireEvent.click(tab('CPPT'));
    fireEvent.click(tab('Hasil'));
    expect(calls).toEqual(['hasil']);
    rerender(
      <TabList label="Rentang" items={ITEMS} value="cppt" onChange={(id) => calls.push(id)} disabled />,
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(calls).toEqual(['hasil']);
    expect((tab('eMAR') as HTMLButtonElement).disabled).toBe(true);
  });

  it('model murni: id berpasangan dan tombol navigasi', () => {
    expect(tabIds(':r1:', 'cppt')).toEqual({ tab: ':r1:-tab-cppt', panel: ':r1:-panel-cppt' });
    expect(tabKeyTarget('ArrowRight', 4, 5)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 5)).toBe(4);
    expect(tabKeyTarget('Home', 3, 5)).toBe(0);
    expect(tabKeyTarget('End', 0, 5)).toBe(4);
    expect(tabKeyTarget('Tab', 0, 5)).toBeNull();
    expect(tabKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('Tabs · panel tetap terpasang (keepMounted)', () => {
  function Draft({ name }: { name: string }) {
    const [v, setV] = useState('');
    return <input aria-label={`Draf ${name}`} value={v} onChange={(e) => setV(e.target.value)} />;
  }

  function Harness({ keepMounted }: { keepMounted: boolean }) {
    const [v, setV] = useState('a');
    return (
      <Tabs
        label="Bagian"
        variant="pil"
        keepMounted={keepMounted}
        value={v}
        onChange={setV}
        items={[
          { id: 'a', label: 'Transaksi', content: <Draft name="A" /> },
          { id: 'b', label: 'Rekonsiliasi', content: <Draft name="B" /> },
        ]}
      />
    );
  }

  it('isian yang belum disimpan tidak hilang saat berpindah tab; panel tak aktif tersembunyi', () => {
    render(<Harness keepMounted />);
    fireEvent.change(screen.getByLabelText('Draf A'), { target: { value: 'catatan belum disimpan' } });
    fireEvent.click(tab('Rekonsiliasi'));
    const panels = document.querySelectorAll('[role="tabpanel"]');
    expect(panels).toHaveLength(2);
    expect((panels[0] as HTMLElement).hidden).toBe(true);
    expect((panels[1] as HTMLElement).hidden).toBe(false);
    // Semua panel terpasang: setiap tab menunjuk panelnya.
    for (const t of screen.getAllByRole('tab')) {
      expect(document.getElementById(t.getAttribute('aria-controls') ?? '')).not.toBeNull();
    }
    fireEvent.click(tab('Transaksi'));
    expect((screen.getByLabelText('Draf A') as HTMLInputElement).value).toBe('catatan belum disimpan');
  });

  it('bawaan: hanya panel aktif yang dirender (isian tab lain dilepas)', () => {
    render(<Harness keepMounted={false} />);
    fireEvent.change(screen.getByLabelText('Draf A'), { target: { value: 'x' } });
    fireEvent.click(tab('Rekonsiliasi'));
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    fireEvent.click(tab('Transaksi'));
    expect((screen.getByLabelText('Draf A') as HTMLInputElement).value).toBe('');
  });

  it('daftar tab membungkus di layar sempit (tanpa scroll horizontal)', () => {
    render(<Harness keepMounted />);
    expect(screen.getByRole('tablist').className).toContain('flex-wrap');
  });
});

/** Kelas tinggi yang menjamin ≥ 44 px (spasi 11 = 44 px, token `touch` = 44 px). */
const TALL = /(^|\s)(min-)?h-(11|12|14|16|touch|kiosk-touch)(\s|$)/;

/** Elemen memenuhi target sentuh: tinggi ≥ 44 px, atau area sentuh diperluas, atau 44 px di layar sentuh. */
function touchOk(el: Element): boolean {
  const c = el.className;
  if (TALL.test(c)) return true;
  // Segmen ringkas: tampak 36 px + ::before 4 px atas/bawah menutup padding wadah (p-1) → 44 px.
  if (
    /\bh-9\b/.test(c) &&
    c.includes('before:-inset-y-1') &&
    /\bp-1\b/.test(el.parentElement?.className ?? '')
  ) {
    return true;
  }
  // Tautan sidebar: padat di desktop (mockup), 44 px di layar sentuh dan menu sempit.
  if (c.includes('pointer-coarse:min-h-touch') && c.includes('max-md:min-h-touch')) return true;
  // Area teks berbaris ganda selalu lebih tinggi dari 44 px.
  return el.tagName === 'TEXTAREA' && Number(el.getAttribute('rows') ?? 2) >= 2;
}

function interactive(): Element[] {
  return [...document.querySelectorAll('button, a[href], input, textarea, select, summary')];
}

describe('target sentuh ≥ 44 px', () => {
  const cases: Array<[string, ReactElement]> = [
    [
      'Button md/sm/kiosk',
      <>
        <Button>Simpan</Button>
        <Button size="sm">Koreksi</Button>
        <Button size="kiosk">Ambil antrean</Button>
      </>,
    ],
    ['Field', <Field key="f" label="NIK" />],
    [
      'FilterChip',
      <FilterChip key="c" selected>
        Menunggu
      </FilterChip>,
    ],
    [
      'Segmented',
      <Segmented
        key="s"
        label="Rentang"
        value="a"
        onChange={() => undefined}
        items={[
          { id: 'a', label: 'Hari ini' },
          { id: 'b', label: 'YTD' },
        ]}
      />,
    ],
    ['TabList pil', <TabList key="p" label="P" items={ITEMS} value="cppt" onChange={() => undefined} />],
    [
      'Tabs garis',
      <Tabs
        key="g"
        label="G"
        value="cppt"
        onChange={() => undefined}
        items={ITEMS.map((t) => ({ ...t, content: t.label }))}
      />,
    ],
    [
      'Sidebar + AppShell',
      <AppShell key="a" tenantName="RS Fiktif" sidebar={null}>
        <Sidebar
          tenantName="RS Fiktif"
          unitName="SIM RS"
          user={{ name: 'Admin', role: 'Admin', initials: 'AD' }}
          activeId="beranda"
          integrations={[{ label: 'BPJS', state: 'normal', text: 'Normal' }]}
          groups={[
            {
              title: 'UMUM',
              items: [{ id: 'beranda', label: 'Beranda', href: '/', icon: 'home', available: true }],
            },
          ]}
        />
      </AppShell>,
    ],
  ];

  for (const [name, ui] of cases) {
    it(name, () => {
      render(ui);
      const els = interactive();
      expect(els.length).toBeGreaterThan(0);
      for (const el of els) expect(touchOk(el), `${el.outerHTML.slice(0, 160)}`).toBe(true);
    });
  }

  it('SafetyGate (termasuk formulir alasan override)', () => {
    render(
      <SafetyGate
        title="CDS"
        recommendation="Ikuti saran"
        onFollow={() => undefined}
        onOverride={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tetap lanjut dengan alasan klinis' }));
    const els = interactive();
    expect(els.length).toBeGreaterThanOrEqual(4);
    for (const el of els) expect(touchOk(el), `${el.outerHTML.slice(0, 160)}`).toBe(true);
  });
});
