import type { Metadata } from 'next';
import { Fondasi } from './fondasi';

export const metadata: Metadata = { title: 'Fondasi UI' };

export default function DevUiPage() {
  return <Fondasi />;
}
