/**
 * 局内历法口径（唯一来源）—— 顶栏日期、季节都从这里取，别再在组件里手写映射。
 *
 * - `state.month`：局内相对月份，`1` = 四月、`9` = 腊月、`10` = 正月（剧本自建安十三年四月开局）
 * - `state.tenDay`：`1 / 2 / 3` 三个旬
 *
 * 界面一律显示「6月1号 / 6月11号 / 6月21号」这类**月号 + 日号**，
 * 不再出现「上旬 / 中旬 / 下旬」字样（旬的玩法含义见 docs/GAME_RULES.md）。
 */

/** 每旬的首日：上旬 1 号、中旬 11 号、下旬 21 号（一旬 10 天） */
export const TEN_DAY_START_DAY: Record<number, number> = { 1: 1, 2: 11, 3: 21 };

/** 局内月份 → 月号（四月 = 4、腊月 = 12、正月 = 1、三月 = 3） */
export function calendarMonthNumber(month: number): number {
  const index = (((month - 1) % 12) + 12) % 12;
  const numeric = index + 4;
  return numeric > 12 ? numeric - 12 : numeric;
}

/** 局内旬序号 → 该旬首日的日号 */
export function calendarDayNumber(tenDay: number): number {
  return TEN_DAY_START_DAY[tenDay] ?? TEN_DAY_START_DAY[1];
}

/** 建安年号（正月进位）：开局 month=1 为建安十三年 */
export function calendarYear(month: number): number {
  return 13 + Math.floor((month + 2) / 12);
}

/** 形如「6月1号」 */
export function calendarDateLabel(month: number, tenDay: number): string {
  return `${calendarMonthNumber(month)}月${calendarDayNumber(tenDay)}号`;
}

/** 季节：1~3 月春、4~6 月夏、7~9 月秋、10~12 月冬（按上面换算出的月号判） */
export function seasonLabel(month: number): string {
  const numeric = calendarMonthNumber(month);
  if (numeric <= 3) return '春';
  if (numeric <= 6) return '夏';
  if (numeric <= 9) return '秋';
  return '冬';
}
