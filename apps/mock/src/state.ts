import { INTEGRATION_TARGETS, type IntegrationTarget } from '@simrs/shared';

export const SYSTEMS = INTEGRATION_TARGETS;
export type MockSystem = IntegrationTarget;

export const SYSTEM_LABEL: Record<MockSystem, string> = {
  bpjs: 'BPJS (VClaim · Antrean · Aplicare)',
  eklaim: 'E-Klaim INA-CBG',
  satusehat: 'SATUSEHAT FHIR R4',
  dukcapil: 'Dukcapil',
  tte: 'Penyelenggara TTE',
  tpdi: 'TPDI (agregator teknologi)',
  btn: 'BTN (VA, QRIS, rekening, pembiayaan)',
  email: 'Email (kotak masuk mock)',
  whatsapp: 'WhatsApp (kotak masuk mock)',
};

export type ScenarioMode = 'normal' | 'lambat' | 'gagal' | 'acak';

export interface Scenario {
  mode: ScenarioMode;
  /** Latensi tambahan (ms) untuk mode `lambat` dan `acak`. */
  latencyMs: number;
  /** Kode HTTP untuk mode `gagal` dan `acak`. */
  failStatus: number;
}

export interface RequestLogEntry {
  at: string;
  system: MockSystem | 'panel';
  method: string;
  path: string;
  status: number;
  durationMs: number;
  note?: string;
}

export type InvoiceStatus = 'pending' | 'paid' | 'expired' | 'failed';

export interface TpdiInvoice {
  id: string;
  merchantId: string;
  externalRef: string;
  channel: 'va_btn' | 'qris';
  /** Rupiah bulat, disimpan sebagai string agar tidak kehilangan presisi. */
  amount: string;
  status: InvoiceStatus;
  vaNumber?: string;
  qrPayload?: string;
  expiresAt: string;
  paidAt?: string;
  bankRef?: string;
  idempotencyKey: string;
  webhookDeliveries: Array<{ at: string; event: string; status: number | 'error'; eventId: string }>;
}

/** Pesan email/WhatsApp yang "terkirim" ke mock (P09), terbaru di depan, maks. 100. */
export interface OutgoingMessage {
  id: string;
  channel: 'email' | 'whatsapp';
  to: string;
  subject?: string;
  text: string;
  at: string;
}

export interface EchoRecord {
  idempotencyKey: string;
  operation: string;
  receivedAt: string;
  count: number;
}

const defaultScenario = (): Scenario => ({ mode: 'normal', latencyMs: 3000, failStatus: 503 });

export class MockState {
  scenarios = new Map<MockSystem, Scenario>();
  log: RequestLogEntry[] = [];
  bpjsEncryption = true;
  invoices = new Map<string, TpdiInvoice>();
  invoiceByIdempotency = new Map<string, string>();
  echoes = new Map<string, EchoRecord>();
  messages: OutgoingMessage[] = [];
  private seq = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    for (const s of SYSTEMS) this.scenarios.set(s, defaultScenario());
    this.log = [];
    this.bpjsEncryption = true;
    this.invoices.clear();
    this.invoiceByIdempotency.clear();
    this.echoes.clear();
    this.messages = [];
    this.seq = 0;
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  scenario(system: MockSystem): Scenario {
    return this.scenarios.get(system) ?? defaultScenario();
  }

  deliver(m: OutgoingMessage): void {
    this.messages.unshift(m);
    if (this.messages.length > 100) this.messages.length = 100;
  }

  record(entry: RequestLogEntry): void {
    this.log.unshift(entry);
    if (this.log.length > 50) this.log.length = 50;
  }
}
