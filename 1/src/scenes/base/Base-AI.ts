import { PlayerManager } from '../../managers/PlayerManager.js';
import { ShipManager } from '../../managers/ShipManager.js';
import { WorldbookManager } from '../WorldbookManager.js';
import { getAffinity } from '../Base.js';

/**
 * 提取自 Base.ts 的通用 AI 寻路与行为判定逻辑
 */
export function processAILogic(ent, allShipsList, dt, context) {
    // 【硬件断路器】如果飞船是一个未完工的虚影，绝对静止，不执行任何AI逻辑
    if (ent.shipRef && ent.shipRef.isBuilding) {
        return {
            action: 'continue',
            moveTarget: null,
            lookTarget: null,
            thrustMultiplier: 0,
            targetDx: 0,
            targetDy: 0
        };
    }

    const { simGates, simSectorName, planetX, planetY, defenseX, defenseY, baseMaxSpeed, pd, worldState } = context;

    let moveTarget = null;
    let lookTarget = null;
    let thrustMultiplier = 1.0;
    let allowSuperCruise = false;
    let targetDx = 0;
    let targetDy = 0;

    // --- 1. 基础索敌与状态初始化 ---
    // 工具函数：基于动态好感度公式的真实阵营索敌
    const findTarget = (entity, allShipsList) => {
        let closest = null;
        let minDist = Infinity;
        
        allShipsList.forEach(other => {
            if (other.hp > 0 && other.id !== entity.id) {
                const aff = getAffinity(entity, other);
                let isEnemy = false;
                
                if (other.type === 'freighter') {
                    if (aff <= -50) isEnemy = true;
                } else {
                    if (aff < 0) isEnemy = true;
                }
                
                if (isEnemy) {
                    const d = Math.hypot(other.x - entity.x, other.y - entity.y);
                    if (d < minDist) { 
                        minDist = d; 
                        closest = other; 
                    }
                }
            }
        });
        return closest;
    };

    // 为战斗机和货船进行索敌
    if (ent.type === 'fighter' || ent.type === 'freighter') {
        if (!ent.target || ent.target.hp <= 0) {
            ent.target = findTarget(ent, allShipsList);
        }
    } else if (ent.type !== 'drone') {
        ent.target = null; // 非战斗单位不保留目标
    }

    // --- 2. 宏观状态驱动的导航点计算 ---
    if (ent.shipRef) {
        // 正在离开星区，飞向目标星门
        if (ent.shipRef.state === 'DEPARTURE') {
            const gatePos = simGates[ent.shipRef.targetGate];
            if (gatePos) {
                moveTarget = { x: gatePos.x, y: gatePos.y };
                allowSuperCruise = true;
            }
        } 
        // 正在星门网络中穿行，飞向出口星门
        else if (ent.shipRef.state === 'TRANSIT') {
            const gatePos = simGates[ent.shipRef.transitToGate];
            if (gatePos) {
                moveTarget = { x: gatePos.x, y: gatePos.y };
                allowSuperCruise = true;
            }
        } 
        // 到达目标星区，飞向星系中心
        else if (ent.shipRef.state === 'ARRIVAL') {
            let tx = planetX;
            let ty = planetY;
            if (ent.type === 'freighter') {
                tx = planetX; ty = planetY;
            } else if (ent.type === 'fighter') {
                tx = defenseX; ty = defenseY;
            }
            moveTarget = { x: tx, y: ty };
        }
    }

    // 无人机的专属移动目标
    if (!moveTarget && ent.type === 'drone' && ent.droneMoveTarget) {
        moveTarget = { x: ent.droneMoveTarget.x, y: ent.droneMoveTarget.y };
    }
    
    let hasManualOverride = false;
    let isCommandDocking = false; // 标记是否处于指令停靠状态

    // --- 2.5 提取出来的公共精确停靠物理逻辑 ---
    // 不再局限于 isWingman，任何身上挂有 dockingGuidanceTarget 的实体都可以执行
    if (ent.shipRef && ent.shipRef.commandState === 'DOCK' && ent.dockingGuidanceTarget) {
        isCommandDocking = true;
        hasManualOverride = true;
        const tgtX = ent.dockingGuidanceTarget.worldX;
        const tgtY = ent.dockingGuidanceTarget.worldY;
        const distToDock = Math.hypot(tgtX - ent.x, tgtY - ent.y);
        const entryAngle = ent.dockingGuidanceTarget.entryAngle; // 获取泊位的朝向要求

        ent.target = null; // 停靠时不开火
        
        // 距离大于 1000px，允许超巡赶路
        if (distToDock > 1000) {
            allowSuperCruise = true;
            moveTarget = { x: tgtX, y: tgtY };
            thrustMultiplier = 1.0;
        } else {
            allowSuperCruise = false; // 近距离进港禁止巡航
            
            // --- 靠近泊位时的平移对接逻辑 ---
            if (distToDock < 150 && entryAngle !== undefined) {
                // 当距离小于 150 时，强制锁定船头朝向泊位要求的角度
                // 不再使用 moveTarget 来让物理引擎自动转头
                moveTarget = null;
                
                // 用一个极远的虚拟点来“锁死” lookTarget 维持固定角度
                const rad = entryAngle * Math.PI / 180;
                ent.dockingLookOverride = {
                    x: ent.x + Math.cos(rad) * 1000,
                    y: ent.y + Math.sin(rad) * 1000
                };
                
                // 计算平移推力方向 (上下左右微调)
                const dx = tgtX - ent.x;
                const dy = tgtY - ent.y;
                
                ent.dockingStrafeDx = dx / distToDock;
                ent.dockingStrafeDy = dy / distToDock;
                
                thrustMultiplier = 0.2;
                if (distToDock < 50) thrustMultiplier = 0.1;
                
            } else {
                // 150 ~ 1000 之间，正常转头飞向吸附点
                moveTarget = { x: tgtX, y: tgtY };
                thrustMultiplier = 1.0;
                ent.dockingLookOverride = null;
                ent.dockingStrafeDx = 0;
                ent.dockingStrafeDy = 0;
            }
        }
    }


    // --- 3. 僚机高级 AI 逻辑 (玩家编队/指挥) ---
    // 包含物理编队、独立狗斗和 RTS 指令覆盖
    if (ent.isWingman && !isCommandDocking) {
        // 如果已经被公共的指令停靠接管，就不走这里的僚机逻辑
        
        // 优先处理宏观跨星区移动指令
        if (ent.shipRef && (ent.shipRef.state === 'DEPARTURE' || ent.shipRef.state === 'TRANSIT')) {
            hasManualOverride = true;
            thrustMultiplier = 1.0;
            ent.target = null; // 赶路时不主动索敌
            allowSuperCruise = true;
        } 
        // 处理强制移动到坐标点指令
        else if (ent.shipRef && ent.shipRef.commandState === 'MOVE_TO') {
            if (!ent.moveTarget && ent.shipRef.moveTarget) {
                ent.moveTarget = { x: ent.shipRef.moveTarget.x, y: ent.shipRef.moveTarget.y };
            }
            
            if (ent.moveTarget) {
                moveTarget = ent.moveTarget;
                thrustMultiplier = 1.0;
                hasManualOverride = true;
                ent.target = null; // 移动时不开火
                allowSuperCruise = true;
                
                // 到达目标点附近后解除移动指令
                if (Math.hypot(ent.moveTarget.x - ent.x, ent.moveTarget.y - ent.y) < 150) {
                    ent.guardPoint = { x: ent.moveTarget.x, y: ent.moveTarget.y };
                    ent.shipRef.commandState = null;
                    ent.moveTarget = null;
                    ent.shipRef.moveTarget = null;
                }
            }
        } 
        // 处理强制攻击指令
        else if (ent.shipRef && ent.shipRef.commandState === 'ATTACK_TARGET') {
            if (ent.target && ent.target.hp > 0) {
                thrustMultiplier = 1.2; // 战斗时推力增强
                hasManualOverride = true;
            } else {
                // 目标已死，解除强制攻击
                ent.shipRef.commandState = null;
                ent.target = null;
            }
        } 
        // 处理跟随特定目标指令
        else if (ent.shipRef && ent.shipRef.commandState === 'FOLLOW' && ent.shipRef.commandTargetId) {
            const targetUnit = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
            if (targetUnit && targetUnit.hp > 0) {
                hasManualOverride = true;
                ent.target = null; 
                
                const tRot = (targetUnit.rotation || 0) * (Math.PI / 180);
                const offsetDist = 80;
                const tx = targetUnit.x - Math.cos(tRot) * offsetDist;
                const ty = targetUnit.y - Math.sin(tRot) * offsetDist;
                
                moveTarget = { x: tx, y: ty };
                
                const dist = Math.hypot(tx - ent.x, ty - ent.y);
                thrustMultiplier = (dist > 150) ? 1.5 : (dist > 50 ? 1.0 : 0.5);
            } else {
                let mId = ent.shipRef.commandTargetId;
                if (mId === 'player_ship') {
                    mId = pd.playerShipId;
                }
                const mTarget = ShipManager.getShipById(mId);
                
                if (mTarget && mTarget.stats && mTarget.stats.hp > 0) {
                    let targetDestSector = mTarget.location.sector;
                    if (mTarget.state === 'WARP' && mTarget.currentLane) {
                        targetDestSector = mTarget.currentLane.to;
                    }
                    
                    if (targetDestSector !== simSectorName) {
                        const startNode = worldState.sectors.find(s => s.name === simSectorName);
                        const endNode = worldState.sectors.find(s => s.name === targetDestSector);
                        if (startNode && endNode) {
                            const pathNodes = WorldbookManager.getStarlanePath(startNode, endNode, worldState.sectors);
                            if (pathNodes && pathNodes.length > 1) {
                                ent.shipRef.path = pathNodes.map(n => n.name).slice(1);
                                ent.shipRef.state = 'DEPARTURE';
                                ent.shipRef.targetGate = ent.shipRef.path[0];
                                hasManualOverride = true;
                                thrustMultiplier = 1.0;
                                allowSuperCruise = true; 
                            } else {
                                ent.shipRef.commandState = null; 
                            }
                        } else {
                            ent.shipRef.commandState = null;
                        }
                    } else if (mTarget.state === 'WARP' || mTarget.state === 'DEPARTURE' || mTarget.state === 'TRANSIT' || mTarget.state === 'ARRIVAL') {
                        moveTarget = { x: 500, y: 275 };
                        thrustMultiplier = 0.5; 
                        hasManualOverride = true;
                    } else if (mTarget.dockedAt) {
                        moveTarget = { x: 500, y: 275 };
                        thrustMultiplier = 0.5;
                        hasManualOverride = true;
                    } else {
                        ent.shipRef.commandState = null; 
                    }
                } else {
                    ent.shipRef.commandState = null; 
                }
            }
        } 
        // 处理护卫指令 (在目标周围环绕并攻击靠近的敌人)
        else if (ent.shipRef && ent.shipRef.commandState === 'DEFEND' && ent.shipRef.commandTargetId) {
            const targetUnit = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
            if (targetUnit && targetUnit.hp > 0) {
                hasManualOverride = true;
                
                // 计算护卫时的环绕阵位
                const orbitTime = (context.systemMapOrbitTime || 0) * 1000 + (ent.id.charCodeAt(0) || 0);
                const tx = targetUnit.x + Math.cos(orbitTime) * 100;
                const ty = targetUnit.y + Math.sin(orbitTime) * 100;
                
                if (ent.target && ent.target.hp > 0) {
                    const distToEnemy = Math.hypot(ent.target.x - targetUnit.x, ent.target.y - targetUnit.y);
                    if (distToEnemy < 400) {
                        thrustMultiplier = 1.2;
                    }
                } else {
                    moveTarget = { x: tx, y: ty };
                    thrustMultiplier = 1.0;
                    
                    let closestThreat = null;
                    let minThreatDist = 400;
                    allShipsList.forEach(other => {
                        if (other.hp > 0 && other.id !== ent.id && other.id !== targetUnit.id) {
                            if (getAffinity(targetUnit, other) < 0 || getAffinity(ent, other) < 0) {
                                const d = Math.hypot(other.x - targetUnit.x, other.y - targetUnit.y);
                                if (d < minThreatDist) {
                                    minThreatDist = d;
                                    closestThreat = other;
                                }
                            }
                        }
                    });
                    if (closestThreat) {
                        ent.target = closestThreat;
                    }
                }
            } else {
                let mId = ent.shipRef.commandTargetId;
                if (mId === 'player_ship') {
                    mId = pd.playerShipId;
                }
                const mTarget = ShipManager.getShipById(mId);
                
                if (mTarget && mTarget.stats && mTarget.stats.hp > 0) {
                    let targetDestSector = mTarget.location.sector;
                    if (mTarget.state === 'WARP' && mTarget.currentLane) {
                        targetDestSector = mTarget.currentLane.to;
                    }
                    
                    if (targetDestSector !== simSectorName) {
                        const startNode = worldState.sectors.find(s => s.name === simSectorName);
                        const endNode = worldState.sectors.find(s => s.name === targetDestSector);
                        if (startNode && endNode) {
                            const pathNodes = WorldbookManager.getStarlanePath(startNode, endNode, worldState.sectors);
                            if (pathNodes && pathNodes.length > 1) {
                                ent.shipRef.path = pathNodes.map(n => n.name).slice(1);
                                ent.shipRef.state = 'DEPARTURE';
                                ent.shipRef.targetGate = ent.shipRef.path[0];
                                hasManualOverride = true;
                                thrustMultiplier = 1.0;
                                allowSuperCruise = true; 
                            } else {
                                ent.shipRef.commandState = null; 
                            }
                        } else {
                            ent.shipRef.commandState = null;
                        }
                    } else if (mTarget.state === 'WARP' || mTarget.state === 'DEPARTURE' || mTarget.state === 'TRANSIT' || mTarget.state === 'ARRIVAL') {
                        moveTarget = { x: 500, y: 275 };
                        thrustMultiplier = 0.5; 
                        hasManualOverride = true;
                    } else if (mTarget.dockedAt) {
                        moveTarget = { x: 500, y: 275 };
                        thrustMultiplier = 0.5;
                        hasManualOverride = true;
                    } else {
                        ent.shipRef.commandState = null; 
                    }
                } else {
                    ent.shipRef.commandState = null; 
                }
            }
        }

        // 如果没有收到明确的覆盖指令，执行默认编队与防卫逻辑
        if (!hasManualOverride) {
            // 如果自己没有目标，尝试共享玩家旗舰的目标，或者自动索敌
            if (!ent.target) {
                const pEnt = allShipsList.find(s => String(s.id) === String(pd.playerShipId));
                if (pEnt && pEnt.target && pEnt.target.hp > 0) {
                    ent.target = pEnt.target;
                } else {
                    ent.target = findTarget(ent, allShipsList);
                }
            }

            if (ent.target && ent.target.hp > 0) {
                // 存在目标，进入战斗姿态，推力提升
                thrustMultiplier = 1.2; 
            } else {
                // 无战斗发生，保持编队飞行
                allowSuperCruise = true;
                const myFleet = ShipManager.getFleetByShipId(ent.id);
                
                let actualFlagship = null;
                if (myFleet) {
                    if (myFleet.flagshipId === ent.id) {
                        if (!ent.guardPoint) {
                            ent.guardPoint = { x: ent.x, y: ent.y };
                        }
                        moveTarget = { x: ent.guardPoint.x, y: ent.guardPoint.y };
                        
                        const distToGuard = Math.hypot(ent.guardPoint.x - ent.x, ent.guardPoint.y - ent.y);
                        if (distToGuard > 150) thrustMultiplier = 1.0;
                        else if (distToGuard > 50) thrustMultiplier = 0.5;
                        else thrustMultiplier = 0;
                    } else {
                        if (myFleet.flagshipId === 'player_ship' || myFleet.flagshipId === pd.playerShipId) {
                            actualFlagship = allShipsList.find(s => String(s.id) === String(pd.playerShipId));
                        } else {
                            actualFlagship = allShipsList.find(s => s.id === myFleet.flagshipId);
                        }
                    }
                }

                if (actualFlagship) {
                    // === V-Formation 舰队阵型计算 ===
                    let myIndex = myFleet.members.filter(id => id !== actualFlagship.id).indexOf(ent.id);
                    if (myIndex === -1) myIndex = 0; 

                    const row = Math.floor(myIndex / 2) + 1;
                    const isLeft = myIndex % 2 === 0;

                    // 计算左右和后方的偏移量
                    const lateralSpacing = 120 + row * 20;
                    const longitudinalSpacing = 120 + row * 20;

                    const lateralOffset = (isLeft ? -1 : 1) * row * lateralSpacing;
                    const longitudinalOffset = -row * longitudinalSpacing;

                    // 根据旗舰当前朝向旋转偏移矢量
                    const fRot = (actualFlagship.rotation || 0) * (Math.PI / 180);
                    const cosR = Math.cos(fRot);
                    const sinR = Math.sin(fRot);

                    const targetX = actualFlagship.x + (longitudinalOffset * cosR - lateralOffset * sinR);
                    const targetY = actualFlagship.y + (longitudinalOffset * sinR + lateralOffset * cosR);

                    moveTarget = { x: targetX, y: targetY };
                    
                    // 根据距离阵位的远近动态调整推力，实现“橡皮筋”编队效果
                    const distToFormation = Math.hypot(targetX - ent.x, targetY - ent.y);
                    const flagshipSpeed = Math.hypot(actualFlagship.vx || 0, actualFlagship.vy || 0);
                    
                    if (distToFormation > 600) {
                        thrustMultiplier = 1.5;
                    } else if (distToFormation > 200) {
                        thrustMultiplier = 1.2;
                    } else if (distToFormation > 80) {
                        thrustMultiplier = 1.0;
                    } else {
                        if (flagshipSpeed > 5) {
                            thrustMultiplier = 1.0; 
                        } else {
                            thrustMultiplier = 0; 
                        }
                        ent.formationSync = {
                            target: actualFlagship,
                            speed: flagshipSpeed
                        };
                    }
                }
            }
        }
    }

    // --- 4. 其它特定单位类型的巡航逻辑补充 ---
    // 野生货船赶路时允许巡航
    if (!ent.isWingman && ent.type === 'freighter' && !ent.target) {
        allowSuperCruise = true;
    }

    // 战斗机接敌时放弃固定移动点，全面追击并允许巡航
    if (ent.type === 'fighter' && ent.target) {
        moveTarget = null;
        allowSuperCruise = true;
    }
    
    // 拦截：处理宏观下发的随机巡逻游荡状态
    if (ent.shipRef && ent.shipRef.commandState === 'PATROL_ROAMING' && !ent.target) {
        // 从宏观任务栈中提取随机生成的巡逻点
        if (ent.shipRef.taskStack && ent.shipRef.taskStack.length > 0) {
            const currentTask = ent.shipRef.taskStack[0];
            if (currentTask.action === 'PATROL_SECTOR' && currentTask.targetPos) {
                moveTarget = { x: currentTask.targetPos.x, y: currentTask.targetPos.y };
                thrustMultiplier = 0.8; // 提升巡航基础推力
                allowSuperCruise = true; // 允许超级巡航，避免远距离漫游耗时过长
            }
        }
    }

    // --- 5. 引擎预热与超级巡航 (SuperCruise) 核心执行逻辑 ---
    let cruiseDest = moveTarget || ent.target;

    // 如果允许巡航且存在明确目的地
    if (allowSuperCruise && cruiseDest) {
        const distToDest = Math.hypot(cruiseDest.x - ent.x, cruiseDest.y - ent.y);
        if (distToDest > 600) {
            const targetAngleToDest = Math.atan2(cruiseDest.y - ent.y, cruiseDest.x - ent.x) * 180 / Math.PI;
            let angleDiff = targetAngleToDest - (ent.rotation || 0);
            angleDiff = Math.abs(((angleDiff + 180) % 360 + 360) % 360 - 180);

            if (angleDiff > 30) {
                ent.superCruiseTimer = 0;
                ent.isSuperCruising = false;
            } else {
                if (ent.superCruiseTimer === undefined) ent.superCruiseTimer = 0;
                ent.superCruiseTimer += dt;
                
                if (ent.superCruiseTimer >= 3.0) {
                    ent.isSuperCruising = true;
                    thrustMultiplier = 6.0;
                } else {
                    thrustMultiplier = 0.0;
                }
            }
        } else {
            ent.superCruiseTimer = 0;
            ent.isSuperCruising = false;
        }
    } else {
        ent.superCruiseTimer = 0;
        ent.isSuperCruising = false;
    }

    // --- 6. 最终位移与朝向 (lookTarget / targetDx/Dy) 计算 ---
    
    // 拦截：如果是近距离精准平移对接状态
    if (isCommandDocking && ent.dockingLookOverride) {
        lookTarget = ent.dockingLookOverride;
        targetDx = ent.dockingStrafeDx || 0;
        targetDy = ent.dockingStrafeDy || 0;
        // thrustMultiplier 已经在上面设置过了 (0.1 ~ 0.2)
    }
    // 如果存在需要前往的坐标点
    else if (moveTarget) {
        lookTarget = moveTarget;
        const dx = moveTarget.x - ent.x;
        const dy = moveTarget.y - ent.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist < 60) {
            // 到达目标逻辑：交由外部调用 tryEnterStargate 处理，此处不再调用 context 的函数，而是设置标志
            if (ent.shipRef && ent.shipRef.state === 'ARRIVAL') {
                ent.shipRef.forceCompleteTravel(worldState);
                if (!ent.isWingman) {
                    if (ent.type === 'freighter') {
                        let hostId = 'station';
                        if (Math.hypot(moveTarget.x - planetX, moveTarget.y - planetY) < 10) hostId = 'planet';
                        else if (Math.hypot(moveTarget.x - defenseX, moveTarget.y - defenseY) < 10) hostId = 'defense';
                        ShipManager.dockShip(ent.id, hostId);
                        ent.isDocked = true; 
                        return { action: 'dock', hostId: hostId };
                    }
                }
            } else {
                return { action: 'tryEnterStargate' };
            }
        }
        
        if (dist > 30 || ent.formationSync) { 
            const curSpeed = Math.hypot(ent.vx, ent.vy);
            
            if (ent.formationSync) {
                const fTarget = ent.formationSync.target;
                const fSpeed = ent.formationSync.speed;
                
                lookTarget = {
                    x: ent.x + Math.cos(fTarget.rotation * Math.PI / 180) * 100,
                    y: ent.y + Math.sin(fTarget.rotation * Math.PI / 180) * 100
                };
                
                if (fSpeed > 5) {
                    const fRad = fTarget.rotation * Math.PI / 180;
                    targetDx = Math.cos(fRad);
                    targetDy = Math.sin(fRad);
                    
                    if (dist > 10) {
                        const corrRatio = Math.min(1.0, dist / 80);
                        targetDx = targetDx * (1 - corrRatio) + (dx / dist) * corrRatio;
                        targetDy = targetDy * (1 - corrRatio) + (dy / dist) * corrRatio;
                        
                        const tLen = Math.hypot(targetDx, targetDy);
                        if (tLen > 0) { targetDx /= tLen; targetDy /= tLen; }
                        
                        if (curSpeed < fSpeed) thrustMultiplier = 1.1;
                        else thrustMultiplier = 0.9;
                    } else {
                        if (curSpeed < fSpeed) thrustMultiplier = 1.0;
                        else thrustMultiplier = 0.95;
                    }
                } else {
                    targetDx = 0;
                    targetDy = 0;
                    thrustMultiplier = 0;
                    const dampingFactor = Math.pow(0.92, dt * 60);
                    ent.vx *= dampingFactor;
                    ent.vy *= dampingFactor;
                }
                
                ent.isBrakingToZero = false;
                ent.formationSync = null; 
                
            } else {
                const velTowardsTarget = (ent.vx * dx + ent.vy * dy) / dist;
                
                if (velTowardsTarget < -5 && curSpeed > 10) {
                    ent.isBrakingToZero = true;
                }

                if (ent.isBrakingToZero) {
                    if (curSpeed < 5) {
                        ent.isBrakingToZero = false; 
                        thrustMultiplier = 0;
                    } else {
                        const dampingFactor = Math.pow(0.92, dt * 60);
                        ent.vx *= dampingFactor;
                        ent.vy *= dampingFactor;
                        thrustMultiplier = 0; 
                        targetDx = 0;
                        targetDy = 0;
                    }
                } else if (ent.superCruiseTimer > 0) {
                    targetDx = dx / dist;
                    targetDy = dy / dist;
                } else {
                    targetDx = dx / dist;
                    targetDy = dy / dist;
                    
                    const ratio = Math.min(1.0, dist / 100000);
                    thrustMultiplier = Math.max(0.2, ratio);
                    
                    const expectedSpeed = Math.max(30, baseMaxSpeed * ratio);
                    if (curSpeed > expectedSpeed) {
                        const dampingFactor = Math.pow(0.95, dt * 60);
                        ent.vx *= dampingFactor;
                        ent.vy *= dampingFactor;
                    }
                }
            }
        }
    } 
    // 如果是战斗机且处于接敌狗斗状态 (没有 moveTarget)
    else if (ent.type === 'fighter' && ent.target) {
        lookTarget = ent.target;
        const dx = ent.target.x - ent.x;
        const dy = ent.target.y - ent.y;
        const dist = Math.hypot(dx, dy);
        const curSpeed = Math.hypot(ent.vx, ent.vy);
        
        if (dist > 250) {
            const velTowardsTarget = (ent.vx * dx + ent.vy * dy) / dist;
            
            if (velTowardsTarget < -5 && curSpeed > 10) {
                ent.isBrakingToZero = true;
            }

            if (ent.isBrakingToZero) {
                if (curSpeed < 5) {
                    ent.isBrakingToZero = false;
                    thrustMultiplier = 0;
                } else {
                    const dampingFactor = Math.pow(0.92, dt * 60);
                    ent.vx *= dampingFactor;
                    ent.vy *= dampingFactor;
                    thrustMultiplier = 0; 
                    targetDx = 0;
                    targetDy = 0;
                }
            } else if (ent.superCruiseTimer > 0) {
                targetDx = dx / dist;
                targetDy = dy / dist;
            } else {
                targetDx = dx / dist;
                targetDy = dy / dist;
                
                const ratio = Math.min(1.0, Math.max(0, (dist - 250) / 99750));
                thrustMultiplier = Math.max(0.2, ratio);
                
                const expectedSpeed = Math.max(40, baseMaxSpeed * ratio);
                if (curSpeed > expectedSpeed) {
                    const dampingFactor = Math.pow(0.95, dt * 60);
                    ent.vx *= dampingFactor;
                    ent.vy *= dampingFactor;
                }
            }
        } else if (dist > 0.1) { 
            const velTowardsTarget = (ent.vx * dx + ent.vy * dy) / dist;
            
            if (velTowardsTarget < -5 && curSpeed > 10) {
                ent.isBrakingToZero = true;
            }

            if (ent.isBrakingToZero) {
                if (curSpeed < 5) {
                    ent.isBrakingToZero = false;
                    thrustMultiplier = 0;
                } else {
                    const dampingFactor = Math.pow(0.92, dt * 60);
                    ent.vx *= dampingFactor;
                    ent.vy *= dampingFactor;
                    thrustMultiplier = 0; 
                    targetDx = 0;
                    targetDy = 0;
                }
            } else if (curSpeed > 40) {
                targetDx = 0;
                targetDy = 0;
                thrustMultiplier = 0; 
                const dampingFactor = Math.pow(0.92, dt * 60);
                ent.vx *= dampingFactor;
                ent.vy *= dampingFactor;
            } else {
                targetDx = dx / dist;
                targetDy = dy / dist;
                thrustMultiplier = 0.1; 
                
                if (dist < 80) {
                    targetDx = -dx / dist;
                    targetDy = -dy / dist;
                    thrustMultiplier = 0.2;
                }
            }
        }
    } 
    // 特殊：无人机受母体或特殊逻辑的完全控制
    else if (ent.type === 'drone' && ent.droneThrustMultiplier !== undefined) {
        thrustMultiplier = ent.droneThrustMultiplier;
        if (ent.droneMoveTarget) {
            const dx = ent.droneMoveTarget.x - ent.x;
            const dy = ent.droneMoveTarget.y - ent.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
                targetDx = dx / dist;
                targetDy = dy / dist;
                lookTarget = ent.droneLookTarget || ent.droneMoveTarget;
            }
        } else {
            targetDx = 0;
            targetDy = 0;
            if (ent.droneLookTarget) lookTarget = ent.droneLookTarget;
        }
    } 
    // 无事可做的待机单位
    else {
        thrustMultiplier = 0;
        targetDx = 0;
        targetDy = 0;
        
        // 依照惯性方向看向前方
        if (Math.hypot(ent.vx, ent.vy) > 1) {
            lookTarget = { x: ent.x + ent.vx, y: ent.y + ent.vy };
        }
    }

    // 返回计算出的指令状态，供 Base.ts 主循环应用物理引擎推力
    return {
        action: 'continue',
        moveTarget,
        lookTarget,
        thrustMultiplier,
        targetDx,
        targetDy
    };
}
