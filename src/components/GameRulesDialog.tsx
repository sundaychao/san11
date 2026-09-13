import { useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { GAME_RULES, type RuleBlock } from './gameRulesContent';
import { closePopupOnContextMenu } from './popupEvents';

function RuleBlockView({ block }: { block: RuleBlock }) {
  switch (block.kind) {
    case 'heading':
      return <h4 className="rule-heading">{block.text}</h4>;
    case 'paragraph':
      return <p className="rule-paragraph">{block.text}</p>;
    case 'bullets':
      return (
        <ul className="rule-bullets">
          {block.items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      );
    case 'formula':
      return (
        <div className="rule-formula">
          {block.caption && <span>{block.caption}</span>}
          <code>{block.text}</code>
        </div>
      );
    case 'table':
      return (
        <div className="rule-table-wrap">
          <table className="rule-table">
            <thead>
              <tr>{block.head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    cellIndex === 0
                      ? <th key={cellIndex} scope="row">{cell}</th>
                      : <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'note':
      return <p className="rule-note">{block.text}</p>;
    default:
      return null;
  }
}

/**
 * 临时面板：左侧目录列出规则项，右侧显示选中项的具体内容。
 * 文案与数值来自 `gameRulesContent.ts`，仅用于开发期查阅，不参与规则结算。
 */
export function GameRulesDialog({ onClose }: { onClose(): void }) {
  const audio = useAudioEventAdapter();
  const [selectedId, setSelectedId] = useState(GAME_RULES[0]?.id ?? '');
  const selected = GAME_RULES.find((entry) => entry.id === selectedId) ?? GAME_RULES[0];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}
    >
      <section
        className="game-rules-panel tool-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-rules-title"
      >
        <header>
          <div>
            <p>临时面板 · 共 {GAME_RULES.length} 条</p>
            <h2 id="game-rules-title">游戏规则</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        </header>

        <div className="game-rules-body">
          <nav className="game-rules-index" aria-label="规则目录">
            <p>目录</p>
            <ul>
              {GAME_RULES.map((entry) => {
                const isSelected = entry.id === selected?.id;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={isSelected ? 'is-selected' : undefined}
                      aria-current={isSelected ? 'true' : undefined}
                      data-testid={`game-rule-tab-${entry.id}`}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      {entry.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <article className="game-rules-content" data-testid="game-rule-content" aria-label={selected?.title}>
            {selected && (
              <>
                <h3>{selected.title}</h3>
                <p className="game-rules-summary">{selected.summary}</p>
                <div className="game-rules-blocks">
                  {selected.blocks.map((block, index) => <RuleBlockView key={index} block={block} />)}
                </div>
              </>
            )}
          </article>
        </div>

        <footer className="game-rules-footer">
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
        </footer>
      </section>
    </div>
  );
}
