#!/usr/bin/env bash
# Menghapus SEMUA data lokal (volume Postgres) lalu membuat ulang. Hanya untuk lokal.
set -euo pipefail
read -r -p "Hapus seluruh database lokal SIM RS? Ketik 'hapus' untuk lanjut: " jawab
[ "$jawab" = "hapus" ] || { echo "Dibatalkan."; exit 1; }
docker compose stop postgres
docker compose rm -f postgres
docker volume rm simrs_pgdata || true
docker compose up -d postgres
echo "Menunggu Postgres siap..."; until docker compose exec -T postgres pg_isready -U postgres -d simrs >/dev/null 2>&1; do sleep 1; done
if [ -d packages/db ]; then pnpm db:migrate && pnpm db:seed; fi
echo "Selesai."
