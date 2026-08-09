import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployUnit, deploymentCells, movementCells, type TacticId } from '../battle/actions';
import { gridKey, neighborsOf, sevenCellCityFootprint } from '../battle/grid';
import { AUTO_SAVE_KEY, MANUAL_SAVE_KEY, type SaveAdapter } from '../persistence';
import { createGame } from '../scenario/jingxiang208';
import { settleTenDay } from '../turn';
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
      <button onClick={() => game.issueCommand({ type: 'patrol', cityId: 'jiangling', officerId: 'liu-bei' })}>patrol</button>
      <button onClick={() => game.endMonth()}>end</button>
      <button onClick={() => game.manualSave()}>save</button>
      <button onClick={() => game.resetGame()}>reset</button>
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

function OnlineProbe() {
  const game = useGame();
  return (
    <div>
      <output aria-label="phase">{game.online.phase}</output>
      <output aria-label="room">{game.online.roomId ?? 'none'}</output>
      <output aria-label="rooms">{game.online.rooms.map((room) => room.id).join(',') || 'none'}</output>
      <output aria-label="state">{game.state ? game.state.playerForceId : 'none'}</output>
      <button onClick={() => void game.loadOnlineRooms({ serverUrl: 'http://server.test' })}>load rooms</button>
      <button onClick={() => void game.createOnlineRoom({ serverUrl: 'http://server.test', seed: 1 }).catch(() => undefined)}>create room</button>
      <button onClick={() => void game.selectOnlineForce('liu')}>select liu</button>
      <button onClick={() => void game.startOnlineGame()}>start online</button>
    </div>
  );
}

class FakeOnlineSocket {
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  rejectCreateWithAuthError = false;
  startGameState = createGame('liu', 1);

  private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();

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
    // no-op for tests
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

    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'siege',
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
});
