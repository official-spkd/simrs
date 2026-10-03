import { logoutAction } from '@/app/masuk/actions';

/** Keluar lewat Server Action (POST + pemeriksaan Origin); sesi dicabut di API lalu cookie dihapus. */
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="min-h-9 w-full cursor-pointer rounded-control border border-line-strong bg-white px-3 text-small font-medium text-ink-700 hover:bg-subtle"
      >
        Keluar
      </button>
    </form>
  );
}
