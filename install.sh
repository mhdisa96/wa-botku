#!/bin/bash

echo "🚀 INSTALL WA BOTKU"

# Update
apt update -y
apt install -y curl git

# Install Node.js jika belum ada
if ! command -v node >/dev/null 2>&1; then
  echo "📦 Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

# Install PM2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "⚙️ Installing PM2..."
  npm install -g pm2
fi

# Clone repo
echo "📥 Cloning repo..."
git clone https://github.com/USERNAME/wa-botku.git wa-botku
cd wa-botku

# Install dependencies
echo "📦 Installing modules..."
npm install

# Auto buat .env
echo "⚙️ Membuat config otomatis..."

read -p "Masukkan nomor WhatsApp (628xxx): " nomor

cat > .env <<EOF
TIMEZONE=Asia/Jakarta
TZ_LABEL=WIB

AUTH_DIR=./auth_info
DATA_DIR=./data
MEDIA_DIR=./media
BACKUP_DIR=./backups
LOG_DIR=./logs

BACKUP_INTERVAL_MINUTES=30
MAX_BACKUP_FILES=20

COMMAND_PREFIX=.

USE_PAIRING_CODE=true
PAIRING_NUMBER=$nomor
EOF

# Start bot
echo "▶️ Menjalankan bot..."
pm2 start index.js --name wa-botku
pm2 save

echo ""
echo "✅ INSTALL SELESAI!"
echo "📱 Tunggu kode pairing muncul..."
echo "📌 Gunakan menu WhatsApp → Perangkat tertaut"
