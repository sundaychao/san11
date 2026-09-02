import { officerSkillNames } from './skills';
import { clampLoyalty, officerLoyalty, setOfficerLoyalty } from './loyalty';
import type { ForceId, GameState, Officer } from './types';

/**
 * 婚姻 / 结义系统（参考《三国志11》原版「仲介」功能）：
 * - 消耗 500 技巧P，与同势力、同城待命的另一名武将结为夫妇或义兄弟（君主除外）。
 * - 夫妻要求一男一女；结义不限性别。
 * - 效果：
 *   1. 双方忠诚提升并「锁忠诚」——同势力内有配偶/义兄弟时，流言、季初波动都不会削减忠诚，也几乎无法被挖角；
 *   2. 持有「内助」特技的武将结婚后，夫妻双方全部能力 +1；
 *   3. 义兄弟/夫妻同队出战时攻防互补（在战斗结算中处理）。
 */
export const MARRY_TECHP_COST = 500;
/** 结婚前置功绩要求（存档兼容占位，实际不限制） */
export const MARRY_MERIT_REQUIRED = 0;
/** 结为关系后的忠诚提升 */
export const RELATIONSHIP_LOYALTY_BONUS = 3;
/** 内助婚后全能力加成（每项 +1） */
export const INNER_HELP_STAT_BONUS = 1;

export type RelationshipKind = 'sworn' | 'spouse';

/** 读取武将的关系统计 */
export function officerRelationshipIds(officer: Officer): string[] {
  return Object.keys(officer.relationships ?? {});
}

/** 二人是否已结为关系（任意一方记录即可） */
export function areRelated(a: Officer, b: Officer): boolean {
  return !!(a.relationships?.[b.id] || b.relationships?.[a.id]);
}

/** 校验能否结为关系：同势力、同城待命、非君主、未结关系、夫妻须一男一女 */
export function relationshipValidation(
  state: GameState,
  forceId: ForceId,
  a: Officer,
  b: Officer,
  kind: RelationshipKind,
): string[] {
  const errors: string[] = [];
  if (a.id === b.id) errors.push('不能与自己结为关系');
  const leaderId = state.forces[forceId]?.leaderId;
  if (a.id === leaderId || b.id === leaderId) errors.push('君主不能参与仲介');
  if (a.forceId !== forceId || b.forceId !== forceId) errors.push('只能与己方武将结为关系');
  if (a.location.kind !== 'city' || b.location.kind !== 'city' || a.location.cityId !== b.location.cityId) {
    errors.push('双方必须同在本城待命');
  }
  if (areRelated(a, b)) errors.push('二人已结为关系');
  if (a.deathMonth || b.deathMonth) errors.push('已故武将无法结为关系');
  if (kind === 'spouse' && typeof a.gender === 'string' && typeof b.gender === 'string' && a.gender === b.gender) {
    errors.push('结婚双方须为一男一女');
  }
  return errors;
}

/** 结为关系的常用武将名单（同势力、同城、非君主、未婚配） */
export function relationCandidates(state: GameState, forceId: ForceId, cityId: string, self: Officer, kind: RelationshipKind): Officer[] {
  return Object.values(state.officers).filter((officer) => {
    if (officer.id === self.id) return false;
    if (officer.forceId !== forceId) return false;
    if (officer.location.kind !== 'city' || officer.location.cityId !== cityId) return false;
    if (state.forces[forceId]?.leaderId === officer.id) return false;
    if (officer.deathMonth) return false;
    if (areRelated(self, officer)) return false;
    if (kind === 'spouse' && typeof self.gender === 'string' && typeof officer.gender === 'string' && self.gender === officer.gender) {
      return false;
    }
    return true;
  });
}

/** 应用内助特技：婚后双方全部能力 +1 */
function applyInnerHelpBonus(a: Officer, b: Officer): void {
  const aHasInnerHelp = officerSkillNames(a).includes('内助');
  const bHasInnerHelp = officerSkillNames(b).includes('内助');
  if (!aHasInnerHelp && !bHasInnerHelp) return;
  for (const officer of [a, b]) {
    officer.stats.leadership += INNER_HELP_STAT_BONUS;
    officer.stats.war += INNER_HELP_STAT_BONUS;
    officer.stats.intelligence += INNER_HELP_STAT_BONUS;
    officer.stats.politics += INNER_HELP_STAT_BONUS;
    officer.stats.charisma += INNER_HELP_STAT_BONUS;
  }
}

/**
 * 执行结为关系的结算：
 * - 双向写入 relationships；
 * - 双方忠诚 +3；
 * - 内助特技持有者结婚后双方全能力 +1（配偶关系才会触发，且以结婚当时为准）。
 */
export function enterRelationship(state: GameState, a: Officer, b: Officer, kind: RelationshipKind): string[] {
  const messages: string[] = [];
  a.relationships = { ...(a.relationships ?? {}), [b.id]: kind };
  b.relationships = { ...(b.relationships ?? {}), [a.id]: kind };
  for (const officer of [a, b]) {
    const current = officerLoyalty(officer);
    if (current > 0) setOfficerLoyalty(officer, clampLoyalty(current + RELATIONSHIP_LOYALTY_BONUS));
  }
  if (kind === 'spouse') {
    const beforeA = { ...a.stats };
    const beforeB = { ...b.stats };
    applyInnerHelpBonus(a, b);
    const statsChanged = JSON.stringify(beforeA) !== JSON.stringify(a.stats) || JSON.stringify(beforeB) !== JSON.stringify(b.stats);
    if (statsChanged && officerSkillNames(a).includes('内助')) {
      messages.push(`${a.name}的「内助」令夫妻双方全能力+1`);
    }
  }
  return messages;
}

/** 武将是否拥有同势力内的配偶/义兄弟（存在即视为忠诚绑定） */
export function hasLoyaltyBond(officer: Officer, forceId: ForceId | null): boolean {
  if (!officer.forceId || officer.forceId !== forceId) return false;
  return officerRelationshipIds(officer).length > 0;
}

/** 关系类型的中文标签 */
export const RELATIONSHIP_LABELS: Record<RelationshipKind, string> = {
  sworn: '义兄弟',
  spouse: '夫妻',
};