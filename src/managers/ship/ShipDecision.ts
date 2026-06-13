/**
 * 飞船决定做什么 (决策层)
 */
export class ShipDecision {
    /**
     * 核心决策逻辑：当飞船空闲时，寻找任务并制定计划
     */
    static process(ship: any, worldState: any) {
        if (!ship.taskStack) ship.taskStack = [];
        
        // 矿船自主采矿闭环（不依赖订单系统）
        // 仅允许NPC的矿船进行自主驱动，玩家矿船不再自动接管
        if (ship.taskStack.length === 0 && ship.type === 'miner' && !ship.isBuilding && ship.ownerId !== 'player') {
            this.processAutonomousMining(ship, worldState);
            return;
        }

        // 佣兵接单模块：如果飞船闲置且没有任何任务，且不是正在建造中的虚影，主动去公共订单池里找活干
        if (ship.taskStack.length === 0 && ship.ownerId !== 'player' && ship.type !== 'drone' && !ship.isBuilding) {
            this.seekPublicOrders(ship, worldState);
        }
    }

    /**
     * 矿船纯自主采矿闭环 (状态机本能，非订单驱动)
     */
    static processAutonomousMining(ship: any, worldState: any) {
        const InventoryManager = (window as any).InventoryManager;
        if (!InventoryManager) return;
        
        const currentCargo = InventoryManager.getCurrentVolume(ship.id);
        const capacity = InventoryManager.getCapacity(ship.id);
        
        // 判断1：如果货舱容量达到 80%，进入返航卸货流程
        if (capacity > 0 && (currentCargo / capacity) >= 0.8) {
            // 检查是否有无人机在外面
            let hasActiveDrones = false;
            if (ship.droneStates) {
                for (const slotId in ship.droneStates) {
                    if (ship.droneStates[slotId] === 'WORKING' || ship.droneStates[slotId] === 'RETURNING') {
                        hasActiveDrones = true;
                        if (ship.droneStates[slotId] === 'WORKING') {
                            ship.droneStates[slotId] = 'RETURNING'; // 立即打上标记防抖
                            import('../ShipManager.js').then(module => {
                                module.ShipManager.recallDrone(ship.id, slotId);
                            });
                        }
                    }
                }
            }
            
            if (hasActiveDrones) {
                // 压入显式的无人机回收任务，带有超时机制
                ship.taskStack.push({ action: 'RECALL_DRONES', timeout: 10000 });
                // console.log(`[采矿调度] 矿船 ${ship.name} 容量达80%但有无人机在外，压入 RECALL_DRONES 任务`);
                return;
            }

            // 所有船都应该有停泊卸货行为
            ship.taskStack.push({ action: 'FIND_BASE_AND_TRADE' });
            // console.log(`[采矿调试 - F12] 矿船 ${ship.name} (ID: ${ship.id}) 容量达80%，压入任务: FIND_BASE_AND_TRADE`);
            return;
        }

        // 判断2：去挖矿。优先在当前星区找矿带
        if (worldState.asteroidBelts) {
            const localBelts = worldState.asteroidBelts.filter((b: any) => b.sector === ship.location.sector);
            // 判断当前星区的所有矿带是否都已经超载
            const isLocalOverloaded = localBelts.length > 0 && localBelts.every((b: any) => (b.miningRate || 0) >= 5000);
            
            // 排队机制：计算全局所有采矿船对各个星区的预期热力贡献
            const sectorLoadMap = new Map();
            // 先加入各星区现有的物理热力值（兜底，可能并不完全准确因为有排队机制，但为了兼容保留）
            if (worldState.asteroidBelts) {
                worldState.asteroidBelts.forEach((belt: any) => {
                    const s = belt.sector;
                    if (!sectorLoadMap.has(s)) sectorLoadMap.set(s, 0);
                    // 现有的 miningRate 不再作为主要的排队依据，因为排队是通过舰船数量计算的
                });
            }

            // 遍历所有的舰船，计算正在采矿或正在前去采矿的舰船的预期热力
            import('../ShipManager.js').then(module => {
                const allShips = module.ShipManager.ships;
                allShips.forEach((s: any) => {
                    if (s.activeWeapons && s.activeWeapons.some((w:any) => w.compId === 'miner_beam_mk1')) {
                        let targetSec = null;
                        if (s.commandState === 'MINING') {
                            targetSec = s.location.sector;
                        } else if (s.taskStack && s.taskStack.length > 0) {
                            // 正在前去采矿的路上
                            const task = s.taskStack.find((t:any) => t.action === 'MINE_SECTOR');
                            if (task) targetSec = task.targetSector;
                        }
                        
                        if (targetSec) {
                            let mYield = 100;
                            let mFireRate = 3.0;
                            const mWep = s.activeWeapons.find((w:any) => w.compId === 'miner_beam_mk1');
                            if (mWep) {
                                mYield = mWep.stats.miningYield || 100;
                                mFireRate = mWep.stats.fireRate || 3.0;
                            }
                            const expectedRate = (mYield / mFireRate) * 6;
                            sectorLoadMap.set(targetSec, (sectorLoadMap.get(targetSec) || 0) + expectedRate);
                        }
                    }
                });

                const currentSectorLoad = sectorLoadMap.get(ship.location.sector) || 0;
                
                // 为了计算“当前如果我加进去会不会超载”，我们需要预估我自己的热力
                let myExpectedRate = 200; // 预估平均值
                if (ship.activeWeapons) {
                    const myWep = ship.activeWeapons.find((w:any) => w.compId === 'miner_beam_mk1');
                    if (myWep) {
                        myExpectedRate = ((myWep.stats.miningYield || 100) / (myWep.stats.fireRate || 3.0)) * 6;
                    }
                }

                // 如果当前星区还没满（算上我自己），就直接在当前星区挖
                if (localBelts.length > 0 && (currentSectorLoad + myExpectedRate < 5000)) {
                    // console.log(`[DEBUG - 采矿调度] 矿船 ${ship.name} (容量不足80%) 决定在本地星区开采，压入 MINE_SECTOR`);
                    ship.taskStack.push({ action: 'MINE_SECTOR', targetSector: ship.location.sector });
                } else {
                    // 如果当前星区没矿或加上我会超载，寻找负荷最低的有矿星区并跳跃，宁愿去别处也不要在当前星区硬卷
                    let bestSector = null;
                    let minLoad = Infinity;
                    
                    if (worldState.asteroidBelts && worldState.asteroidBelts.length > 0) {
                        const uniqueSectorsWithBelts = [...new Set(worldState.asteroidBelts.map((b:any) => b.sector))];
                        
                        uniqueSectorsWithBelts.forEach((sec: any) => {
                            const load = sectorLoadMap.get(sec) || 0;
                            if (load < minLoad) {
                                minLoad = load;
                                bestSector = sec;
                            }
                        });

                        // 找到了最不卷的地方，飞过去排队（即使那个地方也大于 5000，也是最不卷的）
                        if (bestSector) {
                            if (bestSector === ship.location.sector) {
                                // console.log(`[DEBUG - 采矿调度] 矿船 ${ship.name} 决定在本地星区开采(即使可能卷)，压入 MINE_SECTOR`);
                                ship.taskStack.push({ action: 'MINE_SECTOR', targetSector: ship.location.sector });
                            } else {
                                // console.log(`[DEBUG - 采矿调度] 矿船 ${ship.name} 决定跨区前往 ${bestSector} 开采，压入 JUMP_TO_SECTOR`);
                                ship.taskStack.push({ action: 'JUMP_TO_SECTOR', target: bestSector });
                            }
                        }
                    }
                }
            });
        }
    }

    /**
     * 主动去公共订单池里寻找适合自己的订单接取
     */
    static seekPublicOrders(ship: any, worldState: any) {
        if (!worldState.orders) return;

        let targetOrder = null;

        // 根据船型分类处理订单接取逻辑
        if (ship.type === 'fighter' || ship.type === 'destroyer' || ship.type === 'cruiser' || ship.type === 'battleship') {
            // --- 战斗舰艇：接取战斗和巡逻任务 ---
            
            // 优先找属于自己阵营的防卫订单 (COMBAT)
            targetOrder = worldState.orders.find(
                (o: any) => o.type === 'COMBAT' && o.status === 'PENDING' && o.factionId === ship.factionId
            );

            // 如果没有防卫订单，找巡逻订单 (PATROL)
            if (!targetOrder) {
                targetOrder = worldState.orders.find(
                    (o: any) => o.type === 'PATROL' && o.status === 'PENDING' && o.factionId === ship.factionId
                );
            }
        } 
        else if (ship.type === 'freighter') {
            // --- 货船：未来接取贸易/运输任务 (TRADE/TRANSPORT) ---
            // TODO: 等待经济系统订单完善，目前暂时什么都不接，避免跑去前线送死
            targetOrder = worldState.orders.find(
                (o: any) => (o.type === 'TRADE' || o.type === 'TRANSPORT') && o.status === 'PENDING' && o.factionId === ship.factionId
            );
        }

        if (targetOrder) {
            targetOrder.status = 'IN_PROGRESS';
            targetOrder.payload.assigneeId = ship.id;
            ship.assignedOrderId = targetOrder.id; // 记录自己接的单
            this.assignMacroOrder(ship, targetOrder);
        }
    }

    /**
     * 将宏观订单“翻译”成底层的原子任务并压入执行栈
     */
    static assignMacroOrder(ship: any, order: any) {
        ship.taskStack = []; // 清空之前的闲置任务
        
        switch (order.type) {
            case 'PATROL':
            case 'COMBAT':
                // 巡逻和防卫：先移动到目标星区，然后进入巡逻游荡状态
                ship.taskStack.push({ action: 'JUMP_TO_SECTOR', target: order.payload.targetSector });
                ship.taskStack.push({ action: 'PATROL_SECTOR', duration: 999999 }); 
                break;
            case 'MINE':
                ship.taskStack.push({ action: 'JUMP_TO_SECTOR', target: order.payload.targetSector });
                ship.taskStack.push({ action: 'MINE_SECTOR', targetSector: order.payload.targetSector });
                break;
        }
    }
}


/**
 * 飞船怎么做 (执行层)
 */
export class ShipExecution {
    /**
     * 执行单一原子任务
     */
    static executeAtomicTask(ship: any, task: any, dt: number, worldState: any) {
        // --- 注入监听器：捕获是谁吃了任务 ---
        if (ship.taskStack && !ship._taskStackProxied) {
            const originalShift = ship.taskStack.shift.bind(ship.taskStack);
            const originalUnshift = ship.taskStack.unshift.bind(ship.taskStack);
            const originalPush = ship.taskStack.push.bind(ship.taskStack);
            
            ship.taskStack.shift = function() {
                const item = originalShift();
                // console.log(`[任务流转] 飞船 ${ship.name} (ID: ${ship.id}) 出栈了任务: ${item ? item.action : 'undefined'}. 剩余任务: [${this.map((t:any)=>t.action).join(', ')}]`);
                return item;
            };
            ship.taskStack.unshift = function(...args: any[]) {
                const res = originalUnshift(...args);
                // console.log(`[任务流转] 飞船 ${ship.name} (ID: ${ship.id}) 头部压栈: ${args.map(a=>a.action).join(', ')}. 当前栈: [${this.map((t:any)=>t.action).join(', ')}]`);
                return res;
            };
            ship.taskStack.push = function(...args: any[]) {
                const res = originalPush(...args);
                // console.log(`[任务流转] 飞船 ${ship.name} (ID: ${ship.id}) 尾部压栈: ${args.map(a=>a.action).join(', ')}. 当前栈: [${this.map((t:any)=>t.action).join(', ')}]`);
                return res;
            };
            ship._taskStackProxied = true;
            // console.log(`[任务流转] 飞船 ${ship.name} 拦截器已挂载，初始栈: [${ship.taskStack.map((t:any)=>t.action).join(', ')}]`);
        }
        
        switch (task.action) {
            case 'RECALL_DRONES': {
                if (ship.commandState !== 'RECALLING') {
                    // console.log(`[任务流转] 飞船 ${ship.name} 发起无人机回收指令 (RECALL_DRONES)`);
                    ship.commandState = 'RECALLING';
                    
                    if (ship.droneStates) {
                        for (const slotId in ship.droneStates) {
                            if (ship.droneStates[slotId] === 'WORKING') {
                                ship.droneStates[slotId] = 'RETURNING';
                                import('../ShipManager.js').then(module => {
                                    module.ShipManager.recallDrone(ship.id, slotId);
                                });
                            }
                        }
                    }
                }
                
                // 超时判断
                if (task.timeout !== undefined) {
                    task.timeout -= dt;
                    if (task.timeout <= 0) {
                        console.warn(`[任务流转-异常] 飞船 ${ship.name} 回收无人机超时(10s)，强行遗弃外部无人机并出栈！`);
                        if (ship.droneStates) {
                            for (const slotId in ship.droneStates) {
                                if (ship.droneStates[slotId] === 'RETURNING') {
                                    ship.droneStates[slotId] = 'IDLE'; // 强行重置状态
                                }
                            }
                        }
                        ship.commandState = null;
                        ship.taskStack.shift();
                        break;
                    }
                }

                // 检查是否全部回收完毕
                let hasActiveDrones = false;
                if (ship.droneStates) {
                    for (const slotId in ship.droneStates) {
                        if (ship.droneStates[slotId] === 'WORKING' || ship.droneStates[slotId] === 'RETURNING') {
                            hasActiveDrones = true;
                            break;
                        }
                    }
                }

                if (!hasActiveDrones) {
                    // console.log(`[任务流转] 飞船 ${ship.name} 所有无人机已回收完毕，出栈 RECALL_DRONES`);
                    ship.commandState = null;
                    ship.taskStack.shift();
                }
                break;
            }

            case 'JUMP_TO_SECTOR':
                if (ship.location.sector === task.target) {
                    ship.taskStack.shift(); // 已经到达，出栈执行下一步
                } else {
                    this.requestPathToSector(ship, task.target, worldState);
                }
                break;

            case 'WAIT':
                if (task.duration > 0) {
                    task.duration -= dt;
                } else {
                    ship.taskStack.shift(); // 倒计时结束，出栈
                }
                break;
                
            case 'PATROL_SECTOR':
                if (task.duration > 0) {
                    task.duration -= dt;
                    ship.commandState = 'PATROL_ROAMING';
                    
                    // 如果还没有生成巡逻点，或者已经到达了当前巡逻点附近，则生成新点
                    if (!task.targetPos) {
                        task.targetPos = {
                            // 星区极大，改为以飞船当前坐标为基准，向外随机漫游游荡 (半径 10000 像素内)
                            x: ship.location.x + (Math.random() - 0.5) * 20000,
                            y: ship.location.y + (Math.random() - 0.5) * 20000
                        };
                    } else {
                        // 计算与当前随机巡逻点的距离，如果足够近说明到了，换下一个点
                        const dist = Math.hypot(task.targetPos.x - ship.location.x, task.targetPos.y - ship.location.y);
                        if (dist < 150) { // 放宽到达判定的距离阈值，防止高移速飞船刹不住车错过判定点
                            task.targetPos = {
                                x: ship.location.x + (Math.random() - 0.5) * 20000,
                                y: ship.location.y + (Math.random() - 0.5) * 20000
                            };
                        }
                    }
                } else {
                    ship.commandState = null;
                    ship.taskStack.shift();
                }
                break;

            case 'POP_ORDER':
                ship.orderQueue.shift(); // 彻底完成大订单
                ship.taskStack.shift();  // 原子任务本身也出栈
                break;

            case 'FOLLOW_TARGET':
                // 持续跟随，除非目标消失才出栈
                if (task.targetId) {
                    // 使用动态导入获取 ShipManager 全局单例并查找
                    import('../ShipManager.js').then(module => {
                        const targetShip = module.ShipManager.ships.find((s: any) => s.id === task.targetId);
                        if (targetShip) {
                            if (targetShip.location.sector !== ship.location.sector) {
                                this.requestPathToSector(ship, targetShip.location.sector, worldState);
                            } else {
                                ship.commandState = 'FOLLOW';
                                ship.commandTargetId = task.targetId;
                            }
                        } else {
                            // 目标被摧毁，取消跟随
                            ship.taskStack.shift();
                            ship.orderQueue.shift();
                            ship.commandState = null;
                            ship.commandTargetId = null;
                        }
                    });
                } else if (task.targetSector) {
                    if (task.targetSector !== ship.location.sector) {
                        this.requestPathToSector(ship, task.targetSector, worldState);
                    } else {
                        // 已经跟随到了目标星区，保持发呆
                    }
                }
                break;
                
            case 'DOCK_AT_STATION': {
                // 新增：如果它已经在目标港口停好了，直接出栈完成任务
                // [修复] 这里放宽判断，只要是 DOCKED 状态，不管 UID 是不是完全匹配都算停泊成功。
                // 因为目标建筑可能有多个模块组合，导致 dockedAt(模块UID) 不等于 targetBaseUid(主站UID)
                if (ship.state === 'DOCKED') {
                    // console.log(`[任务流转] 飞船 ${ship.name} 已确认物理停泊完成 (所在模块: ${ship.dockedAt})，DOCK_AT_STATION 自检通过准备出栈。`);
                    ship.commandState = null;
                    ship.taskStack.shift();
                    break;
                }

                if (ship.commandState !== 'DOCK') {
                    // console.log(`[任务流转] 飞船 ${ship.name} 发起停靠请求 DOCK_AT_STATION 目标: ${task.targetBaseUid}`);
                    ship.commandState = 'DOCK';
                    ship.commandTargetId = task.targetBaseUid; // 确保 OOS/物理层 能知道目标建筑的 UID
                    
                    // 发送事件，由 Base-Docking.ts 统一处理分配泊位和物理引导
                    if (typeof document !== 'undefined') {
                        document.dispatchEvent(new CustomEvent('ui_apply_docking', { 
                            detail: { moduleId: task.targetBaseUid, shipId: ship.id } 
                        }));
                    }
                }
                break; // 必须有 break，防止穿透
            }

            case 'UNDOCK_FROM_STATION':
                // console.log(`[任务流转] 飞船 ${ship.name} 准备执行 UNDOCK_FROM_STATION. 当前 commandState: ${ship.commandState}, 物理状态: ${ship.state}`);
                if (ship.commandState === 'UNDOCKING') break; // 防抖锁
                ship.commandState = 'UNDOCKING';
                
                import('../ShipManager.js').then(module => {
                    // console.log(`[任务流转] 飞船 ${ship.name} (ID: ${ship.id}) 异步执行 undockShip`);
                    module.ShipManager.undockShip(ship.id);
                    ship.commandState = null;
                    ship.taskStack.shift();
                });
                break;
                
            case 'FIND_BASE_AND_TRADE': {
                const BuildingManager = (window as any).BuildingManager;
                const InventoryManager = (window as any).InventoryManager;
                if (!BuildingManager || !InventoryManager) {
                    ship.taskStack.shift();
                    break;
                }
                
                const allModules = BuildingManager.getAllModules();
                const myBases = allModules;
                
                if (myBases.length > 0) {
                    let targetBase = null;
                    let explicitTradeList = task.tradeList || null; // 允许从上一层透传 tradeList
                    
                    // --- 第一优先级：智能订单撮合 ---
                    // 如果飞船身上有货（矿船、满载货船等），去 worldState.orders 里找有没有基地发布了对应的收购(BUY)订单
                    const myInv = InventoryManager.getInventory(ship.id);
                    const myGoods = Object.keys(myInv).filter(good => myInv[good] > 0);
                    
                    if (myGoods.length > 0 && worldState && worldState.orders) {
                        // 寻找一个匹配的 TRANSPORT 物资补给订单
                        const matchingOrder = worldState.orders.find((o: any) => {
                            if (o.type === 'TRANSPORT' && o.status === 'PENDING' && o.payload && o.payload.targetSector) {
                                // 检查飞船身上是否带有订单需要的物资 (cargoType)
                                return myGoods.includes(o.payload.cargoType);
                            }
                            return false;
                        });

                        if (matchingOrder) {
                            // TRANSPORT 订单的 targetSector 其实记录的是 stationUid
                            const stationUid = matchingOrder.payload.targetSector;
                            
                            // 全局检索该空间站 (不再局限于当前星区的 myBases)
                            if (worldState && worldState.stations) {
                                const globalStation = worldState.stations.find((s: any) => s.uid === stationUid);
                                if (globalStation) {
                                    // 伪造一个 targetBase 对象，为了兼容后续的 `JUMP_TO_SECTOR` 等操作
                                    targetBase = {
                                        uid: stationUid,
                                        sector: globalStation.sector
                                    };
                                    
                                    // 根据订单生成底层的贸易清单（飞船视角的卖出 sell）
                                    explicitTradeList = [{
                                        good: matchingOrder.payload.cargoType,
                                        amount: matchingOrder.payload.amount || 9999, // 尽量补足订单数量
                                        type: 'sell' 
                                    }];
                                    // console.log(`[订单撮合] 飞船 ${ship.name} 匹配到 ${matchingOrder.payload.cargoType} 的补给单，准备跨星区前往基地 ${stationUid} (位于 ${globalStation.sector})`);
                                }
                            }
                        }
                    }
                    
                    // --- 第二优先级：按内部工厂配方智能兜底 (Push 机制) ---
                    if (!targetBase) {
                        const localBases = myBases.filter((m: any) => m.sector === ship.location.sector);
                        const INTERNAL_MODULES = (window as any).GameConfig?.INTERNAL_MODULES || {};
                        
                        // 尝试在本地星区寻找那些“内部挂载了能消耗我货物的工厂”的空间站
                        for (const base of localBases) {
                            if (base.internalModules) {
                                let matchFound = false;
                                
                                for (const slot in base.internalModules) {
                                    const internalModId = base.internalModules[slot];
                                    if (internalModId && INTERNAL_MODULES[internalModId]) {
                                        const modDef = INTERNAL_MODULES[internalModId];
                                        if (modDef.recipe && modDef.recipe.inputs) {
                                            // 检查该工厂的输入原料是否包含飞船当前携带的货物
                                            for (const good of myGoods) {
                                                if (modDef.recipe.inputs[good] !== undefined) {
                                                    targetBase = base;
                                                    explicitTradeList = [{
                                                        good: good,
                                                        amount: 9999, // 尽量全部倾销
                                                        type: 'sell'
                                                    }];
                                                    // console.log(`[智能配方兜底] 飞船 ${ship.name} 根据配方需求强行锁定了基地 ${base.uid} (内部工厂: ${internalModId} 需要 ${good})`);
                                                    matchFound = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    if (matchFound) break;
                                }
                                if (matchFound) break;
                            }
                        }

                        // 如果连能消耗货物的工厂都找不到，彻底退化为随便找个地方停靠 (极大概率货物会被拒收保留)
                        if (!targetBase) {
                            targetBase = localBases.length > 0 ? localBases[0] : myBases[0];
                            // console.log(`[智能配方兜底] 飞船 ${ship.name} 在星区内找不到任何消耗自身货物的工厂，退化为停靠在 ${targetBase?.uid}`);
                        }
                    }
                    
                    // 移除当前任务
                    ship.taskStack.shift();
                    
                    // 追加离港任务
                    ship.taskStack.unshift({ action: 'UNDOCK_FROM_STATION' });
                    
                    // 将停泊和交易任务压入栈
                    ship.taskStack.unshift({ 
                        action: 'TRADE_CARGO', 
                        targetBaseUid: targetBase.uid, 
                        tradeList: explicitTradeList
                    });
                    
                    ship.taskStack.unshift({ action: 'DOCK_AT_STATION', targetBaseUid: targetBase.uid });
                    
                    // 如果跨星区，把跳跃任务压在最上面，确保先跳跃，到了之后再触发 DOCK_AT_STATION 申请泊位
                    if (targetBase.sector !== ship.location.sector) {
                        ship.taskStack.unshift({ action: 'JUMP_TO_SECTOR', target: targetBase.sector });
                    }
                    
                } else {
                    // console.log(`[物流] 船只 ${ship.name} 找不到适合的交易点，原地丢弃货物。`);
                    const InventoryManager = (window as any).InventoryManager;
                    if (InventoryManager) {
                        InventoryManager.clearInventory(ship.id);
                    }
                    ship.taskStack.shift();
                }
                break;
            }

            case 'TRADE_CARGO': {
                if (ship.commandState === 'TRADING') {
                    // 还在交易中，保持挂起，不再重复投递异步任务
                    break; 
                }
                
                // 只有当它确实进港了才允许交易，如果在路上被误传了任务直接打断
                if (ship.state !== 'DOCKED') {
                    console.warn(`[任务流转-异常] 飞船 ${ship.name} 试图在未停靠状态下进行 TRADE_CARGO！当前状态: ${ship.state}。中断并丢弃任务。`);
                    ship.taskStack.shift();
                    break;
                }

                // console.log(`[任务流转] 飞船 ${ship.name} 启动贸易结算 (TRADE_CARGO) 异步流程，上防抖锁。`);
                ship.commandState = 'TRADING';
                
                const targetBaseUid = task.targetBaseUid;
                const tradeList = task.tradeList;
                
                const BuildingManager = (window as any).BuildingManager;
                const InventoryManager = (window as any).InventoryManager;
                
                if (!BuildingManager || !InventoryManager) {
                    // console.log(`[DEBUG - 任务流转] 飞船 ${ship.name} TRADE_CARGO 失败：缺少 Manager，任务强制出栈。`);
                    ship.taskStack.shift();
                    break;
                }

                const mod = BuildingManager.getAllModules().find((m: any) => m.uid === targetBaseUid);

                // 统一存放到空间站的总公库 (如果模块不在本地，直接使用目标 UID)
                let targetStationUid = targetBaseUid;
                let stationOwnerId = 'player';

                if (mod) {
                    targetStationUid = mod.stationUid || mod.uid;
                    stationOwnerId = mod.ownerId || 'player';
                }
                if (worldState && worldState.stations) {
                    const stationObj = worldState.stations.find((s: any) => s.uid === targetStationUid);
                    if (stationObj && stationObj.ownerId) {
                        stationOwnerId = stationObj.ownerId;
                    }
                }

                let transferred = false;
                
                Promise.all([
                    import('../../../json/ItemData.json').catch(() => ({ default: { ITEMS: {} } })),
                    import('../NPCManager.js').catch(() => null)
                ]).then(([itemDataModule, npcManagerModule]) => {
                    const ItemData: any = itemDataModule.default || itemDataModule;
                    const NPCManager = npcManagerModule ? npcManagerModule.NPCManager : null;

                    if (tradeList && Array.isArray(tradeList) && tradeList.length > 0) {
                        // 【清单交易模式】
                        tradeList.forEach((trade: any) => {
                            if (trade.type === 'sell') {
                                // 卖给空间站: 飞船 -> 空间站
                                const actualTransferred = InventoryManager.transfer(ship.id, targetStationUid, trade.good, trade.amount);
                                if (actualTransferred > 0) {
                                    if (NPCManager && ship.ownerId && stationOwnerId && String(ship.ownerId) !== String(stationOwnerId)) {
                                        let itemDef = ItemData.ITEMS ? ItemData.ITEMS[trade.good] : null;
                                        let price = itemDef ? (itemDef.basePrice || 10) : 10;
                                        let totalValue = price * actualTransferred;
                                        NPCManager.getInstance().transferCredits(stationOwnerId, ship.ownerId, totalValue, true);
                                    }
                                    transferred = true;
                                }
                            } else if (trade.type === 'buy') {
                                // 从空间站买: 空间站 -> 飞船
                                const actualTransferred = InventoryManager.transfer(targetStationUid, ship.id, trade.good, trade.amount);
                                if (actualTransferred > 0) {
                                    if (NPCManager && ship.ownerId && stationOwnerId && String(ship.ownerId) !== String(stationOwnerId)) {
                                        let itemDef = ItemData.ITEMS ? ItemData.ITEMS[trade.good] : null;
                                        let price = itemDef ? (itemDef.basePrice || 10) : 10;
                                        let totalValue = price * actualTransferred;
                                        NPCManager.getInstance().transferCredits(ship.ownerId, stationOwnerId, totalValue, true);
                                    }
                                    transferred = true;
                                }
                            }
                        });
                    } else {
                        // 【兜底模式】：没有清单，默认把身上所有的货全卖了
                        /* [暂时注释掉兜底功能以配合测试]
                        const myInv = InventoryManager.getInventory(ship.id);
                        ...
                        */
                    }
                    
                    // console.log(`[任务流转] 飞船 ${ship.name} TRADE_CARGO 交易完成，准备解锁并出栈。当前 taskStack: [${ship.taskStack.map((t:any)=>t.action).join(', ')}]`);
                    ship.commandState = null; // 解锁
                    ship.taskStack.shift();

                    // 【出港兜底机制】
                    // 如果船还在港内，且任务栈空了，或者下一个任务不是出港，强行加一个出港指令，防旧存档卡死！
                    if (ship.state === 'DOCKED') {
                        if (ship.taskStack.length === 0 || ship.taskStack[0].action !== 'UNDOCK_FROM_STATION') {
                            console.warn(`[任务流转-兜底] 飞船 ${ship.name} 交易完成但无后续离港指令，强行压入 UNDOCK_FROM_STATION！`);
                            ship.taskStack.unshift({ action: 'UNDOCK_FROM_STATION' });
                        }
                    }
                });
                break;
            }

            case 'MINE_SECTOR': {
                // --- 节流的执行层日志 ---
                if (!ship._mineSectorDebugTimer || Date.now() - ship._mineSectorDebugTimer > 5000) {
                    ship._mineSectorDebugTimer = Date.now();
                }

                // 1. 空矿检测
                const hasAsteroids = worldState.asteroidBelts && worldState.asteroidBelts.some((b: any) => b.sector === ship.location.sector);
                if (!hasAsteroids) {
                    // console.log(`[采矿调度] ${ship.name} 在 ${ship.location.sector} 未发现小行星带，直接中止采矿任务。`);
                    ship.taskStack.shift();
                    break;
                }

                // 2. 80% 库存检测
                const InventoryManager = (window as any).InventoryManager;
                if (InventoryManager) {
                    const currentCargo = InventoryManager.getCurrentVolume(ship.id);
                    const capacity = InventoryManager.getCapacity(ship.id);
                    
                    if (capacity > 0 && (currentCargo / capacity) >= 0.8) {
                        // 检查是否有无人机在外面
                        let hasActiveDrones = false;
                        if (ship.droneStates) {
                            for (const slotId in ship.droneStates) {
                                if (ship.droneStates[slotId] === 'WORKING' || ship.droneStates[slotId] === 'RETURNING') {
                                    hasActiveDrones = true;
                                    if (ship.droneStates[slotId] === 'WORKING') {
                                        ship.droneStates[slotId] = 'RETURNING'; // 立即打上标记防抖
                                        import('../ShipManager.js').then(module => {
                                            module.ShipManager.recallDrone(ship.id, slotId);
                                        });
                                    }
                                }
                            }
                        }

                        if (hasActiveDrones) {
                            // 压入显式的回收任务并中断采矿
                            // console.log(`[采矿] ${ship.name} 货舱容量已达80%，压入 RECALL_DRONES，准备中断采矿`);
                            ship.taskStack.shift();
                            ship.taskStack.unshift({ action: 'RECALL_DRONES', timeout: 10000 });
                            ship.commandState = null;
                            break;
                        }

                        // 如果是非玩家飞船 (如NPC矿船) 或者是在执行系统宏观订单，则自动弹栈去卸货
                        if (ship.ownerId !== 'player') {
                            // console.log(`[采矿] ${ship.name} 货舱容量已达80% (${currentCargo}/${capacity})，结束采矿任务。`);
                            ship.taskStack.shift();
                            ship.commandState = null;
                            
                            // 如果有绑定的采矿订单，标记为完成 (交由后续逻辑如归仓结算处理)
                            if (ship.orderQueue && ship.orderQueue[0] && ship.orderQueue[0].type === 'MINE') {
                                ship.orderQueue.shift();
                            }
                        } else {
                            // 玩家指派的手动采矿：即使满了也不结束任务，保持挂起，等待玩家下一步指令
                            ship.commandState = 'MINING';
                        }
                        break;
                    }
                }

                // 3. 驻留发呆 (配合底层 ShipManager.ts 的后台自动采矿逻辑，只要挂着此状态即可)
                ship.commandState = 'MINING';
                break;
            }
        }
    }

    /**
     * 请求一条前往目标星区的航线
     */
    static requestPathToSector(ship: any, targetSectorName: string, worldState: any) {
        if (ship.location.sector === targetSectorName) return;
        
        // 简单防抖：如果已经在路上或者路径首节点对得上，就不频繁算路
        if (ship.path && ship.path.length > 0) return;

        import('../../scenes/WorldbookManager.js').then(module => {
            const startSec = worldState.sectors.find((s: any) => s.name === ship.location.sector);
            const targetSec = worldState.sectors.find((s: any) => s.name === targetSectorName);
            
            if (startSec && targetSec) {
                const pathNodes = module.WorldbookManager.getStarlanePath(startSec, targetSec, worldState.sectors);
                if (pathNodes && pathNodes.length > 1) {
                    ship.path = pathNodes.map((n: any) => n.name).slice(1);
                } else {
                    // console.log(`[导航错误] ${ship.name} 无法找到前往 ${targetSectorName} 的航线，放弃当前任务。`);
                    ship.orderQueue.shift(); // 寻路失败，剔除不可达的废任务
                    ship.path = [];
                }
            }
        });
    }

    /**
     * 处理商船交易验收（现仅作瞬间的数据结算，延迟由 WAIT 任务接管）
     */
    static processTradeTransaction(ship: any, order: any, worldState: any, isFetching: boolean) {
        const sector = worldState.sectors.find((s: any) => s.name === ship.location.sector);
        if (!sector) return;

        if (isFetching) {
            const amountToFetch = Math.min(order.amount, sector.inventory[order.good] || 0);
            if (amountToFetch > 0) {
                sector.inventory[order.good] -= amountToFetch;
                ship.addCargo(order.good, amountToFetch);
                order.actualAmount = amountToFetch; 
                // console.log(`[商船] ${ship.name} 在 ${sector.name} 提货 ${amountToFetch} ${order.good}`);
            } else {
                order.actualAmount = 0;
            }
            order.status = 'DELIVERING'; // 转入下一阶段（下一次帧循环会重新编译）
        } else {
            const deliveredAmount = ship.removeCargo(order.good, order.actualAmount || 0);
            if (!sector.inventory) sector.inventory = {};
            sector.inventory[order.good] = Math.min(300, (sector.inventory[order.good] || 0) + deliveredAmount);
            // console.log(`[商船] ${ship.name} 在 ${sector.name} 卸货 ${deliveredAmount} ${order.good}`);
        }
    }
}
