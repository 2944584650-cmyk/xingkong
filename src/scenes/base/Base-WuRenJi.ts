/**
 * 星空：无人机系统专属逻辑模块
 * 用于处理无人机的存活判定、索敌、轨道环绕等特殊行为
 */

/**
 * 统一获取无人机母体的辅助函数
 * 兼顾了母体是飞船或是建筑模块的情况
 */
export function getActualFlagship(droneEnt: any, allShipsList: any[]) {
    if (!droneEnt.parentId) return null;
    
    // 1. 先在常规飞船/实体列表中寻找
    let flagship = allShipsList.find(s => String(s.id) === String(droneEnt.parentId));
    
    // 2. 如果没找到，去建筑模块列表中寻找
    if (!flagship) {
        const bm = (window as any).BuildingManager;
        if (bm && bm.stationModules) {
            const mod = bm.stationModules.find((m: any) => String(m.uid) === String(droneEnt.parentId));
            if (mod) {
                // 包装成带有 x, y, id 的实体对象返回
                // 致命修复：建筑模块使用的是网格坐标(gridX, gridY)，没有 x 和 y 属性！
                // 必须转换成真实的物理像素坐标，否则 x, y 会变成 undefined 导致距离计算为 NaN 卡死无人机
                const gridPixelSize = bm.GRID_PIXEL_SIZE || 550;
                // 计算模块中心点作为回站坐标
                const worldX = mod.gridX * gridPixelSize + (mod.width || 1) * gridPixelSize / 2;
                const worldY = mod.gridY * gridPixelSize + (mod.height || 1) * gridPixelSize / 2;
                
                flagship = { id: mod.uid, x: worldX, y: worldY, hp: mod.hp || 100, isStationModule: true };
            }
        }
    }
    return flagship;
}

/**
 * 检查无人机的存活状态
 * @param {Object} droneEnt - 当前正在运算的无人机微观实体
 * @param {Array} allShipsList - 当前星区内所有存活的实体列表（用于查找母体）
 * @returns {boolean} - 如果返回 false，表示该无人机需要被立即处死（自毁）
 */
export function checkDroneSurvival(droneEnt: any, allShipsList: any[], asteroidsList?: any[]) {
    // 无人机必须有 parentId，且父实体必须存活于当前星区
    if (!droneEnt.parentId) {
        if (!droneEnt._deathLog) {
            console.warn(`[无人机] ${droneEnt.id} 自毁原因：缺少 parentId！`);
            droneEnt._deathLog = true;
        }
        return false;
    }
    
    // 检查父实体是否存在且存活
    let parentAlive = false;
    const flagship = getActualFlagship(droneEnt, allShipsList);
    
    if (flagship) {
        if (flagship.isStationModule) {
            parentAlive = true;
        } else if (flagship.hp > 0) {
            parentAlive = true;
        }
    }

    // 兜底宽限判断：防止因为初始化延迟导致的错杀
    if (!parentAlive && droneEnt.shipRef && droneEnt.shipRef.droneType === 'BUILD' && !droneEnt._deathLog) {
         parentAlive = true;
    }

    if (!parentAlive) {
        if (!droneEnt._deathLog) {
            console.warn(`[无人机] ${droneEnt.id} 自毁原因：找不到母舰/空间站模块 ${droneEnt.parentId}，或者母舰已坠毁/离开了当前星区！`);
            // console.warn(`当前微观星区存在的船只 IDs:`, allShipsList.map(s => s.id));
            droneEnt._deathLog = true;
        }
        return false;
    }
    
    // --- 在母舰存活的情况下 ---
    // 调取 ShipManager 预先绑定在对象上的细分类型 (通用实体属性)
    if (droneEnt.shipRef && droneEnt.shipRef.droneType) {
        if (droneEnt.shipRef.droneType === 'ATTACK') {
            // 加入一个内部标记防止在每秒 60 帧的物理循环中导致控制台无限刷屏卡死
            if (!droneEnt._attackIdentifiedLog) {
                // console.log('攻击无人机已识别: ', droneEnt.id);
                droneEnt._attackIdentifiedLog = true;
            }
            // 触发攻击无人机专属行为
            handleAttackDroneBehavior(droneEnt, allShipsList);
        } else if (droneEnt.shipRef.droneType === 'BUILD') {
            if (!droneEnt._buildIdentifiedLog) {
                // console.log('建筑无人机已识别: ', droneEnt.id);
                droneEnt._buildIdentifiedLog = true;
            }
            handleBuildDroneBehavior(droneEnt, allShipsList);
        } else if (droneEnt.shipRef.droneType === 'MINE') {
            if (!droneEnt._mineIdentifiedLog) {
                // console.log('采矿无人机已识别: ', droneEnt.id);
                droneEnt._mineIdentifiedLog = true;
            }
            handleMineDroneBehavior(droneEnt, allShipsList, asteroidsList);
        }
    }

    return true; // 存活检查通过
}

/**
 * 采矿无人机的专属行为逻辑
 * @param droneEnt 无人机实体
 * @param allShipsList 当前星区内的所有存活实体列表
 * @param asteroidsList 当前星区内的小行星实体列表
 */
export function handleMineDroneBehavior(droneEnt: any, allShipsList: any[], asteroidsList?: any[]) {
    // 1. 获取母体（旗舰或建筑模块）
    const actualFlagship = getActualFlagship(droneEnt, allShipsList);

    if (!actualFlagship) {
         droneEnt.droneMoveTarget = null;
         droneEnt.droneThrustMultiplier = 0;
         droneEnt.droneLookTarget = null;
         return;
    }

    // 2. 检查系统抛出的“已满载”标记或空闲超时标记
    let isReturning = droneEnt.shipRef && droneEnt.shipRef.isReturning;

    // --- 采矿作业模式的周围小行星检测 ---
    let hasAsteroidNearby = false;
    if (!isReturning) {
        const searchCenterX = actualFlagship ? actualFlagship.x : droneEnt.x;
        const searchCenterY = actualFlagship ? actualFlagship.y : droneEnt.y;
        
        if (asteroidsList && asteroidsList.length > 0) {
            for (const ast of asteroidsList) {
                const dist = Math.hypot(ast.x - searchCenterX, ast.y - searchCenterY);
                if (dist <= 1500) { // 在母体周围 1500 像素内存在小行星实体
                    hasAsteroidNearby = true;
                    break;
                }
            }
        }

        // 简单的超时计数器 (假设每秒 60 帧)
        if (!hasAsteroidNearby) {
            droneEnt._idleTimer = (droneEnt._idleTimer || 0) + 1;
            if (droneEnt._idleTimer > 300) { // 5秒 = 300帧
                if (!droneEnt._mineIdleLog) {
                    console.warn(`[采矿调试] 无人机 ID: ${droneEnt.id} 超过5秒未在附近发现小行星实体，触发闲置强制返航！`);
                    droneEnt._mineIdleLog = true;
                }
                isReturning = true;
                if (droneEnt.shipRef) droneEnt.shipRef.isReturning = true;
            }
        } else {
            droneEnt._idleTimer = 0;
        }
    }

    let newState = '';

    if (isReturning) {
        // --- 满载返航模式 / 无矿返航 ---
        if (!droneEnt._mineReturnLog) {
            console.log(`[采矿调试] 无人机 ID: ${droneEnt.id} 开始执行返航机动，寻找母体: ${actualFlagship ? actualFlagship.id : '未知'}`);
            droneEnt._mineReturnLog = true;
        }
        handleDroneReturnToMothership(droneEnt, actualFlagship, { isUrgentReturn: true });
    } else {
        // --- 采矿作业模式 ---
        // 为了视觉表现，我们让它在母舰周围（假设母舰就在小行星带边缘）做不规则的环绕飞行，
        // 并且机头朝向母体外侧（模拟在切割石头）
        droneEnt.droneLookTarget = null; // 解除强制凝视，由于它会移动，它会自动朝向移动方向

        // 如果没有分配当前的环绕目标点，或者已经很接近目标点，就刷新一个新点
        if (!droneEnt._mineTargetPoint || Math.hypot(droneEnt._mineTargetPoint.x - droneEnt.x, droneEnt._mineTargetPoint.y - droneEnt.y) < 50) {
            // 在母体周围 150~300 像素的半径内随机找一个点
            const angle = Math.random() * Math.PI * 2;
            const radius = 150 + Math.random() * 150;
            droneEnt._mineTargetPoint = {
                x: actualFlagship.x + Math.cos(angle) * radius,
                y: actualFlagship.y + Math.sin(angle) * radius
            };
        }

        droneEnt.droneMoveTarget = droneEnt._mineTargetPoint;
        // 慢速/平稳飞行，模拟作业
        droneEnt.droneThrustMultiplier = 0.6;
        
        newState = '环绕采矿';
        if (droneEnt._lastState !== newState) {
            // console.log(`[无人机 ${droneEnt.id}] 战术指令更新: ${newState}`);
            droneEnt._lastState = newState;
        }
    }
}

/**
 * 建筑无人机的专属行为逻辑
 * @param droneEnt 无人机实体
 * @param allShipsList 当前星区内的所有存活实体列表
 */
export function handleBuildDroneBehavior(droneEnt: any, allShipsList: any[]) {
    // 1. 获取母体（旗舰或建筑模块）
    let actualFlagship = getActualFlagship(droneEnt, allShipsList);
    
    // 1.5 拦截强制回收命令
    let isReturning = droneEnt.shipRef && droneEnt.shipRef.isReturning;
    if (isReturning) {
        handleDroneReturnToMothership(droneEnt, actualFlagship, { isUrgentReturn: true });
        return;
    }

    // 2. 索敌逻辑：寻找同阵营正在建造的目标 (限制在母体周围 1000px 内，或者无人机自己周围 1000px 内)
    // 建造虚影如果建好了(isBuilding === false)就不再作为目标
    if (!droneEnt.target || !droneEnt.target.shipRef || !droneEnt.target.shipRef.isBuilding) {
        let closestBuild = null;
        let minBuildDist = Infinity;
        
        // 确定搜索中心（优先用母体的位置，如果找不到母体用自己的位置）
        const searchCenterX = actualFlagship ? actualFlagship.x : droneEnt.x;
        const searchCenterY = actualFlagship ? actualFlagship.y : droneEnt.y;
        
        allShipsList.forEach(other => {
            if (other.id !== droneEnt.id && other.shipRef && other.shipRef.isBuilding) {
                // 检查阵营，只修理友军
                const aff = getAffinity(droneEnt, other);
                if (aff >= 0) {
                    // 检查是否在搜索范围内 (1000px)
                    const distToCenter = Math.hypot(other.x - searchCenterX, other.y - searchCenterY);
                    if (distToCenter <= 1000) {
                        const d = Math.hypot(other.x - droneEnt.x, other.y - droneEnt.y);
                        if (d < minBuildDist) {
                            minBuildDist = d;
                            closestBuild = other;
                        }
                    }
                }
            }
        });
        droneEnt.target = closestBuild;
    }

    // 3. 决定行动意图
    if (droneEnt.target && droneEnt.target.shipRef && droneEnt.target.shipRef.isBuilding) {
        const buildTarget = droneEnt.target;
        const distToTarget = Math.hypot(buildTarget.x - droneEnt.x, buildTarget.y - droneEnt.y);
        
        droneEnt.droneLookTarget = { x: buildTarget.x, y: buildTarget.y };

        let newState = '';

        if (distToTarget > 200) {
            newState = '前往工地';
            droneEnt.droneMoveTarget = { x: buildTarget.x, y: buildTarget.y };
            droneEnt.droneThrustMultiplier = 1.5;
        } else if (distToTarget > 80) {
            newState = '抵近建造';
            droneEnt.droneMoveTarget = { x: buildTarget.x, y: buildTarget.y };
            droneEnt.droneThrustMultiplier = 0.5;
        } else {
            newState = '环绕建造';
            // 绕着目标转圈
            const angle = Math.atan2(droneEnt.y - buildTarget.y, droneEnt.x - buildTarget.x);
            droneEnt.droneMoveTarget = { 
                x: buildTarget.x + Math.cos(angle + 0.5) * 80, 
                y: buildTarget.y + Math.sin(angle + 0.5) * 80 
            };
            droneEnt.droneThrustMultiplier = 0.5;
        }

        droneEnt._idleTimer = 0; // 重置闲置计时器

        if (droneEnt._lastState !== newState) {
            // console.log(`[无人机 ${droneEnt.id}] 战术指令更新: ${newState} -> 目标[${buildTarget.id}], 距离:${Math.round(distToTarget)}`);
            droneEnt._lastState = newState;
        }
    } else if (actualFlagship) {
        // 无建造目标时，开始计时，超过 5 秒 (300帧) 则全速返航
        droneEnt._idleTimer = (droneEnt._idleTimer || 0) + 1;
        if (droneEnt._idleTimer > 300) {
            if (droneEnt._lastState !== '闲置返航') {
                // console.log(`[无人机 ${droneEnt.id}] 超过5秒无建造目标，开始返航。母体坐标:`, actualFlagship);
                droneEnt._lastState = '闲置返航';
            }
            if (droneEnt.shipRef) droneEnt.shipRef.isReturning = true;
            handleDroneReturnToMothership(droneEnt, actualFlagship, { isUrgentReturn: true });
        } else {
            handleDroneReturnToMothership(droneEnt, actualFlagship, { hoverDist: 200 });
        }
    } else {
         // 完全找不到母体的情况：悬停待命
         if (!droneEnt._logNoFlagship) {
             console.warn(`[无人机调试] ${droneEnt.id} 找不到 actualFlagship！悬停待命。`);
             droneEnt._logNoFlagship = true;
         }
         droneEnt.droneMoveTarget = null;
         droneEnt.droneThrustMultiplier = 0;
         droneEnt.droneLookTarget = null;
    }
}

import { getAffinity } from '../Base.js';

/**
 * 攻击无人机的专属行为逻辑
 * @param droneEnt 无人机实体
 * @param allShipsList 当前星区内的所有存活实体列表
 */
export function handleAttackDroneBehavior(droneEnt: any, allShipsList: any[]) {
    // 1. 获取母体（旗舰或建筑模块）
    const actualFlagship = getActualFlagship(droneEnt, allShipsList);

    // 1.5 拦截强制回收命令
    let isReturning = droneEnt.shipRef && droneEnt.shipRef.isReturning;
    if (isReturning) {
        handleDroneReturnToMothership(droneEnt, actualFlagship, { isUrgentReturn: true });
        return;
    }

    // 2. 索敌逻辑：使用全星区真实阵营好感度来判定敌人
    if (!droneEnt.target || droneEnt.target.hp <= 0) {
        let closestEnemy = null;
        let minEnemyDist = Infinity;
        
        allShipsList.forEach(other => {
            if (other.hp > 0 && other.id !== droneEnt.id) {
                // 调取游戏核心的阵营关系系统，判定是否为敌人
                const aff = getAffinity(droneEnt, other);
                let isEnemy = false;
                
                if (other.type === 'freighter') {
                    if (aff <= -50) isEnemy = true;
                } else {
                    if (aff < 0) isEnemy = true;
                }
                
                if (isEnemy) {
                    const d = Math.hypot(other.x - droneEnt.x, other.y - droneEnt.y);
                    if (d < minEnemyDist) {
                        minEnemyDist = d;
                        closestEnemy = other;
                    }
                }
            }
        });
        droneEnt.target = closestEnemy;
    }

    // 3. 决定行动意图（输出给微观物理引擎）
    if (droneEnt.target && droneEnt.target.hp > 0) {
        // --- 战斗模式：追击并开火 ---
        const enemy = droneEnt.target;
        const distToEnemy = Math.hypot(enemy.x - droneEnt.x, enemy.y - droneEnt.y);
        
        // [新增] 无论是前进还是倒车，机头永远死死盯住敌人，以保证主炮火力不中断
        droneEnt.droneLookTarget = { x: enemy.x, y: enemy.y };

        let newState = '';

        if (distToEnemy > 250) {
            // 距离远，全速冲锋接敌
            newState = '冲锋接敌';
            droneEnt.droneMoveTarget = { x: enemy.x, y: enemy.y };
            droneEnt.droneThrustMultiplier = 1.5;
        } else if (distToEnemy > 100) {
            // 进入射程，减速缠斗，机头对准目标开火（底层 Base.ts 只要有 target 且在射程内，炮塔和主炮就会自动开火）
            newState = '减速缠斗';
            droneEnt.droneMoveTarget = { x: enemy.x, y: enemy.y };
            droneEnt.droneThrustMultiplier = 0.5;
        } 

        droneEnt._idleTimer = 0; // 重置闲置计时器

        if (droneEnt._lastState !== newState) {
            // console.log(`[无人机 ${droneEnt.id}] 战术指令更新: ${newState} -> 目标[${enemy.id}], 距离:${Math.round(distToEnemy)}`);
            droneEnt._lastState = newState;
        }
    } else if (actualFlagship) {
        // 无敌人时，开始计时，超过 5 秒 (300帧) 则全速返航
        droneEnt._idleTimer = (droneEnt._idleTimer || 0) + 1;
        if (droneEnt._idleTimer > 300) {
            if (droneEnt._lastState !== '闲置返航') {
                // console.log(`[无人机 ${droneEnt.id}] 超过5秒无敌对目标，开始返航。母体坐标:`, actualFlagship);
                droneEnt._lastState = '闲置返航';
            }
            if (droneEnt.shipRef) droneEnt.shipRef.isReturning = true;
            handleDroneReturnToMothership(droneEnt, actualFlagship, { isUrgentReturn: true });
        } else {
            handleDroneReturnToMothership(droneEnt, actualFlagship, { hoverDist: 300 });
        }
    } else {
         if (!droneEnt._logNoFlagship) {
             console.warn(`[无人机调试] ${droneEnt.id} 找不到 actualFlagship！悬停待命。`);
             droneEnt._logNoFlagship = true;
         }
    }
}

/**
 * 通用的无人机返回/伴随母舰逻辑
 * @param droneEnt 无人机实体
 * @param actualFlagship 母舰实体
 * @param options 配置参数
 */
export function handleDroneReturnToMothership(droneEnt: any, actualFlagship: any, options: { isUrgentReturn?: boolean, hoverDist?: number } = {}) {
    if (!actualFlagship) {
        droneEnt.droneMoveTarget = null;
        droneEnt.droneThrustMultiplier = 0;
        droneEnt.droneLookTarget = null;
        return;
    }

    const { isUrgentReturn = false, hoverDist = 250 } = options;
    const distToFlagship = Math.hypot(actualFlagship.x - droneEnt.x, actualFlagship.y - droneEnt.y);
    let newState = '';

    if (isUrgentReturn) {
        droneEnt.droneLookTarget = { x: actualFlagship.x, y: actualFlagship.y };
        droneEnt.droneMoveTarget = { x: actualFlagship.x, y: actualFlagship.y };
        newState = '满载返航';
        droneEnt.droneThrustMultiplier = 1.5;
    } else {
        droneEnt.droneLookTarget = null;
        if (distToFlagship > 500) {
            newState = '全速归队';
            droneEnt.droneMoveTarget = { x: actualFlagship.x, y: actualFlagship.y };
            droneEnt.droneThrustMultiplier = 1.5;
        } else if (distToFlagship > hoverDist) {
            newState = '平稳伴飞';
            droneEnt.droneMoveTarget = { x: actualFlagship.x, y: actualFlagship.y };
            droneEnt.droneThrustMultiplier = 1.0;
        } else {
            newState = '待命悬停';
            droneEnt.droneMoveTarget = null;
            droneEnt.droneThrustMultiplier = 0;
        }
    }

    if (droneEnt._lastState !== newState) {
        // console.log(`[无人机 ${droneEnt.id}] 战术指令更新: ${newState} -> 母舰[${actualFlagship.id}], 距离:${Math.round(distToFlagship)}`);
        droneEnt._lastState = newState;
    }
}
