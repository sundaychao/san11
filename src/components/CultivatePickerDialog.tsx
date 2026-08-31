import { BookOpen, Sparkles, Swords } from 'lucide-react';
import { useMemo } from 'react';
import { ABILITY_NODE_MAP } from '../game/abilityResearch';
import { useGame } from '../game/store/GameProvider';
import type { CultivateCategory } from './CultivateDialog';

interface CultivatePickerDialogProps {
  onSelect(category: CultivateCategory): void;
  onClose(): void;
}

const OPTIONS: Array<{ category: CultivateCategory; label: string; Icon: typeof Sparkles }> = [
  { category: 'stat', label: '培育基础能力', Icon: Sparkles },
  { category: 'aptitude', label: '培育兵种适性', Icon: Swords },
  { category: 'skill', label: '培育特技', Icon: BookOpen },
];

/** 某类培育是否有已研究且仍有剩余次数的项目（按节点真实 kind 判断） */
function hasCultivationAvailable(
  state: { forces: Record<string, { abilityResearch?: { researched?: string[]; remaining?: Record<string, number> } }> },
  forceId: string,
  category: CultivateCategory,
): boolean {
  const info = state.forces[forceId]?.abilityResearch;
  const remaining = info?.remaining ?? {};
  return (info?.researched ?? []).some((id) => {
    const node = ABILITY_NODE_MAP[id];
    return Boolean(node) && node.kind === category && (remaining[id] ?? 0) > 0;
  });
}

export function CultivatePickerDialog({ onSelect, onClose }: CultivatePickerDialogProps) {
  const { state } = useGame();
  const forceId = state?.playerForceId;
  const availability = useMemo(() => {
    const map: Record<CultivateCategory, boolean> = { stat: false, aptitude: false, skill: false };
    if (state && forceId) {
      map.stat = hasCultivationAvailable(state, forceId, 'stat');
      map.aptitude = hasCultivationAvailable(state, forceId, 'aptitude');
      map.skill = hasCultivationAvailable(state, forceId, 'skill');
    }
    return map;
  }, [state, forceId]);

  return (
    <div className="modal-backdrop" aria-label="培育武将选择" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <nav
        className="cultivate-picker-dialog tool-panel"
        data-testid="cultivate-picker-dialog"
        aria-label="培育武将菜单"
      >
        {OPTIONS.map(({ category, label, Icon }) => {
          const cultivable = availability[category];
          const disabled = !cultivable;
          const title = cultivable ? '' : '暂无已研究完成的培育项目（先完成能力研究）';
          return (
            <button
              key={category}
              type="button"
              data-testid={`pick-cultivate-${category}`}
              disabled={disabled}
              title={title}
              onClick={() => onSelect(category)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}