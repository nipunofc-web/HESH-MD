const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const NodeCache = require('node-cache');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  delay, 
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

// OpenRouter AI Setup
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: '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',
});

async function askAI(prompt) {
  try {
    const res = await openai.chat.completions.create({
      model: 'google/gemini-2.0-flash-exp:free',
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0].message.content;
  } catch (err) {
    console.error('AI Error:', err);
    return 'සමාවෙන්න, මට AI එකෙන් පිළිතුර ලබාගැනීමට නොහැකි විය.';
  }
}

// Web UI
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WHATSAPP AI BOT • PAIRING</title>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Space Grotesk', sans-serif; }
        body { background: radial-gradient(circle at top center, #0d1926 0%, #050811 100%); color: #e5e7eb; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .container { background: rgba(16, 24, 40, 0.75); backdrop-filter: blur(18px); border: 1px solid rgba(0, 255, 136, 0.2); border-radius: 20px; padding: 36px 28px; max-width: 440px; width: 100%; text-align: center; }
        .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; background: rgba(0, 255, 136, 0.1); border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 50px; font-size: 12px; color: #00ff88; font-weight: 600; margin-bottom: 16px; }
        .badge-dot { width: 8px; height: 8px; background: #00ff88; border-radius: 50%; animation: pulse 1.8s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
        h1 { font-size: 26px; color: #ffffff; margin-bottom: 6px; }
        .sub { color: #94a3b8; font-size: 13.5px; margin-bottom: 24px; }
        input { width: 100%; padding: 14px 16px; background: rgba(10, 15, 29, 0.8); border: 1px solid #1e293b; border-radius: 12px; color: #00ff88; font-size: 16px; font-family: 'JetBrains Mono', monospace; margin-bottom: 18px; outline: none;}
        button.btn-submit { width: 100%; padding: 15px; background: linear-gradient(135deg, #00ff88 0%, #00bd68 100%); color: #021a0f; font-weight: 700; border: none; border-radius: 12px; cursor: pointer; }
        .code-card { display: none; margin-top: 24px; padding: 20px; background: rgba(4, 8, 17, 0.9); border: 1px dashed rgba(0, 255, 136, 0.5); border-radius: 14px; }
        .pair-code { font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; color: #00ff88; letter-spacing: 8px; margin: 12px 0 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="badge"><div class="badge-dot"></div>AI System Online</div>
        <h1>WHATSAPP BOT</h1>
        <p class="sub">අංකය ඇතුළත් කර Pairing Code එක ලබාගන්න.</p>
        <input type="text" id="phone" placeholder="9470xxxxxxx" value="94705836838" />
        <button class="btn-submit" id="btn" onclick="getCode()">GENERATE PAIR CODE</button>
        <div class="code-card" id="codeCard">
          <span style="color: #94a3b8; font-size: 12px;">Your Pairing Code</span>
          <div class="pair-code" id="codeBox">----</div>
        </div>
      </div>
      <script>
        async function getCode() {
          const phone = document.getElementById('phone').value.replace(/[^0-9]/g, '');
          if (!phone) return alert('කරුණාකර දුරකථන අංකය ඇතුළත් කරන්න!');
          const btn = document.getElementById('btn');
          btn.innerText = 'GENERATING CODE...';
          btn.disabled = true;

          try {
            const res = await fetch('/pair?num=' + phone);
            const data = await res.json();
            if (data.code) {
              document.getElementById('codeBox').innerText = data.code;
              document.getElementById('codeCard').style.display = 'block';
            } else {
              alert(data.error || 'දෝෂයක් මතු විය!');
            }
          } catch(e) {
            alert('Server Error!');
          }
          btn.innerText = 'GENERATE PAIR CODE';
          btn.disabled = false;
        }
      </script>
    </body>
    </html>
  `);
});

let sock = null;

async function initWhatsApp(phoneNumber = null) {
  const sessionDir = path.join(__dirname, 'session_auth');

  // Clear previous session if requesting a new pairing code
  if (phoneNumber) {
    if (sock) {
      sock.ev.removeAllListeners();
      if (sock.ws) sock.ws.close();
      sock = null;
    }
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const msgRetryCounterCache = new NodeCache();

  // Setup logging
  const logger = pino({ level: 'silent' });

  // Use makeCacheableSignalKeyStore for session stability
  const auth = {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger),
  };

  sock = makeWASocket({
    version,
    auth,
    logger,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        initWhatsApp();
      } else {
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp Bot Connected Successfully!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (text && text.startsWith('.ai ')) {
      const query = text.replace('.ai ', '').trim();
      const reply = await askAI(query);
      await sock.sendMessage(sender, { text: reply }, { quoted: msg });
    }
  });

  if (phoneNumber && !sock.authState.creds.registered) {
    await delay(2000); 
    const code = await sock.requestPairingCode(phoneNumber);
    return code?.match(/.{1,4}/g)?.join("-") || code; 
  }
}

app.get('/pair', async (req, res) => {
  const num = req.query.num;
  if (!num) return res.status(400).json({ error: 'Number required' });
  try {
    const code = await initWhatsApp(num);
    return res.json({ code });
  } catch (err) {
    console.error('Pairing Error:', err);
    return res.status(500).json({ error: 'Failed to generate code' });
  }
});

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  if (fs.existsSync(path.join(__dirname, 'session_auth', 'creds.json'))) {
    initWhatsApp();
  }
});
