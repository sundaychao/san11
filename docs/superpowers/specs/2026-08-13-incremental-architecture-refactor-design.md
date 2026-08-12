# 项目增量架构重构设计

状态：已通过对话确认，等待书面复核  
日期：2026-08-13

## 1. 目标

在不改变现有玩法、数值、存档格式和联网协议的前提下，降低继续增加战法、计略、设施和联网功能时的修改风险。重构只处理已经出现职责过载的边界，不替换 React、Socket.IO 或 SQLite，也不引入多包仓库和新的状态管理框架。

完成后应达到以下结果：

- 单机与联网通过同一个游戏 intent 归约入口执行规则。
- 战斗规则按移动、战斗、战法、计略、设施和出征分模块维护。
- `GameShell` 使用一个判别联合描述当前交互模式，关闭菜单和取消目标不再依赖几十组手动清空调用。
- 登录、房间连接和游戏操作从 `GameProvider` 的具体实现中分离，但现有 `useGame()` 对组件暴露的接口保持兼容。
- 运行数据库和旧迁移数据不再污染 Git 工作区；废弃房间有明确的保留和清理规则。
- 每个阶段均由现有测试和新增的边界测试证明行为没有变化。

## 2. 方案选择

### 2.1 采用：边界式增量重构

保留当前目录和技术栈，通过兼容导出逐步移动实现。每完成一个领域拆分就运行对应测试，全部阶段完成后运行完整单元测试和构建。

这种方式适合当前存在大量未提交业务改动的工作区：改动可以按文件和接口审查，出现问题时也能定位到单一阶段。

### 2.2 不采用：一次性重写

一次性重写 `GameShell`、规则引擎和联网层会同时改变大量交互和数据流，现有 314 项测试仍难以覆盖所有视觉操作，回归风险过高。

### 2.3 不采用：只做文件切割

仅把大文件按行数拆开不能解决状态互斥、单机与联网双路径，以及运行数据无限增长的问题。模块边界必须围绕稳定接口和单一职责建立。

## 3. 全局约束

- 不修改战法、计略、伤害、移动、建设、设施和回合结算数值。
- 不修改 `GameIntent` 已有字段及 Socket.IO 事件名称。
- 不提升存档 `schemaVersion`，现有本地存档继续直接读取。
- 不删除 `server/data/game.db`，不自动删除仍可恢复的进行中房间。
- 不改变组件当前使用的 `useGame()` 方法名称和参数。
- 新模块不得依赖 React、DOM、音频或 Socket.IO。
- 每个生产代码提取必须先有导入边界或行为测试失败，再进行最小实现。

## 4. 阶段一：运行数据边界

### 4.1 Git 边界

`.gitignore` 增加以下运行时数据：

```text
server/data/*.db
server/data/*.db-*
server/data/users.json
server/data/rooms/*.json
```

这些规则只阻止新增运行数据进入版本控制，不删除本地数据库或旧 JSON。已经跟踪的数据是否移除必须单独确认。

### 4.2 旧 JSON 迁移

SQLite 继续作为唯一写入目标。旧 `server/data/rooms/*.json` 只作为兼容迁移来源；导入成功后数据库中的相同房间优先。迁移代码保留到明确完成一次数据清理为止，不在本次重构中删除用户文件。

### 4.3 房间保留

房间数据增加可查询的最后更新时间，由数据库 `updated_at` 维护。启动时：

- 大厅房间继续立即清理。
- 进行中的房间继续保留并允许玩家恢复。
- 本次只提供显式的过期房间清理函数和测试，不在没有产品确认的情况下启用自动过期删除。

这样先建立安全的生命周期接口，避免错误删除玩家仍需恢复的对局。

## 5. 阶段二：统一游戏 Intent

新增纯规则入口：

```ts
reduceGameIntent(
  state: GameState,
  forceId: ForceId,
  intent: Exclude<GameIntent, { type: 'endTenDay' }>,
): GameState
```

该函数从 `network/session.ts` 中提取现有 `applyGameIntent` 分派逻辑，放入不依赖网络的游戏模块。服务端联网房间和本地 `GameProvider` 都调用它。

`GameProvider` 仍负责：

- 将用户操作转换为 `GameIntent`。
- 在线时发送 Socket.IO intent。
- 本地时调用 `reduceGameIntent` 并自动存档。
- 操作成功后播放对应音效。

移动后攻击、移动后战法、首次出征后操作等复合动作继续作为一个 intent 原子提交，避免本地与联网在中间状态上出现差异。

## 6. 阶段三：拆分战斗规则

保留 `src/game/battle/actions.ts` 作为兼容导出入口，内部实现迁移至以下模块：

```text
src/game/battle/movement.ts    地形消耗、ZOC、可达范围、移动
src/game/battle/combat.ts      普通攻击、攻城、设施攻击、伤害报告
src/game/battle/tactics.ts     兵种战法、目标与位移效果
src/game/battle/strategies.ts  计略、火焰和状态效果
src/game/battle/facilities.ts  建设、修补、撤销、范围效果与旬结算
src/game/battle/deployment.ts  部队与运输队出征
src/game/battle/shared.ts      无业务归属的格子占用和断言辅助函数
```

拆分顺序按依赖从低到高进行。跨模块共享只允许通过导出函数和类型，不允许形成循环导入。现有测试文件先保持不动，待实现稳定后再按同样领域拆分，避免同时移动测试与生产代码导致覆盖丢失。

`actions.ts` 最终只保留 re-export，使现有组件和测试无需一次性修改所有导入路径。

## 7. 阶段四：GameShell 交互状态机

把菜单、目标选择和详情窗口分为两类状态。

互斥的主要交互使用判别联合：

```ts
type MapInteraction =
  | { type: 'idle' }
  | { type: 'city-menu'; cityId: CityId; position: ScreenPoint }
  | { type: 'unit-menu'; unitId: string; position: ScreenPoint; destination?: GridCoord }
  | { type: 'unit-submenu'; kind: 'tactic' | 'strategy' | 'facility' | 'intel'; unitId: string; position: ScreenPoint; destination?: GridCoord }
  | { type: 'targeting'; kind: 'attack' | 'tactic' | 'strategy' | 'facility' | 'repair'; unitId: string; origin?: GridCoord; payload?: TargetPayload }
  | { type: 'map-menu'; position: ScreenPoint }
  | { type: 'facility-menu'; facilityId: string; position: ScreenPoint };
```

对话框、悬停信息、伤害报告和地图编辑器等可以同时存在的状态继续独立维护。右键取消只根据当前 `MapInteraction` 退回一层：目标选择退回对应菜单，二级菜单退回一级菜单，一级菜单退回 `idle`。

新增 `useGameInteraction` reducer hook，集中处理 `open`、`back`、`close` 和 `startTargeting`。`GameShell` 负责组合业务数据和渲染，具体菜单 JSX 可逐步提取，但不改变 DOM 文案和测试定位属性。

## 8. 阶段五：GameProvider 职责整理

在保持一个公开 `GameProvider` 的前提下提取内部 hooks：

```text
src/game/store/useAuthClient.ts      登录、注册、会话持久化
src/game/store/useOnlineRoom.ts      Socket、房间列表、恢复和快照
src/game/store/useGameCommands.ts    本地/联网 intent 分发、存档和音效
```

三个 hook 通过显式参数传递依赖，不互相读取模块级可变状态。Socket 仍保持单实例并在卸载时断开。`GameProvider` 最终只负责组合状态、计算存档可用性并提供兼容的 context value。

## 9. 错误处理与兼容

- 纯规则函数继续通过抛出 `Error` 表达非法操作，调用前后的 `GameState` 保持原子性。
- 联网 revision 冲突继续返回服务器快照和可读错误。
- 新 reducer 收到未知 action 时返回原状态，不清空当前游戏。
- 数据迁移读取损坏 JSON 时忽略单个文件，不阻止服务器启动。
- SQLite 清理使用显式事务；任何失败不得删除仍在使用的房间。
- UI 状态重构后，错误消息、按钮禁用条件、鼠标左右键层级和音效触发时机保持现状。

## 10. 测试与验收

每个阶段增加或迁移以下测试：

- `reduceGameIntent` 对每种 intent 与原有直接规则调用结果一致。
- 同一操作在本地和联网状态下产生等价的规范化 `GameState`。
- `useGameInteraction` 覆盖一级菜单、二级菜单、目标模式和连续右键逐层返回。
- 战斗模块拆分后，现有移动、战法、计略、设施、出征和攻击测试全部无需改变断言。
- 数据库清理只删除明确传入且满足条件的房间，不删除活跃或未过期房间。
- `server/data` 运行文件不再出现在新 Git 变更中。

最终验收命令：

```powershell
npm.cmd test
npm.cmd run build
```

还需在桌面和手机视口手动验证：部队右键菜单、二级菜单返回、首次出征移动、设施建设、计略目标、联网房间恢复和双方回合切换。

## 11. 非目标

- 不重新设计游戏界面。
- 不修改地图尺寸或地图素材。
- 不增加新的兵种、战法、计略或设施。
- 不改变房间最大人数和玩家行动顺序。
- 不引入 Redux、Zustand、ORM、迁移框架或微服务。
- 不清理或格式化与本次边界无关的现有代码。
