import { DOMAIN_EVENT_NAMES, type DomainEventName, type DomainEventPayload } from '@simrs/shared';

/**
 * Nama event domain fase 2 dan bentuk payload-nya: sumber tunggal kontrak bersama `@simrs/shared`
 * (`domain-events.ts`, potongan 0a; skema `DOMAIN_EVENT_SCHEMAS`). Payload hanya ID dan kode (tanpa PHI), sama seperti
 * outbox (ADR-0017); tenant, waktu, dan pelaku ada di amplop `DomainEvent` (`domain-events.ts` di folder ini).
 * Event baru: tambah nama + skema di shared; peta di sini mengikuti otomatis.
 */
export { DOMAIN_EVENT_NAMES, type DomainEventName };

/** Payload per nama event (diturunkan dari skema zod bersama). */
export type DomainEventMap = { [N in DomainEventName]: DomainEventPayload<N> };
