🤖 wa-botku — WhatsApp Scheduler Bot VPS

Bot WhatsApp otomatis berbasis Baileys untuk mengirim pesan & foto ke grup dengan sistem jadwal.

---

🚀 Fitur Utama

📅 Scheduler Otomatis

- Kirim pesan sesuai jam (HH:MM)
- Jadwal harian otomatis
- Multi slot (bebas banyak jam)

🖼️ Multi Foto + Caption

- Bisa kirim banyak foto
- Caption hanya di foto pertama (model album)

🔗 Login Modern

- Support kode tautan (pairing code)
- Tidak perlu scan QR

🔁 System Stabil

- Auto reconnect saat putus
- Auto restart via WhatsApp
- Support PM2 (auto hidup saat VPS restart)

💾 Backup & Log

- Auto backup session
- Log kirim harian
- Command lihat log langsung dari WA

📋 Utility

- Ambil semua ID grup
- Kirim manual per slot

---

📦 Struktur Folder

auth_info/    → session WhatsApp
data/         → config bot
media/        → file foto
backups/      → backup session
logs/         → log kirim
index.js      → main bot
.env          → config environment

---

⚙️ Instalasi VPS (Ubuntu)

1. Clone Repository

git clone https://github.com/mhdisa96/wa-botku.git
cd wa-botku

---

2. Install Dependency

npm install

---

3. Setup Environment

cp .env.example .env
nano .env

Isi ".env":

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
PAIRING_NUMBER=6281234567890

⚠️ Format nomor:

- wajib: "628xxxx"
- jangan pakai "+62"
- jangan pakai spasi

---

4. Jalankan Bot

node index.js

---

5. Login WhatsApp

- buka WhatsApp
- klik Perangkat tertaut
- pilih Masukkan kode
- input kode dari VPS

---

🔁 Jalankan dengan PM2 (WAJIB)

npm install -g pm2
pm2 start index.js --name wa-botku
pm2 save
pm2 startup

---

📱 Command Bot

⚙️ Setup

.setgrup <groupId>
.groups

---

⏰ Jadwal

.setjadwal 08:00
.setpesan 08:00 Selamat pagi
.savefoto 08:00

---

▶️ Control

.onjadwal
.offjadwal
.kirim 08:00

---

🧾 Informasi

.status
.listjadwal
.log

---

💾 System

.backup
.restart
.update

---

📋 Cara Ambil ID Grup

.groups

Contoh:

Grup Jualan
120363xxxxxxxx@g.us

---

🧠 Cara Kerja Bot

1. Set grup tujuan
2. Buat jadwal
3. Set pesan
4. Upload foto
5. Aktifkan scheduler

Bot akan otomatis kirim setiap hari sesuai jam.

---

📊 Log & Backup

📁 Log

- Lokasi: "/logs"
- Format: "send-log-YYYY-MM-DD.log"

💾 Backup

- Lokasi: "/backups"
- Otomatis tiap X menit

---

⚠️ Penting

Jangan hapus folder:

auth_info
data
media

Jika terhapus:
👉 harus login ulang

---

🔥 Tips Penggunaan

- Gunakan VPS (lebih stabil dari panel)
- Gunakan PM2 (auto hidup)
- Backup session penting
- Gunakan timezone sesuai lokasi

---

🧠 Troubleshooting

❌ Bot tidak kirim

- cek ".onjadwal"
- cek jam & timezone

❌ Bot logout

- cek folder "auth_info"

❌ Error module

npm install

❌ Restart tidak jalan

- pastikan pakai PM2

---

🚀 Auto Install (Opsional)

bash <(curl -s https://raw.githubusercontent.com/mhdisa96/wa-botku/main/install.sh)

---

🔒 Keamanan

Disarankan:

- tambahkan password di ".restart" dan ".update"
- jangan share VPS access

---

📜 License

Free to use 👍

---

👨‍💻 Author

wa-botku — WhatsApp Automation Bot
