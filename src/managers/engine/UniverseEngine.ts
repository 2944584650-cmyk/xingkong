import { WorldbookManager } from '../../scenes/WorldbookManager.js';
import { ShipManager } from '../ShipManager.js';
import { processMacroBuildingQueue } from '../building/BuildingProcessor.js';
import { processMacroDockingQueue } from '../../scenes/base/Base-Docking.js';
import { NavigationSystem } from './systems/NavigationSystem.js';
import { GameConfig } from '../../config.js';
import { GRID_PIXEL_SIZE } from '../BuildingManager.js';

export interface SpatialRegistryEntry {
    sector: string;
    worldX: number; // 模块中心世界坐标
    worldY: number; // 模块中心世界坐标
    rotation: number; // 模块自身旋转角度
    berths: Record<string, { worldX: number, worldY: number, entryAngle: number }>;
}

/**
 * 宇宙核心模拟引擎 (Universe Engine)
 * 目标：脱离 Phaser 渲染层，独立负责全宇宙实体的数据演化与推演。
 */
export class UniverseEngine {
    // ------------------------------------------------------------------------
    // [空间注册表系统 (Spatial Registry)]
    // ------------------------------------------------------------------------
    /**
     * 全局空间注册表：Map<模块UID, 空间物理信息>
     * 解决双端(IS/OOS)寻路、停泊时获取绝对物理坐标的问题，避免反复计算与图形层的耦合。
     */
    private static spatialRegistry: Map<string, SpatialRegistryEntry> = new Map();

    /**
     * 构建或全量重建全局空间注册表
     */
    static buildSpatialRegistry(worldState: any) {
        this.spatialRegistry.clear();
        if (!worldState || !worldState.stations) return;

        let count = 0;
        worldState.stations.forEach((station: any) => {
            if (station.modules) {
                station.modules.forEach((mod: any) => {
                    this.registerModule(station, mod);
                    count++;
                });
            }
        });
        // 移除高频调试信息，保持日志清洁
    }

    /**
     * 注册单个模块到空间注册表（支持热更新）
     */
    static registerModule(station: any, mod: any) {
        const modData = (GameConfig as any).MODULES[mod.moduleId];
        if (!modData) return;

        // 【架构重构：大一统法则】
        // 注册表使用纯净的模块绝对几何中心作为基准点，绝不掺杂出舱口偏移
        import('../BuildingManager.js').then(({ BuildingManager }) => {
            const center = BuildingManager.getModuleAbsoluteCenter(mod, station);
            const centerX = center.x;
            const centerY = center.y;
            const rotation = center.rotation;
            
            // 为了计算泊位偏移，我们需要一个缩放比，这个逻辑依然需要
            const w = mod.width * GRID_PIXEL_SIZE;
            const h = mod.height * GRID_PIXEL_SIZE;
            let scale = 1;
            
            let visualCenterX = centerX;
            let visualCenterY = centerY;

            if (modData.connectRule) {
                const isRotated = mod.rotation % 180 !== 0; // 注意这里用的是原始 rotation 来算缩放
                const spriteOrigW = modData.spriteSize ? modData.spriteSize.width : w;
                const spriteOrigH = modData.spriteSize ? modData.spriteSize.height : h;
                const visualOrigW = isRotated ? spriteOrigH : spriteOrigW;
                const visualOrigH = isRotated ? spriteOrigW : spriteOrigH;
                scale = Math.min(w / visualOrigW, h / visualOrigH);
                
                // 将 RadarScene.ts 中的视觉拉扯补偿同步到物理层，以免产生泊位漂移
                const actualW = visualOrigW * scale;
                const actualH = visualOrigH * scale;
                const worldPosX = centerX - w / 2;
                const worldPosY = centerY - h / 2;

                let effectiveRule = { ...modData.connectRule };
                if (mod.rotation === 90) {
                    effectiveRule = { up: modData.connectRule.left, right: modData.connectRule.up, down: modData.connectRule.right, left: modData.connectRule.down };
                } else if (mod.rotation === 180) {
                    effectiveRule = { up: modData.connectRule.down, right: modData.connectRule.left, down: modData.connectRule.up, left: modData.connectRule.right };
                } else if (mod.rotation === 270) {
                    effectiveRule = { up: modData.connectRule.right, right: modData.connectRule.down, down: modData.connectRule.left, left: modData.connectRule.up };
                }

                if (effectiveRule.left === "port") {
                    visualCenterX = worldPosX + actualW / 2;
                } else if (effectiveRule.right === "port") {
                    visualCenterX = worldPosX + w - actualW / 2;
                }
                
                if (effectiveRule.up === "port") {
                    visualCenterY = worldPosY + actualH / 2;
                } else if (effectiveRule.down === "port") {
                    visualCenterY = worldPosY + h - actualH / 2;
                }
            }

            // 计算所有泊位的绝对坐标
            const berths: Record<string, { worldX: number, worldY: number, entryAngle: number }> = {};
            if (modData.berths) {
                // 注意：由于 calculateSpawnTransform/getModuleAbsoluteCenter 返回的 rotation 已经是最终朝向
                // 泊位偏移计算直接应用此朝向
                const rad = rotation * Math.PI / 180;
                modData.berths.forEach((b: any) => {
                    const ox = b.offset.x * scale;
                    const oy = b.offset.y * scale;

                    // 将相对偏移根据模块朝向进行旋转
                    const rotatedOffsetX = ox * Math.cos(rad) - oy * Math.sin(rad);
                    const rotatedOffsetY = ox * Math.sin(rad) + oy * Math.cos(rad);

                    berths[b.id] = {
                        worldX: visualCenterX + rotatedOffsetX,
                        worldY: visualCenterY + rotatedOffsetY,
                        entryAngle: (b.entryAngle + rotation) % 360
                    };
                });
            }

            UniverseEngine.spatialRegistry.set(mod.uid, {
                sector: station.sector,
                worldX: centerX,
                worldY: centerY,
                rotation: rotation,
                berths: berths
            });
        });

    }

    /**
     * 获取空间注册表中的模块绝对物理基准信息
     * 供 RadarScene 渲染层读取，实现“计算与渲染完全分离”的大一统架构
     */
    static getRegistryEntry(moduleUid: string): SpatialRegistryEntry | undefined {
        return this.spatialRegistry.get(moduleUid);
    }

    /**
     * 获取指定模块的泊位绝对坐标转换数据
     * @returns { sector, worldX, worldY, entryAngle } 或者 null
     */
    static getDockingTransform(moduleUid: string, berthId: string) {
        const entry = this.spatialRegistry.get(moduleUid);
        if (!entry) return null;
        
        const berth = entry.berths[berthId];
        if (!berth) return null;

        return {
            sector: entry.sector,
            worldX: berth.worldX,
            worldY: berth.worldY,
            entryAngle: berth.entryAngle
        };
    }

    // ------------------------------------------------------------------------
    // [主循环]
    // ------------------------------------------------------------------------
    /**
     * 宇宙演化主循环，由外部（如 Base.ts 或独立的 Worker）按固定频率调用
     * @param dt 逝去的时间 (秒)
     * @param viewingSector 当前玩家正在通过雷达/星图监视的星区
     */
    static tick(dt: number, viewingSector: string | null) {
        // 1. 世界基础状态演化 (如时间推移、大事件)
        const worldHasChanged = WorldbookManager.tickWorld();
        const ws = WorldbookManager.getWorldState();
        
        // 2. 获取当前所有需要被演算的活跃星区
        const activeSectors = this.getActiveSectors(viewingSector);

        // 3. 飞船模拟层 (IS & OOS)
        // 目前 ShipManager.update 内部包含了决策、移动、战斗和采矿，未来将进一步拆分到 System 中
        ShipManager.update(dt, ws);

        // 4. 经济、建筑队列与空间站生产模拟
        this.processEconomyAndBuilding(ws, activeSectors);
        
        // 5. 港务局：处理停泊队列
        activeSectors.forEach(sectorName => {
            processMacroDockingQueue(sectorName);
        });

        return worldHasChanged;
    }

    /**
     * 获取全宇宙所有需要进行模拟的活跃星区
     */
    private static getActiveSectors(viewingSector: string | null): string[] {
        let currentSectorName = localStorage.getItem('current_sector') || '';

        const allShipSectors = new Set<string>();
        ShipManager.ships.forEach(s => {
            if (s.location && s.location.sector) allShipSectors.add(s.location.sector);
        });
        
        const activeSectors = Array.from(allShipSectors);
        if (currentSectorName && !activeSectors.includes(currentSectorName)) activeSectors.push(currentSectorName);
        if (viewingSector && !activeSectors.includes(viewingSector)) activeSectors.push(viewingSector);
        
        return activeSectors;
    }

    /**
     * 宏观建筑队列推演
     */
    private static processEconomyAndBuilding(ws: any, activeSectors: string[]) {
        let globalNeedsSave = false;
        if (ws && ws.stations) {
            activeSectors.forEach(sectorName => {
                const needsSave = processMacroBuildingQueue(ws, sectorName);
                if (needsSave) globalNeedsSave = true;
            });
            
            // 只要有一个空间站的队伍出列了，就需要保存整个世界的队伍状态
            if (globalNeedsSave) {
                WorldbookManager.saveWorldState(ws);
            }
        }
    }
}
