# 首页重构 + 独立地图编辑 + 自定义地图开启对局

## Context（为什么做）

当前「地图编辑」必须从一局**正在运行**的游戏中进入（`GameShell.openEditor` 依赖 `state`），地图 JSON 只含 `grid + cities`（无势力归属 / 无关隘 / 无名字），首页 `StartScreen` 同时承载势力选择 + 联机 + 载入，且联机地图被 `RoomMap='small'|'homeland'` 枚举写死。

本轮目标：把入口改为「首页四选项」；地图编辑独立成一个入口（无 AI 底图，纯地形图）；可新建/编辑/保存多张自定义地图；单机与联机都能从「所有可用地图」里选图开局。

**已确认决策**：
- 地图存储沿用 **JSON 文件导出/导入**，不用 localStorage；地图列表 = 内置荆襄图(china42x) + 本会话导入的 JSON。**跨会话局限需在 UI/计划里明确**（刷新即逝，需重新导入）。
- 地图列表初始含内置 china42x。
- 自定义图开局：按「有主城池」分配势力（用现有内置势力池），**武将自动补足**。仅做能跑通单机的简化版，避免过度设计。
- 「擦除」= 地形擦回平地 + 移除该格城池/关隘。

## 关键架构决策

- **独立 EditorScreen**（不复用 GameShell 壳），以 `MapEditorState` 为唯一状态，保存直接写注册表，不经过 `applyMapEditorMap`。渲染复用 `StrategicMap` 的 `editorMode` 通道（`editorGrid/editorCities/onEditorCellPaint`），喂一个最小合成 `GameState` stub。
- **`createGame` 保持不变**（避免回归 mobileDuel/存档）；新增 `createGameFromMap` 作自定义图场景生成器。
- 界面切换用轻量状态机（无路由库），放在 AppContent。

---

## T0 数据模型先行

**`src/game/map-editor/editor.ts`**（改）
- 新类型，向后兼容 schemaVersion 1：
  ```ts
  interface EditorStrongholdMarker extends EditableCityMarker {
    type: 'city' | 'pass';
    forceId?: ForceId | null;   // 缺省/null = 无主（空城/空关隘）
  }
  interface EditorMapPayload {
    schemaVersion: 2;
    width; height; backgroundImage; grid: GridCell[];
    cities: EditorStrongholdMarker[];       // 城池+关隘统一放这，type 区分
    passes?: EditorStrongholdMarker[];      // 兼容 v1（v1 无 type）
    name?: string;
  }
  ```
- `parseEditorJsonPayload` 接受 v1 与 v2：v1 读取后升级为内部 v2（`cities` 补 `type:'city'`、`passes=[]`、补默认 `name`）。
- 新增 `createBlankMap(width=200,height=200)`（全平地，无标记）；`placePass`；`eraseStronghold(state,id)`（移除 marker + 该格及其 footprint 地形重置为 plain）；`MapEditorTool` 增加 `'erase'`。
- **弃用但保留导出**（避免大改 snapshot/undo/redo 与 StrategicMap prop）：`exportTerrainControlSvg / exportTerrainMaskSvgs / setEditorBackgroundImage / exportEditorSvg`。`backgroundImage` 字段保留序列化。

**新增 `src/game/mapRegistry.ts`**
```ts
interface SessionMap { id: string; name: string; builtin: boolean; payload: EditorMapPayload }
export const BUILTIN_MAP_CHINA42_ID = 'china42x';
export function registerBuiltinMaps(loadOnce?): void; // 内置 china42 载入（名称「荆襄地图」）
export function listMaps(): SessionMap[];
export function getMap(id): SessionMap | undefined;
export function addSessionMap(payload, name): string;
export function updateSessionMap(id, payload): void;
```
内置 payload 复用 `jingxiang208.ts` 的 `getChina42Grid / china42CityEntry / china42Passes`。跨会话仅内置图存活。

验证：`editor.test.ts` 追加（placePass/eraseStronghold/v1→v2 升级/createBlankMap 40000 格）；新增 `mapRegistry.test.ts`。

## T1 编辑器 UI 独立化

- 抽 `downloadTextFile` 到 `src/utils/download.ts`（GameShell 现 L92 复用）。
- **`MapEditorPanel.tsx` 简化**：删除 AI 底图/校准/控制图/遮罩三段；props 收敛为 `{ activeTool, canUndo, canRedo, onUndo, onRedo, onClear, onErase, onSelectTool, onPlaceWithForce(tool, forceId|null), onSave(name), onBack }`。保留地形刷子 + 城/关刷子（内置势力 + 「无主」按钮）+ 撤销/重做/擦除/保存。
- **新增 `src/components/MapEditorScreen.tsx`**：`{ mapId:'new'|string, onSave(payload,name), onBack }`。内部持 `MapEditorState` + 工具状态；新建 `createBlankMap(200,200)`，重进 `getMap(mapId)` → `createEditorState`。渲染 `StrategicMap` editorMode。放置城/关时若无标记弹势力/无主选择，已占则弹归属/删除菜单。保存弹输入框改名 → 写注册表 + 下载 JSON。
- 需要合成一个非空 `GameState` stub 喂给 StrategicMap（`grid/gridWidth/gridHeight/cities:{}/passes:{}/units:{}/forces:{}/officers:{}/logs:[]` 等最小字段）。**先做最小可渲染验证**，重点查 `initialFocusCity`(L483)、zoom 对 gridWidth/Height 的依赖，以及是否有其它裸 `state.x` 读取（editorMode 分支已守卫 plots/passes）。

验证：组件测试 `MapEditorScreen`（「+」得 200×200、保存带 name）。

## T2 自定义场景生成器

**新增 `src/game/scenario/customMap.ts`**
```ts
export function createGameFromMap(map: EditorMapPayload, playerForceId: ForceId, seed=Date.now(),
  opts?: { interiorByCityId?: ReadonlyMap<string, GridCoord[]> }): GameState
```
1. forces 筛选：收集 `type==='city' && forceId!=null` 的去重集；`playerForceId` 不在或空图 → throw。`state.forces`、`actionPoints` 仅含在用势力。
2. cities：由 marker 生成（ownerId=forceId 或 null；资源沿用新建城默认；`mapX/mapY` 由 q/r 推导；`armaments: initialArmaments()`）。
3. 武将补足：`officerSeeds` 按 `forceId` 过滤，round-robin 分配到该势力城池（每城≥1），无主在野将保留 unaffiliated；沿用 createGame 的出生年/忠诚/性格/特技逻辑。
4. passes：新增 `createScenarioPassesFromMarkers(state, passMarkers)`（放 passes.ts 或 customMap），`homeCityId` 取最近城，有主关隘用 `passes.ts` 常量初始化兵力/资源、无主给 0；`flankKeys` 由 `neighborsOf`+地形推导。
5. construction/pop：`initConstructionPlots`（自定义不传 interior → 走现成 fallback 自动搜空地，`innerAffairs.ts` 已有该分支）+ `initCityPopulation`（现成）。
6. rank：抽 `assignInitialRanks(state)` 复用 `rankForCityCount`（现 createGame 内联了该逻辑）。
7. 返回整体对标 `createGame`：`schemaVersion:2, scenarioId:'custom-map'` 等。

**`src/game/scenario/jingxiang208.ts`**（最小改）：导出 `DEFAULT_CITY_ECONOMY`（citySeeds 默认资源）供 customMap 复用；`createGame` 不改。

**`src/game/store/GameProvider.tsx`**：`startGame(forceId, seed, mapId?)` —— `mapId==='china42x'` 或省略 → `createGame`，否则 `getMap(mapId)` → `createGameFromMap`。`runOpponentTurns` 由遍历 `FORCE_IDS` 改为遍历 `Object.keys(state.forces)`（避免对不存在的势力报错；确认 `runAiTurn` 对零城势力无损）。

验证：新增 `customMap.test.ts`（双势力 forces/ownerId/每城武将/actionPoints；空图 throw；有主/无主关隘兵力；construction/pop 落地；rank）。

## T3 导航与多屏

**`src/app/App.tsx`** 状态机：
```ts
type AppScreen = {name:'home'} | {name:'mapList';mode:'edit'|'start'} | {name:'mapEditor';mapId:string}
              | {name:'forceSelect';mapId:string} | {name:'online'};
```
优先级：`state → GameShell`；`!auth.username → AuthScreen`；`online.roomId && lobby → RoomLobbyScreen`；否则 `HomeScreen`。

- **`src/components/HomeScreen.tsx`**：四选项（载入进度灰显占位「暂不做」/ 重新开始新游戏 / 联网对战 / 编辑地图）+ 退出登录。
- **`src/components/MapListScreen.tsx`**：`{ mode, onSelect, onCreateNew, onBack }`。平铺 `listMaps()` 卡片；`edit` 模式末尾「+」（新建）；`start` 模式过滤空图并标势力色。
- **`src/components/ForceSelectScreen.tsx`**：`{ mapId, onPick, onBack }`，列该图有主城势力。
- **`src/components/OnlineScreen.tsx`**：从 StartScreen 抽出联机模块，地图选择改从可用地图选。
- **`StartScreen.tsx`** 收缩/转化为 HomeScreen（载入段保留在 HomeScreen）。

单机新流程：Home → mapList(start) → forceSelect(mapId) → `startGame(forceId, seed, mapId)`。
联机新流程：Home → online（复用现有联机模块，地图从可用地图选）。

验证：更新 `App.test.tsx`（原断言标题与创建/加入房间）与 `StartScreen.test.tsx`（迁移到 HomeScreen）。

## T4 联机多地图

**`src/game/network/session.ts`**：`RoomMap` 泛化为 `'small' | 'homeland' | string`（注册表 mapId）。`roomMaxPlayers`/`createOnlineRoom` 分支：homeland→4、small→2、自定义 → 有主城数。`startOnlineRoom`：`small → createMobileDuelGame`（保留）；否则 `getMap(mapId)` → `createGameFromMap`（`'homeland'` 视为 china42x 别名）。`room:create` 已带 `map`，仅类型扩展，无需改协议。

验证：`session.test.ts` 补自定义 mapId 分支。

## T5 收尾

`npm run build`（含 `tsc --noEmit`）+ `npm test`（vitest）全绿；回归 `mobileDuel.test.ts / jingxiang208.test.ts / GameProvider.test.tsx / RoomLobbyScreen.test.tsx`。

---

## 风险与依赖

- **StrategicMap 合成 stub 兼容性**：T1 先做最小可渲染验证，失败则回退为保留 in-game 编辑壳。
- **`runAiTurn` 对缺失/零城势力稳健性**：T2 验证；必要时保留全 4 势力但 cities 为空。
- **自定义势力若 0 武将**：forceSelect 显示警示或禁止。
- **跨会话地图不持久**：按用户决策明确为「导出/导入 JSON」。

依赖顺序：T0 → T1 / T2（可并行）→ T3 → T4 → T5。

## 关键文件

- 改：`src/game/map-editor/editor.ts`、`src/game/scenario/jingxiang208.ts`、`src/game/store/GameProvider.tsx`、`src/app/App.tsx`、`src/game/network/session.ts`、`src/components/MapEditorPanel.tsx`
- 增：`src/game/mapRegistry.ts`、`src/game/scenario/customMap.ts`、`src/utils/download.ts`、`src/components/HomeScreen.tsx`、`src/components/MapListScreen.tsx`、`src/components/MapEditorScreen.tsx`、`src/components/ForceSelectScreen.tsx`、`src/components/OnlineScreen.tsx`
- 复用：`StrategicMap` editorMode、`passes.ts`、`innerAffairs.ts` 的 `initConstructionPlots/initCityPopulation`、`jingxiang208.ts` 的 `SCENARIO_FORCES/officerSeeds/rankForCityCount`