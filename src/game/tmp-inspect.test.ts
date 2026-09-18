import { it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import { settleTenDay } from './turn';

it('inspect', () => {
  let state = createGame('liu', 1);
  // 跑 6 旬（跨2个多月，含换月），观察「我方」页签（forceId==null || 玩家势力）日志内容
  for (let i = 0; i < 6; i += 1) state = settleTenDay(state);
  const own = state.logs.filter((log) => log.forceId == null || log.forceId === 'liu');
  console.log('=== 我方页签日志（前60条）===');
  for (const log of own.slice(-60)) {
    console.log(`[${log.forceId ?? 'null'}] ${log.message}`);
  }
  console.log('=== 本轮 all 条数', state.logs.length, '我方', own.length, '他方', state.logs.length - own.length);
});