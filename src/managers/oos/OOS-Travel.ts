import { moveToTargetPos } from './OOS-Movement.js';

/**
 * 获取通往目标星系的星门坐标（用于 OOS 出发/到达定位）
 */
export function getGatePos(sectorName: string, targetSectorName: string, worldState: any) {
    const sector = worldState.sectors.find((s: any) => s.name === sectorName);
    const target = worldState.sectors.find((s: any) => s.name === targetSectorName);
    if (!sector || !target) return { x: 500, y: 275 };
    
    const angle = Math.atan2(target.y - sector.y, target.x - sector.x);
    const gateRadius = 450; 
    return {
        x: 500 + Math.cos(angle) * gateRadius,
        y: 275 + Math.sin(angle) * gateRadius
    };
}

/**
 * OOS 跨星系移动状态机
 * 处理 DEPARTURE(前往星门) -> WARP(超空间飞行) -> TRANSIT/ARRIVAL(到达星门) 的全过程
 */
/**
 * 触发跃迁逻辑
 */
export function triggerWarp(ship: any, worldState: any) {
    if (!ship.targetGate) return;
    const startNode = worldState.sectors.find((s: any) => s.name === ship.location.sector);
    const endNode = worldState.sectors.find((s: any) => s.name === ship.targetGate);
    if (!startNode || !endNode) return;
    
    const dist = Math.hypot(endNode.x - startNode.x, endNode.y - startNode.y);
    ship.currentLane = {
        from: startNode.name,
        to: endNode.name,
        dist: dist
    };
    ship.state = 'WARP';
    ship.travelProgress = 0;
}

/**
 * OOS 跨星系移动状态机
 * 处理 DEPARTURE(前往星门) -> WARP(超空间飞行) -> TRANSIT/ARRIVAL(到达星门) 的全过程
 */
export function updateTravel(ship: any, dt: number, worldState: any) {
    if (ship.state === 'DEPARTURE') {
        if (ship.targetGate) {
            const targetPos = getGatePos(ship.location.sector, ship.targetGate, worldState);
            moveToTargetPos(ship, targetPos, dt, () => {
                triggerWarp(ship, worldState);
            });
        }
    } 
    else if (ship.state === 'WARP') {
        if (!ship.currentLane) {
            ship.state = 'IDLE';
            return;
        }
        
        let warpSpeedModifier = 0.08; 
        if (ship.type === 'fighter') warpSpeedModifier = 0.1; 
        if (ship.type === 'freighter') warpSpeedModifier = 0.05; 
        if (ship.ownerId === 'player') warpSpeedModifier = 0.5; 
        
        const speed = (100 / ship.currentLane.dist) * dt * warpSpeedModifier; 
        ship.travelProgress += speed;
        
        if (ship.travelProgress >= 1) {
            // 跃迁完成
            ship.location.sector = ship.currentLane.to;
            // [重构修复] 绝对不能把宏观坐标写死成 0,0。必须置空，让微观物理引擎分配星门吐出坐标
            ship.location.x = undefined; 
            ship.location.y = undefined;
            
            // 如果是玩家资产，落地存档
            if (ship.ownerId === 'player') {
                try {
                    const rawOwned = localStorage.getItem('player_owned_ships');
                    if (rawOwned) {
                        const ownedShips = JSON.parse(rawOwned);
                        const pShip = ownedShips.find((s: any) => s.id === ship.id);
                        if (pShip) {
                            pShip.location = { sector: ship.location.sector };
                            localStorage.setItem('player_owned_ships', JSON.stringify(ownedShips));
                        }
                    }
                } catch (e) {
                    console.error('[OOSSimulator] 同步玩家僚机位置失败', e);
                }
            }
            
            const cameFrom = ship.currentLane.from;
            ship.currentLane = null;
            if (ship.path && ship.path.length > 0) {
                ship.path.shift(); 
            }
            
            ship.travelProgress = 0;
            
            // 决定是否还要继续飞下一个门
            if (ship.path && ship.path.length > 0) {
                ship.state = 'TRANSIT';
                ship.transitFromGate = cameFrom;
                ship.transitToGate = ship.path[0];
            } else {
                ship.state = 'ARRIVAL';
                ship.transitFromGate = cameFrom; 
            }
            
            // [修复] 专门针对玩家：在 OOSSimulator 推演结束的瞬间，
            // 无论之后会不会被切回 IDLE，立刻把这张小票硬塞进 localStorage
            if (ship.ownerId === 'player' && ship.id === localStorage.getItem('player_ship_id')) {
                // console.log(`[跃迁调试] 玩家 OOS 跃迁推演完成！写下凭证小票 arrived_from_gate: ${cameFrom}`);
                localStorage.setItem('arrived_from_gate', cameFrom);
            }
        }
    }
    else if (ship.state === 'TRANSIT') {
        if (ship.transitToGate) {
            const targetPos = getGatePos(ship.location.sector, ship.transitToGate, worldState);
            moveToTargetPos(ship, targetPos, dt, () => {
                ship.targetGate = ship.transitToGate;
                triggerWarp(ship, worldState);
            });
        }
    }
    else if (ship.state === 'ARRIVAL') {
        // [铁律] OOS 引擎绝对不允许接管玩家旗舰的降落坐标计算！必须留给微观雷达处理
        if (ship.ownerId === 'player' && ship.id === localStorage.getItem('player_ship_id')) {
            // 不做任何移动，保持 ARRIVAL 状态让前端 Base.ts 去接管
            return;
        }

        const targetPos = { x: 500, y: 275 }; // NPC降落点默认回星区中心
        moveToTargetPos(ship, targetPos, dt, () => {
            ship.state = 'IDLE';
            ship.travelProgress = 0;
        });
    }
}
