import { v4 as uuidv4 } from 'uuid';
import {
  createBots,
  botChatLine,
  botKillChoice,
  botSaveChoice,
  botVoteChoice,
} from './bots.js';
import { DURATIONS, MAX_PLAYERS, MIN_PLAYERS, PHASES, ROLES } from './constants.js';

const rooms = new Map();
let io;

export function attachIo(ioInstance) {
  io = ioInstance;
}

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function getRoom(roomId) {
  return rooms.get(roomId?.toUpperCase?.());
}

export function roomStats() {
  let totalPlayers = 0;
  for (const r of rooms.values()) totalPlayers += r.players.length;
  return { rooms: rooms.size, players: totalPlayers };
}

export function createRoom(socket, name) {
  let id;
  do {
    id = generateRoomId();
  } while (rooms.has(id));
  const room = {
    id,
    hostId: socket.id,
    started: false,
    phase: PHASES.LOBBY,
    players: [],
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    messages: [],
    dayNumber: 0,
    nightAction: { kill: null, save: null, killChosen: null, saveChosen: null },
    votes: {},
    voteTally: [],
    lastResult: null,
    winner: null,
    announcement: null,
    phaseEndsAt: null,
    timers: [],
    typing: [],
  };
  addPlayer(room, socket, name, true);
  rooms.set(id, room);
  socket.join(id);
  return room;
}

export function joinRoom(socket, roomId, name) {
  const room = getRoom(roomId);
  if (!room) return { error: 'Room not found.' };
  if (room.started) return { error: 'Game already started.' };
  if (room.players.length >= room.maxPlayers) return { error: 'Room is full.' };
  const already = room.players.find((p) => p.id === socket.id);
  if (already) return { room };
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return { error: 'That name is already taken in this room.' };
  }
  addPlayer(room, socket, name, false);
  socket.join(room.id);
  broadcast(room);
  return { room };
}

function addPlayer(room, socket, name, isHost) {
  room.players.push({
    id: socket.id,
    name: name.slice(0, 16),
    isHost,
    isBot: false,
    connected: true,
    ready: false,
    alive: true,
    role: null,
    hasVoted: false,
    socket,
  });
  addSystemMessage(room, `${name} joined the room.`);
}

export function addBots(room, count) {
  if (room.started) return 0;
  const add = Math.min(count, room.maxPlayers - room.players.length);
  const bots = createBots(add, room.players);
  for (const bot of bots) {
    room.players.push(bot);
    bot.socket = null;
    addSystemMessage(room, `${bot.name} (bot) joined.`);
  }
  broadcast(room);
  return add;
}

export function removeBots(room) {
  if (room.started) return;
  room.players = room.players.filter((p) => !p.isBot);
  broadcast(room);
}

export function setReady(room, playerId, ready) {
  const p = room.players.find((x) => x.id === playerId);
  if (p && !p.isBot) {
    p.ready = ready;
    broadcast(room);
  }
}

export function leaveRoom(socket) {
  for (const room of rooms.values()) {
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) continue;
    const p = room.players[idx];
    addSystemMessage(room, `${p.name} left.`);
    const wasHost = p.isHost && !p.isBot;
    if (wasHost) {
      const nextHuman = room.players.find((x) => !x.isBot && x.id !== p.id);
      if (nextHuman) {
        room.hostId = nextHuman.id;
        nextHuman.isHost = true;
      }
    }
    room.players.splice(idx, 1);
    if (room.players.length === 0) {
      clearTimers(room);
      rooms.delete(room.id);
    } else if (room.started && wasHost) {
      resetToLobby(room);
    } else {
      broadcast(room);
    }
  }
}

export function startGame(room) {
  if (room.started) return { error: 'Game already started.' };
  if (room.players.length < room.minPlayers) return { error: `Need at least ${room.minPlayers} players.` };
  const humans = room.players.filter((p) => !p.isBot);
  if (humans.some((p) => !p.isHost && !p.ready)) return { error: 'Not everyone is ready.' };
  room.started = true;
  assignRoles(room.players);
  beginNight(room);
  broadcast(room);
  return { ok: true };
}

function assignRoles(players) {
  const roles = new Array(players.length).fill(ROLES.VILLAGER);
  roles[0] = ROLES.TERRORIST;
  roles[1] = ROLES.DOCTOR;
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  players.forEach((p, i) => (p.role = roles[i]));
}

function beginNight(room) {
  room.dayNumber = 1;
  room.announcement = 'Night falls. The Terrorist awakens.';
  setPhase(room, PHASES.NIGHT_TERRORIST);
  room.nightAction = { kill: null, save: null, killChosen: null, saveChosen: null };
  scheduleBotAction(room, PHASES.NIGHT_TERRORIST);
  schedulePhaseEnd(room, () => beginDoctor(room));
}

function beginDoctor(room) {
  room.announcement = 'The Doctor decides who to save.';
  setPhase(room, PHASES.NIGHT_DOCTOR);
  scheduleBotAction(room, PHASES.NIGHT_DOCTOR);
  schedulePhaseEnd(room, () => resolveNight(room));
}

function resolveNight(room) {
  const { kill, save } = room.nightAction;
  const killed = kill && kill !== save ? room.players.find((p) => p.id === kill) : null;
  if (killed) {
    killed.alive = false;
    room.announcement = `A body was found. ${killed.name} was killed in the night.`;
    addSystemMessage(room, `☠️ ${killed.name} was eliminated at night.`);
  } else {
    room.announcement = 'The night passed peacefully. Nobody died.';
    addSystemMessage(room, '🌙 Nobody died tonight.');
  }
  setPhase(room, PHASES.NIGHT_OUTCOME);
  if (checkEnd(room)) return;
  schedulePhaseEnd(room, () => beginDay(room));
}

function beginDay(room) {
  room.announcement = 'The sun rises. Discuss who you suspect.';
  setPhase(room, PHASES.DAY_DISCUSSION);
  room.votes = {};
  room.voteTally = [];
  room.players.forEach((p) => (p.hasVoted = false));
  scheduleBotChat(room);
  schedulePhaseEnd(room, () => beginVoting(room));
}

function beginVoting(room) {
  room.announcement = 'Time to vote. Choose who to eliminate.';
  setPhase(room, PHASES.VOTING);
  scheduleBotVote(room);
  schedulePhaseEnd(room, () => resolveVote(room));
}

function resolveVote(room) {
  const tally = {};
  for (const id of Object.values(room.votes)) {
    tally[id] = (tally[id] || 0) + 1;
  }
  const entries = Object.entries(tally)
    .map(([id, count]) => ({ id, name: room.players.find((p) => p.id === id)?.name || '?', count }))
    .sort((a, b) => b.count - a.count);
  room.voteTally = entries;
  const top = entries[0];
  if (top && top.count > 0) {
    const eliminated = room.players.find((p) => p.id === top.id);
    if (eliminated) {
      eliminated.alive = false;
      room.lastResult = { text: `${eliminated.name} was voted out. They were a ${eliminated.role}.` };
      addSystemMessage(room, `🗳️ ${eliminated.name} was voted out (${eliminated.role}).`);
    }
  } else {
    room.lastResult = { text: 'No votes were cast. Nobody is eliminated.' };
  }
  setPhase(room, PHASES.VOTE_RESULT);
  if (checkEnd(room)) return;
  schedulePhaseEnd(room, () => beginNight(room));
}

function checkEnd(room) {
  const alive = room.players.filter((p) => p.alive);
  const terrorist = alive.find((p) => p.role === ROLES.TERRORIST);
  if (!terrorist) {
    room.winner = { side: 'villagers', text: 'The Terrorist is dead. The village wins!' };
    setPhase(room, PHASES.GAME_OVER);
    clearTimers(room);
    broadcast(room);
    return true;
  }
  if (alive.length <= 3) {
    room.winner = { side: 'terrorist', text: 'The Terrorist outlasted the village.' };
    setPhase(room, PHASES.GAME_OVER);
    clearTimers(room);
    broadcast(room);
    return true;
  }
  return false;
}

export function submitKill(room, terroristId, targetId) {
  const terrorist = room.players.find((p) => p.id === terroristId);
  if (!terrorist || terrorist.role !== ROLES.TERRORIST || !terrorist.alive) return { error: 'Not authorized.' };
  if (room.phase !== PHASES.NIGHT_TERRORIST) return { error: 'Wrong phase.' };
  room.nightAction.kill = targetId;
  room.nightAction.killChosen = targetId;
  broadcast(room);
  return { ok: true };
}

export function submitSave(room, doctorId, targetId) {
  const doctor = room.players.find((p) => p.id === doctorId);
  if (!doctor || doctor.role !== ROLES.DOCTOR || !doctor.alive) return { error: 'Not authorized.' };
  if (room.phase !== PHASES.NIGHT_DOCTOR) return { error: 'Wrong phase.' };
  room.nightAction.save = targetId;
  room.nightAction.saveChosen = targetId;
  broadcast(room);
  return { ok: true };
}

export function castVote(room, voterId, targetId) {
  const voter = room.players.find((p) => p.id === voterId);
  if (!voter || !voter.alive) return { error: 'You cannot vote.' };
  if (room.phase !== PHASES.VOTING) return { error: 'Not voting phase.' };
  const target = room.players.find((p) => p.id === targetId);
  if (!target || !target.alive || target.id === voterId) return { error: 'Invalid vote.' };
  room.votes[voterId] = targetId;
  voter.hasVoted = true;
  broadcast(room);
  if (room.players.filter((p) => !p.isBot && p.alive).every((p) => room.votes[p.id])) {
    clearTimers(room);
    resolveVote(room);
  }
  return { ok: true };
}

export function chat(room, playerId, text, channel = 'public') {
  const p = room.players.find((x) => x.id === playerId);
  if (!p || !p.alive) return { error: 'You cannot chat.' };
  if ((room.phase === PHASES.NIGHT_TERRORIST || room.phase === PHASES.NIGHT_DOCTOR) && !p.isBot) {
    if (channel !== 'mafia' || p.role !== ROLES.TERRORIST) return { error: 'No talking at night.' };
  }
  const clean = String(text).trim().slice(0, 300);
  if (!clean) return { error: 'Message is empty.' };
  room.messages.push({
    id: uuidv4(),
    channel,
    author: p.name,
    authorId: p.id,
    text: clean,
    system: false,
    timestamp: Date.now(),
  });
  broadcast(room);
  return { ok: true };
}

export function setTyping(room, playerId, isTyping) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return;
  if (isTyping) {
    if (!room.typing.includes(p.name)) room.typing.push(p.name);
  } else {
    room.typing = room.typing.filter((n) => n !== p.name);
  }
  broadcast(room);
}

export function resetToLobby(room) {
  clearTimers(room);
  room.started = false;
  room.phase = PHASES.LOBBY;
  room.players.forEach((p) => {
    p.alive = true;
    p.role = null;
    p.ready = false;
    p.hasVoted = false;
  });
  room.messages = [];
  room.dayNumber = 0;
  room.nightAction = { kill: null, save: null, killChosen: null, saveChosen: null };
  room.votes = {};
  room.voteTally = [];
  room.lastResult = null;
  room.winner = null;
  room.announcement = null;
  room.typing = [];
  broadcast(room);
}

function setPhase(room, phase) {
  room.phase = phase;
  room.phaseEndsAt = Date.now() + (DURATIONS[phase] || 5000);
}

function schedulePhaseEnd(room, cb) {
  const duration = Math.max(1000, (DURATIONS[room.phase] || 5000));
  const t = setTimeout(cb, duration);
  room.timers.push(t);
}

function schedule(room, cb, ms) {
  const t = setTimeout(cb, ms);
  room.timers.push(t);
}

function clearTimers(room) {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
}

function scheduleBotAction(room, phase) {
  const delay = 2000 + Math.random() * 3000;
  setTimeout(() => {
    if (phase === PHASES.NIGHT_TERRORIST) {
      const t = room.players.find((p) => p.role === ROLES.TERRORIST && p.isBot && p.alive);
      if (t && !room.nightAction.kill) {
        const target = botKillChoice(room.players, t.id);
        if (target) {
          room.nightAction.kill = target;
          room.nightAction.killChosen = target;
          broadcast(room);
        }
      }
    }
    if (phase === PHASES.NIGHT_DOCTOR) {
      const d = room.players.find((p) => p.role === ROLES.DOCTOR && p.isBot && p.alive);
      if (d && !room.nightAction.save) {
        const target = botSaveChoice(room.players, d.id);
        if (target) {
          room.nightAction.save = target;
          room.nightAction.saveChosen = target;
          broadcast(room);
        }
      }
    }
  }, delay);
}

function scheduleBotChat(room) {
  const delay = 3000 + Math.random() * 5000;
  setTimeout(() => {
    if (room.phase !== PHASES.DAY_DISCUSSION) return;
    const bot = room.players.find((p) => p.isBot && p.alive);
    if (bot) {
      const text = botChatLine(bot.role || 'villager', room.players, bot.id);
      room.messages.push({
        id: uuidv4(),
        channel: 'public',
        author: bot.name,
        authorId: bot.id,
        text,
        system: false,
        timestamp: Date.now(),
      });
      broadcast(room);
    }
  }, delay);
}

function scheduleBotVote(room) {
  const delay = 2000 + Math.random() * 5000;
  setTimeout(() => {
    if (room.phase !== PHASES.VOTING) return;
    for (const bot of room.players) {
      if (!bot.isBot || !bot.alive || room.votes[bot.id]) continue;
      const target = botVoteChoice(room.players, bot.id);
      if (target) {
        room.votes[bot.id] = target;
        bot.hasVoted = true;
      }
    }
    broadcast(room);
  }, delay);
}

function addSystemMessage(room, text) {
  room.messages.push({
    id: uuidv4(),
    channel: 'public',
    author: 'System',
    authorId: null,
    text,
    system: true,
    timestamp: Date.now(),
  });
}

export function broadcast(room) {
  for (const p of room.players) {
    const socket = p.socket;
    if (socket && socket.connected) {
      socket.emit('room:state', { ...publicState(room, p.id), you: personalState(room, p.id) });
    }
  }
}

export function sendState(socket, room) {
  const p = room.players.find((x) => x.id === socket.id);
  socket.emit('room:state', { ...publicState(room, p?.id), you: personalState(room, p?.id) });
}

function publicState(room, playerId) {
  return {
    roomId: room.id,
    phase: room.phase,
    started: room.started,
    dayNumber: room.dayNumber,
    announcement: room.announcement,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isBot: p.isBot,
      connected: p.connected,
      ready: p.ready,
      alive: p.alive,
      role: publicRole(p, room.winner !== null),
      hasVoted: p.hasVoted,
    })),
    messages: room.messages,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    voteTally: room.voteTally,
    lastResult: room.lastResult,
    winner: room.winner,
    phaseEndsAt: room.phaseEndsAt,
    typing: room.typing,
    nightAction: {
      killChosen: room.nightAction.killChosen,
      saveChosen: room.nightAction.saveChosen,
    },
    myVote: room.votes[playerId] || null,
  };
}

function personalState(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    isBot: p.isBot,
    role: p.role,
    alive: p.alive,
    myVote: room.votes[p.id] || null,
  };
}

function publicRole(p, revealAll = false) {
  if (!p.alive || revealAll) return p.role;
  return null;
}
