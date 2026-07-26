import http from 'node:http';
import os from 'node:os';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  addBots,
  attachIo,
  broadcast,
  castVote,
  chat,
  createRoom,
  getRoom,
  joinRoom,
  disconnectPlayer,
  leaveRoom,
  removeBots,
  resetToLobby,
  roomStats,
  sendState,
  setReady,
  setTyping,
  startGame,
  submitKill,
  submitSave,
} from './game.js';

const PORT = process.env.PORT || 4000;
const ORIGINS = new Set(
  (process.env.CLIENT_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const ALLOW_ALL = ORIGINS.has('*');
const corsCheck = (origin, cb) => {
  if (ALLOW_ALL || !origin || ORIGINS.has(origin)) return cb(null, true);
  return cb(new Error(`CORS origin not allowed: ${origin}`), false);
};

const app = express();
app.use(cors({ origin: ALLOW_ALL ? '*' : [...ORIGINS], credentials: false }));
app.get('/health', (_req, res) => res.json({ ok: true, ...roomStats() }));
app.get('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  return res.json({ id: room.id, players: room.players.length, started: room.started });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOW_ALL ? '*' : corsCheck, methods: ['GET', 'POST'] } });
attachIo(io);

const cleanName = (name) => String(name || '').trim().slice(0, 16);

io.on('connection', (socket) => {
  const withRoom = (roomId, cb) => (payload, ack) => {
    const room = getRoom(roomId ?? payload?.roomId);
    if (!room) return ack?.({ error: 'Room not found.' });
    return cb(room, payload || {}, ack);
  };

  socket.on('room:create', ({ name } = {}, ack) => {
    const playerName = cleanName(name);
    if (!playerName) return ack?.({ error: 'Enter a player name.' });
    const room = createRoom(socket, playerName);
    ack?.({ roomId: room.id });
    sendState(socket, room);
  });

  socket.on('room:join', ({ name, roomId } = {}, ack) => {
    const playerName = cleanName(name);
    if (!playerName) return ack?.({ error: 'Enter a player name.' });
    const { room, error } = joinRoom(socket, roomId, playerName);
    if (error) return ack?.({ error });
    ack?.({ roomId: room.id });
    broadcast(room);
  });

  socket.on('room:sync', ({ roomId } = {}, ack) => {
    const room = getRoom(roomId);
    if (!room) return ack?.({ error: 'Room not found.' });
    if (!room.players.some((p) => p.id === socket.id)) {
      return ack?.({ error: 'You are not in this room.' });
    }
    socket.join(room.id);
    sendState(socket, room);
    return ack?.({ ok: true });
  });

  socket.on('lobby:addBots', withRoom(null, (room, { count }, ack) => {
    if (room.hostId !== socket.id) return ack?.({ error: 'Only the host can do that.' });
    if (room.started) return ack?.({ error: 'Game already started.' });
    const added = addBots(room, count);
    broadcast(room);
    return ack?.({ ok: true, added });
  }));

  socket.on('lobby:removeBots', withRoom(null, (room, _p, ack) => {
    if (room.hostId !== socket.id) return ack?.({ error: 'Only the host can do that.' });
    if (room.started) return ack?.({ error: 'Game already started.' });
    removeBots(room);
    broadcast(room);
    return ack?.({ ok: true });
  }));

  socket.on('lobby:ready', withRoom(null, (room, { ready }, ack) => {
    setReady(room, socket.id, ready);
    return ack?.({ ok: true });
  }));

  socket.on('game:start', withRoom(null, (room, _p, ack) => {
    if (room.hostId !== socket.id) return ack?.({ error: 'Only the host can start the game.' });
    const res = startGame(room);
    return ack?.(res);
  }));

  socket.on('game:restart', withRoom(null, (room, _p, ack) => {
    if (room.hostId !== socket.id) return ack?.({ error: 'Only the host can do that.' });
    resetToLobby(room);
    return ack?.({ ok: true });
  }));

  socket.on('night:kill', withRoom(null, (room, { targetId }, ack) => ack?.(submitKill(room, socket.id, targetId))));
  socket.on('night:save', withRoom(null, (room, { targetId }, ack) => ack?.(submitSave(room, socket.id, targetId))));
  socket.on('vote:cast', withRoom(null, (room, { targetId }, ack) => ack?.(castVote(room, socket.id, targetId))));
  socket.on('chat:send', withRoom(null, (room, { text, channel }, ack) => ack?.(chat(room, socket.id, text, channel))));
  socket.on('chat:typing', withRoom(null, (room, { isTyping }) => setTyping(room, socket.id, isTyping)));

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => disconnectPlayer(socket));
});

function localIps() {
  const list = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('127.')) {
        list.push(n.address);
      }
    }
  }
  return list;
}

server.listen(PORT, () => {
  console.log(`[mafia] server listening on http://localhost:${PORT}`);
  const ips = localIps();
  if (ips.length) {
    console.log(`[mafia] reachable on the same network at: ${ips.map((ip) => `http://${ip}:${PORT}`).join(', ')}`);
  }
});
