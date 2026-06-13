import { ShipManager } from '../ShipManager.js';
import { WorldbookManager } from '../../scenes/WorldbookManager.js';
import { BuildingManager } from '../BuildingManager.js';

/**
 * OOS 后台建造推演模块
 * 处理活跃星区外的空间站队列和建造虚影的进度累加
 */
export function updateBuildingOOS(worldState: any, dt: number) {
    if (!worldState || !worldState.stations) return;

    const activeSectors = ShipManager.activeSimulationSectors || [];
    
    // 找出所有在 OOS 状态下(不在活跃星区)的虚影
    const oosBuildingShips = ShipManager.ships.filter(s => 
        !activeSectors.includes(s.location.sector) && 
        (s.isBuilding || (s.stats && s.stats.hp > 0 && s.buildProgress !== undefined && s.buildProgress < 100))
    );

    worldState.stations.forEach((station: any) => {
        if (!station.modules) return;

        // 活跃星区造船交给 Base-Building.ts 的 processMacroBuildingQueue 处理，OOS 不插手
        if (activeSectors.includes(station.sector)) return;

        // 1. 扫描该空间站包含的造船模块（船坞等）
        const shipyards = station.modules.filter((m: any) => 
            m.moduleId === 'shipyard' || m.moduleId === 'module_factory' || m.moduleId === 'small_shipyard' || m.moduleId === 'drone_dock'
        );

        shipyards.forEach((dock: any) => {
            // 检查这个船坞是否已经在造东西了（有没有 sourceModuleId 指向它的虚影）
            const myChild = oosBuildingShips.find(s => s.sourceModuleId === dock.uid);

            // 如果闲置中，尝试从 Worldbook-Orders 的全局订单池或者自带的队列提取订单
            if (!myChild) {
                let currentOrder = null;
                
                // 优先检查船坞自己的专属队列
                if (dock.buildQueue && dock.buildQueue.length > 0) {
                    currentOrder = dock.buildQueue.shift();
                } else if (worldState.orders) {
                    // 如果自己没排队，去全局公共订单池拉取本阵营的订单
                    const orderIndex = worldState.orders.findIndex((o: any) => o.status === 'PENDING' && o.type === 'BUILD' && o.factionId === station.factionId);
                    if (orderIndex !== -1) {
                        const macroOrder = worldState.orders.splice(orderIndex, 1)[0];
                        // 转换宏观订单为飞船建造数据
                        currentOrder = {
                            hullId: macroOrder.payload.hullId,
                            factionId: macroOrder.factionId,
                            ownerId: macroOrder.factionId,
                            loadout: macroOrder.payload.loadout || {},
                            droneEquips: macroOrder.payload.droneEquips || {}, // 透传无人机配置
                            type: macroOrder.payload.hullId.includes('destroyer') ? 'destroyer' : 'fighter'
                        };
                    }
                }

                // 提取到了订单，创建虚影
                if (currentOrder) {
                    if (!currentOrder.location) {
                        const transform = BuildingManager.calculateSpawnTransform(dock);
                        currentOrder.location = { sector: station.sector, x: transform.x, y: transform.y };
                        currentOrder.rotation = transform.rotation;
                    } else {
                        currentOrder.location.sector = station.sector;
                    }
                    currentOrder.isBuilding = true;
                    currentOrder.sourceModuleId = dock.uid; // 绑定父船坞
                    
                    const newBuildingShip = ShipManager.createShip(currentOrder);
                    oosBuildingShips.push(newBuildingShip); // 加到当前的推演列表里
                    
                    // console.log(`[OOS 建造] 船坞 ${dock.uid} 提取订单，后台虚影 ${newBuildingShip.id} 开始组装...`);
                }
            } 
            // 如果已经在造了，开始推演进度
            else {
                if (myChild.buildProgress === undefined) myChild.buildProgress = 0;

                // 纯时间倒计时逻辑，驱逐舰耗时更多，战机较快
                // 设定基础倒计时建造速度
                let timeToBuild = myChild.type === 'destroyer' ? 30.0 : 10.0;
                let buildPowerPerSec = 100.0 / timeToBuild; 

                myChild.buildProgress += buildPowerPerSec * dt;

                // 满进度下水结算
                if (myChild.buildProgress >= 100) {
                    // console.log(`[OOS 建造完成] 虚影 ${myChild.id} 在后台完工，转化为实体。`);
                    
                    const spawnX = myChild.location.x;
                    const spawnY = myChild.location.y;
                    const tOwner = myChild.ownerId;
                    const tFaction = myChild.factionId;
                    
                    const newShipData = {
                        name: myChild.name || '新造舰船',
                        hullId: myChild.hullId,
                        loadout: myChild.loadout || {},
                        droneEquips: myChild.droneEquips || {},
                        factionId: tFaction,
                        ownerId: tOwner, // 保留原有的所有权记录
                        pilotId: myChild.pilotId, // 保留原有的驾驶员记录
                        type: myChild.type,
                        location: { sector: myChild.location.sector, x: spawnX, y: spawnY },
                        rotation: myChild.rotation || 0
                    };

                    // 1. 移除虚影
                    ShipManager.removeShip(myChild.id);
                    // 2. 生成真实的下水实体
                    const newShip = ShipManager.createShip(newShipData);

                    // 如果是玩家的船，自动塞进玩家资产库
                    if (tOwner === 'player' && newShip) {
                        import('../PlayerManager.js').then(({ PlayerManager }) => {
                            const pd = PlayerManager.getStats();
                            if (pd.ownedShips && !pd.ownedShips.some((s: any) => s.id === newShip.id)) {
                                pd.ownedShips.push({
                                    id: newShip.id,
                                    name: newShip.name,
                                    hullId: newShip.hullId,
                                    slots: newShip.loadout || {},
                                    cargo: {},
                                    hp: newShip.stats ? newShip.stats.maxHp : 100,
                                    location: { sector: newShip.location.sector, x: newShip.location.x, y: newShip.location.y }
                                });
                                PlayerManager.saveStats(pd);
                                // console.log(`[资产入库] OOS 建造的玩家船只 ${newShip.id} 已正式入列。`);
                            }
                        });
                    }
                }
            }
        });
    });
}
