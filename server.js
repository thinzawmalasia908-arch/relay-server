import { WebSocketServer } from 'ws';
import { createClient } from '@libsql/client';
import { createServer } from 'http';
import 'dotenv/config';

// ===== Turso Database Setup =====
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Database table ကို auto-create
async function initDB() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Database ready');
  } catch (e) {
    console.error('❌ DB init error:', e.message);
  }
}
initDB();

// ===== HTTP Server =====
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket relay server running!');
});

// ===== WebSocket Server =====
const wss = new WebSocketServer({ server });

let camSender = null;
let camViewer = null;
let scrSender = null;
let scrViewer = null;

wss.on('connection', (socket) => {
  console.log('🔌 Client connected');

  socket.on('message', async (data, isBinary) => {
    if (!isBinary) {
      const text = data.toString();

      if (text === 'camera_sender') {
        camSender = socket;
        console.log('📷 Camera sender registered');
        if (camViewer) camViewer.send('sender_online');
        await logSession('camera_sender', 'online');

      } else if (text === 'camera_viewer') {
        camViewer = socket;
        console.log('👁️ Camera viewer registered');
        if (camSender) {
          camSender.send('viewer_online');
          socket.send('sender_online');
        } else {
          socket.send('sender_offline');
        }

      } else if (text === 'screen_sender') {
        scrSender = socket;
        console.log('🖥️ Screen sender registered');
        if (scrViewer) scrViewer.send('sender_online');
        await logSession('screen_sender', 'online');

      } else if (text === 'screen_viewer') {
        scrViewer = socket;
        console.log('👁️ Screen viewer registered');
        if (scrSender) {
          scrSender.send('viewer_online');
          socket.send('sender_online');
        } else {
          socket.send('sender_offline');
        }

      } else if (text === 'ping') {
        socket.send('pong');
      }
      return;
    }

    const target = (socket === camSender) ? camViewer
                 : (socket === scrSender) ? scrViewer : null;

    if (target && target.readyState === 1) {
      target.send(data, { binary: true });
    }
  });

  socket.on('close', async () => {
    if (socket === camSender) {
      camSender = null;
      if (camViewer) camViewer.send('sender_offline');
      console.log('📷 Camera sender disconnected');
      await logSession('camera_sender', 'offline');
    }
    if (socket === camViewer) {
      camViewer = null;
      console.log('👁️ Camera viewer disconnected');
    }
    if (socket === scrSender) {
      scrSender = null;
      if (scrViewer) scrViewer.send('sender_offline');
      console.log('🖥️ Screen sender disconnected');
      await logSession('screen_sender', 'offline');
    }
    if (socket === scrViewer) {
      scrViewer = null;
      console.log('👁️ Screen viewer disconnected');
    }
  });

  socket.on('error', (e) => console.log('⚠️ WS error:', e.message));
});

async function logSession(channel, status) {
  try {
    await db.execute({
      sql: 'INSERT INTO sessions (channel, status) VALUES (?, ?)',
      args: [channel, status],
    });
  } catch (e) {
    console.error('DB log error:', e.message);
  }
}

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});