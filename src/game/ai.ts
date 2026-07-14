import { executeCommand, validateCommand } from './commands';
import type { City, ForceId, GameCommand, GameState, Officer } from './types';

function availableOfficers(state: GameState, forceId: ForceId, city: City) {
  return Object.values(state.officers).filter(
    (officer) => officer.forceId === forceId && officer.cityId === city.id && !officer.acted,
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

export function chooseAiCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);

  for (const city of [...cities].sort((a, b) => a.order - b.order)) {
    if (city.order < 60) {
      const command = cityCommand(state, forceId, city, 'patrol', 'charisma');
      if (command) return command;
    }
  }
  for (const city of cities) {
    if (city.food < city.troops * 2) {
      const command = developmentCommand(state, forceId, city, 'agriculture');
      if (command) return command;
    }
  }
  for (const city of cities) {
    if (city.gold < 3000) {
      const command = developmentCommand(state, forceId, city, 'commerce');
      if (command) return command;
    }
  }
  for (const city of [...cities].sort((a, b) => a.training - b.training)) {
    if (city.training < 70 && city.troops > 0) {
      const command = cityCommand(state, forceId, city, 'train', 'leadership');
      if (command) return command;
    }
  }
  for (const city of cities) {
    if (city.population > 10000 && city.gold >= 800 && city.food >= 500) {
      const command = cityCommand(state, forceId, city, 'recruit', 'charisma');
      if (command) return command;
    }
  }
  for (const city of cities) {
    const hasTalent = Object.values(state.officers).some((officer) => officer.forceId === null && officer.cityId === city.id);
    if (hasTalent) {
      const command = cityCommand(state, forceId, city, 'talent', 'intelligence');
      if (command) return command;
    }
  }
  for (const city of [...cities].sort((a, b) => a.commerce + a.agriculture - (b.commerce + b.agriculture))) {
    const focus = city.commerce <= city.agriculture ? 'commerce' : 'agriculture';
    const command = developmentCommand(state, forceId, city, focus);
    if (command) return command;
  }
  return null;
}

export function runAiTurn(initial: GameState, forceId: ForceId): GameState {
  let state = initial;
  let guard = 0;
  while (state.actionPoints[forceId] >= 10 && guard < 12) {
    const command = chooseAiCommand(state, forceId);
    if (!command) break;
    state = executeCommand(state, forceId, command);
    guard += 1;
  }
  return state;
}
