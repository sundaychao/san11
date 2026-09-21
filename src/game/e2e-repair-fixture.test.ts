/** e2e fixture 生成器：产出「出征部队 + 远距受损设施」的自动存档 JSON（e2e/repair-delegate.spec.ts 注入用）。
 * 重新生成：node node_modules/vitest/vitest.mjs run src/game/e2e-repair-fixture.test.ts
 * 注意：本文件必须至少含一个 it() —— 无用例的 *.test.ts 会让 vitest 报「No test suite found」把全量跑红。
 * 生成动作在模块顶层完成（vitest 收集时即执行），末尾的 it() 只做产出校验。 */
import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { deployUnit } from '../game/battle/deployment';
import { createGame } from '../game/scenario/jingxiang208';
import { writeSave } from '../game/persistence';
import type { GameState } from '../game/types';

const state: GameState = deployUnit(createGame('liu', 1), 'liu', {
  cityId: 'jiangling',
  officerId: 'guan-yu',
  targetCityId: 'xiangyang',
  troopType: 'spear',
  troops: 4000,
  food: 6000,
});
const unit = Object.values(state.units).find((candidate) => candidate.forceId === 'liu')!;
console.log('deployed unit at', unit.q, unit.r, 'moved', unit.moved);

// 太鼓台放部队正上方 3 格（不相邻、可达）：确认委任后推旬应逐步走近
state.facilities = {
  'repair-target': {
    id: 'repair-target',
    type: 'drum',
    forceId: 'liu',
    q: unit.q,
    r: unit.r - 3,
    durability: 300,
    completed: true,
  },
};

// 内存 localStorage shim
const store = new Map<string, string>();
const shim = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as unknown as Storage;
writeSave(shim as Storage, 'auto', state);

const json = store.get('jingxiang-208-autosave-v1');
if (!json) throw new Error('autosave not written');
writeFileSync('e2e/.tmp-autosave.json', json, 'utf8');
console.log('autosave bytes:', json.length, '-> e2e/.tmp-autosave.json');
console.log('facility at', unit.q, unit.r - 3);

it('产出「出征部队 + 远距受损设施」自动存档夹具', () => {
  expect(json.length).toBeGreaterThan(0);
  expect(state.units[unit.id]).toBeDefined();
});

/**
 * 第二个夹具：**委任修补的设施被另一支部队抢先修好**（用户口径「B 修好了 A 不该还显示委」）。
 * 关羽（出征落位，距设施 3 格）挂 drum 修补委任 → 徽章显示「委」；
 * 张飞就站在设施旁（dist=1，会被 pickRepairCandidateUnit 优先挑中），设施 799/800 → 点一次设施菜单
 * 「委任修补」即当场修满 → 关羽的委任必须立刻解除、「委」徽章消失。
 */
function buildSharedTargetSave(): { json: string; facility: { q: number; r: number }; delegatedUnitId: string } {
  const scene = deployUnit(createGame('liu', 1), 'liu', {
    cityId: 'jiangling',
    officerId: 'guan-yu',
    targetCityId: 'xiangyang',
    troopType: 'spear',
    troops: 4000,
    food: 6000,
  });
  const delegated = Object.values(scene.units).find((candidate) => candidate.forceId === 'liu')!;
  const facility = { q: delegated.q, r: delegated.r - 3 };
  scene.facilities = {
    'repair-target': {
      id: 'repair-target',
      type: 'drum',
      forceId: 'liu',
      q: facility.q,
      r: facility.r,
      durability: 799,
      completed: true,
    },
  };
  scene.units[delegated.id].delegate = { kind: 'repair', facilityId: 'repair-target' };
  const helper = {
    ...delegated,
    id: 'helper-unit',
    leaderId: 'zhang-fei',
    officerIds: ['zhang-fei'],
    q: facility.q,
    r: facility.r + 1,
    moved: false,
    acted: false,
    movementRemaining: 20,
  };
  delete (helper as { delegate?: unknown }).delegate;
  scene.units['helper-unit'] = helper;

  const sharedStore = new Map<string, string>();
  const sharedShim = {
    getItem: (k: string) => sharedStore.get(k) ?? null,
    setItem: (k: string, v: string) => void sharedStore.set(k, v),
    removeItem: (k: string) => void sharedStore.delete(k),
  } as unknown as Storage;
  writeSave(sharedShim, 'auto', scene);
  const sharedJson = sharedStore.get('jingxiang-208-autosave-v1');
  if (!sharedJson) throw new Error('shared-target autosave not written');
  writeFileSync('e2e/.tmp-autosave-shared.json', sharedJson, 'utf8');
  console.log('shared-target autosave bytes:', sharedJson.length, '-> e2e/.tmp-autosave-shared.json');
  console.log('facility at', facility.q, facility.r, 'delegated at', delegated.q, delegated.r, 'helper at', facility.q, facility.r + 1);
  return { json: sharedJson, facility, delegatedUnitId: delegated.id };
}

const sharedTarget = buildSharedTargetSave();

it('产出「两支部队抢修同一设施」自动存档夹具', () => {
  expect(sharedTarget.json.length).toBeGreaterThan(0);
  expect(sharedTarget.facility).toBeDefined();
});
