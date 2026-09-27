import { describe, expect, it } from 'vitest';
import { calendarDateLabel, calendarDayNumber, calendarMonthNumber, calendarYear, seasonLabel } from './calendar';

describe('局内历法换算', () => {
  it('局内月份换算成月号：四月=4、腊月=12、正月=1、三月=3', () => {
    expect(calendarMonthNumber(1)).toBe(4);
    expect(calendarMonthNumber(3)).toBe(6);
    expect(calendarMonthNumber(9)).toBe(12);
    expect(calendarMonthNumber(10)).toBe(1);
    expect(calendarMonthNumber(12)).toBe(3);
  });

  it('旬序号换算成日号：上旬 1 号、中旬 11 号、下旬 21 号', () => {
    expect(calendarDayNumber(1)).toBe(1);
    expect(calendarDayNumber(2)).toBe(11);
    expect(calendarDayNumber(3)).toBe(21);
    // 越界旬序号退回上旬，不抛错（老存档/坏数据兜底）
    expect(calendarDayNumber(9)).toBe(1);
  });

  it('日期文案形如「6月1号」', () => {
    expect(calendarDateLabel(3, 1)).toBe('6月1号');
    expect(calendarDateLabel(3, 2)).toBe('6月11号');
    expect(calendarDateLabel(3, 3)).toBe('6月21号');
    expect(calendarDateLabel(1, 1)).toBe('4月1号');
  });

  it('年号按正月进位', () => {
    expect(calendarYear(1)).toBe(13);
    expect(calendarYear(9)).toBe(13);
    expect(calendarYear(10)).toBe(14);
    expect(calendarYear(22)).toBe(15);
  });

  it('季节按传统月序：四~六月夏、七~九月秋、十~腊月冬、正~三月春', () => {
    expect([1, 2, 3].map(seasonLabel)).toEqual(['夏', '夏', '夏']);
    expect([4, 5, 6].map(seasonLabel)).toEqual(['秋', '秋', '秋']);
    expect([7, 8, 9].map(seasonLabel)).toEqual(['冬', '冬', '冬']);
    expect([10, 11, 12].map(seasonLabel)).toEqual(['春', '春', '春']);
  });
});
