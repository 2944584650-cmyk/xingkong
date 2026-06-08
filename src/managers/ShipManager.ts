import { GameConfig } from '../config.js';
import { EventBus, GameEvents } from '../utils/EventBus.js';
import { OOSSimulator } from './OOSSimulator.js';
import { ShipDecision, ShipExecution } from './ship/ShipDecision.js';
import { BuildingManager, GRID_PIXEL_SIZE } from './BuildingManager.js';
import { triggerWarp } from './oos/OOS-Travel.js';
import { ShipData } from '../data/ShipData.js';
import { NPCManager } from './NPCManager.js';

export class Ship implements ShipData {
    id!: string;
    name!: string;
    ownerId!: string;
    factionId!: number;
    type!: string;
    size!: string;
    hullId!: string;
    loadout!: Record<string, string>;
    maxInventory!: number;
    state!: ShipData['state'];
    location!: { sector: string; x: number; y: number; };
    rotation!: number;
    stats!: { hp: number; maxHp: number; mass: number; drag: number; thrust: number; turnThrust: number; hpRegen: number; speed?: number; };
    orderQueue!: any[];
    taskStack!: any[];
    combatTimer!: number;

    [key: string]: any;
    
    constructor(data: any) {
        this.id = data.id || `ship_${Date.now()}_${Math.floor(Math.random()*1000)}`;
        this.name = data.name || `未命名舰船 ${this.id.substr(-4)}`;
        
        // 强制转换为整型，防止序列化后变成字符串导致预设匹配失败
        this.factionId = parseInt(data.factionId) || 0; 
        this.ownerId = data.ownerId !== undefined ? data.ownerId : this.factionId;
        
        // [新增] 记录母体标识，用于无人机和舰载机存活判定及所属权挂靠
        this.parentId = data.parentId || null;

        // --- 舰船设计系统 3.0 ---
        // 彻底解耦：船 = 底盘(Hull) + 挂载件(Components)。如果没有，根据阵营分配预设
        this.hullId = data.hullId;
        this.loadout = data.loadout || {};
        
        // --- 无人机系统 ---
        // 记录无人机槽位装备情况，格式: { slotId: itemKey }，如 { "DR1": "mine_drone" }
        this.droneEquips = data.droneEquips || {};
        // 记录每个槽位的状态，格式: { slotId: state }，state = 'IDLE' | 'WORKING' | 'RETURNING'
        this.droneStates = data.droneStates || {};
        
        // [修复] 初始化时，如果带有无人机装备但无状态记录，则默认赋予 IDLE 状态
        if (this.droneEquips) {
            for (const slotId in this.droneEquips) {
                if (!this.droneStates[slotId]) {
                    this.droneStates[slotId] = 'IDLE';
                }
            }
        }

        // 记录外派的无人机实体 ID，格式: { slotId: entityId }
        this.activeDrones = data.activeDrones || {};

        // === 向下兼容：仅修复之前错写的底盘ID，不影响未来新增的阵营商船 ===
        if (this.hullId === 'freighter_basic' || this.hullId === 'freighter_small') {
            this.hullId = 'hull_freighter_s'; 
            data.type = 'freighter';
        } else if (this.hullId === 'fighter_basic') {
            if (this.factionId === 1) this.hullId = 'hull_empire_s';
            else if (this.factionId === 2) this.hullId = 'hull_alliance_s';
            else if (this.factionId === 3) this.hullId = 'hull_scavenger_s';
            else if (this.factionId === 4) this.hullId = 'hull_cult_s';
            else this.hullId = 'hull_alliance_s';
            data.type = 'fighter';
        }
        
        // 抢救被污染的存档：如果名字带"商船"，且当前被套上了战机的底盘，说明它变异了，将其抢救回默认商船。
        // 如果它已经是合法的商船底盘(比如未来的 hull_empire_freighter)，则绝不干涉！
        if (this.name && this.name.includes('商船')) {
            data.type = 'freighter';
            if (this.hullId && GameConfig.HULLS[this.hullId] && GameConfig.HULLS[this.hullId].type !== 'freighter') {
                this.hullId = 'hull_freighter_s'; 
                this.loadout = {}; // 清空变异带来的战机装备
            }
        }
        // ============================

        const hullDef = GameConfig.HULLS[this.hullId];
        this.type = hullDef ? hullDef.type : (data.type || 'fighter');
        this.size = hullDef ? hullDef.size : 'small';
        
        // 为无人机实体明确分类标识 (进攻、防守、通用等)，使其成为宇宙实体的通用属性
        if (this.type === 'drone') {
            this.droneType = data.droneType || ((hullDef && hullDef.droneType) ? hullDef.droneType : 
                            (this.hullId === 'attack_drone_gongji' ? 'ATTACK' : 'GENERAL'));
        }

        // 状态
        this.state = data.state || 'IDLE'; 
        if (this.state === 'TRAVEL') this.state = 'WARP'; 
        
        this.location = data.location || { sector: '创世星柱废墟', x: 0, y: 0 };
        
        // --- 建造系统：虚影状态处理 ---
        if (data.isBuilding === true) {
            this.isBuilding = true;
            this.state = 'BUILDING';
            this.sourceModuleId = data.sourceModuleId || null;
            // 建造时的坐标由 ChuanWuUI 在投递订单时计算好的 location 直接决定，不再做二次异步重算
            // 以避免在重算期间闪烁或者引发模块系统未能加载的错误。
        }
        // [移除兜底] 允许存在 undefined 坐标，交由微观物理引擎(Base.ts)在出生时分配星门坐标
        
        // 初始化飞船朝向
        this.rotation = data.rotation !== undefined ? data.rotation : 0;
        
        // --- 停泊系统 4.0: 实体容器化 ---
        // 指向宿主单位ID (如 'station_alpha', 'carrier_01')。若不为空，则飞船在物理世界中消失(隐形)
        this.dockedAt = data.dockedAt || null;
        this.dockedBerthId = data.dockedBerthId || null; // 记录它在这个建筑的哪个泊位上
        this.approachingDock = data.approachingDock || null; // [新增] 预期停靠的建筑UID，用于预占泊位

        // 导航
        this.targetSector = data.targetSector || null;
        this.path = data.path || []; 
        this.travelProgress = data.travelProgress || 0; 
        this.currentLane = data.currentLane || null; 
        this.targetGate = data.targetGate || null;
        this.transitFromGate = data.transitFromGate || null;
        this.transitToGate = data.transitToGate || null;

        const initialHpProvided = data.stats && data.stats.hp !== undefined;

        // 直接从底盘配置获取容量
        this.maxInventory = hullDef ? hullDef.maxInventory : 100;

        // 动态计算出的面板属性 (通过 recalculateStats 刷新)
        this.stats = {
            hp: initialHpProvided ? data.stats.hp : (hullDef ? hullDef.baseHp : 100),
            maxHp: hullDef ? hullDef.baseHp : 100,
            mass: hullDef ? (hullDef.mass || 10) : 10,
            drag: hullDef ? (hullDef.drag || 0.15) : 0.15,
            thrust: 0,
            turnThrust: 0,
            hpRegen: 0,
            speed: 0 // 已废弃，但为了向下兼容某些UI暂留
        };
        
        // 提取出的激活武器列表（给 Base.js 的多炮塔 AI 用）
        // 格式: [{ slotId: 'W1', x: 10, y: 0, cooldown: 0, stats: {...} }]
        this.activeWeapons = data.activeWeapons || [];
        
        // 初始化时强制重算一次总属性
        this.recalculateStats();

        // 如果是新诞生的船只（没提供具体的存盘初始血量），出厂即强制满血
        if (!initialHpProvided) {
            this.stats.hp = this.stats.maxHp;
        }

        // 订单/巡逻状态机专用
        this.orderQueue = data.orderQueue || []; 
        this.taskStack = data.taskStack || []; // [新增] 细化的原子任务栈
        this.combatTimer = data.combatTimer || 0; // 脱战倒计时
        
        this._oosLogTimer = 0; // OOS 日志监控定时器
        
        // 采矿定时器
        this._miningTimer = 0;
    }

    // 核心算法：根据船体和槽位装备重新计算总属性
    recalculateStats() {
        const hullDef = GameConfig.HULLS[this.hullId];
        if (!hullDef) return;

        // 1. 重置基础属性
        this.stats.maxHp = hullDef.baseHp;
        this.stats.mass = hullDef.mass || 10;
        this.stats.drag = hullDef.drag || 0.15;
        this.stats.thrust = 0;
        this.stats.turnThrust = 0;
        this.stats.speed = 0; // 已废弃
        this.stats.hpRegen = 0;
        this.maxInventory = hullDef.maxInventory;
        
        let fireRateMultiplier = 1.0;
        
        // 2. 清空激活的武器列表，准备重新装载
        const newWeapons = [];

        // 3. 遍历所有的组装槽位
        for (const [slotId, compId] of Object.entries(this.loadout)) {
            if (!compId) continue;
            const slotDef = hullDef.slots[slotId];
            const compDef = GameConfig.COMPONENTS[compId as string];
            if (!slotDef || !compDef) continue;

            // 根据组件类型累加属性
            if (compDef.type === 'defense') {
                if (compDef.stats.hpBonus) this.stats.maxHp += compDef.stats.hpBonus;
                if (compDef.stats.speedPenalty) this.stats.mass -= compDef.stats.speedPenalty; // speedPenalty 是负数，减去负数等于增加质量
                if (compDef.stats.hpRegen) this.stats.hpRegen += compDef.stats.hpRegen;
            } 
            else if (compDef.type === 'utility') {
                if (compDef.stats.inventoryBonus) this.maxInventory += compDef.stats.inventoryBonus;
            }
            else if (compDef.type === 'engine') {
                if (compDef.stats.thrust) this.stats.thrust += compDef.stats.thrust;
                if (compDef.stats.turnThrust) this.stats.turnThrust += compDef.stats.turnThrust;
            }
            else if (compDef.type === 'core') {
                if (compDef.stats.fireRateMultiplier) fireRateMultiplier *= compDef.stats.fireRateMultiplier;
            }
            else if (compDef.type === 'weapon') {
                // 如果是武器，提取出来并继承旧状态（如果有的话），以便不重置冷却
                let oldWep = this.activeWeapons.find(w => w.slotId === slotId);
                let isTurretFlag = (slotDef.isTurret === true);
                
                // --- 纯正 ECS 炮台逻辑：炮台是架子，武器是管子 ---
                // 只有当炮台槽上安装了武器，底盘自带的炮台架子才会显现。
                let renderSprite = 'none';
                let spriteSize = { width: 5, height: 5 };
                let origin = { x: 2.5, y: 2.5 };
                let imgRotOffset = 0;

                if (isTurretFlag) {
                    renderSprite = hullDef.turretBaseSprite || 'empire_turret.png';
                    spriteSize = hullDef.turretBaseSize || { width: 5, height: 5 };
                    origin = hullDef.turretBaseOrigin || { x: 2.5, y: 2.5 };
                    imgRotOffset = hullDef.turretBaseRotOffset || 0;
                } else {
                    // 非炮台槽，直接用武器自己的贴图（大炮管等），目前大多是 none
                    renderSprite = compDef.meta?.sprite || compDef.sprite || 'none';
                }

                let weaponObj = {
                    slotId: slotId,
                    compId: compId,
                    x: slotDef.x || 0, // 从蓝图挂载点读取坐标
                    y: slotDef.y || 0,
                    isTurret: isTurretFlag, 
                    sprite: renderSprite,
                    spriteSize: spriteSize,
                    origin: origin,
                    imgRotOffset: imgRotOffset,
                    cooldown: oldWep ? oldWep.cooldown : 0, // 继承旧CD
                    rotation: oldWep ? oldWep.rotation : 0, // 继承炮塔朝向
                    type: compDef.type,
                    subType: compDef.subType, // 传递新版大类/子类标签
                    stats: { ...compDef.stats } // 复制一份基础武器数值
                };
                
                newWeapons.push(weaponObj);
            }
        }

        // 4. 应用全局乘区（比如核心AI减全武器冷却）
        newWeapons.forEach(w => {
            if (w.stats.fireRate) {
                w.stats.fireRate *= fireRateMultiplier;
            }
        });

        this.activeWeapons = newWeapons;

        // 5. 限制当前血量不要溢出
        if (this.stats.hp > this.stats.maxHp) {
            this.stats.hp = this.stats.maxHp;
        }
    }

    update(dt, worldState, allShips = [], activeSectors = []) {
        if (this.stats.hp <= 0) return;

        const isActiveSim = activeSectors.includes(this.location.sector);

        // --- 核心修复：状态机异常自愈 ---
        if (this.state === 'DEPARTURE' && (!this.path || this.path.length === 0 || !this.targetGate)) {
            console.warn(`[ShipManager] 飞船 ${this.name} 状态异常 (DEPARTURE 但无目标)，启动自愈 -> IDLE`);
            this.state = 'IDLE';
            this.path = [];
            this.targetGate = null;
            this.travelProgress = 0;
        }
        
        if (this.state === 'WARP' && !this.currentLane) {
            console.warn(`[ShipManager] 飞船 ${this.name} 状态异常 (WARP 但无航线)，启动自愈 -> IDLE`);
            this.state = 'IDLE';
            this.path = [];
            this.travelProgress = 0;
        }

        // 所有飞船都有脱战冷却机制
        if (this.combatTimer > 0) {
            this.combatTimer -= dt;
        }

        // --- 采矿产出与满载回收逻辑 ---
        let minerWeapon = null;
        if (this.activeWeapons && this.activeWeapons.length > 0) {
            minerWeapon = this.activeWeapons.find(w => w.compId === 'miner_beam_mk1');
        }

        // 初始化标记
        this.isActivelyMining = false;

        if (minerWeapon) {
            const InventoryManager = (window as any).InventoryManager;
            let currentFrag = InventoryManager ? InventoryManager.getInventory(this.id)['asteroid_fragment'] || 0 : 0;
            const isFull = currentFrag >= this.maxInventory; // TODO: 使用统一的容量逻辑，这里暂时保留旧的粗略判定避免报错

            // 1. 检查是否在矿带范围内
            let inAsteroidBelt = false;
            const currentSectorObj = worldState.sectors?.find(s => s.name === this.location.sector);
            if (currentSectorObj && worldState.asteroidBelts) {
                const beltsInSector = worldState.asteroidBelts.filter(b => b.sector === this.location.sector);
                for (const belt of beltsInSector) {
                    const distToBeltCenter = Math.hypot(belt.worldX - this.location.x, belt.worldY - this.location.y);
                    if (distToBeltCenter <= belt.radius) {
                        inAsteroidBelt = true;
                        break;
                    }
                }
            }

            // 只有未满载且在矿带内，才允许产出
            if (!isFull && inAsteroidBelt) {
                this.isActivelyMining = true; // 告诉前端画吸收特效
                this._miningTimer += dt;
                
                // 读取武器配置，如果没有配置则使用默认值
                const fireRate = minerWeapon.stats.fireRate || 3.0;
                const yieldAmount = minerWeapon.stats.miningYield || 100;
                
                // 每 fireRate 秒产出 yieldAmount 个小行星碎块
                if (this._miningTimer >= fireRate) {
                    this._miningTimer = 0;
                    const InventoryManager = (window as any).InventoryManager;
                    if (InventoryManager) {
                        InventoryManager.addCargo(this.id, 'asteroid_fragment', yieldAmount);
                    }
                }
            }

        }

        // --- 无人机通用返航回收结算 ---
        if (this.type === 'drone') {
            // MINE 类型且满载时，在 OOS/宏观层级也会被标记为返航
            if (this.droneType === 'MINE') {
                const InventoryManager = (window as any).InventoryManager;
                const inv = InventoryManager ? InventoryManager.getInventory(this.id) : {};
                const currentFrag = inv['asteroid_fragment'] || 0;
                
                // 修复：由于底盘默认可能 maxInventory 为 0，导致出舱 0 >= 0 瞬间判定满载
                const capacity = this.maxInventory > 0 ? this.maxInventory : 10;
                const isFull = currentFrag >= capacity;
                
                // [加入调试信息] 检查采矿无人机的容量和当前挂载状态
                // if (!this._mineDebugLog) {
                //     console.warn(`[采矿调试] 无人机出生 -> ID: ${this.id}, 当前矿石: ${currentFrag}, 货舱上限 capacity: ${capacity}, 是否已满载 isFull: ${isFull}`);
                //     this._mineDebugLog = true;
                // }

                if (isFull) {
                    // if (!this._mineFullLog) {
                    //     console.warn(`[采矿调试] 无人机 ID: ${this.id} 触发满载返航。`);
                    //     this._mineFullLog = true;
                    // }
                    this.isReturning = true;
                } else if (!this.isReturning) {
                    // 只有在没有被其他逻辑（如闲置超时）标记返航时才重置
                    this.isReturning = false;
                }
            }

            // 如果处于返航状态，检测距离母舰是否足够近并执行回收
            if (this.isReturning) {
                let parentShip: any = allShips.find(s => s.id === this.parentId);
                
                // 兼容：如果母舰在飞船列表里没找到，可能是挂载在建筑模块上的无人机
                if (!parentShip) {
                    const bm = (window as any).BuildingManager;
                    if (bm && bm.stationModules) {
                        const mod = bm.stationModules.find((m: any) => String(m.uid) === String(this.parentId));
                        if (mod) {
                            // 构造伪造的建筑母舰对象参与结算
                            const gridPixelSize = bm.GRID_PIXEL_SIZE || 550;
                            const worldX = mod.gridX * gridPixelSize + (mod.width || 1) * gridPixelSize / 2;
                            const worldY = mod.gridY * gridPixelSize + (mod.height || 1) * gridPixelSize / 2;
                            parentShip = {
                                isStationModule: true,
                                location: { x: worldX, y: worldY },
                                ownerId: 'player', // 默认建筑模块目前都属于玩家
                                addCargo: (good: string, amount: number) => {
                                    // [修复]: 建筑无人机返航时，也将物资存入总站公库
                                    const targetStationUid = mod.stationUid || mod.uid;
                                    
                                    const InventoryManager = (window as any).InventoryManager;
                                    if (InventoryManager) {
                                        // 强制使用统一的 API 将物资存入空间站公库，不再允许模块私自生成库存
                                        InventoryManager.addCargo(targetStationUid, good, amount, mod);
                                        console.log(`[建筑物流 - F12] 无人机物资 ${good} x${amount} 已存入空间站公库 (UID:${targetStationUid})`);
                                    } else {
                                        console.warn(`[建筑物流] 缺少 InventoryManager，物资 ${good} x${amount} 转移失败。`);
                                    }
                                    
                                    // 尝试保存并刷新前端状态
                                    if (typeof bm.save === 'function') {
                                        bm.save();
                                    }
                                    import('../utils/EventBus.js').then(({ EventBus }) => {
                                        if (typeof (EventBus as any).emit === 'function') {
                                            (EventBus as any).emit('station_modules_updated');
                                            // 同时可以触发一个通用的货物变动事件让观察UI更新
                                            (EventBus as any).emit('building_cargo_changed');
                                        }
                                    });
                                }
                            };
                        }
                    }
                }
                
                if (parentShip) {
                    const distToParent = Math.hypot(parentShip.location.x - this.location.x, parentShip.location.y - this.location.y);
                    // 当距离极近（放宽到小于 50 像素，方便微观物理引擎结算），触发回收
                    if (distToParent < 50) {
                        // 1. 转移肚子里所有可能的物资 (如小行星碎块)
                        const InventoryManager = (window as any).InventoryManager;
                        if (InventoryManager) {
                            const myInv = InventoryManager.getInventory(this.id);
                            for (const good in myInv) {
                                if (myInv[good] > 0) {
                                    InventoryManager.transfer(this.id, parentShip.id || parentShip.uid, good, myInv[good]);
                                }
                            }
                        }
                        
                        // 2. 补回无人机实体
                        if (this.sourceSlotId) {
                            // 如果是从特定槽位发出的，恢复该槽位状态，不塞回货舱
                            if (parentShip.droneStates) {
                                parentShip.droneStates[this.sourceSlotId] = 'IDLE';
                                if (parentShip.activeDrones) delete parentShip.activeDrones[this.sourceSlotId];
                            }
                            
                            // 触发 UI 刷新，让面板上的“返航中...”变回“出击”
                            if (typeof window !== 'undefined' && document) {
                                document.dispatchEvent(new Event('DRONE_STATE_CHANGED'));
                            }
                        } else {
                            // 兼容旧逻辑：如果是纯消耗品发射的，补回对应的无人机物品
                            let droneItemKey = 'attack_drone'; // 默认
                            if (this.droneType === 'MINE') droneItemKey = 'mine_drone';
                            if (this.droneType === 'BUILD') droneItemKey = 'builder_drone'; // 建筑无人机如果也消耗物品的话
                            
                            if (InventoryManager) {
                                InventoryManager.addCargo(parentShip.id || parentShip.uid, droneItemKey, 1);
                            }
                        }

                        // 如果母舰是玩家船(或玩家建筑)，触发同步事件
                        if (parentShip.ownerId === 'player') {
                            import('../utils/EventBus.js').then(({ EventBus }) => {
                                if (typeof (EventBus as any).emit === 'function') {
                                    (EventBus as any).emit('player_cargo_changed');
                                }
                            });
                        }

                        // 3. 自毁此无人机实体（触发从世界中移除）
                        this.stats.hp = 0;
                    }
                }
            }
        }

        // 装备附加装甲自动回血逻辑 (无论是否脱战)
        if (this.stats.hpRegen && this.stats.hp < this.stats.maxHp) {
            this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.hpRegen * dt);
        }

        if (this.state === 'DOCKED') {
            // [修复]: 处于停泊状态的飞船不参与物理更新，但它的“任务大脑”依然需要流转（比如转移货物）
            // 否则在物理停泊完成那一刻弹出 DOCK 任务后，它就会在这里被永远短路，无法执行 TRANSFER_CARGO
            if (this.taskStack && this.taskStack.length > 0) {
                const currentTask = this.taskStack[0];
                ShipExecution.executeAtomicTask(this, currentTask, dt, worldState);
            }
            return; 
        }

        // --- OOS 引擎接管纯后台推演 ---
        if (!isActiveSim) {
            // 如果玩家不在这个星系，把这艘船扔给 OOSSimulator 去算移动和打架
            OOSSimulator.updateShipOOS(this, dt, worldState, allShips);
        } else {
            // 如果玩家在这个星系（活跃模拟），只处理战斗脱战状态，移动和打架交给 Base.ts 微观实体
            if (this.state === 'COMBAT' && this.combatTimer <= 0) {
                this.state = 'IDLE';
            }
            // --- 活跃星系中如果飞船正在跨星区跃迁(出发/到达阶段)，依然借用 OOS 引擎更新一点进度 ---
            if (['DEPARTURE', 'WARP', 'TRANSIT', 'ARRIVAL'].includes(this.state)) {
                 // 仅仅借助 OOS 的逻辑跑一下 warp 进度条
                 // 但注意，活跃星系的 departure 可能会被 Phaser 的碰撞体积接管，所以这里调用要慎重
                 // 鉴于旧版逻辑，如果在活跃星区，跃迁状态由 forceCompleteTravel 碰撞触发
                 
                 // 如果是纯 WARP 状态，必须借用 OOS 推进进度条，否则玩家飞船永远卡在 WARP 里无法出界
                 if (this.state === 'WARP') {
                     import('./oos/OOS-Travel.js').then(module => {
                         module.updateTravel(this, dt, worldState);
                     });
                 }
            }
        }

        // --- 核心分发层 (Decision Layer): 基于原子任务栈 (Task Stack) ---
        // 这一层不涉及具体的坐标计算，所以无论是 IS 还是 OOS 都可以共用
        if (this.state === 'IDLE' && this.combatTimer <= 0) {
            // 委托给决策模块处理“要去做什么”
            ShipDecision.process(this, worldState);

            // 任务执行模块：委托给执行模块处理“怎么做”
            if (this.taskStack && this.taskStack.length > 0) {
                const currentTask = this.taskStack[0];
                ShipExecution.executeAtomicTask(this, currentTask, dt, worldState);
            }

            // 如果被上述分发逻辑赋予了跨星区路径，正式切入执行状态
            if (this.path && this.path.length > 0 && this.state !== ('DEPARTURE' as any)) {
                this.state = 'DEPARTURE';
                this.travelProgress = 0;
                this.targetGate = this.path[0];
            }
        }
    }

    // 已将 OOS 位移与跃迁推演算法全部剪切至 OOSSimulator.ts 统一维护

    // 暴露一个公共方法给 Base.js，当物理碰撞到星门或到达停泊点时调用
    forceCompleteTravel(worldState) {
        console.log(`[跃迁调试] 强制完成旅程状态流转：飞船 ${this.id}, 当前状态: ${this.state}`);
        if (this.state === 'DEPARTURE' || this.state === 'TRANSIT') {
            triggerWarp(this, worldState);
        } else if (this.state === 'ARRIVAL') {
            this.state = 'IDLE';
            this.travelProgress = 0;
        }
    }
}

export class ShipManager {
    static ships: Ship[] = [];
    static dockingRegistries: Record<string, Set<string>> = {}; // Map<HostID, Set<ShipID>> 内存级索引，不直接序列化，而是init时重建
    static activeSimulationSectors: string[] = []; // 新增：当前正在被前端全量物理模拟的星区
    static fleets: any[] = []; // 新增：存储NPC阵营的宏观舰队编制

    static reset() {
        this.ships = [];
        this.fleets = [];
        this.dockingRegistries = {};
        this.activeSimulationSectors = [];
    }

    static setActiveSectors(sectors) {
        this.activeSimulationSectors = sectors;
    }

    static init() {
        let saved = localStorage.getItem('ship_data');
        let currentSector = localStorage.getItem('current_sector');

        if (saved) {
            try {
                const rawData = JSON.parse(saved);
                this.ships = rawData.map(d => new Ship(d));
                
                // 重建停泊索引
                this.ships.forEach(s => {
                    if (s.dockedAt) {
                        if (!this.dockingRegistries[s.dockedAt]) this.dockingRegistries[s.dockedAt] = new Set();
                        this.dockingRegistries[s.dockedAt].add(s.id);
                    }
                });
                
                console.log(`[ShipManager] Loaded ${this.ships.length} ships from galaxy state.`);
            } catch (e) {
                console.error('Failed to load ship data', e);
                this.ships = [];
            }
        } else {
            this.ships = [];
        }

        // --- 核心同步：将玩家资产库中的飞船投射到宏观宇宙 ---
        try {
            const rawOwned = localStorage.getItem('player_owned_ships');
            const playerShipId = localStorage.getItem('player_ship_id');
            let currentSector = localStorage.getItem('current_sector');

            if (rawOwned) {
                const ownedShips = JSON.parse(rawOwned);
                
                // 1. 增/改：确保每一艘玩家拥有的船都在宇宙中有实体
                ownedShips.forEach(pShip => {
                    let macroShip = this.ships.find(s => s.id === pShip.id);
                    
                    if (!macroShip) {
                        // 如果宏观宇宙里没有，创建它（默认为闲置）
                        console.log(`[ShipManager] Syncing player ship ${pShip.name} to macro universe...`);
                        
                        // 优先使用记录的位置，如果没有则丢到当前星区
                        let spawnLoc = pShip.location || { sector: currentSector, x: 500, y: 300 };
                        if (!spawnLoc.sector) spawnLoc.sector = currentSector;

                        macroShip = new Ship({
                            id: pShip.id,
                            name: pShip.name,
                            hullId: pShip.hullId,
                            type: 'fighter', // 默认为战机，recalculateStats 会根据 hullId 修正
                            ownerId: 'player',
                            factionId: 0,
                            location: spawnLoc,
                            loadout: pShip.slots || {}, // 映射 slots -> loadout
                            droneEquips: pShip.droneEquips || {}, // 同步无人机配置
                            state: 'IDLE',
                            behavior: 'IDLE',
                            stats: { hp: pShip.hp, maxHp: pShip.maxHp || 100 }
                        });
                        this.ships.push(macroShip);
                        console.log(`[ShipManager] Successfully created macro ship for player: ${macroShip.id}`);
                    } else {
                        // 如果已有，同步关键配置（防止玩家在机库改了配件但宏观实体没变）
                        macroShip.hullId = pShip.hullId;
                        macroShip.loadout = pShip.slots || {};
                        macroShip.droneEquips = pShip.droneEquips || {}; // 同步无人机配置
                        
                        // 确保同步后补齐状态
                        for (const slotId in macroShip.droneEquips) {
                            if (!macroShip.droneStates[slotId]) {
                                macroShip.droneStates[slotId] = 'IDLE';
                            }
                        }

                        macroShip.recalculateStats(); // 刷新属性
                        
                        // 同步血量（以谁为准？通常微观战斗后会更新 ownedShips，所以以 ownedShips 为准）
                        // 但如果 ownedShips 只是存档，而宏观正在跑... 暂时以 ownedShips 为主
                        if (pShip.hp !== undefined) macroShip.stats.hp = pShip.hp;
                    }
                });

                // 2. 删：清理那些玩家已经卖掉但还残留的宏观实体
                const validIds = new Set(ownedShips.map(s => s.id));
                const beforeCount = this.ships.length;
                this.ships = this.ships.filter(s => {
                    // 如果是玩家的船，但不在资产库里，并且不是无人机（因为无人机作为消耗品不记录在玩家资产库），则说明是已出售/销毁的幽灵船
                    if (s.ownerId === 'player' && !validIds.has(s.id) && s.type !== 'drone') {
                        console.log(`[ShipManager] Removing ghost ship ${s.name} (sold/destroyed).`);
                        return false;
                    }
                    return true;
                });
                
                if (this.ships.length !== beforeCount) {
                    this.save();
                }
                console.log(`[ShipManager] Player ships sync complete. Total ships in universe: ${this.ships.length}`);
            } else {
                console.warn("[ShipManager] 警告：没有找到 player_owned_ships 数据！");
            }
        } catch (e) {
            console.error('[ShipManager] Sync player ships failed:', e);
        }
    }

    // 临时方法：清空所有飞船并保存
    static clearAllShips() {
        this.ships = [];
        this.fleets = [];
        this.save();
        console.log(`[ShipManager] 所有飞船已被清空。`);
    }

    static save() {
        localStorage.setItem('ship_data', JSON.stringify(this.ships));
        localStorage.setItem('ai_fleet_data', JSON.stringify(this.fleets));
    }

    static createShip(template) {
        // [NPC注入] 如果没有明确指定 ownerId，并且不是玩家的船，且有 factionId
        if (template.ownerId === undefined && template.factionId !== undefined && template.factionId !== 0 && template.factionId !== '0') {
            const npcId = NPCManager.getInstance().assignOrGetNPCForEntity(template.factionId);
            template.ownerId = npcId;
        }

        const ship = new Ship(template);
        
        // 注册到 NPC 资产中
        if (ship.ownerId && ship.ownerId !== 'player' && isNaN(Number(ship.ownerId))) {
            NPCManager.getInstance().addOwnedShip(ship.ownerId, ship.id);
        }

        this.ships.push(ship);
        this.save();
        return ship;
    }

    static removeShip(shipId) {
        const ship = this.getShipById(shipId);
        if (ship && ship.ownerId && ship.ownerId !== 'player' && isNaN(Number(ship.ownerId))) {
            // 从 NPC 名下移除
            NPCManager.getInstance().removeOwnedShip(ship.ownerId, shipId);
        }

        this.ships = this.ships.filter(s => s.id !== shipId);
        this.save();
    }

    static update(dt, worldState) {
        // --- 处理玩家舰队的宏观寻路同步 (真实跨星区跟随) ---
        const rawFleets = localStorage.getItem('player_fleets');
        const playerShipId = localStorage.getItem('player_ship_id');
        
        if (rawFleets) {
            try {
                const fleets = JSON.parse(rawFleets);
                fleets.forEach(fleet => {
                    if (!fleet.flagshipId) return;
                    
                    const flagship = this.ships.find(s => s.id === fleet.flagshipId);
                    if (!flagship) return;
                    
                    fleet.members.forEach(memberId => {
                        const memberShip = this.ships.find(s => s.id === memberId);
                        if (!memberShip) return;

                        if (memberShip.location.sector !== flagship.location.sector) {
                            // [Fix] 检查该僚机是否处于玩家特派的“异地驻防”状态 (DEPLOYED)
                            // 如果是，则不受自动召回逻辑影响，允许它长期停留在异地星区
                            const isDeployed = memberShip.orderQueue && memberShip.orderQueue.length > 0 && memberShip.orderQueue[0].status === 'DEPLOYED';
                            if (isDeployed) return;

                            // 如果已经在路上了，且目标就是旗舰当前星区，就不需要反复重新算路
                            const isAlreadyHeadingThere = memberShip.path && memberShip.path.length > 0 && memberShip.orderQueue && memberShip.orderQueue[0] && memberShip.orderQueue[0].targetSector === flagship.location.sector;
                            
                            if (!isAlreadyHeadingThere && !memberShip.isPathfinding && (memberShip.state === 'IDLE' || memberShip.state === 'DOCKED')) {
                                // 如果它正停泊在某处，强制踢出机库以追随旗舰
                                if (memberShip.dockedAt) {
                                    ShipManager.undockShip(memberShip.id, { x: 500, y: 275, sector: memberShip.location.sector });
                                }
                                
                                memberShip.orderQueue = [{ status: 'FOLLOW', targetSector: flagship.location.sector }];
                                memberShip.isPathfinding = true; // [修复] 互斥锁，防止异步死循环
                                
                                import('../scenes/WorldbookManager.js').then(module => {
                                    const startNode = worldState.sectors.find(s => s.name === memberShip.location.sector);
                                    const endNode = worldState.sectors.find(s => s.name === flagship.location.sector);
                                    if (startNode && endNode) {
                                        const pathNodes = module.WorldbookManager.getStarlanePath(startNode, endNode, worldState.sectors);
                                        if (pathNodes && pathNodes.length > 1) {
                                            memberShip.path = pathNodes.map(n => n.name).slice(1);
                                        }
                                    }
                                    memberShip.isPathfinding = false; // 解除锁
                                }).catch(() => {
                                    memberShip.isPathfinding = false;
                                });
                            }
                        } else {
                            // 如果在同一个星区，清空跨星系寻路订单
                            if (memberShip.orderQueue && memberShip.orderQueue.length > 0 && memberShip.orderQueue[0].status === 'FOLLOW') {
                                memberShip.orderQueue = [];
                                memberShip.path = [];
                            }
                        }
                    });
                });
            } catch (e) { console.error('[ShipManager] Fleet sync error:', e); }
        }

        const activeSectors = this.activeSimulationSectors || [];
        this.ships.forEach(ship => ship.update(dt, worldState, this.ships, activeSectors));
        
        // 彻底清理被打死（HP<=0）的飞船，防止在前端无限复活
        const beforeCount = this.ships.length;
        this.ships = this.ships.filter(ship => ship.stats.hp > 0);
        
        // 如果有飞船被清理，自动保存一次状态
        if (this.ships.length !== beforeCount) {
            // 同步清理 AI 舰队中死亡的成员
            let fleetsChanged = false;
            this.fleets.forEach(fleet => {
                const oldLen = fleet.members.length;
                fleet.members = fleet.members.filter(id => this.getShipById(id) !== undefined);
                if (fleet.flagshipId && this.getShipById(fleet.flagshipId) === undefined) {
                    // 如果旗舰死了，推举下一艘船作为新旗舰，或者解散舰队
                    if (fleet.members.length > 0) {
                        fleet.flagshipId = fleet.members[0];
                    } else {
                        fleet.flagshipId = null;
                    }
                }
                if (oldLen !== fleet.members.length) fleetsChanged = true;
            });
            
            // 清理已解散（无成员）的舰队
            const oldFleetCount = this.fleets.length;
            this.fleets = this.fleets.filter(f => f.members.length > 0);
            if (oldFleetCount !== this.fleets.length) fleetsChanged = true;
            
            this.save();
        }
    }

    static getShipsInSector(sectorName) {
        // 任何处于当前星区内、且没有进入深空折跃（WARP）的飞船，都应该被视为物理实体
        // [修改]：移除了 dockedAt 的拦截，允许已停泊的飞船进入物理雷达渲染层
        return this.ships.filter(s => 
            s.location.sector === sectorName && 
            s.state !== 'WARP'
        ); 
    }

    // 获取所有正在 WARP 中的飞船（用于宏观星图渲染）
    static getShipsInWarp() {
        return this.ships.filter(s => s.state === 'WARP' && s.currentLane);
    }

    static getVisibleTransitsInSector(sectorName: string) {
        return this.ships.filter(s => 
            s.location.sector === sectorName && 
            (s.state === 'DEPARTURE' || s.state === 'TRANSIT' || s.state === 'ARRIVAL')
        );
    }

    // 通过 ID 获取特定的飞船实例
    static getShipById(shipId) {
        return this.ships.find(s => s.id === shipId);
    }

    // 统合舰队查询接口：无论是玩家的舰队还是 AI 的舰队，都能返回统一格式的 Fleet 对象
    static getFleetByShipId(shipId) {
        // 1. 先查玩家的编队
        try {
            const rawFleets = localStorage.getItem('player_fleets');
            if (rawFleets) {
                const pFleets = JSON.parse(rawFleets);
                const pFleet = pFleets.find(f => f.flagshipId === shipId || f.members.includes(shipId));
                if (pFleet) return pFleet;
            }
        } catch (e) {
            console.error('[ShipManager] Error reading player fleets in getFleetByShipId:', e);
        }
        
        // 2. 再查 AI 的编队
        if (this.fleets) {
            return this.fleets.find(f => f.flagshipId === shipId || f.members.includes(shipId));
        }
        return null;
    }

    // 动态创建一个 AI 舰队（供将来生成器或命令调用）
    static createAIFleet(factionId, flagshipId, memberIds) {
        const fleetId = `fleet_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const fleet = {
            fleetId: fleetId,
            factionId: factionId,
            flagshipId: flagshipId,
            members: memberIds || []
        };
        this.fleets.push(fleet);
        this.save();
        return fleet;
    }

    // --- 停泊系统核心接口 ---

    // 全局通用的泊位分配逻辑 (提自 Base-Docking.ts)
    static allocateDockingBerth(moduleId, shipId) {
        let mod = BuildingManager.getAllModules().find(m => m.uid === moduleId);
        if (!mod) {
            mod = BuildingManager.getAllModules().find(m => {
                const data = (GameConfig as any).MODULES[m.moduleId];
                return data && data.berths && data.berths.length > 0;
            });
        }
        
        if (!mod) return null;

        const modData = (GameConfig as any).MODULES[mod.moduleId];
        if (!modData || !modData.berths || modData.berths.length === 0) return null;

        // 找出所有已经被占用的泊位 ID
        const occupiedBerthIds = [];
        // 在新版逻辑里，如果一艘船停泊了，或者它正在前去停泊(有 approachingDock 或者 dockingGuidanceTarget)，我们都认为占用了泊位
        this.ships.forEach(s => {
            if (s.dockedAt === mod.uid && s.dockedBerthId) {
                occupiedBerthIds.push(s.dockedBerthId);
            } else if (s.approachingDock === mod.uid && s.dockedBerthId) {
                occupiedBerthIds.push(s.dockedBerthId);
            } else if (s.dockingGuidanceTarget && s.dockingGuidanceTarget.targetId === mod.uid) {
                occupiedBerthIds.push(s.dockingGuidanceTarget.berthId);
            }
        });

        for (const berth of modData.berths) {
            if (!occupiedBerthIds.includes(berth.id)) {
                // 找到空位，直接在这里给这艘船打上预占标记
                const ship = this.getShipById(shipId);
                if (ship) {
                    ship.approachingDock = mod.uid;
                    ship.dockedBerthId = berth.id;
                    this.save();
                }
                return berth.id;
            }
        }
        return null;
    }

    // 飞船入库
    static dockShip(shipId, hostId, berthId = null) {
        const ship = this.getShipById(shipId);
        if (!ship) return false;

        // 如果已经在别的地方，先出来
        if (ship.dockedAt) this.undockShip(shipId);

        ship.dockedAt = hostId;
        ship.dockedBerthId = berthId; // 记录泊位 ID 供渲染使用
        ship.approachingDock = null; // 清除预占标记
        ship.state = 'DOCKED';
        
        // 更新索引
        if (!this.dockingRegistries[hostId]) this.dockingRegistries[hostId] = new Set();
        this.dockingRegistries[hostId].add(shipId);
        
        console.log(`[ShipManager] ⚓ Ship ${ship.name} docked at ${hostId} (Berth: ${berthId || 'Unknown'})`);
        this.save();
        return true;
    }

    // 飞船出库
    static undockShip(shipId, spawnLocation = null) {
        const ship = this.getShipById(shipId);
        if (!ship || !ship.dockedAt) return false;

        const hostId = ship.dockedAt;
        
        // 从索引移除
        if (this.dockingRegistries[hostId]) {
            this.dockingRegistries[hostId].delete(shipId);
        }

        // [修复] 同时清理全局物理引擎的登记表，防止UI读到残留脏数据
        if (typeof window !== 'undefined' && (window as any).BerthRegistry && (window as any).BerthRegistry[shipId]) {
            delete (window as any).BerthRegistry[shipId];
        }

        ship.dockedAt = null;
        ship.dockedBerthId = null; // 清除泊位记录
        ship.approachingDock = null;
        ship.state = 'IDLE'; // 恢复为闲置状态，等待 AI 或玩家控制
        
        // 如果提供了新的出生点坐标，应用之
        if (spawnLocation) {
            ship.location.x = spawnLocation.x;
            ship.location.y = spawnLocation.y;
            // 确保扇区位置正确
            if (spawnLocation.sector) spawnLocation.sector = spawnLocation.sector;
        }

        console.log(`[ShipManager] 🚀 Ship ${ship.name} undocked from ${hostId}`);
        this.save();
        return true;
    }

    // 查询某容器内的所有飞船
    // 强制清除某艘船的泊位预占标记 (供打断指令时调用)
    static clearDockingGuidance(shipId) {
        const ship = this.getShipById(shipId);
        if (ship) {
            ship.approachingDock = null;
            if (!ship.dockedAt) {
                // 只有当船没真停泊时，才清空 dockedBerthId (真停泊的依然要保留，等出库时清)
                ship.dockedBerthId = null;
            }
            
            // [修复] 打断指令时，如果物理层存在预期停靠残留记录，一并销毁停车小票
            if (typeof window !== 'undefined' && (window as any).BerthRegistry && (window as any).BerthRegistry[shipId]) {
                delete (window as any).BerthRegistry[shipId];
            }
            
            this.save();
        }
    }

    static getDockedShips(hostId) {
        if (!(this.dockingRegistries as any)[hostId]) return [];
        return Array.from((this.dockingRegistries as any)[hostId])
            .map(id => this.getShipById(id))
            .filter(s => s !== undefined);
    }

    // --- 无人机通用生成接口 ---
    static spawnDrone(options: any) {
        const { parentId, droneType, hullId, ownerId, factionId, location, loadout } = options;
        
        let actualHullId = hullId || 'repair_drone_preset'; // 兜底
        let actualLoadout = loadout;

        // 如果 hullId 是一个预设名，则解包
        if (GameConfig.FACTION_PRESETS[actualHullId]) {
            const preset = GameConfig.FACTION_PRESETS[actualHullId];
            actualHullId = preset.hullId;
            if (!actualLoadout) {
                actualLoadout = JSON.parse(JSON.stringify(preset.slots));
            }
        }

        // 如果没有提供装备，给建造无人机装配基础的建筑光束
        if (!actualLoadout && droneType === 'BUILD') {
            actualLoadout = { "W1": "builder_beam_mk1" };
        }

        const drone = this.createShip({
            type: 'drone',
            droneType: droneType || 'GENERAL',
            hullId: actualHullId,
            ownerId: ownerId !== undefined ? ownerId : factionId,
            factionId: factionId || 0,
            parentId: parentId,
            location: location || { sector: '未知', x: 500, y: 275 },
            state: 'IDLE',
            loadout: actualLoadout
        });

        return drone;
    }

    // --- 无人机新版槽位控制接口 ---
    
    // 装备无人机到槽位
    static equipDrone(shipId: string, slotId: string, itemKey: string) {
        const ship = this.getShipById(shipId);
        if (!ship) return false;
        
        // 检查并扣除货舱物品
        const InventoryManager = (window as any).InventoryManager;
        if (InventoryManager) {
            const inv = InventoryManager.getInventory(shipId);
            if (!inv[itemKey] || inv[itemKey] < 1) return false;
            InventoryManager.removeCargo(shipId, itemKey, 1);
        }
        
        if (!ship.droneEquips) ship.droneEquips = {};
        if (!ship.droneStates) ship.droneStates = {};
        
        ship.droneEquips[slotId] = itemKey;
        ship.droneStates[slotId] = 'IDLE';
        this.save();
        
        // 触发 UI 刷新
        document.dispatchEvent(new Event('DRONE_STATE_CHANGED'));
        return true;
    }
    
    // 卸载无人机
    static unequipDrone(shipId: string, slotId: string) {
        const ship = this.getShipById(shipId);
        if (!ship || !ship.droneEquips || !ship.droneEquips[slotId]) return false;
        if (ship.droneStates && ship.droneStates[slotId] !== 'IDLE') return false; // 工作中不能卸载
        
        const itemKey = ship.droneEquips[slotId];
        
        // 归还到货舱
        const InventoryManager = (window as any).InventoryManager;
        if (InventoryManager) {
            InventoryManager.addCargo(shipId, itemKey, 1);
        }
        
        delete ship.droneEquips[slotId];
        if (ship.droneStates) delete ship.droneStates[slotId];
        this.save();
        
        document.dispatchEvent(new Event('DRONE_STATE_CHANGED'));
        return true;
    }
    
    // 发射无人机 (工作)
    static launchDrone(shipId: string, slotId: string) {
        const parent = this.getShipById(shipId);
        if (!parent || !parent.droneEquips || !parent.droneEquips[slotId]) return false;
        if (parent.droneStates && parent.droneStates[slotId] !== 'IDLE') return false;
        
        const itemKey = parent.droneEquips[slotId];
        
        // 解析无人机类型
        let droneType = 'ATTACK';
        let presetKey = 'attack_drone_gongji';
        
        if (itemKey === 'mine_drone') {
            droneType = 'MINE';
            presetKey = 'mine_drone_preset';
        } else if (itemKey === 'builder_drone') {
            droneType = 'BUILD';
        }
        
        const preset = GameConfig.FACTION_PRESETS[presetKey] || GameConfig.FACTION_PRESETS['attack_drone_gongji'];
        
        // 生成实体
        const drone = this.spawnDrone({
            droneType: droneType,
            hullId: preset.hullId,
            loadout: preset.slots,
            ownerId: parent.ownerId,
            factionId: parent.factionId, 
            parentId: parent.id,
            location: {
                sector: parent.location.sector,
                x: parent.location.x + (Math.random() * 40 - 20),
                y: parent.location.y + (Math.random() * 40 - 20)
            }
        });
        
        // 标记它是从哪个槽位出来的
        drone.sourceSlotId = slotId;
        
        // 更新母舰状态
        if (!parent.activeDrones) parent.activeDrones = {};
        parent.activeDrones[slotId] = drone.id;
        parent.droneStates[slotId] = 'WORKING';
        
        this.save();
        
        document.dispatchEvent(new Event('DRONE_STATE_CHANGED'));
        return true;
    }
    
    // 召回无人机 (待命)
    static recallDrone(shipId: string, slotId: string) {
        const parent = this.getShipById(shipId);
        if (!parent || !parent.droneStates || parent.droneStates[slotId] !== 'WORKING') return false;
        
        const droneId = parent.activeDrones ? parent.activeDrones[slotId] : null;
        if (droneId) {
            const drone = this.getShipById(droneId);
            if (drone) {
                drone.isReturning = true;
                // 打断当前任务
                drone.orderQueue = [];
                drone.taskStack = [];
                drone.state = 'IDLE'; 
                console.log(`[ShipManager] 强制召回无人机: ${drone.id}`);
            }
        }
        
        parent.droneStates[slotId] = 'RETURNING';
        this.save();
        
        document.dispatchEvent(new Event('DRONE_STATE_CHANGED'));
        return true;
    }

    // 给玩家专用的独立 recalculateStats (为了代码复用，挂载到 ShipManager)
    static recalculateStats(playerData) {
        // 如果玩家旧存档还在用老蓝图名字，自动洗成新版底盘名
        if (playerData.hullId === 'fighter_basic') playerData.hullId = 'hull_alliance_s';
        if (playerData.hullId === 'freighter_small' || playerData.hullId === 'freighter_basic') playerData.hullId = 'hull_freighter_s';

        if (!playerData.hullId) return;
        const hullDef = GameConfig.HULLS[playerData.hullId];
        if (!hullDef) return;

        if (!playerData.stats) playerData.stats = { hp: hullDef.baseHp };
        
        playerData.stats.maxHp = hullDef.baseHp;
        playerData.stats.mass = hullDef.mass || 10;
        playerData.stats.drag = hullDef.drag || 0.15;
        playerData.stats.thrust = 0;
        playerData.stats.turnThrust = 0;
        playerData.stats.speed = 0;
        playerData.stats.hpRegen = 0;
        
        let fireRateMultiplier = 1.0;

        // 重置玩家面板的基础属性
        playerData.maxInventory = hullDef.maxInventory;
        
        // --- 玩家的装配与 AI 统一，现算 activeWeapons ---
        playerData.activeWeapons = [];

        if (!playerData.slots) return;

        for (const [slotId, compId] of Object.entries(playerData.slots)) {
            if (!compId) continue;
            const slotDef = hullDef.slots[slotId];
            const compDef = GameConfig.COMPONENTS[compId as string];
            if (!slotDef || !compDef) continue;

            if (compDef.type === 'defense') {
                if (compDef.stats.hpBonus) playerData.stats.maxHp += compDef.stats.hpBonus;
                if (compDef.stats.speedPenalty) playerData.stats.mass -= compDef.stats.speedPenalty;
                if (compDef.stats.hpRegen) playerData.stats.hpRegen += compDef.stats.hpRegen;
            } 
            else if (compDef.type === 'utility') {
                if (compDef.stats.inventoryBonus) playerData.maxInventory += compDef.stats.inventoryBonus;
            }
            else if (compDef.type === 'engine') {
                if (compDef.stats.thrust) playerData.stats.thrust += compDef.stats.thrust;
                if (compDef.stats.turnThrust) playerData.stats.turnThrust += compDef.stats.turnThrust;
            }
            else if (compDef.type === 'core') {
                if (compDef.stats.fireRateMultiplier) fireRateMultiplier *= compDef.stats.fireRateMultiplier;
            }
            else if (compDef.type === 'weapon') {
                let isTurretFlag = (slotDef.isTurret === true);
                let renderSprite = 'none';
                let spriteSize = { width: 5, height: 5 };
                let origin = { x: 2.5, y: 2.5 };
                let imgRotOffset = 0;

                if (isTurretFlag) {
                    renderSprite = hullDef.turretBaseSprite || 'empire_turret.png';
                    spriteSize = hullDef.turretBaseSize || { width: 5, height: 5 };
                    origin = hullDef.turretBaseOrigin || { x: 2.5, y: 2.5 };
                    imgRotOffset = hullDef.turretBaseRotOffset || 0;
                } else {
                    renderSprite = compDef.meta?.sprite || compDef.sprite || 'none';
                }

                playerData.activeWeapons.push({
                    slotId: slotId,
                    compId: compId,
                    x: slotDef.x || 0,
                    y: slotDef.y || 0,
                    isTurret: isTurretFlag,
                    sprite: renderSprite,
                    spriteSize: spriteSize,
                    origin: origin,
                    imgRotOffset: imgRotOffset,
                    cooldown: 0,
                    rotation: 0,
                    type: compDef.type,
                    subType: compDef.subType,
                    stats: { ...compDef.stats }
                });
            }
        }
        
        // 应用全局射速增益
        playerData.activeWeapons.forEach(w => {
            if (w.stats.fireRate) {
                w.stats.fireRate *= fireRateMultiplier;
            }
        });
        
        // 限制当前血量不要溢出
        if (playerData.stats.hp > playerData.stats.maxHp) {
            playerData.stats.hp = playerData.stats.maxHp;
        }
    }
}

if (typeof window !== 'undefined') {
    (window as any).ShipManager = ShipManager;
}
