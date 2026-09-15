import { Building2, ChevronRight, Crown, FlaskConical, Globe, Swords, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { DEPLOY_AP_COST } from '../game/battle/actions';
import { COMMAND_AP, OFFICER_COMMANDS, banishCandidatesOf, cityAvailableOfficers, passAvailableOfficers } from '../game/commands';
import { ALLIED_ONLY_ACTIONS, DIPLOMACY_ACTIONS, DIPLOMACY_ACTION_LABELS } from '../game/diplomacy';
import { ARMAMENT_FACILITY, hasEmptyPlot, hasPlotFacility, isCityBlocked } from '../game/innerAffairs';
import { useGame } from '../game/store/GameProvider';
import type { CityId, DiplomacyAction, GameCommand, GameState, PassId } from '../game/types';
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

type MenuSection = 'urban' | 'military' | 'talent' | 'research' | 'diplomacy' | 'monarch';

const SECTIONS: Array<{ id: MenuSection; label: string; Icon: typeof Building2 }> = [
  { id: 'urban', label: '都市', Icon: Building2 },
  { id: 'military', label: '军事', Icon: Swords },
  { id: 'talent', label: '人才', Icon: Users },
  { id: 'research', label: '科技树', Icon: FlaskConical },
  { id: 'diplomacy', label: '外交', Icon: Globe },
  { id: 'monarch', label: '君主', Icon: Crown },
];

type SubItem =
  | { label: string; command?: GameCommand['type']; action?: 'deploy' | 'transport'; diplomacyAction?: DiplomacyAction; cultivate?: undefined; opens?: undefined }
  | { label: string; cultivate: CultivateCategory; command?: undefined; action?: undefined; diplomacyAction?: undefined; opens?: undefined }
  | { label: string; opens: 'cultivate' | 'relate'; command?: undefined; action?: undefined; diplomacyAction?: undefined; cultivate?: undefined };

/** 仲介三级菜单：义兄弟 / 婚姻 */
type SubMenuId = 'relate';
const SUB_MENUS: Record<SubMenuId, SubItem[]> = {
  relate: [
    { label: '义兄弟', command: 'sworn' },
    { label: '婚姻', command: 'marry' },
  ],
};

const SUB_COMMANDS: Record<MenuSection, SubItem[]> = {
  urban: [
    { label: '开发', command: 'buildFacilityPlot' },
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
    { label: '移动', command: 'transfer' },
    { label: '召唤', command: 'summon' },
    { label: '探索', command: 'explore' },
    { label: '登庸', command: 'talent' },
    { label: '奖赏', command: 'reward' },
    { label: '收授宝物', command: 'grantTreasure' },
    { label: '处置俘虏', command: 'captiveDispose' },
    { label: '仲介', opens: 'relate' },
  ],
  research: [
    { label: '科技研究', command: 'research' },
    { label: '能力研究', command: 'abilityResearch' },
    { label: '培育武将', opens: 'cultivate' },
  ],
  diplomacy: [
    { label: '流言', command: 'rumor' },
    // 外交子行动直接列在二级菜单，点击即以该行动打开外交对话框（不再走页内下拉）
    ...DIPLOMACY_ACTIONS.map((diplomacyAction) => ({
      label: DIPLOMACY_ACTION_LABELS[diplomacyAction],
      command: 'diplomacy' as const,
      diplomacyAction,
    })),
  ],
  monarch: [
    { label: '官职', command: 'appointPosition' },
    { label: '军师', command: 'appointStrategist' },
    { label: '委任军团', command: 'legion' },
    { label: '流放', command: 'banish' },
  ],
};

interface CityCommandMenuProps {
  cityId: CityId;
  /** 关隘据点 id：存在时以关隘为宿主（武将/训练/巡查等判断走关隘自身数据） */
  passId?: PassId;
  /** 关隘等据点菜单：不显示「都市」段（无都市相关操作） */
  hideUrban?: boolean;
  actionPoints: number;
  /** 商人本旬是否到访且未交易（无商人时禁用交易项） */
  merchantAvailable: boolean;
  position: { x: number; y: number };
  onCommand(type: GameCommand['type'], passId?: PassId, diplomacyAction?: DiplomacyAction): void;
  /** 右键"官职"项：打开独立拖拽面板而非原 select 对话框 */
  onAppointPosition?(): void;
  /** 君主「流放」：直接打开全势力武将选择页（多选），不经命令对话框 */
  onBanish?(cityId: CityId): void;
  onCultivate(category: CultivateCategory, passId?: PassId): void;
  onOpenCultivatePicker?(passId?: PassId): void;
  onDeploy(strongholdId: CityId | PassId): void;
  onTransport(strongholdId: CityId | PassId): void;
  onClose(): void;
}

export function CityCommandMenu({ cityId, passId, hideUrban = false, actionPoints, merchantAvailable, position, onClose, onCommand, onAppointPosition, onBanish, onCultivate, onOpenCultivatePicker, onDeploy, onTransport }: CityCommandMenuProps) {
  const audio = useAudioEventAdapter();
  const { state } = useGame();
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<SubMenuId | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  // 据点可用武将：关隘模式按驻关武将过滤，城池模式按驻城武将过滤
  const availableOfficers = state
    ? (passId
      ? passAvailableOfficers(state, state.playerForceId, passId)
      : cityAvailableOfficers(state, state.playerForceId, cityId))
    : [];

  const closeCurrentLevel = useCallback(() => {
    if (activeSubmenu) {
      setActiveSubmenu(null);
      return;
    }
    if (activeSection) {
      setActiveSection(null);
      return;
    }
    onClose();
  }, [activeSection, activeSubmenu, onClose]);

  const isDisabled = (item: SubItem) => {
    if ('opens' in item && item.opens) return false;
    // 请求援军/破弃同盟：己方尚无任何同盟势力时不可用（没盟友可求援、也没盟可破）
    if (state && item.diplomacyAction && ALLIED_ONLY_ACTIONS.includes(item.diplomacyAction)
      && (state.forces[state.playerForceId]?.allies ?? []).length === 0) {
      return true;
    }
    // 本据点无可行动武将：所有需要武将执行的命令置灰
    const noOfficers = availableOfficers.length === 0;
    if (state && item.command && OFFICER_COMMANDS.has(item.command) && noOfficers) {
      return true;
    }
    // 移动：本据点无可行动武将时同样置灰（被移动的武将须在本据点未行动）
    if (item.command === 'transfer' && noOfficers) return true;
    // 出征/输送同样需要本城武将带队
    if ((item.action === 'deploy' || item.action === 'transport') && noOfficers) return true;
    if ('cultivate' in item && item.cultivate) {
      if (state) return !hasCultivationAvailable(state, item.cultivate);
      return true;
    }
    if (item.command === 'trade') return !merchantAvailable || actionPoints < COMMAND_AP.trade;
    // 流放：本势力没有可流放的武将（除君主外的驻城/驻关武将）时置灰
    if (item.command === 'banish' && state) return banishCandidatesOf(state, state.playerForceId).length === 0;
    // 婚姻：需本据点同时存在一男一女可用武将，否则不可点击
    if (item.command === 'marry' && state) {
      const leader = state.forces[state.playerForceId]?.leaderId;
      const hasMan = availableOfficers.some((o) => o.id !== leader && !o.deathMonth && (o.gender ?? 'male') === 'male');
      const hasWoman = availableOfficers.some((o) => o.id !== leader && !o.deathMonth && (o.gender ?? 'male') === 'female');
      if (!hasMan || !hasWoman) return true;
    }
    if (state) {
      const menuPass = passId ? state.passes?.[passId] : undefined;
      const menuCity = menuPass ? undefined : state.cities[cityId];
      // 兵临城下：攻击范围内有敌军时禁移动与开发（关隘不参与封锁判定）
      if (menuCity && isCityBlocked(state, menuCity)) {
        if (item.command === 'transfer') return true;
        if (item.command === 'buildFacilityPlot') return true;
      }
      // 开发：城中已无空闲建设用地（全部已建成或建设中）时直接置灰
      if (item.command === 'buildFacilityPlot' && menuCity && !hasEmptyPlot(menuCity)) return true;
      if (item.command === 'train') return Boolean(menuPass?.trainedThisTenDay ?? menuCity?.trainedThisTenDay) || actionPoints < COMMAND_AP.train;
      if (item.command === 'patrol') return Boolean(menuPass?.patrolledThisTenDay ?? menuCity?.patrolledThisTenDay) || actionPoints < COMMAND_AP.patrol;
      if (item.command === 'recruit') {
        const menuGarrison = menuPass ?? menuCity;
        return !menuGarrison || !hasPlotFacility(menuGarrison, 'barracks') || actionPoints < COMMAND_AP.recruit;
      }
      if (item.command === 'produceArmament') {
        const menuGarrison = menuPass ?? menuCity;
        const anyProducible = menuGarrison ? Object.values(ARMAMENT_FACILITY).some((facility) => hasPlotFacility(menuGarrison, facility)) : false;
        if (!anyProducible) return true;
      }
    }
    if (item.command === 'research' && state && techResearching(state)) return true;
    if (item.command === 'abilityResearch' && state && abilityResearching(state)) return true;
    if (item.command) return actionPoints < COMMAND_AP[item.command];
    if (item.action === 'deploy' || item.action === 'transport') return actionPoints < DEPLOY_AP_COST;
    return false;
  };

  /** 禁用原因提示（悬停显示） */
  const disabledTitle = (item: SubItem): string | undefined => {
    if (!isDisabled(item)) return undefined;
    if (item.diplomacyAction && ALLIED_ONLY_ACTIONS.includes(item.diplomacyAction)
      && (state?.forces[state.playerForceId]?.allies ?? []).length === 0) {
      return '尚无同盟势力';
    }
    const menuPass = state && passId ? state.passes?.[passId] : undefined;
    const menuCity = state && !menuPass ? state.cities[cityId] : undefined;
    if (availableOfficers.length === 0
      && ((item.command && OFFICER_COMMANDS.has(item.command)) || item.command === 'transfer' || item.action === 'deploy' || item.action === 'transport')) {
      return passId ? '关内没有可行动的武将' : '城中没有可行动的武将';
    }
    if ((item.action === 'deploy' || item.action === 'transport') && passId && availableOfficers.length === 0) return '关内没有可行动的武将';
    if (item.command === 'transfer' && state && menuCity && isCityBlocked(state, menuCity)) return '城池被敌方封锁，无法调动武将';
    if (item.command === 'buildFacilityPlot' && state && menuCity && isCityBlocked(state, menuCity)) return '城池被敌方封锁，无法开发建设';
    if (item.command === 'buildFacilityPlot' && menuCity && !hasEmptyPlot(menuCity)) return '城中已无空闲的建设用地';
    if (item.command && actionPoints < COMMAND_AP[item.command]) return `行动力不足 ${COMMAND_AP[item.command]}`;
    if ((item.action === 'deploy' || item.action === 'transport') && actionPoints < DEPLOY_AP_COST) return `行动力不足 ${DEPLOY_AP_COST}`;
    if (item.command === 'trade' && !merchantAvailable) return '商人本旬未到访';
    if (item.command === 'banish' && state && banishCandidatesOf(state, state.playerForceId).length === 0) return '没有可流放的武将';
    if (item.command === 'train' && (menuPass?.trainedThisTenDay ?? menuCity?.trainedThisTenDay)) return passId ? '本旬该关已训练' : '本旬该城已训练';
    if (item.command === 'patrol' && (menuPass?.patrolledThisTenDay ?? menuCity?.patrolledThisTenDay)) return passId ? '本旬该关已巡查' : '本旬该城已巡查';
    if (item.command === 'recruit') {
      const menuGarrison = menuPass ?? menuCity;
      if (!menuGarrison || !hasPlotFacility(menuGarrison, 'barracks')) return '需先建设兵舍才能征兵';
    }
    return undefined;
  };

  const runCommand = (item: SubItem) => {
    if (isDisabled(item)) return;
    if ('opens' in item && item.opens) {
      if (item.opens === 'relate') {
        // 仲介：展开三级菜单（义兄弟/婚姻）
        setActiveSubmenu('relate');
        return;
      }
      onOpenCultivatePicker?.(passId);
      onClose();
      return;
    }
    if ('cultivate' in item && item.cultivate) {
      onCultivate(item.cultivate, passId);
      onClose();
      return;
    }
    if (item.action === 'deploy') onDeploy(passId ?? cityId);
    if (item.action === 'transport') onTransport(passId ?? cityId);
    if (item.command === 'appointPosition' && onAppointPosition) {
      onAppointPosition();
    } else if (item.command === 'banish') {
      // 流放：直接进入武将选择页（多选），确认后经二次提示执行
      if (onBanish) onBanish(cityId);
    } else if (item.command) {
      onCommand(item.command, passId, item.diplomacyAction);
    }
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
        {(hideUrban ? SECTIONS.filter((section) => section.id !== 'urban') : SECTIONS).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            data-testid={`city-command-section-${id}`}
            className={activeSection === id ? 'is-active' : ''}
            onClick={() => {
              audio.emit({ type: 'menu-click-on' });
              setActiveSubmenu(null);
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
                data-testid={item.diplomacyAction ? `city-command-diplomacy-${item.diplomacyAction}` : item.action ? `city-command-action-${item.action}` : ('cultivate' in item && item.cultivate) ? `city-command-cultivate-${item.cultivate}` : ('opens' in item && item.opens) ? `city-command-submenu-${item.opens}` : item.command ? `city-command-command-${item.command}` : undefined}
                className={isDisabled(item) ? 'is-disabled' : ('opens' in item && item.opens === activeSubmenu) ? 'is-active' : undefined}
                disabled={isDisabled(item)}
                title={disabledTitle(item)}
                onClick={() => runCommand(item)}
              >
                {researching ?? item.label}
              </button>
            );
          })}
        </div>
      )}

      {activeSubmenu && (
        <div className="city-command-tertiary">
          {SUB_MENUS[activeSubmenu].map((item) => (
            <button
              key={item.label}
              type="button"
              data-testid={item.command ? `city-command-command-${item.command}` : undefined}
              className={isDisabled(item) ? 'is-disabled' : undefined}
              disabled={isDisabled(item)}
              title={disabledTitle(item)}
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
