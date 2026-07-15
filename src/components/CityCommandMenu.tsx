import { Building2, ChevronRight, Swords, Users } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CityId, GameCommand } from '../game/types';

type MenuSection = 'urban' | 'military' | 'talent';

const SECTIONS: Array<{ id: MenuSection; label: string; Icon: typeof Building2 }> = [
  { id: 'urban', label: '都市', Icon: Building2 },
  { id: 'military', label: '军事', Icon: Swords },
  { id: 'talent', label: '人才', Icon: Users },
];

const SUB_COMMANDS: Record<MenuSection, Array<{ label: string; command?: GameCommand['type']; action?: 'deploy' | 'transport' }>> = {
  urban: [
    { label: '开发', command: 'develop' },
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
  position: { x: number; y: number };
  onCommand(type: GameCommand['type']): void;
  onDeploy(cityId: CityId): void;
  onTransport(cityId: CityId): void;
  onClose(): void;
}

export function CityCommandMenu({ cityId, position, onClose, onCommand, onDeploy, onTransport }: CityCommandMenuProps) {
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);
  const menuRef = useRef<HTMLElement>(null);

  const runCommand = (item: { command?: GameCommand['type']; action?: 'deploy' | 'transport' }) => {
    if (item.action === 'deploy') onDeploy(cityId);
    if (item.action === 'transport') onTransport(cityId);
    if (item.command) onCommand(item.command);
    onClose();
  };

  useEffect(() => {
    const handleContextMenu = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      if (activeSection) {
        setActiveSection(null);
        return;
      }
      onClose();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [activeSection, onClose]);

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
    >
      <div className="city-command-primary">
        {SECTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={activeSection === id ? 'is-active' : ''}
            onClick={() => setActiveSection(id)}
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
            <button key={item.label} type="button" onClick={() => runCommand(item)}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
