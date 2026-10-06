import { cx } from '@simrs/ui';
import Link from 'next/link';

/** Sub-menu layar Integrasi (I01–I12): hub ringkasan + layar per konektor. */
export const INTEGRASI_LINKS = [
  { href: '/sistem/integrasi', label: 'Ringkasan hub' },
  { href: '/sistem/integrasi/satusehat', label: 'SATUSEHAT' },
  { href: '/sistem/integrasi/bpjs', label: 'BPJS' },
  { href: '/sistem/integrasi/kemenkes', label: 'Kemenkes (SIRS)' },
  { href: '/sistem/integrasi/perangkat', label: 'Perangkat medis' },
  { href: '/sistem/integrasi/api-publik', label: 'API publik & FHIR' },
] as const;

export function IntegrasiSubnav({ current }: { current: (typeof INTEGRASI_LINKS)[number]['href'] }) {
  return (
    <nav aria-label="Sub-menu integrasi">
      <ul className="m-0 flex list-none flex-wrap gap-1 rounded-[12px] bg-line-soft p-1">
        {INTEGRASI_LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={l.href === current ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-11 items-center rounded-[9px] px-3.5 text-small no-underline',
                l.href === current ? 'bg-white font-semibold text-brand-700 shadow-tab' : 'text-ink-700',
              )}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
