import { Building2, ChevronRight, Swords, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { playClickOnSound, playRightMouseSound } from '../audio/soundEffects';
import { DEPLOY_AP_COST } from '../game/battle/actions';
import { COMMAND_AP } from '../game/commands';
import type { CityId, GameCommand } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

type MenuSection = 'urban' | 'military' | 'talent';

const SECTIONS: Array<{ id: MenuSection; label: string; Icon: typeof Building2 }> = [
  { id: 'urban', label: '都市', Icon: Building2 },
  { id: 'military', label: '军事', Icon: Swords },
  { id: 'talent', label: '人才', Icon: Users },
];

const SUB_COMMANDS: Record<MenuSection, Array<{ label: string; command?: GameCommand['type']; action?: 'deploy' | 'transport' }>> = {
  urban: [
    { label: '开发', command: 'develop' },
    { label: '征兵', command: 'recruit' },
    { label: '生产兵装', command: 'produceArmament' },
    { label: '巡查', command: 'patrol' },
  ],
  military: [
    { label: '训练', command: 'train' },
    { label: '出征', action: 'deploy' },
    { label: '输送', action: 'transport' },
  ],
  talent: [
    { label: '探索人才', command: 'talent' },
    { label: '调动', command: 'transfer' },
  ],
};

interface CityCommandMenuProps {
  cityId: CityId;
  actionPoints: number;
  position: { x: number; y: number };
  onCommand(type: GameCommand['type']): void;
  onDeploy(cityId: CityId): void;
  onTransport(cityId: CityId): void;
  onClose(): void;
}

export function CityCommandMenu({ cityId, actionPoints, position, onClose, onCommand, onDeploy, onTransport }: CityCommandMenuProps) {
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  const closeCurrentLevel = useCallback(() => {
    if (activeSection) {
      setActiveSection(null);
      return;
    }
    onClose();
  }, [activeSection, onClose]);

  const isDisabled = (item: { command?: GameCommand['type']; action?: 'deploy' | 'transport' }) => {
    if (item.command) return actionPoints < COMMAND_AP[item.command];
    if (item.action === 'deploy' || item.action === 'transport') return actionPoints < DEPLOY_AP_COST;
    return false;
  };

  const runCommand = (item: { command?: GameCommand['type']; action?: 'deploy' | 'transport' }) => {
    if (isDisabled(item)) return;
    if (item.action === 'deploy') onDeploy(cityId);
    if (item.action === 'transport') onTransport(cityId);
    if (item.command) onCommand(item.command);
    onClose();
  };

  useEffect(() => {
    const handleContextMenu = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      playRightMouseSound();
      closeCurrentLevel();
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => document.removeEventListener('contextmenu', handleContextMenu, true);
  }, [closeCurrentLevel]);

  useEffect(() => {
    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      if (activeSection) {
        setActiveSection(null);
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [activeSection, onClose]);

  return (
    <nav
      ref={menuRef}
      className="city-command-menu tool-panel"
      data-testid="city-command-menu"
      style={{ left: position.x, top: position.y } as CSSProperties}
      aria-label="城池命令菜单"
      onContextMenu={(event) => closePopupOnContextMenu(event, closeCurrentLevel)}
    >
      <div className="city-command-primary">
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            data-testid={`city-command-section-${id}`}
            className={activeSection === id ? 'is-active' : ''}
            onClick={() => {
              playClickOnSound();
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
          {SUB_COMMANDS[activeSection].map((item) => (
            <button
              key={item.label}
              type="button"
              data-testid={item.action ? `city-command-action-${item.action}` : item.command ? `city-command-command-${item.command}` : undefined}
              className={isDisabled(item) ? 'is-disabled' : undefined}
              disabled={isDisabled(item)}
              onClick={() => runCommand(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
