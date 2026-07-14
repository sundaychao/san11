import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { runAiTurn } from '../ai';
import { executeCommand } from '../commands';
import {
  clearSaves,
  loadSave,
  type LoadResult,
  type SaveAdapter,
  type SaveSlot,
  writeSave,
} from '../persistence';
import { createGame, FORCE_IDS } from '../scenario/jingxiang208';
import { settleMonth } from '../turn';
import type { CityId, ForceId, GameCommand, GameState } from '../types';

interface GameContextValue {
  state: GameState | null;
  selectedCityId: CityId | null;
  error: string | null;
  hasAutosave: boolean;
  hasManualSave: boolean;
  saveProblem: string | null;
  startGame(forceId: ForceId, seed?: number): void;
  loadGame(slot: SaveSlot): LoadResult;
  issueCommand(command: GameCommand): void;
  endMonth(): void;
  manualSave(): void;
  resetGame(): void;
  selectCity(cityId: CityId | null): void;
  clearError(): void;
}

type GameAction =
  | { type: 'start'; state: GameState }
  | { type: 'replace'; state: GameState }
  | { type: 'reset' };

function reducer(_state: GameState | null, action: GameAction): GameState | null {
  if (action.type === 'start' || action.type === 'replace') return action.state;
  return null;
}

const GameContext = createContext<GameContextValue | null>(null);

interface GameProviderProps extends PropsWithChildren {
  initialState?: GameState | null;
  storage?: SaveAdapter;
}

function browserStorage(): SaveAdapter {
  if (typeof window === 'undefined') throw new Error('浏览器存储不可用');
  return window.localStorage;
}

export function GameProvider({ children, initialState = null, storage: storageProp }: GameProviderProps) {
  const storage = storageProp ?? browserStorage();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedCityId, setSelectedCityId] = useState<CityId | null>(() => (
    initialState
      ? Object.values(initialState.cities).find((city) => city.ownerId === initialState.playerForceId)?.id ?? null
      : null
  ));
  const [error, setError] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);

  const persist = useCallback((slot: SaveSlot, next: GameState) => {
    writeSave(storage, slot, next);
    setSaveRevision((value) => value + 1);
  }, [storage]);

  const startGame = useCallback((forceId: ForceId, seed = Date.now()) => {
    const next = createGame(forceId, seed);
    dispatch({ type: 'start', state: next });
    setSelectedCityId(Object.values(next.cities).find((city) => city.ownerId === forceId)?.id ?? null);
    setError(null);
    persist('auto', next);
  }, [persist]);

  const loadGame = useCallback((slot: SaveSlot) => {
    const result = loadSave(storage, slot);
    if (result.ok) {
      dispatch({ type: 'replace', state: result.state });
      setSelectedCityId(Object.values(result.state.cities).find((city) => city.ownerId === result.state.playerForceId)?.id ?? null);
      setError(null);
    } else if (result.reason !== '没有存档') {
      setError(result.reason);
    }
    return result;
  }, [storage]);

  const issueCommand = useCallback((command: GameCommand) => {
    if (!state) throw new Error('尚未开始游戏');
    try {
      const next = executeCommand(state, state.playerForceId, command);
      dispatch({ type: 'replace', state: next });
      setError(null);
      persist('auto', next);
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : '命令执行失败';
      setError(message);
      throw commandError;
    }
  }, [persist, state]);

  const endMonth = useCallback(() => {
    if (!state) return;
    let next = state;
    for (const forceId of FORCE_IDS) {
      if (forceId !== state.playerForceId) next = runAiTurn(next, forceId);
    }
    next = settleMonth(next);
    dispatch({ type: 'replace', state: next });
    setError(null);
    persist('auto', next);
  }, [persist, state]);

  const manualSave = useCallback(() => {
    if (!state) return;
    persist('manual', state);
  }, [persist, state]);

  const resetGame = useCallback(() => {
    clearSaves(storage);
    dispatch({ type: 'reset' });
    setSelectedCityId(null);
    setError(null);
    setSaveRevision((value) => value + 1);
  }, [storage]);

  const availability = useMemo(() => {
    const auto = loadSave(storage, 'auto');
    const manual = loadSave(storage, 'manual');
    const invalid = [auto, manual].find((result) => !result.ok && result.reason !== '没有存档');
    return {
      hasAutosave: auto.ok,
      hasManualSave: manual.ok,
      saveProblem: invalid && !invalid.ok ? invalid.reason : null,
    };
  }, [saveRevision, storage]);

  const value = useMemo<GameContextValue>(() => ({
    state,
    selectedCityId,
    error,
    ...availability,
    startGame,
    loadGame,
    issueCommand,
    endMonth,
    manualSave,
    resetGame,
    selectCity: setSelectedCityId,
    clearError: () => setError(null),
  }), [availability, endMonth, error, issueCommand, loadGame, manualSave, resetGame, selectedCityId, startGame, state]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame 必须在 GameProvider 内使用');
  return value;
}
