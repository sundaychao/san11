# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

三国志 11 风格的单机 / 联网回合制策略游戏「建安十三年：荆襄争夺」。前端 React 19 + Vite + TypeScript（strict），后端 Socket.IO + `node:sqlite`，测试为 Vitest（单测）+ Playwright（e2e）。

规则数值、玩家可见文案、代码注释全部使用中文，新增代码保持同一语言风格。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 前端开发服务器 | `npm run dev`（默认 5173） |
| 联网后端 | `npm run server`（默认 8787，可用 `PORT` / `CORS_ORIGIN` 覆盖） |
| 一键起前后端 | `start-dev.bat`（前端 5174，启动前先杀 8787/5174 旧进程） |
| 类型检查 + 构建 | `npm run build`（= `tsc --noEmit && vite build`） |
| 全部单测 | `npm test`（= `vitest run`） |
| 单个测试文件 | `npm test -- src/game/random.test.ts` |
| 只跑客户端或服务端 | `npx vitest run --project client` / `--project server` |
| e2e | `npm run test:e2e`（Playwright 自动起 4173 开发服务器） |
| 单个 e2e | `npx playwright test e2e/game.spec.ts --project=desktop-1440` |
| 重新生成华夏地图数据 | `npm run map:china` |

若 `npx` / `npm test` 在当前环境被沙箱拦截，可直接调用：`node node_modules/vitest/vitest.mjs run <文件>`、`node node_modules/@playwright/test/cli.js`。

## 架构

### 唯一的规则入口：游戏 intent 归约

玩家点击、AI、联网对手三条路径都必须收敛到同一条链路，规则只在这里实现一次：

```
UI(GameShell) / AI(ai.ts) / 服务端(RoomManager)
  → GameIntent            src/game/network/intents.ts
  → reduceGameIntent      src/game/network/intentReducer.ts
  → battle/* 与 commands.ts / turn.ts
  → 新的 GameState
```

- `GameState`（`src/game/types.ts`）按不可变数据处理：手动 `structuredClone` 后改再返回，不要就地修改传入的 state。
- `createGameEngine`（`src/game/engine/`）是客户端薄封装：clone + 订阅 + 由前后 state 差分产出 `GameEvent`（音效/动画消费，`engine/events.ts`）。新增表现事件要改 `events.ts`。
- 加玩法要同时接三处：`intents.ts` 的 intent 类型、`intentReducer.ts` 的分支、`events.ts`（若需要表现事件）。
- `reduceGameIntent` 在出口统一 `clampStrongholdResources`：据点资源上限不要在每条指令里各写一遍。

### 规则模块地图（src/game/）

| 模块 | 职责 |
| --- | --- |
| `battle/movementRules` + `grid` | 移动力、ZOC、可达/部署格；`unitCanStepThisTenDay` 等口径函数 |
| `battle/targetRules` | 攻击目标合法性与范围判定 |
| `battle/combat` `tactics` `strategies` `deployment` | 普攻伤害、战法、计略、出征 |
| `battle/delegate.ts` | 委任（部队自动执行：移动/建设/修补/伪报撤退） |
| `battle/legacyCore.ts` | 尚未拆分的战斗公共实现（单位生命周期、战法目标选择、设施、策略消耗…），上面多数模块是对它的再导出 |
| `battle/actions.ts` | 兼容导出面，只准 `export *`，实现不要写在这里 |
| `commands.ts` | 城市指令（`GameCommand`）与 `COMMAND_AP` 行动力表 |
| `turn.ts` | 时间推进：`advanceTenDay`（委任执行 → 对手 AI → 旬末结算）、`settleTenDay`、`settleMonth` |
| `ai.ts` | AI 势力回合 `runAiTurn`：按优先级挑选合法 `GameCommand` |
| `skills/` | 武将特技系统：`registry` 定义、`sources` 谁持有、`rules/*` 按域应用、`handlers` 复杂连锁特技 |
| `persistence.ts` / `saveSlots.ts` | 存档校验与迁移 / 32 个单机槽位摘要 |
| `map-editor/` + `mapRegistry.ts` | 地图编辑与地图注册表（内置图 + localStorage 自定义图） |
| `scenario/` | 剧本数据：`jingxiang208.ts`（8 城经典剧本）、`maps/china42x.json`（默认华夏全图 42 城）、`customMap.ts`（从编辑器地图建局） |

### 界面层（src/components/）

- `GameShell.tsx` 是主壳（仓库中体量最大的文件），承载顶栏、地图、各面板与全部弹窗编排；`StrategicMap.tsx` 负责地图渲染与指针交互。
- 地图上的菜单 / 子菜单 / 瞄准被建模成显式状态机 `MapInteraction`（`gameInteraction.ts` 的 reducer）。新增交互扩展这个联合类型，不要再加一组互斥 `useState`。
- `CommandDialog.tsx` 是城市指令表单，`useUnitMenuInteraction.ts` 是部队菜单交互的抽取。
- 新增可交互元素请带上 `data-testid`：RTL 用例与 e2e 都依赖它。

### 联网（server/ + src/game/network/）

- 客户端只发 `GameIntent` 与房间操作；服务端 `RoomManager` 持有权威 `GameState` 并落 SQLite（`server/data/game.db`）。`network/session.ts` 是纯函数版房间状态机（单机 / 测试可直接用它）。
- 客户端 `store/onlineSession.ts` 负责连接、重连与快照应用。
- 协议事件与 payload 类型集中在 `network/protocol.ts`，改字段前后端要同时改。

## 跨文件不变量（改一处必须同步另一处）

1. **规则文档成对**：`docs/GAME_RULES.md`（规则全文）与 `src/components/gameRulesContent.ts`（游戏内规则弹窗）是同一份规则的两个载体，改规则数值或玩家可见文案时两处一起改。
2. **存档结构**：改动 `GameState` 字段的**语义**（而非新增可选字段）必须递增 `persistence.SCHEMA_VERSION` 并补 `migrateSaveToCurrent`。校验白名单（`CITY_IDS` / `PASS_IDS` / `OFFICER_IDS`）必须带 `custom ||` 放行自定义地图 id（形如 `city-10-10`），否则整局存档被判无效；同时保留「内置剧本仍拒绝未知 id」的反向用例。
3. **瞬态展示数据**：`battleDamageReports` / `cityEffectReports` / `strategyResultReports` / `facilityRepairReports` 只服务飘字与战报。新增同类字段先问「读档会不会重放」，会重放就加进 `GameProvider.tsx` 的 `withoutTransientReports()`（挂在该文件的各条读档路径上）。同一文件里的 `applyOnlineSnapshotState` 故意不清 —— 那是客户端之间传飘字的唯一通道。
4. **「本旬能不能动」只有一个判据**：`movementRules.unitCanStepThisTenDay`（委任 / 行军）与 `unitUntouchedThisTenDay`（命令菜单 / 可操作徽章）。不要手写 `movementRemaining > 0` 之类的魔法布尔；`unit.moved` 只表示「本旬动过」，不代表移动力耗尽。
5. **异常状态**：混乱 / 伪报统一走 `unitIsIncapacitated`；只有系统强制移动（如伪报撤退）才透传 `allowIncapacitated`。
6. **委任失效要主动收口**：持续型任务（修补 / 建设 / 移动）的失效判定挂在「目标状态变更点」（如 `clearSatisfiedRepairDelegations`），不能等任务下次轮到执行时自清。
7. **模块边界由测试强制**（`battle/module-boundaries.test.ts`）：`battle/` 下 catalog、definitions、shared、movement、movementRules、targetRules、facilities、combat、tactics、strategies、deployment、queries 与 `skills/**` 一律不得引入 react / react-dom / lucide-react / socket.io，也不得引用路径中含 `components` / `network` / `audio` 的模块；`skills/**` 另禁 `window` / `document` 与运行时循环依赖。依赖方向是网络层 → 规则层，反向不行。
8. **数值单一出处**：同一数值或公式只允许一个导出（`COMMAND_AP`、`UNIT_TROOPS_FOOD_PER_TEN_THOUSAND_PER_TEN_DAYS`、`unitStrategySuccessChance`…），UI 悬浮提示与引擎结算共用同一函数。

## 测试与环境须知

- `vite.config.ts` 定义两个 vitest project：`client`（`src/**`，jsdom + `src/test/setup.ts`）与 `server`（`server/**`，node，因依赖 `node:sqlite`）。**projects 不继承顶层的 `test.pool` / `testTimeout`**，改配置时要在每个 project 内同步，漏配会让重 UI 用例在满载并发下随机超时。
- `pool: 'vmThreads'` 是刻意选择（Node 24 + Vitest 4 下 threads/forks 池的 worker 全局注入失败）；`src/test/setup.ts` 补 Web Streams 全局量同理。两者都不要当冗余删除。
- RTL cleanup 由 `rtlCleanupInjector` 注入到每个 `.test.tsx`，与 `setup.ts` 的 `afterEach` 是双保险：同一文件内多个弹窗用例依赖它避免 DOM 泄漏。
- 夹具 / 生成器类 `*.test.ts` 也必须至少写一个 `it()`，否则 vitest 报 `No test suite found` 拖红全量。
- 全量跑时若只有 `StrategicMap.test.tsx > 鼠标移出地图区域后…改变滚动方向` 30s 超时，属并行抖动，单跑该文件必过。
- e2e 注意：断言「元素不存在」用 `toHaveCount(0)`（`toBeNull()` 对 locator 无效）；设施 DOM 有主地图 + 小地图两份，locator 先用 `getByTestId('map-viewport')` 收窄；进游戏需先 `addInitScript` 写 `jingxiang-208-auth-session-v1` 绕过登录，再走主菜单 → 选图 → 选势力。
- Playwright 对 1440 / 1920 / 390 三档视口各跑一遍，改布局要三档都验证。
- 本仓库 `core.autocrlf=true`：Edit 匹配的是工作区 CRLF 内容，纯 LF 文件可能报 "String not found"，必要时先整文件转 CRLF。

## 其他

- `.workbuddy/memory/MEMORY.md`（已 gitignore，仅本机存在）沉淀了历次踩坑的领域约定（委任时序、自定义地图存档、飘字重放等）。改动委任、存档、战斗结算前值得先读对应小节。
- 运行数据（`server/data/*.db`、`users.json`、`rooms/*.json`）不进版本库。
- `scripts/` 下大量 `.cjs` 是一次性逆向 / 校验脚本（原版存档格式分析、地图渲染验证），不参与构建与测试，不要顺手重构。
- `docs/damage-formula.html` 与 `docs/damage-simulator.html` 是伤害公式的离线演算页。
