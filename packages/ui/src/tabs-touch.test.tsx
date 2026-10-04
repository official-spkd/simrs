// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TabList, type TabListItem, TabPanel, Tabs, type TabsVariant, tabIds, tabKeyTarget } from './index';

/**
 * Primitif tab bersama: pola tab ARIA, keyboard, dan panel tetap terpasang (`keepMounted`).
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
