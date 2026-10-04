/** Logika murni kartu "Status sistem" di Beranda (operator platform), terpisah agar bisa diuji. */

const CHECK_LABEL: Record<string, string> = { database: 'PostgreSQL', redis: 'Redis' };

const STORAGE_LABEL: Record<string, string> = {
  s3: 'Penyimpanan berkas (S3/MinIO)',
  disk: 'Penyimpanan berkas (disk lokal)',
};

/** Nama pemeriksaan `/ready`; penyimpanan berkas mengikuti driver yang dilaporkan API, bukan selalu MinIO. */
export function readinessCheckLabel(name: string, driver?: string): string {
  if (name === 'storage') return (driver && STORAGE_LABEL[driver]) || 'Penyimpanan berkas';
  return CHECK_LABEL[name] ?? name;
}
