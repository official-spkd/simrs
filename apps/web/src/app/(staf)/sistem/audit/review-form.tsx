'use client';

import { Button } from '@simrs/ui';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type ReviewResult, reviewBreakGlassAction, reviewFindingAction } from './actions';

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <span className="flex flex-wrap gap-2">
      <Button type="submit" name="outcome" value="sah" variant="primary" disabled={pending}>
        Ditinjau: akses sah
      </Button>
      <Button type="submit" name="outcome" value="perlu_klarifikasi" disabled={pending}>
        Ditinjau: perlu klarifikasi
      </Button>
    </span>
  );
}

/**
 * Keputusan tinjauan (mockup Audit, "TINJAUAN ANOMALI"): catatan opsional + dua keputusan. Keputusan tercatat atas
 * nama peninjau dan tidak bisa dihapus.
 */
export function ReviewForm({ target, id }: { target: 'break_glass' | 'finding'; id: string }) {
  const [state, action] = useActionState<ReviewResult, FormData>(
    target === 'break_glass' ? reviewBreakGlassAction : reviewFindingAction,
    {},
  );
  if (state.ok) {
    return (
      <p role="status" className="m-0 font-semibold text-success">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name={target === 'break_glass' ? 'id' : 'key'} value={id} />
      <span className="text-small text-ink-700">
        Beri keputusan sebelum menutup temuan. Keputusan tercatat atas nama Anda dan tidak dapat dihapus.
      </span>
      <label className="flex flex-col gap-1.5 text-small font-semibold text-ink-700">
        Catatan (opsional)
        <textarea
          name="note"
          maxLength={500}
          rows={2}
          className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-ink-900"
        />
      </label>
      {state.error && (
        <p role="alert" className="m-0 text-small text-danger">
          {state.error}
        </p>
      )}
      <Buttons />
    </form>
  );
}
