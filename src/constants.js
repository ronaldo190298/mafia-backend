export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 4;

export const ROLES = {
  VILLAGER: 'villager',
  TERRORIST: 'terrorist',
  DOCTOR: 'doctor',
};

export const PHASES = {
  LOBBY: 'lobby',
  ROLE_REVEAL: 'role-reveal',
  NIGHT_TERRORIST: 'night-terrorist',
  NIGHT_DOCTOR: 'night-doctor',
  NIGHT_OUTCOME: 'night-outcome',
  DAY_DISCUSSION: 'day-discussion',
  VOTING: 'voting',
  VOTE_RESULT: 'vote-result',
  GAME_OVER: 'game-over',
};

export const DURATIONS = {
  [PHASES.NIGHT_TERRORIST]: 20000,
  [PHASES.NIGHT_DOCTOR]: 15000,
  [PHASES.NIGHT_OUTCOME]: 6000,
  [PHASES.DAY_DISCUSSION]: 60000,
  [PHASES.VOTING]: 30000,
  [PHASES.VOTE_RESULT]: 8000,
  [PHASES.ROLE_REVEAL]: 5000,
};
