require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pino = require("pino");
const QRCode = require("qrcode-terminal");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const logger = pino({ level: "silent" });

const AUTH_DIR = process.env.AUTH_DIR || "./auth_info";
const DATA_DIR = process.env.DATA_DIR || "./data";
const MEDIA_DIR = process.env.MEDIA_DIR || "./media";
const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";
const LOG_DIR = process.env.LOG_DIR || "./logs";
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || ".";
const TIMEZONE = process.env.TIMEZONE || "Asia/Jakarta";
const TZ_LABEL = process.env.TZ_LABEL || "WIB";
const BACKUP_INTERVAL_MINUTES = Number(process.env.BACKUP_INTERVAL_MINUTES || 30);
const MAX_BACKUP_FILES = Number(process.env.MAX_BACKUP_FILES || 20);
const USE_PAIRING_CODE = String(process.env.USE_PAIRING_CODE || "true").toLowerCase() === "true";
const PAIRING_NUMBER = (process.env.PAIRING_NUMBER || "").replace(/\D/g, "");

let sock = null;
let isReady = false;
let reconnecting = false;
let pairingRequested = false;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureFiles() {
  ensureDir(AUTH_DIR);
  ensureDir(DATA_DIR);
  ensureDir(MEDIA_DIR);
  ensureDir(BACKUP_DIR);
  ensureDir(LOG_DIR);

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          targetGroupJid: "",
          slots: {},
          enabled: false
        },
        null,
        2
      )
    );
  }
}

function loadConfig() {
  ensureFiles();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function validTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function getTimeParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
    seconds: `${map.hour}:${map.minute}:${map.second}`,
    stamp: `${map.year}-${map.month}-${map.day}_${map.hour}-${map.minute}-${map.second}`
  };
}

function todayDate() {
  return getTimeParts().date;
}

function nowTime() {
  return getTimeParts().time;
}

function nowSeconds() {
  return getTimeParts().seconds;
}

function nowStamp() {
  return getTimeParts().stamp;
}

function getLogFilePath() {
  return path.join(LOG_DIR, `send-log-${todayDate()}.log`);
}

function writeLog(type, payload = {}) {
  ensureDir(LOG_DIR);

  const line = JSON.stringify({
    at: `${todayDate()} ${nowSeconds()} ${TZ_LABEL}`,
    type,
    ...payload
  });

  fs.appendFileSync(getLogFilePath(), line + "\n");
  console.log("[LOG]", line);
}

function copyRecursive(src, dst) {
  ensureDir(dst);

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function trimOldBackups() {
  ensureDir(BACKUP_DIR);

  const dirs = fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  for (let i = MAX_BACKUP_FILES; i < dirs.length; i++) {
    fs.rmSync(path.join(BACKUP_DIR, dirs[i]), { recursive: true, force: true });
  }
}

function backupSession(reason = "manual") {
  ensureDir(BACKUP_DIR);
  ensureDir(AUTH_DIR);

  const backupName = `auth_backup_${nowStamp()}_${reason}`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  copyRecursive(AUTH_DIR, backupPath);
  trimOldBackups();
  writeLog("backup_session", { reason, backupPath });

  return backupPath;
}

function restartBot() {
  writeLog("restart_bot", { reason: "command" });
  console.log("Restarting bot...");

  setTimeout(() => {
    process.exit(1);
  }, 2000);
}

async function reply(remoteJid, text, quoted) {
  return sock.sendMessage(remoteJid, { text }, { quoted });
}

async function sendSlot(timeKey, trigger = "manual") {
  const config = loadConfig();
  const slot = config.slots[timeKey];

  if (!slot) throw new Error(`Slot ${timeKey} tidak ditemukan`);
  if (!config.targetGroupJid) throw new Error("Group belum di-set. Pakai .setgrup");

  let sentPhoto = 0;

  for (let i = 0; i < (slot.photos || []).length; i++) {
    const photo = slot.photos[i];
    if (!fs.existsSync(photo.path)) continue;

    await sock.sendMessage(config.targetGroupJid, {
      image: { url: photo.path },
      caption: i === 0 ? (slot.text || "") : ""
    });

    sentPhoto++;
  }

  if (sentPhoto === 0 && slot.text) {
    await sock.sendMessage(config.targetGroupJid, { text: slot.text });
  }

  if (sentPhoto === 0 && !slot.text) {
    throw new Error("Slot kosong. Belum ada teks atau foto");
  }

  config.slots[timeKey].last = todayDate();
  saveConfig(config);

  writeLog("send_slot", {
    trigger,
    slot: timeKey,
    groupJid: config.targetGroupJid,
    text: slot.text || "",
    photos: sentPhoto
  });
}

async function saveIncomingImageToSlot(message, timeKey) {
  const buffer = await downloadMediaMessage(
    message,
    "buffer",
    {},
    { logger, reuploadRequest: sock.updateMediaMessage }
  );

  if (!buffer) throw new Error("Gagal download gambar");

  const filename = `${Date.now()}_${timeKey.replace(":", "")}.jpg`;
  const filePath = path.join(MEDIA_DIR, filename);
  fs.writeFileSync(filePath, buffer);

  const config = loadConfig();
  if (!config.slots[timeKey]) {
    config.slots[timeKey] = { text: "", photos: [], last: "" };
  }

  config.slots[timeKey].photos.push({
    filename,
    path: filePath
  });

  saveConfig(config);

  writeLog("save_photo", {
    slot: timeKey,
    filename,
    total: config.slots[timeKey].photos.length
  });

  return config.slots[timeKey].photos.length;
}

function getMessageText(message) {
  return (
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    ""
  ).trim();
}

function getLastLogLines(limit = 15) {
  const file = getLogFilePath();
  if (!fs.existsSync(file)) return "Belum ada log hari ini.";

  const content = fs.readFileSync(file, "utf8").trim();
  if (!content) return "Belum ada log hari ini.";

  const lines = content.split("\n").filter(Boolean);
  return lines.slice(-limit).join("\n") || "Belum ada log hari ini.";
}

async function handleCommand(message) {
  const text = getMessageText(message);
  if (!text.startsWith(COMMAND_PREFIX)) return;

  const remoteJid = message.key.remoteJid;
  const [cmd, ...rest] = text.slice(COMMAND_PREFIX.length).split(" ");
  const arg = rest.join(" ").trim();
  const config = loadConfig();

  try {
    if (cmd === "menu" || cmd === "help") {
      await reply(
        remoteJid,
        [
          "📌 *Menu Bot VPS*",
          ".setgrup <groupJid>",
          ".setjadwal <HH:MM>",
          ".setpesan <HH:MM> <teks>",
          "kirim foto dengan caption: .savefoto <HH:MM>",
          ".listjadwal",
          ".hapusjadwal <HH:MM>",
          ".clearjadwal",
          ".onjadwal",
          ".offjadwal",
          ".kirim <HH:MM>",
          ".status",
          ".backup",
          ".log",
          ".restart"
        ].join("\n"),
        message
      );
      return;
    }

    if (cmd === "status") {
      await reply(
        remoteJid,
        [
          "✅ *Status Bot VPS*",
          `Connected: ${isReady ? "Ya" : "Tidak"}`,
          `Timezone IANA: ${TIMEZONE}`,
          `Label Zona: ${TZ_LABEL}`,
          `Waktu Bot: ${todayDate()} ${nowSeconds()} ${TZ_LABEL}`,
          `Target Grup: ${config.targetGroupJid || "-"}`,
          `Scheduler: ${config.enabled ? "ON" : "OFF"}`,
          `Jumlah Slot: ${Object.keys(config.slots || {}).length}`,
          `Mode Login: ${USE_PAIRING_CODE ? "Kode tautan" : "QR"}`,
          `Nomor Pairing: ${PAIRING_NUMBER || "-"}`,
          `Backup otomatis: tiap ${BACKUP_INTERVAL_MINUTES} menit`
        ].join("\n"),
        message
      );
      return;
    }

    if (cmd === "backup") {
      const backupPath = backupSession("manual");
      await reply(remoteJid, `✅ Backup session dibuat:\n${backupPath}`, message);
      return;
    }

    if (cmd === "log") {
      await reply(remoteJid, `🧾 *Log terakhir*\n\n${getLastLogLines(15)}`, message);
      return;
    }

    if (cmd === "restart") {
      await reply(remoteJid, "♻️ Bot akan restart...", message);
      restartBot();
      return;
    }

    if (cmd === "setgrup") {
      config.targetGroupJid = arg;
      saveConfig(config);
      await reply(remoteJid, `✅ Grup diset:\n${arg}`, message);
      return;
    }

    if (cmd === "setjadwal") {
      if (!validTime(arg)) {
        await reply(remoteJid, "Format salah. Contoh: .setjadwal 08:00", message);
        return;
      }

      if (!config.slots[arg]) {
        config.slots[arg] = { text: "", photos: [], last: "" };
      }

      saveConfig(config);
      await reply(remoteJid, `✅ Jadwal dibuat: ${arg}`, message);
      return;
    }

    if (cmd === "setpesan") {
      const parts = arg.split(" ");
      const timeKey = parts.shift();
      const msg = parts.join(" ");

      if (!validTime(timeKey) || !msg) {
        await reply(remoteJid, "Format salah. Contoh: .setpesan 08:00 Selamat pagi", message);
        return;
      }

      if (!config.slots[timeKey]) {
        config.slots[timeKey] = { text: "", photos: [], last: "" };
      }

      config.slots[timeKey].text = msg;
      saveConfig(config);
      await reply(remoteJid, `✅ Pesan untuk ${timeKey} disimpan.`, message);
      return;
    }

    if (cmd === "savefoto") {
      const timeKey = arg.trim();

      if (!validTime(timeKey)) {
        await reply(remoteJid, "Kirim foto dengan caption: .savefoto 08:00", message);
        return;
      }

      if (!message.message?.imageMessage) {
        await reply(remoteJid, "Harus kirim gambar dengan caption .savefoto 08:00", message);
        return;
      }

      const total = await saveIncomingImageToSlot(message, timeKey);
      await reply(remoteJid, `✅ Foto disimpan ke slot ${timeKey}\nTotal foto: ${total}`, message);
      return;
    }

    if (cmd === "listjadwal") {
      const entries = Object.keys(config.slots || {}).sort();

      if (!entries.length) {
        await reply(remoteJid, "Belum ada jadwal.", message);
        return;
      }

      const lines = [
        "⏰ *Daftar Jadwal*",
        `Timezone IANA: ${TIMEZONE}`,
        `Label Zona: ${TZ_LABEL}`,
        `Sekarang: ${todayDate()} ${nowSeconds()} ${TZ_LABEL}`,
        ""
      ];

      for (const timeKey of entries) {
        const slot = config.slots[timeKey];
        lines.push(
          `${timeKey} | teks: ${slot.text ? "ada" : "kosong"} | foto: ${(slot.photos || []).length}`
        );
      }

      await reply(remoteJid, lines.join("\n"), message);
      return;
    }

    if (cmd === "hapusjadwal") {
      const timeKey = arg.trim();
      delete config.slots[timeKey];
      saveConfig(config);
      await reply(remoteJid, `✅ Jadwal dihapus: ${timeKey}`, message);
      return;
    }

    if (cmd === "clearjadwal") {
      config.slots = {};
      config.enabled = false;
      saveConfig(config);
      await reply(remoteJid, "✅ Semua jadwal dihapus dan scheduler dimatikan.", message);
      return;
    }

    if (cmd === "onjadwal") {
      config.enabled = true;
      saveConfig(config);
      await reply(remoteJid, `✅ Scheduler ON\nTimezone aktif: ${TIMEZONE} (${TZ_LABEL})`, message);
      return;
    }

    if (cmd === "offjadwal") {
      config.enabled = false;
      saveConfig(config);
      await reply(remoteJid, "✅ Scheduler OFF", message);
      return;
    }

    if (cmd === "kirim") {
      const timeKey = arg.trim();
      if (!validTime(timeKey)) {
        await reply(remoteJid, "Contoh: .kirim 08:00", message);
        return;
      }

      await sendSlot(timeKey, "manual_command");
      await reply(remoteJid, `✅ Slot ${timeKey} terkirim.`, message);
      return;
    }
  } catch (err) {
    console.error("[COMMAND ERROR]", err);
    writeLog("command_error", { command: cmd, error: err.message });
    await reply(remoteJid, `❌ Error: ${err.message}`, message);
  }
}

async function maybeRequestPairingCode() {
  try {
    if (!USE_PAIRING_CODE) return;
    if (!PAIRING_NUMBER) {
      console.log("USE_PAIRING_CODE aktif tapi PAIRING_NUMBER belum diisi.");
      return;
    }
    if (pairingRequested) return;
    if (sock?.authState?.creds?.registered) return;

    pairingRequested = true;
    const code = await sock.requestPairingCode(PAIRING_NUMBER);
    console.log("\n=== KODE TAUTAN WHATSAPP ===");
    console.log(code);
    console.log(`Masukkan kode ini di WhatsApp untuk nomor ${PAIRING_NUMBER}\n`);
    writeLog("pairing_code_requested", { pairingNumber: PAIRING_NUMBER, code });
  } catch (err) {
    pairingRequested = false;
    console.error("Gagal membuat pairing code:", err.message);
    writeLog("pairing_code_error", { error: err.message });
  }
}

async function connectBot() {
  ensureFiles();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ["Ubuntu", "Chrome", "120.0.0"],
    printQRInTerminal: !USE_PAIRING_CODE,
    generateHighQualityLinkPreview: true
  });

  sock.ev.on("creds.update", saveCreds);

  await maybeRequestPairingCode();

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr && !USE_PAIRING_CODE) {
      console.log("\n=== SCAN QR WHATSAPP ===");
      QRCode.generate(qr, { small: true });
      console.log("Scan QR di WhatsApp > Perangkat Tertaut\n");
    }

    if (connection === "open") {
      isReady = true;
      reconnecting = false;
      pairingRequested = false;
      writeLog("connection_open", {
        timezone: TIMEZONE,
        atTime: `${todayDate()} ${nowSeconds()} ${TZ_LABEL}`
      });
      console.log(`READY | ${todayDate()} ${nowSeconds()} ${TZ_LABEL} | ${TIMEZONE}`);
    }

    if (connection === "close") {
      isReady = false;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      writeLog("connection_close", { code: statusCode, reconnect: shouldReconnect });
      console.log("Connection closed. code:", statusCode);

      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        console.log("Reconnect 5 detik lagi...");
        setTimeout(() => {
          connectBot().catch(console.error);
        }, 5000);
      } else if (!shouldReconnect) {
        console.log("Session logout. Hapus auth_info lalu login ulang.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const message of messages) {
      try {
        if (!message.message) continue;
        if (!message.key.fromMe) continue;
        await handleCommand(message);
      } catch (err) {
        console.error("[UPSERT ERROR]", err);
        writeLog("upsert_error", { error: err.message });
      }
    }
  });
}

setInterval(async () => {
  try {
    if (!isReady) return;

    const config = loadConfig();
    if (!config.enabled) return;

    const currentTime = nowTime();
    const slot = config.slots[currentTime];

    if (slot && slot.last !== todayDate()) {
      try {
        await sendSlot(currentTime, "auto_scheduler");
        console.log(`[AUTO] Sent slot ${currentTime} ${TZ_LABEL}`);
      } catch (err) {
        console.log("[AUTO ERROR]", err.message);
        writeLog("auto_error", { slot: currentTime, error: err.message });
      }
    }
  } catch (err) {
    console.log("[SCHEDULER ERROR]", err.message);
    writeLog("scheduler_error", { error: err.message });
  }
}, 30000);

setInterval(() => {
  try {
    backupSession("auto");
  } catch (err) {
    console.log("[BACKUP ERROR]", err.message);
    writeLog("backup_error", { error: err.message });
  }
}, BACKUP_INTERVAL_MINUTES * 60 * 1000);

connectBot().catch((err) => {
  console.error("FATAL:", err);
  writeLog("fatal", { error: err.message });
  process.exit(1);
});
