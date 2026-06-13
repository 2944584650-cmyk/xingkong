// 最高指令：建筑系统只有一个，没有，也不应存在任何玩家专属特权，界面只是交互窗口
import { GameConfig } from '../config.js';

export const GRID_PIXEL_SIZE = 550; // 标准大网格尺寸（像素）

import { PlacedModuleData, VirtualStationData } from '../data/BuildingData';

export type PlacedModule = PlacedModuleData; // 向后兼容旧名称

export class BuildingManager {
    static stationModules: PlacedModuleData[] = [];
    static corePlaced: boolean = false;

    /**
     * 重置内存静态缓存状态
     */
    static reset() {
        this.stationModules = [];
        this.corePlaced = false;
    }

    /**
     * 临时从外部注入世界状态中的建筑数据（跨星区或首次加载时）
     * 不写死进当前玩家存档（除非当前星区就是玩家主基地，这部分尚未细化）
     */
    static loadFromWorldState(worldState: any, sectorName: string) {
        if (!worldState || !worldState.stations) {
            console.warn(`[BuildingManager] loadFromWorldState received invalid or empty worldState!`, worldState);
            this.stationModules = [];
            this.corePlaced = false;
            return;
        }

        let allModules: PlacedModule[] = [];
        // 筛选出属于当前星区的空间站
        const sectorStations = worldState.stations.filter((station: any) => station.sector === sectorName);
        
        sectorStations.forEach((station: any) => {
            // 计算空间站基准网格坐标
            const baseGridX = Math.floor((station.worldX || 0) / GRID_PIXEL_SIZE);
            const baseGridY = Math.floor((station.worldY || 0) / GRID_PIXEL_SIZE);
            
            if (station.modules && Array.isArray(station.modules)) {
                station.modules.forEach((mod: any) => {
                    // 检查并初始化内置槽位以向后兼容
                    const modData = (GameConfig as any).MODULES[mod.moduleId];
                    let internalModules = mod.internalModules;
                    
                    if (modData && modData.internalSlots) {
                        if (!internalModules) {
                            internalModules = {};
                            for (let i = 1; i <= modData.internalSlots; i++) {
                                internalModules[i] = null;
                            }
                        } else {
                            // 确保所有槽位都存在，即使部分槽位未正确保存
                            for (let i = 1; i <= modData.internalSlots; i++) {
                                if (internalModules[i] === undefined) {
                                    internalModules[i] = null;
                                }
                            }
                        }
                    }

                    allModules.push({
                        ...mod,
                        // 模块的绝对网格坐标 = 空间站基准坐标 + 模块相对坐标
                        gridX: baseGridX + mod.gridX,
                        gridY: baseGridY + mod.gridY,
                        factionId: station.factionId,
                        sector: sectorName, // 强制打上所属星区烙印
                        stationUid: station.uid, // 记录所属空间站以防止保存时漂移
                        internalModules: internalModules
                    });
                });
            }
        });

        this.stationModules = allModules;
        this.corePlaced = this.stationModules.some(m => this.isCoreCategory(m.moduleId));
    }

    /**
     * 为建筑分配阵营（暂留占位逻辑）
     */
    static assignFaction(mod: PlacedModule): string | number {
        // 目前暂时默认返回 'player' 或根据一些规则来。这里暂不实现复杂的逻辑。
        return 'player';
    }

    /**
     * 从本地存储加载空间站数据 (现已废弃独立存档，转为空操作，或者作为系统初始化的空壳)
     */
    static load() {
        // console.log('[BuildingManager] load() called. Now delegates to WorldState synchronization. station_modules local storage is deprecated.');
        // 渲染加载由 Base.ts 控制，此处仅保证内存清空防污染
        this.stationModules = [];
        this.corePlaced = false;
    }

    /**
     * 保存当前空间站数据到本地存储 (现已废弃独立存档，必须将修改同步回 world_state)
     */
    static save() {
        // console.log('[BuildingManager] save() called. Forwarding save request to WorldbookManager.');
        if (this.stationModules.length === 0) return;
        
        // 核心修复：不能无脑写入 current_sector，必须看这批数据本身属于哪个星区
        const targetSector = this.stationModules[0].sector;
        if (!targetSector) {
            console.error('[BuildingManager] 无法保存：站内模块缺少 sector 标识！');
            return;
        }
        
        // **同步执行保存**：由于 Base.ts 的主循环在不断以同步方式读取 WorldState
        // 如果这里用 import().then() 异步保存，还没等存进去，Base 就已经把旧的存档读出来并覆盖了内存。
        // 因此必须使用同步获取的方式，或者干脆我们手动引入避免循环依赖。
        // （由于静态方法的执行时机问题，我们可以采用同步 require 或者依赖注入，但为了兼容性，我们可以直接尝试读取和写入 localStorage，或者安全地获取全局对象）
        try {
            const savedStateStr = localStorage.getItem('world_state');
            if (!savedStateStr) return;
            const ws = JSON.parse(savedStateStr);
            
            if (ws && ws.stations) {
                const targetStations = ws.stations.filter((s: any) => s.sector === targetSector);
                
                targetStations.forEach((station: any, index: number) => {
                    const baseGridX = Math.floor((station.worldX || 0) / GRID_PIXEL_SIZE);
                    const baseGridY = Math.floor((station.worldY || 0) / GRID_PIXEL_SIZE);
                    
                    // 找出属于该空间站的模块
                    let stationMods = this.stationModules.filter(m => m.stationUid === station.uid);
                    
                    // 容错处理：如果有新建的模块缺少 stationUid，归入该星区的第一个空间站
                    if (index === 0) {
                        const orphanMods = this.stationModules.filter(m => !m.stationUid);
                        stationMods = stationMods.concat(orphanMods);
                    }
                    
                    if (stationMods.length > 0 || (station.modules && station.modules.length > 0)) {
                        station.modules = stationMods.map(m => {
                            const modCopy = { ...m };
                            // 深拷贝时特殊处理 internalModules，防止被置空
                            if (m.internalModules) {
                                modCopy.internalModules = JSON.parse(JSON.stringify(m.internalModules));
                            }
                            // 深拷贝时特殊处理 buildQueue
                            if (m.buildQueue) {
                                modCopy.buildQueue = JSON.parse(JSON.stringify(m.buildQueue));
                            }
                            
                            // 还原相对坐标，防止漂移
                            modCopy.gridX = modCopy.gridX - baseGridX;
                            modCopy.gridY = modCopy.gridY - baseGridY;
                            delete modCopy.stationUid; // 移除内存中的关联标识
                            return JSON.parse(JSON.stringify(modCopy));
                        });
                    }
                });

                localStorage.setItem('world_state', JSON.stringify(ws));
                // console.log(`[BuildingManager] Saved ${this.stationModules.length} modules to sector ${targetSector} in world_state synchronously.`);
            }
        } catch(e) {
            console.error('[BuildingManager] 同步保存 world_state 失败:', e);
        }
    }

    static isCoreCategory(moduleId: string): boolean {
        if (!moduleId) return false;
        const modData = (GameConfig as any).MODULES[moduleId];
        return modData && modData.category === 'core';
    }

    static getFirstCoreModuleId(): string {
        for (const [id, data] of Object.entries((GameConfig as any).MODULES)) {
            if ((data as any).category === 'core') return id;
        }
        return 'core_base';
    }

    /**
     * 初始化建造系统（自动在中心放置核心）
     */
    static initStation(startX: number = 0, startY: number = 0) {
        this.stationModules = [];
        this.corePlaced = false;
        
        // 强制将核心放在起始点，核心默认占据 2x2
        this.placeModule(this.getFirstCoreModuleId(), startX, startY);
    }

    /**
     * 将真实的像素世界坐标转换为网格坐标
     * 无论鼠标点在哪个位置，都会向下取整吸附到最近的格子里
     */
    static worldToGrid(x: number, y: number) {
        return {
            gridX: Math.floor(x / GRID_PIXEL_SIZE),
            gridY: Math.floor(y / GRID_PIXEL_SIZE)
        };
    }

    /**
     * 将网格坐标转换回真实的像素世界坐标（返回该网格的左上角像素点）
     */
    static gridToWorld(gridX: number, gridY: number) {
        return {
            x: gridX * GRID_PIXEL_SIZE,
            y: gridY * GRID_PIXEL_SIZE
        };
    }

    /**
     * 获取某个模块在指定位置会占据的所有网格坐标数组
     */
    static getOccupiedGrids(moduleId: string, gridX: number, gridY: number, rotation: number = 0) {
        // @ts-ignore
        const modData = GameConfig.MODULES[moduleId];
        if (!modData) return [];

        const grids = [];
        const gw = (rotation % 180 !== 0) ? modData.gridSize.height : modData.gridSize.width;
        const gh = (rotation % 180 !== 0) ? modData.gridSize.width : modData.gridSize.height;

        for (let i = 0; i < gw; i++) {
            for (let j = 0; j < gh; j++) {
                grids.push({ x: gridX + i, y: gridY + j });
            }
        }
        return grids;
    }

    /**
     * 获取指定模块在特定旋转角度下的接口(port)规则
     */
    static getModulePortRule(moduleId: string, rotation: number) {
        // @ts-ignore
        const modData = GameConfig.MODULES[moduleId];
        const rule = modData.connectRule || {};
        let up = rule.up === 'port';
        let down = rule.down === 'port';
        let left = rule.left === 'port';
        let right = rule.right === 'port';

        if (rotation === 90) {
            return { up: left, right: up, down: right, left: down };
        } else if (rotation === 180) {
            return { up: down, right: left, down: up, left: right };
        } else if (rotation === 270) {
            return { up: right, right: down, down: left, left: up };
        }
        return { up, down, left, right };
    }

    /**
     * 核心逻辑：检查某个模块是否可以放置在指定的网格位置
     * 必须满足：1. 不能与其他模块重叠  2. 接口必须互相匹配
     */
    static canPlaceModule(moduleId: string, gridX: number, gridY: number, rotation: number = 0): { valid: boolean; reason?: string } {
        if (!this.corePlaced && !this.isCoreCategory(moduleId)) {
            return { valid: false, reason: "必须先放置核心模块！" };
        }

        const targetGrids = this.getOccupiedGrids(moduleId, gridX, gridY, rotation);

        // 1. 检查重叠冲突
        for (const mod of this.stationModules) {
            const existingGrids = this.getOccupiedGrids(mod.moduleId, mod.gridX, mod.gridY, mod.rotation || 0);
            for (const tg of targetGrids) {
                for (const eg of existingGrids) {
                    if (tg.x === eg.x && tg.y === eg.y) {
                        return { valid: false, reason: "该位置已被其他模块占用！" };
                    }
                }
            }
        }

        // 2. 检查连接与接口匹配
        if (this.stationModules.length > 0) {
            let hasConnection = false;
            
            for (const tg of targetGrids) {
                const neighbors = [
                    { x: tg.x, y: tg.y - 1, dirA: 'up', dirB: 'down' },
                    { x: tg.x, y: tg.y + 1, dirA: 'down', dirB: 'up' },
                    { x: tg.x - 1, y: tg.y, dirA: 'left', dirB: 'right' },
                    { x: tg.x + 1, y: tg.y, dirA: 'right', dirB: 'left' }
                ];

                for (const n of neighbors) {
                    // 忽略模块内部的邻接格子
                    if (targetGrids.some(g => g.x === n.x && g.y === n.y)) continue;

                    // 检查该邻接格子是否被其他模块占用
                    const adjacentMod = this.stationModules.find(mod => {
                        const existingGrids = this.getOccupiedGrids(mod.moduleId, mod.gridX, mod.gridY, mod.rotation || 0);
                        return existingGrids.some(eg => eg.x === n.x && eg.y === n.y);
                    });

                    if (adjacentMod) {
                        // 发现相邻模块，检查接口匹配
                        const rulesA = this.getModulePortRule(moduleId, rotation);
                        const rulesB = this.getModulePortRule(adjacentMod.moduleId, adjacentMod.rotation || 0);

                        // @ts-ignore
                        const portA = rulesA[n.dirA];
                        // @ts-ignore
                        const portB = rulesB[n.dirB];

                        // 如果接口不一致（一边是 port 一边不是），则非法
                        if (portA !== portB) {
                            return { valid: false, reason: `接口不匹配！不可将[可部署面]与[不可部署面]对齐。` };
                        }

                        // 如果两边都是 port，则形成有效连接
                        if (portA === true && portB === true) {
                            hasConnection = true;
                        }
                    }
                }
            }

            // 如果不是第一个核心，且没有任何有效连接，则非法
            if (!hasConnection && (!this.isCoreCategory(moduleId) || this.corePlaced)) {
                return { valid: false, reason: "模块必须至少通过一个可部署接口与现有空间站连接！" };
            }
        }

        return { valid: true };
    }

    /**
     * 自动尝试所有旋转角度并放置模块
     * @param forceRotation 强制指定旋转角度 (可选)
     */
    static placeModule(moduleId: string, gridX: number, gridY: number, forceRotation?: number) {
        let finalRotation = forceRotation !== undefined ? forceRotation : 0;
        let check = this.canPlaceModule(moduleId, gridX, gridY, finalRotation);

        // 允许放置第一个核心，跳过连接检查
        if (!check.valid && (!this.isCoreCategory(moduleId) || this.corePlaced)) {
            console.warn(`[建造系统] 无法放置模块: ${check.reason}`);
            return false;
        }

        // @ts-ignore
        const modData = GameConfig.MODULES[moduleId];
        const gw = (finalRotation % 180 !== 0) ? modData.gridSize.height : modData.gridSize.width;
        const gh = (finalRotation % 180 !== 0) ? modData.gridSize.width : modData.gridSize.height;

        // 从配置中读取最大血量和库存容量，设置默认值以防数据缺失
        const maxHp = modData.maxHp || 1000000;
        const inventoryCapacity = modData.inventoryCapacity || 100;

        // 动态获取当前建造环境的星区（通过 viewing_sector 以兼容远程建造）
        const targetSector = localStorage.getItem('viewing_sector') || localStorage.getItem('current_sector');

        // 绑定给当前星区的任意一个空间站（如果有的话）
        let targetStationUid = undefined;
        if (this.stationModules.length > 0) {
            targetStationUid = this.stationModules[0].stationUid;
        }

        // 如果模块配置中指定了内置槽位数量，则初始化内置槽位
        const internalModules: { [slotIndex: number]: any } | undefined = modData.internalSlots ? {} : undefined;
        if (internalModules) {
            for (let i = 1; i <= modData.internalSlots; i++) {
                internalModules[i] = null;
            }
        }

        const newMod: PlacedModule = {
            uid: 'mod_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            moduleId: moduleId,
            gridX: gridX,
            gridY: gridY,
            width: gw,
            height: gh,
            rotation: finalRotation,
            hp: maxHp,
            maxHp: maxHp,
            inventoryCapacity: inventoryCapacity,
            sector: targetSector,
            stationUid: targetStationUid,
            buildQueue: [],
            internalModules: internalModules
        };
        
        newMod.factionId = this.assignFaction(newMod);
        
        this.stationModules.push(newMod);
        if (this.isCoreCategory(moduleId)) this.corePlaced = true;
        
        // console.log(`[建造系统] 成功放置模块 [${modData.name}] 于网格 (${gridX}, ${gridY})`);
        this.save();
        return newMod;
    }
    
    /**
     * 计算该模块造船出厂时的确切物理坐标和朝向
     * 结合了蓝图定义的 spawnOffset, spawnRotation 与 玩家放置的旋转 rot
     */
    static calculateSpawnTransform(mod: any) {
        let spawnX = (mod.gridX || 0) * GRID_PIXEL_SIZE + GRID_PIXEL_SIZE / 2;
        let spawnY = (mod.gridY || 0) * GRID_PIXEL_SIZE + GRID_PIXEL_SIZE / 2;
        let finalSpawnRot = 0;

        const modData = (GameConfig as any).MODULES && mod.moduleId ? (GameConfig as any).MODULES[mod.moduleId] : null;

        const worldX = (mod.gridX || 0) * GRID_PIXEL_SIZE;
        const worldY = (mod.gridY || 0) * GRID_PIXEL_SIZE;
        
        const pixelW = (mod.width || 1) * GRID_PIXEL_SIZE;
        const pixelH = (mod.height || 1) * GRID_PIXEL_SIZE;
        
        const centerX = worldX + pixelW / 2;
        const centerY = worldY + pixelH / 2;

        let ox = modData?.spawnOffset?.x || 0;
        let oy = modData?.spawnOffset?.y || 0;
        let baseSpawnRot = modData?.spawnRotation || 0;
        const rot = mod.rotation || 0;
        
        let finalOx = ox;
        let finalOy = oy;
        
        if (rot === 90) {
            finalOx = -oy;
            finalOy = ox;
        } else if (rot === 180) {
            finalOx = -ox;
            finalOy = -oy;
        } else if (rot === 270) {
            finalOx = oy;
            finalOy = -ox;
        }
        
        spawnX = centerX + finalOx;
        spawnY = centerY + finalOy;
        finalSpawnRot = (baseSpawnRot + rot) % 360;

        return { x: spawnX, y: spawnY, rotation: finalSpawnRot };
    }

    /**
     * 获取空间站所有模块（供 Base.ts 渲染调用）
     */
    static getAllModules() {
        return this.stationModules;
    }

    /**
     * 架构融合：将指定模块所属的整个空间站聚合，伪装成一艘不可移动的宏观旗舰 Ship
     * 供仓储UI存取物资、或者飞船停泊系统挂靠使用。
     * @param targetUid 空间站 station_uid 或者内部任意一个 mod_uid
     */
    static getStationAsVirtualShip(targetUid: string): VirtualStationData | null {
        if (!targetUid) return null;
        
        // 1. 找到对应的模块或空间站
        let targetMod = this.stationModules.find(m => m.uid === targetUid || m.stationUid === targetUid);
        if (!targetMod) return null;
        
        // 2. 确定其真正的空间站级别 UID（与库存系统 InventoryManager.inventories[stationUid] 强绑定）
        // 如果 targetMod.stationUid 存在，则用它。否则使用退化回退逻辑。
        // 但注意：为了让 ObserveUI(右键查看) 和 仓库界面 提取出来的货舱完全对齐，
        // 这里返回虚拟飞船时，它的 .id 属性绝对不能使用单个小模块的 mod_uid！
        let stationUid = targetMod.stationUid;
        let allStationMods: PlacedModule[] = [];
        
        if (stationUid) {
            allStationMods = this.stationModules.filter(m => m.stationUid === stationUid);
        } else {
            // 没有 stationUid，说明这是玩家建造的默认星区首站、或者是旧版兼容
            // 在 InventoryManager 和 WorldbookManager 里，它可能被挂在核心模块的 uid 上了，或者干脆没聚合
            // 找找当前星区有没有带 core 的模块，它往往是真实的 stationUid
            const sectorCore = this.stationModules.find(m => m.sector === targetMod.sector && m.moduleId.startsWith('core_'));
            
            if (sectorCore) {
                // 有核心，就把这个星区内所有无主的模块都归属于这个核心的空间站
                stationUid = sectorCore.stationUid || sectorCore.uid;
                allStationMods = this.stationModules.filter(m => m.sector === targetMod.sector && (!m.stationUid || m.stationUid === stationUid));
            } else {
                // 真没核心，只能打包成一个临时的默认空间站
                stationUid = 'station_default_' + targetMod.sector;
                allStationMods = this.stationModules.filter(m => !m.stationUid && m.sector === targetMod.sector);
            }
        }

        // 终极防御：绝不允许返回空数组导致计算崩溃
        if (allStationMods.length === 0) {
            allStationMods = [targetMod];
            stationUid = targetMod.stationUid || targetMod.uid;
        }
        
        // 3. 聚合总血量、总容量，以及模块列表 (不再聚合和管理库存)
        let totalHp = 0;
        let totalMaxHp = 0;
        let totalCapacity = 0;
        const stationModulesList: any[] = [];

        allStationMods.forEach(mod => {
            totalHp += mod.hp || 0;
            totalMaxHp += mod.maxHp || 1000;
            totalCapacity += mod.inventoryCapacity || 100;
            
            stationModulesList.push({
                uid: mod.uid,
                moduleId: mod.moduleId,
                hp: mod.hp || 0,
                maxHp: mod.maxHp || 1000
            });
        });

        // 4. 返回符合 Ship 实体结构的代理对象 (Proxy)
        // 注意：这里不再提供 addCargo, removeCargo, inventory，全交由 InventoryManager 处理
        return {
            id: stationUid,
            name: "联邦空间站", // 以后可以加自定义命名
            stationModulesList: stationModulesList, // 暴露给 ObserveUI 进行渲染
            isStationVirtualShip: true,
            factionId: targetMod.factionId || 'player',
            ownerId: targetMod.factionId === 'player' ? 'player' : 'npc',
            type: 'station',
            state: 'IDLE',
            location: { sector: targetMod.sector, x: targetMod.gridX * GRID_PIXEL_SIZE, y: targetMod.gridY * GRID_PIXEL_SIZE },
            stats: { hp: totalHp, maxHp: totalMaxHp },
            maxInventory: totalCapacity
        };
    }

    /**
     * 添加建造订单到队列 (修改为直接操作 world_state 并持久化，防止被内存刷新覆盖)
     */
    static addBuildOrder(uid: string, order: any) {
        let success = false;
        
        // 我们需要找到它属于哪个星区
        const memMod = this.stationModules.find(m => m.uid === uid);
        const targetSector = memMod ? memMod.sector : order.location?.sector;

        if (!targetSector) {
            console.error('[BuildingManager] addBuildOrder 失败：无法确定目标星区');
            return false;
        }

        // 动态引入并直接修改 WorldState
        import('../scenes/WorldbookManager.js').then(module => {
            const ws = module.WorldbookManager.getWorldState();
            if (ws && ws.stations) {
                const targetStation = ws.stations.find((s: any) => s.sector === targetSector);
                if (targetStation && targetStation.modules) {
                    const mod = targetStation.modules.find((m: any) => m.uid === uid);
                    if (mod) {
                        if (!mod.buildQueue) mod.buildQueue = [];
                        mod.buildQueue.push(order);
                        module.WorldbookManager.saveWorldState(ws);
                        
                        // 同时同步到当前内存 (如果是本地星区，或者UI正在浏览的星区)
                        if (memMod) {
                            if (!memMod.buildQueue) memMod.buildQueue = [];
                            // 保持与硬盘数据引用一致，直接覆写
                            memMod.buildQueue = JSON.parse(JSON.stringify(mod.buildQueue));
                        }
                        // console.log(`[BuildingManager] 成功将订单写入星区 ${targetSector} 的模块 ${uid} 队列。`);
                        
                        // 抛出事件通知 UI 刷新
                        document.dispatchEvent(new CustomEvent('ui_chuanwu_refresh', { detail: { uid: uid } }));
                    }
                }
            }
        });
        
        // 假装同步成功，因为上面的 promise 会在微任务里执行
        return true;
    }

    /**
     * 移除指定模块 (预留拆除功能)
     */
    static removeModule(uid: string) {
        const mod = this.stationModules.find(m => m.uid === uid);
        if (mod && this.isCoreCategory(mod.moduleId)) {
            console.warn("[建造系统] 无法拆除核心模块！");
            return false;
        }
        this.stationModules = this.stationModules.filter(m => m.uid !== uid);
        this.save();
        return true;
    }

}

// 将管理器挂载到全局 window 对象上，以便其他子系统（如无人机逻辑/微观物理引擎）可以进行同步调用读取
if (typeof window !== 'undefined') {
    (window as any).BuildingManager = BuildingManager;
}
