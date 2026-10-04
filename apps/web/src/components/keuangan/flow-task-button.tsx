'use client';

import { Button } from '@simrs/ui';
import { useId } from 'react';
import { flowReason, type ScenarioFlow } from '@/lib/keuangan-flow';

/**
 * Tombol layar asli yang menjalankan satu tugas skenario: aktif hanya saat tugas itu gilirannya, alasan nonaktif
 * selalu terlihat, dan setelah selesai berganti menjadi teks hasil.
 */
export function FlowTaskButton({
  flow,
  task,
  label,
  doneText,
  pending,
  onRun,
  variant = 'secondary',
}: {
  flow: ScenarioFlow;
  task: string;
  label: string;
  doneText: string;
  pending: boolean;
  onRun: (task: string) => void;
  variant?: 'primary' | 'secondary';
}) {
  const id = useId();
  const t = flow.tasks[task];
  if (!t || !t.visible) return null;
  if (t.done) {
    return (
      <span className="text-small font-semibold text-success">
        ✓ {doneText}
        {t.at ? ` · ${t.at}` : ''}
      </span>
    );
  }
  const reason = flowReason(flow, task);
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant={variant}
        disabled={!t.enabled || pending}
        aria-describedby={reason ? id : undefined}
        onClick={() => onRun(task)}
        className="self-start"
      >
        {label}
      </Button>
      {reason && (
        <span id={id} className="text-caption font-medium text-warning">
          {reason}
        </span>
      )}
    </span>
  );
}
