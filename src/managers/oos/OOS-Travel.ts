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
export function triggerWarp(ship: any, nextGateName: string, worldState: any) {
    if (!nextGateName) return;
    const startNode = worldState.sectors.find((s: any) => s.name === ship.location.sector);
    const endNode = worldState.sectors.find((s: any) => s.name === nextGateName);
    if (!startNode || !endNode) return;
    
    const dist = Math.hypot(endNode.x - startNode.x, endNode.y - startNode.y);
    const finalDist = Math.max(10, dist); // 防止原地TP导致距离为0
    
    ship.currentLane = {
        from: startNode.name,
        to: endNode.name,
        dist: finalDist
    };
    ship.state = 'WARP';
    ship.travelProgress = 0;
    
    // --- 添加调试信息：飞船触发跃迁 ---
    // console.log(`[星门穿越] 飞船 [${ship.name}] (ID: ${ship.id}) 进入星门网络，开始从 [${startNode.name}] 跃迁至 [${endNode.name}]，航道距离：${finalDist.toFixed(0)}`);
}

/**
 * OOS 跨星系移动状态机
 * 处理 WARP(超空间飞行) 的进度推演
 * 注意：前往星门的过程(DEPARTURE/TRANSIT)已交由 Base.ts 全权物理推演，此处不再越俎代庖
 */
export function updateTravel(ship: any, dt: number, worldState: any) {
    if (ship.state === 'WARP') {
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
            const cameFrom = ship.currentLane.from;
            const newSector = ship.currentLane.to;
            
            // 获取新星系里通往上一个星系的星门坐标
            const arrivalGatePos = getGatePos(newSector, cameFrom, worldState);
            
            ship.location.sector = newSector;
            // 抽象分配，直接把飞船丢到星门上（无物理移动过程）
            ship.location.x = arrivalGatePos.x; 
            ship.location.y = arrivalGatePos.y;
            ship.vx = 0;
            ship.vy = 0;
            
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
    else if (ship.state === 'ARRIVAL') {
        // [铁律] OOS 引擎绝对不允许接管玩家旗舰的降落坐标计算！必须留给微观雷达处理
        if (ship.ownerId === 'player' && ship.id === localStorage.getItem('player_ship_id')) {
            // 不做任何移动，保持 ARRIVAL 状态让前端 Base.ts 去接管
            return;
        }

        // 不再进行物理坐标位移，直接恢复为 IDLE
        ship.state = 'IDLE';
        ship.travelProgress = 0;
    }
}
