#!/usr/bin/env bash
# Cek prasyarat lokal SIM RS. Jalankan dari root repo di WSL/Linux/macOS.
set -u
ok=0; warn=0; fail=0
pass(){ printf "  \033[32m✓\033[0m %s\n" "$1"; ok=$((ok+1)); }
wrn(){ printf "  \033[33m!\033[0m %s\n" "$1"; warn=$((warn+1)); }
bad(){ printf "  \033[31m✗\033[0m %s\n" "$1"; fail=$((fail+1)); }

echo "SIM RS · pemeriksaan prasyarat"
case "$(pwd)" in /mnt/*) wrn "Repo berada di filesystem Windows ($(pwd)). Pindahkan ke ~/proyek agar cepat.";; *) pass "Lokasi repo di filesystem Linux";; esac

if command -v node >/dev/null; then v=$(node -v | sed 's/v//' | cut -d. -f1); [ "$v" -ge 22 ] && pass "Node $(node -v)" || bad "Node $(node -v) — butuh ≥ 22"; else bad "Node belum terpasang"; fi
command -v pnpm >/dev/null && pass "pnpm $(pnpm -v)" || bad "pnpm belum aktif (corepack enable)"
command -v git >/dev/null && pass "$(git --version)" || bad "git belum terpasang"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then pass "Docker berjalan"; else bad "Docker tidak terjangkau (aktifkan WSL Integration di Docker Desktop)"; fi
docker compose version >/dev/null 2>&1 && pass "docker compose tersedia" || bad "docker compose tidak tersedia"
command -v claude >/dev/null && pass "Claude Code $(claude --version 2>/dev/null | head -1)" || wrn "Claude Code belum terpasang (lihat docs/11-setup-windows.md)"
[ "$(git config --get core.autocrlf)" = "input" ] && pass "git core.autocrlf=input" || wrn "Set: git config --global core.autocrlf input"
[ -f .env ] && pass ".env ada" || wrn ".env belum ada (cp .env.example .env)"

for p in 3000 4000 4100 5432 6379 9000 9001 8025; do
  if (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then exec 3>&- 3<&-; wrn "Port $p sudah dipakai (abaikan bila itu container SIM RS)"; fi
done
mem=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
[ "${mem:-0}" -ge 6 ] && pass "Memori tersedia untuk WSL: ${mem} GB" || wrn "Memori WSL ${mem} GB; disarankan ≥ 8 GB (.wslconfig)"

echo; echo "Hasil: $ok lolos, $warn peringatan, $fail gagal"
[ $fail -eq 0 ]
