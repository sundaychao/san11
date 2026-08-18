# 武将特技系统第一阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可扩展的原版一百种特技目录与规则框架，并接入强行、飞将、神将、连战、不屈、百出、火神、洞察、连环、筑城、乐奏、富豪、米道、名声、能吏十五种第一阶段效果。

**Architecture:** 特技目录只声明元数据和类型化效果，来源解析器负责汇总部队、驻城和命令武将，领域规则投影器负责修改移动、战斗、计略、设施、回合和城市结算。现有 `battle/actions.ts`、`GameIntent`、Socket.IO 协议和 `Officer.skill?: string` 保持兼容，所有随机效果继续使用游戏种子和游标。

**Tech Stack:** TypeScript 7、React 19、Vitest 4、Vite 8、现有纯函数游戏状态与 Socket.IO 联网归约器。

## Global Constraints

- 每名武将保留一项特技，继续使用现有 `Officer.skill?: string` 存档字段。
- 部队主将和所有副将的特技都生效；同名特技只结算一次并保留全部来源。
- 正在所属城市执行兵装生产任务的武将视为驻城；调动、出征和在野武将不视为驻城。
- 第一阶段之外的原版特技只登记目录，不伪造尚不存在的系统效果。
- 新特技模块不得依赖 React、DOM、音频、Socket.IO 或模块级可变状态。
- 不提升 `schemaVersion`，不修改联网 intent 字段和 Socket.IO 事件名称。
- 数值统一按基础值、加值、倍率、一次取整、上下限结算。
- 随机判定只在对应阶段需要时调用 `nextRandom`，本地与联网必须产生相同状态和 `rngCursor`。
- 每个行为修改都执行红、绿、重构的 TDD 循环，不顺带格式化或重构无关文件。

## File Map

```text
src/game/skills/
  types.ts                 类型化效果、状态、上下文
  registry.ts              原版与自定义目录查询
  sources.ts               部队、城市、命令来源解析
  stacking.ts              去重和效果查询
  conditions.ts            武力、智力和兵力条件判断
  index.ts                 稳定导出入口
  catalog/*.ts             九个原版展示类别和自定义目录
  rules/movement.ts        强行、飞将移动规则
  rules/combat.ts          神将、飞将、连战、不屈规则
  rules/strategy.ts        百出、火神、洞察规则
  rules/facility.ts        筑城规则
  rules/turn.ts            乐奏回合效果
  rules/city.ts            富豪、米道、名声、能吏规则
  handlers/chainStrategy.ts 连环后续效果
```

---

### Task 1: 建立一百种特技目录、类型和兼容注册表

**Files:**
- Create: `src/game/skills/types.ts`
- Create: `src/game/skills/registry.ts`
- Create: `src/game/skills/index.ts`
- Create: `src/game/skills/catalog/movement.ts`
- Create: `src/game/skills/catalog/attack.ts`
- Create: `src/game/skills/catalog/defense.ts`
- Create: `src/game/skills/catalog/strategy.ts`
- Create: `src/game/skills/catalog/support.ts`
- Create: `src/game/skills/catalog/domestic.ts`
- Create: `src/game/skills/catalog/income.ts`
- Create: `src/game/skills/catalog/disaster.ts`
- Create: `src/game/skills/catalog/relationship.ts`
- Create: `src/game/skills/catalog/custom.ts`
- Test: `src/game/skills/registry.test.ts`
- Modify: `src/game/battle/module-boundaries.test.ts`

**Interfaces:**
- Consumes: `TroopType`, `ArmamentType`, `GameCommand` from `src/game/types.ts`; `StrategyId` from `src/game/battle/strategies.ts` through type-only imports.
- Produces: `SkillDefinition`, `SkillEffect`, `ActiveSkill`, `skillDefinition(name: string): SkillDefinition | undefined`, `ORIGINAL_SKILLS`, `CUSTOM_SKILLS`.

- [ ] **Step 1: Write the failing catalog and boundary tests**

```ts
import { describe, expect, it } from 'vitest';
import { ORIGINAL_SKILLS, skillDefinition } from './registry';

describe('skill registry', () => {
  it('registers exactly one hundred original skills in the confirmed category counts', () => {
    expect(ORIGINAL_SKILLS).toHaveLength(100);
    expect(new Set(ORIGINAL_SKILLS.map((skill) => skill.name)).size).toBe(100);
    expect(Object.fromEntries(
      ['行军', '攻击', '防御', '计略', '辅助', '内政', '收入', '灾害', '关系'].map((category) => [
        category,
        ORIGINAL_SKILLS.filter((skill) => skill.displayCategory === category).length,
      ]),
    )).toEqual({ 行军: 9, 攻击: 35, 防御: 8, 计略: 20, 辅助: 7, 内政: 8, 收入: 4, 灾害: 8, 关系: 1 });
  });

  it('keeps known custom skills displayable without activating an undefined effect', () => {
    expect(skillDefinition('奸雄')).toMatchObject({ name: '奸雄', implementationStatus: 'planned', effects: [] });
    expect(skillDefinition('不存在的特技')).toBeUndefined();
  });
});
```

Add `skills` to the domain list in `module-boundaries.test.ts` and add this recursive boundary test:

```ts
it('keeps every skill module independent from frontend and networking', () => {
  const files = readdirSync('src/game/skills', { recursive: true })
    .filter((name): name is string => typeof name === 'string' && name.endsWith('.ts') && !name.endsWith('.test.ts'));
  for (const file of files) {
    const source = readFileSync(`src/game/skills/${file}`, 'utf8');
    expect(source).not.toMatch(/from ['"]react|window\.|document\.|soundEffects|socket\.io/);
  }
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `npm.cmd test -- src/game/skills/registry.test.ts src/game/battle/module-boundaries.test.ts`

Expected: FAIL because `src/game/skills/registry.ts` and the catalog do not exist.

- [ ] **Step 3: Add the exact type model**

```ts
import type { ArmamentType, GameCommand, TroopType } from '../types';
import type { StrategyId } from '../battle/strategies';

export type SkillDisplayCategory = '行军' | '攻击' | '防御' | '计略' | '辅助' | '内政' | '收入' | '灾害' | '关系';
export type SkillImplementationStatus = 'active' | 'planned' | 'blocked';
export type SkillSystemDependency = 'navy' | 'capture' | 'injury' | 'treasure' | 'technique' | 'diplomacy' | 'loyalty' | 'marriage' | 'tribe';
export type SkillCondition =
  | { kind: 'always' }
  | { kind: 'targetWarLower' }
  | { kind: 'targetIntelligenceLower' }
  | { kind: 'troopsBelow'; amount: number };

export type SkillEffect =
  | { kind: 'movementAllowance'; add: number; troopTypes?: TroopType[]; excludeKinds?: Array<'transport'> }
  | { kind: 'ignoreEnemyZoc'; terrain: 'land' | 'water' }
  | { kind: 'tacticCritical'; condition: SkillCondition; troopTypes?: TroopType[]; excludeTroopTypes?: TroopType[] }
  | { kind: 'normalAttackCritical'; condition: SkillCondition }
  | { kind: 'repeatNormalAttack'; chance: number }
  | { kind: 'negateIncomingDamage'; chance: number; condition: SkillCondition; sources: Array<'normalAttack' | 'counter' | 'tactic'> }
  | { kind: 'strategyEnergyCost'; set: number }
  | { kind: 'strategyGuaranteed'; strategyIds: StrategyId[]; condition: SkillCondition }
  | { kind: 'strategyImmunity'; strategyIds: StrategyId[] | 'all' }
  | { kind: 'fireDamageMultiplier'; multiplier: number }
  | { kind: 'buildPowerMultiplier'; multiplier: number }
  | { kind: 'turnStartEnergy'; add: number }
  | { kind: 'commandYieldMultiplier'; command: GameCommand['type']; multiplier: number; armamentTypes?: ArmamentType[] }
  | { kind: 'cityIncomeMultiplier'; resource: 'gold' | 'food'; multiplier: number }
  | { kind: 'complexHandler'; handler: 'chainStrategy' };

export interface SkillDefinition {
  name: string;
  displayCategory: SkillDisplayCategory;
  description: string;
  implementationStatus: SkillImplementationStatus;
  effects: SkillEffect[];
  blockedBy?: SkillSystemDependency[];
}

export interface ActiveSkill {
  definition: SkillDefinition;
  sourceOfficerIds: string[];
}
```

- [ ] **Step 4: Add all original names and descriptions, with only confirmed first-stage effects declared**

Use one catalog file per display category. The exact name lists are:

```ts
export const ORIGINAL_SKILL_NAMES = {
  行军: ['飞将', '遁走', '强行', '长驱', '推进', '操舵', '踏破', '运搬', '解毒'],
  攻击: ['扫讨', '威风', '昂扬', '连战', '急袭', '强袭', '乱战', '攻城', '掎角', '捕缚', '精妙', '强夺', '心攻', '驱逐', '射程', '白马', '辅佐', '枪将', '戟将', '弓将', '骑将', '水将', '勇将', '神将', '斗神', '枪神', '戟神', '弓神', '骑神', '工神', '水神', '霸王', '疾走', '射手', '猛者'],
  防御: ['不屈', '金刚', '铁壁', '怒发', '藤甲', '强运', '血路', '护卫'],
  计略: ['待伏', '火攻', '言毒', '机智', '诡计', '虚实', '妙计', '秘计', '看破', '洞察', '火神', '神算', '百出', '鬼谋', '连环', '深谋', '反计', '倾国', '妖术', '鬼门'],
  辅助: ['规律', '沉着', '明镜', '乐奏', '诗想', '筑城', '屯田'],
  内政: ['名声', '能吏', '繁殖', '发明', '造船', '指导', '眼力', '论客'],
  收入: ['富豪', '米道', '征税', '征收'],
  灾害: ['亲乌', '亲羌', '亲越', '亲蛮', '威压', '仁政', '风水', '祈祷'],
  关系: ['内助'],
} as const;
```

Use these exact effect descriptions for the catalog; first-stage definitions start as `planned` and carry their typed effects so later tasks only switch status after integration:

```ts
export const ORIGINAL_SKILL_DESCRIPTIONS: Record<string, string> = {
  飞将: '陆地移动忽略敌方ZOC；对武力较低目标成功施展非兵器陆战战法时必定暴击', 遁走: '陆地移动忽略敌方ZOC', 强行: '非兵器、非运输陆地部队移动力增加5', 长驱: '骑兵移动力增加', 推进: '水上移动忽略敌方ZOC', 操舵: '水上移动力增加', 踏破: '降低栈道、落石等地形伤害', 运搬: '运输部队移动力增加', 解毒: '免受毒泉伤害',
  扫讨: '攻击时降低敌方少量气力', 威风: '攻击时降低敌方大量气力', 昂扬: '击破敌军后恢复气力', 连战: '普通攻击有50%概率连续攻击两次', 急袭: '陆地普通攻击时有50%概率不受反击伤害', 强袭: '水上普通攻击时有50%概率不受反击伤害', 乱战: '森林地形攻击时必定暴击', 攻城: '增加对城市和设施的耐久伤害', 掎角: '一齐攻击时有概率使敌军混乱', 捕缚: '击破敌军时必定俘虏敌将', 精妙: '击破敌军获得双倍技巧值', 强夺: '击破敌军时夺取敌将宝物', 心攻: '攻击时吸收敌军部分士兵', 驱逐: '普通攻击武力较低目标时必定暴击', 射程: '井阑和投石射程增加1', 白马: '骑兵未研究骑射时仍可远程攻击', 辅佐: '不受人际关系限制发动支援攻击', 枪将: '枪兵战法攻击武力较低目标时必定暴击', 戟将: '戟兵战法攻击武力较低目标时必定暴击', 弓将: '弩兵战法攻击武力较低目标时必定暴击', 骑将: '骑兵战法攻击武力较低目标时必定暴击', 水将: '水军战法攻击武力较低目标时必定暴击', 勇将: '全部战法攻击武力较低目标时必定暴击', 神将: '普通攻击和全部战法攻击武力较低目标时必定暴击', 斗神: '枪兵和戟兵战法必定暴击', 枪神: '枪兵战法必定暴击', 戟神: '戟兵战法必定暴击', 弓神: '弩兵战法必定暴击', 骑神: '骑兵战法必定暴击', 工神: '兵器战法必定暴击', 水神: '水军战法必定暴击', 霸王: '全部战法必定暴击', 疾走: '骑兵战法攻击能力较低目标时必定使其混乱', 射手: '弩兵可对森林中的目标施展战法', 猛者: '攻击时有50%概率使敌将负伤',
  不屈: '兵力少于3000时有50%概率免除受到的攻击伤害', 金刚: '受到少量伤害时有50%概率完全免除', 铁壁: '一齐攻击只按一次普通攻击处理', 怒发: '受到敌方战法后恢复气力', 藤甲: '降低非火伤害但增加火焰伤害', 强运: '部队武将不会战死、负伤或被俘', 血路: '部队被击破时同部队武将不会被俘', 护卫: '同部队武将不会战死或负伤',
  待伏: '伏兵成功时必定暴击', 火攻: '对智力较低目标施放火计必定成功', 言毒: '对智力较低目标施放伪报必定成功', 机智: '对智力较低目标施放扰乱必定成功', 诡计: '对智力较低目标施放内讧必定成功', 虚实: '对智力较低目标施放敌对计略必定成功', 妙计: '敌军对本部队施放计略失败后陷入混乱', 秘计: '对智力较高目标计略成功时必定暴击', 看破: '必定识破智力较低敌军的计略', 洞察: '免疫全部敌方部队计略', 火神: '强化火计成功率和伤害并免疫敌方火计', 神算: '对智力较低目标的计略必定成功并获得计略优待', 百出: '使用计略时气力消耗固定为1', 鬼谋: '计略施放距离增加1', 连环: '敌对计略成功后波及与目标相邻的敌军', 深谋: '敌对计略成功时必定暴击', 反计: '识破敌方计略后将计略反作用于敌军', 倾国: '提高对非女性武将部队的计略成功率', 妖术: '可以使用妖术', 鬼门: '可以使用妖术和落雷',
  规律: '免疫伪报', 沉着: '免疫扰乱', 明镜: '免疫伪报和扰乱', 乐奏: '所属势力回合开始前恢复5点气力', 诗想: '军乐台气力恢复效果加倍', 筑城: '建设和修补设施的耐久增加量加倍', 屯田: '驻扎关所或港口时降低粮食消耗',
  名声: '执行征兵时增加征兵量', 能吏: '执行枪、戟、弩兵装生产时增加产量', 繁殖: '执行军马生产时增加产量', 发明: '缩短兵器生产周期', 造船: '缩短舰船生产周期', 指导: '降低技巧研究费用', 眼力: '搜索时必定发现城市中的在野人才', 论客: '提高同盟、停战和俘虏交换时的舌战效果',
  富豪: '所属城市每月金收入变为1.5倍', 米道: '所属城市每季度粮食收入变为1.5倍', 征税: '所属城市改为每旬获得月金收入的一半', 征收: '所属城市每月获得季度粮食收入的一半',
  亲乌: '降低所属城市领内乌丸据点带来的危害', 亲羌: '降低所属城市领内羌族据点带来的危害', 亲越: '降低所属城市领内山越据点带来的危害', 亲蛮: '降低所属城市领内南蛮据点带来的危害', 威压: '所属城市领内不会出现贼军和异民族据点', 仁政: '所属城市武将忠诚度不会降低', 风水: '所属城市免疫疫病', 祈祷: '提高所属城市发生丰收的概率',
  内助: '结婚后夫妻双方全部能力增加1',
};
```

```ts
const firstStageEffects: Record<string, SkillEffect[]> = {
  强行: [{ kind: 'movementAllowance', add: 5, excludeKinds: ['transport'], troopTypes: ['sword', 'spear', 'halberd', 'crossbow', 'cavalry'] }],
  飞将: [
    { kind: 'ignoreEnemyZoc', terrain: 'land' },
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, excludeTroopTypes: ['siege'] },
  ],
  神将: [
    { kind: 'normalAttackCritical', condition: { kind: 'targetWarLower' } },
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' } },
  ],
  连战: [{ kind: 'repeatNormalAttack', chance: 0.5 }],
  不屈: [{ kind: 'negateIncomingDamage', chance: 0.5, condition: { kind: 'troopsBelow', amount: 3000 }, sources: ['normalAttack', 'counter', 'tactic'] }],
  百出: [{ kind: 'strategyEnergyCost', set: 1 }],
  火神: [
    { kind: 'strategyGuaranteed', strategyIds: ['fire'], condition: { kind: 'targetIntelligenceLower' } },
    { kind: 'fireDamageMultiplier', multiplier: 2 },
    { kind: 'strategyImmunity', strategyIds: ['fire'] },
  ],
  洞察: [{ kind: 'strategyImmunity', strategyIds: 'all' }],
  连环: [{ kind: 'complexHandler', handler: 'chainStrategy' }],
  筑城: [{ kind: 'buildPowerMultiplier', multiplier: 2 }],
  乐奏: [{ kind: 'turnStartEnergy', add: 5 }],
  富豪: [{ kind: 'cityIncomeMultiplier', resource: 'gold', multiplier: 1.5 }],
  米道: [{ kind: 'cityIncomeMultiplier', resource: 'food', multiplier: 1.5 }],
  名声: [{ kind: 'commandYieldMultiplier', command: 'recruit', multiplier: 1.5 }],
  能吏: [{ kind: 'commandYieldMultiplier', command: 'produceArmament', multiplier: 1.5, armamentTypes: ['spear', 'halberd', 'crossbow'] }],
};
```

Use this dependency map when assigning `blocked` entries; other unimplemented entries remain `planned`:

```ts
const BLOCKED_BY: Partial<Record<string, SkillSystemDependency[]>> = {
  推进: ['navy'], 操舵: ['navy'], 强袭: ['navy'], 水将: ['navy'], 水神: ['navy'],
  捕缚: ['capture'], 强运: ['capture', 'injury'], 血路: ['capture'], 护卫: ['injury'], 猛者: ['injury'],
  强夺: ['treasure'], 精妙: ['technique'], 指导: ['technique'], 论客: ['diplomacy'],
  仁政: ['loyalty'], 内助: ['marriage'],
  亲乌: ['tribe'], 亲羌: ['tribe'], 亲越: ['tribe'], 亲蛮: ['tribe'], 威压: ['tribe'],
};
```

Register current custom names `奸雄、坚守、王佐、刚将、仁德、白毦、明君` as `planned` with empty effects and descriptions `项目自定义特技，效果将在单独规则设计中启用`.

- [ ] **Step 5: Implement immutable lookup and public exports**

```ts
const definitions = [...ORIGINAL_SKILLS, ...CUSTOM_SKILLS];
const byName = new Map(definitions.map((definition) => [definition.name, definition]));

export function skillDefinition(name: string) {
  return byName.get(name);
}
```

Export registry and type APIs from `src/game/skills/index.ts`. Do not export mutable maps.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm.cmd test -- src/game/skills/registry.test.ts src/game/battle/module-boundaries.test.ts`

Expected: PASS with 100 unique original skills and no frontend/network dependency.

```powershell
git add src/game/skills src/game/battle/module-boundaries.test.ts
git commit -m "feat: add typed officer skill catalog"
```

---

### Task 2: 解析主副将、驻城武将和命令武将的特技来源

**Files:**
- Create: `src/game/skills/sources.ts`
- Create: `src/game/skills/stacking.ts`
- Create: `src/game/skills/conditions.ts`
- Test: `src/game/skills/sources.test.ts`
- Modify: `src/game/skills/index.ts`

**Interfaces:**
- Consumes: `skillDefinition(name)`, `GameState`, `ArmyUnit`, `CityId`, `GameCommand`.
- Produces: `resolveOfficerSkills`, `resolveUnitSkills`, `resolveCitySkills`, `resolveCommandSkills`, `effectsOfKind`, `hasActiveSkill`, `skillConditionMatches`.

- [ ] **Step 1: Write failing source-resolution tests**

```ts
function unit(id: string, forceId: ForceId, leaderId: string, officerIds: string[]): ArmyUnit {
  return {
    id, kind: 'combat', forceId, leaderId, officerIds, homeCityId: 'jiangling', troopType: 'spear',
    q: 10, r: 10, troops: 4000, food: 4000, energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
}

it('combines leader and deputies, deduplicates a skill, and keeps every source', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '神将';
  state.officers['guan-yu'].skill = '神将';
  state.units.test = unit('test', 'liu', 'liu-bei', ['liu-bei', 'guan-yu']);
  expect(resolveUnitSkills(state, state.units.test)).toEqual([
    expect.objectContaining({ definition: expect.objectContaining({ name: '神将' }), sourceOfficerIds: ['liu-bei', 'guan-yu'] }),
  ]);
});

it('counts city and local production-task officers but excludes units, transfers, enemies, and unaffiliated officers', () => {
  const state = createGame('sun', 1);
  state.officers['lu-su'].skill = '富豪';
  state.officers['zhou-yu'].skill = '米道';
  state.officers['zhou-yu'].location = { kind: 'task', cityId: 'changsha', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 2 };
  state.officers['zhao-yun'].skill = '富豪';
  state.officers['zhao-yun'].location = { kind: 'unaffiliated', cityId: 'changsha' };
  expect(resolveCitySkills(state, 'changsha').map((skill) => skill.definition.name)).toEqual(['富豪', '米道']);
});

it('uses only the command officer for command-scoped skills', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '名声';
  state.officers['guan-yu'].skill = '能吏';
  expect(resolveCommandSkills(state, { type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei' }).map((skill) => skill.definition.name)).toEqual(['名声']);
});
```

- [ ] **Step 2: Run and verify red**

Run: `npm.cmd test -- src/game/skills/sources.test.ts`

Expected: FAIL because source resolver exports do not exist.

- [ ] **Step 3: Implement formation-order resolution and deduplication**

```ts
export function resolveOfficerSkills(state: GameState, officerIds: string[]): ActiveSkill[] {
  const byName = new Map<string, ActiveSkill>();
  for (const officerId of [...new Set(officerIds)]) {
    const officer = state.officers[officerId];
    const definition = officer?.skill ? skillDefinition(officer.skill) : undefined;
    if (!officer || !definition || definition.implementationStatus === 'blocked') continue;
    const active = byName.get(definition.name);
    if (active) active.sourceOfficerIds.push(officerId);
    else byName.set(definition.name, { definition, sourceOfficerIds: [officerId] });
  }
  return [...byName.values()];
}

export function resolveUnitSkills(state: GameState, unit: ArmyUnit) {
  return resolveOfficerSkills(state, [unit.leaderId, ...(unit.officerIds ?? [])]);
}
```

`resolveCitySkills` filters matching force and `city`/`task` location before calling `resolveOfficerSkills`. `resolveCommandSkills` returns `[]` for transfer commands and otherwise calls `resolveOfficerSkills(state, [command.officerId])`.

- [ ] **Step 4: Add typed effect helpers**

```ts
export function effectsOfKind<K extends SkillEffect['kind']>(skills: ActiveSkill[], kind: K) {
  return skills.flatMap((skill) => skill.definition.implementationStatus !== 'active' ? [] : skill.definition.effects
    .filter((effect): effect is Extract<SkillEffect, { kind: K }> => effect.kind === kind)
    .map((effect) => ({ effect, skill })));
}

export function hasActiveSkill(skills: ActiveSkill[], name: string) {
  return skills.some((skill) => skill.definition.name === name && skill.definition.implementationStatus === 'active');
}
```

Add the shared condition evaluator to `conditions.ts`:

```ts
export function skillConditionMatches(
  state: GameState,
  condition: SkillCondition,
  actor: ArmyUnit,
  target?: ArmyUnit,
) {
  if (condition.kind === 'always') return true;
  if (condition.kind === 'troopsBelow') return actor.troops < condition.amount;
  if (!target) return false;
  const actorAbilities = effectiveUnitAbilities(state, actor);
  const targetAbilities = effectiveUnitAbilities(state, target);
  if (condition.kind === 'targetWarLower') return targetAbilities.war.value < actorAbilities.war.value;
  return targetAbilities.intelligence.value < actorAbilities.intelligence.value;
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd test -- src/game/skills/sources.test.ts src/game/skills/registry.test.ts`

Expected: PASS.

```powershell
git add src/game/skills
git commit -m "feat: resolve formation and city skill sources"
```

---

### Task 3: 接入强行和飞将的移动规则

**Files:**
- Create: `src/game/skills/rules/movement.ts`
- Test: `src/game/skills/rules/movement.test.ts`
- Modify: `src/game/battle/legacyCore.ts`
- Modify: `src/game/battle/deployment.ts`
- Modify: `src/game/turn.ts`
- Modify: `src/components/GameShell.tsx`
- Modify: `src/game/skills/catalog/movement.ts`
- Modify: `src/game/skills/index.ts`
- Test: `src/game/battle/actions.test.ts`
- Test: `src/components/command-ui.test.tsx`

**Interfaces:**
- Consumes: `resolveUnitSkills`, `effectsOfKind`, base `movementAllowanceForUnit(unit)`.
- Produces: `movementAllowanceBonus`, `formationMovementAllowanceBonus`, `unitIgnoresEnemyZoc`.

- [ ] **Step 1: Write failing rule tests for eligibility**

```ts
function stateWithSkillUnit(skill: string, troopType: TroopType) {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = skill;
  state.units.test = {
    id: 'test', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
    homeCityId: 'jiangling', troopType, q: 0, r: 0, troops: 4000, food: 4000,
    energy: 100, movementRemaining: 30, moved: false, acted: false,
  };
  return state;
}

it('adds five movement to a combat land formation with 强行 but not siege or transport', () => {
  const state = stateWithSkillUnit('强行', 'spear');
  expect(movementAllowanceBonus(state, state.units.test)).toBe(5);
  state.units.test.troopType = 'siege';
  expect(movementAllowanceBonus(state, state.units.test)).toBe(0);
  state.units.test.kind = 'transport';
  expect(movementAllowanceBonus(state, state.units.test)).toBe(0);
});

it('lets 飞将 ignore enemy zoc without changing occupied-cell blocking', () => {
  const state = stateWithSkillUnit('飞将', 'spear');
  expect(unitIgnoresEnemyZoc(state, state.units.test)).toBe(true);
});
```

Add these integration tests:

```ts
it('resets a 强行 formation to base movement plus five', () => {
  const state = stateWithSkillUnit('强行', 'spear');
  state.units.test.movementRemaining = 0;
  state.units.test.moved = true;
  const next = settleTenDay(state);
  expect(next.units.test.movementRemaining).toBe(movementAllowanceForUnit(next.units.test) + 5);
});

it('allows 飞将 to continue through an enemy zoc while ordinary formations stop there', () => {
  const state = stateWithSkillUnit('飞将', 'spear');
  state.units.test.q = 0;
  state.units.test.r = 0;
  state.units.enemy = {
    id: 'enemy', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
    homeCityId: 'xiangyang', troopType: 'spear', q: 1, r: 1, troops: 4000, food: 4000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  state.grid = [
    { q: 0, r: 0, terrain: 'road' }, { q: 1, r: 0, terrain: 'road' },
    { q: 2, r: 0, terrain: 'road' }, { q: 1, r: 1, terrain: 'road' },
  ];
  expect(movementCells(state, 'test')).toContainEqual({ q: 2, r: 0 });
  state.officers['liu-bei'].skill = '无';
  expect(movementCells(state, 'test')).not.toContainEqual({ q: 2, r: 0 });
});

it('uses selected officer movement skills in deployment validation', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '强行';
  const base = deploymentCells(state, 'jiangling', movementAllowanceForProfile('spear'), 'spear');
  const enhanced = deploymentCells(state, 'jiangling', movementAllowanceForProfile('spear') + 5, 'spear');
  const destination = enhanced.find((coord) => !base.some((cell) => cell.q === coord.q && cell.r === coord.r));
  expect(destination).toBeDefined();
  expect(() => deployUnit(state, 'liu', {
    cityId: 'jiangling', officerIds: ['liu-bei'], troopType: 'spear', troops: 3000, food: 3000,
    destination,
  })).not.toThrow();
});
```

- [ ] **Step 2: Run and verify red**

Run: `npm.cmd test -- src/game/skills/rules/movement.test.ts src/game/battle/actions.test.ts`

Expected: FAIL because movement skill rules are not connected.

- [ ] **Step 3: Implement pure movement projections**

```ts
export function movementAllowanceBonus(state: GameState, unit: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, unit), 'movementAllowance')
    .filter(({ effect }) => unit.kind !== 'transport' && (!effect.troopTypes || effect.troopTypes.includes(unit.troopType ?? 'sword')))
    .reduce((sum, { effect }) => sum + effect.add, 0);
}

export function unitIgnoresEnemyZoc(state: GameState, unit: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, unit), 'ignoreEnemyZoc')
    .some(({ effect }) => effect.terrain === 'land');
}

export function formationMovementAllowanceBonus(
  state: GameState,
  officerIds: string[],
  troopType: TroopType,
  kind: 'combat' | 'transport' = 'combat',
) {
  return effectsOfKind(resolveOfficerSkills(state, officerIds), 'movementAllowance')
    .filter(({ effect }) => kind !== 'transport' && (!effect.troopTypes || effect.troopTypes.includes(troopType)))
    .reduce((sum, { effect }) => sum + effect.add, 0);
}
```

- [ ] **Step 4: Connect movement reset, pathfinding and deployment**

In `reachableCostsFrom`, add `ignoreEnemyZoc?: boolean` and use an empty ZOC set when true. Pass `unitIgnoresEnemyZoc(state, unit)` from `reachableCosts`.

In `settleUnitSupply`, set:

```ts
unit.movementRemaining = movementAllowanceForUnit(unit) + movementAllowanceBonus(next, unit);
```

In `deployUnit` and `GameShell` deployment target calculation, pass `movementAllowanceForProfile(troopType) + formationMovementAllowanceBonus(...)` to `deploymentCells`. Server validation and preview must use the same officer list and allowance.

- [ ] **Step 5: Mark both catalog entries active and run focused UI/rule tests**

Run: `npm.cmd test -- src/game/skills/rules/movement.test.ts src/game/battle/actions.test.ts src/components/command-ui.test.tsx`

Expected: PASS; ordinary movement and deployment tests remain unchanged.

- [ ] **Step 6: Commit**

```powershell
git add src/game/skills src/game/battle/legacyCore.ts src/game/battle/deployment.ts src/game/turn.ts src/components/GameShell.tsx src/game/battle/actions.test.ts src/components/command-ui.test.tsx
git commit -m "feat: apply movement officer skills"
```

---

### Task 4: 接入神将、飞将、连战和不屈的战斗规则

**Files:**
- Create: `src/game/skills/rules/combat.ts`
- Test: `src/game/skills/rules/combat.test.ts`
- Modify: `src/game/battle/combat.ts`
- Modify: `src/game/battle/legacyCore.ts`
- Modify: `src/game/skills/catalog/attack.ts`
- Modify: `src/game/skills/catalog/defense.ts`
- Modify: `src/game/skills/catalog/movement.ts`
- Test: `src/game/battle/actions.test.ts`
- Test: `src/game/network/intentReducer.test.ts`

**Interfaces:**
- Consumes: effective formation war, active skill effects, `nextRandom`, existing `damageRoll` and tactic critical chance.
- Produces: `normalAttackIsCritical`, `tacticCriticalMode`, `rollRepeatNormalAttack`, `reduceIncomingDamageBySkills`.

- [ ] **Step 1: Write failing combat projection and integration tests**

```ts
function combatFixture(attackerSkill: string) {
  const state = createGame('liu', 1);
  state.officers['guan-yu'].skill = attackerSkill;
  state.officers['guan-yu'].location = { kind: 'unit', unitId: 'attacker' };
  state.units.attacker = {
    id: 'attacker', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
    homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 6000, food: 6000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  state.units.weaker = {
    id: 'weaker', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
    homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 6000, food: 6000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  state.officers['cao-ren'].stats.war = 60;
  state.officers['xiahou-dun'].location = { kind: 'unit', unitId: 'stronger' };
  state.units.stronger = {
    ...state.units.weaker, id: 'stronger', leaderId: 'xiahou-dun', officerIds: ['xiahou-dun'], q: 10, r: 11,
  };
  state.officers['xiahou-dun'].stats.war = 100;
  return { state, attacker: state.units.attacker, weaker: state.units.weaker, stronger: state.units.stronger };
}

it('guarantees 神将 normal and tactic criticals only against lower-war targets', () => {
  const { state, attacker, weaker, stronger } = combatFixture('神将');
  expect(normalAttackIsCritical(state, attacker, weaker)).toBe(true);
  expect(tacticCriticalMode(state, attacker, weaker, 'spear-thrust')).toBe('guaranteed');
  expect(normalAttackIsCritical(state, attacker, stronger)).toBe(false);
});

it('limits 飞将 guaranteed critical to non-siege tactics against lower-war targets', () => {
  const fixture = combatFixture('飞将');
  expect(tacticCriticalMode(fixture.state, fixture.attacker, fixture.weaker, 'spear-thrust')).toBe('guaranteed');
  fixture.attacker.troopType = 'siege';
  expect(tacticCriticalMode(fixture.state, fixture.attacker, fixture.weaker, 'spear-thrust')).toBe('normal');
});
```

Add these action-level assertions:

```ts
it('reports 神将 normal attacks as critical against lower-war targets', () => {
  const { state } = combatFixture('神将');
  delete state.units.stronger;
  const next = attackUnit(state, 'liu', 'attacker', 'weaker');
  expect(next.battleDamageReports?.[0]).toMatchObject({ unitId: 'weaker', critical: true, label: '暴击' });
});

it('resolves 连战 twice but spends energy and counters once', () => {
  const { state } = combatFixture('连战');
  delete state.units.stronger;
  state.seed = 1;
  state.units.weaker.troops = 10000;
  const next = attackUnit(state, 'liu', 'attacker', 'weaker');
  expect(next.battleDamageReports?.filter((report) => report.unitId === 'weaker')).toHaveLength(2);
  expect(next.battleDamageReports?.filter((report) => report.kind === 'counter')).toHaveLength(1);
  expect(next.units.attacker.energy).toBe(90);
});

it('lets 不屈 negate eligible damage below three thousand troops only', () => {
  const { state } = combatFixture('无');
  delete state.units.stronger;
  state.officers['cao-ren'].skill = '不屈';
  state.units.weaker.troops = 2999;
  state.seed = 1;
  const protectedState = attackUnit(state, 'liu', 'attacker', 'weaker');
  expect(protectedState.units.weaker.troops).toBe(2999);
  expect(protectedState.battleDamageReports?.[0].amount).toBe(0);

  state.units.weaker.troops = 3000;
  const ordinaryState = attackUnit(state, 'liu', 'attacker', 'weaker');
  expect(ordinaryState.units.weaker.troops).toBeLessThan(3000);
});
```

For an area tactic test, give two affected defenders `不屈`, set both below 3000, and assert `rngCursor` equals one critical roll plus one damage roll and one defense roll per affected target. This exact cursor count prevents accidental shared or eager defense rolls.

- [ ] **Step 2: Run and verify red**

Run: `npm.cmd test -- src/game/skills/rules/combat.test.ts src/game/battle/actions.test.ts`

Expected: FAIL on missing rule functions and unchanged combat results.

- [ ] **Step 3: Implement condition evaluation and combat projections**

```ts
export function normalAttackIsCritical(state: GameState, attacker: ArmyUnit, target: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, attacker), 'normalAttackCritical')
    .some(({ effect }) => skillConditionMatches(state, effect.condition, attacker, target));
}

export function tacticCriticalMode(state: GameState, attacker: ArmyUnit, target: ArmyUnit, _tacticId: TacticId): 'normal' | 'guaranteed' {
  const guaranteed = effectsOfKind(resolveUnitSkills(state, attacker), 'tacticCritical')
    .filter(({ effect }) => !effect.troopTypes || effect.troopTypes.includes(attacker.troopType ?? 'sword'))
    .filter(({ effect }) => !effect.excludeTroopTypes?.includes(attacker.troopType ?? 'sword'))
    .some(({ effect }) => skillConditionMatches(state, effect.condition, attacker, target));
  return guaranteed ? 'guaranteed' : 'normal';
}

export function rollRepeatNormalAttack(state: GameState, attacker: ArmyUnit) {
  const chance = effectsOfKind(resolveUnitSkills(state, attacker), 'repeatNormalAttack')
    .reduce((highest, { effect }) => Math.max(highest, effect.chance), 0);
  if (chance === 0) return false;
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return roll.value < chance;
}

export function reduceIncomingDamageBySkills(
  state: GameState,
  target: ArmyUnit,
  damage: number,
  source: 'normalAttack' | 'counter' | 'tactic',
) {
  const chance = effectsOfKind(resolveUnitSkills(state, target), 'negateIncomingDamage')
    .filter(({ effect }) => effect.sources.includes(source) && skillConditionMatches(state, effect.condition, target))
    .reduce((highest, { effect }) => Math.max(highest, effect.chance), 0);
  if (chance === 0) return damage;
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return roll.value < chance ? 0 : damage;
}
```

`normalAttackIsCritical` and `tacticCriticalMode` use boolean OR semantics. `reduceIncomingDamageBySkills` only examines `normalAttack`, `counter`, and `tactic`; ground fire and direct facility damage are not eligible for 不屈.

- [ ] **Step 4: Connect the fixed combat pipeline**

For normal attacks: validate, calculate critical, roll first damage, apply defense, report, roll 连战 only if the first hit did not defeat the target, optionally apply the second hit, then counter once. Energy and acted state change once.

For tactics: if `tacticCriticalMode` is guaranteed, do not consume the ordinary critical RNG; otherwise keep the existing critical roll. Apply one action-level critical result to all affected units. Call `reduceIncomingDamageBySkills` separately for each target damage instance.

- [ ] **Step 5: Run focused and local/intent parity tests**

Run: `npm.cmd test -- src/game/skills/rules/combat.test.ts src/game/battle/actions.test.ts src/game/network/intentReducer.test.ts`

Expected: PASS with identical direct and intent-reduced state for the same seed.

- [ ] **Step 6: Mark four entries active and commit**

```powershell
git add src/game/skills src/game/battle/combat.ts src/game/battle/legacyCore.ts src/game/battle/actions.test.ts src/game/network/intentReducer.test.ts
git commit -m "feat: apply combat officer skills"
```

---

### Task 5: 接入百出、火神、洞察和连环的计略规则

**Files:**
- Create: `src/game/skills/rules/strategy.ts`
- Create: `src/game/skills/handlers/chainStrategy.ts`
- Create: `src/game/skills/handlers/index.ts`
- Test: `src/game/skills/rules/strategy.test.ts`
- Modify: `src/game/battle/legacyCore.ts`
- Modify: `src/game/battle/strategies.ts`
- Modify: `src/components/GameShell.tsx`
- Modify: `src/game/skills/catalog/strategy.ts`
- Test: `src/game/battle/actions.test.ts`
- Test: `src/components/command-ui.test.tsx`
- Test: `src/game/network/session.test.ts`

**Interfaces:**
- Consumes: strategy definition, effective intelligence, active skill effects and the existing deterministic random stream.
- Produces: `strategyEnergyCostForUnit`, `resolveStrategySkillRules`, `applyChainStrategyEffect`.

- [ ] **Step 1: Write failing strategy rule tests**

```ts
function strategyFixture(casterSkill = '无', targetSkill = '无') {
  const state = createGame('liu', 1);
  state.officers['zhuge-liang'].skill = casterSkill;
  state.officers['zhuge-liang'].location = { kind: 'unit', unitId: 'caster' };
  state.officers['cao-ren'].skill = targetSkill;
  state.officers['cao-ren'].location = { kind: 'unit', unitId: 'target' };
  state.units.caster = {
    id: 'caster', kind: 'combat', forceId: 'liu', leaderId: 'zhuge-liang', officerIds: ['zhuge-liang'],
    homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 5000, food: 5000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  state.units.target = {
    id: 'target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
    homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 5000, food: 5000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  return { state, caster: state.units.caster, target: state.units.target };
}

it('sets every existing strategy cost to one for 百出', () => {
  const state = strategyFixture('百出');
  expect(strategyEnergyCostForUnit(state, 'caster', 'fire')).toBe(1);
  expect(strategyEnergyCostForUnit(state, 'caster', 'disturb')).toBe(1);
});

it('guarantees 火神 fire against lower intelligence and blocks hostile fire against 火神', () => {
  const attack = strategyFixture('火神');
  expect(resolveStrategySkillRules(attack.state, attack.caster, attack.target, 'fire', 10)).toMatchObject({ guaranteed: true, immune: false, fireDamageMultiplier: 2 });
  const defense = strategyFixture(undefined, '火神');
  expect(resolveStrategySkillRules(defense.state, defense.caster, defense.target, 'fire', 10).immune).toBe(true);
});

it('makes 洞察 immune to all currently implemented hostile unit strategies', () => {
  const fixture = strategyFixture(undefined, '洞察');
  expect(resolveStrategySkillRules(fixture.state, fixture.caster, fixture.target, 'disturb', 15).immune).toBe(true);
});
```

Add these integration tests:

```ts
it('allows 百出 to cast with one energy and spends exactly one', () => {
  const { state } = strategyFixture('百出');
  state.units.caster.energy = 1;
  const next = useUnitStrategy(state, 'liu', 'caster', 'disturb', { targetUnitId: 'target' });
  expect(next.units.caster).toMatchObject({ energy: 0, acted: true });
});

it('doubles only 火神 immediate fire damage and leaves later ground ticks unchanged', () => {
  const { state } = strategyFixture('火神');
  state.officers['cao-ren'].stats.intelligence = 1;
  const ignited = useUnitStrategy(state, 'liu', 'caster', 'fire', { coord: { q: 11, r: 10 } });
  expect(ignited.units.target.troops).toBe(4000);
  const nextTenDay = settleTenDay(ignited);
  expect(nextTenDay.units.target.troops).toBe(3500);
});

it('spends the hostile caster action when 火神 or 洞察 rejects a strategy', () => {
  for (const [skill, strategyId, expectedEnergy] of [['火神', 'fire', 90], ['洞察', 'disturb', 85]] as const) {
    const { state } = strategyFixture('无', skill);
    const next = useUnitStrategy(state, 'liu', 'caster', strategyId,
      strategyId === 'fire' ? { coord: { q: 11, r: 10 } } : { targetUnitId: 'target' });
    expect(next.units.caster).toMatchObject({ energy: expectedEnergy, acted: true });
    expect(next.strategyResultReports?.[0].succeeded).toBe(false);
    expect(next.firePlots ?? []).not.toContainEqual(expect.objectContaining({ q: 11, r: 10 }));
    expect(next.units.target.confusedTenDays).toBeUndefined();
  }
});

it('chains one successful disturb outcome without extra cost or success rolls', () => {
  const { state } = strategyFixture('连环');
  state.officers['zhuge-liang'].stats.intelligence = 100;
  state.officers['cao-ren'].stats.intelligence = 1;
  state.units.adjacent = {
    ...state.units.target, id: 'adjacent', q: 11, r: 11, leaderId: 'xiahou-dun', officerIds: ['xiahou-dun'],
  };
  state.officers['xiahou-dun'].stats.intelligence = 1;
  const next = useUnitStrategy(state, 'liu', 'caster', 'disturb', { targetUnitId: 'target' });
  expect(next.units.target.confusedTenDays).toBe(next.units.adjacent.confusedTenDays);
  expect(next.units.caster.energy).toBe(85);
  expect(next.rngCursor).toBe(2);
});
```

- [ ] **Step 2: Run and verify red**

Run: `npm.cmd test -- src/game/skills/rules/strategy.test.ts src/game/battle/actions.test.ts src/components/command-ui.test.tsx`

Expected: FAIL because strategy cost, guarantee, immunity and chaining are not connected.

- [ ] **Step 3: Implement strategy rule projection**

```ts
export interface StrategySkillRules {
  energyCost: number;
  guaranteed: boolean;
  immune: boolean;
  fireDamageMultiplier: number;
  chain: boolean;
}

export function resolveStrategySkillRules(
  state: GameState,
  caster: ArmyUnit,
  target: ArmyUnit | undefined,
  strategyId: StrategyId,
  baseCost: number,
): StrategySkillRules {
  const casterSkills = resolveUnitSkills(state, caster);
  const targetSkills = target ? resolveUnitSkills(state, target) : [];
  const fixedCosts = effectsOfKind(casterSkills, 'strategyEnergyCost').map(({ effect }) => effect.set);
  const guaranteed = effectsOfKind(casterSkills, 'strategyGuaranteed')
    .filter(({ effect }) => effect.strategyIds.includes(strategyId))
    .some(({ effect }) => skillConditionMatches(state, effect.condition, caster, target));
  const immune = effectsOfKind(targetSkills, 'strategyImmunity')
    .some(({ effect }) => effect.strategyIds === 'all' || effect.strategyIds.includes(strategyId));
  const fireDamageMultiplier = strategyId === 'fire'
    ? effectsOfKind(casterSkills, 'fireDamageMultiplier').reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1)
    : 1;
  return {
    energyCost: fixedCosts.length > 0 ? Math.min(baseCost, ...fixedCosts) : baseCost,
    guaranteed,
    immune,
    fireDamageMultiplier,
    chain: (strategyId === 'false-report' || strategyId === 'disturb') && Boolean(target && hasActiveSkill(casterSkills, '连环')),
  };
}
```

Expose this helper from `battle/strategies.ts` and `battle/actions.ts`; both UI lock state/label and action validation must call it:

```ts
export function strategyEnergyCostForUnit(state: GameState, unitId: string, strategyId: StrategyId) {
  const unit = state.units[unitId];
  const strategy = unitStrategies().find((candidate) => candidate.id === strategyId);
  if (!unit || !strategy) throw new Error('部队不能使用该计略');
  return resolveStrategySkillRules(state, unit, undefined, strategyId, strategy.cost).energyCost;
}
```

- [ ] **Step 4: Extract one successful unit-strategy application function and add chaining**

Create a narrow `applySuccessfulUnitStrategy(next, strategyId, targetId, sharedOutcome)` helper in `legacyCore.ts`. The original target is applied first. `applyChainStrategyEffect` gathers adjacent enemy units in `id` sort order, excludes the caster and original target, and applies the same status duration without another chance roll.

Do not chain `calm`, `inspire`, `extinguish` or cell-target fire. For `discord`, defer chaining until a later phase because its victim selection is a separate damage action; first-stage chain support is exactly `false-report` and `disturb`.

- [ ] **Step 5: Connect fire multiplier and immunity without changing persistent fire ticks**

Pass an immediate unit-damage argument into the fire ignition helper only for the current fire-strategy action. Persisted `FirePlot` remains unchanged and `applyGroundFireDamageToUnits` continues using 500. If an occupied enemy target is immune, set `succeeded: false`, spend cost, mark acted and return before adding a fire plot.

- [ ] **Step 6: Run focused, UI and online parity tests**

Run: `npm.cmd test -- src/game/skills/rules/strategy.test.ts src/game/battle/actions.test.ts src/components/command-ui.test.tsx src/game/network/session.test.ts`

Expected: PASS; seeded local and online strategy states, reports and random cursors match.

- [ ] **Step 7: Mark four entries active and commit**

```powershell
git add src/game/skills src/game/battle/legacyCore.ts src/game/battle/strategies.ts src/components/GameShell.tsx src/game/battle/actions.test.ts src/components/command-ui.test.tsx src/game/network/session.test.ts
git commit -m "feat: apply strategy officer skills"
```

---

### Task 6: 接入筑城和乐奏，并统一势力回合开始入口

**Files:**
- Create: `src/game/skills/rules/facility.ts`
- Create: `src/game/skills/rules/turn.ts`
- Test: `src/game/skills/rules/facility.test.ts`
- Test: `src/game/skills/rules/turn.test.ts`
- Modify: `src/game/battle/legacyCore.ts`
- Modify: `src/game/turn.ts`
- Modify: `src/game/network/session.ts`
- Modify: `src/game/store/GameProvider.tsx`
- Modify: `src/game/skills/catalog/support.ts`
- Test: `src/game/battle/actions.test.ts`
- Test: `src/game/turn.test.ts`
- Test: `src/game/network/session.test.ts`
- Test: `src/game/store/GameProvider.test.tsx`

**Interfaces:**
- Consumes: resolved unit skills and current active force.
- Produces: `facilityBuildPowerMultiplier`, `applyForceTurnStartSkillEffects`, `settleForceTurnStart`.

- [ ] **Step 1: Write failing facility and turn tests**

```ts
it('doubles both initial construction and repair durability for 筑城 without changing gold cost', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '筑城';
  state.officers['liu-bei'].location = { kind: 'unit', unitId: 'builder' };
  state.units.builder = {
    id: 'builder', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
    homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 10000, gold: 2000,
    food: 5000, energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  const target = facilityBuildTargets(state, 'builder', undefined, 'arrowTower')[0];
  const built = buildFacility(state, 'liu', 'builder', 'arrowTower', target);
  const facilityId = Object.keys(built.facilities!)[0];
  expect(built.facilities?.[facilityId].durability).toBe(700);
  expect(built.units.builder.gold).toBe(2000 - FACILITY_BUILD_COSTS.arrowTower);

  const repairState = structuredClone(state);
  repairState.units.builder.troops = 2000;
  repairState.facilities = {
    repairTarget: { id: 'repairTarget', type: 'arrowTower', forceId: 'liu', q: 11, r: 10, durability: 100, completed: false },
  };
  const repaired = repairFacility(repairState, 'liu', 'builder', 'repairTarget');
  expect(repaired.facilities?.repairTarget.durability).toBe(300);
});
```

The arrow tower max durability is 700, so the first assertion proves capped completion; the 2,000-person repair assertion proves uncapped build power changes from 100 to 200.

```ts
it('restores 乐奏 energy once immediately before only its own force starts', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '乐奏';
  state.officers['liu-bei'].location = { kind: 'unit', unitId: 'musician' };
  state.units.musician = {
    id: 'musician', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
    homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 4000, food: 4000,
    energy: 80, movementRemaining: 20, moved: false, acted: false,
  };
  settleForceTurnStart(state, 'cao');
  expect(state.units.musician.energy).toBe(80);
  settleForceTurnStart(state, 'liu');
  expect(state.units.musician.energy).toBe(85);
});
```

Add this assertion to both the existing online handoff fixture and `GameProvider` opponent-turn fixture after assigning 乐奏 to the guest/AI unit leader:

```ts
expect(afterHandoff.state?.units['guest-musician'].energy).toBe(85);
expect(afterHandoff.state?.units['host-musician'].energy).toBe(80);
```

On the all-ready transition back to the host, assert the reverse exactly once:

```ts
expect(nextTenDay.state?.units['host-musician'].energy).toBe(85);
expect(nextTenDay.state?.units['guest-musician'].energy).toBe(85);
```

- [ ] **Step 2: Run and verify red**

Run: `npm.cmd test -- src/game/skills/rules/facility.test.ts src/game/skills/rules/turn.test.ts src/game/turn.test.ts src/game/network/session.test.ts src/game/store/GameProvider.test.tsx`

Expected: FAIL because the build multiplier and unified turn-start function do not exist.

- [ ] **Step 3: Implement facility and turn effects**

```ts
export function facilityBuildPowerMultiplier(state: GameState, unit: ArmyUnit) {
  return effectsOfKind(resolveUnitSkills(state, unit), 'buildPowerMultiplier')
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}

export function applyForceTurnStartSkillEffects(state: GameState, forceId: ForceId) {
  for (const unit of Object.values(state.units).filter((candidate) => candidate.forceId === forceId)) {
    const recovery = effectsOfKind(resolveUnitSkills(state, unit), 'turnStartEnergy')
      .reduce((highest, { effect }) => Math.max(highest, effect.add), 0);
    unit.energy = Math.min(100, unit.energy + recovery);
  }
}
```

Apply the build multiplier before capping against facility maximum durability. Repair remains free and initial build cost remains unchanged.

- [ ] **Step 4: Create one force-turn-start orchestration entry**

```ts
export function settleForceTurnStart(next: GameState, activeForceId: ForceId) {
  settleBattleFacilities(next, activeForceId);
  applyForceTurnStartSkillEffects(next, activeForceId);
}
```

Replace direct `settleBattleFacilities` calls in `settleTenDay`, `GameProvider.runOpponentTurns` and `network/session.settleActivePlayerTurnStart` with `settleForceTurnStart`. Preserve their existing report-clearing order.

- [ ] **Step 5: Run all affected tests, activate entries and commit**

Run: `npm.cmd test -- src/game/skills/rules/facility.test.ts src/game/skills/rules/turn.test.ts src/game/battle/actions.test.ts src/game/turn.test.ts src/game/network/session.test.ts src/game/store/GameProvider.test.tsx`

Expected: PASS with no double turn-start effects.

```powershell
git add src/game/skills src/game/battle/legacyCore.ts src/game/turn.ts src/game/network/session.ts src/game/store/GameProvider.tsx src/game/battle/actions.test.ts src/game/turn.test.ts src/game/network/session.test.ts src/game/store/GameProvider.test.tsx
git commit -m "feat: apply facility and turn officer skills"
```

---

### Task 7: 接入富豪、米道、名声和能吏的城市规则

**Files:**
- Create: `src/game/skills/rules/city.ts`
- Test: `src/game/skills/rules/city.test.ts`
- Modify: `src/game/commands.ts`
- Modify: `src/game/turn.ts`
- Modify: `src/game/skills/catalog/domestic.ts`
- Modify: `src/game/skills/catalog/income.ts`
- Test: `src/game/commands.test.ts`
- Test: `src/game/turn.test.ts`

**Interfaces:**
- Consumes: `resolveCitySkills`, `resolveCommandSkills`, base command yield and base city income.
- Produces: `commandYieldMultiplier`, `cityIncomeMultiplier`.

- [ ] **Step 1: Write failing city rule and integration tests**

```ts
it('uses only the acting officer for 名声 and 能吏 command multipliers', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '名声';
  state.officers['guan-yu'].skill = '能吏';
  expect(commandYieldMultiplier(state, { type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei' })).toBe(1.5);
  expect(commandYieldMultiplier(state, { type: 'produceArmament', cityId: 'jiangling', officerId: 'guan-yu', armamentType: 'crossbow' })).toBe(1.5);
  expect(commandYieldMultiplier(state, { type: 'produceArmament', cityId: 'jiangling', officerId: 'guan-yu', armamentType: 'cavalry' })).toBe(1);
});

it('uses unique resident 富豪 and 米道 effects while counting local production tasks', () => {
  const state = createGame('sun', 4394);
  state.officers['lu-su'].skill = '富豪';
  state.officers['zhou-yu'].skill = '米道';
  state.officers['zhou-yu'].location = { kind: 'task', cityId: 'changsha', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 2 };
  expect(cityIncomeMultiplier(state, 'changsha', 'gold')).toBe(1.5);
  expect(cityIncomeMultiplier(state, 'changsha', 'food')).toBe(1.5);
});
```

Add these exact command and settlement tests:

```ts
it('applies 名声 after the existing recruit formula without changing costs', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '名声';
  const next = executeCommand(state, 'liu', { type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei' });
  const base = 300 + state.officers['liu-bei'].stats.charisma * 10;
  expect(next.cities.jiangling.troops - state.cities.jiangling.troops).toBe(Math.round(base * 1.5));
  expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 800);
  expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 500);
  expect(next.actionPoints.liu).toBe(state.actionPoints.liu - COMMAND_AP.recruit);
});

it('applies 能吏 to spear, halberd, and crossbow production only', () => {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = '能吏';
  const base = produceArmamentYield(state.officers['liu-bei'], 'crossbow');
  const before = state.cities.jiangling.armaments!.crossbow;
  const next = executeCommand(state, 'liu', {
    type: 'produceArmament', cityId: 'jiangling', officerId: 'liu-bei', armamentType: 'crossbow',
  });
  expect(next.cities.jiangling.armaments!.crossbow - before).toBe(Math.round(base * 1.5));
  expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - ARMAMENT_GOLD_COST);
});

it('multiplies generated city income once and stops after the resident transfers', () => {
  const state = createGame('sun', 4394);
  state.officers['lu-su'].skill = '富豪';
  const city = state.cities.changsha;
  const baseGold = Math.round(city.commerce * 20 + city.population / 100);
  const first = settleMonth(state);
  expect(first.cities.changsha.gold).toBe(city.gold + Math.round(baseGold * 1.5));

  state.officers['lu-su'].location = { kind: 'transfer', fromCityId: 'changsha', targetCityId: 'jiangxia', remainingTenDays: 1 };
  const second = settleMonth(state);
  expect(second.cities.changsha.gold).toBe(city.gold + baseGold);
});

it('counts a 米道 production task, does not stack duplicates, and multiplies only quarterly base food', () => {
  const state = createGame('sun', 4394);
  state.month = 3;
  state.officers['zhou-yu'].skill = '米道';
  state.officers['zhou-yu'].location = { kind: 'task', cityId: 'changsha', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 2 };
  state.officers['lu-su'].skill = '米道';
  const city = state.cities.changsha;
  const baseFood = Math.round(city.agriculture * 60 + city.population / 40);
  const next = settleMonth(state);
  expect(next.cities.changsha.food).toBe(city.food + Math.round(baseFood * 1.5));
});
```

- [ ] **Step 2: Run and verify red**

Run: `npm.cmd test -- src/game/skills/rules/city.test.ts src/game/commands.test.ts src/game/turn.test.ts`

Expected: FAIL because city and command multipliers are not connected.

- [ ] **Step 3: Implement highest-only city and command multipliers**

```ts
export function commandYieldMultiplier(state: GameState, command: GameCommand) {
  return effectsOfKind(resolveCommandSkills(state, command), 'commandYieldMultiplier')
    .filter(({ effect }) => effect.command === command.type)
    .filter(({ effect }) => command.type !== 'produceArmament' || !effect.armamentTypes || effect.armamentTypes.includes(command.armamentType))
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}

export function cityIncomeMultiplier(state: GameState, cityId: CityId, resource: 'gold' | 'food') {
  return effectsOfKind(resolveCitySkills(state, cityId), 'cityIncomeMultiplier')
    .filter(({ effect }) => effect.resource === resource)
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}
```

- [ ] **Step 4: Apply multipliers at the final yield boundary**

In `executeCommand`, compute the existing base yield, then `Math.round(baseYield * commandYieldMultiplier(next, command))`. Do not change gold, food, population, order, action point or production-duration costs.

In `settleMonth`, calculate base monthly gold and quarterly food separately, multiply only those generated amounts, add them to the city, then run population growth and random events exactly as before.

- [ ] **Step 5: Run affected tests, activate four entries and commit**

Run: `npm.cmd test -- src/game/skills/rules/city.test.ts src/game/commands.test.ts src/game/turn.test.ts src/game/ai.test.ts`

Expected: PASS; cities without active skills retain byte-for-byte equivalent numeric results for the same seed.

```powershell
git add src/game/skills src/game/commands.ts src/game/turn.ts src/game/commands.test.ts src/game/turn.test.ts src/game/ai.test.ts
git commit -m "feat: apply domestic officer skills"
```

---

### Task 8: 完成兼容、确定性和全链路验收

**Files:**
- Modify: `src/game/skills/registry.test.ts`
- Modify: `src/game/persistence.test.ts`
- Modify: `src/game/network/intentReducer.test.ts`
- Modify: `src/game/network/session.test.ts`
- Modify: `src/game/battle/module-boundaries.test.ts`
- Modify: `docs/GAME_RULES.md`

**Interfaces:**
- Consumes: all first-stage public skill APIs.
- Produces: verified compatibility contract and documented first-stage rules.

- [ ] **Step 1: Add the final active-status and save compatibility tests**

```ts
const FIRST_STAGE = ['强行', '飞将', '神将', '连战', '不屈', '百出', '火神', '洞察', '连环', '筑城', '乐奏', '富豪', '米道', '名声', '能吏'];

it('activates exactly the confirmed first-stage skills', () => {
  expect(ORIGINAL_SKILLS.filter((skill) => skill.implementationStatus === 'active').map((skill) => skill.name).sort())
    .toEqual([...FIRST_STAGE].sort());
});
```

Add these persistence cases:

```ts
it('round-trips every first-stage and unknown custom skill without persisting derived rules', () => {
  const state = createGame('liu', 9);
  const names = ['强行', '飞将', '神将', '连战', '不屈', '百出', '火神', '洞察', '连环', '筑城', '乐奏', '富豪', '米道', '名声', '能吏', '自定义未登记'];
  Object.values(state.officers).slice(0, names.length).forEach((officer, index) => { officer.skill = names[index]; });
  writeSave(storage, 'auto', state);
  expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
  const serialized = storage.getItem(AUTO_SAVE_KEY)!;
  expect(serialized).not.toContain('sourceOfficerIds');
  expect(serialized).not.toContain('fireDamageMultiplier');
  expect(serialized).not.toContain('cityIncomeMultiplier');
});
```

- [ ] **Step 2: Add a deterministic local/online representative matrix**

Use identical seeded states and compare direct `reduceGameIntent` with `reduceOnlineIntent` for this exact matrix:

- 神将 ordinary attack;
- 连战 normal attack including RNG cursor;
- 百出扰乱;
- 火神火计;
- 洞察防御;
- 筑城设施建设;
- 乐奏玩家交接。

```ts
function skillRoomFixture(name: string, seed: number) {
  const room = structuredClone(readyStartedRoom());
  if (!room.state) throw new Error('room state should exist');
  room.seed = seed;
  room.state.seed = seed;
  room.state.rngCursor = 0;
  room.state.officers['liu-bei'].skill = name === '洞察防御' ? '无' : name.replace('普通攻击', '').replace('扰乱', '').replace('火计', '');
  room.state.officers['cao-cao'].skill = name === '洞察防御' ? '洞察' : '无';
  room.state.officers['liu-bei'].stats.war = 100;
  room.state.officers['liu-bei'].stats.intelligence = 100;
  room.state.officers['cao-cao'].stats.war = 1;
  room.state.officers['cao-cao'].stats.intelligence = 1;
  room.state.units['host-unit'] = {
    id: 'host-unit', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
    homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 10000, food: 10000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  room.state.units['guest-unit'] = {
    id: 'guest-unit', kind: 'combat', forceId: 'cao', leaderId: 'cao-cao', officerIds: ['cao-cao'],
    homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 10000, food: 10000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  return room;
}

it.each([
  ['神将普通攻击', { type: 'attackUnit', attackerId: 'host-unit', targetId: 'guest-unit' }],
  ['连战普通攻击', { type: 'attackUnit', attackerId: 'host-unit', targetId: 'guest-unit' }],
  ['百出扰乱', { type: 'useUnitStrategy', unitId: 'host-unit', strategyId: 'disturb', selection: { targetUnitId: 'guest-unit' } }],
  ['火神火计', { type: 'useUnitStrategy', unitId: 'host-unit', strategyId: 'fire', selection: { coord: { q: 11, r: 10 } } }],
  ['洞察防御', { type: 'useUnitStrategy', unitId: 'host-unit', strategyId: 'disturb', selection: { targetUnitId: 'guest-unit' } }],
] as const)('keeps seeded local and online %s outcomes identical', (_name, intent) => {
  const room = skillRoomFixture(_name, 1);
  const forceId = room.players.host.forceId!;
  const local = reduceGameIntent(playerState(room, 'host')!, forceId, intent);
  const online = reduceOnlineIntent(room, 'host', room.revision, intent);
  expect(online.ok).toBe(true);
  if (!online.ok) return;
  expect(playerState(online.room, 'host')).toEqual({ ...local, playerForceId: forceId, turnForceId: forceId });
});
```

Add separate existing-shape tests for `buildFacility` and `endTenDay` because their intents and active-player transitions have different result shapes. Compare the fields directly:

```ts
expect(playerState(onlineBuild.room, 'host')?.facilities).toEqual(localBuild.facilities);
expect(playerState(onlineBuild.room, 'host')?.units).toEqual(localBuild.units);
expect(playerState(onlineBuild.room, 'host')?.rngCursor).toBe(localBuild.rngCursor);
expect(playerState(afterOnlineHandoff.room, 'guest')?.units['guest-musician'].energy).toBe(85);
expect(afterLocalHandoff.units['guest-musician'].energy).toBe(85);
expect(afterOnlineHandoff.room.state?.battleDamageReports).toEqual(afterLocalHandoff.battleDamageReports);
```

Normalize only online room personalization fields already normalized by existing tests; all units, facilities, fire plots, reports, resources and `rngCursor` must be equal.

- [ ] **Step 3: Run the new compatibility matrix**

Run: `npm.cmd test -- src/game/skills src/game/persistence.test.ts src/game/network/intentReducer.test.ts src/game/network/session.test.ts src/game/battle/module-boundaries.test.ts`

Expected: PASS with 15 active, 85 planned/blocked original skills and unchanged schema version 2.

- [ ] **Step 4: Document implemented rules and dormant dependencies**

Add a `武将特技` section to `docs/GAME_RULES.md` with these exact subsections: `生效来源`, `叠加规则`, `第一阶段特技`, `暂未启用特技`. Copy the fifteen effect rows from the approved design specification verbatim. State explicitly that production-task officers count as residents, duplicate names do not stack, 乐奏 triggers only before its own force acts, and every non-active catalog entry has no gameplay effect.

- [ ] **Step 5: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: all Vitest files pass with zero failures, TypeScript and Vite production build exit 0, and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Perform manual smoke checks**

Start the existing frontend and backend launch script and verify:

1. 武将列表和出征选择仍显示旧存档与自定义特技名称。
2. 强行、飞将改变首次出征和后续移动范围，普通部队 ZOC 不变。
3. 神将、连战、不屈的伤害数字、暴击标签和行动结束正确。
4. 百出菜单显示实际消耗，火神、洞察、连环目标结果正确。
5. 筑城建设与修补报告显示实际耐久，乐奏只在所属势力回合开始恢复一次。
6. 富豪、米道、名声、能吏只修改对应收益，不修改成本。
7. 双人房间双方执行相同规则，交接回合不重复触发对方特技。

- [ ] **Step 7: Commit final compatibility coverage and rules**

```powershell
git add src/game/skills/registry.test.ts src/game/persistence.test.ts src/game/network/intentReducer.test.ts src/game/network/session.test.ts src/game/battle/module-boundaries.test.ts docs/GAME_RULES.md
git commit -m "test: verify first officer skill phase"
```
