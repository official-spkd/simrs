import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { superadminAccess } from '@/lib/access';
import { Fondasi } from './fondasi';

export const metadata: Metadata = { title: 'Fondasi UI' };
export const dynamic = 'force-dynamic';

/** Galeri token + komponen untuk pengembang; tertutup di produksi seperti area superadmin. */
export default function DevUiPage() {
  if (!superadminAccess().allowed) notFound();
  return <Fondasi />;
}
