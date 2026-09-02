import { officerHealthSummary } from '../game/health';
import type { Officer } from '../game/types';

/** 带伤武将的徽章：等级名 + 悬停展示衰减与恢复时间；无伤返回 null */
export function OfficerHealthBadge({ officer }: { officer: Officer }) {
  const health = officerHealthSummary(officer);
  if (!health) return null;
  const reduced = Math.round((1 - health.multiplier) * 100);
  return (
    <em
      className={`officer-health-badge is-${health.level}`}
      title={`${health.label}：能力下降 ${reduced}%，约 ${health.remainingTenDays} 旬后痊愈`}
    >
      {health.label}
    </em>
  );
}
