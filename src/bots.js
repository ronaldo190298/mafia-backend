import { v4 as uuidv4 } from 'uuid';
import { MAX_PLAYERS } from './constants.js';

const BOT_NAMES = [
  'Tony', 'Vito', 'Luca', 'Sofia', 'Marco', 'Giovanni', 'Isabella', 'Rosa',
  'Nico', 'Elena', 'Franco', 'Maria', 'Paolo', 'Adriana', 'Roman', 'Carmela',
];

const CHAT_LINES = {
  terrorist: [
    "I am telling you, the Doctor is too quiet.",
    "Why is everyone looking at me? I am just a villager.",
    "The Terrorist must be one of the silent ones.",
    "I saw {target} acting suspicious last night.",
  ],
  doctor: [
    "We need to stay calm and think this through.",
    "I think {target} is trustworthy, they helped the village.",
    "Be careful who you accuse without proof.",
    "Has anyone noticed {target} changing their story?",
  ],
  villager: [
    "I do not trust {target}.",
    "That vote felt too easy. What if {target} is innocent?",
    "I am watching {target} closely.",
    "We should vote as a team, not randomly.",
    "Last night was quiet... maybe the Doctor saved someone.",
  ],
};

export function unusedBotName(existing) {
  const used = new Set(existing.map((p) => p.name));
  return BOT_NAMES.find((n) => !used.has(n)) || `Bot ${uuidv4().slice(0, 4)}`;
}

export function createBots(count, existing) {
  const bots = [];
  for (let i = 0; i < count; i++) {
    const name = unusedBotName([...existing, ...bots]);
    bots.push({
      id: `bot-${uuidv4().slice(0, 8)}`,
      name,
      isBot: true,
      connected: true,
      ready: true,
      alive: true,
      role: null,
      isHost: false,
    });
  }
  return bots;
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function botChatLine(botRole, players, youId) {
  const targets = players.filter((p) => p.id !== youId && p.alive);
  const target = (targets.length ? randomPick(targets).name : 'someone').replace(/'/g, "''");
  const pool = CHAT_LINES[botRole] || CHAT_LINES.villager;
  const line = randomPick(pool);
  return line.replace(/{target}/g, target);
}

export function botKillChoice(players, terroristId) {
  const candidates = players.filter((p) => p.id !== terroristId && p.alive && !p.isBot);
  if (!candidates.length) return randomPick(players.filter((p) => p.id !== terroristId && p.alive))?.id || null;
  return randomPick(candidates).id;
}

export function botSaveChoice(players, doctorId) {
  const candidates = players.filter((p) => p.alive);
  if (Math.random() > 0.7) return doctorId;
  return randomPick(candidates).id;
}

export function botVoteChoice(players, botId) {
  const candidates = players.filter((p) => p.id !== botId && p.alive);
  if (!candidates.length) return null;
  const weights = candidates.map((p) => ({ p, w: p.isBot ? 0.3 : 1 }));
  const total = weights.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * total;
  for (const { p, w } of weights) {
    r -= w;
    if (r <= 0) return p.id;
  }
  return candidates[candidates.length - 1].id;
}
