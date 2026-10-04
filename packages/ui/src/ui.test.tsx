// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Alert,
  AppShell,
  Button,
  Field,
  LineChart,
  PatientBanner,
  SafetyGate,
  Segmented,
  Sidebar,
  Tabs,
} from './index';

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

describe('LineChart', () => {
  it('gambar berlabel + tabel data tersembunyi untuk pembaca layar', () => {
    render(
      <LineChart
        id="uji"
        ariaLabel="Pendapatan harian"
        yTicks={[150, 300]}
        xLabels={[{ index: 0, label: '1 Okt' }]}
        rowLabels={['1 Okt', '2 Okt', '3 Okt']}
        series={[
          { label: 'Realisasi', values: [200, 250, 220], tone: 'brand', area: true },
          { label: 'Anggaran', values: [210, 212, 214], tone: 'warning', dashed: true },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Pendapatan harian' })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(table.textContent).toContain('250');
    expect(document.querySelectorAll('path')).toHaveLength(3);
  });
});

describe('SafetyGate', () => {
  it('menahan sampai ditindaklanjuti; override wajib alasan cukup panjang', () => {
    const calls: string[] = [];
    render(
      <SafetyGate
        title="CDS: sulfonilurea pada riwayat hipoglikemia berat"
        recommendation="Hapus glimepirid"
        onFollow={() => calls.push('ikuti')}
        onOverride={(r) => calls.push(`override:${r}`)}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Gerbang keselamatan');
    fireEvent.click(screen.getByRole('button', { name: 'Tetap lanjut dengan alasan klinis' }));
    const submit = screen.getByRole('button', { name: 'Simpan alasan dan lanjut' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Alasan klinis/), { target: { value: 'pendek' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Alasan klinis/), {
      target: { value: 'edukasi hipoglikemia, cek gula mandiri' },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    fireEvent.click(screen.getByRole('button', { name: 'Hapus glimepirid' }));
    expect(calls).toEqual(['override:edukasi hipoglikemia, cek gula mandiri', 'ikuti']);
  });

  it('setelah diputuskan menampilkan ringkasan, bukan tombol', () => {
    render(
      <SafetyGate
        title="Nilai kritis kalium"
        recommendation="Read-back benar"
        onFollow={() => undefined}
        onOverride={() => undefined}
        resolved={{ kind: 'ikuti', text: 'Dilaporkan ke dr. Rina · 22.21' }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Dilaporkan ke dr. Rina');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AppShell', () => {
  it('header lengket hanya bila diminta; tingginya tersedia sebagai --app-sticky-top', () => {
    const { container, rerender } = render(
      <AppShell tenantName="RS Fiktif" sidebar={<nav />} header={<span>Header</span>}>
        isi
      </AppShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.hasAttribute('data-sticky-header')).toBe(false);
    expect(root.style.getPropertyValue('--app-sticky-top')).toBe('0px');
    expect(screen.getByRole('banner').className).not.toContain('sticky');

    rerender(
      <AppShell tenantName="RS Fiktif" sidebar={<nav />} header={<span>Header</span>} stickyHeader>
        isi
      </AppShell>,
    );
    expect(root.hasAttribute('data-sticky-header')).toBe(true);
    expect(root.style.getPropertyValue('--app-sticky-top')).toBe('4rem');
    expect(screen.getByRole('banner').className).toContain('md:sticky');
  });
});
