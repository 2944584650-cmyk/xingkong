/**
 * 飞船决定做什么 (决策层)
 */
export class ShipDecision {
    /**
     * 核心决策逻辑：当飞船空闲时，寻找任务并制定计划
     */
    static process(ship: any, worldState: any) {
        if (!ship.taskStack) ship.taskStack = [];
        
        // 佣兵接单模块：如果飞船闲置且没有任何任务，且不是正在建造中的虚影，主动去公共订单池里找活干
        if (ship.taskStack.length === 0 && ship.ownerId !== 'player' && ship.type !== 'drone' && !ship.isBuilding) {
            this.seekPublicOrders(ship, worldState);
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
        else if (ship.type === 'miner') {
            // --- 矿船：未来接取采矿任务 (MINE) ---
            // TODO: 完善采矿订单
            targetOrder = worldState.orders.find(
                (o: any) => o.type === 'MINE' && o.status === 'PENDING' && o.factionId === ship.factionId
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
        switch (task.action) {
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
                
            case 'DOCK_AT_STATION':
                ship.commandState = 'DOCK';
                // 预留，当前端或 OOS 判定完成 docking 后，需要外部调用 ship.taskStack.shift()
                break;
                
            case 'MINE_SECTOR': {
                // console.log(`[DEBUG - MINE_SECTOR 执行] 飞船 ${ship.name} (ID: ${ship.id}) 进入采矿作业节点，当前星区: ${ship.location.sector}`);

                // 1. 空矿检测
                const hasAsteroids = worldState.asteroidBelts && worldState.asteroidBelts.some((b: any) => b.sector === ship.location.sector);
                if (!hasAsteroids) {
                    console.log(`[采矿调度] ${ship.name} 在 ${ship.location.sector} 未发现小行星带，直接中止采矿任务。`);
                    ship.taskStack.shift();
                    break;
                }

                // 2. 80% 库存检测
                const InventoryManager = (window as any).InventoryManager;
                if (InventoryManager) {
                    const currentCargo = InventoryManager.getCurrentVolume(ship.id);
                    const capacity = InventoryManager.getCapacity(ship.id);
                    
                    if (capacity > 0 && (currentCargo / capacity) >= 0.8) {
                        console.log(`[采矿] ${ship.name} 货舱容量已达80% (${currentCargo}/${capacity})，结束采矿任务。`);
                        ship.taskStack.shift();
                        ship.commandState = null;
                        
                        // 如果有绑定的采矿订单，标记为完成 (交由后续逻辑如归仓结算处理)
                        if (ship.orderQueue && ship.orderQueue[0] && ship.orderQueue[0].type === 'MINE') {
                            ship.orderQueue.shift();
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
                    console.log(`[导航错误] ${ship.name} 无法找到前往 ${targetSectorName} 的航线，放弃当前任务。`);
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
                console.log(`[商船] ${ship.name} 在 ${sector.name} 提货 ${amountToFetch} ${order.good}`);
            } else {
                order.actualAmount = 0;
            }
            order.status = 'DELIVERING'; // 转入下一阶段（下一次帧循环会重新编译）
        } else {
            const deliveredAmount = ship.removeCargo(order.good, order.actualAmount || 0);
            if (!sector.inventory) sector.inventory = {};
            sector.inventory[order.good] = Math.min(300, (sector.inventory[order.good] || 0) + deliveredAmount);
            console.log(`[商船] ${ship.name} 在 ${sector.name} 卸货 ${deliveredAmount} ${order.good}`);
        }
    }
}
