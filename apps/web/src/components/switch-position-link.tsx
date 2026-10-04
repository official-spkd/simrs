import Link from 'next/link';

/** Ganti posisi (penugasan) tanpa keluar-masuk; hanya untuk akun dengan lebih dari satu posisi. */
export function SwitchPositionLink() {
  return (
    <Link
      href="/akun/posisi"
      className="flex min-h-11 w-full items-center justify-center rounded-control border border-line-strong bg-white px-3 text-small font-medium text-ink-700 no-underline hover:bg-subtle"
    >
      Ganti posisi
    </Link>
  );
}
