import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const app = express();
const server = createServer(app);

app.use(express.json());
app.use(express.static(__dirname));

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { id: roomId, createdAt: Date.now() });
  }
  return rooms.get(roomId);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/rooms/create', (_req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  getRoom(roomId);
  res.json({ roomId });
});

app.get('/api/realtime/token', async (_req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server' });
    }

    const sessionConfig = {
      session: {
        type: 'realtime',
        model: 'gpt-realtime',
        output_modalities: ['audio', 'text'],
        instructions: [
          'You are a strict live interpreter.',
          'Input language is Russian.',
          'Output language is English.',
          'Do not answer as an assistant.',
          'Do not explain or add commentary.',
          'Translate the speaker faithfully and naturally.',
          'If the phrase is incomplete, wait briefly for completion.',
          'If audio is unclear, ask briefly in English to repeat.'
        ].join(' '),
        audio: {
          input: {
            turn_detection: {
              type: 'server_vad',
              create_response: true,
              interrupt_response: true,
              silence_duration_ms: 650,
              prefix_padding_ms: 300
            },
            transcription: {
              model: 'gpt-4o-mini-transcribe',
              language: 'ru'
            }
          },
          output: {
            voice: 'marin'
          }
        }
      }
    };

    const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sessionConfig)
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: 'Failed to mint realtime token', details: text });
    }

    const data = await r.json();
    const value = data?.client_secret?.value ?? data?.value;
    if (!value) {
      return res.status(500).json({ error: 'Realtime token response did not include a usable client secret', details: data });
    }

    res.json({ value, raw: data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unexpected token generation error' });
  }
});

const wss = new WebSocketServer({ server, path: '/ws/rooms' });
const clientsByRoom = new Map();

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function roomMap(roomId) {
  if (!clientsByRoom.has(roomId)) clientsByRoom.set(roomId, new Map());
  return clientsByRoom.get(roomId);
}

function broadcast(roomId, payload, excludeClientId = null) {
  const room = clientsByRoom.get(roomId);
  if (!room) return;
  for (const [id, client] of room.entries()) {
    if (excludeClientId && id === excludeClientId) continue;
    send(client.ws, payload);
  }
}

function removeClient(roomId, clientId) {
  const room = clientsByRoom.get(roomId);
  if (!room) return;
  if (room.delete(clientId)) {
    broadcast(roomId, { type: 'peer-left', roomId, clientId }, clientId);
  }
  if (room.size === 0) {
    clientsByRoom.delete(roomId);
  }
}

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let currentClientId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'join') {
        const { roomId, clientId, role } = msg;
        currentRoomId = roomId;
        currentClientId = clientId;
        getRoom(roomId);

        const room = roomMap(roomId);
        room.set(clientId, { ws, clientId, roomId, role });

        const peers = Array.from(room.values())
          .filter((x) => x.clientId !== clientId)
          .map((x) => ({ clientId: x.clientId, role: x.role }));

        send(ws, {
          type: 'joined',
          roomId,
          selfId: clientId,
          role,
          peers
        });

        broadcast(roomId, {
          type: 'peer-joined',
          roomId,
          peer: { clientId, role }
        }, clientId);

        return;
      }

      if (msg.type === 'signal') {
        const room = clientsByRoom.get(msg.roomId);
        if (!room) return;
        const target = room.get(msg.to);
        if (!target) return;
        send(target.ws, {
          type: 'signal',
          roomId: msg.roomId,
          from: msg.from,
          to: msg.to,
          signal: msg.signal
        });
        return;
      }

      if (msg.type === 'leave') {
        removeClient(msg.roomId, msg.clientId);
      }
    } catch (error) {
      send(ws, { type: 'error', message: 'Invalid websocket payload' });
    }
  });

  ws.on('close', () => {
    if (currentRoomId && currentClientId) {
      removeClient(currentRoomId, currentClientId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Voice Translation MVP listening on http://localhost:${PORT}`);
});
