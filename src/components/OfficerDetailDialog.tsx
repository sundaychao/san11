import { X } from 'lucide-react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { officerAge } from '../game/health';
import { officerLoyalty, officerAmbition, officerRighteousness } from '../game/loyalty';
import { derivePersonality } from '../game/debate';
import { affinityOf, officerCompatWithRuler } from '../game/diplomacy';
import { officerSkillNames, skillDefinition } from '../game/skills';
import { treasureDefinition } from '../game/treasures';
import { officerRelationshipIds, RELATIONSHIP_LABELS } from '../game/relationship';
import { hasMasterHearts } from '../game/techs';
import type { GameState, Officer, OfficerAptitudes } from '../game/types';
import { OfficerHealthBadge } from './OfficerHealthBadge';
import { closePopupOnContextMenu } from './popupEvents';

interface OfficerDetailDialogProps {
  officer: Officer;
  state: GameState;
  onClose(): void;
}

const PERSONALITY_LABELS: Record<string, string> = {
  reckless: '莽撞',
  bold: '刚胆',
  calm: '冷静',
  timid: '小心',
};

const APTITUDE_LABELS: Array<{ key: 'spear' | 'halberd' | 'crossbow' | 'cavalry' | 'siege' | 'navy'; label: string }> = [
  { key: 'spear', label: '枪' },
  { key: 'halberd', label: '戟' },
  { key: 'crossbow', label: '弩' },
  { key: 'cavalry', label: '骑' },
  { key: 'siege', label: '兵器' },
  { key: 'navy', label: '水军' },
];

const FALLBACK_APTITUDES: OfficerAptitudes = {
  spear: 'B',
  halberd: 'B',
  crossbow: 'B',
  cavalry: 'B',
  siege: 'C',
  navy: 'C',
};

function locationName(officer: Officer, state: GameState): string {
  if (officer.location.kind === 'city') return state.cities[officer.location.cityId].name;
  if (officer.location.kind === 'unit') return '出征部队';
  if (officer.location.kind === 'transfer') return `在途·${state.cities[officer.location.targetCityId].name}`;
  if (officer.location.kind === 'task') {
    const map: Record<string, string> = {
      research: '研究科技',
      cultivate: '培育能力',
      construction: '建设设施',
      armament: '生产兵装',
    };
    return map[officer.location.task] ?? '执行任务';
  }
  if (officer.location.kind === 'captive') return `战俘@${state.cities[officer.location.cityId].name}`;
  return state.cities[officer.cityId]?.name ?? '在野';
}

/** 忠诚稳定性说明（供悬浮与详情展示用） */
function stabilityLines(state: GameState, officer: Officer): string[] {
  const lines: string[] = [];
  if (!officer.forceId) return lines;
  const rulerId = state.forces[officer.forceId]?.leaderId;
  const dislikesRuler = rulerId !== undefined && (officer.hates ?? []).includes(rulerId);
  const relations = officerRelationshipIds(officer);

  if (relations.length > 0) lines.push('义兄弟/配偶在营，忠诚锁定');
  else if (dislikesRuler) lines.push('厌恶君主，必降忠诚');
  else {
    const { tier } = officerCompatWithRuler(state, officer, officer.forceId);
    if (tier.key === 'far') lines.push('与君主相性相克，忠诚易流失');
  }
  if (rulerId !== undefined && (officer.likes ?? []).includes(rulerId)) lines.push('亲爱君主，忠诚稳定');
  if (hasMasterHearts(state, officer.forceId)) lines.push('本方掌握人心，掉忠概率下降');
  if (lines.length === 0) lines.push('忠诚稳定');
  return lines;
}

export function OfficerDetailDialog({ officer, state, onClose }: OfficerDetailDialogProps) {
  const audio = useAudioEventAdapter();
  const forceName = officer.forceId ? state.forces[officer.forceId].name : '在野';
  const age = officerAge(state, officer);
  const aptitudes = officer.aptitudes ?? FALLBACK_APTITUDES;
  const skillNames = officerSkillNames(officer);
  const primarySkill = skillNames[0];
  const treasure = officer.treasureId ? treasureDefinition(officer.treasureId) : undefined;
  const rulerId = officer.forceId ? state.forces[officer.forceId]?.leaderId : undefined;
  const { diff, tier } = officer.forceId
    ? officerCompatWithRuler(state, officer, officer.forceId)
    : { diff: null, tier: null } as { diff: number | null; tier: { label: string } | null };

  const likes = (officer.likes ?? []).map((id) => state.officers[id]?.name).filter(Boolean);
  const hates = (officer.hates ?? []).map((id) => state.officers[id]?.name).filter(Boolean);
  const relations = officerRelationshipIds(officer).map((id) => {
    const name = state.officers[id]?.name ?? '未知';
    const label = RELATIONSHIP_LABELS[officer.relationships![id] ?? 'sworn'] ?? '义兄弟';
    return `${name}（${label}）`;
  });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="officer-detail-dialog tool-panel" data-testid="officer-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="officer-detail-title">
        <header>
          <div>
            <p>{forceName} · {locationName(officer, state)}</p>
            <h2 id="officer-detail-title">{officer.name}<OfficerHealthBadge officer={officer} /></h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭武将详情" title="关闭" onClick={onClose} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}><X /></button>
        </header>

        <dl className="unit-detail-grid">
          <div><dt>势力</dt><dd>{forceName}</dd></div>
          <div><dt>城池</dt><dd>{officer.cityId ? state.cities[officer.cityId]?.name : '—'}</dd></div>
          <div><dt>状态</dt><dd>{locationName(officer, state)}</dd></div>
          <div><dt>年龄</dt><dd>{age === null ? '—' : officer.deathMonth !== undefined ? `终年${age}` : `${age}岁`}</dd></div>
          <div><dt>性别</dt><dd>{officer.gender === 'female' ? '女' : '男'}</dd></div>
          <div><dt>性格</dt><dd>{PERSONALITY_LABELS[officer.personality ?? derivePersonality(officer.stats)] ?? '—'}</dd></div>
        </dl>

        <dl className="unit-detail-grid">
          {(['leadership', 'war', 'intelligence', 'politics', 'charisma'] as const).map((key) => (
            <div key={key}><dt>{STAT_LABELS[key]}</dt><dd><strong>{officer.stats[key]}</strong></dd></div>
          ))}
        </dl>

        <dl className="unit-detail-grid">
          {APTITUDE_LABELS.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{aptitudes[key]}</dd></div>)}
        </dl>

        <section className="unit-detail-skill" aria-label="特技">
          <h3>特技</h3>
          <p>
            {skillNames.length > 0 ? skillNames.join(' / ') : '无'}
            {primarySkill ? <span className="unit-detail-skill-desc"> — {skillDefinition(primarySkill)?.description ?? ''}</span> : null}
          </p>
        </section>

        <section className="officer-detail-loyalty" aria-label="忠诚与相性">
          <h3>忠诚与相性</h3>
          <dl className="unit-detail-grid">
            <div><dt>忠诚</dt><dd><strong>{officer.forceId && officer.id === state.forces[officer.forceId]?.leaderId ? '-' : officerLoyalty(officer)}</strong></dd></div>
            <div><dt>野心</dt><dd>{officerAmbition(officer)}</dd></div>
            <div><dt>情义</dt><dd>{officerRighteousness(officer)}</dd></div>
            <div><dt>相性</dt><dd>{affinityOf(state, officer)}{diff !== null && diff !== undefined ? `（差${diff} ${tier?.label ?? ''}）` : ''}</dd></div>
          </dl>
          {stabilityLines(state, officer).length > 0 && (
            <ul>
              {stabilityLines(state, officer).map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {(likes.length > 0 || hates.length > 0 || relations.length > 0) && (
            <dl className="officer-detail-relations">
              {likes.length > 0 && <div><dt>亲爱</dt><dd>{likes.join('、')}</dd></div>}
              {hates.length > 0 && <div><dt>厌恶</dt><dd>{hates.join('、')}</dd></div>}
              {relations.length > 0 && <div><dt>关系</dt><dd>{relations.join('；')}</dd></div>}
            </dl>
          )}
        </section>

        {treasure && (
          <section className="unit-detail-skill" aria-label="宝物">
            <h3>宝物</h3>
            <p>{treasure.name} — {treasure.description ?? ''}</p>
          </section>
        )}
      </section>
    </div>
  );
}

const STAT_LABELS: Record<'leadership' | 'war' | 'intelligence' | 'politics' | 'charisma', string> = {
  leadership: '统率',
  war: '武力',
  intelligence: '智力',
  politics: '政治',
  charisma: '魅力',
};