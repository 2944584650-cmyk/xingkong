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
                if (detail.targetShip.shipRef) {
                    console.log("宏观对象(shipRef):", detail.targetShip.shipRef);
                    console.log("挂载的武器(activeWeapons):", detail.targetShip.shipRef.activeWeapons);
                } else {
                    console.warn("注意：该实体没有绑定 shipRef，将无法开火或被保存！");
                }

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
        this.systemMapOrbitTime += delta * 0.000015; 
        const dt = Math.min(delta / 1000, 0.1);

        // 删除了对旧系统 DOM container 的依赖，允许在 React 重构后也能驱动核心物理循环
        // 获取视角状态
        let currentRealSector = localStorage.getItem('current_sector');
        const viewingSector = this.viewingSector || currentRealSector;

        // --- 多星区并行仿真调度 ---
        const activeSectors = [currentRealSector];
        if (viewingSector !== currentRealSector) activeSectors.push(viewingSector);
        
        // 1. 告知 ShipManager
        ShipManager.setActiveSectors(activeSectors);

        // 2. 清理
        Object.keys(this.sectorSimulations).forEach(sec => {
            if (!activeSectors.includes(sec)) delete this.sectorSimulations[sec];
        });

        // 3. 遍历活跃星区
        activeSectors.forEach(simSectorName => {
            const currentSectorPd = PlayerManager.getStats();
            const isRendering = (simSectorName === viewingSector);
            const isLocal = (simSectorName === currentRealSector);
            
            // 初始化仿真数据
            if (!this.sectorSimulations[simSectorName]) {
                this.sectorSimulations[simSectorName] = { 
                    defenders: [], attackers: [], projectiles: [], missiles: []
                };
            }
            
            // 上下文切换
            this.radarEntities = this.sectorSimulations[simSectorName];

        // 伪装变量以便复用旧逻辑
        const targetSectorName = simSectorName;
        // isRemote 在物理层面上不再重要，因为我们只在 activeSectors 里跑
        // 但为了兼容旧代码的渲染判断（虽然我们会用 isRendering 覆盖它）
        const isRemote = !isLocal; 

        const worldState = WorldbookManager.getWorldState();
        const sector = worldState.sectors.find(s => s.name === simSectorName); 
        if (!sector) return;
        
        // --- 初始化小行星 ---
        initAsteroidsForSector(simSectorName, worldState, this.sectorSimulations);

        // [新增修复] 将保存在 WorldState 里的空间站数据灌入当前的 BuildingManager
        // 关键点：BuildingManager.stationModules 是全局单例，如果我们当前在计算一个后台星区（isRendering = false）
        // 那我们绝不能把后台星区的空间站塞进内存！只应该在渲染主星区时进行赋值！
        if (isRendering) {
            BuildingManager.loadFromWorldState(worldState, simSectorName);
        }

        // [重构：完全同步、绝对无状态污染的星门计算]
        // 动态计算当前活跃星区的所有星门物理位置
        const simGates = {};
        const lanes = WorldbookManager.getStarlanes(worldState.sectors);
        lanes.forEach(l => {
            let adj = null;
            if (l.s1.name === sector.name) adj = l.s2;
            else if (l.s2.name === sector.name) adj = l.s1;
            if (adj) {
                // 确保新坐标系下星门生成的缩放是正确的
                // 如果需要改变星图坐标到星系坐标的映射系数，可以在这里调整
                const angle = Math.atan2(adj.y - sector.y, adj.x - sector.x);
                simGates[adj.name] = { 
                    x: 500 + Math.cos(angle) * 45000, 
                    y: 275 + Math.sin(angle) * 45000,
                    angle: angle
                };
            }
        });
        
        // 将星门数据存入仿真容器，供当前循环其他逻辑取用
        this.sectorSimulations[simSectorName].gates = simGates;

        // 获取真实的玩家微观实体，用作后续操作的基准
        const realPlayerEntForFrame = [...(this.radarEntities.defenders || []), ...(this.radarEntities.attackers || [])].find(e => e.id === currentSectorPd.playerShipId);

        // 视角平移逻辑 (仅渲染时生效)
        if (isRendering) {
            if (isRemote) {
                this.radarPanX = 500;
                this.radarPanY = 275;
            } else {
                if (realPlayerEntForFrame) {
                    this.radarPanX = realPlayerEntForFrame.x;
                    this.radarPanY = realPlayerEntForFrame.y;
                }
            }
        }

        // 应用拖拽和缩放 (仅渲染时)
        // 旧的 DOM wrapper 已弃用，缩放与平移在 RadarScene.syncCamera 中通过 Phaser Camera 原生处理
        
        // 动态更新天体位置（遗留清理：目前所有目标统一指向星区中心）
        const cx = 500;
        const cy = 275;
        
        let defenseX = cx; 
        let defenseY = cy;
        let planetX = cx;
        let planetY = cy;

        let activeNodes = [];

        // 读取导航目标，确保微观层能够动态刷新星门颜色
        let navTarget = localStorage.getItem('nav_target_sector');
        let nextStepName = null;
        
        // 获取玩家真正的实体（不再是特权对象，而是从防卫者/攻击者中找）
        const realPlayerEnt = realPlayerEntForFrame;

        // 1. 如果玩家实体的船有明确的 targetGate (最高优先级)
        if (realPlayerEnt && realPlayerEnt.shipRef && realPlayerEnt.shipRef.targetGate) {
            nextStepName = realPlayerEnt.shipRef.targetGate;
        } 
        // 2. 如果玩家飞船没数据，但是存了 nav_target_sector，则重新算一次路
        else if (navTarget && navTarget !== currentRealSector) {
            const endNode = worldState.sectors.find(s => s.name === navTarget);
            if (endNode) {
                const path = WorldbookManager.getStarlanePath(sector, endNode, worldState.sectors);
                if (path && path.length > 1) {
                    nextStepName = path[1].name;
                }
            }
        }
        
        // 如果已经抵达了目标星区，清理导航状态
        if (navTarget === currentRealSector) {
            localStorage.removeItem('nav_target_sector');
            localStorage.removeItem('nav_path');
            nextStepName = null;
            if (realPlayerEnt && realPlayerEnt.shipRef && realPlayerEnt.shipRef.state === 'DEPARTURE') {
                realPlayerEnt.shipRef.state = 'IDLE';
                realPlayerEnt.shipRef.targetGate = null;
                realPlayerEnt.shipRef.path = [];
            }
        }

        let activeGates = [];
        for (const [gateName, gatePos] of Object.entries(simGates)) {
            activeGates.push({
                name: gateName,
                x: gatePos.x,
                y: gatePos.y,
                isNavTarget: gateName === nextStepName
            });
        }

        this.sectorSimulations[simSectorName].nodes = activeNodes;
        this.sectorSimulations[simSectorName].gatesArray = activeGates;

        // 确定造船地点：统一使用行星坐标或预设坐标
        let constructionX = planetX;
        let constructionY = planetY;

        // ----------------------------------------------------
        // 核心：处理 RTS 实体逻辑 (AI、寻路、战斗)
        // ----------------------------------------------------
        
        // [重构] 彻底移除原 this.radarEntities.player 的虚拟 shipRef 生成逻辑，因为玩家实体现在完全由宏观 ShipManager 提供数据同步

        // 播放延迟的星门特效 (Phaser 层面直接渲染，无需依赖 DOM)
        if (this.pendingArrivalEffect) {
            this.createGateExitEffect(null, this.pendingArrivalEffect.x, this.pendingArrivalEffect.y, this.pendingArrivalEffect.angle);
            this.pendingArrivalEffect = null;
        }

        // ==========================================
        // 【第一阶段：活跃星区物理与AI后台演算】
        // 依次对玩家所在星区以及正在监视的异地星区执行物理演算
        // ==========================================
        const localShips = ShipManager.getShipsInSector(simSectorName);
        
        const newAttackers = [];
        const newDefenders = [];
        
        // --- 核心修复：追踪已处理的船只 ID，杜绝重复创建 ---
        const processedShipIds = new Set();
        
        localShips.forEach(ship => {
            if (ship.stats.hp <= 0 && !ship.isBuilding) return; // 忽略已死亡但尚未被 ShipManager 清理的飞船，防止诈尸

            // [核心防御] 防止幽灵船：跳过正在跃迁状态异常的船，防止它们强行挤进物理层
            // 注意：移除了 ship.dockedAt 的拦截，允许已停泊的飞船继续进入微观渲染层显示在泊位上
            if (ship.state === 'WARP') return;

            // [终极防御] 拦截同一个宏观实体因为某种原因被 forEach 塞两次
            if (processedShipIds.has(String(ship.id))) return;
            processedShipIds.add(String(ship.id));

            // [重构核心：众生平等]
            // 彻底删除针对玩家实体的拦截。玩家的飞船同样会被正常分配为一个普通的微观实体，存放在 attackers/defenders 数组中。
            // 只是如果 String(ship.id) === String(pd.playerShipId)，稍后在 updateShipEntity 内部它会受到鼠标键盘控制。

            // [重构] 统合判定：无论是玩家资产还是NPC，只要它被明确编入了舰队，或是玩家的私有资产，才算作可执行编队战术的单位
            let isActiveWingman = false;
            const fleet = ShipManager.getFleetByShipId(ship.id);
            if (fleet || ship.ownerId === 'player') {
                isActiveWingman = true;
            }

            // 将宏观 Ship 数据映射到微观雷达实体
            let entity = this.radarEntities.attackers.find(e => e.id === ship.id) || 
                         this.radarEntities.defenders.find(e => e.id === ship.id);
            
            if (!entity) {
                // 首次生成微观实体
                if (ship.isBuilding) {
                    // console.log(`[微观引擎] 侦测到正在建造中的宏观船只，准备为其生成微观虚影实体: ${ship.id}, 位置:`, ship.location);
                }
                
                let spawnX = ship.location.x;
                let spawnY = ship.location.y;

                // 如果没有微观坐标（或者为初始值 0,0），为其分配初始出生点
                let initVx = 0;
                let initVy = 0;

                if (!spawnX && !spawnY) {
                    // [重构] 统合处理：所有刚到达本星区的飞船（无论玩家还是AI），都应从入口星门出生
                    // 由于玩家由于重启场景可能变成了 IDLE 丢失状态，但我们可以通过 localStorage 判断是不是刚过门
                    const arrivedFromGate = localStorage.getItem('arrived_from_gate');
                    const isPlayerJustArrived = (ship.ownerId === 'player' && ship.id === currentSectorPd.playerShipId && arrivedFromGate && simGates[arrivedFromGate]);

                    if (ship.state === 'ARRIVAL' || ship.state === 'TRANSIT' || isPlayerJustArrived) {
                        console.log(`[Jump Debug] 实体生成 - 飞船 ${ship.name} (ID:${ship.id}) 触发星门出生点分配机制。当前状态: ${ship.state}, 携带小票: ${isPlayerJustArrived ? arrivedFromGate : '无'}`);
                        const targetGateStr = isPlayerJustArrived ? arrivedFromGate : ship.transitFromGate;
                        
                        if (simGates[targetGateStr]) {
                            const gate = simGates[targetGateStr];
                            spawnX = gate.x;
                            spawnY = gate.y;
                            
                            // [星门吐出物理] 赋予指向星系中心的初速度，模拟从虫洞喷射而出
                            const angleToCenter = Math.atan2(275 - spawnY, 500 - spawnX);
                            
                            // [修复] 向中心推进 1500 像素，防止立刻再次触碰星门触发死循环跃迁
                            spawnX += Math.cos(angleToCenter) * 1500;
                            spawnY += Math.sin(angleToCenter) * 1500;

                            initVx = Math.cos(angleToCenter) * 1000;
                            initVy = Math.sin(angleToCenter) * 1000;
                            
                            // 针对玩家特别调整初始视角，并在事后清理缓存
                            if (isPlayerJustArrived) {
                                ship.rotation = angleToCenter * 180 / Math.PI;
                                this.pendingArrivalEffect = { x: gate.x, y: gate.y, angle: angleToCenter };
                                // 清理标记防止下一次重新分配
                                localStorage.removeItem('arrived_from_gate');
                                // 马上存入雷达坐标，接管后续物理引擎的持久化
                                localStorage.setItem('player_radar_x', spawnX.toString());
                                localStorage.setItem('player_radar_y', spawnY.toString());
                            } else {
                                this.createGateExitEffect(null, spawnX, spawnY, angleToCenter);
                            }
                        }
                    } else {
                        // 真的没有坐标的本地船：随机出生点
                        spawnX = ship.type === 'freighter' ? planetX : defenseX;
                        spawnY = ship.type === 'freighter' ? planetY : defenseY;
                        spawnX += (Math.random() - 0.5) * 150;
                        spawnY += (Math.random() - 0.5) * 150;
                    }
                }

                entity = {
                    id: ship.id,
                    type: ship.type,
                    factionId: ship.factionId,
                    ownerId: ship.ownerId !== undefined ? ship.ownerId : ship.factionId,
                    parentId: ship.parentId, // [修复] 将宏观记录的母体ID传递给微观引擎，防止无人机被判定为幽灵
                    x: spawnX, 
                    y: spawnY,
                    vx: initVx, vy: initVy, rotation: ship.rotation !== undefined ? ship.rotation : 0,
                    hp: ship.stats.hp,
                    maxHp: ship.stats.maxHp,
                    color: '#33ccff', // 默认蓝色
                    target: null,
                    cooldown: 0,
                    orbitDir: Math.random() > 0.5 ? 1 : -1,
                    patrolPhase: Math.random() * Math.PI * 2,
                    hitFlash: 0,
                    behavior: (ship.type === 'freighter' && !isActiveWingman) ? 'DOCKING' : 'COMBAT',
                    isWingman: isActiveWingman,
                    superCruiseTimer: 0, 
                    isSuperCruising: false,
                    shipRef: ship // 绑定回宏观对象
                };
            }
            
            // 实时同步状态
            if (isActiveWingman) {
                entity.isWingman = true;
            }
            
            // [重构] 纯粹通过对玩家的好感度决定其在微观雷达上的颜色与攻击意图：
            // 好感度 < 0 为红色敌人（放入 attackers）
            // 好感度 >= 0 为蓝色友军/中立（放入 defenders）
            let isHostile = false;
            
            // [重构] 因为玩家可能是一个普通的 entity 混在数组里，我们在组装阶段不再直接依赖 this.radarEntities.player
            // 先尝试从现有的 entity 池中找出玩家，或者如果玩家不在场就用兜底逻辑
            let localPlayerEnt = null;
            if (currentSectorPd.playerShipId) {
                localPlayerEnt = this.radarEntities.defenders.find(e => String(e.id) === String(currentSectorPd.playerShipId)) ||
                                 this.radarEntities.attackers.find(e => String(e.id) === String(currentSectorPd.playerShipId));
            }

            if (localPlayerEnt && String(entity.id) !== String(currentSectorPd.playerShipId)) {
                if (getAffinity(entity, localPlayerEnt) < 0) {
                    isHostile = true;
                }
            } else {
                // 如果是玩家自己，或者是玩家不在场的异地模拟，根据阵营判定
                if (String(entity.id) === String(currentSectorPd.playerShipId)) {
                    isHostile = false; // 玩家永远是自己眼里的防卫者(蓝名)
                } else {
                    const shipOwnerId = ship.ownerId !== undefined ? ship.ownerId : ship.factionId;
                    if (shipOwnerId === 3) {
                        isHostile = true; // 海盗
                    } else if (ship.type !== 'freighter' && shipOwnerId !== 0 && shipOwnerId !== 'player' && shipOwnerId !== sector.factionId) {
                        isHostile = true; // 跨界战机
                    }
                }
            }
            
            // 【最核心】：将颜色强制指定为红/蓝二元
            entity.color = isHostile ? '#ff3333' : '#33ccff';
            
            if (isHostile) {
                newAttackers.push(entity);
            } else {
                newDefenders.push(entity);
            }
        });
        
        // 替换为新帧的列表，保留了已有实体的引用，自动清理了跃迁离开或被彻底摧毁的实体
        // [修复] 在这里强制过滤掉可能混入的 null、undefined 或者重复引用的死对象
        this.radarEntities.attackers = [...new Map(newAttackers.filter(e => e && e.id).map(e => [e.id, e])).values()];
        this.radarEntities.defenders = [...new Map(newDefenders.filter(e => e && e.id).map(e => [e.id, e])).values()];

        // --- 0. 玩家星门检测逻辑 ---
        if (realPlayerEnt) {
            // [重构] 使用通用星门检测函数
            if (!this.isJumping) {
                this.tryEnterStargate(realPlayerEnt, true, null);
            }
        }

        // 收集要传递给渲染层的高级指挥线数据
        const renderCommandLines = [];
        
        // 临时保存在当前循环外层的变量，以便在下面的 [收尾] 阶段使用
        if (!this._tempCommandLines) this._tempCommandLines = [];

        // 2. 实体物理与 AI 更新循环
        const allFighters = [...this.radarEntities.defenders, ...this.radarEntities.attackers];

        // 工具函数：基于动态好感度公式的真实阵营索敌
        const findTarget = (entity, allShipsList) => {
            let closest = null;
            let minDist = Infinity;
            
            allShipsList.forEach(other => {
                if (other.hp > 0 && other.id !== entity.id) {
                    // 统一使用全局好感度公式，动态读取 A 对 B 的记忆
                    const aff = getAffinity(entity, other);
                    
                    // 判断是否为敌人
                    let isEnemy = false;
                    
                    if (other.type === 'freighter') {
                        // 对方是商船：海盗默认 -50，直接开火。普通人默认 +50，受击十次 (-100) 才会变 -50 开火
                        if (aff <= -50) isEnemy = true;
                    } else {
                        // 对方是战机/玩家：只要关系为负 (<0) 就会主动开火
                        if (aff < 0) isEnemy = true;
                    }
                    
                    if (isEnemy) {
                        const d = Math.hypot(other.x - entity.x, other.y - entity.y);
                        // 优先打近的
                        if (d < minDist) { 
                            minDist = d; 
                            closest = other; 
                        }
                    }
                }
            });
            return closest;
        };

        // ==========================================
        // 【核心大一统】：统一的实体物理与开火演算函数
        // ==========================================
        const updateShipEntity = (ent, allShipsList) => {
            const pd = PlayerManager.getStats();
            // [核心修复] 底层区块同步防误杀机制：防止坐标异常或星区错位导致无辜舰船被强制销毁
            // 严格排除玩家母舰，并确保 location.sector 存在时才进行跨区比对
            if (isNaN(ent.x) || isNaN(ent.y) || (ent.id !== pd.playerShipId && ent.shipRef && ent.shipRef.location && ent.shipRef.location.sector && ent.shipRef.location.sector !== simSectorName)) {
                ent.isSafeRemoved = true; // 赋予绝对安全脱离标识
                return false; // 中断物理演算，交由外层静默回收
            }

            // [新增] 无人机存活检查：必须有 parentId，且父实体必须存活于当前星区，否则2秒后自毁
            if (ent.type === 'drone') {
                if (!checkDroneSurvival(ent, allShipsList)) {
                    if (ent.droneDieTimer === undefined) {
                        ent.droneDieTimer = 2.0;
                    }
                    ent.droneDieTimer -= dt;
                    if (ent.droneDieTimer <= 0) {
                        ent.hp = 0;
                        return false;
                    }
                } else {
                    ent.droneDieTimer = undefined;
                }
            }

            // [玩家控制解耦标识]
            const isPlayerControlled = (ent.id === pd.playerShipId || ent.isHijacked);

            // [核心修复] AI 目标校验：防止对着已跃迁离开的“幽灵目标”开火
            if (ent.target) {
                // 检查目标对象是否仍然存在于当前的物理实体列表中
                const isTargetStillHere = allShipsList.some(t => t.id === ent.target.id);
                if (!isTargetStillHere) {
                    ent.target = null; // 目标已不在当前星区（可能跃迁走了），丢失锁定
                }
            }

            // 更新炮塔的默认闲置动画
            if (ent.shipRef && ent.shipRef.activeWeapons) {
                ent.shipRef.activeWeapons.forEach(wep => {
                    if (wep.isTurret) {
                        if (wep.idlePhase === undefined) wep.idlePhase = Math.random() * Math.PI * 2;
                        wep.idlePhase += dt * 1.5;
                        wep.rotation = ent.rotation + Math.sin(wep.idlePhase) * 40;
                    } else {
                        wep.rotation = ent.rotation;
                    }
                });
            }

            let moveTarget = null;
            let lookTarget = null;
            
            // [重构] 获取飞船的真实物理推力与质量
            const thrust = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.thrust) ? ent.shipRef.stats.thrust : 0;
            const turnThrust = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.turnThrust) ? ent.shipRef.stats.turnThrust : 0;
            const mass = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.mass) ? ent.shipRef.stats.mass : (ent.type === 'freighter' ? 80 : 10);
            const drag = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.drag) ? ent.shipRef.stats.drag : 0.15;

            // F = ma -> a = F/m (如果没有引擎，加速度就是0，飞船将无法移动)
            let baseAccel = mass > 0 ? (thrust / mass) : 0;
            let thrustMultiplier = 1.0; // 替代原来的 thrustSpeed 被直接赋值的情况
            
            // 理论基础极速上限计算 (防止退出巡航后保持极高速度滑行)
            // v = a * dt / (1 - drag^dt) 是个粗略极限，我们简化用常数来规范化
            // 常规引擎在 drag 0.98 下大概能跑到 500-1500 左右，这里给出一个动态截断值
            const baseMaxSpeed = Math.max(300, (baseAccel / 2)); 
            
            let targetDx = 0;
            let targetDy = 0;
            
            // 记录当前帧之前是否处于巡航状态
            const wasSuperCruising = ent.isSuperCruising === true;

            if (isPlayerControlled) {
                const isModalsOpen = () => {
                    if (!this.input.keyboard.enabled) return true;
                    const textModal = this.contentDOM?.node?.querySelector('#text-adventure-modal');
                    if (textModal && textModal.style.display !== 'none') return true;
                    const overlay = this.contentDOM?.node?.querySelector('#modals-overlay');
                    if (overlay && overlay.style.display !== 'none') return true;
                    return false;
                };

                const isFlightInputAllowed = () => {
                    if (isModalsOpen()) return false;
                    // [Fix] 进站后不允许玩家鼠标/键盘控制
                    if (ent.isAutoDocking || ent.isDocked || (ent.shipRef && ent.shipRef.state === 'DOCKED')) return false;
                    return true;
                };

                // ------ 玩家的控制器输入与自动驾驶 ------
                if (ent.id === pd.playerShipId && this.playerAutoPilot) {
                    const ap = this.playerAutoPilot;
                    let tx = ap.x;
                    let ty = ap.y;
                    
                    if (this.radarEntities && this.radarEntities.nodes) {
                        const targetNode = this.radarEntities.nodes.find(n => n.id === ap.target);
                        if (targetNode) {
                            tx = targetNode.x;
                            ty = targetNode.y;
                        }
                    }

                    const dx = tx - ent.x;
                    const dy = ty - ent.y;
                    const dist = Math.hypot(dx, dy);
                    
                    if (dist < 150) { 
                        this.playerAutoPilot = null;
                        const pd = PlayerManager.getStats();
                        ShipManager.dockShip(pd.playerShipId, ap.target);
                        ent.isDocked = true; 
                        this.activeSystemNode = ap.target;
                        
                        return false;
                    } else {
                        lookTarget = { x: tx, y: ty };
                        const rad = (ent.rotation || 0) * Math.PI / 180;
                        targetDx = Math.cos(rad);
                        targetDy = Math.sin(rad);
                        ent.isFiring = false;
                    }
                } else if (!isModalsOpen() && (ent.isAutoDocking || ent.isDocked || (ent.shipRef && ent.shipRef.state === 'DOCKED'))) {
                    // --- 长按前进键出库逻辑 ---
                    if (this.playerKeys.w.isDown) {
                        if (ent.undockHoldTimer === undefined) ent.undockHoldTimer = 0;
                        ent.undockHoldTimer += dt;
                        
                        if (ent.undockHoldTimer >= 1.0) {
                            ent.isDocked = false;
                            ent.isAutoDocking = false;
                            if (ent.shipRef) {
                                ent.shipRef.state = 'IDLE';
                                ent.shipRef.dockedAt = null;
                            }
                            ShipManager.undockShip(ent.id, { x: ent.x, y: ent.y, sector: simSectorName });
                            
                            // 给予一个向前的初始速度，模拟引擎弹射出库
                            const rad = (ent.rotation || 0) * Math.PI / 180;
                            ent.vx = Math.cos(rad) * 300;
                            ent.vy = Math.sin(rad) * 300;
                            
                            ent.undockHoldTimer = 0;
                        }
                    } else {
                        ent.undockHoldTimer = 0;
                    }
                } else if (isFlightInputAllowed()) {
                    let moveForward = 0;
                    let moveRight = 0;

                    if (this.playerKeys.w.isDown) moveForward += 1;
                    if (this.playerKeys.s.isDown) moveForward -= 1;
                    if (this.playerKeys.a.isDown) moveRight -= 1;
                    if (this.playerKeys.d.isDown) moveRight += 1;

                    // 仅使用空格键进行开火判定
                    if (this.playerKeys.space.isDown) {
                        ent.isFiring = true;
                    } else {
                        ent.isFiring = false;
                    }

                    // 空间巡航状态重置与打断检测 (移至 Shift 键)
                    if (!this.playerKeys.shift.isDown) {
                        ent.superCruiseTimer = 0;
                        ent.isSuperCruising = false;
                        ent.spaceInterrupted = false;
                    }
                    // 进行其他操作（开火 或 按 S 倒车刹车）则立刻取消巡航
                    if (ent.isFiring || this.playerKeys.s.isDown) {
                        ent.spaceInterrupted = true;
                    }

                    // 冲刺与巡航系统接管
                    if (this.playerKeys.ctrl && this.playerKeys.ctrl.isDown) {
                        // 玩家按住 Ctrl 逐渐降速到0
                        ent.vx *= Math.pow(0.92, dt * 60);
                        ent.vy *= Math.pow(0.92, dt * 60);
                        moveForward = 0;
                        moveRight = 0;
                        this.playerAutoPilot = null;
                        ent.superCruiseTimer = 0;
                        ent.isSuperCruising = false;
                        ent.spaceInterrupted = true;
                    } else if (this.playerKeys.tab.isDown) {
                        // TAB 盾冲：强制一直向前冲，推力直接翻 4 倍
                        thrustMultiplier = 4.0;
                        moveForward = 1;
                        moveRight = 0;
                        this.playerAutoPilot = null;
                    } else if (this.playerKeys.shift.isDown && !ent.spaceInterrupted) {
                        // SHIFT 巡航检测与重置
                        if (ent.superCruiseTimer === undefined) ent.superCruiseTimer = 0;
                        
                        // [新增机制] 如果在巡航充能或飞行期间，机头转向角速度过大（或者偏离了原本正在前进的方向）
                        // 说明玩家正在进行剧烈机动，必须强制中断巡航进入停滞
                        const isTurningHard = this.playerKeys.q.isDown || this.playerKeys.e.isDown || (this.sysMouseX !== 0 && this.sysMouseY !== 0 && ent.isSuperCruising && Math.abs(ent.rotation - (ent.lastCruiseAngle || ent.rotation)) > 20);

                        if (isTurningHard && ent.isSuperCruising) {
                            ent.spaceInterrupted = true;
                            ent.superCruiseTimer = 0;
                            ent.isSuperCruising = false;
                        } else {
                            ent.superCruiseTimer += dt;
                            this.playerAutoPilot = null;

                            if (ent.superCruiseTimer >= 3.0) {
                                // 超过 3 秒后，强制向前冲，并从 3.0 倍起步，每秒增加 1.0 倍推力，直至最高 6.0 倍
                                ent.isSuperCruising = true;
                                ent.lastCruiseAngle = ent.rotation; // 记录巡航时的锁定朝向
                                moveForward = 1;
                                moveRight = 0;
                                thrustMultiplier = Math.min(6.0, 3.0 + (ent.superCruiseTimer - 3.0) * 1.0);
                            } else {
                                // [预热阶段] 原地蓄力，不能移动，但可以缓慢转向
                                moveForward = 0;
                                moveRight = 0;
                                thrustMultiplier = 0.0; 
                            }
                        }
                    }

                    // 真实物理转向速度计算：由引擎转向推力除以质量决定
                    // [新设定] 转向推力需求提升为移动的 3 倍，等效于同样的转向推力提供的角速度减小到 1/3
                    let pTurnRate = mass > 0 ? (turnThrust / mass) / 3 : 0;
                    // 如果船体没装引擎或者转不动，给个极小值防卡死，但如果是0就彻底无法控制
                    if (pTurnRate === 0 && thrust === 0) pTurnRate = 0; // 完全瘫痪
                    else if (pTurnRate < 10) pTurnRate = 10; // 保底微弱转向 (同比例下调)
                    
                    pTurnRate *= 1.2; // 玩家专属灵活性加成

                    // [Fix] 进站后鼠标自动跟随彻底禁用，只能在 isFlightInputAllowed 里拦截了
                    // 为了以防万一，如果处于吸附或停泊状态，彻底跳过转向计算
                    if (!ent.isAutoDocking && !ent.isDocked && !(ent.shipRef && ent.shipRef.state === 'DOCKED')) {
                        if (this.playerKeys.q.isDown) {
                            ent.rotation -= pTurnRate * dt;
                        } else if (this.playerKeys.e.isDown) {
                            ent.rotation += pTurnRate * dt;
                        } else {
                            // 鼠标自动跟随
                            // 摒弃容易出错的手动屏幕比例映射，直接使用 Phaser 底层渲染场景相机的 getWorldPoint 进行绝对精确转换
                            if (this.sysMouseX !== 0 || this.sysMouseY !== 0) {
                                const radarScene = this.scene.get('RadarScene');
                                if (radarScene && radarScene.cameras && radarScene.cameras.main && this.sys.game.canvas) {
                                    // 1. 将系统级窗口鼠标坐标 (sysMouseX/Y) 减去 Canvas 本身的 CSS 偏移，得到 Canvas DOM 内的像素坐标 (clientX/Y)
                                    const rect = this.sys.game.canvas.getBoundingClientRect();
                                    const canvasX = this.sysMouseX - rect.left;
                                    const canvasY = this.sysMouseY - rect.top;

                                    // 2. 检查鼠标是否在 Canvas 范围内 (稍微扩大一点容差也行)，如果在范围内才转换并跟随
                                    // 这样即使因为 DOM 遮挡 Phaser 收不到 pointer 移动，我们依然能完美计算
                                    const worldPoint = radarScene.cameras.main.getWorldPoint(canvasX, canvasY);
                                    
                                    const mouseWorldX = worldPoint.x;
                                    const mouseWorldY = worldPoint.y;

                                    let targetAngle = Math.atan2(mouseWorldY - ent.y, mouseWorldX - ent.x) * 180 / Math.PI;
                                    let angleDiff = targetAngle - ent.rotation;
                                    angleDiff = ((angleDiff + 180) % 360 + 360) % 360 - 180;
                                    
                                    if (Math.abs(angleDiff) < pTurnRate * dt) {
                                        ent.rotation = targetAngle;
                                    } else {
                                        ent.rotation += Math.sign(angleDiff) * pTurnRate * dt;
                                    }
                                }
                            }
                        }
                    }
                    
                    ent.rotation = ((ent.rotation + 180) % 360 + 360) % 360 - 180;

                    if (moveForward !== 0 || moveRight !== 0) {
                        const rad = (ent.rotation || 0) * Math.PI / 180;
                        targetDx = moveForward * Math.cos(rad) + moveRight * Math.cos(rad + Math.PI / 2);
                        targetDy = moveForward * Math.sin(rad) + moveRight * Math.sin(rad + Math.PI / 2);
                        
                        const len = Math.hypot(targetDx, targetDy);
                        if (len > 0) {
                            targetDx /= len;
                            targetDy /= len;
                        }
                        this.playerAutoPilot = null;
                    }
                }

                // 强制边界限制，防止玩家跑出外太空
                ent.x = Math.max(-75000, Math.min(76000, ent.x));
                ent.y = Math.max(-75000, Math.min(76000, ent.y));
            }

            if (!isPlayerControlled) {
                // ------ 调用通用 AI 行为逻辑 ------
                const aiResult = processAILogic(ent, allShipsList, dt, {
                    simGates,
                    simSectorName,
                    planetX,
                    planetY,
                    defenseX,
                    defenseY,
                    baseMaxSpeed,
                    pd,
                    worldState,
                    systemMapOrbitTime: this.systemMapOrbitTime
                });

                if (aiResult.action === 'tryEnterStargate') {
                    if (this.tryEnterStargate(ent, false, null)) return false;
                } else if (aiResult.action === 'dock') {
                    return false;
                }

                moveTarget = aiResult.moveTarget;
                lookTarget = aiResult.lookTarget;
                thrustMultiplier = aiResult.thrustMultiplier;
                targetDx = aiResult.targetDx;
                targetDy = aiResult.targetDy;
            }

            // ==========================================
            // 【停泊吸附判定系统 (通用)】
            // ==========================================
            // checkDockingGuidance 会修改 ent.isDocked 为 true
            checkDockingGuidance(ent);
            
            // 如果处于自动吸附接管状态或已经彻底吸附，则跳过后续的所有玩家输入/AI行为执行，直接结束本实体的物理逻辑刷新
            if (ent.isAutoDocking || ent.isDocked) {
                if (ent.isDocked) {
                    ent.vx = 0;
                    ent.vy = 0;
                }
                // 但保留碰撞体积、渲染和基础位移应用
                ent.x += ent.vx * dt;
                ent.y += ent.vy * dt;
                
                // [更新] 返回 true，告诉外层循环：“我还活着，我要留在场景里，请渲染我！”
                return true; 
            }

            // ==========================================
            // 【指挥线 (Command Line) 数据收集逻辑】
            // ==========================================
            // [新增] 只给玩家拥有的实体（或者玩家舰队里的实体）绘制指挥线，不再给 AI 绘制
            const shouldRenderLine = isPlayerControlled || ent.ownerId === 'player';
            if (ent.shipRef && isRendering && shouldRenderLine) {
                let cmdType = null;
                let cmdTargetNode = null;
                let cmdTargetPos = null;
                let isDashed = false;
                const isSelected = this.selectedUnitIds.includes(ent.id);

                // 1. 如果有明确的攻击指令或正在追击目标
                if (ent.shipRef.commandState === 'ATTACK_TARGET' && ent.shipRef.commandTargetId) {
                    cmdType = 'ATTACK';
                    const enemy = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
                    if (enemy) {
                        cmdTargetPos = { x: enemy.x, y: enemy.y };
                    }
                } 
                else if (ent.shipRef.commandState === 'DEFEND' && ent.shipRef.commandTargetId) {
                    cmdType = 'DEFEND';
                    const guardTarget = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
                    if (guardTarget) {
                        cmdTargetPos = { x: guardTarget.x, y: guardTarget.y };
                    }
                }
                else if (ent.shipRef.commandState === 'FOLLOW' && ent.shipRef.commandTargetId) {
                    cmdType = 'FOLLOW';
                    const followTarget = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
                    if (followTarget) {
                        cmdTargetPos = { x: followTarget.x, y: followTarget.y };
                    }
                }
                else if (ent.shipRef.commandState === 'MOVE_TO' && ent.shipRef.moveTarget) {
                    cmdType = 'MOVE';
                    // 如果跨星系赶路中，目标点可能没到，但这里优先取 moveTarget 作为本星系的最终目标
                    if (ent.shipRef.location.sector === simSectorName) {
                        cmdTargetPos = { x: ent.shipRef.moveTarget.x, y: ent.shipRef.moveTarget.y };
                    }
                }
                else if (ent.shipRef.state === 'DEPARTURE' || ent.shipRef.state === 'TRANSIT') {
                    cmdType = 'MOVE';
                }

                // 2. 计算跨星系的路径映射
                if (cmdType) {
                    let cStartX = ent.x;
                    let cStartY = ent.y;
                    let cEndX = null;
                    let cEndY = null;

                    // 飞船在当前渲染的星区
                    if (ent.shipRef.location.sector === simSectorName) {
                        if (ent.shipRef.state === 'DEPARTURE' || ent.shipRef.state === 'TRANSIT') {
                            // 正在离开或穿过本星区，连线到出口星门
                            const targetGateName = ent.shipRef.state === 'DEPARTURE' ? ent.shipRef.targetGate : ent.shipRef.transitToGate;
                            const gatePos = simGates[targetGateName];
                            if (gatePos) {
                                cEndX = gatePos.x;
                                cEndY = gatePos.y;
                            }
                        } else if (cmdTargetPos) {
                            // 在本星区内的目标
                            cEndX = cmdTargetPos.x;
                            cEndY = cmdTargetPos.y;
                        }
                    } 
                    // 飞船不在当前渲染的星区，但它的路径经过这里
                    else if (ent.shipRef.path && ent.shipRef.path.length > 0) {
                        // 寻找当前星区在它的 path 中的位置
                        const pathIndex = ent.shipRef.path.indexOf(simSectorName);
                        if (pathIndex !== -1 || ent.shipRef.location.sector !== simSectorName) {
                            // 需要找到它从哪个门进来，从哪个门出去
                            
                            // 默认使用它当前的 moveTarget 作为终点兜底（如果已经到站了）
                            if (cmdTargetPos && ent.shipRef.path[ent.shipRef.path.length - 1] === simSectorName) {
                                cEndX = cmdTargetPos.x;
                                cEndY = cmdTargetPos.y;
                            }

                            // 尝试找到它进入本星区的门 (它前一个目标星系的名字，或者是它当前所在的星系)
                            let entryGateName = null;
                            if (pathIndex > 0) {
                                entryGateName = ent.shipRef.path[pathIndex - 1];
                            } else if (pathIndex === 0) {
                                entryGateName = ent.shipRef.location.sector;
                            } else if (ent.shipRef.path.length > 0 && ent.shipRef.targetGate === simSectorName) {
                                // 正在前往本星区
                                entryGateName = ent.shipRef.location.sector;
                            }

                            // 尝试找到它离开本星区的门 (它下一个目标星系)
                            let exitGateName = null;
                            if (pathIndex !== -1 && pathIndex < ent.shipRef.path.length - 1) {
                                exitGateName = ent.shipRef.path[pathIndex + 1];
                            }

                            if (entryGateName && simGates[entryGateName]) {
                                cStartX = simGates[entryGateName].x;
                                cStartY = simGates[entryGateName].y;
                                isDashed = true; // 跨星区投影用虚线
                            }

                            if (exitGateName && simGates[exitGateName]) {
                                cEndX = simGates[exitGateName].x;
                                cEndY = simGates[exitGateName].y;
                                isDashed = true;
                            }
                        }
                    }

                    if (cEndX !== null && cEndY !== null) {
                        renderCommandLines.push({
                            shipId: ent.id,
                            startX: cStartX,
                            startY: cStartY,
                            endX: cEndX,
                            endY: cEndY,
                            type: cmdType,
                            isDashed: isDashed,
                            isSelected: isSelected,
                            colorHex: ent.color
                        });
                    }
                }
            }

            // ==========================================
            // 【多炮塔独立开火重构】：无论玩家还是AI都走这里
            // ==========================================
            if (ent.shipRef && ent.shipRef.activeWeapons && ent.shipRef.activeWeapons.length > 0) {
                ent.shipRef.activeWeapons.forEach(wep => {
                    if (wep.cooldown > 0) wep.cooldown -= dt;
                    
                    const rad = ent.rotation * Math.PI / 180;
                    const wepAbsoluteX = ent.x + (wep.x * Math.cos(rad) - wep.y * Math.sin(rad));
                    const wepAbsoluteY = ent.y + (wep.x * Math.sin(rad) + wep.y * Math.cos(rad));
                    
                    let wepTarget = null;
                    let shouldFire = false;

                    // 1. 根据控制者类型与武器类型决定瞄准与开火意图
                    if (wep.isTurret) {
                        if (isPlayerControlled) {
                            // 玩家炮塔：自律索敌
                            let closest = null;
                            let minDist = wep.stats.range || 250;
                            if (wep.turretRule === 'auto' || !wep.turretRule || wep.turretRule === 'defense' || wep.turretRule === 'manual') {
                                allShipsList.forEach(t => {
                                    if (t.id === ent.id) return;
                                    let valid = false;
                                    
                                    // 建造光束，只能锁定己方存活或正在建造的虚影
                                    if (wep.subType === 'builder') {
                                        if ((t.hp > 0 || (t.shipRef && t.shipRef.isBuilding)) && getAffinity(ent, t) >= 0) {
                                            if (t.shipRef && t.shipRef.isBuilding) valid = true; // 优先修虚影
                                        }
                                    } else {
                                        // 普通武器：必须是活的，且是敌人
                                        if (t.hp <= 0) return;
                                        
                                        const affToThem = getAffinity(ent, t);
                                        const affToMe = getAffinity(t, ent);
                                        
                                        if (affToThem < 0 || affToMe < 0) {
                                            if (wep.turretRule === 'manual') valid = true; // 手动模式：辅助瞄准最近敌人
                                            else if (wep.turretRule === 'auto' || !wep.turretRule) valid = true; // 自动模式：攻击任何敌人
                                            else if (wep.turretRule === 'defense' && affToMe <= -100) valid = true; // 防御模式：只打死敌
                                        }
                                    }
                                    
                                    if (valid) {
                                        const d = Math.hypot(t.x - ent.x, t.y - ent.y);
                                        if (d < minDist) { minDist = d; closest = t; }
                                    }
                                });
                            }
                            if (closest) {
                                wepTarget = closest;
                                wep.rotation = Math.atan2(wepTarget.y - wepAbsoluteY, wepTarget.x - wepAbsoluteX) * 180 / Math.PI;
                                if (wep.turretRule === 'auto' || !wep.turretRule || wep.turretRule === 'defense') shouldFire = true;
                                else if (wep.turretRule === 'manual') shouldFire = ent.isFiring;
                            }
                        } else {
                            // AI炮塔：瞄准本舰的 target
                            if (ent.target && Math.hypot(ent.target.x - ent.x, ent.target.y - ent.y) < (wep.stats.range || 200)) {
                                wepTarget = ent.target;
                                wep.rotation = Math.atan2(wepTarget.y - wepAbsoluteY, wepTarget.x - wepAbsoluteX) * 180 / Math.PI;
                                shouldFire = true;
                            }
                        }
                    } else {
                        // 主炮：永远固定向船头
                        wep.rotation = ent.rotation;
                        if (isPlayerControlled) {
                            if (ent.isFiring) shouldFire = true;
                        } else {
                            if (ent.target) {
                                const wdx = ent.target.x - wepAbsoluteX;
                                const wdy = ent.target.y - wepAbsoluteY;
                                let wepAngleToEnemy = Math.atan2(wdy, wdx) * 180 / Math.PI;
                                let angleDiff = Math.abs(((wepAngleToEnemy - ent.rotation + 180) % 360 + 360) % 360 - 180);
                                // 移除 AI 主炮开火角度限制，只要目标在射程内即开火
                                if (Math.hypot(wdx, wdy) < (wep.stats.range || 200)) {
                                    // [优化补偿] 由于删除了角度限制，为了确保主炮发射的实体弹丸能朝向目标，强制把炮口对准目标
                                    wep.rotation = wepAngleToEnemy;
                                    shouldFire = true;
                                    wepTarget = ent.target;

                                    if (ent.type === 'drone') {
                                        if (wep.cooldown <= 0) {
                                            // console.log(`[无人机 ${ent.id}] 主炮/光束开火 -> 目标[${wepTarget.id}], 距离:${Math.round(Math.hypot(wdx, wdy))}`);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 2. 根据武器的 subType 制造弹道 (或建造射线)
                    if (isPlayerControlled && this.disabledWeaponSlots.has(wep.slotId)) {
                        shouldFire = false;
                    }

                    if (shouldFire && wep.cooldown <= 0) {
                        wep.cooldown = wep.stats.fireRate || 1.5;
                        const isLaser = (wep.subType === 'laser');
                        const isBuilder = (wep.subType === 'builder');
                        const isMissile = (wep.subType === 'missile');

                        if (isLaser || isBuilder) {
                            // 激光如果没有锁定特定目标(如玩家主炮盲射)，需要发射射线检测寻找目标
                            if (!wepTarget && !wep.isTurret) {
                                let minDist = wep.stats.range || 250;
                                allShipsList.forEach(t => {
                                    if (t.id === ent.id || t.hp <= 0) return;
                                    // 排除自己人
                                    if (isPlayerControlled && (t.isWingman || t.ownerId === 'player')) return;
                                    if (!isPlayerControlled && getAffinity(ent, t) >= 0) return;

                                    const d = Math.hypot(t.x - wepAbsoluteX, t.y - wepAbsoluteY);
                                    if (d > minDist) return;
                                    const angleToT = Math.atan2(t.y - wepAbsoluteY, t.x - wepAbsoluteX) * 180 / Math.PI;
                                    const angleDiff = Math.abs(((angleToT - wep.rotation + 180) % 360 + 360) % 360 - 180);
                                    if (angleDiff < 5 && d < minDist) { minDist = d; wepTarget = t; }
                                });
                            }

                            if (wepTarget) {
                                if (isBuilder) {
                                    // 专门制造一条瞬间且无害的建造射线，交给后面的 projectile 处理逻辑
                                    this.radarEntities.projectiles.push({
                                        isInstant: true,
                                        isBuilderBeam: true,
                                        buildSpeed: (wep.stats && wep.stats.buildSpeed) ? wep.stats.buildSpeed : 2,
                                        x: wepAbsoluteX, y: wepAbsoluteY, target: wepTarget,
                                        sourceId: ent.id,
                                        color: (wep.stats && wep.stats.color) ? wep.stats.color : '#00ff00', 
                                        damage: 0,
                                        thickness: 3
                                    });
                                } else {
                                    this.radarEntities.projectiles.push({
                                        isInstant: true,
                                        x: wepAbsoluteX, y: wepAbsoluteY, target: wepTarget,
                                        sourceId: ent.id,
                                        color: (wep.stats && wep.stats.color) ? wep.stats.color : '#ff0000', // 从武器属性读取
                                        damage: (wep.stats && wep.stats.attack !== undefined) ? wep.stats.attack : 15,
                                        thickness: (wep.stats && wep.stats.color === '#8a2be2') ? 10 : 2
                                    });
                                }
                            } else {
                                // 射空
                                const endX = wepAbsoluteX + Math.cos(wep.rotation * Math.PI / 180) * (wep.stats.range || 250);
                                const endY = wepAbsoluteY + Math.sin(wep.rotation * Math.PI / 180) * (wep.stats.range || 250);
                                this.createLaserBeam(null, wepAbsoluteX, wepAbsoluteY, endX, endY, wep.stats.color || '#ff0000', wep.stats.color === '#8a2be2' ? 10 : 2);
                            }
                        } else if (isMissile && wepTarget) {
                            this.radarMissiles.push({
                                x: wepAbsoluteX, y: wepAbsoluteY,
                                targetObj: wepTarget,
                                sourceId: ent.id,
                                speed: 250,
                                life: 8.0,
                                damage: wep.stats.attack || 30
                            });
                        } else {
                            // 默认动能实体弹丸
                            const shootRad = wep.rotation * Math.PI / 180;
                            const bulletSpeed = isPlayerControlled ? 600 : 500;
                            this.radarEntities.projectiles.push({
                                isInstant: false,
                                x: wepAbsoluteX, y: wepAbsoluteY,
                                vx: Math.cos(shootRad) * bulletSpeed,
                                vy: Math.sin(shootRad) * bulletSpeed,
                                life: ((wep.stats && wep.stats.range) ? wep.stats.range : 200) / bulletSpeed,
                                sourceId: ent.id,
                                color: (wep.stats && wep.stats.color) ? wep.stats.color : '#ffff00', // 从武器属性读取
                                damage: (wep.stats && wep.stats.attack !== undefined) ? wep.stats.attack : 15
                            });
                        }
                        
                        if (ent.shipRef) ent.shipRef.combatTimer = 5.0;
                        if (wepTarget && wepTarget.shipRef) wepTarget.shipRef.combatTimer = 5.0;
                    }
                });
            }

            // [逻辑修复] 战斗状态计时器衰减 (否则飞机永远无法自动返航)
            if (ent.shipRef && ent.shipRef.combatTimer > 0) {
                ent.shipRef.combatTimer -= dt;
            }

            // [Fix] 异常状态自愈：如果出现物理破坏级的 NaN 错误，强制归零，防止飞船永久消失或卡死
            if (isNaN(targetDx) || isNaN(targetDy)) { targetDx = 0; targetDy = 0; }
            if (isNaN(ent.vx) || isNaN(ent.vy)) { ent.vx = 0; ent.vy = 0; }
            if (isNaN(ent.x) || isNaN(ent.y)) { 
                ent.x = (ent.parentId && allShipsList.find(p=>p.id===ent.parentId)) ? allShipsList.find(p=>p.id===ent.parentId).x : 500; 
                ent.y = (ent.parentId && allShipsList.find(p=>p.id===ent.parentId)) ? allShipsList.find(p=>p.id===ent.parentId).y : 275; 
            }

            // [核心修复] 超速航行(巡航)断开时的强行熔断截速
            if (wasSuperCruising && !ent.isSuperCruising) {
                // 将速度瞬间截断到基础极速的 0.8 倍以内，防止巨大的惯性把船甩飞
                const currentV = Math.hypot(ent.vx, ent.vy);
                const limitV = baseMaxSpeed * 0.8;
                if (currentV > limitV) {
                    const ratio = limitV / currentV;
                    ent.vx *= ratio;
                    ent.vy *= ratio;
                }
            }

            // [引擎阻尼已被移除，航天器完全依靠上述反向喷射(targetDx/Dy)来制动纠正打滑]

            // 平滑转向逻辑 (物理驱动)
            if (lookTarget) {
                let targetAngle = Math.atan2(lookTarget.y - ent.y, lookTarget.x - ent.x) * 180 / Math.PI;
                if (isNaN(targetAngle)) targetAngle = 0;
                if (ent.rotation === undefined || isNaN(ent.rotation)) ent.rotation = targetAngle;
                
                let angleDiff = targetAngle - ent.rotation;
                angleDiff = ((angleDiff + 180) % 360 + 360) % 360 - 180;
                
                // AI 转向角速度限制：引擎转向推力 / 质量
                // [新设定] 转向推力需求提升为移动的 3 倍，等效于同样的转向推力提供的角速度减小到 1/3
                let maxTurnRate = mass > 0 ? (turnThrust / mass) / 3 : 0;
                
                // 如果是彻底没装引擎的瘫痪船
                if (maxTurnRate === 0 && thrust === 0) maxTurnRate = 0; 
                else if (maxTurnRate < 10) maxTurnRate = 10; // 兜底 (同比例下调)

                if (Math.abs(angleDiff) < maxTurnRate * dt) {
                    ent.rotation = targetAngle;
                } else {
                    ent.rotation += Math.sign(angleDiff) * maxTurnRate * dt;
                }
            }

            // 真实物理引擎推进：如果推力(thrust)为0，baseAccel为0，飞船只依靠惯性漂流
            if (targetDx !== 0 || targetDy !== 0) {
                let accel = baseAccel * thrustMultiplier;
                // 引擎最大允许速度上限 (乘数越大极速越高，WASD正常极速为 1.0x)
                const limitV = baseMaxSpeed * Math.max(0, thrustMultiplier);
                
                // 计算当前速度在推力方向上的投影分量
                const vDot = (ent.vx * targetDx + ent.vy * targetDy);
                
                // 只有当推力方向的速度还未达到该模式极速时，引擎才会继续贡献推力加成
                if (vDot < limitV) {
                    const addV = Math.min(accel * dt, limitV - vDot);
                    ent.vx += targetDx * addV;
                    ent.vy += targetDy * addV;
                }
            }

            // 物理衰减：阻力(drag)越小，打滑越严重，极速也越高
            // 极速极限值 ≈ accel / (1 - drag) (粗略估算)
            const friction = Math.pow(drag, dt); 
            ent.vx *= friction;
            ent.vy *= friction;
            ent.x += ent.vx * dt;
            ent.y += ent.vy * dt;

            // [新增] 纯时间倒计时建造（微观实机状态下）
            if (ent.shipRef && ent.shipRef.isBuilding) {
                if (ent.shipRef.buildProgress === undefined) ent.shipRef.buildProgress = 0;
                
                let timeToBuild = ent.type === 'destroyer' ? 30.0 : 10.0;
                let buildPowerPerSec = 100.0 / timeToBuild; 

                ent.shipRef.buildProgress += buildPowerPerSec * dt;

                // 下水实体化
                if (ent.shipRef.buildProgress >= 100) {
                    import('./base/Base-Building.js').then(module => {
                        module.finishShipBuilding(ent.id, ent.shipRef, ent.x, ent.y, ent.rotation);
                    });
                }
            }

            // 装备附加装甲自动回血逻辑 (微观实时演算)
            if (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.hpRegen && !ent.shipRef.isBuilding) {
                if (ent.hp < ent.maxHp) {
                    ent.hp = Math.min(ent.maxHp, ent.hp + ent.shipRef.stats.hpRegen * dt);
                }
            }

            if (ent.hitFlash > 0) ent.hitFlash -= dt;

            if (ent.hp <= 0 && !(ent.shipRef && ent.shipRef.isBuilding)) {
                // [强制保护] 玩家旗舰绝对不会因为莫名其妙的 0 血而静默死亡，防止开局暴毙死循环
                if (ent.id === pd.playerShipId && this.sys.game.loop.time < 5000) {
                    console.warn("[防误杀] 玩家飞船开局血量异常，强制恢复:", ent.hp);
                    ent.hp = ent.maxHp || 100;
                    return true;
                }

                if (ent.ownerId === 'player' && ent.id !== pd.playerShipId) {
                    // 玩家的任何非旗舰舰船（僚机/备用船）被击毁：永久移除（人船俱灭）
                    const removedName = PlayerManager.removeShip(ent.id);
                    if (removedName) {
                        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:red; font-weight:bold; margin-top:5px; border:1px solid red; padding:5px; background:rgba(50,0,0,0.5);">⚠️ 战斗警报：友军舰船 [${removedName}] 已被彻底摧毁，从资产库抹除。</div>` }));
                        // 强制立即刷新舰队面板，清除幽灵数据
                        if (true) { // 持续广播数据供 React 消费
                            const pd = PlayerManager.getStats();
                            EventBus.dispatchEvent(new CustomEvent(GameEvents.UPDATE_FLEET_DATA, { detail: pd }));
                        }
                    }
                }
                return false; 
            } else {
                if (ent.shipRef) {
                    if (ent.shipRef.stats) ent.shipRef.stats.hp = ent.hp; 
                    if (!ent.shipRef.location) ent.shipRef.location = { x: ent.x, y: ent.y };
                    ent.shipRef.location.x = ent.x;
                    ent.shipRef.location.y = ent.y;
                }
                if (ent.isWingman) {
                    const pd = PlayerManager.getStats();
                    if (pd.ownedShips) {
                        const ship = pd.ownedShips.find(s => s.id === ent.id);
                        if (ship) ship.hp = ent.hp;
                    }
                }
                return true;
            }
        };

        // 将所有实体合并为单一列表传递给开火演算进行真实阵营判定
        // [防御] 再次排重，确保 allEntities 没有 ID 相同的幽灵对象干扰开火和索敌
        let allEntitiesRaw = [...this.radarEntities.defenders, ...this.radarEntities.attackers];
        if (this.radarEntities.player) allEntitiesRaw.push(this.radarEntities.player);
        const allEntities = [...new Map(allEntitiesRaw.map(e => [e.id, e])).values()];

        // 统一处理所有实体的逻辑：众生平等

        // [重构] 无论是防卫者还是攻击者，统一在循环中进行玩家死亡的特判
        const checkPlayerDeath = (ent) => {
            const currentPd = PlayerManager.getStats();
            if (ent.id === currentPd.playerShipId && !ent.isSafeRemoved && !ent.isWarping && !ent.isDocked && !(ent.shipRef && ent.shipRef.state === 'DOCKED')) {
                // 玩家被击毁，触发强制重生逻辑
                setTimeout(() => {
                    const pd = PlayerManager.getStats();
                    const penalty = Math.floor(pd.credits * 0.1); // 扣除10%资产作为打捞费
                    PlayerManager.updateStat('credits', -penalty);
                    
                    alert(`⚠️ 警告：旗舰核心熔毁！\n\n紧急逃生舱已启动... 搜救队已将您打捞至安全区域。\n(损失 ${penalty} 星币作为打捞与舰体修复费)`);
                    
                    // 彻底清除当前星区内对玩家的仇恨目标
                    const allShipsList = ShipManager.getShipsInSector(simSectorName);
                    allShipsList.forEach(s => {
                        if (s.target && s.target.id === pd.playerShipId) s.target = null;
                        if (s.memory && s.memory[pd.playerShipId]) delete s.memory[pd.playerShipId];
                        if (s.memory && s.memory['player_ship']) delete s.memory['player_ship']; // 兼容旧档
                    });

                    // 给旗舰满血复活
                    if (pd.playerShipId) {
                        const flagship = pd.ownedShips.find(s => s.id === pd.playerShipId);
                        if (flagship) {
                            flagship.hp = flagship.maxHp || 100;
                            PlayerManager.saveStats(pd);
                        }
                    }

                    // 强制把玩家丢回空间站，安全地洗白仇恨状态
                    this.currentPoiId = 'poi-dock';
                    localStorage.setItem('current_poi', 'poi-dock');
                    
                    // 重置坐标到星门出生点 (利用跳跃门刷新机制)
                    localStorage.removeItem('player_radar_x');
                    localStorage.removeItem('player_radar_y');
                    
                    // 重新载入场景，完成彻底复活并清空所有微观实体残留
                    this.scene.restart();
                }, 1000);
            }
        };

        for (let i = this.radarEntities.defenders.length - 1; i >= 0; i--) {
            let def = this.radarEntities.defenders[i];
            let alive = updateShipEntity(def, allEntities);
            if (!alive) {
                // [Fix] 区分安全离场（进港/跃迁/区块回收）与战损死亡
                if (!def.isDocked && !(def.shipRef && def.shipRef.state === 'DOCKED') && !def.isWarping && !def.isSafeRemoved) {
                    this.createExplosion(null, def.x, def.y);
                    if (def.shipRef) def.shipRef.stats.hp = 0;
                    checkPlayerDeath(def);
                }
                // 停泊的实体虽然从主循环移除，但不算作销毁
                this.radarEntities.defenders.splice(i, 1);
            }
        }

        for (let i = this.radarEntities.attackers.length - 1; i >= 0; i--) {
            let att = this.radarEntities.attackers[i];
            let alive = updateShipEntity(att, allEntities);
            if (!alive) {
                // [Fix] 区分安全离场（进港/跃迁/区块回收）与战损死亡
                if (!att.isDocked && !(att.shipRef && att.shipRef.state === 'DOCKED') && !att.isWarping && !att.isSafeRemoved) {
                    this.createExplosion(null, att.x, att.y);
                    if (att.shipRef) att.shipRef.stats.hp = 0;
                    checkPlayerDeath(att);
                }
                this.radarEntities.attackers.splice(i, 1);
            }
        }

        // 处理飞行弹道 (追踪炮塔瞬间激光 vs 直线物理弹丸)
        for (let i = this.radarEntities.projectiles.length - 1; i >= 0; i--) {
            let p = this.radarEntities.projectiles[i];
            
            // --- 追踪炮塔：瞬间命中激光 ---
                if (p.isInstant) {
                    // [修复] 对于建筑光束，如果目标处于建筑状态，那么 hp 可能为 0，这不能阻止渲染
                    const targetAliveOrBuilding = p.target && (p.target.hp > 0 || (p.target.shipRef && p.target.shipRef.isBuilding));
                    
                    if (targetAliveOrBuilding) {
                        this.createLaserBeam(null, p.x, p.y, p.target.x, p.target.y, p.color, p.thickness);
                        
                        // [建筑激光特判]
                        const isBuildingBeam = p.isBuilderBeam || (p.damage === 0 && p.target.shipRef && p.target.shipRef.isBuilding);
                        
                        if (isBuildingBeam) {
                            // 调用剥离出来的破茧成蝶逻辑
                            processBuildingBeamHit(p);
                        } else {
                            // 正常的伤害扣血
                            if (!p.target.shipRef || !p.target.shipRef.isBuilding) {
                                p.target.hp -= p.damage;
                            }
                        }
                    
                    // 记录仇恨记忆（受击降低好感度，触发被动反击）
                    if (p.sourceId && p.target.id !== p.sourceId && !isBuildingBeam) {
                        let allPossibleTargets = [...this.radarEntities.defenders, ...this.radarEntities.attackers];
                        let shooter = allPossibleTargets.find(e => e.id === p.sourceId);
                        
                        if (shooter) {
                            const pdForProj = PlayerManager.getStats();
                            const amount = (p.sourceId === pdForProj.playerShipId && p.target.type === 'freighter') ? -100 : -10;
                            AffinityManager.modifyAffinity(p.target, shooter, amount);
                            
                            // 同步为焦点目标，让舰载机可以跟随集火 (这是针对主动开火方的)
                            if (shooter.id !== pdForProj.playerShipId) shooter.target = p.target;
                        }
                    }

                    if (p.target.hp <= 0) {
                        this.createExplosion(null, p.target.x, p.target.y);
                    } else {
                        p.target.hitFlash = 0.1; 
                    }
                }
                    this.radarEntities.projectiles.splice(i, 1);
                } 
                // --- 固定主炮：真实直线飞行的物理弹丸 ---
                else {
                    p.life -= dt;
                    if (p.life <= 0) {
                        if (p.el && p.el.parentNode) p.el.remove();
                        this.radarEntities.projectiles.splice(i, 1);
                        continue;
                    }

                    p.x += p.vx * dt;
                    p.y += p.vy * dt;

                // (渲染逻辑被完全交给了 RadarScene，实体只负责保留逻辑数据)

                // 物理碰撞检测
                let hitTarget = null;
                let allPossibleTargets = [...this.radarEntities.defenders, ...this.radarEntities.attackers];

                // 获取开火者以判定好感度
                let shooter = allPossibleTargets.find(e => e.id === p.sourceId);

                for (let j = 0; j < allPossibleTargets.length; j++) {
                    let ent = allPossibleTargets[j];
                    
                    // 【关键修复1】绝对排除了发射源自己。子弹永远不会打中自己的船体（包括母舰和子模块）。
                    if (ent.hp <= 0 || ent.id === p.sourceId) continue;
                    
                    // 【关键修复2】绝对协同穿透：如果开火者存在，且双方好感度 >= 1000，子弹视为不存在（完全穿透）
                    if (shooter) {
                        const aff = getAffinity(shooter, ent);
                        if (aff >= 1000) {
                            continue; // 完全忽略该目标的碰撞体积，子弹飞过去打后面的敌人
                        }
                    }

                    // 1. 简化的多边形碰撞检测：对所有飞船使用扩大后的圆形包围盒
                    const pdForColl = PlayerManager.getStats();
                    const dist = Math.hypot(ent.x - p.x, ent.y - p.y);
                    let hitbox = 30; // 默认容差调大
                    if (ent.id === pdForColl.playerShipId) hitbox = 30;
                    else if (ent.shipRef && ent.shipRef.hullId && GameConfig.HULLS[ent.shipRef.hullId]) {
                        const hSize = GameConfig.HULLS[ent.shipRef.hullId].size;
                        if (ent.shipRef.hullId === 'destroyer_alliance') hitbox = 100;
                        else if (ent.shipRef.hullId === 'destroyer_pirate') hitbox = 100;
                        else if (hSize === 'large') hitbox = 80;
                        else if (hSize === 'medium') hitbox = 45;
                    } else if (ent.type === 'freighter') hitbox = 50;

                    // 加入针对弹丸高速飞行的射线检测预判 (Raycast)
                    // 如果上一帧距离中心大于hitbox，这一帧飞进了hitbox内，也算作碰撞
                    if (dist < hitbox + 10) {
                        // 命中判定成功
                        hitTarget = ent;
                        // 此时发生的所有碰撞都是实打实的命中（因为 1000 好感度在上面已经被 continue 跳过了）
                        break;
                    }
                }

                if (hitTarget) {
                    // [无敌护盾特判] 实体子弹如果打到了建造中的模块，不扣血，不加仇恨
                    const isHittingBuilding = (hitTarget.shipRef && hitTarget.shipRef.isBuilding);
                    
                    if (!isHittingBuilding) {
                        hitTarget.hp -= p.damage;
                    }
                    
                    // 记录仇恨
                    if (p.sourceId && !isHittingBuilding) {
                        if (shooter) {
                            const pdForHate = PlayerManager.getStats();
                            const amount = (p.sourceId === pdForHate.playerShipId && hitTarget.type === 'freighter') ? -100 : -10;
                            AffinityManager.modifyAffinity(hitTarget, shooter, amount);
                            
                            // 同步为焦点目标，让舰载机可以跟随集火 (这是针对主动开火方的)
                            if (shooter.id !== pdForHate.playerShipId) shooter.target = hitTarget;
                        }
                    }

                        if (hitTarget.shipRef && !isHittingBuilding) {
                            hitTarget.shipRef.stats.hp -= p.damage; 
                            hitTarget.shipRef.combatTimer = 5.0; 
                        }
                        
                        this.createExplosion(null, p.x, p.y);
                        if (hitTarget.hp <= 0) {
                            this.createExplosion(null, hitTarget.x, hitTarget.y);
                        }
                        if (hitTarget.hp > 0 && !isHittingBuilding) hitTarget.hitFlash = 0.1; 

                        if (p.el && p.el.parentNode) p.el.remove();
                        this.radarEntities.projectiles.splice(i, 1);
                    }
                }
            }

            // --- 调用小行星更新与受击 ---
            updateAsteroids(dt, simSectorName, this.sectorSimulations, this.radarEntities.projectiles);

            for (let i = this.radarMissiles.length - 1; i >= 0; i--) {
                let m = this.radarMissiles[i];
                m.life -= dt;

                if (m.life <= 0 || !m.targetObj || m.targetObj.hp <= 0) {
                    this.radarMissiles.splice(i, 1);
                    continue;
                }

                const dx = m.targetObj.x - m.x;
                const dy = m.targetObj.y - m.y;
                const dist = Math.hypot(dx, dy);

                if (dist < 10) {
                    const dmg = m.damage || 40; 
                    const isHittingBuilding = (m.targetObj.shipRef && m.targetObj.shipRef.isBuilding);
                    
                    if (!isHittingBuilding) {
                        m.targetObj.hp -= dmg; 
                        if (m.targetObj.shipRef) {
                            m.targetObj.shipRef.stats.hp -= dmg;
                            m.targetObj.shipRef.combatTimer = 5.0;
                        }
                    }
                    
                    this.createExplosion(null, m.x, m.y);
                    if (m.targetObj.hp <= 0 && m.targetObj.x !== undefined) {
                        this.createExplosion(null, m.targetObj.x, m.targetObj.y);
                    }
                    
                    this.radarMissiles.splice(i, 1);
                    continue;
                }

                m.x += (dx / dist) * m.speed * dt;
                m.y += (dy / dist) * m.speed * dt;
            }

            // 将本星区收集到的指挥线存入全局临时缓存
            this._tempCommandLines.push(...renderCommandLines);

            // ==========================================
            // 【第二阶段：UI与渲染层】
            // 实体与飞船的渲染工作已完全移交给 Phaser 的 RadarScene 进行绘制
            // ==========================================
            // 无需在此处操作 DOM 节点和挂载幽灵图层了

        }); // End of activeSectors.forEach

        // [收尾] 恢复上下文
        if (this.sectorSimulations[viewingSector]) {
            this.radarEntities = this.sectorSimulations[viewingSector];
            
            // ==========================================
            // 【跨星区全局指挥线补充投影】
            // 如果玩家拥有的飞船不在 viewingSector，但它的航线经过或终点在 viewingSector
            // 我们需要在 viewingSector 中为它绘制一条从入口星门到出口星门（或目标点）的虚线投影
            // ==========================================
            const simGates = this.sectorSimulations[viewingSector].gates;
            if (simGates) {
                const pd = PlayerManager.getStats();
                const allPlayerShips = pd.ownedShips || [];
                const drawnShipIds = new Set(this._tempCommandLines.map(l => l.shipId));

                allPlayerShips.forEach(pShip => {
                    const macroShip = ShipManager.getShipById(pShip.id);
                    if (!macroShip) return;
                    
                    if (drawnShipIds.has(macroShip.id)) return;
                    
                    let cmdType = null;
                    let isTargetingView = false;
                    let targetPos = null;

                    if (macroShip.commandState === 'MOVE_TO' || macroShip.state === 'DEPARTURE' || macroShip.state === 'TRANSIT' || macroShip.state === 'WARP') {
                        cmdType = 'MOVE';
                        
                        let targetSec = null;
                        if (macroShip.orderQueue && macroShip.orderQueue.length > 0) {
                            targetSec = macroShip.orderQueue[0].targetSector;
                        } else if (macroShip.path && macroShip.path.length > 0) {
                            targetSec = macroShip.path[macroShip.path.length - 1];
                        }
                        
                        if (targetSec === viewingSector) {
                            isTargetingView = true;
                            if (macroShip.moveTarget) {
                                targetPos = { x: macroShip.moveTarget.x, y: macroShip.moveTarget.y };
                            } else {
                                targetPos = { x: 500, y: 275 };
                            }
                        }
                    }

                    if (!cmdType) return;

                    const pathIncludesView = macroShip.path && macroShip.path.includes(viewingSector);
                    const isWarpingToView = macroShip.state === 'WARP' && macroShip.currentLane && macroShip.currentLane.to === viewingSector;
                    
                    if (!pathIncludesView && !isTargetingView && !isWarpingToView) return;

                    const isSelected = this.selectedUnitIds.includes(macroShip.id);
                    let cStartX = null;
                    let cStartY = null;
                    let cEndX = null;
                    let cEndY = null;

                    let entryGateName = null;
                    let exitGateName = null;
                    
                    const pathIndex = macroShip.path ? macroShip.path.indexOf(viewingSector) : -1;
                    
                    if (pathIndex > 0) {
                        entryGateName = macroShip.path[pathIndex - 1];
                        if (pathIndex < macroShip.path.length - 1) {
                            exitGateName = macroShip.path[pathIndex + 1];
                        }
                    } else if (pathIndex === 0) {
                        if (macroShip.state === 'WARP' && macroShip.currentLane) {
                            entryGateName = macroShip.currentLane.from;
                        } else {
                            entryGateName = macroShip.location.sector;
                        }
                        if (macroShip.path.length > 1) {
                            exitGateName = macroShip.path[1];
                        }
                    } else if (pathIndex === -1) {
                        if (isWarpingToView) {
                            entryGateName = macroShip.currentLane.from;
                            if (macroShip.path && macroShip.path.length > 0) {
                                exitGateName = macroShip.path[0];
                            }
                        } else if (isTargetingView) {
                            entryGateName = macroShip.location.sector;
                        }
                    }

                    if (entryGateName && simGates[entryGateName]) {
                        cStartX = simGates[entryGateName].x;
                        cStartY = simGates[entryGateName].y;
                    }

                    if (exitGateName && simGates[exitGateName]) {
                        cEndX = simGates[exitGateName].x;
                        cEndY = simGates[exitGateName].y;
                    } else if (isTargetingView && targetPos) {
                        cEndX = targetPos.x;
                        cEndY = targetPos.y;
                    } else if (!exitGateName && pathIncludesView && pathIndex === macroShip.path.length - 1) {
                        cEndX = 500;
                        cEndY = 275;
                    }

                    if (cStartX !== null && cEndX !== null) {
                        this._tempCommandLines.push({
                            shipId: macroShip.id,
                            startX: cStartX,
                            startY: cStartY,
                            endX: cEndX,
                            endY: cEndY,
                            type: cmdType,
                            isDashed: true, 
                            isSelected: isSelected,
                            colorHex: '#33ccff' 
                        });
                    }
                });
            }

            // [引擎换血] 同步至原生 Phaser 物理渲染层
            const radar = this.scene.get('RadarScene');
            if (radar) {
                let allSimsRaw = [...this.radarEntities.defenders, ...this.radarEntities.attackers];
                
                // 再次严格排重，杜绝因为数组引用污染导致的同 ID 多实体传给前端
                const allSims = [...new Map(allSimsRaw.map(e => [e.id, e])).values()];
                
                const finalShips = allSims.filter(e => e && (e.hp > 0 || (e.shipRef && e.shipRef.isBuilding)));
                finalShips.forEach(s => {
                    if (s.shipRef && s.shipRef.isBuilding && !s._loggedBuildingRadar) {
                        // console.log(`[传给渲染层] 成功向 RadarScene 发送虚影数据！微观ID: ${s.id}, X: ${s.x}, Y: ${s.y}`);
                        s._loggedBuildingRadar = true;
                    }
                });

                // 将所有实体坐标、状态及弹道传给 RadarScene 绘制
                radar.syncEntities({
                    ships: finalShips,
                    projectiles: this.radarEntities.projectiles,
                    missiles: this.radarEntities.missiles || [],
                    asteroids: this.radarEntities.asteroids || [],
                    drops: this.radarEntities.drops || [],
                    selectedUnitIds: this.selectedUnitIds,
                    nodes: this.radarEntities.nodes || [],
                    gates: this.radarEntities.gatesArray || [],
                    commandLines: this._tempCommandLines || []
                });
                
                // 绘制完清空，准备下一帧
                this._tempCommandLines = [];

                radar.syncCamera(this.radarPanX, this.radarPanY, this.radarScale);
            }

            // --- 为新的右下角UI雷达广播数据 ---
            // 找到真正的玩家实体广播自身位置
            const pdForUI = PlayerManager.getStats();
            let finalRealPlayerEnt = [...this.radarEntities.defenders, ...this.radarEntities.attackers].find(e => String(e.id) === String(pdForUI.playerShipId));
            if (finalRealPlayerEnt) {
                const validShips = [...this.radarEntities.defenders, ...this.radarEntities.attackers].filter(e => e && e.hp > 0);
                const radarPayload = {
                    player: { x: finalRealPlayerEnt.x, y: finalRealPlayerEnt.y, rotation: finalRealPlayerEnt.rotation },
                    entities: validShips.map(s => ({
                        id: s.id,
                        x: s.x,
                        y: s.y,
                        type: s.type, // 或者其它用来决定颜色的属性
                        faction: s.shipRef ? s.shipRef.faction : null // 帮助区分敌我
                    }))
                };
                document.dispatchEvent(new CustomEvent('ui_mini_radar_update', { detail: radarPayload }));
            }
        }
    }

    createExplosion(layer, x, y) {
        const radar = this.scene.get('RadarScene');
        if (radar) radar.addExplosion(x, y);
    }

    createImplosion(layer, x, y) {
        const radar = this.scene.get('RadarScene');
        if (radar) radar.addImplosion(x, y);
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
                        macroShip.forceCompleteTravel(worldState); // 这会把它变成 WARP 状态
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
                            entity.shipRef.forceCompleteTravel(worldState);
                            shouldWarp = true;
                        } else if (entity.shipRef.state === 'TRANSIT' && entity.shipRef.transitToGate === gateName) {
                            entity.shipRef.forceCompleteTravel(worldState);
                            shouldWarp = true;
                        } else if (entity.isWingman || entity.shipRef.commandState === 'MOVE_TO') {
                            // 对于被玩家强制下令撞门的僚机，强行覆盖其航线
                            entity.shipRef.state = 'DEPARTURE';
                            entity.shipRef.targetGate = gateName;
                            entity.shipRef.transitToGate = gateName;
                            entity.shipRef.path = [gateName]; 
                            entity.shipRef.commandState = null;
                            entity.moveTarget = null;
                            entity.shipRef.forceCompleteTravel(worldState);
                            shouldWarp = true;
                        }

                        // 只要状态变了 WARP，就成功
                        if (shouldWarp && entity.shipRef.state === 'WARP') {
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
        const radar = this.scene.get('RadarScene');
        if (radar) radar.addGateExit(x, y, angle);
    }

    showRTSFeedback(layer, x, y, color, text) {
        const radar = this.scene.get('RadarScene');
        if (radar) radar.addRTSFeedback(x, y, color, text);
    }

    createLaserBeam(layer, x1, y1, x2, y2, color, thickness = 2) {
        const radar = this.scene.get('RadarScene');
        if (radar) radar.addLaser(x1, y1, x2, y2, color, thickness);
    }

    handleWorldTick() {
        const worldHasChanged = WorldbookManager.tickWorld();
        
        let currentSectorName = localStorage.getItem('current_sector');

        // --- 全宇宙建筑模块建造队列调度（彻底打破主角中心论） ---
        const ws = WorldbookManager.getWorldState();
        
        // 获取所有活跃星区（包括物理星区和远程观测星区）
        const viewingSector = this.viewingSector || currentSectorName;
        const activeSectors = [currentSectorName];
        if (viewingSector !== currentSectorName) activeSectors.push(viewingSector);

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

    async initChatContext(terminalDOM) {
        const defaultLore = GameConfig.llm.defaultLore;
        const worldbook = localStorage.getItem('llm_lorebook') || defaultLore;
        let currentSector = localStorage.getItem('current_sector');

        const systemPrompt = `以下是世界背景设定：\n${worldbook}\n当前位置：玩家在【${currentSector}】的接驳口。\n\n【DM 绝对铁律】：\n1. 财产不可侵犯：绝不能未经玩家明确同意就私自没收、扣除玩家的任何物品或战利品。\n2. 世界真实性：这个宇宙是真实残酷的物理世界。绝对禁止在剧情中加入“这只是模拟/测试”、“这只是一场梦/演习”之类的强行反转或自我加戏。\n3. 行为边界：每次只需针对玩家当前的动作给出即时反应，不要过度推演未来，绝对不要擅自给剧情强行画上“大结局”的句号。`;
        
        const lastLog = localStorage.getItem('last_mission_log');
        
        // 如果有最新战报，开启新对话
        if (lastLog) {
            this.chatHistory = [{ role: 'system', content: systemPrompt }];
            this.currentPoiId = 'poi-dock';
            localStorage.setItem('current_poi', 'poi-dock');
            this.renderSectorView(terminalDOM);
            
            const modal = terminalDOM?.node?.querySelector('#text-adventure-modal');
            if (modal) modal.style.display = 'flex';

            EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div class="msg-system" style="border: 1px dashed #ffaa00; padding: 10px; color: #ffaa00;">[战报同步] ${lastLog}</div>`, clear: true } }));
            
            const prompt = `(系统提示：玩家刚结束战斗，战报：【${lastLog}】。回到【${currentSector}】的停泊区。请扮演地勤或AI迎接。)`;
            await this.performLLMRequest(terminalDOM, prompt);
            
            localStorage.removeItem('last_mission_log');
        } else {
            // 加载历史，但不自动弹出文游面板
            const saved = localStorage.getItem('llm_chat_history');
            if (saved) {
                try {
                    this.chatHistory = JSON.parse(saved);
                    if (this.chatHistory[0]?.role === 'system') this.chatHistory[0].content = systemPrompt;
                    const lastAss = [...this.chatHistory].reverse().find(m => m.role === 'assistant');
                    if (lastAss) {
                        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div class="msg-ai" style='color: #dddddd;'>${lastAss.content.replace(/\[CMD:.*?\]/g, '').replace(/\{\{FDEP:.*?\}\}/g, '')}</div>`, clear: true } }));
                    }
                } catch(e) { this.chatHistory = [{ role: 'system', content: systemPrompt }]; }
            } else {
                this.chatHistory = [{ role: 'system', content: systemPrompt }];
            }
        }
    }

    executePlayerMove(terminalDOM, newPoiId, newPoiName) {
        if (this.isLLMBusy) return;
        
        const input = terminalDOM?.node?.querySelector('#chat-input');
        this.pendingPoiId = newPoiId;
        const text = `(我走进了【${newPoiName}】。请描述我在这里看到的众生百态，并根据这里的环境向我搭话。)`;
        this.handlePlayerAction(terminalDOM, text);
    }

    async handlePlayerAction(terminalDOM, text) {
        if (this.isLLMBusy || !text) return;
        
        const input = terminalDOM?.node?.querySelector('#chat-input');
        input.value = '';
        
        // 显示玩家输入
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div class="msg-player" style='color: #ffaa00;'><b>> ${text}</b></div>`, clear: true } }));
        
        let finalSendText = text;
        
        // 如果有暂存的系统接入提示词（比如刚点开面板还没有发送），合并后一并发送
        if (this.pendingSystemPrompt) {
            finalSendText = this.pendingSystemPrompt + "\n(玩家动作：" + text + ")";
            this.pendingSystemPrompt = null;
        }

        await this.performLLMRequest(terminalDOM, finalSendText);
    }

    async performLLMRequest(terminalDOM, userText) {
        this.isLLMBusy = true;
        EventBus.dispatchEvent(new CustomEvent(GameEvents.TOGGLE_INPUT_STATE, { detail: true }));
        
        this.chatHistory.push({ role: 'user', content: userText });
        this.saveHistory();

        const replyId = 'reply-' + Date.now();
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div class="msg-ai" id="${replyId}" style='color: #dddddd;'>...</div>` }));

        try {
            const { fullReply, cleanReply, commands } = await LLMService.request(this.chatHistory, (chunk) => {
                const el = terminalDOM?.node?.querySelector(`#${replyId}`);
                if (el) el.innerHTML = chunk.replace(/\[CMD:.*?\]/g, '').replace(/\{\{FDEP:.*?\}\}/g, '') + '_';
            });

            // 更新最终显示
            const el = terminalDOM?.node?.querySelector(`#${replyId}`);
            if (el) el.innerHTML = cleanReply;

            // 执行指令
            this.executeCommands(commands, terminalDOM);

            // 保存
            this.chatHistory.push({ role: 'assistant', content: fullReply });
            this.saveHistory();
            this.lastRawResponse = fullReply;

            // 如果有位置变更
            if (this.pendingPoiId) {
                this.currentPoiId = this.pendingPoiId;
                localStorage.setItem('current_poi', this.pendingPoiId);
                this.pendingPoiId = null;
                this.renderSectorView(terminalDOM);
            }

        } catch (e) {
            EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style='color:red'>Error: ${e.message}</div>` }));
            this.chatHistory.pop(); // 回滚
        } finally {
            this.isLLMBusy = false;
            EventBus.dispatchEvent(new CustomEvent(GameEvents.TOGGLE_INPUT_STATE, { detail: false }));
        }
    }

    executeCommands(commands, terminalDOM) {
        if (!commands || commands.length === 0) return;
        
        let logs = [];
        commands.forEach(cmdStr => {
            const [cmd, ...valParts] = cmdStr.split(/[:|]/);
            const val = valParts.join(':').trim();
            
            switch(cmd.toUpperCase()) {
                case 'MOD_CREDITS': case 'CREDIT':
                    const cD = parseInt(val);
                    PlayerManager.updateStat('credits', cD);
                    logs.push(`星币 ${cD>0?'+':''}${cD}`);
                    break;
                case 'ADD_EQUIP': case 'INV_ADD':
                    PlayerManager.addItem(val);
                    logs.push(`获得: ${val}`);
                    break;
                case 'REMOVE_EQUIP': case 'INV_DEL':
                    PlayerManager.removeItem(val);
                    logs.push(`失去: ${val}`);
                    break;
                case 'OP':
                    // 选项按钮，追加到聊天框
                    const optHtml = `<button class="chat-option-btn" data-text="${val}" style="margin:5px;padding:5px 10px;background:#ffaa00;color:black;border:none;border-radius:10px;cursor:pointer;">${val}</button>`;
                    const chatBox = terminalDOM?.node?.querySelector('#chat-history');
                    chatBox.innerHTML += optHtml;
                    break;
            }
        });

        if (logs.length > 0) {
            this.playerData = PlayerManager.getStats(); // 刷新本地缓存
            const uiTopBar = terminalDOM?.node?.querySelector('#ui-top-bar');
            if (uiTopBar) uiTopBar.innerText = this.getTopBarText();
            EventBus.dispatchEvent(new CustomEvent(GameEvents.UPDATE_INVENTORY, { detail: PlayerManager.getInventory() }));
            EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div style='color:#0f0;font-size:12px;'>[系统日志] ${logs.join(', ')}</div>` } }));
        }
    }

    saveHistory() {
        // 简单的截断逻辑
        if (this.chatHistory.length > 20) {
            const sys = this.chatHistory[0];
            this.chatHistory = [sys, ...this.chatHistory.slice(-10)];
        }
        localStorage.setItem('llm_chat_history', JSON.stringify(this.chatHistory));
    }
}
