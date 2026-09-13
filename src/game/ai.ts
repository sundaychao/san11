import { executeCommand, researchTechPCost, validateCommand } from './commands';
import { dispatchTerritoryDefenseForForce } from './battle/actions';
import { autoResolveDebate, dismissDebate } from './debate';
import { researchableTechs, techCostOf, techNodeOf } from './techs';
import { ABILITY_NODES, ABILITY_NODE_MAP, ABILITY_RESEARCH_GOLD, abilityNodeStatus, canCultivateOfficer } from './abilityResearch';
import { EXPLORE_AP_PER_OFFICER, EXPLORE_GOLD_PER_OFFICER, treasureDefinition } from './treasures';
import { POSITIONS, forceRankOf, officerMerit, positionDefinition, rankIndex } from './ranks';
import { RUMOR_AP_COST, RUMOR_GOLD_COST } from './rumor';
import { DIPLOMACY_AP_COST, FRIENDLY_TIER_MIN, GOODWILL_GOLD_COST, areAllies, areNonAggressed, forceDiplomacy } from './diplomacy';
import { CAPTIVE_DISPOSE_AP_COST, canBuildPlot, cityPlots, COMMAND_OFFICER_MAX, hasPlotFacility, plotCost } from './innerAffairs';
import { capturableByLoyalty } from './captives';
import { recruitWillOf } from './loyalty';
import { legionsOf } from './innerAffairs';
import { nextRandom } from './random';
import type { City, CityId, ForceId, GameCommand, GameState, Officer } from './types';

function availableOfficers(state: GameState, forceId: ForceId, city: City) {
  return Object.values(state.officers).filter(
    (officer) => officer.forceId === forceId && officer.location.kind === 'city' && officer.location.cityId === city.id && !officer.acted,
  );
}

function bestOfficer(officers: Officer[], stat: keyof Officer['stats']) {
  return [...officers].sort((left, right) => right.stats[stat] - left.stats[stat])[0];
}

/** 按指定能力降序取前 count 名武将（多人执行指令用） */
function bestOfficers(officers: Officer[], stat: keyof Officer['stats'], count: number) {
  return [...officers].sort((left, right) => right.stats[stat] - left.stats[stat]).slice(0, count);
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
  const officers = availableOfficers(state, forceId, city);
  if (type === 'talent') {
    const officer = bestOfficer(officers, stat);
    if (!officer) return null;
    // 登庸目标：同城在野优先，其次他城在野（AI 不主动策反他势力武将），须登用意愿可行且未被禁仕
    const unaffiliated = Object.values(state.officers).filter((candidate) =>
      candidate.forceId === null && !candidate.deathMonth
      && !(candidate.bannedUntilMonth && candidate.bannedUntilMonth > state.month));
    const sameCity = unaffiliated.filter((candidate) => candidate.location.kind === 'unaffiliated' && candidate.location.cityId === city.id);
    const willOk = (candidate: Officer) => {
      const will = recruitWillOf(state, officer, candidate);
      return will.verdict === 'accept' || (will.verdict !== 'refuse' && will.will > 0);
    };
    const target = sameCity.find(willOk) ?? unaffiliated.find(willOk);
    if (!target) return null;
    return commandIfLegal(state, forceId, { type, cityId: city.id, officerId: officer.id, targetOfficerId: target.id });
  }
  // 多人执行指令：按相关能力取至多3名武将
  const picked = bestOfficers(officers, stat, COMMAND_OFFICER_MAX);
  return picked.length > 0
    ? commandIfLegal(state, forceId, { type, cityId: city.id, officerIds: picked.map((officer) => officer.id) })
    : null;
}

function chooseAiResearchCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const force = state.forces[forceId];
  if (!force) return null;
  const techP = force.techP ?? 0;
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  if (cities.length === 0) return null;

  // 只考虑前置已满足的节点；低等级优先（先铺开基础科技），同级按系统内节点顺序
  const candidates = researchableTechs(state, forceId)
    .map((nodeId) => techNodeOf(nodeId)!)
    .sort((left, right) => left.level - right.level);

  for (const node of candidates) {
    const cost = techCostOf(node.id)!;
    if (techP < cost.techP) continue;
    // 找一座金钱充足的城市，用对应属性最优的武将研究
    const sortedCities = [...cities].sort((a, b) => b.gold - a.gold);
    for (const city of sortedCities) {
      if (city.gold < cost.gold + 2000) continue;
      const officers = availableOfficers(state, forceId, city);
      // 多人研究：按研究属性取至多3名武将，人数越多研究越快
      const picked = bestOfficers(officers, node.stat, COMMAND_OFFICER_MAX);
      if (picked.length === 0) continue;
      const officerIds = picked.map((officer) => officer.id);
      // 指导：研究技巧P消耗减半后仍不足则跳过
      if (techP < researchTechPCost(state, node.id, officerIds)) continue;
      const command: GameCommand = { type: 'research', cityId: city.id, officerIds, nodeId: node.id };
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

// AI官职任命：为功绩满足、尚无官职或可升职的武将授予最高可用的官职（不消耗行动力）
function chooseAiAppointPositionCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const force = state.forces[forceId];
  if (!force) return null;
  const rankNow = forceRankOf(state, forceId);
  const officers = Object.values(state.officers).filter((officer) => officer.forceId === forceId && officer.id !== force.leaderId);
  for (const officer of officers) {
    const current = officer.positionId ? positionDefinition(officer.positionId) : null;
    const best = POSITIONS
      .filter((position) =>
        officerMerit(officer) >= position.merit
        && rankIndex(rankNow) >= rankIndex(position.rankNeeded)
        && (!current || position.troopCommand > current.troopCommand))
      .sort((a, b) => b.troopCommand - a.troopCommand || b.merit - a.merit)[0];
    if (!best) continue;
    const command: GameCommand = { type: 'appointPosition', cityId: officer.location.kind === 'city' ? officer.location.cityId : Object.keys(state.cities)[0] as City['id'], officerId: officer.id, positionId: best.id };
    if (validateCommand(state, forceId, command).length === 0) return command;
  }
  return null;
}

// AI军师任命：将己方智力最高且在城、非被俘的武将任命为军师（不消耗行动力）
function chooseAiStrategistCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const force = state.forces[forceId];
  if (!force) return null;
  if (force.strategistId) return null;
  const officers = Object.values(state.officers).filter(
    (officer) => officer.forceId === forceId && officer.location.kind !== 'captive' && officer.id !== force.leaderId,
  );
  const best = bestOfficer(officers, 'intelligence');
  if (!best) return null;
  const cityId = (best.location.kind === 'city' ? best.location.cityId : Object.values(state.cities).find((city) => city.ownerId === forceId)?.id) as CityId | undefined;
  if (!cityId) return null;
  const command: GameCommand = { type: 'appointStrategist', cityId, officerId: best.id };
  return commandIfLegal(state, forceId, command);
}

// AI流言：己方资金富余、治安良好时，向治安最差的敌城散布流言（削弱敌方民忠）
function chooseAiRumorCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const city = Object.values(state.cities).find((c) => c.ownerId === forceId && c.gold >= RUMOR_GOLD_COST + 3000 && c.order >= 70);
  if (!city) return null;
  const officer = bestOfficer(availableOfficers(state, forceId, city), 'intelligence');
  if (!officer) return null;
  if (state.actionPoints[forceId] < RUMOR_AP_COST) return null;
  const enemyCities = Object.values(state.cities)
    .filter((c) => !!c.ownerId && c.ownerId !== forceId && !areNonAggressed(state, forceId, c.ownerId))
    .sort((a, b) => a.order - b.order || b.troops - a.troops);
  const target = enemyCities[0];
  if (!target) return null;
  const command: GameCommand = { type: 'rumor', cityId: city.id, officerId: officer.id, targetCityId: target.id };
  return commandIfLegal(state, forceId, command);
}

// AI俘虏处置：忠诚合格的俘虏登用；武勇高者继续关押；其余释放
function chooseAiCaptiveDisposeCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const captives = Object.values(state.officers).filter(
    (officer) => officer.location.kind === 'captive' && officer.location.captorForceId === forceId,
  );
  for (const captive of captives) {
    const cityId: CityId = captive.location.kind === 'captive' ? captive.location.cityId : Object.keys(state.cities)[0] as CityId;
    const city = state.cities[cityId];
    if (!city) continue;
    const action = (() => {
      if (capturableByLoyalty(captive)) return 'recruit' as const;
      if ((captive.stats.war ?? 0) >= 75) return 'release' as const; // 武勇高的勇将释放以换取好感
      return 'release' as const;
    })();
    // 登用时需本城另有可代执行的武将（非君主、未行动）
    if (action === 'recruit') {
      const hasExecutor = Object.values(state.officers).some((o) =>
        o.forceId === forceId && o.location.kind === 'city' && o.location.cityId === cityId
        && !o.acted && o.id !== state.forces[forceId]?.leaderId);
      if (!hasExecutor) continue;
    }
    if (state.actionPoints[forceId] < CAPTIVE_DISPOSE_AP_COST) continue;
    const command: GameCommand = { type: 'captiveDispose', cityId, targetOfficerId: captive.id, action };
    if (validateCommand(state, forceId, command).length === 0) return command;
  }
  return null;
}

// AI外交：视局势决定亲善/停战/结盟/破盟（不消耗行动力之外的额外资源，仅耗钱）
function chooseAiDiplomacyCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const force = state.forces[forceId];
  if (!force) return null;
  const cities = Object.values(state.cities).filter((c) => c.ownerId === forceId);
  const richest = [...cities].sort((a, b) => b.gold - a.gold)[0];
  if (!richest || richest.gold < 5000) return null;
  const officer = bestOfficer(availableOfficers(state, forceId, richest), 'politics');
  if (!officer) return null;
  if (state.actionPoints[forceId] < DIPLOMACY_AP_COST) return null;

  const myTroops = cities.reduce((sum, c) => sum + c.troops, 0);
  const others = Object.values(state.forces)
    .filter((f) => f.id !== forceId)
    .map((f) => {
      const fCities = Object.values(state.cities).filter((c) => c.ownerId === f.id);
      return {
        force: f,
        troops: fCities.reduce((sum, c) => sum + c.troops, 0),
        cityCount: fCities.length,
      };
    })
    .sort((a, b) => b.troops - a.troops);
  const strongest = others[0];
  if (!strongest) return null;
  const strongestCity = Object.values(state.cities).find((c) => c.ownerId === strongest.force.id);

  const attempt = (command: GameCommand): GameCommand | null => (
    validateCommand(state, forceId, command).length === 0 ? command : null
  );

  // 1. 我方已足够强（城市数领先至少3座）且与最强者结盟 → 撕毁盟约
  if (areAllies(state, forceId, strongest.force.id) && cities.length >= strongest.cityCount + 3) {
    return attempt({ type: 'diplomacy', cityId: richest.id, officerId: officer.id, targetForceId: strongest.force.id, action: 'break' });
  }

  // 2. 敌方远强于我 → 停战（送金示好）
  if (strongest.troops > myTroops * 1.3 && !areAllies(state, forceId, strongest.force.id)) {
    const areNonAggressedNow = (state.forces[forceId]?.truces?.[strongest.force.id] ?? 0) > 0;
    if (!areNonAggressedNow) {
      const gold = Math.min(5000, richest.gold);
      return attempt({ type: 'diplomacy', cityId: richest.id, officerId: officer.id, targetForceId: strongest.force.id, action: 'truce', gold, months: 6 });
    }
  }

  // 3. 好感度较高的势力尝试结盟（双方实力相近且未结盟）
  const friendly = others
    .filter((o) => !areAllies(state, forceId, o.force.id) && forceDiplomacy(state, forceId, o.force.id) >= FRIENDLY_TIER_MIN)
    .sort((a, b) => forceDiplomacy(state, forceId, b.force.id) - forceDiplomacy(state, forceId, a.force.id))[0];
  if (friendly && Math.abs(cities.length - friendly.cityCount) <= 2) {
    const gold = Math.min(5000, Math.max(2000, richest.gold));
    return attempt({ type: 'diplomacy', cityId: richest.id, officerId: officer.id, targetForceId: friendly.force.id, action: 'alliance', gold });
  }

  // 4. 有钱没仗打时面向最强势力亲善，为后续结盟铺垫（一律刷到「友好」档为止）
  if (strongestCity && richest.gold >= GOODWILL_GOLD_COST + 4000 && forceDiplomacy(state, forceId, strongest.force.id) < FRIENDLY_TIER_MIN) {
    return attempt({ type: 'diplomacy', cityId: richest.id, officerId: officer.id, targetForceId: strongest.force.id, action: 'goodwill' });
  }
  return null;
}

// AI委任军团：当势力城市较多时，把非直辖城市委任给高统率武将管理（不消耗行动力）
function chooseAiLegionCommand(state: GameState, forceId: ForceId): GameCommand | null {
  const force = state.forces[forceId];
  if (!force) return null;
  const cities = Object.values(state.cities).filter((c) => c.ownerId === forceId);
  if (cities.length < 3) return null;
  const existing = legionsOf(state, forceId);
  const legionedCityIds = new Set(existing.flatMap((legion) => legion.cityIds));
  const leader = state.officers[force.leaderId];
  const capitalId: CityId | undefined = leader?.location.kind === 'city' ? leader.location.cityId : cities[0]?.id;
  const capital = capitalId ? state.cities[capitalId] : undefined;
  const spare = cities.find((city) => city.id !== capital?.id && !legionedCityIds.has(city.id));
  if (!spare) return null;

  const commanders = Object.values(state.officers).filter(
    (o) => o.forceId === forceId && o.id !== force.leaderId && o.location.kind === 'city' && !o.deathMonth,
  );
  const commander = [...commanders].sort((a, b) => b.stats.leadership - a.stats.leadership)[0];
  if (!commander) return null;

  const avgTraining = cities.reduce((sum, c) => sum + c.training, 0) / cities.length;
  const policy = avgTraining < 60 ? 'military' : 'balanced';
  const cityId = commander.location.kind === 'city' ? commander.location.cityId : capitalId;
  if (!cityId) return null;
  const command: GameCommand = { type: 'legion', cityId, commanderId: commander.id, targetCityId: spare.id, policy };
  return commandIfLegal(state, forceId, command);
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
  for (const city of [...cities].sort((a, b) => a.training - b.training)) {
    if (city.training < 70 && city.troops > 0) {
      const command = cityCommand(state, forceId, city, 'train', 'leadership');
      if (command) return selected(command);
    }
  }
  // 设施建设：无兵舍的城优先建兵舍（征兵前置），其次补锻冶（兵装生产前置）
  for (const facility of ['barracks', 'forge'] as const) {
    for (const city of cities) {
      if (hasPlotFacility(city, facility)) continue;
      const plotIndex = cityPlots(city).findIndex((_plot, index) => canBuildPlot(city, index));
      if (plotIndex < 0 || city.gold < plotCost(facility)) continue;
      const picked = bestOfficers(availableOfficers(state, forceId, city), 'politics', COMMAND_OFFICER_MAX);
      if (picked.length === 0) continue;
      const command = commandIfLegal(state, forceId, { type: 'buildFacilityPlot', cityId: city.id, officerIds: picked.map((officer) => officer.id), plotIndex, facility });
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
    // 血色衣冠 6.0：只有当城中存在「登用接受意愿 >0」的在野武将时才派人说降
    const executor = bestOfficers(availableOfficers(state, forceId, city), 'intelligence', 1)[0];
    if (!executor) continue;
    const hasTalent = Object.values(state.officers).some((officer) => {
      if (officer.forceId !== null || officer.location.kind !== 'unaffiliated' || officer.location.cityId !== city.id) return false;
      const will = recruitWillOf(state, executor, officer);
      return will.verdict === 'accept' || (will.verdict === 'maybe' && will.will > 0);
    });
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
  // 官职任命：为功绩足够的武将授予更优官职（不消耗行动力，优先于常规开发）
  {
    const appointCommand = chooseAiAppointPositionCommand(state, forceId);
    if (appointCommand) return selected(appointCommand);
  }
  // 探索：城中有未出土宝物或在野武将时，派智力最高的武将探索
  {
    const exploreCommand = chooseAiExploreCommand(state, forceId);
    if (exploreCommand) return selected(exploreCommand);
  }
  // 军师任命：智力最高的己方武将担任军师（不消耗行动力）
  {
    const strategistCommand = chooseAiStrategistCommand(state, forceId);
    if (strategistCommand) return selected(strategistCommand);
  }
  // 俘虏处置：忠诚合格的俘虏登用、不适用的释放
  {
    const captiveCommand = chooseAiCaptiveDisposeCommand(state, forceId);
    if (captiveCommand) return selected(captiveCommand);
  }
  // 流言：资金富余时向治安最差的敌城散布流言
  {
    const rumorCommand = chooseAiRumorCommand(state, forceId);
    if (rumorCommand) return selected(rumorCommand);
  }
  // 外交：视敌我实力对比进行亲善/停战/结盟/破盟
  {
    const diplomacyCommand = chooseAiDiplomacyCommand(state, forceId);
    if (diplomacyCommand) return selected(diplomacyCommand);
  }
  // 委任军团：城市较多时委任给高统率武将管理
  {
    const legionCommand = chooseAiLegionCommand(state, forceId);
    if (legionCommand) return selected(legionCommand);
  }

  // 内政发展（原 develop 命令）已移除，AI 无更多可用内政命令
  return { command: null, cursor: state.rngCursor };
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
    // AI 触发的舌战立即自动演算结算（不弹给玩家操作），并清除已结束会话避免残留
    if (state.debateSession?.status === 'ongoing'
      && state.officers[state.debateSession.recruiterId]?.forceId === forceId) {
      state = dismissDebate(autoResolveDebate(state));
    }
    guard += 1;
  }
  return state;
}
