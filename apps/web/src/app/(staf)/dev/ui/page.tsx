import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/server/session';
import { Fondasi } from './fondasi';

export const metadata: Metadata = { title: 'Fondasi UI' };

/** Galeri token + komponen untuk pengembang; hanya operator platform (seperti area superadmin). */
export default async function DevUiPage() {
  await requireSuperadmin();
  return <Fondasi />;
}
