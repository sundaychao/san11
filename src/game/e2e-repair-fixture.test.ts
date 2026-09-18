/** e2e fixture 生成器：产出「出征部队 + 远距受损设施」的自动存档 JSON（e2e/repair-delegate.spec.ts 注入用）。
 * 重新生成：node node_modules/vitest/vitest.mjs run src/game/e2e-repair-fixture.test.ts */
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
