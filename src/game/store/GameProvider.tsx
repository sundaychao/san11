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
import {
  attackCity as resolveAttackCity,
  attackUnit as resolveAttackUnit,
  deployUnit as resolveDeployUnit,
  moveUnit as resolveMoveUnit,
  waitUnit as resolveWaitUnit,
} from '../battle/actions';
import { executeCommand } from '../commands';
import {
  clearSave,
  clearSaves,
  loadSave,
  type LoadResult,
  type SaveAdapter,
  type SaveSlot,
  writeSave,
} from '../persistence';
import type { GridCoord } from '../battle/grid';
import { createGame, FORCE_IDS } from '../scenario/jingxiang208';
import { settleMonth, settleTenDay } from '../turn';
import type { CityId, ForceId, GameCommand, GameState, TroopType } from '../types';

interface GameContextValue {
  state: GameState | null;
  selectedCityId: CityId | null;
  error: string | null;
  hasAutosave: boolean;
  hasManualSave: boolean;
  invalidSaves: Array<{ slot: SaveSlot; reason: string }>;
  startGame(forceId: ForceId, seed?: number): void;
  loadGame(slot: SaveSlot): LoadResult;
  issueCommand(command: GameCommand): void;
  deployUnit(input: { cityId: CityId; officerId: string; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; food: number }): void;
  moveUnit(unitId: string, destination: { q: number; r: number }): void;
  attackUnit(attackerId: string, targetId: string): void;
  attackCity(attackerId: string, cityId: CityId): void;
  waitUnit(unitId: string): void;
  endMonth(): void;
  endTenDay(): void;
  manualSave(): void;
  resetGame(): void;
  clearSave(slot: SaveSlot): void;
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

function runOpponentTurns(state: GameState) {
  let next = state;
  for (const forceId of FORCE_IDS) {
    if (forceId !== state.playerForceId) next = runAiTurn(next, forceId);
  }
  return next;
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

  const applyBattleAction = useCallback((action: (current: GameState) => GameState) => {
    if (!state) throw new Error('尚未开始游戏');
    try {
      const next = action(state);
      dispatch({ type: 'replace', state: next });
      setError(null);
      persist('auto', next);
    } catch (battleError) {
      const message = battleError instanceof Error ? battleError.message : '战斗命令执行失败';
      setError(message);
      throw battleError;
    }
  }, [persist, state]);

  const deployBattleUnit = useCallback((input: { cityId: CityId; officerId: string; targetCityId?: CityId; troopType?: TroopType; destination?: GridCoord; troops: number; food: number }) => {
    applyBattleAction((current) => resolveDeployUnit(current, current.playerForceId, input));
  }, [applyBattleAction]);

  const moveBattleUnit = useCallback((unitId: string, destination: { q: number; r: number }) => {
    applyBattleAction((current) => resolveMoveUnit(current, current.playerForceId, unitId, destination));
  }, [applyBattleAction]);

  const attackBattleUnit = useCallback((attackerId: string, targetId: string) => {
    applyBattleAction((current) => resolveAttackUnit(current, current.playerForceId, attackerId, targetId));
  }, [applyBattleAction]);

  const attackBattleCity = useCallback((attackerId: string, cityId: CityId) => {
    applyBattleAction((current) => resolveAttackCity(current, current.playerForceId, attackerId, cityId));
  }, [applyBattleAction]);

  const waitBattleUnit = useCallback((unitId: string) => {
    applyBattleAction((current) => resolveWaitUnit(current, current.playerForceId, unitId));
  }, [applyBattleAction]);

  const endMonth = useCallback(() => {
    if (!state) return;
    let next = runOpponentTurns(state);
    next = settleMonth(next);
    dispatch({ type: 'replace', state: next });
    setError(null);
    persist('auto', next);
  }, [persist, state]);

  const endTenDay = useCallback(() => {
    if (!state) return;
    const next = settleTenDay(runOpponentTurns(state));
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

  const clearSaveSlot = useCallback((slot: SaveSlot) => {
    clearSave(storage, slot);
    setSaveRevision((value) => value + 1);
  }, [storage]);

  const availability = useMemo(() => {
    const auto = loadSave(storage, 'auto');
    const manual = loadSave(storage, 'manual');
    const invalidSaves = ([['auto', auto], ['manual', manual]] as const).flatMap(([slot, result]) => (
      !result.ok && result.reason !== '没有存档' ? [{ slot, reason: result.reason }] : []
    ));
    return {
      hasAutosave: auto.ok,
      hasManualSave: manual.ok,
      invalidSaves,
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
    deployUnit: deployBattleUnit,
    moveUnit: moveBattleUnit,
    attackUnit: attackBattleUnit,
    attackCity: attackBattleCity,
    waitUnit: waitBattleUnit,
    endMonth,
    endTenDay,
    manualSave,
    resetGame,
    clearSave: clearSaveSlot,
    selectCity: setSelectedCityId,
    clearError: () => setError(null),
  }), [attackBattleCity, attackBattleUnit, availability, clearSaveSlot, deployBattleUnit, endMonth, endTenDay, error, issueCommand, loadGame, manualSave, moveBattleUnit, resetGame, selectedCityId, startGame, state, waitBattleUnit]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame 必须在 GameProvider 内使用');
  return value;
}
