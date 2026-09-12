const express = require('express');
const pino = require('pino');
const mongoose = require('mongoose');
const OpenAI = require('openai');
const NodeCache = require('node-cache');
const { 
  default: makeWASocket, 
  DisconnectReason, 
  delay, 
  Browsers,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const { useMongoDBAuthState, Auth } = require('./auth');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

// ඔබගේ MongoDB ලින්ක් එක
const MONGODB_URI = 'mongodb+srv://kethmi12345_db_user:nipun1234@cluster0.3fhoect.mongodb.net/';

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
    return 'සමාවෙන්න, මට AI එකෙන් පිළිතුර ලබාගැනීමට නොහැකි විය.';
  }
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WHATSAPP AI BOT</title>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Space Grotesk', sans-serif; }
        body { background: #050811; color: #e5e7eb; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .container { background: rgba(16, 24, 40, 0.9); border: 1px solid rgba(0, 255, 136, 0.2); border-radius: 20px; padding: 36px 28px; max-width: 400px; width: 100%; text-align: center; }
        h1 { font-size: 24px; color: #fff; margin-bottom: 20px; }
        input { width: 100%; padding: 14px; background: #0a0f1d; border: 1px solid #1e293b; border-radius: 12px; color: #00ff88; font-size: 16px; margin-bottom: 18px; outline: none; text-align: center;}
        button { width: 100%; padding: 15px; background: #00ff88; color: #000; font-weight: 700; border: none; border-radius: 12px; cursor: pointer; }
        .pair-code { font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 700; color: #00ff88; letter-spacing: 6px; margin-top: 20px; display: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>WHATSAPP BOT</h1>
        <input type="text" id="phone" placeholder="9470xxxxxxx" />
        <button id="btn" onclick="getCode()">GENERATE CODE</button>
        <div class="pair-code" id="codeBox"></div>
      </div>
      <script>
        async function getCode() {
          const phone = document.getElementById('phone').value.replace(/[^0-9]/g, '');
          if (!phone) return alert('Enter Number!');
          const btn = document.getElementById('btn');
          btn.innerText = 'GENERATING...';
          btn.disabled = true;
          try {
            const res = await fetch('/pair?num=' + phone);
            const data = await res.json();
            if (data.code) {
              document.getElementById('codeBox').innerText = data.code;
              document.getElementById('codeBox').style.display = 'block';
            } else { alert(data.error || 'Error!'); }
          } catch(e) { alert('Server Error!'); }
          btn.innerText = 'GENERATE CODE';
          btn.disabled = false;
        }
      </script>
    </body>
    </html>
  `);
});

let activeSessions = {};

async function initWhatsApp(phoneNumber) {
  if (activeSessions[phoneNumber]) return activeSessions[phoneNumber];

  const { state, saveCreds, clearSessionData } = await useMongoDBAuthState(phoneNumber);
  const msgRetryCounterCache = new NodeCache();
  const logger = pino({ level: 'silent' });

  const auth = {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger),
  };

  const sock = makeWASocket({
    version: [2, 3000, 1015901307],
    auth,
    logger,
    printQRInTerminal: false,
    browser: Browsers.windows('Desktop'),
    msgRetryCounterCache,
    syncFullHistory: false
  });

  activeSessions[phoneNumber] = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      delete activeSessions[phoneNumber];
      if (statusCode !== DisconnectReason.loggedOut && statusCode !== 401 && statusCode !== 403) {
        setTimeout(() => initWhatsApp(phoneNumber), 5000);
      } else {
        if (typeof clearSessionData === 'function') await clearSessionData();
      }
    } else if (connection === 'open') {
      console.log(`✅ HESH-MD AI Connected for: ${phoneNumber}`);
      
      // ලින්ක් වූ වහාම ඔබේ අංකයටම මැසේජ් එකක් යැවීම
      try {
        const botJid = `${phoneNumber}@s.whatsapp.net`;
        const connectedMsg = `*✅ HESH-MD BOT CONNECTED!*\n\nඔබගේ බොට් සාර්ථකව සක්‍රිය විය. වැඩදැයි පරීක්ෂා කිරීමට *.alive* ලෙස යවන්න.`;
        await sock.sendMessage(botJid, { text: connectedMsg });
      } catch (err) {
        console.error('Welcome message error:', err);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!text) return;

    // .alive කමාන්ඩ් එක
    if (text.toLowerCase() === '.alive') {
      const aliveMsg = `*👋 HESH-MD BOT IS ALIVE!* 🚀\n\n✅ System is fully operational.\n✅ Session is securely saved in MongoDB.`;
      await sock.sendMessage(sender, { text: aliveMsg }, { quoted: msg });
    } 
    // .ai කමාන්ඩ් එක
    else if (text.toLowerCase().startsWith('.ai ')) {
      const query = text.replace(/.ai /i, '').trim();
      const reply = await askAI(query);
      await sock.sendMessage(sender, { text: reply }, { quoted: msg });
    }
  });

  return sock;
}

app.get('/pair', async (req, res) => {
  let num = req.query.num;
  if (!num) return res.status(400).json({ error: 'Number required' });
  
  try {
    if (activeSessions[num]) {
        try { activeSessions[num].ws?.close(); } catch(e) {}
        delete activeSessions[num];
    }
    
    await Auth.deleteMany({ _id: new RegExp(`^${num}-`) });

    const sock = await initWhatsApp(num);

    if (!sock.authState.creds.registered) {
      await delay(2000);
      const codePromise = sock.requestPairingCode(num);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000));
      
      const code = await Promise.race([codePromise, timeoutPromise]);
      const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
      
      return res.json({ code: formattedCode });
    } else {
        return res.status(400).json({ error: 'Already Linked!' });
    }
  } catch (err) {
    console.error('Pairing Error:', err);
    return res.status(500).json({ error: 'Rate Limited! Please try again later.' });
  }
});

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('🍃 MongoDB Connected Successfully!');
    app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
    
    const sessions = await Auth.find({ _id: /-creds$/ });
    console.log(`🔄 Found ${sessions.length} saved sessions.`);
    for (const session of sessions) {
        const number = session._id.split('-creds')[0];
        initWhatsApp(number);
        await delay(3000);
    }
  })
  .catch(err => console.log('MongoDB Connection Error:', err));
