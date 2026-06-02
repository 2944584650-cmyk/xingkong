import { ShipManager } from '../../managers/ShipManager.js';
import { GameConfig } from '../../config.js';
import { InventoryManager } from '../../managers/InventoryManager.js';

/**
 * 订单系统数据结构
 */
export interface BaseOrder {
    id: string;
    type: 'BUILD' | 'TRANSPORT' | 'COMBAT' | 'PATROL';
    factionId: number;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    timestamp: number;
}

export interface BuildOrder extends BaseOrder {
    type: 'BUILD';
    payload: {
        hullId: string;
        // 在未来的扩展中，这里可以添加装备配置 loadout，目前先留空采用默认配置
        loadout?: any;
    };
}

export interface TransportOrder extends BaseOrder {
    type: 'TRANSPORT';
    payload: {
        sourceSector?: string;
        targetSector?: string;
        cargoType?: string;
        amount?: number;
    };
}

export interface CombatOrder extends BaseOrder {
    type: 'COMBAT';
    payload: {
        targetSector: string; // 防卫目标星区
        targetId?: string;    // 如果有特定的刺杀目标
        priority?: number;
        assigneeId?: string;  // 哪个飞船接取了该订单
    };
}

export interface PatrolOrder extends BaseOrder {
    type: 'PATROL';
    payload: {
        targetSector: string; // 巡逻目标星区
        duration: number;     // 需要驻留的秒数
        assigneeId?: string;  // 哪个飞船接取了该订单
        startTime?: number;   // 飞船到达目标地点的开始计时时间
    };
}

export type Order = BuildOrder | TransportOrder | CombatOrder | PatrolOrder;

/**
 * 订单总类存储库 (OrderSystem)
 * 包容所有的订单数据，提供增删改查接口，操作直接作用于 worldState 保证存档同步
 */
export class OrderSystem {
    /**
     * 添加新订单
     */
    static addOrder(worldState: any, order: Order) {
        if (!worldState.orders) worldState.orders = [];
        worldState.orders.push(order);
    }

    /**
     * 读取/获取订单数据
     */
    static getOrders(worldState: any, filter?: (o: Order) => boolean): Order[] {
        if (!worldState.orders) worldState.orders = [];
        return filter ? worldState.orders.filter(filter) : worldState.orders;
    }

    /**
     * 收到订单接取反馈后，删除该订单
     */
    static removeOrder(worldState: any, orderId: string) {
        if (!worldState.orders) return;
        worldState.orders = worldState.orders.filter((o: any) => o.id !== orderId);
    }
}

/**
 * 阵营底盘预设映射表，用于自动生成建造订单
 */
const FACTION_PRESET_MAP: Record<number, { fighter: string, destroyer: string }> = {
    1: { fighter: 'empire_fighter', destroyer: 'empire_destroyer' },
    2: { fighter: 'alliance_fighter', destroyer: 'alliance_destroyer' },
    3: { fighter: 'scavenger_fighter', destroyer: 'pirate_destroyer' },
    4: { fighter: 'cult_fighter', destroyer: 'cult_destroyer' }
};

/**
 * 宏观订单处理逻辑 (由 WorldbookManager.tickWorld() 每 10 秒调用一次)
 */
export function processMacroOrders(worldState: any, now: number, wbManager?: any) {
    if (!worldState.orders) worldState.orders = [];

    // 分别处理各个模块的宏观订单生成与状态维护
    processBuildOrders(worldState, now);
    processTransportOrders(worldState, now);
    processCombatOrders(worldState, now, wbManager);
    processPatrolOrders(worldState, now, wbManager);
}

// ============================================================================
// 模块 1: 建造订单 (Build Orders)
// 职责: 维持各个阵营的基础舰队数量，不足时下发造船订单。
// ============================================================================
function processBuildOrders(worldState: any, now: number) {
    // 目标：每隔10秒检索各个阵营的飞船情况，如果不满足 20战机，10驱逐，则往存储库发送缺失数量的订单。
    
    // 1. 统计当前全宇宙的飞船归属
    // 这里简单地合并本地内存中激活的飞船和 worldState.ships 中挂起的飞船
    const factionShipCounts: Record<number, { fighter: number, destroyer: number }> = {};
    const targetFactions = [1, 2, 3, 4];
    targetFactions.forEach(fId => factionShipCounts[fId] = { fighter: 0, destroyer: 0 });
    
    // 全宇宙货船数量统计
    let totalFreighterCount = 0;

    // 统计逻辑
    const countShip = (ship: any) => {
        if (!ship) return;
        
        // 仅统计货船数量
        if (ship.type === 'freighter' || (ship.hullId && ship.hullId.includes('freighter'))) {
            totalFreighterCount++;
        }

        const facId = ship.factionId;
        if (targetFactions.includes(facId)) {
            // 根据 hullId 或者 type 判断是战机还是驱逐
            if (ship.hullId && ship.hullId.includes('destroyer')) {
                factionShipCounts[facId].destroyer++;
            } else if (ship.type === 'fighter' || (ship.hullId && ship.hullId.includes('_s'))) {
                factionShipCounts[facId].fighter++;
            }
        }
    };

    // 统计内存实体 (排除虚影)
    ShipManager.ships.forEach(s => {
        if (!s.isBuilding && s.stats.hp > 0) countShip(s);
    });

    // 统计 OOS (不在当前星区) 的持久化飞船
    if (worldState.ships) {
        worldState.ships.forEach((s: any) => countShip(s));
    }

    // 还要统计当前"已经在排队"或"尚未完成"的建造订单，防止重复下单！
    const pendingBuilds: Record<number, { fighter: number, destroyer: number }> = {};
    targetFactions.forEach(fId => pendingBuilds[fId] = { fighter: 0, destroyer: 0 });
    
    let pendingFreighterBuilds = 0;

    worldState.orders.forEach((o: any) => {
        if (o.type === 'BUILD') {
            const hull = o.payload?.hullId || '';
            // 统计排队中的货船
            if (hull.includes('freighter')) {
                pendingFreighterBuilds++;
            }
            
            if (targetFactions.includes(o.factionId)) {
                if (hull.includes('destroyer')) {
                    pendingBuilds[o.factionId].destroyer++;
                } else {
                    pendingBuilds[o.factionId].fighter++;
                }
            }
        }
    });

    // 2. 根据统计结果，生成补充订单
    
    // 2.1 全局货船补齐逻辑 (目标: 50 艘)
    const missingFreighters = Math.max(0, 50 - totalFreighterCount - pendingFreighterBuilds);
    if (missingFreighters > 0) {
        for (let i = 0; i < missingFreighters; i++) {
            // 随机分配给 1-4 阵营或 0(中立商人)
            const randomFaction = Math.floor(Math.random() * 5); // 0, 1, 2, 3, 4
            const presetKey = 'basic_freighter';
            const preset = GameConfig.FACTION_PRESETS[presetKey];
            
            const order: BuildOrder = {
                id: `order_build_freighter_${randomFaction}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                type: 'BUILD',
                factionId: randomFaction,
                status: 'PENDING',
                timestamp: now,
                payload: {
                    hullId: preset ? preset.hullId : presetKey,
                    loadout: preset ? JSON.parse(JSON.stringify(preset.slots)) : {}
                }
            };
            OrderSystem.addOrder(worldState, order);
        }
    }
    targetFactions.forEach(fId => {
        const counts = factionShipCounts[fId];
        const pending = pendingBuilds[fId];
        const mapping = FACTION_PRESET_MAP[fId];
        if (!mapping) return;

        // 缺口 = 目标值(20) - 现存值 - 已经下单还没造出来的
        const missingFighters = Math.max(0, 20 - counts.fighter - pending.fighter);
        const missingDestroyers = Math.max(0, 10 - counts.destroyer - pending.destroyer);

        for (let i = 0; i < missingFighters; i++) {
            const presetKey = mapping.fighter;
            const preset = GameConfig.FACTION_PRESETS[presetKey];
            const order: BuildOrder = {
                id: `order_build_${fId}_fighter_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                type: 'BUILD',
                factionId: fId,
                status: 'PENDING',
                timestamp: now,
                payload: {
                    hullId: preset ? preset.hullId : presetKey,
                    loadout: preset ? JSON.parse(JSON.stringify(preset.slots)) : {}
                }
            };
            OrderSystem.addOrder(worldState, order);
            // console.log(`[订单系统] 阵营 ${fId} 战机数量不足(${counts.fighter}/20)，已下发战机建造订单: ${order.id}`);
        }

        for (let i = 0; i < missingDestroyers; i++) {
            const presetKey = mapping.destroyer;
            const preset = GameConfig.FACTION_PRESETS[presetKey];
            const order: BuildOrder = {
                id: `order_build_${fId}_destroyer_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                type: 'BUILD',
                factionId: fId,
                status: 'PENDING',
                timestamp: now,
                payload: {
                    hullId: preset ? preset.hullId : presetKey,
                    loadout: preset ? JSON.parse(JSON.stringify(preset.slots)) : {}
                }
            };
            OrderSystem.addOrder(worldState, order);
            // console.log(`[订单系统] 阵营 ${fId} 驱逐舰数量不足(${counts.destroyer}/10)，已下发驱逐舰建造订单: ${order.id}`);
        }
    });
}

// ============================================================================
// 模块 2: 运输订单 (Transport Orders)
// ============================================================================
function processTransportOrders(worldState: any, now: number) {
    // 目标：遍历所有带有内部工厂模块的空间站，计算资源消耗速度
    // 当某种资源在接下来的10分钟(600秒)内将耗光时，发布订单补足30分钟(1800秒)的数量
    
    // 获取当前所有活跃的空间站(通过内部模块池或者BuildingManager)
    const pool = worldState._transientInternalPool || [];
    if (pool.length === 0) return;

    const internalConfig = (GameConfig as any).INTERNAL_MODULES || {};
    
    // 用于记录每个空间站每种资源的每秒消耗量
    // 结构: { stationUid: { resourceId: consumptionPerSecond } }
    const consumptionRates: Record<string, Record<string, number>> = {};
    const stationFactions: Record<string, number> = {};

    pool.forEach((item: any) => {
        const { stationUid, factionId, internal } = item;
        const realInternalId = internal.moduleId || internal.id;
        const data = internalConfig[realInternalId];
        
        if (!data || data.type !== 'factory' || !data.recipe) return;
        
        if (!consumptionRates[stationUid]) consumptionRates[stationUid] = {};
        stationFactions[stationUid] = factionId;

        const cycleTime = data.recipe.cycleTime;
        for (const [res, count] of Object.entries(data.recipe.inputs)) {
            const amount = count as number;
            const perSecond = amount / cycleTime;
            
            if (!consumptionRates[stationUid][res]) consumptionRates[stationUid][res] = 0;
            consumptionRates[stationUid][res] += perSecond;
        }
    });

    // 检查库存并生成订单
    for (const [stationUid, resources] of Object.entries(consumptionRates)) {
        const inventory = InventoryManager.getInventory(stationUid);
        
        // 尝试从持久化的建筑物列表里拿到真正的 factionId
        let factionId = stationFactions[stationUid];
        if (factionId === undefined || factionId === null) {
            const station = worldState.buildings?.find((b: any) => b.uid === stationUid);
            factionId = station ? station.factionId : 0; // 默认回 0 阵营
        }

        for (const [res, ratePerSec] of Object.entries(resources)) {
            const currentStock = inventory[res] || 0;
            const timeToDeplete = currentStock / ratePerSec; // 秒

            // 如果将在 600 秒 (10 分钟) 内耗尽
            if (timeToDeplete < 600) {
                // 计算支撑 1800 秒 (30 分钟) 所需的总量
                const targetStock = Math.ceil(ratePerSec * 1800);
                const missingAmount = Math.max(0, targetStock - currentStock);

                if (missingAmount > 0) {
                    // 检查是否已经为该空间站该物资发布了足够大的运输订单
                    // (简单起见，只要有未完成的同类订单就先不下新订单)
                    const existingOrder = worldState.orders.find(
                        (o: any) => o.type === 'TRANSPORT' && 
                                    o.payload?.targetSector === stationUid && 
                                    o.payload?.cargoType === res &&
                                    o.status !== 'COMPLETED'
                    );

                    if (!existingOrder) {
                        const order: TransportOrder = {
                            id: `order_transport_${stationUid}_${res}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                            type: 'TRANSPORT',
                            factionId: factionId,
                            status: 'PENDING',
                            timestamp: now,
                            payload: {
                                targetSector: stationUid, // 目标地用 stationUid 标记
                                cargoType: res,
                                amount: missingAmount
                            }
                        };
                        OrderSystem.addOrder(worldState, order);
                        // console.log(`[订单系统] 空间站 ${stationUid} 物资 ${res} 告急 (还能撑 ${Math.floor(timeToDeplete)}秒)，已发布运输订单需求量: ${missingAmount}`);
                    }
                }
            }
        }
    }
}

// ============================================================================
// 模块 3: 战斗/防卫订单 (Combat Orders)
// 职责: 疆土防卫。当好感度低于 0 的单位进入阵营领土时，派发防卫订单。
//      当疆土内不存在此单位时，视作订单完成并撤销。
// ============================================================================
function processCombatOrders(worldState: any, now: number, wbManager?: any) {
    if (!wbManager) return;
    const targetFactions = [1, 2, 3, 4];
    
    targetFactions.forEach(fId => {
        // 获取该阵营领土内的入侵者列表
        // 返回格式: { "星区A": ["ship1", "ship2"], "星区B": ["ship3"] }
        const intrudersMap = wbManager.getIntruders(worldState, fId);
        
        // 遍历每个被入侵的星区
        for (const sector in intrudersMap) {
            // 检查是否已经为该星区发布了防卫订单
            const existingOrder = worldState.orders.find(
                (o: any) => o.type === 'COMBAT' && o.factionId === fId && o.payload?.targetSector === sector
            );
            
            if (!existingOrder) {
                // 如果没有，立刻下发紧急防卫订单
                const order: CombatOrder = {
                    id: `order_combat_${fId}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                    type: 'COMBAT',
                    factionId: fId,
                    status: 'PENDING',
                    timestamp: now,
                    payload: {
                        targetSector: sector,
                        priority: 10 // 优先级最高
                    }
                };
                OrderSystem.addOrder(worldState, order);
                // console.log(`[订单系统] 警告！阵营 ${fId} 的星区 ${sector} 侦测到敌意单位入侵，已发布防卫订单: ${order.id}`);
            }
        }
    });

    // 结算阶段：检查现有的防卫订单，如果目标星区已经没有入侵者了，注销订单
    const combatOrders = worldState.orders.filter((o: any) => o.type === 'COMBAT');
    combatOrders.forEach((order: CombatOrder) => {
        const intrudersMap = wbManager.getIntruders(worldState, order.factionId);
        const targetSector = order.payload.targetSector;
        
        if (!intrudersMap[targetSector] || intrudersMap[targetSector].length === 0) {
            // 该星区已肃清！
            // console.log(`[订单系统] 阵营 ${order.factionId} 的星区 ${targetSector} 已肃清敌对目标，防卫订单 ${order.id} 视作完成。`);
            order.status = 'COMPLETED';
            
            // 解放接单飞船
            if (order.payload.assigneeId) {
                const ShipManager = (window as any).ShipManager;
                const ship = ShipManager ? ShipManager.getShipById(order.payload.assigneeId) : null;
                if (ship) {
                    ship.assignedOrderId = null;
                    ship.taskStack = []; // 清除无限期 WAIT，变回闲置状态去接下一单
                }
            }
            
            OrderSystem.removeOrder(worldState, order.id);
        }
    });
}

// ============================================================================
// 模块 4: 常规巡逻订单 (Patrol Orders)
// 职责: 时刻保持各阵营有 10 份巡逻订单在池子里。
//      接单飞船前往指定星区驻留 5 分钟 (300 秒) 后视作订单完成。
// ============================================================================
function processPatrolOrders(worldState: any, now: number, wbManager?: any) {
    if (!wbManager) return;
    const targetFactions = [1, 2, 3, 4];
    
    targetFactions.forEach(fId => {
        // 获取阵营疆土列表
        const territory = wbManager.getTerritory(worldState, fId);
        if (territory.length === 0) return;

        // 统计该阵营现有的正在挂牌（PENDING）或执行中（IN_PROGRESS）的巡逻订单和战斗订单
        const activePatrolAndCombat = worldState.orders.filter(
            (o: any) => (o.type === 'PATROL' || o.type === 'COMBAT') && o.factionId === fId && o.status !== 'COMPLETED'
        );

        // 如果不足 10 份，随机挑选疆土星区生成巡逻订单补齐
        const missingCount = 10 - activePatrolAndCombat.length;
        if (missingCount > 0) {
            for (let i = 0; i < missingCount; i++) {
                const randomSector = territory[Math.floor(Math.random() * territory.length)];
                const order: PatrolOrder = {
                    id: `order_patrol_${fId}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                    type: 'PATROL',
                    factionId: fId,
                    status: 'PENDING',
                    timestamp: now,
                    payload: {
                        targetSector: randomSector,
                        duration: 300 // 驻留 300 秒 = 5 分钟
                    }
                };
                OrderSystem.addOrder(worldState, order);
                // console.log(`[订单系统-调试] 阵营 ${fId} 生成了新的巡逻订单: ${order.id}，目标: ${randomSector}`);
            }
        }
    });

    // 结算阶段：结算所有 IN_PROGRESS 状态的巡逻订单
    const inProgressPatrols = worldState.orders.filter(
        (o: any) => o.type === 'PATROL' && o.status === 'IN_PROGRESS'
    );

    inProgressPatrols.forEach((order: PatrolOrder) => {
        if (!order.payload.assigneeId) return;
        
        // 找到接单的飞船
        const ShipManager = (window as any).ShipManager;
        const ship = ShipManager ? ShipManager.getShipById(order.payload.assigneeId) : null;
        
        if (!ship || ship.stats.hp <= 0) {
            // 飞船沉没了，订单重新挂回大厅
            order.status = 'PENDING';
            order.payload.assigneeId = undefined;
            order.payload.startTime = undefined;
            // console.log(`[订单系统] 巡逻订单 ${order.id} 的接单飞船已销毁，订单重新挂起。`);
            return;
        }

        // 如果飞船到达了目标星区，开始计时
        if (ship.location.sector === order.payload.targetSector) {
            if (!order.payload.startTime) {
                order.payload.startTime = now;
                // console.log(`[订单系统] 飞船 ${ship.name} 已到达巡逻地 ${order.payload.targetSector}，开始 5 分钟倒计时...`);
            } else {
                const elapsedSeconds = (now - order.payload.startTime) / 1000;
                if (elapsedSeconds >= order.payload.duration) {
                    // console.log(`[订单系统] 飞船 ${ship.name} 完成了在 ${order.payload.targetSector} 的 5 分钟巡逻！订单结算！`);
                    order.status = 'COMPLETED';
                    
                    // 清空飞船身上的宏观绑定，让其回归闲置状态去接下一单
                    ship.assignedOrderId = null;
                    ship.taskStack = []; // 强制清除无限期的 WAIT，释放飞船去接下一单
                    
                    OrderSystem.removeOrder(worldState, order.id);
                }
            }
        } else {
            // 如果飞船中途离开了目标星区，计时中断 (可选逻辑，看你需要多严格)
            // 目前逻辑: 离开就会清空时间，回去得重头算 5 分钟
            if (order.payload.startTime) {
                order.payload.startTime = undefined;
            }
        }
    });
}
