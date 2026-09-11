import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialArmaments } from '../armaments';
import { buildFacility, deployUnit, deploymentCells, firePlotCells, movementCells, type TacticId } from '../battle/actions';
import { gridKey, neighborsOf, sevenCellCityFootprint } from '../battle/grid';
import { AUTO_SAVE_KEY, MANUAL_SAVE_KEY, type SaveAdapter } from '../persistence';
import { createGame } from '../scenario/jingxiang208';
import { settleTenDay } from '../turn';
import { GameShell } from '../../components/GameShell';
import { GameProvider, useGame } from './GameProvider';

const socketHolder = vi.hoisted(() => ({ socket: null as FakeOnlineSocket | null }));

vi.mock('../../network/socketClient', () => ({
  DEFAULT_ONLINE_SERVER_URL: 'http://localhost:8787',
  createOnlineSocket: vi.fn(() => socketHolder.socket),
}));

class MemoryStorage implements SaveAdapter {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function Probe() {
  const game = useGame();
  return (
    <div>
      <output aria-label="month">{game.state?.month ?? 0}</output>
      <output aria-label="logs">{game.state?.logs.length ?? 0}</output>
      <button onClick={() => game.startGame('liu', 1)}>start</button>
      <button onClick={() => game.issueCommand({ type: 'patrol', cityId: 'jiangling', officerIds: ['liu-bei'] })}>patrol</button>
      <button onClick={() => game.endMonth()}>end</button>
      <button onClick={() => game.manualSave()}>save</button>
      <button onClick={() => game.resetGame()}>reset</button>
    </div>
  );
}

function LocalTenDayProbe({ targetId }: { targetId: string }) {
  const game = useGame();
  return (
    <div>
      <output aria-label="target-troops">{game.state?.units[targetId]?.troops ?? 0}</output>
      <output aria-label="damage-reports">{game.state?.battleDamageReports?.map((report) => report.unitId).join(',') ?? 'none'}</output>
      <button onClick={() => game.endTenDay()}>end ten day</button>
    </div>
  );
}

function LocalRepairProbe({ facilityId }: { facilityId: string }) {
  const game = useGame();
  const report = game.state?.facilityRepairReports?.find((entry) => entry.facilityId === facilityId);
  return (
    <div>
      <output aria-label="repair-amount">{report?.amount ?? 0}</output>
      <output aria-label="repair-kind">{report?.kind ?? 'none'}</output>
      <output aria-label="durability">{game.state?.facilities?.[facilityId]?.durability ?? 0}</output>
      <button onClick={() => game.endTenDay()}>end ten day</button>
    </div>
  );
}

function LocalTenDayTwoTargetProbe({ firstTargetId, secondTargetId }: { firstTargetId: string; secondTargetId: string }) {
  const game = useGame();
  return (
    <div>
      <output aria-label="first-target-troops">{game.state?.units[firstTargetId]?.troops ?? 0}</output>
      <output aria-label="second-target-troops">{game.state?.units[secondTargetId]?.troops ?? 0}</output>
      <output aria-label="first-target-energy">{game.state?.units[firstTargetId]?.energy ?? 0}</output>
      <output aria-label="second-target-energy">{game.state?.units[secondTargetId]?.energy ?? 0}</output>
      <output aria-label="damage-reports">{game.state?.battleDamageReports?.map((report) => report.unitId).join(',') ?? 'none'}</output>
      <button onClick={() => game.endTenDay()}>end ten day</button>
    </div>
  );
}

function LocalMonthTwoTargetProbe({ firstTargetId, secondTargetId }: { firstTargetId: string; secondTargetId: string }) {
  const game = useGame();
  return (
    <div>
      <output aria-label="phase">{game.state?.phase ?? 'none'}</output>
      <output aria-label="first-target-troops">{game.state?.units[firstTargetId]?.troops ?? 0}</output>
      <output aria-label="second-target-troops">{game.state?.units[secondTargetId]?.troops ?? 0}</output>
      <output aria-label="first-target-energy">{game.state?.units[firstTargetId]?.energy ?? 0}</output>
      <output aria-label="second-target-energy">{game.state?.units[secondTargetId]?.energy ?? 0}</output>
      <output aria-label="damage-reports">{game.state?.battleDamageReports?.map((report) => report.unitId).join(',') || 'none'}</output>
      <button onClick={() => game.endMonth()}>end month</button>
    </div>
  );
}

function MoveProbe({ unitId, destination }: { unitId: string; destination: { q: number; r: number } }) {
  const game = useGame();
  return <button onClick={() => game.moveUnit(unitId, destination)}>move unit</button>;
}

function DeployProbe({ destination }: { destination: { q: number; r: number } }) {
  const game = useGame();
  return (
    <button
      onClick={() => game.deployUnit({
        cityId: 'jiangling',
        officerIds: ['guan-yu'],
        troopType: 'sword',
        destination,
        troops: 4000,
        food: 6000,
      })}
    >
      deploy unit
    </button>
  );
}

function AttackUnitProbe({ attackerId, targetId, destination }: { attackerId: string; targetId: string; destination?: { q: number; r: number } }) {
  const game = useGame();
  return <button onClick={() => game.attackUnit(attackerId, targetId, destination)}>attack unit</button>;
}

function AttackCityProbe({ attackerId }: { attackerId: string }) {
  const game = useGame();
  return <button onClick={() => game.attackCity(attackerId, 'xiangyang')}>attack city</button>;
}

function TacticProbe({ attackerId, targetId, tacticId }: { attackerId: string; targetId: string; tacticId: TacticId }) {
  const game = useGame();
  return <button onClick={() => game.useUnitTactic(attackerId, targetId, tacticId)}>use tactic</button>;
}

function FirePlotProbe({ unitId, target }: { unitId: string; target: { q: number; r: number } }) {
  const game = useGame();
  return <button onClick={() => game.useFirePlot(unitId, target)}>use fire plot</button>;
}

function FireStrategyProbe({ unitId, target }: { unitId: string; target: { q: number; r: number } }) {
  const game = useGame();
  return <button onClick={() => game.useUnitStrategy(unitId, 'fire', { coord: target })}>use fire strategy</button>;
}

function FacilityProbe({ unitId, target }: { unitId: string; target: { q: number; r: number } }) {
  const game = useGame();
  return <button onClick={() => game.buildFacility(unitId, 'arrowTower', target)}>build arrow tower</button>;
}

function RepairFacilityProbe({ unitId, facilityId }: { unitId: string; facilityId: string }) {
  const game = useGame();
  return <button onClick={() => game.repairFacility(unitId, facilityId)}>repair facility</button>;
}

function OnlineProbe() {
  const game = useGame();
  return (
    <div>
      <output aria-label="phase">{game.online.phase}</output>
      <output aria-label="room">{game.online.roomId ?? 'none'}</output>
      <output aria-label="resuming">{game.online.resumingRoom ? 'yes' : 'no'}</output>
      <output aria-label="rooms">{game.online.rooms.map((room) => room.id).join(',') || 'none'}</output>
      <output aria-label="state">{game.state ? game.state.playerForceId : 'none'}</output>
      <output aria-label="facilities">{Object.keys(game.state?.facilities ?? {}).length}</output>
      <button onClick={() => void game.loadOnlineRooms({ serverUrl: 'http://server.test' })}>load rooms</button>
      <button onClick={() => void game.createOnlineRoom({ serverUrl: 'http://server.test', seed: 1 }).catch(() => undefined)}>create room</button>
      <button onClick={() => void (game as any).resumeOnlineRoom({ serverUrl: 'http://server.test' }).catch(() => undefined)}>resume room</button>
      <button onClick={() => void game.selectOnlineForce('liu')}>select liu</button>
      <button onClick={() => void game.startOnlineGame()}>start online</button>
      <button onClick={() => game.disconnectOnline()}>leave room</button>
    </div>
  );
}

function LoginProbe() {
  const game = useGame();
  return (
    <div>
      <output aria-label="room">{game.online.roomId ?? 'none'}</output>
      <output aria-label="state">{game.state ? game.state.playerForceId : 'none'}</output>
      <button onClick={() => void game.loginAccount({ username: 'Host', password: 'secret1', serverUrl: 'http://server.test' })}>login</button>
    </div>
  );
}

class FakeOnlineSocket {
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  rejectCreateWithAuthError = false;
  delayRoomResume = false;
  skipLeaveAck = false;
  disconnected = false;
  startGameState = createGame('liu', 1);
  intentAckSnapshot: unknown = null;

  private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  private pendingRoomResumeAck: (() => void) | null = null;

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((candidate) => candidate !== handler));
    return this;
  }

  connect() {
    for (const handler of this.handlers.get('connect') ?? []) handler();
  }

  disconnect() {
    this.disconnected = true;
  }

  flushRoomResume() {
    const ack = this.pendingRoomResumeAck;
    this.pendingRoomResumeAck = null;
    ack?.();
  }

  emit(event: string, payload: Record<string, unknown>, ack?: (response: unknown) => void) {
    this.emitted.push({ event, payload });
    if (event === 'room:create') {
      if (this.rejectCreateWithAuthError) {
        ack?.({ ok: false, reason: '请先登录' });
        return;
      }
      ack?.({
        ok: true,
        snapshot: {
          playerId: 'host',
          room: {
            id: 'ABCD',
            revision: 1,
            hostPlayerId: 'host',
            phase: 'lobby',
            players: [{ id: 'host', name: 'Host', forceId: null, connected: true }],
            turnPlayerIds: [],
            activePlayerId: null,
            completedTurnPlayerIds: [],
            tenDayReadyForceIds: [],
          },
          state: null,
        },
      });
    }
    if (event === 'room:list') {
      ack?.({
        ok: true,
        rooms: [{
          id: 'WXYZ',
          hostName: 'Host',
          playerCount: 1,
          maxPlayers: 4,
          selectedForceIds: ['liu'],
        }],
      });
    }
    if (event === 'auth:session') {
      ack?.({
        ok: true,
        session: {
          token: 'token',
          userId: 'host',
          username: 'Host',
        },
      });
    }
    if (event === 'auth:login') {
      ack?.({
        ok: true,
        session: {
          token: 'token',
          userId: 'host',
          username: 'Host',
        },
      });
    }
    if (event === 'room:resume') {
      const sendAck = () => ack?.({
        ok: true,
        snapshot: {
          playerId: 'host',
          room: {
            id: 'ABCD',
            revision: 4,
            hostPlayerId: 'host',
            phase: 'playing',
            players: [
              { id: 'host', name: 'Host', forceId: 'liu', connected: true },
              { id: 'guest', name: 'Guest', forceId: 'cao', connected: false },
            ],
            turnPlayerIds: ['host', 'guest'],
            activePlayerId: 'host',
            completedTurnPlayerIds: [],
            tenDayReadyForceIds: [],
          },
          state: this.startGameState,
        },
      });
      if (this.delayRoomResume) {
        this.pendingRoomResumeAck = sendAck;
      } else {
        sendAck();
      }
    }
    if (event === 'room:selectForce') {
      ack?.({
        ok: true,
        snapshot: {
          playerId: 'host',
          room: {
            id: 'ABCD',
            revision: 2,
            hostPlayerId: 'host',
            phase: 'lobby',
            players: [{ id: 'host', name: 'Host', forceId: 'liu', connected: true }],
            turnPlayerIds: [],
            activePlayerId: null,
            completedTurnPlayerIds: [],
            tenDayReadyForceIds: [],
          },
          state: null,
        },
      });
    }
    if (event === 'room:startGame') {
      ack?.({
        ok: true,
        snapshot: {
          playerId: 'host',
          room: {
            id: 'ABCD',
            revision: 3,
            hostPlayerId: 'host',
            phase: 'playing',
            players: [
              { id: 'host', name: 'Host', forceId: 'liu', connected: true },
              { id: 'guest', name: 'Guest', forceId: 'cao', connected: true },
            ],
            turnPlayerIds: ['host', 'guest'],
            activePlayerId: 'host',
            completedTurnPlayerIds: [],
            tenDayReadyForceIds: [],
          },
          state: this.startGameState,
        },
      });
    }
    if (event === 'game:intent') {
      ack?.(this.intentAckSnapshot ? { ok: true, snapshot: this.intentAckSnapshot } : { ok: true });
    }
    if (event === 'room:leave') {
      if (this.skipLeaveAck) return;
      ack?.({ ok: true });
    }
  }

  emitServer(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

function addAdjacentEnemy(state: ReturnType<typeof createGame>, attackerId: string) {
  const attacker = state.units[attackerId];
  const enemyPosition = neighborsOf(attacker.q, attacker.r)[0];
  const targetId = 'enemy-target';
  state.units[targetId] = {
    id: targetId,
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'cao-ren',
    homeCityId: 'xiangyang',
    troopType: 'sword',
    q: enemyPosition.q,
    r: enemyPosition.r,
    troops: 3500,
    food: 3000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  state.officers['cao-ren'].location = { kind: 'unit', unitId: targetId };
  return targetId;
}

function addEnemyAfterMove(state: ReturnType<typeof createGame>, attackerId: string) {
  const attacker = state.units[attackerId];
  const destination = neighborsOf(attacker.q, attacker.r)[0];
  const enemyPosition = neighborsOf(destination.q, destination.r)
    .find((coord) => coord.q !== attacker.q || coord.r !== attacker.r)!;
  const targetId = 'enemy-after-move';
  state.units[targetId] = {
    id: targetId,
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'cao-ren',
    homeCityId: 'xiangyang',
    troopType: 'sword',
    q: enemyPosition.q,
    r: enemyPosition.r,
    troops: 3500,
    food: 3000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  state.officers['cao-ren'].location = { kind: 'unit', unitId: targetId };
  return { targetId, destination };
}

function placeUnitOutsideXiangyang(state: ReturnType<typeof createGame>, unitId: string) {
  const target = state.cities.xiangyang;
  const cityCells = new Set(Object.values(state.cities).flatMap((city) => (
    sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map(gridKey)
  )));
  const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
    .flatMap((coord) => neighborsOf(coord.q, coord.r))
    .find((coord) => !cityCells.has(gridKey(coord)))!;
  state.units[unitId].q = attackCell.q;
  state.units[unitId].r = attackCell.r;
}

describe('GameProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    socketHolder.socket = null;
  });

  it('runs commands, AI, settlement, and autosave', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<GameProvider storage={storage}><Probe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'start' }));
    await user.click(screen.getByRole('button', { name: 'patrol' }));
    await user.click(screen.getByRole('button', { name: 'end' }));

    expect(screen.getByLabelText('month')).toHaveTextContent('2');
    expect(Number(screen.getByLabelText('logs').textContent)).toBeGreaterThan(3);
    expect(storage.getItem(AUTO_SAVE_KEY)).not.toBeNull();
  });

  it('fires completed player arrow towers when advancing to the next ten-day turn', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.units['arrow-target'] = {
      id: 'arrow-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.facilities = {
      arrow: { id: 'arrow', type: 'arrowTower', forceId: 'liu', q: 10, r: 10, durability: 700, completed: true },
    };

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <LocalTenDayProbe targetId="arrow-target" />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'end ten day' }));

    expect(screen.getByLabelText('target-troops')).toHaveTextContent('2700');
    expect(screen.getByLabelText('damage-reports')).toHaveTextContent('arrow-target');
  });

  it('keeps delegated facility repair reports visible after advancing the ten-day turn', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.officers['liu-bei'].location = { kind: 'unit', unitId: 'delegate-unit' };
    state.units['delegate-unit'] = {
      id: 'delegate-unit',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'liu-bei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 10,
      r: 10,
      troops: 3000,
      food: 6000,
      energy: 100,
      movementRemaining: 20,
      moved: false,
      acted: false,
      delegate: { kind: 'repair', facilityId: 'tower' },
    };
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 11, r: 10, durability: 100, completed: false },
    };

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <LocalRepairProbe facilityId="tower" />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'end ten day' }));

    expect(screen.getByLabelText('repair-kind')).toHaveTextContent('repair');
    expect(Number(screen.getByLabelText('repair-amount').textContent)).toBeGreaterThan(0);
    expect(Number(screen.getByLabelText('durability').textContent)).toBeGreaterThan(100);
  });

  it('fires opponent force effects before local AI turns and player effects before the next ten-day turn', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.officers['guan-yu'].skill = '乐奏';
    state.officers['cao-ren'].skill = '乐奏';
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'liu-target' };
    state.officers['cao-ren'].location = { kind: 'unit', unitId: 'cao-target' };
    state.units['liu-target'] = {
      id: 'liu-target',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'guan-yu',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.units['cao-target'] = {
      id: 'cao-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 4,
      r: 4,
      troops: 3000,
      food: 3000,
      energy: 40,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.facilities = {
      liuArrow: { id: 'liuArrow', type: 'arrowTower', forceId: 'liu', q: 2, r: 4, durability: 700, completed: true },
      caoArrow: { id: 'caoArrow', type: 'arrowTower', forceId: 'cao', q: 10, r: 10, durability: 700, completed: true },
      caoMusic: { id: 'caoMusic', type: 'musicTower', forceId: 'cao', q: 4, r: 5, durability: 800, completed: true },
    };

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <LocalTenDayTwoTargetProbe firstTargetId="liu-target" secondTargetId="cao-target" />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'end ten day' }));

    expect(screen.getByLabelText('first-target-troops')).toHaveTextContent('2700');
    expect(screen.getByLabelText('second-target-troops')).toHaveTextContent('2700');
    // 刘备部队：每旬+5 + 乐奏+5 = 90；曹部队：每旬+5 + 乐奏+5 = 50（军乐台只回战力不回气力）
    expect(screen.getByLabelText('first-target-energy')).toHaveTextContent('90');
    expect(screen.getByLabelText('second-target-energy')).toHaveTextContent('50');
    expect(screen.getByLabelText('damage-reports')).toHaveTextContent('cao-target');
  });

  it('applies only the player force turn-start effects after local month settlement', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.officers['guan-yu'].skill = '乐奏';
    state.officers['cao-ren'].skill = '乐奏';
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'liu-month-target' };
    state.officers['cao-ren'].location = { kind: 'unit', unitId: 'cao-month-target' };
    state.units = {
      'liu-month-target': {
        id: 'liu-month-target', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
        homeCityId: 'jiangling', troopType: 'sword', q: 12, r: 10, troops: 3000, food: 3000,
        energy: 80, movementRemaining: 5, moved: false, acted: false,
      },
      'cao-month-target': {
        id: 'cao-month-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
        homeCityId: 'xiangyang', troopType: 'sword', q: 4, r: 4, troops: 3000, food: 3000,
        energy: 40, movementRemaining: 5, moved: false, acted: false,
      },
    };
    state.facilities = {
      liuArrow: { id: 'liuArrow', type: 'arrowTower', forceId: 'liu', q: 2, r: 4, durability: 700, completed: true },
    };

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <LocalMonthTwoTargetProbe firstTargetId="liu-month-target" secondTargetId="cao-month-target" />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'end month' }));

    expect(screen.getByLabelText('first-target-energy')).toHaveTextContent('85');
    expect(screen.getByLabelText('second-target-energy')).toHaveTextContent('45');
    expect(screen.getByLabelText('second-target-troops')).toHaveTextContent('2700');
    expect(screen.getByLabelText('damage-reports')).toHaveTextContent('cao-month-target');
  });

  it('does not trigger player force turn-start effects after the final month settlement', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.month = 24;
    state.officers['guan-yu'].skill = '乐奏';
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'liu-final-target' };
    state.units = {
      'liu-final-target': {
        id: 'liu-final-target', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
        homeCityId: 'jiangling', troopType: 'sword', q: 12, r: 10, troops: 3000, food: 3000,
        energy: 80, movementRemaining: 5, moved: false, acted: false,
      },
      'cao-final-target': {
        id: 'cao-final-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
        homeCityId: 'xiangyang', troopType: 'sword', q: 4, r: 4, troops: 3000, food: 3000,
        energy: 40, movementRemaining: 5, moved: false, acted: false,
      },
    };
    state.facilities = {
      liuArrow: { id: 'liuArrow', type: 'arrowTower', forceId: 'liu', q: 2, r: 4, durability: 700, completed: true },
      liuMusic: { id: 'liuMusic', type: 'musicTower', forceId: 'liu', q: 12, r: 11, durability: 800, completed: true },
    };

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <LocalMonthTwoTargetProbe firstTargetId="liu-final-target" secondTargetId="cao-final-target" />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'end month' }));

    expect(screen.getByLabelText('phase')).toHaveTextContent('finished');
    expect(screen.getByLabelText('first-target-energy')).toHaveTextContent('80');
    expect(screen.getByLabelText('second-target-troops')).toHaveTextContent('3000');
    expect(screen.getByLabelText('damage-reports')).toHaveTextContent('none');
  });

  it('writes manual save and resets both slots', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<GameProvider storage={storage}><Probe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'start' }));
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(storage.getItem(MANUAL_SAVE_KEY)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(storage.getItem(AUTO_SAVE_KEY)).toBeNull();
    expect(storage.getItem(MANUAL_SAVE_KEY)).toBeNull();
    expect(screen.getByLabelText('month')).toHaveTextContent('0');
  });

  it('plays the follow-me sound after a unit moves', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'sword',
      troops: 4000,
      food: 6000,
    });
    const ready = settleTenDay(deployed);
    const unitId = Object.keys(ready.units)[0];
    const destination = movementCells(ready, unitId)[0];

    render(
      <GameProvider initialState={ready} storage={new MemoryStorage()}>
        <MoveProbe unitId={unitId} destination={destination} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'move unit' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/followme.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the follow-me sound after initial deployment movement', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const state = createGame('liu', 1);
    const destination = deploymentCells(state, 'jiangling')[0];

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <DeployProbe destination={destination} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'deploy unit' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/followme.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the kill sound after a unit attacks another unit', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'sword',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attackerId = Object.keys(state.units)[0];
    const targetId = addAdjacentEnemy(state, attackerId);

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <AttackUnitProbe attackerId={attackerId} targetId={targetId} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'attack unit' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/kill.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not play the move sound when a unit moves and attacks in one command', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'sword',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attackerId = Object.keys(state.units)[0];
    const { targetId, destination } = addEnemyAfterMove(state, attackerId);

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <AttackUnitProbe attackerId={attackerId} targetId={targetId} destination={destination} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'attack unit' }));

    expect(AudioMock).toHaveBeenCalledTimes(1);
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/kill.mp3'));
    expect(AudioMock).not.toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/followme.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the kill sound after a unit attacks a city', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5 };
    const state = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    const attackerId = Object.keys(state.units)[0];
    placeUnitOutsideXiangyang(state, attackerId);

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <AttackCityProbe attackerId={attackerId} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'attack city' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/kill.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the thrust sound after spear thrust tactic', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const attackerId = Object.keys(state.units)[0];
    const targetId = addAdjacentEnemy(state, attackerId);

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <TacticProbe attackerId={attackerId} targetId={targetId} tacticId="spear-thrust" />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'use tactic' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/tuchi.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the fire sound after fire plot succeeds', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    const target = firePlotCells(state, unitId)[0];

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <FirePlotProbe unitId={unitId} target={target} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'use fire plot' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/fireEverythings.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the fire sound after the fire strategy succeeds', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    const target = firePlotCells(state, unitId)[0];

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <FireStrategyProbe unitId={unitId} target={target} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'use fire strategy' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/fireEverythings.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the start-project sound after facility construction succeeds', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    const target = neighborsOf(state.units[unitId].q, state.units[unitId].r)[0];

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <FacilityProbe unitId={unitId} target={target} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'build arrow tower' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/startProject.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the start-project sound after facility repair succeeds', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    const target = neighborsOf(state.units[unitId].q, state.units[unitId].r)[0];
    state.facilities = {
      building: { id: 'building', type: 'arrowTower', forceId: 'liu', q: target.q, r: target.r, durability: 150, completed: false },
    };

    render(
      <GameProvider initialState={state} storage={new MemoryStorage()}>
        <RepairFacilityProbe unitId={unitId} facilityId="building" />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'repair facility' }));

    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/startProject.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays only the kill sound after an online move-and-attack is accepted', async () => {
    const user = userEvent.setup();
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);

    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'sword',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attackerId = Object.keys(state.units)[0];
    const { targetId, destination } = addEnemyAfterMove(state, attackerId);
    socket.startGameState = state;

    render(
      <GameProvider storage={new MemoryStorage()}>
        <OnlineProbe />
        <AttackUnitProbe attackerId={attackerId} targetId={targetId} destination={destination} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'create room' }));
    await user.click(screen.getByRole('button', { name: 'start online' }));
    await user.click(screen.getByRole('button', { name: 'attack unit' }));

    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'game:intent',
      payload: { intent: { type: 'attackUnit', attackerId, targetId, destination } },
    });
    expect(AudioMock).toHaveBeenCalledTimes(1);
    expect(AudioMock).toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/kill.mp3'));
    expect(AudioMock).not.toHaveBeenCalledWith(expect.stringContaining('/assets/sound/troops/followme.mp3'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('sends online arrow tower build intents without throwing', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    const target = neighborsOf(state.units[unitId].q, state.units[unitId].r)[0];
    socket.startGameState = state;

    render(
      <GameProvider storage={new MemoryStorage()}>
        <OnlineProbe />
        <FacilityProbe unitId={unitId} target={target} />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'create room' }));
    await user.click(screen.getByRole('button', { name: 'start online' }));
    await user.click(screen.getByRole('button', { name: 'build arrow tower' }));

    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'game:intent',
      payload: { intent: { type: 'buildFacility', unitId, facilityType: 'arrowTower', target } },
    });
  });

  it('renders online arrow tower snapshots after a build intent update', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    const target = neighborsOf(state.units[unitId].q, state.units[unitId].r)[0];
    socket.startGameState = state;

    render(
      <GameProvider storage={new MemoryStorage()}>
        <OnlineProbe />
        <FacilityProbe unitId={unitId} target={target} />
        <GameShell />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'create room' }));
    await user.click(screen.getByRole('button', { name: 'start online' }));
    await user.click(screen.getByRole('button', { name: 'build arrow tower' }));

    const nextState = buildFacility(state, 'liu', unitId, 'arrowTower', target);
    act(() => {
      socket.emitServer('room:update', {
        playerId: 'host',
        room: {
          id: 'ABCD',
          revision: 4,
          hostPlayerId: 'host',
          phase: 'playing',
          players: [
            { id: 'host', name: 'Host', forceId: 'liu', connected: true },
            { id: 'guest', name: 'Guest', forceId: 'cao', connected: true },
          ],
          turnPlayerIds: ['host', 'guest'],
          activePlayerId: 'host',
          completedTurnPlayerIds: [],
          tenDayReadyForceIds: [],
        },
        state: nextState,
      });
    });

    expect(screen.getByLabelText('facilities')).toHaveTextContent('1');
    expect(screen.getByTestId('battle-facility-marker')).toHaveAttribute('data-facility-type', 'arrowTower');
  });

  it('applies a successful online arrow tower snapshot returned by the intent ack', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    const target = neighborsOf(state.units[unitId].q, state.units[unitId].r)[0];
    const nextState = buildFacility(state, 'liu', unitId, 'arrowTower', target);
    socket.startGameState = state;
    socket.intentAckSnapshot = {
      playerId: 'host',
      room: {
        id: 'ABCD',
        revision: 4,
        hostPlayerId: 'host',
        phase: 'playing',
        players: [
          { id: 'host', name: 'Host', forceId: 'liu', connected: true },
          { id: 'guest', name: 'Guest', forceId: 'cao', connected: true },
        ],
        turnPlayerIds: ['host', 'guest'],
        activePlayerId: 'host',
        completedTurnPlayerIds: [],
        tenDayReadyForceIds: [],
      },
      state: nextState,
    };

    render(
      <GameProvider storage={new MemoryStorage()}>
        <OnlineProbe />
        <FacilityProbe unitId={unitId} target={target} />
        <GameShell />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'create room' }));
    await user.click(screen.getByRole('button', { name: 'start online' }));
    await user.click(screen.getByRole('button', { name: 'build arrow tower' }));

    expect(screen.getByLabelText('facilities')).toHaveTextContent('1');
    expect(screen.getByTestId('battle-facility-marker')).toHaveAttribute('data-facility-type', 'arrowTower');
  });

  it('sends an online arrow tower build intent from the unit setting menu after choosing a move destination', { timeout: 30000 }, async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      troops: 4000,
      gold: 1000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const unitId = Object.keys(state.units)[0];
    socket.startGameState = state;

    render(
      <GameProvider storage={new MemoryStorage()}>
        <OnlineProbe />
        <GameShell />
      </GameProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'create room' }));
    await user.click(screen.getByRole('button', { name: 'start online' }));

    // 在线模式下地图在 state 就绪前挂载，scale 停留在默认 2.33（视野约 88 列 × 57 行），
    // 只有落在视口裁剪带内的格子才会渲染，移动目标格因此可能缺失。
    // 这里按当前 view 精确平移到部队格，把它放到视口中心，不依赖初始视野落在哪。
    const unit = state.units[unitId];
    const cellPx = (1280 * 2.33) / 200;
    const viewportEl = screen.getByTestId('map-viewport');
    const mapContent = screen.getByTestId('map-content');
    const cssWidth = 1280 * 2.33;
    const cssHeight = cssWidth * (200 / 200);
    const left = (1280 - cssWidth) / 2 + Number(mapContent.getAttribute('data-view-x'));
    const top = (720 - cssHeight) / 2 + Number(mapContent.getAttribute('data-view-y'));
    const dragX = (1280 / 2 - (unit.q + 0.5) * cellPx) - left;
    const dragY = (720 / 2 - (unit.r + 0.5) * cellPx) - top;
    fireEvent.pointerDown(viewportEl, { pointerId: 1, button: 0, buttons: 1, clientX: 640, clientY: 360 });
    fireEvent.pointerMove(viewportEl, { pointerId: 1, clientX: 640 + dragX, clientY: 360 + dragY });
    fireEvent.pointerUp(viewportEl, { pointerId: 1 });

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const moveTarget = screen.getAllByTestId(/move-target-/)[0];
    const [, q, r] = moveTarget.getAttribute('data-testid')!.match(/move-target-(\d+)-(\d+)/)!;
    fireEvent.pointerDown(moveTarget, { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    const commandButtons = within(screen.getByTestId('unit-command-menu')).getAllByRole('button');
    await user.click(commandButtons[6]);
    const facilityButtons = within(screen.getByTestId('unit-facility-menu')).getAllByRole('button');
    await user.click(facilityButtons[1]);
    const target = screen.getAllByTestId(/strategy-target-/)[0];
    fireEvent.pointerDown(target, { button: 0, buttons: 1 });

    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'game:intent',
      payload: {
        intent: {
          type: 'buildFacility',
          unitId,
          facilityType: 'arrowTower',
          destination: { q: Number(q), r: Number(r) },
        },
      },
    });
  });

  it('keeps online rooms in a lobby until the host starts the game', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'create room' }));
    expect(screen.getByLabelText('phase')).toHaveTextContent('lobby');
    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');
    expect(screen.getByLabelText('state')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'select liu' }));
    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'room:selectForce',
      payload: { roomId: 'ABCD', forceId: 'liu' },
    });

    await user.click(screen.getByRole('button', { name: 'start online' }));
    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'room:startGame',
      payload: { roomId: 'ABCD' },
    });
    expect(screen.getByLabelText('phase')).toHaveTextContent('playing');
    expect(screen.getByLabelText('state')).toHaveTextContent('liu');
  });

  it('leaves the current online room before disconnecting locally', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    const storage = new MemoryStorage();
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={storage}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'create room' }));
    expect(storage.getItem('jingxiang-208-last-online-room-v1')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'leave room' }));

    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'room:leave',
      payload: { token: 'token', roomId: 'ABCD' },
    });
    expect(screen.getByLabelText('room')).toHaveTextContent('none');
    expect(storage.getItem('jingxiang-208-last-online-room-v1')).toBeNull();
  });

  it('disconnects locally even when the leave request is not acknowledged', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socket.skipLeaveAck = true;
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'create room' }));
    await user.click(screen.getByRole('button', { name: 'leave room' }));

    expect(socket.emitted.at(-1)).toMatchObject({ event: 'room:leave' });
    expect(socket.disconnected).toBe(true);
    expect(screen.getByLabelText('room')).toHaveTextContent('none');
  });

  it('creates a fresh room after leaving the previous room', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'create room' }));
    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');

    await user.click(screen.getByRole('button', { name: 'leave room' }));
    expect(screen.getByLabelText('room')).toHaveTextContent('none');
    expect(screen.getByLabelText('resuming')).toHaveTextContent('no');

    await user.click(screen.getByRole('button', { name: 'create room' }));

    expect(socket.emitted.filter((entry) => entry.event === 'room:create')).toHaveLength(2);
    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');
    expect(screen.getByLabelText('resuming')).toHaveTextContent('no');
  });

  it('clears the battle state when leaving a started online room', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'create room' }));
    await user.click(screen.getByRole('button', { name: 'start online' }));
    expect(screen.getByLabelText('state')).toHaveTextContent('liu');

    await user.click(screen.getByRole('button', { name: 'leave room' }));

    expect(screen.getByLabelText('state')).toHaveTextContent('none');
    expect(screen.getByLabelText('room')).toHaveTextContent('none');
    expect(screen.getByLabelText('resuming')).toHaveTextContent('no');
  });

  it('loads lobby rooms from the online server', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'load rooms' }));

    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'room:list',
      payload: { token: 'token' },
    });
    expect(screen.getByLabelText('rooms')).toHaveTextContent('WXYZ');
  });

  it('updates the lobby room list when the server pushes a room list change', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'load rooms' }));
    act(() => {
      socket.emitServer('room:list:update', {
        rooms: [{
          id: 'NEWR',
          hostName: 'New Host',
          playerCount: 1,
          maxPlayers: 4,
          selectedForceIds: [],
        }],
      });
    });

    expect(screen.getByLabelText('rooms')).toHaveTextContent('NEWR');
    expect(screen.getByLabelText('rooms')).not.toHaveTextContent('WXYZ');
  });

  it('clears a stale stored account when the server rejects the token', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socket.rejectCreateWithAuthError = true;
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'stale-token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'create room' }));

    expect(window.localStorage.getItem('jingxiang-208-auth-session-v1')).toBeNull();
    expect(screen.getByLabelText('phase')).toHaveTextContent('');
  });

  it('resumes the last online room after reopening with a stored session', async () => {
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    const storage = new MemoryStorage();
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    storage.setItem('jingxiang-208-last-online-room-v1', JSON.stringify({
      serverUrl: 'http://server.test',
      roomId: 'ABCD',
    }));

    render(<GameProvider storage={storage}><OnlineProbe /></GameProvider>);
    await screen.findByText('liu');

    expect(socket.emitted.map((entry) => entry.event)).toContain('auth:session');
    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'room:resume',
      payload: { token: 'token', roomId: 'ABCD' },
    });
    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');
    expect(screen.getByLabelText('phase')).toHaveTextContent('playing');
    expect(screen.getByLabelText('state')).toHaveTextContent('liu');
  });

  it('keeps the reopened page in resuming state until the stored room snapshot arrives', async () => {
    const socket = new FakeOnlineSocket();
    socket.delayRoomResume = true;
    socketHolder.socket = socket;
    const storage = new MemoryStorage();
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    storage.setItem('jingxiang-208-last-online-room-v1', JSON.stringify({
      serverUrl: 'http://server.test',
      roomId: 'ABCD',
    }));

    render(<GameProvider storage={storage}><OnlineProbe /></GameProvider>);

    await screen.findByText('yes');
    expect(socket.emitted.map((entry) => entry.event)).toEqual(['auth:session', 'room:resume']);
    expect(screen.getByLabelText('room')).toHaveTextContent('none');

    act(() => {
      socket.flushRoomResume();
    });

    await screen.findByText('liu');
    expect(screen.getByLabelText('resuming')).toHaveTextContent('no');
    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');
  });

  it('manually resumes the current account room without a stored room id', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));

    render(<GameProvider storage={new MemoryStorage()}><OnlineProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'resume room' }));

    expect(socket.emitted.at(-1)).toMatchObject({
      event: 'room:resume',
      payload: { token: 'token' },
    });
    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');
    expect(screen.getByLabelText('phase')).toHaveTextContent('playing');
    expect(screen.getByLabelText('state')).toHaveTextContent('liu');
  });

  it('resumes the stored room after logging in on a reopened page', async () => {
    const user = userEvent.setup();
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    const storage = new MemoryStorage();
    storage.setItem('jingxiang-208-last-online-room-v1', JSON.stringify({
      serverUrl: 'http://server.test',
      roomId: 'ABCD',
    }));

    render(<GameProvider storage={storage}><LoginProbe /></GameProvider>);

    await user.click(screen.getByRole('button', { name: 'login' }));
    await screen.findByText('liu');

    expect(socket.emitted.map((entry) => entry.event)).toEqual([
      'auth:login',
      'auth:session',
      'room:resume',
    ]);
    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');
    expect(screen.getByLabelText('state')).toHaveTextContent('liu');
  });

  it('resumes the stored room even under StrictMode double mounting', async () => {
    const socket = new FakeOnlineSocket();
    socketHolder.socket = socket;
    const storage = new MemoryStorage();
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'token',
      userId: 'host',
      username: 'Host',
    }));
    storage.setItem('jingxiang-208-last-online-room-v1', JSON.stringify({
      serverUrl: 'http://server.test',
      roomId: 'ABCD',
    }));

    render(
      <StrictMode>
        <GameProvider storage={storage}><OnlineProbe /></GameProvider>
      </StrictMode>,
    );
    await screen.findByText('liu');

    expect(screen.getByLabelText('room')).toHaveTextContent('ABCD');
    expect(screen.getByLabelText('phase')).toHaveTextContent('playing');
    expect(screen.getByLabelText('state')).toHaveTextContent('liu');
    expect(screen.getByLabelText('resuming')).toHaveTextContent('no');
  });
});
