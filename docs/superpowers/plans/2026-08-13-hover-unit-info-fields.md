# 部队悬停情报字段精简实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从地图部队悬停情报中移除“士兵”和“兵科”，保留其他现有字段。

**Architecture:** 仅修改负责悬停面板的 `UnitInfoPanel`。测试通过真实地图悬停流程验证字段不存在，避免影响详细情报窗口和部队数据本身。

**Tech Stack:** React、TypeScript、Vitest、Testing Library

## Global Constraints

- 详细情报窗口、地图部队标记、出征界面及战斗计算保持不变。
- 不新增依赖，不修改 `GameState` 或 `ArmyUnit` 类型。
- 使用测试驱动开发，先观察测试因现有字段仍显示而失败。

---

### Task 1: 精简悬停部队情报

**Files:**
- Modify: `src/components/StrategicMap.test.tsx`
- Modify: `src/components/UnitInfoPanel.tsx`

**Interfaces:**
- Consumes: `UnitInfoPanel` 现有 `unit`、`state`、`position` 和计略成功率属性。
- Produces: 保留主副将、统武智适、资金、兵粮、士气，但不含士兵和兵科的悬停面板。

- [ ] **Step 1: 写入失败测试**

在现有“shows unit information while hovering a field unit”测试中，用标签而不是易混淆数值验证字段：

```tsx
const info = screen.getByTestId('unit-info-panel');
expect(info).toHaveTextContent('资金');
expect(info).toHaveTextContent('兵粮');
expect(info).toHaveTextContent('士气');
expect(info).not.toHaveTextContent('士兵');
expect(info).not.toHaveTextContent('兵科');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm.cmd test -- src/components/StrategicMap.test.tsx`

Expected: FAIL，面板仍包含“士兵”和“兵科”。

- [ ] **Step 3: 完成最小实现**

从 `UnitInfoPanel` 的 `<dl>` 删除两行：

```tsx
<div><dt>士兵</dt><dd>{unit.troops.toLocaleString('en-US')}</dd></div>
<div><dt>兵科</dt><dd>{unitArmamentLabel(unit)} <em>{aptitude}</em></dd></div>
```

同时删除不再使用的 `TroopType` 导入、`TROOP_LABELS` 和 `unitArmamentLabel`。

- [ ] **Step 4: 运行聚焦测试**

Run: `npm.cmd test -- src/components/StrategicMap.test.tsx src/components/game-ui.test.tsx`

Expected: 两个测试文件全部通过。

- [ ] **Step 5: 运行完整验证**

Run: `npm.cmd test`

Expected: 所有测试通过。

Run: `npm.cmd run build`

Expected: TypeScript 检查和 Vite 生产构建通过。

- [ ] **Step 6: 提交前由用户决定**

生产代码完成后保持未提交，除非用户明确要求提交，避免与当前工作区其他改动混合。
