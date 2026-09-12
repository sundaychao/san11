import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { CUSTOM_SKILLS, ORIGINAL_SKILLS } from '../game/skills';
import type {
  SkillDefinition,
  SkillDisplayCategory,
  SkillImplementationStatus,
  SkillSystemDependency,
} from '../game/skills';
import { closePopupOnContextMenu } from './popupEvents';

const CATEGORY_ORDER: SkillDisplayCategory[] = [
  '行军',
  '攻击',
  '防御',
  '计略',
  '辅助',
  '内政',
  '收入',
  '灾害',
  '关系',
];

const STATUS_LABELS: Record<SkillImplementationStatus, string> = {
  active: '已启用',
  planned: '未启用',
  blocked: '待依赖',
};

const DEPENDENCY_LABELS: Record<SkillSystemDependency, string> = {
  navy: '水军',
  capture: '俘虏',
  injury: '负伤',
  treasure: '宝物',
  technique: '科技',
  diplomacy: '外交',
  loyalty: '忠诚',
  marriage: '婚姻',
  tribe: '异民族',
};

interface SkillGroup {
  category: SkillDisplayCategory;
  skills: SkillDefinition[];
}

/**
 * 按条目数把分类贪心分配到各列，避免长分类（攻击 35 项）撑高整行、
 * 在短分类下方留下大片空白。
 */
function balanceGroups(groups: SkillGroup[], columnCount: number): SkillGroup[][] {
  const columns: SkillGroup[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array<number>(columnCount).fill(0);
  [...groups]
    .sort((a, b) => b.skills.length - a.skills.length)
    .forEach((group) => {
      let target = 0;
      for (let index = 1; index < columnCount; index += 1) {
        if (heights[index] < heights[target]) target = index;
      }
      columns[target].push(group);
      heights[target] += group.skills.length;
    });
  return columns;
}

/**
 * 临时面板：列出当前注册表内的全部特技（原版 + 自定义），
 * 展示名称、实现状态与效果说明，仅用于开发期查阅，不参与任何规则结算。
 */
export function SkillCatalogDialog({ onClose }: { onClose(): void }) {
  const audio = useAudioEventAdapter();
  const allSkills: SkillDefinition[] = [...ORIGINAL_SKILLS, ...CUSTOM_SKILLS];
  const groups: SkillGroup[] = CATEGORY_ORDER.map((category) => ({
    category,
    skills: allSkills.filter((skill) => skill.displayCategory === category),
  })).filter((group) => group.skills.length > 0);
  const columns = balanceGroups(groups, 3);
  const activeCount = allSkills.filter((skill) => skill.implementationStatus === 'active').length;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}
    >
      <section
        className="skill-catalog-panel tool-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-catalog-title"
      >
        <header>
          <div>
            <p>临时面板 · 共 {allSkills.length} 项 · 已启用 {activeCount} 项</p>
            <h2 id="skill-catalog-title">特技一览</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        </header>
        <div className="skill-catalog-body">
          {columns.map((column, columnIndex) => (
            <div className="skill-catalog-column" key={`skill-column-${columnIndex}`}>
              {column.map(({ category, skills }) => (
                <section key={category} aria-label={`${category}特技`}>
                  <h3>
                    {category}
                    <span>{skills.length}</span>
                  </h3>
                  <ul>
                    {skills.map((skill) => (
                      <li
                        key={skill.name}
                        className={`skill-catalog-item is-${skill.implementationStatus}`}
                        data-testid={`skill-catalog-item-${skill.name}`}
                      >
                        <div className="skill-catalog-head">
                          <strong>{skill.name}</strong>
                          <em>{STATUS_LABELS[skill.implementationStatus]}</em>
                        </div>
                        <p>{skill.description}</p>
                        {skill.blockedBy && skill.blockedBy.length > 0 && (
                          <p className="skill-catalog-dependency">
                            依赖：{skill.blockedBy.map((dependency) => DEPENDENCY_LABELS[dependency]).join('、')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
