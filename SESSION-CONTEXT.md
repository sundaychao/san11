# 完整对话任务上下文存档（2026-09-07）

> 本文件是"三国志11地图重建"任务的**全过程对话上下文**，跨多个会话、多次需求变更。
> 换账号后对助手说："读取 d:\MyProjects\san11\SESSION-CONTEXT.md 恢复全部上下文再继续" 即可无缝续接。
>
> 结构：§1 需求演变全程 → §2 各阶段经历（含弯路） → §3 决定性技术档案 → §4 文件清单 → §5 命令 → §6 错误与修复全录 → §7 关键决策记录 → §8 遗留事项

---

## §1 用户需求演变（全程原话）

1. **最初阶段（血色衣冠）**：用户曾要求做"血色衣冠6"（三国MOD）地图，助手生成了 32 城"华夏地图"（china42 名字的由来）。期间用户问过："我怎么才能看到新地图"。
2. **第一次纠偏**：用户看后说 **"不是这张，"**，并追问 **"为什么是三国志11原版的地图，不是血色衣冠6的地图"** —— 助手做了大量 SIRE/血色衣冠数据逆向。
3. **最终定调（决定性转折，当前生效需求）**：
   > **"完全和血色衣冠地图不一样，算了，你还是直接给我弄一个三国志11原版的地图吧，之前做的这个原版本地图和三国志11的方格很像了，只是有些地形的标示缺失，你优化一下之前的方案，就是那个原版地图，重新给我做一个更准确的三国志11原版地图"**
   
   → 放弃血色衣冠；重做**原版**地图；核心痛点＝旧原版图**缺失道路/港口等地形标示**。
4. 中途多次"继续"推进；任务完成后要求 **"完成后关机"**；随后 **"把上下文保存到本地，我用其他账号登录读取吧"**、**"我是说整个对话任务的上下文"**（本文件即其产物）。

## §2 各阶段经历（含弯路）

### 阶段A：血色衣冠地图方案（已废弃）
- 从 SIRE/MOD 数据构建 32 城地图，城市标签大量是**臆造名**（渤海/中山/彭城/开封/朔方/金陵/武昌/南阳/豫章/平阳/南康…）。
- 用户核对游戏原图后否定："完全和血色衣冠地图不一样" → 整体废弃。
- 遗留可用物：转换器框架（readTerrain/placeCities/verifyConnectivity/renderSvg）、china42.json 数据 schema、渲染脚本。

### 阶段B：早期原版地图（"方格很像了"但缺标示）
- 找到原版 `San11pkres.bin` 内 `'SHEX0008'` 地形条目（全文件唯一，#4864，偏移 `0x1f520cb7`，8 字节头 + 200×200×11B，p0=buf[8+i*11]，idx=x*200+y）。
- 确定朝向：x=东、y=南、上北下南；海岸/江河形态与原版一致。
- 缺陷：当时只映射了部分 p0 值，**v10（道路网）、v11（栈道）、v17（港口）等未呈现** → 用户看到"地形标示缺失"。

### 阶段C：本次会话（最终版，全部解决）
按步推进：
1. 写 `scripts/extract-big5-names.cjs`（Big5 双字节段扫描 + TextDecoder('big5')）。踩坑：无限循环（合法 hi + 非法 lo 不前进）→ `if (bytes.length===0){i++;continue}` 修复；终端排队卡死 → StopCommand + 新终端。
2. **突破**：在 `Scenario.s11` 中扫出三大真名表——都市@0x5a(步长25)、关所@0x474(步长26)、港口@0x578(步长26)；条目结构 `[Big5名≤8B][00 00][SJIS片假名读音]`；文件头 `KOEI%SAN11`@0x04。
3. ≥2字过滤器漏掉 4 个**单字城名**，十六进制转储步长偏移确认：0x8c=薊、0xf0=鄴、0x1ea=宛、0x299=吳 → 恰好 42 城。
4. **顺序配对三重证据**：
   - 地理合理性 42/42（襄平在东北、北海在山东沿海、洛阳居中原、云南在极西南…）；
   - 锚点校验：42 城坐标全部落在 p0=16、10 关全部落在 p0=18、35 港全部落在 p0=17；
   - → 证明 Scenario.s11 名称表顺序 == Scen000.s11 记录顺序。
5. Scen000.s11 记录结构解码：18B/条，u16LE x@+0、y@+2、@+4 类型标记（0x0004 城 / 0x0104 关 / 0x0204 港；@+6 是数据指针不是 ID）；COORD_BASE=0（坐标即网格坐标）。
6. 遮罩图核验剩余地形值：`tools/xsyg_map/van-m10.png`＝全国道路网、`van-m11.png`＝蜀地栈道（虚线）、`van-m19.png`＝山崖 → **20 值全部锁定**。van-m1.png 不存在（v1≈0 格，映射仍按 plain）。
7. 重写 `scripts/convert-xsyg-map.ts` 为纯原版模式（详见 §3/§4），运行结果：**87/87 锚点、42/42 城零修正、42/42 陆路连通**。
8. `node scripts/render-china42.cjs` → 人工核验 `tools/xsyg_map/china42-render.png`：渤海湾、山东半岛、长江入海口、黄河、道路网、渡口、城址全对。**"缺失标示"问题彻底解决。**
9. 游戏侧同步：`jingxiang208.ts` 城名改真名（宛/襄阳/江陵/武陵/江夏/长沙/零陵/桂阳——CityId 恰好与原版城名天然吻合，仅显示名换掉）；测试断言 豫章→武陵（game-ui.test ×1、command-ui.test ×3、turn.test ×2）。
10. 验证：`npx vitest run` → **59 文件 786 用例全绿**；`npx tsc --noEmit` → 仅 3 个既有无关错误（OfficerListDialog gender、captives.test skill）。
11. 附带发现：旧假标签是张冠李戴（如记录 #33 (99,188) 实为桂阳而非"洛阳"）。

## §3 决定性技术档案

### 3.1 数据源
| 数据 | 文件 | 位置/结构 |
|---|---|---|
| 地形 | `C:/san11/san11_原版/San11/Media/san11pkres.bin` | @0x1f520cb7，'SHEX0008' 头 8B + 40000 格×11B；值=buf[8+(x*200+y)*11] |
| 名称表 | `.../scenario/Scenario.s11`（47928B） | 都市@0x5a/25B、关所@0x474/26B、港口@0x578/26B、州名@0x906 |
| 坐标 | `.../scenario/Scen000.s11`（170010B） | 城@0x3f4f×42、关@0x4243×10、港@0x42f7×35；18B/条 u16LE x,y,+4 类型 |

### 3.2 原版 20 值地形映射（锁定）
0→plain 1→plain 2→hill 3→hill 4→forest(西南丛林) 5→forest 6→mountain 7→water(河) 8→water(海) 9→plain(荒) **10→road(路网)** **11→road(栈道)** 12→mountain 13→mountain 14→water(浅滩) 15→plain(主陆) **16→construction(城址)** **17→ferry(港口)** **18→construction(关所)** 19→mountain(山崖)

### 3.3 42 都市真名（记录顺序，繁(简)）
襄平 北平 薊(蓟) 南皮 平原 晉陽(晋阳) 鄴(邺) 北海 下邳 小沛 壽春(寿春) 濮陽(濮阳) 陳留(陈留) 許昌(许昌) 汝南 洛陽(洛阳) 宛 長安(长安) 上庸 安定 天水 武威 建業(建业) 吳(吴) 會稽(会稽) 廬江(庐江) 柴桑 江夏 新野 襄陽(襄阳) 江陵 長沙(长沙) 武陵 桂陽(桂阳) 零陵 永安 漢中(汉中) 梓潼 江州 成都 建寧(建宁) 雲南(云南)

**10 关**：壶关 虎牢关 潼关 函谷关 武关 阳平关 剑阁 葭萌关 涪水关 江油关(第10条字节损坏按史实补)
**35 港**：安平港 高唐港 西河港 白马港 昌阳港 临济港 海陵港 江都港 濡须港 顿丘港 官渡港 孟津港 解县港 新丰港 夏阳港 房陵港 芜湖港 虎林港 曲阿港 寻章港 皖口港 九江港 陆口港 鄱阳港 庐陵港 夏口港 湖阳港 中庐港 乌林港 汉津港 江津港 罗县港 洞庭港 公安港 巫县港（官/尋为 CP950 扩展前导字节）

### 3.4 china42.json schema（不变）
`{schemaVersion:1, width:200, height:200, backgroundImage:'', grid:[{q,r,terrain}], cities:[{id:拼音slug, label:简体真名, q, r}]}`；terrain ∈ road|plain|forest|hill|mountain|water|ferry|construction（src/game/types.ts:358）。渲染色：plain #69775f / road #a58d57 / forest #2f5f3a / hill #696851 / mountain #303837 / water #1e4c60 / ferry #a07440 / construction #8a8f6a。

### 3.5 地形统计（本次生成）
plain 25590 / mountain 4545 / water 3901 / forest 3834 / **road 1452** / hill 325 / construction 332 / **ferry 35**

## §4 文件清单（本任务最终态）

| 文件 | 状态 |
|---|---|
| `scripts/convert-xsyg-map.ts` | 重写为原版模式（内置 87 锚点自校验，错位抛错；城市清圈**只清山/水、保留道路/渡口标示**——这是修复"标示缺失"的关键设计） |
| `scripts/extract-big5-names.cjs` | 新建：Big5 名称段提取工具 |
| `public/maps/china42.json` / `src/game/scenario/china42.json` | 重新生成（42 真名城 + 全地形） |
| `public/maps/china42.svg` / `tools/xsyg_map/china42-render.png` | 预览产物 |
| `src/game/scenario/jingxiang208.ts` | CHINA42_CITY_MAP + citySeeds 改真名（id 不变）：宛/襄阳/江陵/武陵/江夏/长沙/零陵/桂阳 |
| `src/components/game-ui.test.tsx` / `command-ui.test.tsx` / `src/game/turn.test.ts` | '豫章'→'武陵' 共 6 处 |
| `src/game/persistence.ts` | 未改（直接消费 grid，schema 兼容） |
| `src/game/map-editor/generators/china42.ts` | **故意不动**：编辑器程序化生成器，与游戏地图无关 |

## §5 常用命令

```powershell
npx tsx scripts/convert-xsyg-map.ts      # 重新生成地图
node scripts/render-china42.cjs          # 渲染验证 PNG
node scripts/check-anchors.cjs           # 锚点复查
npx vitest run                           # 全量测试（当前 786 全绿）
npm run dev                              # 游戏内查看（景阳208 剧本）
npx tsc -p tsconfig.json --noEmit        # 类型检查（3 个既有无关错误，勿被误导）
```

## §6 错误与修复全录

1. extract-big5-names 无限循环（合法 hi+非法 lo 不前进）→ `bytes.length===0` 时 `i++;continue`。
2. 命令排在被旧 dev server 占用的终端 → StopCommand / `target_terminal:"new"`。
3. ≥2 字过滤漏单字城名 → 十六进制转储步长偏移找回 薊/鄴/宛/吳。
4. CP950 扩展前导字节截断（"渡港"/"章港"）→ 按已知名录补全 官渡港/寻章港。
5. 手工转码 GBK 出错（早期）→ 结论：pkres 无明文名，名称在 Scenario.s11 且为 Big5；用 TextDecoder('big5')。
6. `node -e` 内联脚本转义错误 → 改为 .cjs 文件。
7. **两次并行 SearchReplace 同一文件互相覆盖**（CHINA42_CITY_MAP 编辑被回滚）→ 同文件多处编辑必须串行，编辑后回读验证。
8. vitest `--reporter=basic` 不支持 → 默认 reporter。

## §7 关键决策记录

- **地名以 Scenario.s11 Big5 表为唯一权威**，顺序配对由三重证据背书（锚点 87/87 + 地理 42/42 + 结构解析）。
- 关所/港口以**地形标记**呈现（construction/ferry），不进 cities 数组（游戏暂无关隘交互逻辑）。
- 城市清圈逻辑改为只清 mountain/water，**绝不覆盖 road/ferry/construction**（保住"标示"）。
- 显示名用简体、slug 用拼音；CityId 保持不变以免动游戏逻辑。
- 编辑器 generator 与本项目旧 fixture 不改。

## §8 遗留事项 / 可选下一步

- 若需**可交互关隘/港口**（如渡口登船、关所封锁）：需扩展 types.ts 与剧本层，把 10 关/35 港从地形标记升格为实体对象（名称与坐标数据已在本文件 §3.3 与转换器内备用）。
- v14（浅滩→water）对个别边缘连通性的影响已由 BFS 验证兜底（42/42 连通）。
- 关机事宜：上次 `shutdown /s /t 30` 已失效（机器仍在用），待用户明确指示后再执行。
- 本存档若与代码冲突，**以代码与本文件 §3 数据表为准**；重生成一律走 `npx tsx scripts/convert-xsyg-map.ts`（自带锚点自校验，防名称/坐标错位回潮）。
