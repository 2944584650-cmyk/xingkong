import { ShipManager } from '../../managers/ShipManager.js';
import { BuildingManager } from '../../managers/BuildingManager.js';
import { PlayerManager } from '../../managers/PlayerManager.js';
import { EventBus, GameEvents } from '../../utils/EventBus.js';
import { InventoryManager } from '../../managers/InventoryManager.js';
import { GameConfig } from '../../config.js';

/**
 * 接收船坞等终端的飞船建造下达事件
 * @param e 事件对象
 */
export function handleStartShipBuild(e: any) {
    const buildData = e.detail;
    
    // 【硬核阻断】：建造请求必须携带明确的星区信息，绝不再去尝试猜测玩家所在位置！
    if (!buildData.location || !buildData.location.sector) {
        console.error("[Base-Building] 建造请求被驳回：缺少明确的星区位置信息！这是非法/损坏的建筑模块发出的请求。", buildData);
        return;
    }
    
    // 底层物理管理器接管注册
    const newShip = ShipManager.createShip(buildData);
    console.log(`[建造队列] 物理底层已生成新建造中船只实体：${newShip.id}`);
}

/**
 * 处理建筑光束命中虚影时的建造进度与“破茧成蝶”生成新实体逻辑 (建筑结束实体化)
 * @param p 光束 projectile 对象
 * @returns boolean 返回 true 表示虚影已完工并转化为了实体
 */
export function finishShipBuilding(targetEntityId: string, oldRef: any, spawnX: number, spawnY: number, spawnRot: number): any {
    const tOwner = oldRef.ownerId !== undefined ? oldRef.ownerId : oldRef.factionId;
    const tFaction = oldRef.factionId !== undefined ? oldRef.factionId : tOwner;
    
    // 构造一艘全新实体的数据 (去掉了 isBuilding 和 sourceModuleId)
    const newShipData = {
        name: oldRef.name || '新造舰船',
        hullId: oldRef.hullId,
        loadout: oldRef.loadout || {}, // 宏观属性名为 loadout
        droneEquips: oldRef.droneEquips || {}, // 继承造船厂订单中携带的无人机配置
        factionId: tFaction,
        ownerId: tOwner, // 保留原有的所有权记录（可能是 'player', 也可能是具体的 npcId 或 阵营ID）
        pilotId: oldRef.pilotId, // 保留原有的驾驶员记录
        type: oldRef.type,
        location: { sector: oldRef.location?.sector || localStorage.getItem('current_sector'), x: spawnX, y: spawnY },
        rotation: spawnRot
    };

    // 彻底抹除旧的虚影实体，让船坞立刻判定为空
    ShipManager.removeShip(targetEntityId);

    // 在原地凭空刷出新的战舰
    const newShip = ShipManager.createShip(newShipData);

    // 如果是玩家的资产，自动注册入库，让玩家可以在舰队面板指挥它
    if (tOwner === 'player' && newShip) {
        const pd = PlayerManager.getStats();
        if (pd.ownedShips && !pd.ownedShips.some((s: any) => s.id === newShip.id)) {
            pd.ownedShips.push({
                id: newShip.id,
                name: newShip.name,
                hullId: newShip.hullId,
                slots: newShip.loadout || {}, // 玩家资产库使用 slots 来记录装备数据
                droneEquips: newShip.droneEquips || {}, // 玩家资产库增加无人机配置记录
                cargo: {},
                hp: newShip.stats ? newShip.stats.maxHp : 100,
                location: { sector: newShip.location.sector, x: newShip.location.x, y: newShip.location.y }
            });
            PlayerManager.saveStats(pd);
            console.log(`[资产入库] 玩家新建造的船只/模块 ${newShip.id} 已正式入列。`);
        }
    }
    
    EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:#00ffff;">[系统] 实体 ${newShip ? newShip.name : ''} 建造/组装完毕，正式服役。</div>` }));
    return newShip;
}

export function processBuildingBeamHit(p: any): boolean {
    if (!p || !p.target || !p.target.shipRef) return false;
    
    // 增加建造/修理进度，免疫伤害
    if (p.target.shipRef.isBuilding) {
        // [修改] 纯时间倒计时建造，建筑光束不再起推进作用，直接无视对虚影的照射
        return false;
    } else {
        // 目标不是建筑虚影，那么这是普通的战时修理射线，加血
        p.target.hp = Math.min(p.target.maxHp, p.target.hp + (p.buildSpeed || 2) * 5); 
        if (p.target.shipRef && p.target.shipRef.stats) p.target.shipRef.stats.hp = p.target.hp;
    }
    return false;
}

/**
 * 处理全宇宙建筑模块的建造队列调度，包括船厂派发建筑无人机
 * @param ws worldState
 * @param currentSectorName 当前星区名
 * @returns boolean 是否需要保存世界状态 (worldHasChanged)
 */
export function processMacroBuildingQueue(ws: any, currentSectorName: string): boolean {
    if (!ws || !ws.stations) return false;
    
    let needsSave = false;

    // 扫描星区内的建筑预制体，不再生成无人机
    const allBuildingShips = ShipManager.ships.filter(s => s.location && s.location.sector === currentSectorName && (s.isBuilding || (s.stats && s.stats.hp > 0 && s.buildProgress !== undefined && s.buildProgress < 100)));
    
    ws.stations.forEach(station => {
        // [防御修复]：确保此处的队列派发只负责当前指定的星区，否则可能与 OOS 后台冲突，或者在一个星区内重复造多艘船
        if (station.sector !== currentSectorName) return;

        if (!station.modules) return;
        
        // (工厂流水线结算已被移至 WorldbookManager.tickWorld 的全局经济循环中)

        // --- 原有的造船船坞等调度逻辑 ---
        station.modules.forEach(mod => {
            if (mod.buildQueue && mod.buildQueue.length > 0) {
                const hasActiveChild = ShipManager.ships.some(s => 
                    s.location && s.location.sector === station.sector && 
                    s.sourceModuleId === mod.uid && 
                    (s.isBuilding || s.stats.hp > 0)
                );

                if (!hasActiveChild) {
                    const order = mod.buildQueue.shift();
                    if (order) {
                        console.log(`[全宇宙队列系统] 星区 [${station.sector}] 船坞 ${mod.uid} 闲置，提取订单并开始建造:`, order);
                        
                        if (!order.location) {
                            let spawnX = 500, spawnY = 275;
                            let finalSpawnRot = 0;
                            if (BuildingManager.stationModules) {
                                const memMod = BuildingManager.stationModules.find((m: any) => m.uid === mod.uid);
                                if (memMod) {
                                    const transform = BuildingManager.calculateSpawnTransform(memMod);
                                    spawnX = transform.x;
                                    spawnY = transform.y;
                                    finalSpawnRot = transform.rotation;
                                } else {
                                    const baseGridX = Math.floor((station.worldX || 0) / 550);
                                    const baseGridY = Math.floor((station.worldY || 0) / 550);
                                    const absoluteDockData = {
                                        ...mod,
                                        gridX: baseGridX + (mod.gridX || 0),
                                        gridY: baseGridY + (mod.gridY || 0)
                                    };
                                    const transform = BuildingManager.calculateSpawnTransform(absoluteDockData);
                                    spawnX = transform.x;
                                    spawnY = transform.y;
                                    finalSpawnRot = transform.rotation;
                                }
                            } else {
                                const baseGridX = Math.floor((station.worldX || 0) / 550);
                                const baseGridY = Math.floor((station.worldY || 0) / 550);
                                const absoluteDockData = {
                                    ...mod,
                                    gridX: baseGridX + (mod.gridX || 0),
                                    gridY: baseGridY + (mod.gridY || 0)
                                };
                                const transform = BuildingManager.calculateSpawnTransform(absoluteDockData);
                                spawnX = transform.x;
                                spawnY = transform.y;
                                finalSpawnRot = transform.rotation;
                            }
                            order.location = { sector: station.sector, x: spawnX, y: spawnY };
                            order.rotation = finalSpawnRot;
                        } else {
                            order.location.sector = station.sector;
                        }
                        
                        const newShip = ShipManager.createShip(order);
                        console.log(`[全宇宙队列系统] 实体生成结果:`, newShip);
                        
                        needsSave = true;
                        
                        if (BuildingManager.stationModules) {
                            const memMod = BuildingManager.stationModules.find(m => m.uid === mod.uid);
                            if (memMod) {
                                memMod.buildQueue = JSON.parse(JSON.stringify(mod.buildQueue));
                            }
                        }
                        
                        document.dispatchEvent(new CustomEvent('ui_chuanwu_refresh', { detail: { uid: mod.uid } }));
                    }
                }
            } else if (ws.orders && ['shipyard', 'module_factory', 'small_shipyard', 'drone_dock'].includes(mod.moduleId)) {
                // 如果专属队列为空，但这是个造船厂，尝试去全局池拉取
                const hasActiveChild = ShipManager.ships.some(s => 
                    s.location && s.location.sector === station.sector && 
                    s.sourceModuleId === mod.uid && 
                    (s.isBuilding || s.stats.hp > 0)
                );

                if (!hasActiveChild) {
                    const orderIndex = ws.orders.findIndex((o: any) => o.status === 'PENDING' && o.type === 'BUILD' && o.factionId === station.factionId);
                    if (orderIndex !== -1) {
                        const macroOrder = ws.orders.splice(orderIndex, 1)[0];
                        // 转换宏观订单为底层造船数据
                        // 从缓存或原订单读取 loadout，解决订单丢失配置问题
                        // 先尝试读取内存中的蓝图预设
                        let parsedLoadout = macroOrder.payload.loadout || {};
                        if (Object.keys(parsedLoadout).length === 0) {
                            if ((window as any).BlueprintData) {
                                const bp = (window as any).BlueprintData.find((b: any) => b.hullId === macroOrder.payload.hullId);
                                if (bp && bp.slots) {
                                    parsedLoadout = JSON.parse(JSON.stringify(bp.slots));
                                }
                            }
                        }

                        const order: any = {
                            hullId: macroOrder.payload.hullId,
                            factionId: macroOrder.factionId,
                            ownerId: macroOrder.factionId,
                            loadout: parsedLoadout,
                            droneEquips: macroOrder.payload.droneEquips || {},
                            type: macroOrder.payload.hullId.includes('destroyer') ? 'destroyer' : 'fighter',
                            sourceModuleId: mod.uid,
                            isBuilding: true
                        };

                        // console.log(`[全宇宙队列系统] 星区 [${station.sector}] 船坞 ${mod.uid} 闲置，接取宏观订单池订单并开始建造:`, order);
                        
                        let spawnX = 500, spawnY = 275;
                        let finalSpawnRot = 0;
                        if (BuildingManager.stationModules) {
                            const memMod = BuildingManager.stationModules.find((m: any) => m.uid === mod.uid);
                            if (memMod) {
                                const transform = BuildingManager.calculateSpawnTransform(memMod);
                                spawnX = transform.x;
                                spawnY = transform.y;
                                finalSpawnRot = transform.rotation;
                            } else {
                                const baseGridX = Math.floor((station.worldX || 0) / 550);
                                const baseGridY = Math.floor((station.worldY || 0) / 550);
                                const absoluteDockData = {
                                    ...mod,
                                    gridX: baseGridX + (mod.gridX || 0),
                                    gridY: baseGridY + (mod.gridY || 0)
                                };
                                const transform = BuildingManager.calculateSpawnTransform(absoluteDockData);
                                spawnX = transform.x;
                                spawnY = transform.y;
                                finalSpawnRot = transform.rotation;
                            }
                        } else {
                            const baseGridX = Math.floor((station.worldX || 0) / 550);
                            const baseGridY = Math.floor((station.worldY || 0) / 550);
                            const absoluteDockData = {
                                ...mod,
                                gridX: baseGridX + (mod.gridX || 0),
                                gridY: baseGridY + (mod.gridY || 0)
                            };
                            const transform = BuildingManager.calculateSpawnTransform(absoluteDockData);
                            spawnX = transform.x;
                            spawnY = transform.y;
                            finalSpawnRot = transform.rotation;
                        }
                        
                        order.location = { sector: station.sector, x: spawnX, y: spawnY };
                        order.rotation = finalSpawnRot;
                        
                        const newShip = ShipManager.createShip(order);
                        // console.log(`[全宇宙队列系统] 宏观订单池实体生成结果:`, newShip);
                        
                        needsSave = true;
                    }
                }
            }
        });
    });
    
    return needsSave;
}
