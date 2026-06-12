// @ts-nocheck
// 总类，只能作为调配分类逻辑使用，这里的部分逻辑只是还没做好分类，制作base相关内容时必须先找是否有分类，禁止在已有分类的情况下“如：Base-Docking.js与停泊有关，那么停泊相关禁止做在base里”
import { WorldbookManager } from './WorldbookManager.js';
import { StarmapRenderer } from './StarmapRenderer.js';
import { GameConfig } from '../config.js';
import { PlayerManager } from '../managers/PlayerManager.js';
import { ShipManager } from '../managers/ShipManager.js';
import { BuildingManager } from '../managers/BuildingManager.js';
import { LLMService } from '../services/LLMService.js';
import { EventBus, GameEvents } from '../utils/EventBus.js';
import { checkDroneSurvival } from './base/Base-WuRenJi.js';
import { processBuildingBeamHit, processMacroBuildingQueue, handleStartShipBuild } from './base/Base-Building.js';
import { processMacroDockingQueue, checkDockingGuidance, debugDockingStatus } from './base/Base-Docking.js';
import { handleFleetCommand } from './base/Base-Fleet.js';
import { processAILogic } from './base/Base-AI.js';
import { initAsteroidsForSector, updateAsteroids } from './base/Base-Asteroid.js';
import { AffinityManager } from '../managers/AffinityManager.js';
import { triggerWarp } from '../managers/oos/OOS-Travel.js';
import { createExplosion, createImplosion, createGateExitEffect, showRTSFeedback, createLaserBeam } from './base/Base-Effects.js';
import { updateSystemRadar } from './base/Base-Radar.js';

/**
 * 核心好感度系统：实体 A 对实体 B 的态度评分
 * 返回值 < 0 视为攻击目标 (主动射击阈值)
 * 返回值 <= -100 视为死敌 (被动反击阈值)
 */
export function getAffinity(A, B) {
    return AffinityManager.getAffinity(A, B);
}

export class Base extends Phaser.Scene {
    chatHistory: any[];
    lastRawResponse: string;
    lastRequestPayload: string;
    isLLMBusy: boolean;
    currentPoiId: string;
    pendingPoiId: string | null;
    contentDOM: any;
    pendingSystemPrompt: string | null;
    
    // 导航层级状态
    sectorViewState: string;
    activeSystemNode: string;
    systemMapOrbitTime: number;

    // 全景雷达拖拽缩放状态
    radarPanX: number;
    radarPanY: number;
    radarScale: number;
    isRadarDragging: boolean;
    _radarIsMouseDown: boolean;
    lastRadarDragX: number;
    lastRadarDragY: number;
    
    sysMouseX: number;
    sysMouseY: number;
    
    entityIdCounter: number;
    
    selectedUnitIds: string[]; // 替换 selectedUnitId，支持多选
    selectionBox: { startX: number, startY: number, currentX: number, currentY: number } | null; // 选框状态
    viewingSector: string | null;
    sectorSimulations: any;
    
    isJumping: boolean;
    radarEntities: any;
    radarMissiles: any[];
    _globalMouseMoveHandler: any;
    _globalContextMenuHandler: any;
    _radarLeftClickHandler: any;
    _uiCommandHandler: any;
    playerCursors: any;
    playerFireKey: any;
    playerKeys: any;
    playerData: any;
    worldTickTimer: any;
    worldTickCount: number;
    playerWarp: any;
    pendingArrivalEffect: any;
    playerAutoPilot: any;
    drydockState: any;
    _smSelectHandler: any;
    disabledWeaponSlots: Set<string>;
    _toggleEquipmentHandler: any;

    constructor(key = 'Base') {
        super(key);
        this.chatHistory = []; 
        this.lastRawResponse = "暂无数据"; 
        this.lastRequestPayload = "无请求数据";
        this.isLLMBusy = false;
        this.currentPoiId = localStorage.getItem('current_poi') || 'poi-dock';
        this.pendingPoiId = null;
        this.contentDOM = null;
        this.pendingSystemPrompt = null;
        
        // 导航层级状态
        this.sectorViewState = 'poi'; // 默认直接显示当前地点的内部 POI
        this.activeSystemNode = 'planet';
        this.systemMapOrbitTime = 0; // 用于驱动雷达动画的累积时间

        // 全景雷达拖拽缩放状态
        this.radarPanX = 0;
        this.radarPanY = 0;
        this.radarScale = 1;
        this.isRadarDragging = false;
        this._radarIsMouseDown = false;
        this.lastRadarDragX = 0;
        this.lastRadarDragY = 0;
        
        this.sysMouseX = 0;
        this.sysMouseY = 0;
        
        this.entityIdCounter = 0;
        
        this.selectedUnitIds = []; // RTS 选中单位集合
        this.selectionBox = null;
        this.viewingSector = null; // 当前监视的星区（可能与物理所在的 current_sector 不同）
        this.sectorSimulations = {}; // 多星区物理仿真容器
        
        this.isJumping = false;
        this.worldTickCount = 0;
        this.disabledWeaponSlots = new Set();
    }

    create() {
        // [核心修复] 彻底清空上一个场景生命周期的遗留内存
        // 否则场景 restart 后，因为 constructor 不会再次执行，旧的实体数据会覆盖新出生的玩家位置
        this.sectorSimulations = {}; 
        this.selectedUnitIds = [];
        this.isChangingShip = false;
        
        this.initCoreEngine();
        this.initUIAndLLM();
    }

    initCoreEngine() {
        let currentSector = localStorage.getItem('current_sector');
        this.viewingSector = currentSector;
        
        // [核心修复] 第一帧竞态条件防死锁
        // 场景刚重启的这微小时间里，ShipManager 如果跑在 updateSystemRadar 前面，
        // 就会因为不知道 currentSector 而将整个宇宙判定为 OOS，从而错误修改玩家状态。
        // 这里必须提前强制注入 activeSectors：
        ShipManager.setActiveSectors([currentSector]);
        
        this.cameras.main.fadeIn(800, 0, 0, 0); // 黑色淡入，更符合太空氛围
        this.cameras.main.setBackgroundColor('rgba(0,0,0,0)'); // 确保 UI 层相机透明，不遮挡底层 RadarScene
        this.isJumping = false;

        // 读取玩家最后一次的物理坐标，防止F5刷新回档
        let startX = parseFloat(localStorage.getItem('player_radar_x'));
        let startY = parseFloat(localStorage.getItem('player_radar_y'));
        if (isNaN(startX)) startX = 500;
        if (isNaN(startY)) startY = 275;

        // --- 强制在生命周期内初始化 RTS 实体池，防止场景重载时状态损坏 ---
        // [重构] 彻底移除特权实体 this.radarEntities.player
        this.radarEntities = {
            defenders: [], 
            attackers: [], 
            projectiles: [] 
        };
        this.radarMissiles = [];
        
        // 初始化全局飞船管理器
        ShipManager.init();
        
        // 初始化空间站建造系统
        BuildingManager.load();

        // 初始化库存系统
        if (typeof window !== 'undefined' && (window as any).InventoryManager) {
            (window as any).InventoryManager.load();
        }

        // [New UI] 触发进入游戏的全局事件，让 React 显示主 UI
        EventBus.dispatchEvent(new CustomEvent('game_started'));
        
        // 触发一次船只状态更新，确保 UI 层 (如 WuRenJiPanel) 能在所有管理器加载完毕后拉取到正确的数据
        setTimeout(() => {
            document.dispatchEvent(new Event('DRONE_STATE_CHANGED'));
            document.dispatchEvent(new Event('INVENTORY_CHANGED')); // 顺便触发一下仓库刷新
        }, 200);

        // 监听全局鼠标移动，用于飞船自动转向（防止 DOM 遮挡导致 Phaser 收不到事件）
        this.sysMouseX = window.innerWidth / 2;
        this.sysMouseY = window.innerHeight / 2;
        this._globalMouseMoveHandler = (e) => {
            this.sysMouseX = e.clientX;
            this.sysMouseY = e.clientY;
        };
        document.addEventListener('mousemove', this._globalMouseMoveHandler);

        // 监听来自舰队战术终端的换船指令
        this._playerShipChangeHandler = (e: any) => {
            // [重构] 玩家登舰后，强制完全重启场景，重新加载整个星区的物理引擎和相机视角
            // 阻断所有正在进行的物理更新和数据保存，防止旧位置覆写新船
            this.isChangingShip = true;
            if (this.worldTickTimer) {
                this.worldTickTimer.destroy();
                this.worldTickTimer = null;
            }
            this.scene.restart();
        };
        document.addEventListener('PLAYER_SHIP_CHANGED', this._playerShipChangeHandler);

        // 监听来自 UI 的武器开关
        this._toggleEquipmentHandler = (e: any) => {
            const { slotId, active } = e.detail;
            if (active) {
                this.disabledWeaponSlots.delete(slotId);
            } else {
                this.disabledWeaponSlots.add(slotId);
            }
        };
        document.addEventListener('TOGGLE_EQUIPMENT', this._toggleEquipmentHandler);

        // 监听来自船坞等终端的飞船建造下达事件
        this._startShipBuildHandler = handleStartShipBuild;
        document.addEventListener('start_ship_build', this._startShipBuildHandler);

        // 监听来自泊区终端的停泊申请事件
        import('./base/Base-Docking.js').then(module => {
            this._applyDockingHandler = module.handleApplyDocking;
            document.addEventListener('ui_apply_docking', this._applyDockingHandler);
        });

        // 拦截浏览器原生的右键菜单和相关的手势行为 (Edge/Chrome)
        this._globalContextMenuHandler = (e) => {
            e.preventDefault();
        };
        document.addEventListener('contextmenu', this._globalContextMenuHandler);

        // 监听左键点击选中目标
        this._radarLeftClickHandler = (e) => {
            const detail = e.detail;
            if (detail.targetShip) {
                // 点击时在 F12 打印该实体的装备与属性细节
                console.log(`=== 选中实体: ${detail.targetShip.id} ===`);
                console.log("微观实体数据:", detail.targetShip);
                console.log("== 【容量排查】 ==");
                console.log("这艘船底盘ID是: ", detail.targetShip.hullId || (detail.targetShip.shipRef && detail.targetShip.shipRef.hullId));
                console.log("微观实体的 maxInventory 是: ", detail.targetShip.maxInventory);
                if (detail.targetShip.shipRef) {
                    console.log("宏观对象(shipRef) 的 maxInventory 是: ", detail.targetShip.shipRef.maxInventory);
                    console.log("宏观对象(shipRef):", detail.targetShip.shipRef);
                    console.log("挂载的武器(activeWeapons):", detail.targetShip.shipRef.activeWeapons);
                } else {
                    console.warn("注意：该实体没有绑定 shipRef，将无法开火或被保存！");
                }
                
                // 为了万无一失，直接用我刚刚修复好的函数再算一遍：
                if (typeof window !== 'undefined' && (window as any).InventoryManager) {
                    const finalCap = (window as any).InventoryManager.getCapacity(detail.targetShip.id, detail.targetShip);
                    console.log("InventoryManager算出来的最终容量是: ", finalCap);
                }
                console.log("==================");

                // 如果按住了 Shift，则多选，否则单选
                const shiftKey = this.input.keyboard.checkDown(this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT));
                if (shiftKey) {
                    if (!this.selectedUnitIds.includes(detail.targetShip.id)) {
                        this.selectedUnitIds.push(detail.targetShip.id);
                    }
                } else {
                    this.selectedUnitIds = [detail.targetShip.id];
                }
            } else if (!detail.targetNode && !detail.isDragEnd) {
                // 点击空白处且不是框选结束，取消所有选择
                this.selectedUnitIds = [];
            }
        };
        document.addEventListener('radar_left_click', this._radarLeftClickHandler);
        
        // 监听框选事件
        this._radarBoxSelectHandler = (e) => {
            const detail = e.detail;
            const pd = PlayerManager.getStats();
            let newSelection = [];
            
            // 找出框内的所有我方单位
            let currentSector = localStorage.getItem('current_sector');
            const currentViewSector = this.viewingSector || currentSector;
            
            // 如果 sectorSimulations 中没有，直接用 radarEntities (渲染和模拟层级的数据)
            const entitiesPool = this.sectorSimulations[currentViewSector] || this.radarEntities;
            
            if (entitiesPool && entitiesPool.defenders) {
                entitiesPool.defenders.forEach(ent => {
                    // 判断是否是玩家拥有的资产（并且不是玩家自己的当前座驾）
                    let isMyAsset = false;
                    if (pd.ownedShips && pd.ownedShips.some(s => s.id === ent.id) && ent.id !== pd.playerShipId) {
                        isMyAsset = true;
                    }
                    
                    if (isMyAsset) {
                        const minX = Math.min(detail.startX, detail.endX);
                        const maxX = Math.max(detail.startX, detail.endX);
                        const minY = Math.min(detail.startY, detail.endY);
                        const maxY = Math.max(detail.startY, detail.endY);
                        
                        if (ent.x >= minX && ent.x <= maxX && ent.y >= minY && ent.y <= maxY) {
                            newSelection.push(ent.id);
                        }
                    }
                });
            }
            
            const shiftKey = this.input.keyboard.checkDown(this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT));
            if (shiftKey) {
                newSelection.forEach(id => {
                    if (!this.selectedUnitIds.includes(id)) {
                        this.selectedUnitIds.push(id);
                    }
                });
            } else {
                // 只有当框选到单位时，才清空原有的选择
                if (newSelection.length > 0) {
                    this.selectedUnitIds = newSelection;
                }
            }
        };
        document.addEventListener('radar_box_select', this._radarBoxSelectHandler);

        // 监听来自舰队战术终端的选中指令
        this._uiSelectFleetHandler = (e) => {
            const { unitIds } = e.detail;
            if (unitIds && Array.isArray(unitIds)) {
                const pd = PlayerManager.getStats();
                const validSelection = [];
                unitIds.forEach(id => {
                    // 不能选中自己当前驾驶的飞船
                    if (id !== pd.playerShipId) {
                        validSelection.push(id);
                    }
                });
                this.selectedUnitIds = validSelection;
            }
        };
        document.addEventListener('ui_select_fleet_units', this._uiSelectFleetHandler);

        // 监听来自星图 UI 层的导航指令
        this._navTargetHandler = (e) => {
            const { targetSector, path } = e.detail;
            const pd = PlayerManager.getStats();
            const playerShipId = pd.playerShipId;
            let realPlayerEnt = null;
            if (this.radarEntities) {
                realPlayerEnt = [...(this.radarEntities.defenders || []), ...(this.radarEntities.attackers || [])].find(s => s.id === playerShipId);
            }

            if (realPlayerEnt && realPlayerEnt.shipRef) {
                const pShip = pd.ownedShips.find(s => s.id === playerShipId);
                const macroShip = ShipManager.getShipById(playerShipId);
                
                if (path && path.length > 0) {
                    if (pShip) pShip.path = path;
                    if (macroShip) {
                        macroShip.path = path;
                        macroShip.state = 'DEPARTURE';
                        macroShip.targetGate = path[0];
                    }
                    realPlayerEnt.shipRef.path = path;
                    realPlayerEnt.shipRef.state = 'DEPARTURE';
                    realPlayerEnt.shipRef.targetGate = path[0];
                    
                    // 存入 localStorage 以便下一次初始化时记忆导航目标
                    localStorage.setItem('nav_target_sector', targetSector);
                    localStorage.setItem('nav_path', JSON.stringify(path));
                }
            } else {
                // 此时玩家尸体/实体可能已被销毁，只写进系统缓存中，等待复活或重载后读取
                localStorage.setItem('nav_target_sector', targetSector);
                localStorage.setItem('nav_path', JSON.stringify(path));
            }
        };
        document.addEventListener('ui_set_nav_target', this._navTargetHandler);

        // 监听 ui_select_docking_target，给飞船实体分配停泊引导目标
        this._dockingTargetHandler = (e) => {
            const { targetId, berthId, worldX, worldY, entryAngle, hullId, shipId } = e.detail;
            const pd = PlayerManager.getStats();
            
            let targetEntity = null;
            
            // 1. 如果事件指明了 shipId，寻找对应的微观实体
            if (shipId && String(pd.playerShipId) !== String(shipId)) {
                if (this.radarEntities) {
                    if (this.radarEntities.defenders) {
                        targetEntity = this.radarEntities.defenders.find(s => String(s.id) === String(shipId));
                    }
                    if (!targetEntity && this.radarEntities.attackers) {
                        targetEntity = this.radarEntities.attackers.find(s => String(s.id) === String(shipId));
                    }
                }
            } else {
                // 2. 如果没有明确 shipId 或就是玩家，则默认分配给玩家
                if (this.radarEntities) {
                    targetEntity = [...(this.radarEntities.defenders || []), ...(this.radarEntities.attackers || [])].find(s => s.id === pd.playerShipId);
                }
            }

            // 挂载 dockingGuidanceTarget 属性给对应的微观实体
            if (targetEntity) {
                targetEntity.dockingGuidanceTarget = {
                    worldX: worldX,
                    worldY: worldY,
                    entryAngle: entryAngle,
                    targetId: targetId,
                    berthId: berthId
                };
            }
        };
        document.addEventListener('ui_select_docking_target', this._dockingTargetHandler);

        // 监听来自 ContextMenu 的 UI 命令
        this._uiCommandHandler = (e) => {
            handleFleetCommand(this.selectedUnitIds, e.detail, e.type, this);
        };

        EventBus.addEventListener(GameEvents.CMD_MOVE, this._uiCommandHandler);
        EventBus.addEventListener(GameEvents.CMD_ATTACK, this._uiCommandHandler);
        EventBus.addEventListener(GameEvents.CMD_DOCK, this._uiCommandHandler);

        // [新增] 监听采矿右键菜单指令
        this._cmdMineHandler = (e: any) => {
            const detail = e.detail;
            if (!this.selectedUnitIds || this.selectedUnitIds.length === 0) return;
            
            const pd = PlayerManager.getStats();
            let hasAssigned = false;

            this.selectedUnitIds.forEach(unitId => {
                const targetShip = ShipManager.getShipById(unitId);
                if (!targetShip) return;

                if (pd.ownedShips && pd.ownedShips.some((s: any) => s.id === unitId) && unitId !== pd.playerShipId) {
                    import('../managers/ship/ShipDecision.js').then(module => {
                        const order = {
                            type: 'MINE',
                            payload: { targetSector: targetShip.location?.sector || localStorage.getItem('current_sector') }
                        };
                        module.ShipDecision.assignMacroOrder(targetShip, order);
                        // console.log(`【DEBUG】下达采矿指令成功: ${targetShip.name} 将前往星区 ${order.payload.targetSector} 采矿`);
                        // console.log(`【DEBUG】飞船当前 orderQueue:`, targetShip.orderQueue);
                    });
                    hasAssigned = true;
                }
            });

            if (hasAssigned) {
                this.showRTSFeedback(null, detail.x, detail.y, '#00ffff', '开始采矿');
                EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:#00ffff;">[战术] 指令已发送：指定单位前往小行星带执行采矿作业。</div>` }));
            }
        };
        EventBus.addEventListener(GameEvents.CMD_MINE, this._cmdMineHandler);

        // [新增] 监听停靠右键菜单指令
        this._cmdDockHandler = (e: any) => {
            const detail = e.detail;
            if (!this.selectedUnitIds || this.selectedUnitIds.length === 0) return;
            
            const pd = PlayerManager.getStats();
            const validUnitIds = [];
            
            if (pd.ownedShips) {
                this.selectedUnitIds.forEach(id => {
                    if (pd.ownedShips.some(s => s.id === id) && id !== pd.playerShipId) {
                        validUnitIds.push(id);
                    }
                });
            }

            if (validUnitIds.length === 0) return;

            validUnitIds.forEach((unitId, index) => {
                const targetShip = ShipManager.getShipById(unitId);
                if (!targetShip) return;

                // 设置命令状态，让微观AI接管去飞向泊位
                targetShip.commandState = 'DOCK';
                targetShip.commandTargetId = detail.targetId; // 这个是目标建筑/泊区的 UID
                
                // 模拟派发停靠申请事件，让底层系统去计算泊位分配并返回坐标
                document.dispatchEvent(new CustomEvent('ui_apply_docking', {
                    detail: {
                        moduleId: detail.targetId,
                        shipId: unitId
                    }
                }));

                if (index === 0) {
                    this.showRTSFeedback(null, detail.x || targetShip.location.x, detail.y || targetShip.location.y, '#00ffaa', '申请停靠');
                    EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:#00ffaa;">[战术] 指令已发送：要求舰队单位自动停靠至目标端口。</div>` }));
                }
            });
        };
        EventBus.addEventListener(GameEvents.CMD_DOCK, this._cmdDockHandler);

        // 监听作弊菜单强制注入的死敌记忆
        this._cheatMemoryInjectHandler = (e) => {
            const list = e.detail;
            if (list && Array.isArray(list)) {
                list.forEach(item => {
                    const { A, B, val } = item;
                    // 同步到宏观实体
                    const mShipA = ShipManager.getShipById(A);
                    if (mShipA) {
                        if (!mShipA.memory) mShipA.memory = {};
                        mShipA.memory[B] = val;
                    }
                    // 同步到当前活跃的微观实体
                    let currentSector = localStorage.getItem('current_sector');
                    const currentViewSector = this.viewingSector || currentSector;
                    const pool = this.sectorSimulations[currentViewSector] || this.radarEntities;
                    if (pool && pool.defenders) {
                        const microA = pool.defenders.find(s => s.id === A) || pool.attackers.find(s => s.id === A);
                        if (microA) {
                            if (!microA.memory) microA.memory = {};
                            microA.memory[B] = val;
                            // [关键] 强制将目标变红并转移到 attackers 数组，避免出现蓝名死敌不发激光的情况
                            microA.color = '#ff3333';
                        }
                    }
                });
            }
        };
        document.addEventListener('cheat_inject_memory', this._cheatMemoryInjectHandler);

        // --- 恢复被移除的雷达鼠标滚轮缩放事件 ---
        this._radarWheelHandler = (e) => {
            const dy = e.detail.deltaY;
            if (dy > 0) {
                this.radarScale *= 0.9;
            } else {
                this.radarScale *= 1.1;
            }
            // 限制缩放范围在 0.005(远) 到 4.0(近) 之间，以适应几万像素的巨大星系
            this.radarScale = Math.max(0.005, Math.min(4.0, this.radarScale));
        };
        document.addEventListener('radar_wheel', this._radarWheelHandler);

        this.playerCursors = this.input.keyboard.createCursorKeys();
        this.playerFireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.playerKeys = this.input.keyboard.addKeys({
            w: Phaser.Input.Keyboard.KeyCodes.W,
            a: Phaser.Input.Keyboard.KeyCodes.A,
            s: Phaser.Input.Keyboard.KeyCodes.S,
            d: Phaser.Input.Keyboard.KeyCodes.D,
            q: Phaser.Input.Keyboard.KeyCodes.Q,
            e: Phaser.Input.Keyboard.KeyCodes.E,
            f: Phaser.Input.Keyboard.KeyCodes.F,
            tab: Phaser.Input.Keyboard.KeyCodes.TAB,
            space: Phaser.Input.Keyboard.KeyCodes.SPACE,
            ctrl: Phaser.Input.Keyboard.KeyCodes.CTRL,
            shift: Phaser.Input.Keyboard.KeyCodes.SHIFT
        });
        
        // --- 超级硬核调试：F 键打印当前星区所有战舰的互相好感度 ---
        this.input.keyboard.on('keydown-H', () => {
            console.warn("==== [星区建筑阵营调试触发] ====");
            const allMods = BuildingManager.getAllModules();
            if (!allMods || allMods.length === 0) {
                console.log("当前星区没有任何建筑。");
                return;
            }
            
            console.table(allMods.map(mod => ({
                UID: mod.uid,
                Module: mod.moduleId,
                FactionId: mod.factionId !== undefined ? mod.factionId : '未分配'
            })));
            console.warn("================================");
        });

        this.input.keyboard.on('keydown-F', () => {
            console.warn("==== [泊位状态硬核调试触发] ====");
            const currentSector = localStorage.getItem('current_sector');
            if (currentSector) {
                debugDockingStatus(currentSector);
            }
        });

        this.input.keyboard.on('keydown-J', () => {
            console.warn("==== [全宇宙飞船状态硬核调试触发 (J)] ====");
            if (window.ShipManager && window.ShipManager.ships) {
                const summary = window.ShipManager.ships.map(ship => ({
                    名称: ship.name,
                    大状态: ship.state,
                    小状态: ship.commandState || '无',
                    正在执行: ship.taskStack && ship.taskStack.length > 0 ? ship.taskStack[0].action : '空闲',
                    位置: ship.location ? ship.location.sector : '未知',
                    类型: ship.type,
                    所有者: ship.ownerId,
                    ID: ship.id
                }));
                console.table(summary);
                console.log(`共统计 ${summary.length} 艘飞船实体。`);
            } else {
                console.log("无法获取 ShipManager 实例。");
            }
            console.warn("=========================================");
        });

        // 禁用 TAB 键的默认焦点切换
        this.input.keyboard.on('keydown-TAB', function (event) {
            event.preventDefault();
        });

        this.playerData = PlayerManager.getStats();
        
        // 背景 (已被透明化，底层由 RadarScene 接管)
        // this.add.rectangle(GameConfig.game.width/2, GameConfig.game.height/2, GameConfig.game.width, GameConfig.game.height, 0x000000).setDepth(-9999);

        // 延迟初始化，确保 DOM 元素已经全部挂载
        this.time.delayedCall(100, () => {
            // [引擎换血] 先确保清理遗留的 RadarScene，再启动真正的 WebGL 物理渲染场景，垫在底层
            if (this.scene.isActive('RadarScene')) {
                this.scene.stop('RadarScene');
            }
            this.scene.launch('RadarScene');
            this.scene.sendToBack('RadarScene'); // 明确将其放在 Base 下方
        });

        // 世界演化计时器 (原先是10秒，现在提升到200ms高频刷新以实时展现战场与商船)
        if (this.worldTickTimer) this.worldTickTimer.destroy();
        this.worldTickCount = 0;
        this.worldTickTimer = this.time.addEvent({
            delay: 200, 
            callback: () => {
                this.handleWorldTick();
                this.worldTickCount++;
                if (this.worldTickCount % 5 === 0) {
                    // 每 1 秒强制保存一次飞船位置，防止刷新或跃迁时回档
                    ShipManager.save();
                    if (this.radarEntities && !this.isJumping) {
                        const pd = PlayerManager.getStats();
                        const rp = [...(this.radarEntities.defenders || []), ...(this.radarEntities.attackers || [])].find(e => String(e.id) === String(pd.playerShipId));
                        if (rp) {
                            localStorage.setItem('player_radar_x', rp.x);
                            localStorage.setItem('player_radar_y', rp.y);
                        }
                    }
                }
            },
            callbackScope: this,
            loop: true
        });

        // 清理
        this.events.on('shutdown', () => {
            try {
                if (this.contentDOM) {
                    this.contentDOM.destroy();
                    this.contentDOM = null;
                }
                if (this.worldTickTimer) {
                    this.worldTickTimer.destroy();
                    this.worldTickTimer = null;
                }
                if (this._globalMouseMoveHandler) {
                    document.removeEventListener('mousemove', this._globalMouseMoveHandler);
                    this._globalMouseMoveHandler = null;
                }
                if (this._globalContextMenuHandler) {
                    document.removeEventListener('contextmenu', this._globalContextMenuHandler);
                    this._globalContextMenuHandler = null;
                }
                if (this._radarWheelHandler) {
                    document.removeEventListener('radar_wheel', this._radarWheelHandler);
                    this._radarWheelHandler = null;
                }
                if (this._radarLeftClickHandler) {
                    document.removeEventListener('radar_left_click', this._radarLeftClickHandler);
                    this._radarLeftClickHandler = null;
                }
                if (this._radarBoxSelectHandler) {
                    document.removeEventListener('radar_box_select', this._radarBoxSelectHandler);
                    this._radarBoxSelectHandler = null;
                }
                if (this._uiSelectFleetHandler) {
                    document.removeEventListener('ui_select_fleet_units', this._uiSelectFleetHandler);
                    this._uiSelectFleetHandler = null;
                }
                if (this._navTargetHandler) {
                    document.removeEventListener('ui_set_nav_target', this._navTargetHandler);
                    this._navTargetHandler = null;
                }
                if (this._uiCommandHandler) {
                    EventBus.removeEventListener(GameEvents.CMD_MOVE, this._uiCommandHandler);
                    EventBus.removeEventListener(GameEvents.CMD_ATTACK, this._uiCommandHandler);
                    EventBus.removeEventListener(GameEvents.CMD_DOCK, this._uiCommandHandler);
                    this._uiCommandHandler = null;
                }
                if (this._cmdMineHandler) {
                    EventBus.removeEventListener(GameEvents.CMD_MINE, this._cmdMineHandler);
                    this._cmdMineHandler = null;
                }
                if (this._cmdDockHandler) {
                    EventBus.removeEventListener(GameEvents.CMD_DOCK, this._cmdDockHandler);
                    this._cmdDockHandler = null;
                }
                if (this._cheatMemoryInjectHandler) {
                    document.removeEventListener('cheat_inject_memory', this._cheatMemoryInjectHandler);
                    this._cheatMemoryInjectHandler = null;
                }
                if (this._playerShipChangeHandler) {
                    document.removeEventListener('PLAYER_SHIP_CHANGED', this._playerShipChangeHandler);
                    this._playerShipChangeHandler = null;
                }
                if (this._toggleEquipmentHandler) {
                    document.removeEventListener('TOGGLE_EQUIPMENT', this._toggleEquipmentHandler);
                    this._toggleEquipmentHandler = null;
                }
                if (this._startShipBuildHandler) {
                    document.removeEventListener('start_ship_build', this._startShipBuildHandler);
                    this._startShipBuildHandler = null;
                }
                if (this._applyDockingHandler) {
                    document.removeEventListener('ui_apply_docking', this._applyDockingHandler);
                    this._applyDockingHandler = null;
                }
                if (this._dockingTargetHandler) {
                    document.removeEventListener('ui_select_docking_target', this._dockingTargetHandler);
                    this._dockingTargetHandler = null;
                }
                StarmapRenderer.cleanup();

                // [New UI] 触发退出游戏的全局事件，让 React 隐藏主 UI 并恢复全屏缩放
                EventBus.dispatchEvent(new CustomEvent('game_ended'));
            } catch (e) {
                console.error('Error during scene shutdown cleanup:', e);
            }
        });
    }

    initUIAndLLM() {
        this.time.delayedCall(100, () => {
            // 生成底层雷达的静态 DOM 结构
            this.initSystemRadarStatic(this.contentDOM);

            EventBus.dispatchEvent(new CustomEvent(GameEvents.UPDATE_INVENTORY, { detail: PlayerManager.getInventory() }));
            this.renderSectorView(this.contentDOM);
            
            // 调试按钮样式绑定
            const debugBtn = this.contentDOM?.node?.querySelector('#chat-debug');
            if (debugBtn) {
                debugBtn.onmouseover = () => debugBtn.style.backgroundColor = '#555';
                debugBtn.onmouseout = () => debugBtn.style.backgroundColor = '#333';
            }
            
            this.initChatContext(this.contentDOM);
        });

        // 游戏加载后立即执行一次经济推演，打破开局静默期，生成第一批星际航线
        this.time.delayedCall(500, () => {
            this.handleWorldTick();
        });
    }

    update(time, delta) {
        // if (!this.contentDOM) return;
        if (this.isChangingShip) return; // 换船瞬间绝对熔断，防止发生状态污染
        
        const dt = Math.min(delta / 1000, 0.1);

        // [核心修复] 驱动整个宏观宇宙的飞船后台演算 (包含僚机跟随、商船寻路、自动跃迁)
        ShipManager.update(dt, WorldbookManager.getWorldState());

        // 处理玩家的宏观星图跃迁航行
        const pd = PlayerManager.getStats();
        const playerMacroShip = ShipManager.getShipById(pd.playerShipId);

        if (this.isJumping && playerMacroShip) {
            // [BugFix] 强制刷新并捕获玩家状态流转。如果进度条走满，ShipManager 在 OOS 里会自动把玩家位置挪过去
            // 但是如果它正好是 TRANSIT/ARRIVAL，这里就能捕获到并退出 Jump 死锁
            if (playerMacroShip.state === 'TRANSIT' || playerMacroShip.state === 'ARRIVAL' || playerMacroShip.state === 'IDLE') {
                // 跃迁完成
                this.isJumping = false;
                document.dispatchEvent(new CustomEvent('player_warp_state', { detail: false }));
                
                // 【重构】不再强制改写玩家坐标为 0,0。
                // 保留玩家作为普通实体的自然跃迁状态，使其在重启后走通用的星门吐出物理分配
                const pShip = pd.ownedShips.find(s => s.id === pd.playerShipId);
                if (pShip) {
                    pShip.location = { sector: playerMacroShip.location.sector };
                }
                PlayerManager.saveStats(pd);

                const ws = WorldbookManager.getWorldState();
                WorldbookManager.saveWorldState(ws);
                
                localStorage.setItem('current_sector', playerMacroShip.location.sector);
                localStorage.setItem('arrived_from_gate', playerMacroShip.transitFromGate || '未知'); 
                
                localStorage.removeItem('player_radar_x');
                localStorage.removeItem('player_radar_y');
                
                // 【终极重载大招】：重启场景以初始化新星区的物理引擎
                ShipManager.save();
                this.scene.restart();
                return;
            } else {
                // [强制后备兜底] 如果因为某些奇葩原因状态被锁定为 WARP 且卡死超过阈值进度，强制解脱
                if (playerMacroShip.travelProgress >= 1) {
                    console.warn(`[系统警告] 侦测到玩家在星图进度已满却未能切换状态，启动物理熔断...`);
                    playerMacroShip.state = 'IDLE'; 
                    // 这里会交由下一帧的上述正常判定块进行完美降落
                }
            }
        }

        // 宏观星图渲染
        const container = document.getElementById('starmap-react-container');
        
        if (container) {
            StarmapRenderer.updateConvoys(container, ShipManager.ships, (ship) => {
                alert(`⚠️ 目标 [${ship.name}] 已锁定！\n请通过终端对话下达拦截指令，或静观其变。`);
            });
            
            // 绘制玩家自己的跃迁轨迹点
            if (this.isJumping && playerMacroShip && playerMacroShip.state === 'WARP') {
                this.drawPlayerOnStarmap(container, playerMacroShip);
            } else {
                const dot = container.querySelector('#player-warp-dot');
                if (dot) dot.remove();
            }
        }

        // 始终更新微观物理雷达。
        // 即便玩家在跃迁期间看大地图，原星区的物理演算也不能停滞，必须在后台继续运转。
        this.updateSystemRadar(time, delta);

        // --- 实时刷新舰队指挥面板的血量监控 ---
        if (true) { // 持续广播数据供 React 消费
            // 获取最新的玩家数据（包含舰队编制）
            const pd = PlayerManager.getStats();
            let currentRealSector = localStorage.getItem('current_sector');
            
            // [重构] 从真实的物理星区模拟数据中读取玩家状态
            const realSim = this.sectorSimulations[currentRealSector];
            if (realSim) {
                // 1. 同步旗舰 (玩家)
                if (realSim.player && pd.playerShipId) {
                    const pShip = pd.ownedShips.find(s => String(s.id) === String(pd.playerShipId));
                    if (pShip) {
                        pShip.hp = realSim.player.hp;
                        if (!pShip.location) pShip.location = {};
                        pShip.location.sector = currentRealSector;
                    }
                }
                // 2. 同步僚机 (Defenders)
                if (realSim.defenders) {
                    realSim.defenders.forEach(def => {
                        const dShip = pd.ownedShips.find(s => String(s.id) === String(def.id));
                        if (dShip) {
                            dShip.hp = def.hp;
                            if (def.shipRef && def.shipRef.location) {
                                if (!dShip.location) dShip.location = {};
                                dShip.location.sector = def.shipRef.location.sector;
                            }
                        }
                    });
                }
            } else if (pd.playerShipId && this.radarEntities) {
                // 降级兼容：如果 sectorSimulations 尚未初始化完全，回退到 radarEntities
                const pShip = pd.ownedShips.find(s => String(s.id) === String(pd.playerShipId));
                const rp = [...(this.radarEntities.defenders || []), ...(this.radarEntities.attackers || [])].find(e => String(e.id) === String(pd.playerShipId));
                if (pShip && rp) {
                    pShip.hp = rp.hp;
                    if (!pShip.location) pShip.location = {};
                    pShip.location.sector = currentRealSector;
                }
            }
            
            // 3. 全局兜底同步（包含其他星区的僚机或离线商船位置）
              if (pd.ownedShips) {
                  pd.ownedShips.forEach(os => {
                      const mShip = ShipManager.getShipById(os.id);
                      if (mShip && mShip.location) {
                          if (!os.location) os.location = {};
                          os.location.sector = mShip.location.sector;
                          os.location.x = mShip.location.x; // [修复] 补上跨星区持久化坐标
                          os.location.y = mShip.location.y;
                      }
                  });
              }

            // 调用 UI 的轻量化增量更新
            EventBus.dispatchEvent(new CustomEvent(GameEvents.UPDATE_FLEET_DATA, { detail: pd }));
        }
    }

    drawPlayerOnStarmap(container, macroShip) {
        const nodesDiv = container.querySelector('#sm-nodes');
        if (!nodesDiv || !macroShip || !macroShip.currentLane) return;

        const worldState = WorldbookManager.getWorldState();
        const fromSector = worldState.sectors.find(s => s.name === macroShip.currentLane.from);
        const toSector = worldState.sectors.find(s => s.name === macroShip.currentLane.to);
        
        if (!fromSector || !toSector) return;

        const cx = fromSector.x + (toSector.x - fromSector.x) * macroShip.travelProgress;
        const cy = fromSector.y + (toSector.y - fromSector.y) * macroShip.travelProgress;

        let dot = container.querySelector('#player-warp-dot');
        if (!dot) {
            dot = document.createElement('div');
            dot.id = 'player-warp-dot';
            dot.style.cssText = `position: absolute; width: 0; height: 0; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 12px solid #ffffff; transform: translate(-50%, -50%); z-index: 100; pointer-events: none; filter: drop-shadow(0 0 8px #ffffff) drop-shadow(0 0 15px #00ffff);`;
            nodesDiv.appendChild(dot);
        }
        dot.style.left = `${cx}px`;
        dot.style.top = `${cy}px`;
        
        const dx = toSector.x - fromSector.x;
        const dy = toSector.y - fromSector.y;
        dot.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
    }

    updateSystemRadar(time, delta) {
        updateSystemRadar(this, time, delta);
    }

    createExplosion(layer, x, y) {
        createExplosion(this, layer, x, y);
    }

    createImplosion(layer, x, y) {
        createImplosion(this, layer, x, y);
    }

    // [大一统] 通用星门跃迁检测函数
    // 只要物理上撞进星门，就无条件触发跃迁逻辑
    tryEnterStargate(entity, isPlayer, dummyLayer) {
        // [Fix] 直接从当前的仿真上下文中提取准确的星门数据
        const gatesToCheck = this.radarEntities ? this.radarEntities.gates : null;
        if (!gatesToCheck) {
            if (isPlayer) console.warn(`[Jump Debug] 实体 ${entity.id} 所在星区没有 gates 数据，可能是存档问题导致没有生成连线！`);
            return false;
        }

        for (const [gateName, gatePos] of Object.entries(gatesToCheck)) {
            const dist = Math.hypot(entity.x - gatePos.x, entity.y - gatePos.y);
            
            // 判定阈值：玩家宽容度高一点(800)，AI精准一点(500)
            // 考虑到星门可能比以前更远，增加一点判定阈值，防止飞船“滑过”星门
            const threshold = isPlayer ? 1000 : 800; 
            
            if (dist < threshold) {
                // --- 触发跃迁 ---
                console.log(`[Jump Debug] 实体 ${entity.id} (isPlayer=${isPlayer}) 撞到了星门: ${gateName}，距离: ${Math.round(dist)}`);
                
                // 1. 播放吸入特效
                this.createImplosion(null, entity.x, entity.y);
                
                // 2. 处理逻辑状态
                if (isPlayer) {
                    this.isJumping = true;
                    this.playerCursors.left.reset();
                    this.playerCursors.right.reset();
                    this.playerCursors.up.reset();
                    this.playerCursors.down.reset();
                    
                    EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:#00ffff; font-style:italic; border-left:3px solid #00ffff; padding-left:10px; margin-top:10px;">[系统] 跃迁引擎启动... 正在穿越折跃门。<br>目标星区：<b>${gateName}</b></div>` }));
                    
                    const pd = PlayerManager.getStats();
                    const macroShip = ShipManager.getShipById(pd.playerShipId);
                    if (macroShip) {
                        const worldState = WorldbookManager.getWorldState();
                        macroShip.path = [gateName];
                        macroShip.state = 'DEPARTURE';
                        macroShip.targetGate = gateName;
                        
                        triggerWarp(macroShip, gateName, worldState);
                    } else {
                        console.error(`[Jump Error] 严重错误：无法在宏观宇宙中找到玩家的飞船实体！\n寻找的目标 playerShipId: ${pd.playerShipId}\n当前宇宙中所有存在的飞船 ID:`, window.ShipManager ? window.ShipManager.ships.map(s => s.id) : "ShipManager undefined");
                        this.isJumping = false; // 释放锁，防止卡死
                        alert("系统出现内部状态错误：宏观星图丢失了你的飞船数据，跃迁引擎保护性中止。\n请按 F12 截图发给开发人员。");
                        return false;
                    }
                    
                    // [解耦] 旗舰跃迁逻辑：只带走真正编属于玩家当前舰队的僚机
                    const myFleet = ShipManager.getFleetByShipId(pd.playerShipId);
                    if (myFleet && myFleet.flagshipId === pd.playerShipId) {
                        if (this.radarEntities.defenders) {
                            this.radarEntities.defenders.forEach(def => {
                                if (myFleet.members.includes(def.id) && def.shipRef) {
                                    def.shipRef.state = 'DEPARTURE';
                                    def.shipRef.targetGate = gateName;
                                    def.shipRef.transitToGate = gateName;
                                    def.shipRef.path = [gateName];
                                    def.shipRef.commandState = null;
                                    def.moveTarget = null;
                                    def.target = null;
                                }
                            });
                        }
                    }
                    
                    return true;
                } else {
                    // AI 逻辑
                    if (entity.shipRef) {
                        const worldState = WorldbookManager.getWorldState();
                        let shouldWarp = false;

                        // 区分情况：如果是正在正常寻路的商船/AI，只有撞到它原本的目标门才允许跃迁
                        if (entity.shipRef.state === 'DEPARTURE' && entity.shipRef.targetGate === gateName) {
                            triggerWarp(entity.shipRef, gateName, worldState);
                            shouldWarp = true;
                        } else if (entity.shipRef.state === 'TRANSIT' && entity.shipRef.transitToGate === gateName) {
                            triggerWarp(entity.shipRef, gateName, worldState);
                            shouldWarp = true;
                        } else if (entity.isWingman || entity.shipRef.commandState === 'MOVE_TO') {
                            // 对于被玩家强制下令撞门的僚机，强行覆盖其航线
                            entity.shipRef.state = 'DEPARTURE';
                            entity.shipRef.targetGate = gateName;
                            entity.shipRef.transitToGate = gateName;
                            entity.shipRef.path = [gateName]; 
                            entity.shipRef.commandState = null;
                            entity.moveTarget = null;
                            triggerWarp(entity.shipRef, gateName, worldState);
                            shouldWarp = true;
                        }

                        // 只要状态变了 WARP，就成功
                        if (shouldWarp) {
                            entity.shipRef.state = 'WARP'; // 强行在此处统一状态，防止等待异步 import 时丢失状态
                            entity.isWarping = true; // 标记安全离场
                            
                            // [解耦] 通用旗舰跃迁逻辑：带走属于自己舰队的僚机
                            const myFleet = ShipManager.getFleetByShipId(entity.id);
                            if (myFleet && myFleet.flagshipId === entity.id) {
                                if (this.radarEntities.defenders) {
                                    this.radarEntities.defenders.forEach(def => {
                                        if (myFleet.members.includes(def.id) && def.shipRef) {
                                            def.shipRef.state = 'DEPARTURE';
                                            def.shipRef.targetGate = gateName;
                                            def.shipRef.transitToGate = gateName;
                                            def.shipRef.path = [gateName];
                                            def.shipRef.commandState = null;
                                            def.moveTarget = null;
                                            def.target = null;
                                        }
                                    });
                                }
                            }

                            if (entity.isWingman && entity.ownerId === 'player') {
                                EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:#00ffaa;">[舰队] 僚机 ${entity.shipRef.name || 'Unknown'} 确认进入折跃门，前往 [${gateName}]。</div>` }));
                            }
                            return true; // 指示外部移除实体
                        }
                    }
                }
            }
        }
        return false;
    }

    createGateExitEffect(layer, x, y, angle) {
        createGateExitEffect(this, layer, x, y, angle);
    }

    showRTSFeedback(layer, x, y, color, text) {
        showRTSFeedback(this, layer, x, y, color, text);
    }

    createLaserBeam(layer, x1, y1, x2, y2, color, thickness = 2) {
        createLaserBeam(this, layer, x1, y1, x2, y2, color, thickness);
    }

    handleWorldTick() {
        const worldHasChanged = WorldbookManager.tickWorld();
        
        let currentSectorName = localStorage.getItem('current_sector');

        // --- 全宇宙建筑模块建造队列调度（彻底打破主角中心论） ---
        const ws = WorldbookManager.getWorldState();
        
        // 获取所有活跃星区（包括物理星区和远程观测星区）
        const viewingSector = this.viewingSector || currentSectorName;
        const allShipSectors = new Set<string>();
        ShipManager.ships.forEach(s => {
            if (s.location && s.location.sector) allShipSectors.add(s.location.sector);
        });
        const activeSectors = Array.from(allShipSectors);
        if (currentSectorName && !activeSectors.includes(currentSectorName)) activeSectors.push(currentSectorName);
        if (viewingSector && !activeSectors.includes(viewingSector)) activeSectors.push(viewingSector);

        let globalNeedsSave = false;

        if (ws && ws.stations) {
            // 对所有活跃星区分别调用剥离出来的宏观建筑与无人机调度逻辑
            activeSectors.forEach(sectorName => {
                const needsSave = processMacroBuildingQueue(ws, sectorName);
                if (needsSave) globalNeedsSave = true;
            });
            
            // 只要有一个空间站的队伍出列了，就需要保存整个世界的队伍状态
            if (globalNeedsSave) {
                WorldbookManager.saveWorldState(ws);
            }
        }
        
        // --- 停泊系统 4.0: 港务局后台调度 ---
        activeSectors.forEach(sectorName => {
            processMacroDockingQueue(sectorName);
        });

        if (worldHasChanged) {
            const ecoModal = this.contentDOM?.node?.querySelector('#modal-economy');
            
            if (ecoModal && ecoModal.style.display !== 'none') {
                this.updateEconomyMonitor(this.contentDOM);
            }
            
            const container = document.getElementById('starmap-react-container');
            if (container && container.children.length > 0) {
                StarmapRenderer.updateMacroState(container, WorldbookManager.getWorldState(), this.viewingSector);
            }
        }
    }

    getTopBarText() {
        return GameConfig.texts.base.topBar(this.playerData.credits);
    }

    // --- 经济大盘数据计算与渲染 ---
    updateEconomyMonitor() {}

    // --- 业务逻辑 ---

    renderStarMap() {}

    // 切换雷达监视画面
    switchRadarView(sectorName) {
        this.viewingSector = sectorName;
        // 重新初始化静态背景
        if (this.contentDOM) {
            this.initSystemRadarStatic(this.contentDOM);
        }
    }

    // 新增：初始化全景雷达的静态 DOM 结构
    initSystemRadarStatic() {}

    renderSectorView() {}

    bindEvents() {}

    handleNavClick(contentDOM, targetId) {
        const overlay = contentDOM?.node?.querySelector('#modals-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            contentDOM?.node?.querySelectorAll('.modal-panel').forEach(p => p.style.display = 'none');
            const modal = contentDOM?.node?.querySelector(`#modal-${targetId}`);
            if (modal) {
                modal.style.display = 'flex';
                if (targetId === 'starmap') this.renderStarMap(contentDOM);
                // targetId === 'system' 已废弃，因为雷达已经是底层主界面
            }
        }
    }

    // --- LLM 交互逻辑 ---

    async initChatContext(terminalDOM: any) {
        const { initChatContext } = await import('./base/Base-LLM.js');
        await initChatContext(this, terminalDOM);
    }

    executePlayerMove(terminalDOM: any, newPoiId: string, newPoiName: string) {
        import('./base/Base-LLM.js').then(module => module.executePlayerMove(this, terminalDOM, newPoiId, newPoiName));
    }

    async handlePlayerAction(terminalDOM: any, text: string) {
        const { handlePlayerAction } = await import('./base/Base-LLM.js');
        await handlePlayerAction(this, terminalDOM, text);
    }

    async performLLMRequest(terminalDOM: any, userText: string) {
        const { performLLMRequest } = await import('./base/Base-LLM.js');
        await performLLMRequest(this, terminalDOM, userText);
    }

    executeCommands(commands: string[], terminalDOM: any) {
        import('./base/Base-LLM.js').then(module => module.executeCommands(this, commands, terminalDOM));
    }

    saveHistory() {
        import('./base/Base-LLM.js').then(module => module.saveHistory(this));
    }
}
