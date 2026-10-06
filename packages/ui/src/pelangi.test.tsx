// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, type CommandItem, CommandPalette, filterCommands, Sidebar } from './index';

afterEach(cleanup);

const ITEMS: CommandItem[] = [
  { id: 'daftar', label: 'Pendaftaran', group: 'FRONT OFFICE', href: '/pendaftaran', domain: 'fo' },
  { id: 'farmasi', label: 'Farmasi', group: 'PENUNJANG', href: '/penunjang/farmasi', domain: 'pj' },
  { id: 'depo', label: 'Depo farmasi', group: 'PENUNJANG', href: '/penunjang/depo', domain: 'pj' },
  { id: 'kasir', label: 'Kasir', group: 'KEUANGAN', href: '/keuangan/kasir', domain: 'ku' },
];

describe('filterCommands', () => {
  it('cocok tanpa beda huruf besar/kecil di label atau grup; awalan label lebih dulu', () => {
    expect(filterCommands(ITEMS, 'FARMASI').map((i) => i.id)).toEqual(['farmasi', 'depo']);
    expect(filterCommands(ITEMS, 'keuangan').map((i) => i.id)).toEqual(['kasir']);
    expect(filterCommands(ITEMS, '  ')).toHaveLength(4);
    expect(filterCommands(ITEMS, 'radiologi')).toEqual([]);
  });
});

describe('CommandPalette', () => {
  it('⌘K/Ctrl K membuka; panah + Enter membuka layar; fokus kembali ke pemicu', () => {
    const onSelect = vi.fn();
    render(<CommandPalette items={ITEMS} onSelect={onSelect} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox');
    expect(screen.getByRole('dialog', { name: 'Palet perintah' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'farmasi' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Farmasi'),
      'Depo farmasi',
    ]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = screen.getAllByRole('option')[1];
    expect(second?.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(second?.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('/penunjang/depo');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Cari layar/ }));
  });

  it('Esc menutup tanpa memilih; hasil kosong diberi pesan', () => {
    const onSelect = vi.fn();
    render(<CommandPalette items={ITEMS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Cari layar/ }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(screen.getByText(/Tidak ada layar yang cocok/)).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('Sidebar Pelangi', () => {
  const many = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`,
      label: `${prefix} ${i}`,
      href: `/${prefix}/${i}`,
      icon: 'list' as const,
      available: true,
    }));

  it('menu panjang: grup layar aktif terbuka, grup lain terlipat dengan jumlah layar', () => {
    const { container } = render(
      <Sidebar
        tenantName="RS Fiktif"
        unitName="SIM RS"
        user={{ name: 'Admin', role: 'Admin', initials: 'AD' }}
        activeId="kl3"
        collapseAfter={10}
        groups={[
          { title: 'FRONT OFFICE', domain: 'fo', items: many('fo', 6) },
          { title: 'KLINIS', domain: 'kl', items: many('kl', 6) },
          { title: 'PANDUAN', domain: 'si', items: many('pd', 1) },
        ]}
      />,
    );
    const details = [...container.querySelectorAll('details')];
    expect(details).toHaveLength(2);
    expect(details.map((d) => d.open)).toEqual([false, true]);
    expect(screen.getAllByText('6 layar')).toHaveLength(2);
    // Grup kecil tidak dilipat; semua tautan tetap ada di DOM.
    expect(container.querySelectorAll('a[href]')).toHaveLength(13);
    expect(screen.getByRole('link', { name: 'kl 3' }).getAttribute('aria-current')).toBe('page');
  });

  it('menu pendek tidak dilipat', () => {
    const { container } = render(
      <Sidebar
        tenantName="RS Fiktif"
        unitName="SIM RS"
        user={{ name: 'Admin', role: 'Admin', initials: 'AD' }}
        groups={[{ title: 'KLINIS', domain: 'kl', items: many('kl', 6) }]}
      />,
    );
    expect(container.querySelectorAll('details')).toHaveLength(0);
  });
});

describe('AppShell domain', () => {
  it('memasang data-domain dan label domain di header', () => {
    const { container } = render(
      <AppShell tenantName="RS Fiktif" sidebar={<nav />} header={<span>Header</span>} domain="pj" domainLabel="Penunjang">
        isi
      </AppShell>,
    );
    expect((container.firstElementChild as HTMLElement).dataset.domain).toBe('pj');
    expect(screen.getByRole('banner').textContent).toContain('Penunjang');
  });
});
