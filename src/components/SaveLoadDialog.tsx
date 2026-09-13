import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import {
  SAVE_SLOT_COUNT,
  SAVE_SLOT_PAGE_COUNT,
  SAVE_SLOT_PAGE_SIZE,
  buildSlotMeta,
  slotNumberLabel,
  slotPageLabel,
  slotPageRange,
  type MapCamera,
  type SaveSlotMeta,
} from '../game/saveSlots';
import { useGame } from '../game/store/GameProvider';
import { closePopupOnContextMenu } from './popupEvents';

export type SaveLoadDialogMode = 'save' | 'load';

interface SaveLoadDialogProps {
  mode: SaveLoadDialogMode;
  /** 存档时由主地图实时回报的镜头 */
  getCamera?(): MapCamera | null;
  onClose(): void;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatSavedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatPlayTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function formatAmount(value: number) {
  return value.toLocaleString('en-US');
}

/**
 * 储存 / 载入 对话框：左右分栏，左侧 4 页签 × 8 槽位，右侧为选中存档的势力信息与势力图。
 * 载入模式与储存模式共用同一套界面（原版一致的双向复用）。
 */
export function SaveLoadDialog({ mode, getCamera, onClose }: SaveLoadDialogProps) {
  const audio = useAudioEventAdapter();
  const { state, saveSlots, latestSaveSlot, saveToSlot, loadFromSlot, deleteSaveSlot, error, clearError } = useGame();

  const [page, setPage] = useState(() => {
    if (latestSaveSlot) {
      const index = latestSaveSlot - 1;
      return Math.floor(index / SAVE_SLOT_PAGE_SIZE) + 1;
    }
    return 1;
  });
  const [selectedSlot, setSelectedSlot] = useState<number | null>(() => (mode === 'load' ? latestSaveSlot : null));
  /** 鼠标悬停（或键盘聚焦）的槽位：右侧信息面板优先跟随它，移开后回落到选中档 */
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [pendingSave, setPendingSave] = useState<{ slot: number; overwrite: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const metaAt = useCallback((slot: number) => saveSlots[slot - 1] ?? null, [saveSlots]);
  const selectedMeta = selectedSlot ? metaAt(selectedSlot) : null;
  const hoveredMeta = hoveredSlot ? metaAt(hoveredSlot) : null;
  /** 悬停优先于选中：鼠标扫过哪一格，右侧就显示哪一格的存档信息（空格不抢占，仍显示选中档） */
  const previewMeta = hoveredMeta ?? selectedMeta;
  const previewSlot = hoveredMeta ? hoveredSlot : selectedMeta ? selectedSlot : null;

  /** 当前进行中的进度：没有可预览的存档时右侧回落到它，便于对照 */
  const currentMeta = useMemo<SaveSlotMeta | null>(
    () => (state ? buildSlotMeta(state, { slot: 0, playSeconds: 0 }) : null),
    [state],
  );
  const detail = previewMeta ?? currentMeta;
  const detailIsCurrent = !previewMeta;

  useEffect(() => {
    if (!pendingSave) return;
    setNote('');
    clearError();
  }, [pendingSave, clearError]);

  // 翻页时槽位行会被卸载，浏览器不会再派发 mouseleave，必须手动清掉悬停预览，否则右侧会停在上页的档位
  useEffect(() => {
    setHoveredSlot(null);
  }, [page]);

  const [start, end] = slotPageRange(page);
  const pageSlots = useMemo(
    () => Array.from({ length: end - start + 1 }, (_, index) => start + index),
    [start, end],
  );

  const closeAll = useCallback(() => {
    setPendingSave(null);
    onClose();
  }, [onClose]);

  const requestSave = (slot: number) => {
    audio.emit({ type: 'menu-click-on' });
    setSelectedSlot(slot);
    setPendingSave({ slot, overwrite: Boolean(metaAt(slot)) });
  };

  const runLoad = async (slot: number) => {
    if (!metaAt(slot)) return;
    setSelectedSlot(slot);
    setBusy(true);
    const result = await loadFromSlot(slot);
    setBusy(false);
    if (result.ok) {
      audio.emit({ type: 'menu-click-on' });
      onClose();
    }
  };

  const confirmSave = async () => {
    if (!pendingSave) return;
    setBusy(true);
    const result = await saveToSlot(pendingSave.slot, { note: note.trim(), camera: getCamera?.() ?? null });
    setBusy(false);
    if (result.ok) {
      audio.emit({ type: 'menu-click-on' });
      setPendingSave(null);
      setSelectedSlot(pendingSave.slot);
      // 存档完成直接回到游戏界面，不再停留在存档列表页
      onClose();
    }
  };

  const onSlotActivate = (slot: number) => {
    if (busy) return;
    if (mode === 'save') requestSave(slot);
    else void runLoad(slot);
  };

  return (
    <div
      className="modal-backdrop save-backdrop"
      onContextMenu={(event) => closePopupOnContextMenu(event, closeAll, audio)}
    >
      <section
        className="save-dialog tool-panel"
        data-testid="save-load-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'save' ? '储存' : '载入'}
      >
        <header className="save-dialog-header">
          <h2>{mode === 'save' ? '储存' : '载入'}</h2>
          <p>{mode === 'save' ? '选择要保存的位置' : '选择要读取的存档'}</p>
        </header>

        <div className="save-dialog-body">
          <div className="save-slots">
            <div className="save-pages" role="tablist" aria-label="存档分页">
              {Array.from({ length: SAVE_SLOT_PAGE_COUNT }, (_, index) => index + 1).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={page === item}
                  className={page === item ? 'is-active' : undefined}
                  data-testid={`save-page-${item}`}
                  onClick={() => setPage(item)}
                >
                  {slotPageLabel(item)}
                </button>
              ))}
            </div>
            <ul className="save-slot-list">
              {pageSlots.map((slot) => {
                const meta = metaAt(slot);
                const isLatest = slot === latestSaveSlot;
                const displayNumber = slot <= SAVE_SLOT_COUNT ? slot : null;
                return (
                  <li key={slot}>
                    <button
                      type="button"
                      data-testid={`save-slot-${slot}`}
                      className={[
                        'save-slot-row',
                        meta ? 'has-save' : 'is-empty',
                        selectedSlot === slot ? 'is-selected' : '',
                        hoveredSlot === slot ? 'is-previewed' : '',
                      ].filter(Boolean).join(' ')}
                      aria-label={`${slot}号存档${meta ? `，${meta.forceName}，${formatSavedAt(meta.savedAt)}` : '，空'}`}
                      onClick={() => onSlotActivate(slot)}
                      onDoubleClick={() => { if (mode === 'load') void runLoad(slot); }}
                      onMouseEnter={() => setHoveredSlot(slot)}
                      onMouseLeave={() => setHoveredSlot((current) => (current === slot ? null : current))}
                      onFocus={() => setHoveredSlot(slot)}
                      onBlur={() => setHoveredSlot((current) => (current === slot ? null : current))}
                    >
                      <span className="save-slot-number">{displayNumber ? slotNumberLabel(displayNumber) : '--'}</span>
                      {meta ? (
                        <>
                          <span className="save-slot-force">{meta.forceName}</span>
                          <span className="save-slot-time">{formatSavedAt(meta.savedAt)}</span>
                          {isLatest && <span className="save-slot-latest">最终更新</span>}
                        </>
                      ) : (
                        <span className="save-slot-empty">空</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <aside className="save-detail" data-testid="save-detail">
            {detail ? (
              <>
                <div className="save-detail-head">
                  <strong className="save-detail-slot" data-testid="save-detail-slot">
                    {previewSlot ? slotNumberLabel(previewSlot) : '--'}
                  </strong>
                  <div className="save-detail-title">
                    <span>建安{detail.year}年 {detail.monthLabel}</span>
                    <em>{detailIsCurrent ? '当前进度' : detail.scenarioLabel}</em>
                  </div>
                </div>

                <div className="save-detail-identity">
                  <div className="save-portrait" style={{ borderColor: detail.forceColor }}>
                    <b style={{ background: detail.forceColor }}>{detail.leaderName.slice(-2)}</b>
                  </div>
                  <div className="save-detail-names">
                    <strong style={{ color: detail.forceColor }}>{detail.forceName}</strong>
                    <span>{detail.leaderName}</span>
                    <small>{detail.tenDayLabel} · {detail.cityCount} 城 / {detail.officerCount} 将</small>
                  </div>
                </div>

                <div className="save-detail-tags">
                  <span>1人游玩</span>
                  <span className="save-tag-scenario">{detail.scenarioLabel}</span>
                  <span className={detail.phase === 'playing' ? 'save-tag-playing' : 'save-tag-finished'}>
                    {detail.phase === 'playing' ? '进行中' : '已结束'}
                  </span>
                </div>

                <dl className="save-detail-rows">
                  <div>
                    <dt>最终更新</dt>
                    <dd>{previewMeta ? formatSavedAt(previewMeta.savedAt) : '—'}</dd>
                  </div>
                  <div>
                    <dt>总时间</dt>
                    <dd>{formatPlayTime(detail.playSeconds)}</dd>
                  </div>
                  <div>
                    <dt>金 / 兵粮</dt>
                    <dd>{formatAmount(detail.gold)} / {formatAmount(detail.food)}</dd>
                  </div>
                  <div>
                    <dt>兵力</dt>
                    <dd>{formatAmount(detail.troops)}</dd>
                  </div>
                </dl>

                <div className="save-detail-note">
                  <span>注解</span>
                  <p>{previewMeta?.note || '—'}</p>
                </div>

                <div className="save-detail-map">
                  <span className="save-detail-map-title">势力图</span>
                  <div className="save-force-map" data-testid="save-force-map">
                    {detail.cities.map((city) => (
                      <i
                        key={city.id}
                        className="save-force-dot"
                        style={{ left: `${city.x * 100}%`, top: `${city.y * 100}%`, background: city.color }}
                        title={city.name}
                      />
                    ))}
                  </div>
                  <ul className="save-force-legend">
                    {detail.legend.slice(0, 6).map((item) => (
                      <li key={item.id}>
                        <i style={{ background: item.color }} />
                        <span>{item.name}</span>
                        <b>{item.cities}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <p className="save-detail-blank">暂无存档</p>
            )}
          </aside>
        </div>

        <footer className="save-dialog-footer">
          <button type="button" className="save-back-button" data-testid="save-dialog-back" onClick={closeAll}>
            返回
          </button>
          <span className="save-dialog-hint">
            {mode === 'save'
              ? '点选位置后确认即可存入，已有存档可覆盖'
              : selectedSlot && !metaAt(selectedSlot)
                ? '该位置为空'
                : '点选存档即可读取，镜头与原存档一致'}
          </span>
          {selectedSlot && metaAt(selectedSlot) && (
            <button
              type="button"
              className="save-delete-button"
              data-testid="save-dialog-delete"
              onClick={() => {
                deleteSaveSlot(selectedSlot);
                setSelectedSlot(null);
              }}
            >
              删除此存档
            </button>
          )}
        </footer>

        {error && !pendingSave && (
          <button type="button" className="save-dialog-error" onClick={clearError}>{error}</button>
        )}

        {pendingSave && (
          <div className="save-confirm-backdrop">
            <div className="save-confirm tool-panel" role="alertdialog" aria-modal="true" data-testid="save-confirm">
              <h3>
                {pendingSave.overwrite
                  ? `覆盖 ${slotNumberLabel(pendingSave.slot)} 号存档？`
                  : `存入 ${slotNumberLabel(pendingSave.slot)} 号存档`}
              </h3>
              <p>
                {pendingSave.overwrite
                  ? '该位置已有存档，覆盖后原进度无法恢复。'
                  : '当前进度将保存到该位置，可随时载入。'}
              </p>
              <label className="save-confirm-note">
                <span>注解</span>
                <input
                  type="text"
                  value={note}
                  maxLength={40}
                  placeholder="可留空"
                  data-testid="save-confirm-note"
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              {error && <p className="save-confirm-error">{error}</p>}
              <footer>
                <button type="button" className="secondary-button" onClick={() => setPendingSave(null)}>取消</button>
                <button
                  type="button"
                  className="primary-button"
                  data-testid="save-confirm-submit"
                  disabled={busy}
                  onClick={() => void confirmSave()}
                >
                  {busy ? '保存中…' : '确认'}
                </button>
              </footer>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
