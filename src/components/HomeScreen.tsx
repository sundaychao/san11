import { Globe, MapPlus, Play, ScrollText } from 'lucide-react';
import { useGame } from '../game/store/GameProvider';

interface HomeScreenProps {
  onEditMap(): void;
  onOnline(): void;
  onStartNew(): void;
}

/**
 * 首页四选项：载入进度（暂不做）/ 重新开始新游戏 / 联网对战 / 编辑地图。
 */
export function HomeScreen({ onEditMap, onOnline, onStartNew }: HomeScreenProps) {
  const { auth, hasAutosave, hasManualSave, invalidSaves, loadGame, logoutAccount, clearSave, error, clearError } = useGame();

  return (
    <main className="start-screen home-screen" data-testid="home-screen">
      <section className="start-title" aria-labelledby="game-title">
        <p>三国志</p>
        <h1 id="game-title">建安十三年</h1>
        <div className="start-account tool-panel">
          <span>当前账号：{auth.username}</span>
          <button type="button" onClick={logoutAccount}>退出登录</button>
        </div>
      </section>

      <section className="home-menu" aria-label="主菜单">
        <button type="button" className="home-option is-disabled" data-testid="load-save" disabled title="载入进度暂未开放">
          <ScrollText aria-hidden="true" />
          <span>
            <strong>载入进度</strong>
            <small>暂未开放</small>
          </span>
        </button>
        <button type="button" className="home-option" data-testid="start-new" onClick={onStartNew}>
          <Play aria-hidden="true" />
          <span>
            <strong>重新开始新游戏</strong>
            <small>选择一张地图开始单机征程</small>
          </span>
        </button>
        <button type="button" className="home-option" data-testid="start-online" onClick={onOnline}>
          <Globe aria-hidden="true" />
          <span>
            <strong>联网对战</strong>
            <small>与他人同图争夺天下</small>
          </span>
        </button>
        <button type="button" className="home-option" data-testid="edit-map" onClick={onEditMap}>
          <MapPlus aria-hidden="true" />
          <span>
            <strong>编辑地图</strong>
            <small>新建或修改地形 / 城池 / 关隘</small>
          </span>
        </button>

        {(hasAutosave || hasManualSave) && (
          <div className="home-save-quick">
            {hasAutosave && <button type="button" onClick={() => loadGame('auto')}>继续上次进度</button>}
            {hasManualSave && <button type="button" onClick={() => loadGame('manual')}>读取手动存档</button>}
          </div>
        )}
        {invalidSaves.length > 0 && (
          <div className="invalid-save" role="alert">
            {invalidSaves.map(({ slot, reason }) => (
              <div key={slot}>
                <span>{slot === 'auto' ? '自动存档' : '手动存档'}：{reason}</span>
                <button type="button" onClick={() => clearSave(slot)}>清除损坏的{slot === 'auto' ? '自动' : '手动'}存档</button>
              </div>
            ))}
          </div>
        )}
        {error && <button className="start-error" type="button" onClick={clearError}>{error}</button>}
      </section>
    </main>
  );
}