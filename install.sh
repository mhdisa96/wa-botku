#!/bin/bash

echo "🚀 INSTALL BOT WA"

apt update -y
apt install -y curl git

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo "📥 CLONE REPO"
git clone https://github.com/mhdisa96/wa-botku.git wa-botku
cd wa-botku

echo "📦 INSTALL MODULE"
npm install

echo "⚙️ SET ENV"
cp .env.example .env

echo "📡 INSTALL PM2"
npm install -g pm2

echo "▶️ START BOT"
pm2 start index.js --name wa-botku
pm2 save

echo "✅ DONE"
