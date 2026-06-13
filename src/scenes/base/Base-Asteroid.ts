// @ts-nocheck
// 处理小行星带的生成、渲染与物理交互逻辑

import { PlayerManager } from '../../managers/PlayerManager.js';
import { EventBus, GameEvents } from '../../utils/EventBus.js';

/**
 * 在进入星区时，根据宏观世界状态中的矿带数据，初始化微观小行星实体
 * @param sectorName 星区名称
 * @param worldState 全局状态
 * @param sectorSimulations 星区微观仿真容器
 */
export function initAsteroidsForSector(sectorName: string, worldState: any, sectorSimulations: any) {
    if (!sectorSimulations[sectorName]) {
        sectorSimulations[sectorName] = { defenders: [], attackers: [], projectiles: [], missiles: [], asteroids: [], drops: [] };
    }
    
    if (!sectorSimulations[sectorName].asteroids) {
        sectorSimulations[sectorName].asteroids = [];
    }
    
    if (!sectorSimulations[sectorName].drops) {
        sectorSimulations[sectorName].drops = [];
    }

    // 防止重复初始化
    if (sectorSimulations[sectorName].asteroids.length > 0) return;

    const belts = worldState.asteroidBelts?.filter((b: any) => b.sector === sectorName) || [];
    
    belts.forEach((belt: any) => {
        // 根据丰富度和半径计算生成数量，大概 50~200 颗
        const count = Math.floor(50 + (belt.richness * 150));
        
        for (let i = 0; i < count; i++) {
            // 在圆内随机分布 (极坐标)
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * belt.radius; // 开方让分布更均匀
            
            const size = 0.5 + Math.random() * 1.5; // 大小倍率
            
            sectorSimulations[sectorName].asteroids.push({
                id: `ast_${belt.uid}_${i}`,
                x: belt.worldX + Math.cos(angle) * r,
                y: belt.worldY + Math.sin(angle) * r,
                vx: (Math.random() - 0.5) * 5, // 极其缓慢的漂移
                vy: (Math.random() - 0.5) * 5,
                rotation: Math.random() * 360,
                spinRate: (Math.random() - 0.5) * 20, // 自转速度
                size: size,
                hp: 10, // 固定10血
                maxHp: 10,
                resourceType: belt.resourceType,
                hitFlash: 0
            });
        }
        // console.log(`[Asteroid] 在星区 ${sectorName} 生成了 ${count} 颗小行星 (矿带: ${belt.uid})`);
    });
}

/**
 * 小行星的物理更新与受击判定
 * 在 Base.ts 的 updateSystemRadar 循环中调用
 */
export function updateAsteroids(dt: number, simSectorName: string, sectorSimulations: any, projectiles: any[]) {
    const sim = sectorSimulations[simSectorName];
    if (!sim || !sim.asteroids) return;

    // 1. 更新小行星运动
    for (let i = sim.asteroids.length - 1; i >= 0; i--) {
        const ast = sim.asteroids[i];
        ast.x += ast.vx * dt;
        ast.y += ast.vy * dt;
        ast.rotation += ast.spinRate * dt;
        
        if (ast.hitFlash > 0) ast.hitFlash -= dt;
    }

    // 2. 子弹与小行星的碰撞阻挡 (子弹打在石头上消失并产生特效，石头本身不受损)
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (p.isInstant) continue; 

        let hitAst = null;
        for (const ast of sim.asteroids) {
            const dist = Math.hypot(ast.x - p.x, ast.y - p.y);
            const radius = 60 * ast.size; 
            if (dist < radius) {
                hitAst = ast;
                break;
            }
        }

        if (hitAst) {
            hitAst.hitFlash = 0.1;
            EventBus.dispatchEvent(new CustomEvent('spawn_explosion', { detail: { x: p.x, y: p.y } }));
            projectiles.splice(i, 1); // 子弹被挡住销毁
        }
    }
}
