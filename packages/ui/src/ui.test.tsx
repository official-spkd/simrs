// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Alert, Button, Field, PatientBanner, Segmented, Sidebar, Tabs } from './index';

afterEach(cleanup);

describe('Button', () => {
  it('default type="button" agar tidak submit form tanpa sengaja', () => {
    render(<Button>Simpan</Button>);
    expect(screen.getByRole('button', { name: 'Simpan' }).getAttribute('type')).toBe('button');
  });
});

describe('Field', () => {
  it('menghubungkan label dan pesan galat', () => {
    render(<Field label="NIK" required error="NIK harus 16 digit." defaultValue="123" />);
    const input = screen.getByLabelText(/NIK/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const msgId = input.getAttribute('aria-describedby');
    expect(msgId && document.getElementById(msgId)?.textContent).toBe('NIK harus 16 digit.');
  });
});

describe('Alert', () => {
  it('kritis memakai role alert dengan label teks', () => {
    render(<Alert level="critical">Kalium 6,8 mmol/L.</Alert>);
    expect(screen.getByRole('alert').textContent).toContain('Kritis');
  });
});

describe('Tabs', () => {
  function Harness() {
    const [v, setV] = useState('a');
    return (
      <Tabs
        label="Contoh"
        value={v}
        onChange={setV}
        items={[
          { id: 'a', label: 'CPPT', content: 'isi A' },
          { id: 'b', label: 'Resep', content: 'isi B' },
        ]}
      />
    );
  }

  it('berpindah dengan klik dan panah', () => {
    render(<Harness />);
    expect(screen.getByRole('tabpanel').textContent).toBe('isi A');
    fireEvent.click(screen.getByRole('tab', { name: 'Resep' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('isi B');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'CPPT' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Sidebar', () => {
  it('menandai halaman aktif dan menonaktifkan layar yang belum ada', () => {
    render(
      <Sidebar
        tenantName="RS Fiktif"
        unitName="SIM RS"
        user={{ name: 'Admin', role: 'Admin', initials: 'AD' }}
        activeId="beranda"
        groups={[
          {
            title: 'UMUM',
            items: [
              { id: 'beranda', label: 'Beranda', href: '/', icon: 'home', available: true },
              { id: 'igd', label: 'IGD', href: '/klinis/igd', icon: 'pulse', available: false },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Beranda' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('link', { name: 'IGD' })).toBeNull();
    expect(screen.getByTitle('IGD · layar belum tersedia').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('PatientBanner', () => {
  it('menampilkan alergi dalam banner identitas', () => {
    render(
      <PatientBanner
        name="Pasien Fiktif"
        sex="P"
        ageYears={54}
        birthDate="14 Mar 1972"
        mrn="00-12-45-78"
        allergies={['Amoksisilin']}
        guarantor="BPJS Kelas 2"
      />,
    );
    expect(screen.getByLabelText('Identitas pasien').textContent).toContain('Alergi: Amoksisilin');
  });
});

describe('Segmented', () => {
  function Harness() {
    const [v, setV] = useState('rj');
    return (
      <>
        <Segmented
          label="Skenario"
          value={v}
          onChange={setV}
          items={[
            { id: 'rj', label: 'Rawat jalan' },
            { id: 'igd', label: 'IGD' },
          ]}
        />
        <output>{v}</output>
      </>
    );
  }

  it('pilihan aktif ditandai aria-selected; panah kanan berpindah dan memindahkan fokus', () => {
    render(<Harness />);
    const rj = screen.getByRole('tab', { name: 'Rawat jalan' });
    expect(rj.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Skenario' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'IGD' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.textContent).toBe('IGD');
    expect(screen.getByRole('status').textContent).toBe('igd');
  });
});
