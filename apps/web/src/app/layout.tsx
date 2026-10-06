import type { Metadata } from 'next';
import { IBM_Plex_Mono, Poppins } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import './globals.css';

// Pelangi Klinis (ADR-0091): Poppins untuk seluruh teks; IBM Plex Mono hanya untuk pengenal (RM, ICD, SEP).
const sans = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'SIM RS', template: '%s · SIM RS' },
  description: 'Sistem Informasi Manajemen Rumah Sakit (lingkungan lokal, data fiktif)',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // CSP ber-nonce (proxy, ADR-0073): setiap halaman dirender per permintaan agar skrip Next membawa nonce
  // permintaan itu (halaman prarender memuat skrip tanpa nonce dan akan diblokir). Next mengambil nonce dari
  // header CSP permintaan; komponen yang memasang `<Script>` sendiri membaca header `NONCE_HEADER`.
  await connection();
  return (
    <html lang="id" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
