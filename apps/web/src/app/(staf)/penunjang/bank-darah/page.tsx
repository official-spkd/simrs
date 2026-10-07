import type { Metadata } from 'next';
import { ScreenAccessDenied } from '@/components/screen-gate';
import { requireScreen } from '@/lib/server/screen-guard';
import { ApiBankDarah } from './api-bank-darah';
import { DemoBankDarah } from './demo-bank-darah';

export const metadata: Metadata = { title: 'Bank darah' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/**
 * S08 · Layar hibrida Bank darah (rencana fase 4 potongan 4.0c, pola 3.0d klinis): mode presentasi memakai data dummy
 * (`demo-bank-darah.tsx` + `actions-demo.ts`, dibekukan); mode api (potongan 4.9, ADR-0105) untuk peran ber-izin
 * `blood_bank.read`: permintaan, crossmatch, cek ganda dua petugas, dan transfusi gelang ↔ kantong + petugas kedua.
 */
export default async function BankDarahPage({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireScreen('bank-darah');
  if (access.mode === 'demo') return <DemoBankDarah access={access} />;
  if (!access.allowed) return <ScreenAccessDenied screen={access.screen} />;
  const sp = await searchParams;
  return <ApiBankDarah session={access.session} kunjungan={one(sp.kunjungan)} pilih={one(sp.pilih)} />;
}
