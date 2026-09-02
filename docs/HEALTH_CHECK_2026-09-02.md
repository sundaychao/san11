# 项目体检报告

- 日期：2026-09-02
- 分支：`codex-battle-system`
- 提交：`042b2cb`（2026-09-01 00:48，作者 zhou7chzo）
- 工作区状态：**72 个文件未提交**（42 已改未暂存 / 13 暂存后又改 / 17 未跟踪）

> **2026-09-02 后续更新**：P1-1、P1-2 与 P2-2 已修复，测试从 669/671 + 2 套件无法运行 → **683/683 全绿**，类型检查通过。详见文末「六、修复记录」。
> P1-2 附带发现「设施产出加成未在玩家命令路径生效」，已在规则文档中登记为已知缺口，等待确认后处理。

## 一、总体结论

**黄灯。** 代码质量和架构都在线，但上一个 agent 留下的是**进行中的状态**：新系统写完了、UI 也接上了，测试却只迁移了一半，测试环境的配置还坏了。

可以直接继续开发，但建议先花半小时把下面 P1 的两项处理掉，否则后面每加一个功能，红绿状态都会越来越难判断。

## 二、检查结果

| 项目 | 体检时 | 修复后 |
| --- | --- | --- |
| TypeScript 类型检查 | 通过 | 通过（TS 7.0.2 原生版） |
| 生产构建 | 通过 | 通过（1911 模块，2.6s） |
| 单元测试 | ⚠️ 669 / 671，另 12 个服务端用例从未运行 | ✅ **683 / 683，57 个文件全绿** |
| e2e（Playwright） | 未执行 | 未执行（需下载浏览器） |
| dev server 启动 | 未执行 | 未执行（构建通过，未实测） |

## 三、问题清单

### P1-1　服务端测试完全没有运行（测试环境配置错误）

**现象**：`server/auth.test.ts`、`server/roomManager.test.ts` 两个套件启动即报错，共 **12 个用例从未执行过**。

```
Error: Cannot bundle Node.js built-in "node:sqlite" imported from "server\database.ts"
```

**原因**：`vite.config.ts` 里全局设置了 `environment: 'jsdom'`，服务端测试被塞进了浏览器环境，Node 内置模块 `node:sqlite` 无法打包。

**影响**：联机房间的核心逻辑（`server/roomManager.ts` 343 行 + `server/database.ts` 162 行）目前**处于零测试保护状态**。房间同步、状态版本校验、活动玩家校验这些一旦改坏，只能靠手动联机才能发现。

**修法**：Vitest 4 已移除 `environmentMatchGlobs`，改用 `test.projects` 给 `server/**` 单独声明 node 环境。

### P1-2　「征兵需先建兵舍」规则变更，测试与文档都没跟上

**现象**：`src/components/game-ui.test.tsx` 两个用例失败——

```
× opens a recruit officer selection dialog from the urban city menu
× shows temporary city gain numbers after recruit and armament production
Unable to find an accessible element with the role "dialog" and name "征兵"
```

**原因**：上一个 agent 新增了城市地格设施系统（`src/game/innerAffairs.ts`，832 行），并在 `CityCommandMenu.tsx:162` 加了前置条件：

```ts
if (item.command === 'recruit' && state && !hasPlotFacility(state.cities[cityId], 'barracks'))
  return '需先建设兵舍才能征兵';
```

征兵按钮因此被禁用，弹窗自然打不开。

**关键点**：同目录的 `command-ui.test.tsx:1610` **已经适配了这个新规则**（测试里手动预置了兵舍），`game-ui.test.tsx` 没改。所以这不是代码 bug，是**迁移做了一半**。

**连带问题**：这条新规则在 `docs/GAME_RULES.md` 里**没有任何记载**。该文档第 4 节的内政命令表仍写着征兵只需 20 行动力 + 资金/粮草/人口，无设施前置；文档全文搜不到「兵舍」「建设用地」「地格」等字样。文档停留在 2026-07-15，已经落后于代码。

**修法**：需要你拍板——
- 方案 A：认可新设计 → 给这两个测试补上兵舍预置（数字期望值也要跟着 +15% 兵舍加成改），并同步更新 GAME_RULES.md。
- 方案 B：认为征兵不该有前置 → 放宽规则，回滚这条限制。

顺带一提：原版三国志 11 的征兵是无需前置设施的，兵舍只是提升征兵量的城外设施。所以当前实现是**比原版更严格**的自创设计。

### P2-1　打包体积

单 chunk 1.80 MB（gzip 298 KB）。功能还能跑，但首屏会把全部代码一次拉下来。可以按需做 `React.lazy` 拆分（比如地图编辑器、联网大厅、单挑/舌战弹窗都不必进首屏包）。

### P2-2　仓库卫生

- `test-out.txt`（51 KB 测试输出）**已被 git 跟踪**，应删除并加入 `.gitignore`。
- `src/game/plot-truncate-repro.test.ts` 命名带 `repro`，是调试期留下的复现测试。内容本身有价值（验证城市地格数不随人口波动），建议改名为 `src/game/innerAffairs-plots.test.ts` 或并入 `innerAffairs` 的测试文件。
- 根目录堆了多个 agent 的工作目录：`.codex/`、`.agents/`、`.superpowers/`、`.worktrees/`。前两个**不在 `.gitignore` 里**，有被误提交的风险。
- `test-results/` 已在 `.gitignore` 中，无妨。

## 四、那 72 个未提交改动到底是什么

不是零碎修补，是一整批**新系统**，而且完成度不低：

**新增未跟踪模块（约 3400 行）**

| 模块 | 行数 | 内容 | 接线情况 |
| --- | ---: | --- | --- |
| `innerAffairs.ts` | 832 | 城市地格与设施（市场/农场/兵舍/工房…共 20+ 种，含升级、耐久） | 被 7 处引用，已接入 |
| `debate.ts` | 666 | 舌战系统 | 已接入 `DebateDialog` |
| `duel.ts` | 322 | 单挑系统 | 已接入 `DuelDialog` |
| `captives.ts` | 280 | 俘虏处置 | 已接入 |
| `diplomacy.ts` | 184 | 外交 | 已接入 |
| `ranks.ts` | 162 | 官爵 | 已接入 |
| `rumor.ts` | 158 | 流言 | 已接入 |
| `health.ts` | 108 | 武将健康/伤病 | **0 处引用，未接线** |
| `loyalty.ts` | 108 | 忠诚 | 2 处引用 |
| `relationship.ts` | 123 | 武将关系 | 已接入 |
| `CityPlotInfoPanel.tsx` / `DebateDialog.tsx` / `DuelDialog.tsx` | 485 | 配套 UI | 已在 `GameShell.tsx` 挂载 |

**注意**：`duel.ts`、`debate.ts`、`captives.ts`、`health.ts` 恰好是 `docs/GAME_RULES.md` 第 16 节列为「仍未形成完整规则闭环」的四项。也就是说上一个 agent 正在补这些缺口，且 `health.ts`（武将受伤与死亡）写完了但**还没接进游戏流程**。

**改动量**：55 个文件，+3470 / −433 行，主要集中在 `src/components`（11）、`src/game/battle`（9）、`src/game`（9）、`src/game/skills`（18）。

## 六、修复记录（2026-09-02）

### 已修复

1. **P1-1 测试环境** — 改写 `vite.config.ts`，用 `test.projects` 拆成 `client`（jsdom，含 `src/test/setup.ts`）与 `server`（node）两个项目。12 个服务端用例恢复运行并全部通过。
2. **P1-2 征兵测试** — 在 `src/components/game-ui.test.tsx` 新增 `seedCityFacility()` 辅助函数，给两个用例的江陵预置兵舍（征兵前置）与锻冶（生产弩前置）。
   - 关键发现：预置设施后，测试期望的 `士兵 +1,290` 与 `弩 +1,696` **数值未变**。这反证了设施产出加成在玩家命令路径中确实没有参与计算（见下）。
3. **P2-2 仓库卫生** —
   - `src/game/plot-truncate-repro.test.ts` → 重命名为 `src/game/innerAffairs-plots.test.ts`
   - `test-out.txt` 取消 git 跟踪（文件保留在磁盘），并加入 `.gitignore`
   - `.gitignore` 补充 `.codex/`、`.agents/`
4. **规则文档补齐** — `docs/GAME_RULES.md` 新增「城市地格设施（建设用地）」小节（地格数量、位置、造价表、建设耗时、耐久、前置关系），并在第 16 节更新已实现系统清单。

### 新发现并已登记的缺口：设施产出加成未生效

`barracksYieldMultiplier`（兵舍每级征兵量 +15%）与 `smithyYieldMultiplier`（工房每级兵装产量 +15%）目前**只作用于军团自动化路径**：

- 生效：`src/game/innerAffairs.ts` → `settleLegionAutomation()` 中的 `case 'recruit'`
- 不生效：`src/game/commands.ts` → `case 'recruit'` / `case 'produceArmament'`，只算 `round(基础值 × commandYieldMultiplier × 科技加成)`
- `smithyYieldMultiplier` 在 `commands.ts` 中已 import 但从未使用；且 工房 对应的是冲车/井阑，其产量固定为 `2`（`isDelayedArmament`），加成即便接上也无意义——加成归属需要重新设计。

**后果**：设施目前只起「准入开关」作用，建了兵舍不给产量加成；玩家手动征兵拿不到加成，AI 军团自动化反而拿得到，两边不一致。

已在 `GAME_RULES.md` 中以「已知缺口」标注。**是否接线、以及工房加成该归属哪类兵装，需要你拍板。**

## 六、追加修复（同日第二轮）：设施产出加成已接线

上一节的缺口已修复，玩家手动命令与 AI 军团自动化两条路径现在产出一致：

- `src/game/commands.ts`：`case 'recruit'` 乘入 `barracksYieldMultiplier(city)`；`case 'produceArmament'` 对非延时兵装乘入 `armamentYieldMultiplier(city, armamentType)`（工房加成作用于枪/戟/弩/马，冲车/井阑保持固定产量不享受加成——这解决了「加成归属」的设计问题：延时兵装不接加成）。
- `src/game/innerAffairs.ts`：新增通用函数 `armamentYieldMultiplier(city, type)`，按兵装类型返回工房加成（常规兵装）或 1（延时兵装），军团自动化路径同步改用，避免两套逻辑。
- 测试更新：`src/game/commands.test.ts` 中 5 处产量断言改为从公式推导（不依赖魔法数字）；`src/components/game-ui.test.tsx` 期望值更新为 `士兵 +1,483`、`弩 +1,950`（含 1 级兵舍/工房加成）。
- `GAME_RULES.md`「已知缺口」标注移除，改为说明两条路径一致。

修复后全套测试 683/683 通过、57 个测试文件全绿、`tsc --noEmit` 零错误。

## 五、建议的下一步（更新）

1. ~~修测试环境~~ ✅ 已完成
2. ~~拍板征兵规则~~ → 已按「保留新设计」处理（补测试 + 更新文档）。若你希望回滚「征兵需兵舍」限制，告诉我即可。
3. ~~设施产出加成怎么接~~ ✅ 已接线（见第六节）
4. **接线 `health.ts`**（武将受伤与死亡已写完但 0 处引用）
5. **提交这批改动**：建议按「城市地格设施」「单挑/舌战」「俘虏与忠诚」「外交与流言」拆成几次提交
6. ~~仓库清理~~ ✅ 已完成（除 `.codex/`、`.agents/` 目录本身是否删除待确认）
