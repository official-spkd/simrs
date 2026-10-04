import Link from 'next/link';

/** PIN masuk cepat (ADR-0024): daftar/hapus perangkat ber-PIN; untuk posisi layanan berunit dan sesi PIN. */
export function PinLink() {
  return (
    <Link
      href="/akun/pin"
      className="flex min-h-9 w-full items-center justify-center rounded-control border border-line-strong bg-white px-3 text-small font-medium text-ink-700 no-underline hover:bg-subtle"
    >
      PIN masuk cepat
    </Link>
  );
}
