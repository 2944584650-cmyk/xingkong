import { applyDamage } from './OOS-Combat.js';

// 为了精确获取泊位坐标
let BuildingManagerRef: any = null;
let GameConfigRef: any = null;
import('../BuildingManager.js').then(m => { BuildingManagerRef = m; });
import('../../config.js').then(m => { GameConfigRef = m.GameConfig; });

/**
 * 计算飞船停靠所需的绝对世界坐标
 */
function getBerthWorldPosition(moduleId: string, berthId: string) {
    if (!BuildingManagerRef || !GameConfigRef) return null;
    const mod = BuildingManagerRef.BuildingManager.getAllModules().find((m: any) => m.uid === moduleId);
    if (!mod) return null;

    const modData = GameConfigRef.MODULES[mod.moduleId];
    if (!modData || !modData.berths) return null;

    const berth = modData.berths.find((b: any) => b.id === berthId);
    if (!berth) return null;

    const worldPos = BuildingManagerRef.BuildingManager.gridToWorld(mod.gridX, mod.gridY);
    const GRID_SIZE = BuildingManagerRef.GRID_PIXEL_SIZE || 550;
    const w = mod.width * GRID_SIZE;
    const h = mod.height * GRID_SIZE;
    let drawX = worldPos.x + w / 2;
    let drawY = worldPos.y + h / 2;
    let scale = 1;

    const rotation = mod.rotation || 0;
    if (modData.connectRule) {
        const isRotated = rotation % 180 !== 0;
        const spriteOrigW = modData.spriteSize ? modData.spriteSize.width : w;
        const spriteOrigH = modData.spriteSize ? modData.spriteSize.height : h;
        const visualOrigW = isRotated ? spriteOrigH : spriteOrigW;
        const visualOrigH = isRotated ? spriteOrigW : spriteOrigH;

        scale = Math.min(w / visualOrigW, h / visualOrigH);
        const actualW = visualOrigW * scale;
        const actualH = visualOrigH * scale;

        let effectiveRule = { ...modData.connectRule };
        if (rotation === 90) effectiveRule = { up: modData.connectRule.left, right: modData.connectRule.up, down: modData.connectRule.right, left: modData.connectRule.down };
        else if (rotation === 180) effectiveRule = { up: modData.connectRule.down, right: modData.connectRule.left, down: modData.connectRule.up, left: modData.connectRule.right };
        else if (rotation === 270) effectiveRule = { up: modData.connectRule.right, right: modData.connectRule.down, down: modData.connectRule.left, left: modData.connectRule.up };

        if (effectiveRule.left === "port") drawX = worldPos.x + actualW / 2;
        else if (effectiveRule.right === "port") drawX = worldPos.x + w - actualW / 2;
        if (effectiveRule.up === "port") drawY = worldPos.y + actualH / 2;
        else if (effectiveRule.down === "port") drawY = worldPos.y + h - actualH / 2;
    }

    const rad = rotation * Math.PI / 180;
    const ox = berth.offset.x * scale;
    const oy = berth.offset.y * scale;

    const rotatedOffsetX = ox * Math.cos(rad) - oy * Math.sin(rad);
    const rotatedOffsetY = ox * Math.sin(rad) + oy * Math.cos(rad);

    return {
        x: drawX + rotatedOffsetX,
        y: drawY + rotatedOffsetY
    };
}

/**
 * 星系内后台抽象移动引擎
 * 使用欧拉积分进行运动学推演（带有惯性和排斥力）
 */
export function moveToTargetPos(ship: any, targetPos: any, dt: number, onReachCallback?: () => void) {
    let maxSpeed = 100;
    let accel = 50;
    let drag = 0.15;
    if (ship.stats) {
        if (ship.stats.thrust && ship.stats.mass) {
            accel = ship.stats.thrust / ship.stats.mass;
            maxSpeed = accel * 1.5;
        }
        if (ship.stats.drag) drag = ship.stats.drag;
    } else {
        if (ship.type === 'fighter') { maxSpeed = 80; accel = 60; }
        else if (ship.type === 'freighter') { maxSpeed = 40; accel = 20; }
    }
    
    // 初始化速度向量
    if (ship.vx === undefined) ship.vx = 0;
    if (ship.vy === undefined) ship.vy = 0;

    const dx = targetPos.x - ship.location.x;
    const dy = targetPos.y - ship.location.y;

    if (isNaN(dx) || isNaN(dy)) {
        ship.location.x = targetPos.x;
        ship.location.y = targetPos.y;
        ship.vx = 0;
        ship.vy = 0;
        if (onReachCallback) onReachCallback();
        return;
    }

    const dist = Math.hypot(dx, dy);

    if (dist > 30) {
        // 计算目标方向的推力
        const dirX = dx / dist;
        const dirY = dy / dist;
        
        ship.vx += dirX * accel * dt;
        ship.vy += dirY * accel * dt;
        
        // 应用阻力 (简单的线性阻力)
        ship.vx *= Math.pow(1 - drag, dt * 60);
        ship.vy *= Math.pow(1 - drag, dt * 60);
        
        // 限制最大速度
        const currentSpeed = Math.hypot(ship.vx, ship.vy);
        if (currentSpeed > maxSpeed) {
            ship.vx = (ship.vx / currentSpeed) * maxSpeed;
            ship.vy = (ship.vy / currentSpeed) * maxSpeed;
        }

        ship.location.x += ship.vx * dt;
        ship.location.y += ship.vy * dt;
        
        if (currentSpeed > 1) {
            ship.rotation = Math.atan2(ship.vy, ship.vx) * 180 / Math.PI;
        }
    } else {
        // 到达目标，应用强阻力刹车
        ship.vx *= 0.8;
        ship.vy *= 0.8;
        if (onReachCallback) {
            onReachCallback();
        }
    }
}

/**
 * OOS 战斗与闲置时的移动逻辑
 * 根据飞船的 commandState 推演其移动轨迹或触发战斗
 */
export function updateCombatAndMove(ship: any, dt: number, allShips: any[]) {
    let targetPos = null;
    let stopDist = 10;
    
    let maxSpeed = 100;
    let accel = 50;
    let drag = 0.15;
    
    if (ship.stats) {
        if (ship.stats.thrust && ship.stats.mass) {
            accel = ship.stats.thrust / ship.stats.mass;
            maxSpeed = accel * 1.5;
        }
        if (ship.stats.drag) drag = ship.stats.drag;
    }
    
    if (ship.vx === undefined) ship.vx = 0;
    if (ship.vy === undefined) ship.vy = 0;
    
    // --- OOS 飞船防重叠分离（Separation）算法 ---
    let sepX = 0;
    let sepY = 0;
    let sepCount = 0;
    const shipRadius = (ship.size === 'large' ? 40 : (ship.size === 'medium' ? 20 : 10));

    // 只和同星区的飞船算排斥
    for (const other of allShips) {
        if (other.id === ship.id || other.location.sector !== ship.location.sector || other.state === 'DOCKED') continue;
        const otherRadius = (other.size === 'large' ? 40 : (other.size === 'medium' ? 20 : 10));
        const minDistance = shipRadius + otherRadius + 10; // 期望保持的最小距离
        
        const dX = ship.location.x - other.location.x;
        const dY = ship.location.y - other.location.y;
        const sqDist = dX*dX + dY*dY;
        
        if (sqDist > 0 && sqDist < minDistance * minDistance) {
            const dist = Math.sqrt(sqDist);
            const force = (minDistance - dist) / dist; // 距离越近排斥力越大
            sepX += dX * force;
            sepY += dY * force;
            sepCount++;
        }
    }
    
    // 应用分离推力
    if (sepCount > 0) {
        ship.vx += (sepX / sepCount) * accel * 0.5 * dt;
        ship.vy += (sepY / sepCount) * accel * 0.5 * dt;
    }

    // --- 指令解析 ---
    if (ship.commandState === 'DOCK' && ship.commandTargetId) {
        // OOS 停泊推演：如果有预分配的泊位，精准飞向泊位世界坐标，否则飞向大致坐标
        targetPos = { x: 500, y: 275 }; 
        stopDist = 15; // 要求更高精度才能停靠
        
        if (ship.dockedBerthId) {
            const berthPos = getBerthWorldPosition(ship.commandTargetId, ship.dockedBerthId);
            if (berthPos) {
                targetPos = berthPos;
                stopDist = 5; // 如果有真实泊位坐标，要求精度更严格，与 IS 一致
            }
        }
        
        const dx = targetPos.x - ship.location.x;
        const dy = targetPos.y - ship.location.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= stopDist) {
            // 到达指定坐标后，速度归零，强制吸附停靠
            ship.vx = 0;
            ship.vy = 0;
            ship.location.x = targetPos.x;
            ship.location.y = targetPos.y;

            import('../ShipManager.js').then(({ ShipManager }) => {
                let berthId = ship.dockedBerthId;
                if (!berthId) {
                    berthId = ShipManager.allocateDockingBerth(ship.commandTargetId, ship.id);
                }
                ShipManager.dockShip(ship.id, ship.commandTargetId, berthId);
                
                // 推进飞船的任务栈：如果当前是停泊任务，则完成它
                if (ship.taskStack && ship.taskStack.length > 0 && ship.taskStack[0].action === 'DOCK_AT_STATION') {
                    ship.taskStack.shift();
                }
            });
            ship.commandState = null;
            return; // 停靠完成，不再移动
        }
    }
    else if (ship.commandState === 'MOVE_TO' && ship.moveTarget) {
        targetPos = ship.moveTarget;
        stopDist = 20;
    }
    else if (ship.commandState === 'ATTACK_TARGET' && ship.commandTargetId) {
        const target = allShips.find(s => s.id === ship.commandTargetId);
        if (target && target.location && target.location.sector === ship.location.sector && target.stats && target.stats.hp > 0) {
            targetPos = target.location;
            stopDist = 200; // 射程内停止
            
            // OOS 战斗距离判定
            const dist = Math.hypot(target.location.x - ship.location.x, target.location.y - ship.location.y);
            if (dist <= 300) {
                applyDamage(ship, target, dt);
            }
        } else {
            ship.commandState = null;
            ship.commandTargetId = null;
        }
    }
    else if (ship.commandState === 'FOLLOW' && ship.commandTargetId) {
        const target = allShips.find(s => s.id === ship.commandTargetId);
        if (target && target.location && target.location.sector === ship.location.sector) {
            // 保持在目标后方带点随机偏移防重叠
            targetPos = { 
                x: target.location.x - 50 + (Math.random() * 20 - 10), 
                y: target.location.y - 50 + (Math.random() * 20 - 10) 
            };
            stopDist = 80;
        } else {
            ship.commandState = null;
        }
    }
    else if (ship.orderQueue && ship.orderQueue.length > 0) {
        const order = ship.orderQueue[0];
        if (order.status === 'FETCHING' && ship.location.sector === order.sellerSector) {
            // 简化的 OOS 坐标：行星在轨道上，这里简单模拟飞向中心附近
            targetPos = { x: 500 + Math.cos(Date.now()/1000) * 280, y: 275 + Math.sin(Date.now()/1000) * 280 }; 
            stopDist = 20;
        }
    }

    // --- 执行移动 (使用运动学积分) ---
    if (targetPos) {
        const dx = targetPos.x - ship.location.x;
        const dy = targetPos.y - ship.location.y;
        
        // 防 NaN 污染
        if (isNaN(dx) || isNaN(dy)) {
            ship.location.x = targetPos.x;
            ship.location.y = targetPos.y;
            ship.vx = 0;
            ship.vy = 0;
            if (ship.commandState === 'MOVE_TO') ship.commandState = null;
            return;
        }

        const dist = Math.hypot(dx, dy);
        
        if (dist > stopDist) {
            const dirX = dx / dist;
            const dirY = dy / dist;
            
            // 目标意图推力
            ship.vx += dirX * accel * dt;
            ship.vy += dirY * accel * dt;
        } else {
            // 到达目标时刹车
            ship.vx *= 0.8;
            ship.vy *= 0.8;
            if (ship.commandState === 'MOVE_TO') {
                ship.commandState = null;
            }
        }
    } else {
        // 如果没有特定目标，也会逐渐减速停下（不闲置乱飘）
        ship.vx *= Math.pow(1 - drag, dt * 60);
        ship.vy *= Math.pow(1 - drag, dt * 60);
    }
    
    // 全局阻力和限速
    ship.vx *= Math.pow(1 - drag, dt * 60);
    ship.vy *= Math.pow(1 - drag, dt * 60);

    const currentSpeed = Math.hypot(ship.vx, ship.vy);
    if (currentSpeed > maxSpeed) {
        ship.vx = (ship.vx / currentSpeed) * maxSpeed;
        ship.vy = (ship.vy / currentSpeed) * maxSpeed;
    }

    // 只有当有实质性速度时，才改变坐标和朝向（防止微小震荡防重叠导致的抖动）
    if (currentSpeed > 0.5) {
        ship.location.x += ship.vx * dt;
        ship.location.y += ship.vy * dt;
        ship.rotation = Math.atan2(ship.vy, ship.vx) * 180 / Math.PI;
    }
}
