import { applyDamage } from './OOS-Combat.js';

/**
 * 星系内后台抽象移动引擎
 * 将两点之间的移动简化为直线飞行
 */
export function moveToTargetPos(ship: any, targetPos: any, dt: number, onReachCallback?: () => void) {
    let speed = 30; 
    if (ship.stats && ship.stats.thrust && ship.stats.mass) {
        const accel = ship.stats.thrust / ship.stats.mass;
        speed = accel * 1.0; 
        if (speed < 20) speed = 20; 
        if (speed > 80) speed = 80; 
    } else {
        if (ship.type === 'fighter') speed = 50;
        else if (ship.type === 'freighter') speed = 30;
    }
    
    const dx = targetPos.x - ship.location.x;
    const dy = targetPos.y - ship.location.y;

    if (isNaN(dx) || isNaN(dy)) {
        ship.location.x = targetPos.x;
        ship.location.y = targetPos.y;
        if (onReachCallback) onReachCallback();
        return;
    }

    const dist = Math.hypot(dx, dy);

    if (dist > 30) { 
        ship.location.x += (dx / dist) * speed * dt;
        ship.location.y += (dy / dist) * speed * dt;
        ship.rotation = Math.atan2(dy, dx) * 180 / Math.PI;
    } else {
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
    let speed = ship.stats && ship.stats.speed ? ship.stats.speed : 100;
    
    // 更新推重比计算出的速度作为 fallback
    if (ship.stats && ship.stats.thrust && ship.stats.mass) {
        speed = Math.max(speed, (ship.stats.thrust / ship.stats.mass) * 1.5);
    }
    
    // --- 指令解析 ---
    if (ship.commandState === 'DOCK' && ship.commandTargetId) {
        // OOS 停泊推演：飞向宿主大致坐标（用星系中心近似），到位后申请泊位入库
        targetPos = { x: 500, y: 275 }; 
        stopDist = 60;
        
        const dx = targetPos.x - ship.location.x;
        const dy = targetPos.y - ship.location.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= stopDist) {
            import('../ShipManager.js').then(({ ShipManager }) => {
                // 向系统申请一个可用的泊位
                const berthId = ShipManager.allocateDockingBerth(ship.commandTargetId, ship.id);
                // 无论是否申请到有效泊位，OOS下都强制停靠（如果没有空位，berthId 就是 null，等进了活跃星区再说）
                ShipManager.dockShip(ship.id, ship.commandTargetId, berthId);
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

    // --- 执行移动 ---
    if (targetPos) {
        const dx = targetPos.x - ship.location.x;
        const dy = targetPos.y - ship.location.y;
        
        // 防 NaN 污染
        if (isNaN(dx) || isNaN(dy)) {
            ship.location.x = targetPos.x;
            ship.location.y = targetPos.y;
            if (ship.commandState === 'MOVE_TO') ship.commandState = null;
            return;
        }

        const dist = Math.hypot(dx, dy);
        
        if (dist > stopDist) {
            ship.location.x += (dx / dist) * speed * dt;
            ship.location.y += (dy / dist) * speed * dt;
            ship.rotation = Math.atan2(dy, dx) * 180 / Math.PI;
        } else {
            if (ship.commandState === 'MOVE_TO') {
                ship.commandState = null;
            }
        }
    }
}
