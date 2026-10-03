# 11 · Persiapan komputer Windows (sekali saja)

Rekomendasi: **kode dan Claude Code berjalan di WSL2 (Ubuntu)**, Docker Desktop memakai backend WSL2, editor VS Code dengan ekstensi WSL. Ini jalur yang paling stabil untuk Node, Docker, dan file watcher di Windows.

> Cara instalasi Claude Code bisa berubah. Bila perintah di bawah gagal, ikuti halaman resmi: https://docs.claude.com/en/docs/claude-code/setup

## 0. Spesifikasi minimal

| Item | Minimal | Disarankan |
|---|---|---|
| Windows | 10 22H2 / 11, virtualisasi aktif di BIOS | Windows 11 |
| RAM | 16 GB | 32 GB |
| Disk kosong | 30 GB | 60 GB SSD |
| Akun | Akun Claude berbayar (Pro/Max/Team) atau API key Console untuk Claude Code | |

## 1. Pasang WSL2, Docker Desktop, Git, VS Code (PowerShell sebagai Administrator)

Cara cepat: jalankan `scripts\windows-prereq.ps1` dari repo ini (klik kanan PowerShell → Run as Administrator):
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-prereq.ps1
```
Atau manual:
```powershell
wsl --install -d Ubuntu-24.04
winget install -e --id Docker.DockerDesktop
winget install -e --id Git.Git
winget install -e --id Microsoft.VisualStudioCode
```
Restart Windows. Buka **Ubuntu** dari Start Menu, buat username/password Linux.

Docker Desktop → Settings:
- General: "Use the WSL 2 based engine" aktif.
- Resources → WSL Integration: aktifkan untuk **Ubuntu-24.04**.

Opsional, batasi memori WSL: buat `C:\Users\<nama>\.wslconfig`:
```ini
[wsl2]
memory=8GB
processors=4
```
lalu `wsl --shutdown` di PowerShell.

## 2. Siapkan Ubuntu (WSL)

Di terminal Ubuntu:
```bash
sudo apt update && sudo apt install -y build-essential curl unzip git ca-certificates
git config --global user.name "Nama Anda"
git config --global user.email "email@contoh.id"
git config --global core.autocrlf input
git config --global init.defaultBranch main

# Node.js 22 LTS via fnm
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22 && fnm default 22
node -v

# pnpm via corepack
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v

# Docker dari WSL (memakai Docker Desktop)
docker version && docker compose version
```

## 3. Pasang Claude Code (di Ubuntu/WSL)

```bash
curl -fsSL https://claude.ai/install.sh | bash
# alternatif bila memakai npm:
# npm install -g @anthropic-ai/claude-code
claude --version
```
Jalankan `claude` sekali, lalu masuk dengan akun Claude (atau API key Console) sesuai petunjuk di layar.

## 4. Letakkan repo di filesystem Linux

Jangan bekerja di `/mnt/c/...` (lambat untuk node_modules dan Docker).
```bash
mkdir -p ~/proyek && cd ~/proyek
cp /mnt/c/Users/<NAMA_WINDOWS>/Downloads/simrs-starter-kit.zip .
unzip simrs-starter-kit.zip && cd simrs
bash scripts/doctor.sh
cp .env.example .env
docker compose up -d
git init && git add -A && git commit -m "chore: starter kit SIM RS"
code .        # membuka VS Code dalam mode WSL
claude        # membuka Claude Code di root repo
```

## 5. Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| `docker: command not found` di Ubuntu | WSL Integration belum aktif di Docker Desktop untuk distro ini |
| Port 5432 sudah dipakai | Ada PostgreSQL terpasang di Windows. Hentikan service-nya atau ubah `POSTGRES_PORT` di `.env` |
| `pnpm dev` lambat / watcher tidak jalan | Repo berada di `/mnt/c`. Pindahkan ke `~/proyek` |
| Skrip `.sh` galat `\r` | File tersimpan CRLF. `git config core.autocrlf input`, lalu `git checkout -- .` (repo ini sudah memakai `.gitattributes` LF) |
| Browser Windows tidak membuka `localhost:3000` | Biasanya otomatis diteruskan oleh WSL2. Bila tidak, `wsl --shutdown` lalu jalankan ulang |
| Docker memakan RAM | Atur `.wslconfig` (bagian 1) |
