import { Building2, ChevronRight, Swords, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { DEPLOY_AP_COST } from '../game/battle/actions';
import { COMMAND_AP } from '../game/commands';
import { useGame } from '../game/store/GameProvider';
import type { CityId, GameCommand, GameState } from '../game/types';
import type { CultivateCategory } from './CultivateDialog';
import { closePopupOnContextMenu } from './popupEvents';

/** 是否有科技正在研究中（任意己方武将执行 research 任务） */
function techResearching(state: GameState): boolean {
  return Object.values(state.officers).some((officer) =>
    officer.forceId === state.playerForceId && officer.location.kind === 'task' && officer.location.task === 'research');
}

/** 是否有能力正在研究中 */
function abilityResearching(state: GameState): boolean {
  return Boolean(state.forces[state.playerForceId]?.abilityResearch?.active);
}

/** 某类培育是否有已研究且有剩余次数的项目 */
function hasCultivationAvailable(state: GameState, category: CultivateCategory): boolean {
  const force = state.forces[state.playerForceId];
  const remaining = force?.abilityResearch?.remaining ?? {};
  const researched = force?.abilityResearch?.researched ?? [];
  if (category === 'stat') {
    return researched.some((id) => id.startsWith('war') || id.startsWith('lead') || id.startsWith('int') || id.startsWith('pol') || id.startsWith('cha'))
      && Object.entries(remaining).some(([id, n]) => n > 0 && (id.startsWith('war') || id.startsWith('lead') || id.startsWith('int') || id.startsWith('pol') || id.startsWith('cha')));
  }
  if (category === 'aptitude') {
    return researched.some((id) => id.startsWith('apt'))
      && Object.entries(remaining).some(([id, n]) => n > 0 && id.startsWith('apt'));
  }
  return false;
}

type MenuSection = 'urban' | 'military' | 'talent';

const SECTIONS: Array<{ id: MenuSection; label: string; Icon: typeof Building2 }> = [
  { id: 'urban', label: '都市', Icon: Building2 },
  { id: 'military', label: '军事', Icon: Swords },
  { id: 'talent', label: '人才', Icon: Users },
];

type SubItem =
  | { label: string; command?: GameCommand['type']; action?: 'deploy' | 'transport'; cultivate?: undefined; opens?: undefined }
  | { label: string; cultivate: CultivateCategory; command?: undefined; action?: undefined; opens?: undefined }
  | { label: string; opens: 'cultivate'; command?: undefined; action?: undefined; cultivate?: undefined };

const SUB_COMMANDS: Record<MenuSection, SubItem[]> = {
  urban: [
    { label: '开发', command: 'develop' },
    { label: '征兵', command: 'recruit' },
    { label: '生产兵装', command: 'produceArmament' },
    { label: '巡查', command: 'patrol' },
    { label: '商人', command: 'trade' },
  ],
  military: [
    { label: '训练', command: 'train' },
    { label: '出征', action: 'deploy' },
    { label: '输送', action: 'transport' },
  ],
  talent: [
    { label: '探索人才', command: 'talent' },
    { label: '培育武将', opens: 'cultivate' },
    { label: '科技研究', command: 'research' },
    { label: '能力研究', command: 'abilityResearch' },
    { label: '调动', command: 'transfer' },
  ],
};

interface CityCommandMenuProps {
  cityId: CityId;
  actionPoints: number;
  /** 商人本旬是否到访且未交易（无商人时禁用交易项） */
  merchantAvailable: boolean;
  position: { x: number; y: number };
  onCommand(type: GameCommand['type']): void;
  onCultivate(category: CultivateCategory): void;
  onOpenCultivatePicker?(): void;
  onDeploy(cityId: CityId): void;
  onTransport(cityId: CityId): void;
  onClose(): void;
}

export function CityCommandMenu({ cityId, actionPoints, merchantAvailable, position, onClose, onCommand, onCultivate, onOpenCultivatePicker, onDeploy, onTransport }: CityCommandMenuProps) {
  const audio = useAudioEventAdapter();
  const { state } = useGame();
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  const closeCurrentLevel = useCallback(() => {
    if (activeSection) {
      setActiveSection(null);
      return;
    }
    onClose();
  }, [activeSection, onClose]);

  const isDisabled = (item: SubItem) => {
    if ('opens' in item && item.opens) return false;
    if ('cultivate' in item && item.cultivate) {
      if (state) return !hasCultivationAvailable(state, item.cultivate);
      return true;
    }
    if (item.command === 'trade') return !merchantAvailable || actionPoints < COMMAND_AP.trade;
    if (item.command === 'research' && state && techResearching(state)) return true;
    if (item.command === 'abilityResearch' && state && abilityResearching(state)) return true;
    if (item.command) return actionPoints < COMMAND_AP[item.command];
    if (item.action === 'deploy' || item.action === 'transport') return actionPoints < DEPLOY_AP_COST;
    return false;
  };

  const runCommand = (item: SubItem) => {
    if (isDisabled(item)) return;
    if ('opens' in item && item.opens) {
      onOpenCultivatePicker?.();
      onClose();
      return;
    }
    if ('cultivate' in item && item.cultivate) {
      onCultivate(item.cultivate);
      onClose();
      return;
    }
    if (item.action === 'deploy') onDeploy(cityId);
    if (item.action === 'transport') onTransport(cityId);
    if (item.command) onCommand(item.command);
    onClose();
  };

  useEffect(() => {
    const handleContextMenu = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      audio.emit({ type: 'menu-right-click' });
      closeCurrentLevel();
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => document.removeEventListener('contextmenu', handleContextMenu, true);
  }, [audio, closeCurrentLevel]);

  useEffect(() => {
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      if (activeSection) {
        setActiveSection(null);
        return;
      }
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [activeSection, onClose]);

  return (
    <nav
      ref={menuRef}
      className="city-command-menu tool-panel"
      data-testid="city-command-menu"
      style={{ left: position.x, top: position.y } as CSSProperties}
      aria-label="城池命令菜单"
      onContextMenu={(event) => closePopupOnContextMenu(event, closeCurrentLevel, audio)}
    >
      <div className="city-command-primary">
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            data-testid={`city-command-section-${id}`}
            className={activeSection === id ? 'is-active' : ''}
            onClick={() => {
              audio.emit({ type: 'menu-click-on' });
              setActiveSection(id);
            }}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
            <ChevronRight aria-hidden="true" />
          </button>
        ))}
      </div>

      {activeSection && (
        <div className="city-command-secondary">
          {SUB_COMMANDS[activeSection].map((item) => {
            const researching = item.command === 'research' && state && techResearching(state)
              ? '科技研究中'
              : item.command === 'abilityResearch' && state && abilityResearching(state)
                ? '能力研究中'
                : null;
            return (
              <button
                key={item.label}
                type="button"
                data-testid={item.action ? `city-command-action-${item.action}` : ('cultivate' in item && item.cultivate) ? `city-command-cultivate-${item.cultivate}` : ('opens' in item && item.opens) ? `city-command-submenu-${item.opens}` : item.command ? `city-command-command-${item.command}` : undefined}
                className={isDisabled(item) ? 'is-disabled' : undefined}
                disabled={isDisabled(item)}
                onClick={() => runCommand(item)}
              >
                {researching ?? item.label}
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
}
