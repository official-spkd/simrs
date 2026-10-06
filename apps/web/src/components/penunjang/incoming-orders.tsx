import { formatTanggalWaktu } from '@simrs/shared';
import type { IncomingOrder } from '@/lib/penunjang-klinis';

/** Order yang diterima tetapi belum aman diproses tetap terlihat, termasuk alasan dan dokter pengirim. */
export function IncomingOrders({
  orders,
  destination,
}: {
  orders: readonly IncomingOrder[];
  destination: string;
}) {
  const pending = orders.filter((x) => x.dest === destination && x.reason);
  if (!pending.length) return null;
  return (
    <section
      aria-label="Order CPOE menunggu kelengkapan"
      className="rounded-card border border-warning-border bg-warning-bg p-4"
    >
      <h2 className="m-0 text-h2 font-semibold">Order CPOE menunggu kelengkapan · {pending.length}</h2>
      <ul className="mb-0 grid list-none gap-3 p-0">
        {pending.map((order) => (
          <li key={order.lineId} className="min-w-0 border-t border-warning-border pt-3">
            <p className="m-0 font-semibold">
              {order.patientName} · {order.rm} · {order.name}
            </p>
            <p className="m-0 break-words text-small">{order.detail}</p>
            <p className="m-0 text-small">
              {order.by} · {formatTanggalWaktu(order.at)}
            </p>
            <p className="mb-0 text-small font-semibold">{order.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
