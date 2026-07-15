import { executeCommand, validateCommand } from './commands';
import { nextRandom } from './random';
import type { City, ForceId, GameCommand, GameState, Officer } from './types';

function availableOfficers(state: GameState, forceId: ForceId, city: City) {
  return Object.values(state.officers).filter(
    (officer) => officer.forceId === forceId && officer.location.kind === 'city' && officer.location.cityId === city.id && !officer.acted,
  );
}

function bestOfficer(officers: Officer[], stat: keyof Officer['stats']) {
  return [...officers].sort((left, right) => right.stats[stat] - left.stats[stat])[0];
}

function commandIfLegal(state: GameState, forceId: ForceId, command: GameCommand | null) {
  return command && validateCommand(state, forceId, command).length === 0 ? command : null;
}

function cityCommand(
  state: GameState,
  forceId: ForceId,
  city: City,
  type: 'recruit' | 'train' | 'patrol' | 'talent',
  stat: keyof Officer['stats'],
) {
  const officer = bestOfficer(availableOfficers(state, forceId, city), stat);
  return officer ? commandIfLegal(state, forceId, { type, cityId: city.id, officerId: officer.id }) : null;
}

function developmentCommand(state: GameState, forceId: ForceId, city: City, focus: 'commerce' | 'agriculture') {
  const officer = bestOfficer(availableOfficers(state, forceId, city), 'politics');
  return officer
    ? commandIfLegal(state, forceId, { type: 'develop', cityId: city.id, officerId: officer.id, focus })
    : null;
}

interface AiDecision {
  command: GameCommand | null;
  cursor: number;
}

function chooseAiDecision(state: GameState, forceId: ForceId): AiDecision {
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  const selected = (command: GameCommand): AiDecision => ({ command, cursor: state.rngCursor });

  for (const city of [...cities].sort((a, b) => a.order - b.order)) {
    if (city.order < 60) {
      const command = cityCommand(state, forceId, city, 'patrol', 'charisma');
      if (command) return selected(command);
    }
  }
  for (const city of cities) {
    if (city.food < city.troops * 2) {
      const command = developmentCommand(state, forceId, city, 'agriculture');
      if (command) return selected(command);
    }
  }
  for (const city of cities) {
    if (city.gold < 3000) {
      const command = developmentCommand(state, forceId, city, 'commerce');
      if (command) return selected(command);
    }
  }
  for (const city of [...cities].sort((a, b) => a.training - b.training)) {
    if (city.training < 70 && city.troops > 0) {
      const command = cityCommand(state, forceId, city, 'train', 'leadership');
      if (command) return selected(command);
    }
  }
  for (const city of cities) {
    if (city.population > 10000 && city.gold >= 800 && city.food >= 500) {
      const command = cityCommand(state, forceId, city, 'recruit', 'charisma');
      if (command) return selected(command);
    }
  }
  for (const city of cities) {
    const hasTalent = Object.values(state.officers).some((officer) =>
      officer.forceId === null && officer.location.kind === 'unaffiliated' && officer.location.cityId === city.id,
    );
    if (hasTalent) {
      const command = cityCommand(state, forceId, city, 'talent', 'intelligence');
      if (command) return selected(command);
    }
  }

  const candidates: Array<{ command: GameCommand; weight: number }> = [];
  for (const city of cities) {
    for (const focus of ['commerce', 'agriculture'] as const) {
      const command = developmentCommand(state, forceId, city, focus);
      if (command) candidates.push({ command, weight: Math.max(1, 101 - city[focus]) });
    }
  }
  if (candidates.length === 0) return { command: null, cursor: state.rngCursor };

  const roll = nextRandom(state.seed, state.rngCursor);
  let target = roll.value * candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  for (const candidate of candidates) {
    target -= candidate.weight;
    if (target <= 0) return { command: candidate.command, cursor: roll.cursor };
  }
  return { command: candidates.at(-1)!.command, cursor: roll.cursor };
}

export function chooseAiCommand(state: GameState, forceId: ForceId): GameCommand | null {
  return chooseAiDecision(state, forceId).command;
}

export function runAiTurn(initial: GameState, forceId: ForceId): GameState {
  let state = initial;
  let guard = 0;
  while (state.actionPoints[forceId] >= 10 && guard < 12) {
    const decision = chooseAiDecision(state, forceId);
    if (!decision.command) break;
    if (decision.cursor !== state.rngCursor) state = { ...state, rngCursor: decision.cursor };
    state = executeCommand(state, forceId, decision.command);
    guard += 1;
  }
  return state;
}
