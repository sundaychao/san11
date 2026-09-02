import { nextRandom } from './random';
import { officerSkillNames } from './skills';
import { treasureDefinition } from './treasures';
import { captureChance, hasNamedHorse } from './captives';
import { applyInjury } from './health';
import type { ArmyUnit, CityId, ForceId, GameState, Officer } from './types';

/**
 * 单挑系统（参考《三国志11》原版）：
 * - 相邻敌我部队之间可发起单挑；执行武将须在场且本旬未行动。
 * - 行动方针：攻击重视/防御重视/斗志重视/一击重视。
 * - 斗志（怒气）随受击与斗志方针累积，攒满发动必杀（伤害大幅提升）。
 * - 武器（宝物）提供伤害加成，名马不受俘且提高逃跑能力；强运不受俘、不受伤。
 * - 败者部队兵力-30%、主将概率负伤/被俘；胜者气力+20。
 */
export type DuelStance = 'attack' | 'defense' | 'spirit' | 'finisher';

export const DUEL_STANCE_LABELS: Record<DuelStance, string> = {
  attack: '攻击重视',
  defense: '防御重视',
  spirit: '斗志重视',
  finisher: '一击重视',
};

export const DUEL_AP_COST = 0;
export const DUEL_MAX_ROUNDS = 12;
/** 单挑怒气条长度 */
export const DUEL_RAGE_MAX = 100;

export interface DuelRound {
  num: number;
  attackerAction: string;
  defenderAction: string;
  attackerDamage: number;
  defenderDamage: number;
  attackerRage: number;
  defenderRage: number;
  narration: string;
}

export interface DuelResult {
  winner: 'attacker' | 'defender' | null;
  rounds: DuelRound[];
  attackerHpAtEnd: number;
  defenderHpAtEnd: number;
  attackerCaptured: boolean;
  defenderCaptured: boolean;
  attackerInjured: boolean;
  defenderInjured: boolean;
  attackerUnitLoss: number;
  defenderUnitLoss: number;
}

export interface DuelParticipants {
  attacker: Officer;
  defender: Officer;
  attackerUnit: ArmyUnit;
  defenderUnit: ArmyUnit;
}

function statWithTreasury(officer: Officer): number {
  if (!officer.treasureId) return 0;
  const definition = treasureDefinition(officer.treasureId);
  if (!definition || definition.category !== '武器') return 0;
  return definition.stats.war ?? 0;
}

function hpFor(officer: Officer): number {
  return 60 + officer.stats.war;
}

function damageFor(state: GameState, actor: Officer, opponent: Officer, stance: DuelStance, rage: number, actorHp: number, canFinisher: boolean): number {
  const base = 8 + (officerSkillNames(actor).includes('斗神') ? 6 : 0);
  const warDiff = Math.max(0, actor.stats.war - opponent.stats.war);
  const weaponBonus = statWithTreasury(actor) * 2;
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  let damage = base + Math.floor(warDiff / 2) + weaponBonus + Math.floor(roll.value * 10);
  if (stance === 'attack') damage = Math.round(damage * 1.35);
  if (stance === 'defense') damage = Math.round(damage * 0.55);
  if (rage >= DUEL_RAGE_MAX) damage = Math.round(damage * 2.2);
  // 一击重视：低概率大伤害
  if (stance === 'finisher' && canFinisher && roll.value < 0.22) damage = Math.round(damage * 3);
  return damage;
}

function incomingMultiplier(stance: DuelStance): number {
  if (stance === 'defense') return 0.45;
  if (stance === 'attack') return 1.15;
  return 1;
}

const STANCE_LABEL_ZH: Record<DuelStance, string> = {
  attack: '攻',
  defense: '防',
  spirit: '斗',
  finisher: '一击',
};

/**
 * 结算单挑：自动推演若干回合，返回完整过程与结果。
 * attackerStance 由玩家（或AI）先行选择，defender 依其性格随机出招。
 */
export function resolveDuel(state: GameState, participants: DuelParticipants, attackerStance: DuelStance): DuelResult {
  let attackerHp = hpFor(participants.attacker);
  let defenderHp = hpFor(participants.defender);
  let attackerRage = 0;
  let defenderRage = 0;
  const rounds: DuelRound[] = [];
  const enemyStances: DuelStance[] = ['attack', 'defense', 'spirit', 'finisher'];
  const personalityBias: Record<string, DuelStance[]> = {
    reckless: ['attack', 'attack', 'spirit', 'attack', 'finisher'],
    bold: ['attack', 'spirit', 'attack', 'defense', 'attack'],
    calm: ['defense', 'spirit', 'defense', 'attack', 'attack'],
    timid: ['defense', 'defense', 'spirit', 'defense', 'finisher'],
  };

  for (let round = 0; round < DUEL_MAX_ROUNDS; round += 1) {
    const personality = participants.defender.personality ?? 'calm';
    const pool = personalityBias[personality] ?? enemyStances;
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    const defenderStance = pool[Math.floor(roll.value * pool.length)] ?? 'attack';

    // 名马先手加成
    const attackerFirst = participants.attacker.stats.war + (hasNamedHorse(participants.attacker) ? 4 : 0)
      >= participants.defender.stats.war + (hasNamedHorse(participants.defender) ? 4 : 0);

    const attackerDamage = damageFor(state, participants.attacker, participants.defender, attackerStance, attackerRage, attackerHp, attackerHp < 35);
    const defenderDamage = damageFor(state, participants.defender, participants.attacker, defenderStance, defenderRage, defenderHp, defenderHp < 35);

    const defenderTaken = attackerFirst ? attackerDamage : Math.round(attackerDamage * 0.5);
    const attackerTaken = attackerFirst ? Math.round(defenderDamage * 0.5) : defenderDamage;

    attackerHp = Math.max(0, attackerHp - Math.round(attackerTaken * incomingMultiplier(attackerStance)));
    defenderHp = Math.max(0, defenderHp - defenderTaken);

    attackerRage = Math.min(DUEL_RAGE_MAX, attackerRage + (attackerStance === 'spirit' ? 22 : 8) + (attackerTaken > 0 ? 5 : 0));
    defenderRage = Math.min(DUEL_RAGE_MAX, defenderRage + (defenderStance === 'spirit' ? 22 : 8));

    const narration = `${participants.attacker.name}以「${STANCE_LABEL_ZH[attackerStance]}」命中${participants.defender.name} ${defenderTaken}点，对方以「${STANCE_LABEL_ZH[defenderStance]}」还击 ${attackerTaken} 点`
      + (attackerRage >= DUEL_RAGE_MAX || defenderRage >= DUEL_RAGE_MAX ? '，双方怒气沸腾' : '');
    rounds.push({
      num: round + 1,
      attackerAction: STANCE_LABEL_ZH[attackerStance],
      defenderAction: STANCE_LABEL_ZH[defenderStance],
      attackerDamage: defenderTaken,
      defenderDamage: attackerTaken,
      attackerRage,
      defenderRage,
      narration: `${narration}。`,
    });

    if (attackerHp <= 0 || defenderHp <= 0) break;
  }

  let winner: 'attacker' | 'defender' | null = null;
  if (attackerHp <= 0 && defenderHp <= 0) winner = null;
  else if (attackerHp <= 0) winner = 'defender';
  else if (defenderHp <= 0) winner = 'attacker';

  const attackerUnitLoss = Math.floor(participants.attackerUnit.troops * (winner === 'defender' ? 0.3 : 0.05));
  const defenderUnitLoss = Math.floor(participants.defenderUnit.troops * (winner === 'attacker' ? 0.3 : 0.05));
  let attackerCaptured = false;
  let defenderCaptured = false;
  let attackerInjured = false;
  let defenderInjured = false;

  if (winner === 'attacker') {
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    const chance = captureChance(state, participants.defender, participants.attackerUnit, 0) / 100;
    defenderCaptured = roll.value < chance * 0.6;
    defenderInjured = defenderCaptured || applyInjury(state, participants.defender, 'moderate');
    attackerInjured = applyInjury(state, participants.attacker, 'light');
  } else if (winner === 'defender') {
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    const chance = captureChance(state, participants.attacker, participants.defenderUnit, 0) / 100;
    attackerCaptured = roll.value < chance * 0.5;
    attackerInjured = attackerCaptured || applyInjury(state, participants.attacker, 'moderate');
    defenderInjured = applyInjury(state, participants.defender, 'light');
  } else {
    attackerInjured = applyInjury(state, participants.attacker, 'light');
    defenderInjured = applyInjury(state, participants.defender, 'light');
  }

  return {
    winner,
    rounds,
    attackerHpAtEnd: attackerHp,
    defenderHpAtEnd: defenderHp,
    attackerCaptured,
    defenderCaptured,
    attackerInjured,
    defenderInjured,
    attackerUnitLoss,
    defenderUnitLoss,
  };
}

/** 单挑是否可发起：敌方部队相邻、执行武将本旬未行动 */
export function canDuel(state: GameState, attacker: ArmyUnit, target: ArmyUnit): boolean {
  if (!attacker || !target || attacker.forceId === target.forceId) return false;
  if (Math.abs(attacker.q - target.q) + Math.abs(attacker.r - target.r) !== 1) return false;
  const leader = state.officers[attacker.leaderId];
  const targetLeader = state.officers[target.leaderId];
  return Boolean(leader && targetLeader && !leader.acted);
}

/** AI 单挑方针：按性格选择 */
export function aiDuelStance(officer: Officer): DuelStance {
  switch (officer.personality ?? 'calm') {
    case 'reckless': return 'attack';
    case 'bold': return 'attack';
    case 'timid': return 'defense';
    default: return 'spirit';
  }
}

/**
 * 执行单挑：验证 → 结算 → 应用后果（部队伤亡、气力、负伤、被俘），并写入 lastDuelReport 供弹窗展示。
 */
export function executeDuel(state: GameState, communityForce: ForceId, unitId: string, targetUnitId: string, attackerStance: DuelStance): GameState {
  const next = structuredClone(state);
  const attackerUnit = next.units[unitId];
  const defenderUnit = next.units[targetUnitId];
  if (!attackerUnit || !defenderUnit) throw new Error('单挑部队不存在');
  if (attackerUnit.forceId !== communityForce) throw new Error('只能指挥己方部队单挑');
  if (attackerUnit.forceId === defenderUnit.forceId) throw new Error('不能对己方部队发起单挑');
  if (Math.abs(attackerUnit.q - defenderUnit.q) + Math.abs(attackerUnit.r - defenderUnit.r) !== 1) {
    throw new Error('目标部队须与我军相邻');
  }
  const attacker = next.officers[attackerUnit.leaderId];
  const defender = next.officers[defenderUnit.leaderId];
  if (!attacker || !defender) throw new Error('单挑将领无效');
  if (attacker.acted) throw new Error('该部队本旬已行动');

  next.battleDamageReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  next.lastDuelReport = null;

  const result = resolveDuel(next, { attacker, defender, attackerUnit, defenderUnit }, attackerStance);

  // 部队伤亡（兵损不触发再俘获判定——单挑结果已决定被俘与否）
  attackerUnit.troops = Math.max(0, attackerUnit.troops - result.attackerUnitLoss);
  defenderUnit.troops = Math.max(0, defenderUnit.troops - result.defenderUnitLoss);

  // 被俘结算
  if (result.defenderCaptured) {
    defender.location = { kind: 'captive', cityId: attackerUnit.homeCityId as CityId, captorForceId: attackerUnit.forceId ?? communityForce, capturedTenDays: 0 };
    defender.cityId = attackerUnit.homeCityId;
  }
  if (result.attackerCaptured) {
    attacker.location = { kind: 'captive', cityId: defenderUnit.homeCityId as CityId, captorForceId: defenderUnit.forceId ?? communityForce, capturedTenDays: 0 };
    attacker.cityId = defenderUnit.homeCityId;
  }

  // 部队被击溃时非被俘武将退回城市
  const officerIdSets = {
    [unitId]: attackerUnit.officerIds ?? [attackerUnit.leaderId],
    [targetUnitId]: defenderUnit.officerIds ?? [defenderUnit.leaderId],
  };
  for (const [uId, troop] of [[unitId, attackerUnit], [targetUnitId, defenderUnit]] as const) {
    if (troop.troops > 0) continue;
    const retreatCity = Object.values(next.cities).find((city) => city.ownerId === troop.forceId && city.id === troop.homeCityId)
      ?? Object.values(next.cities).find((city) => city.ownerId === troop.forceId);
    for (const officerId of officerIdSets[uId]) {
      const officer = next.officers[officerId];
      if (!officer) continue;
      if (officer.location.kind === 'captive') continue;
      officer.location = retreatCity ? { kind: 'city', cityId: retreatCity.id } : { kind: 'unaffiliated', cityId: troop.homeCityId };
      officer.cityId = officer.location.cityId;
      officer.acted = false;
    }
    delete next.units[uId];
  }

  // 胜者气力+20、攻方标记已行动并消耗气力
  const nextAttacker = next.units[unitId];
  const nextDefender = next.units[targetUnitId];
  if (result.winner === 'attacker' && nextDefender) nextDefender.energy += 20;
  if (result.winner === 'defender' && nextAttacker) nextAttacker.energy += 20;
  if (nextAttacker) {
    nextAttacker.acted = true;
    nextAttacker.energy = Math.max(0, nextAttacker.energy - 20);
  }

  // 单挑结果写入报告（供弹窗逐步回放）
  next.lastDuelReport = {
    id: `duel-${next.month}-${next.tenDay}-${next.rngCursor}`,
    attackerUnitId: unitId,
    defenderUnitId: targetUnitId,
    attackerId: attacker.id,
    defenderId: defender.id,
    attackerName: attacker.name,
    defenderName: defender.name,
    winner: result.winner,
    rounds: result.rounds,
    attackerHpAtEnd: result.attackerHpAtEnd,
    defenderHpAtEnd: result.defenderHpAtEnd,
    attackerCaptured: result.attackerCaptured,
    defenderCaptured: result.defenderCaptured,
    attackerInjured: result.attackerInjured,
    defenderInjured: result.defenderInjured,
    attackerUnitLoss: result.attackerUnitLoss,
    defenderUnitLoss: result.defenderUnitLoss,
  };

  const outcomeText = result.winner === 'attacker'
    ? `${attacker.name}赢得单挑${result.defenderCaptured ? `，并生擒${defender.name}` : ''}`
    : result.winner === 'defender'
      ? `${defender.name}赢得单挑${result.attackerCaptured ? `，并生擒${attacker.name}` : ''}`
      : '单挑以平局收场';
  next.logs.push({
    id: `log-duel-${next.month}-${next.tenDay}-${next.logs.length}`,
    month: next.month,
    forceId: communityForce,
    message: `${attacker.name}向${defender.name}发起单挑，${outcomeText}`,
  });
  return next;
}