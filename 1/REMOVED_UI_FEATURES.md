# 移除的 UI 功能及接口留存 (重做需求指南)

本文档详细记录了项目中被移除的非开始界面 UI 组件。为了保证未来重做 UI 时 AI 能够清晰地了解需要实现哪些功能，本文档提供了每一个组件的视觉表现、交互逻辑、所需数据接口及全局事件。

---

## 1. HUD (主界面悬浮 `src/components/HUD.tsx`)
**未来重做功能需求:**
1. **视图层级:** 需要悬浮在 Phaser 游戏画布之上，且具备点击穿透 (`pointer-events: none/auto`) 管理，确保不遮挡游戏核心操作。
2. **顶部状态栏:** 
   - 退出/登出系统按钮（通常为 `window.location.reload()`）。
   - 当前玩家所属阵营名称及标志（如 United Earth Federation）。
3. **导航入口:** 
   - 提供 5 个全局面板的快捷入口：NAV (星图)、CMD (舰队)、ENG (设施)、TRF (港务)、ECO (经济)。
   - 点击时需要高亮当前选中状态，并触发对应的全局事件。
4. **操作提示:** 底部需要常驻一个操作提示栏，告知玩家快捷键（如 WASD 平移，左键选择等）。

**核心接口/事件:**
- **派发事件:** 
  - `emitUIEvent(GameEvents.OPEN_STARMAP)`
  - `emitUIEvent(GameEvents.OPEN_FLEET)`
  - `emitUIEvent(GameEvents.OPEN_HANGAR)`
  - `emitUIEvent(GameEvents.OPEN_PORT)`
  - `emitUIEvent(GameEvents.OPEN_ECONOMY)`
- **监听事件:** 需要监听上述 `OPEN_*` 事件以同步更新导航栏的高亮状态。

---

## 2. StarmapPanel (星图/导航面板 `src/components/panels/StarmapPanel.tsx`)
**未来重做功能需求:**
1. **星图渲染集成:** 需要提供一个 DOM 容器供 `StarmapRenderer` 挂载，渲染全局星区节点。
2. **交互逻辑:** 
   - 玩家可以点击星区节点以选中它，双击或点击确认可以切换雷达视图。
   - 界面上需显示当前所在星区和当前查看的星区。
   - 提供【规划航线】按钮。
3. **导航动作:** 
   - 点击规划航线后，将目标星区存入本地（或导航管理器），向聊天框发送系统提示，并关闭面板。

**核心接口/事件:**
- 获取数据: `WorldbookManager.getWorldState()`
- 获取基础场景: `(window as any).game.scene.getScene('Base')` -> 调用 `switchRadarView(sectorName)`
- 本地存储: 读取 `current_sector`，写入 `nav_target_sector`。
- 派发事件: 发送导航确认消息 `EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, ...))`。
- 渲染器管理: `StarmapRenderer.init(...)` 与 `StarmapRenderer.cleanup()`。

---

## 3. FleetPanel (舰队战术面板 `src/components/panels/FleetPanel.tsx`)
**未来重做功能需求:**
1. **布局结构:** 推荐采用左右分栏。左侧显示玩家当前拥有的“中队（舰队）”，右侧显示“未分配/闲置船只”。
2. **卡片信息:** 每艘船只需显示：名称、角色（旗舰/僚机）、型号、装甲耐久度进度。若是玩家当前操控的飞船（座驾），需有特殊标识。
3. **编队管理交互:** 
   - **新建/解散:** 提供组建新中队和解散所选中队的功能。
   - **指派操作:** 选中闲置船只时，可将其编入指定中队作为僚机或旗舰。选中已编队船只时，可移出当前编队。
   - **座驾切换:** 允许玩家将非当前操控的飞船设为新座驾（登舰）。
   - **战术指令:** 可对整个中队下达行为指令：跟随旗舰 (follow_leader)、自由交战 (free_engage)、坚守原地 (hold_position)。

**核心接口/事件 (基于 `PlayerManager`):**
- 数据读取: `PlayerManager.getStats()` (包含 `ownedShips`, `fleets`, `playerShipId`)。
- 操作方法: 
  - `setPlayerShip(id)`
  - `assignShipToFleet(shipId, fleetId, asFlagship)`
  - `removeShipFromFleet(shipId)`
  - `createFleet(name)`
  - `removeFleet(fleetId)`
  - `setFleetOrders(fleetId, order)`

---

## 4. HangarPanel (工程设施/装配面板 `src/components/panels/HangarPanel.tsx`)
**未来重做功能需求:**
1. **布局结构:** 推荐采用左右分栏。左侧显示当前座驾信息及插槽；右侧显示库存模块仓库。
2. **座驾信息:** 展示当前飞船名称、底盘型号、装甲值。遍历底盘 (`EquipmentData.HULLS`) 提供的位置插槽，显示该插槽的类型、尺寸描述，以及当前已装备的模块信息（若空则显示空闲）。
3. **库存仓库:** 
   - 顶部提供类型过滤标签（全部、武器、防御、引擎、核心、通用）。
   - 卡片式展示每个库存模块的名称、描述、尺寸。
4. **进阶交互准备:** 重做时需考虑添加将库存模块“拖拽”或“点击装备”到对应空闲/兼容插槽的逻辑（旧版本仅有展示，尚未实现装备替换逻辑）。

**核心接口/事件:**
- 仓库数据: `PlayerManager.getOwnedComponents()`。
- 玩家数据: `PlayerManager.getStats()` 获取当前座驾配置。
- 静态字典: `EquipmentData.COMPONENTS` 和 `EquipmentData.HULLS` 解析模块与插槽详情。

---

## 5. PortPanel (港务面板 `src/components/panels/PortPanel.tsx`)
**未来重做功能需求:**
1. **状态总览:** 显示当前星区港口的基础状态（如安全等级、可用泊位）。
2. **船只清单:** 以表格形式展示进出港舰船。包含列：舰船 ID、类型、ETA (预计到达时间)、状态 (如 Docked, Refueling, Unloading)、呼叫/交互操作按钮。
3. **完善方向:** 旧版本使用空数组静态占位。重做时需要连接到真实的 `SectorManager` 或 `PortManager` 实时拉取停靠列表和 NPC 飞船的进出港调度数据。

**核心接口/事件:**
- 数据获取: `localStorage.getItem('current_sector')`。
- *待实现接口*: `PortManager.getDockedVessels()` 等。

---

## 6. EconomyPanel (经济面板 `src/components/panels/EconomyPanel.tsx`)
**未来重做功能需求:**
1. **资产概览:** 顶部模块化展示玩家资源，包括联邦储蓄 (星币 Credits)，以及能量核心、原矿、合金等采集资源。
2. **市场交易:** 
   - 下方提供本地市场大宗商品交易表。
   - 字段包括：商品名称、买入价、卖出价、本地需求度（高/低）。
   - 提供买入/卖出操作按钮。
3. **完善方向:** 旧版本资源除星币外均为 0 占位，商品列表为空。重做时需对接动态经济系统，拉取各星区的商品基准价和浮动汇率。

**核心接口/事件:**
- 数据获取: `PlayerManager.getStats().credits` 获取玩家星币。
- *待实现接口*: `EconomyManager.getLocalCommodities()`、交易 API。

---

## 7. ContextMenu (右键菜单 `src/components/ui/ContextMenu.tsx`)
**未来重做功能需求:**
1. **触发机制:** 监听场景中的雷达右键点击事件。如果点击到空白太空，弹出基础导航菜单；如果点击到飞船，弹出交互菜单。
2. **视口防溢出:** 菜单弹出时需计算屏幕边界，确保菜单不会超出浏览器视口外。
3. **菜单选项:** 
   - **对空地:** “前往此处” (Move)。
   - **对目标飞船:** “集火攻击” (Attack)、“编队跟随” (Follow)、“建立通讯” (Comm)。
4. **关闭机制:** 监听左键点击其他区域，或按下 `Escape` 键时关闭菜单。阻止菜单自身的点击事件向底层雷达穿透。

**核心接口/事件:**
- **事件监听:** 
  - 监听 `document` 的 `radar_right_click` 事件（事件内附带了屏幕坐标 `screenX/Y`，世界坐标 `x/y`，以及 `targetShip` 对象）。
  - 监听 `document` 的 `radar_left_click` 事件。
- **派发指令:** 
  - 移动: `emitUIEvent(GameEvents.CMD_MOVE, { x, y })` 或 `{ targetId, type: 'follow' }`
  - 攻击: `emitUIEvent(GameEvents.CMD_ATTACK, { targetId })`
  - 通讯: `EventBus.dispatchEvent(new CustomEvent(GameEvents.OPEN_TEXT_ADVENTURE, { detail: { interactType: 'comm', targetId, nodeName } }))`
