import { executeCommand, validateCommand } from './commands';
import { dispatchTerritoryDefenseForForce } from './battle/actions';
import { TECH_BRANCHES, TECH_COSTS, MAX_TECH_LEVEL, techLevelOf } from './techs';
import { ABILITY_NODES, ABILITY_NODE_MAP, ABILITY_RESEARCH_GOLD, abilityNodeStatus, canCultivateOfficer } from './abilityResearch';
import { EXPLORE_AP_PER_OFFICER, EXPLORE_GOLD_PER_OFFICER, treasureDefinition } from './treasures';
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

// AI科技研究：有富余金钱与技巧P时，把已开工的方向优先补满
function chooseAiResearchCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const force = state.forces[forceId];
  if (!force) return null;
  const techP = force.techP ?? 0;
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  if (cities.length === 0) return null;

  // 方向优先级：已研究过的方向优先升级，其次按剧本预研方向
  const startedBranches = TECH_BRANCHES
    .filter((branch) => techLevelOf(state, forceId, branch.id) > 0)
    .sort((left, right) => techLevelOf(state, forceId, right.id) - techLevelOf(state, forceId, left.id));
  const freshBranches = TECH_BRANCHES.filter((branch) => techLevelOf(state, forceId, branch.id) === 0);
  const orderedBranches = [...startedBranches, ...freshBranches];

  for (const branch of orderedBranches) {
    const level = techLevelOf(state, forceId, branch.id);
    if (level >= MAX_TECH_LEVEL) continue;
    const cost = TECH_COSTS[level];
    if (techP < cost.techP) continue;
    // 找一座金钱充足的城市，用对应属性最优的武将研究
    const sortedCities = [...cities].sort((a, b) => b.gold - a.gold);
    for (const city of sortedCities) {
      if (city.gold < cost.gold + 2000) continue;
      const officers = availableOfficers(state, forceId, city);
      const officer = bestOfficer(officers, branch.researchStat);
      if (!officer) continue;
      const command: GameCommand = { type: 'research', cityId: city.id, officerId: officer.id, branch: branch.id };
      if (validateCommand(state, forceId, command).length === 0) return command;
    }
  }
  return null;
}

interface AiDecision {
  command: GameCommand | null;
  cursor: number;
}

// AI能力研究：优先培育已研究完成的能力，其次启动新的能力研究
function chooseAiAbilityCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const force = state.forces[forceId];
  if (!force) return null;
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  if (cities.length === 0) return null;
  const research = force.abilityResearch;

  // 1. 培育：已研究且仍有培育次数的节点，挑一名最适合的在城武将
  if (research) {
    for (const nodeId of research.researched) {
      const node = ABILITY_NODE_MAP[nodeId];
      if (!node || (research.remaining[nodeId] ?? 0) <= 0) continue;
      for (const city of cities) {
        const candidates = availableOfficers(state, forceId, city)
          .filter((officer) => canCultivateOfficer(officer, node))
          .sort((left, right) =>
            node.kind === 'stat' && node.stat
              ? right.stats[node.stat] - left.stats[node.stat]
              : (right.stats.leadership + right.stats.war) - (left.stats.leadership + left.stats.war));
        const officer = candidates[0];
        if (!officer) continue;
        const command: GameCommand = { type: 'cultivate', cityId: city.id, officerId: officer.id, nodeId: node.id };
        if (validateCommand(state, forceId, command).length === 0) return command;
      }
    }
  }

  // 2. 启动新研究：无在研项目、城市资金充足；优先耗时短的低级节点
  if (!research?.active) {
    const available = ABILITY_NODES
      .filter((node) => abilityNodeStatus(state, forceId, node) === 'available')
      .sort((left, right) => left.months - right.months);
    for (const node of available) {
      for (const city of [...cities].sort((a, b) => b.gold - a.gold)) {
        if (city.gold < ABILITY_RESEARCH_GOLD + 1000) continue;
        const command: GameCommand = { type: 'abilityResearch', cityId: city.id, nodeId: node.id };
        if (validateCommand(state, forceId, command).length === 0) return command;
      }
    }
  }
  return null;
}

// AI探索：城中有未出土宝物或行动力富余时，派智力最高的武将去探索
function chooseAiExploreCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  for (const city of cities) {
    const buried = Object.values(state.treasures ?? {}).filter((item) => item.ownerId === null && item.cityId === city.id);
    const hasTalent = Object.values(state.officers).some((officer) =>
      officer.forceId === null && officer.location.kind === 'unaffiliated' && officer.location.cityId === city.id,
    );
    if (buried.length === 0 && !hasTalent) continue;
    if (city.gold < EXPLORE_GOLD_PER_OFFICER + 500) continue;
    const officer = bestOfficer(availableOfficers(state, forceId, city), 'intelligence');
    if (!officer) continue;
    if (state.actionPoints[forceId] < EXPLORE_AP_PER_OFFICER + 10) continue;
    const command: GameCommand = { type: 'explore', cityId: city.id, officerIds: [officer.id] };
    if (validateCommand(state, forceId, command).length === 0) return command;
  }
  return null;
}

// AI宝物授予：把己方未装备的宝物授予属性最匹配的武将
function chooseAiGrantTreasureCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const treasures = Object.values(state.treasures ?? {}).filter((item) => item.ownerId === forceId && !item.holderId);
  if (treasures.length === 0) return null;
  const officers = Object.values(state.officers).filter((officer) => officer.forceId === forceId);
  for (const treasure of treasures) {
    const definition = treasureDefinition(treasure.id);
    if (!definition) continue;
    const statKey = (Object.entries(definition.stats) as Array<[keyof Officer['stats'], number]>)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    const candidates = officers
      .filter((officer) => !officer.treasureId)
      .sort((left, right) =>
        statKey ? right.stats[statKey] - left.stats[statKey] : (right.stats.leadership + right.stats.war) - (left.stats.leadership + left.stats.war));
    const officer = candidates[0];
    if (!officer) continue;
    const command: GameCommand = { type: 'grantTreasure', cityId: officer.location.kind === 'city' ? officer.location.cityId : Object.keys(state.cities)[0] as City['id'], treasureId: treasure.id, officerId: officer.id };
    if (validateCommand(state, forceId, command).length === 0) return command;
  }
  return null;
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
  // 科技研究：金钱与技巧P富余时，优先把已开工的方向补到高级
  {
    const researchCommand = chooseAiResearchCommand(state, forceId);
    if (researchCommand) return selected(researchCommand);
  }
  // 能力研究：先培育已完成的能力，再启动新研究
  {
    const abilityCommand = chooseAiAbilityCommand(state, forceId);
    if (abilityCommand) return selected(abilityCommand);
  }
  // 宝物授予：把未装备的宝物授予属性最匹配的武将
  {
    const grantCommand = chooseAiGrantTreasureCommand(state, forceId);
    if (grantCommand) return selected(grantCommand);
  }
  // 探索：城中有未出土宝物或在野武将时，派智力最高的武将探索
  {
    const exploreCommand = chooseAiExploreCommand(state, forceId);
    if (exploreCommand) return selected(exploreCommand);
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
  let state = dispatchTerritoryDefenseForForce(initial, forceId);
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
