import type { LookupConnector, LookupSummary, LookupTarget } from '../../src/infra/lookup/lookup-connector';

type Behavior<O> =
  | { kind: 'value'; value: O }
  | { kind: 'hang' }
  | { kind: 'fail'; error: unknown }
  | { kind: 'custom'; run: (signal: AbortSignal) => Promise<O> };

/**
 * Konektor lookup palsu untuk tes (ADR-0025): perilaku diatur per tes, setiap panggilan dicatat beserta status
 * `AbortSignal`-nya. `hang` menunggu sampai dibatalkan gateway (batas waktu), lalu menolak seperti klien HTTP sungguhan.
 */
export class FakeLookupConnector<I = unknown, O = unknown> implements LookupConnector<I, O> {
  readonly calls: Array<{ input: I; signal: AbortSignal }> = [];
  private behavior: Behavior<O> | undefined;

  constructor(
    readonly name: string,
    readonly target: LookupTarget,
    readonly timeoutMs?: number,
    private readonly summary?: (output: O) => LookupSummary,
  ) {}

  returns(value: O): this {
    this.behavior = { kind: 'value', value };
    return this;
  }

  hangs(): this {
    this.behavior = { kind: 'hang' };
    return this;
  }

  fails(error: unknown): this {
    this.behavior = { kind: 'fail', error };
    return this;
  }

  runs(run: (signal: AbortSignal) => Promise<O>): this {
    this.behavior = { kind: 'custom', run };
    return this;
  }

  summarize(output: O): LookupSummary {
    return this.summary ? this.summary(output) : {};
  }

  async call(input: I, signal: AbortSignal): Promise<O> {
    this.calls.push({ input, signal });
    const b = this.behavior;
    if (!b) throw new Error('FakeLookupConnector belum diatur');
    switch (b.kind) {
      case 'value':
        return b.value;
      case 'fail':
        throw b.error;
      case 'custom':
        return b.run(signal);
      case 'hang':
        return new Promise<O>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
    }
  }
}
