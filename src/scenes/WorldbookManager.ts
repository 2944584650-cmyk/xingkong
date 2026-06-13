import { ShipManager } from '../managers/ShipManager.js';
import { OOSSimulator } from '../managers/OOSSimulator.js';
import starmapData from '../../json/StarmapData.json';
import moduleData from '../../json/ModuleData.json';
import { processMacroOrders } from './worldbook/Worldbook-Orders.js';
import { getGlobalInternalModulesPool } from './worldbook/Worldbook-InternalModules.js';
import { InternalModuleProcessor } from '../managers/building/InternalModuleProcessor.js';
import { AffinityManager } from '../managers/AffinityManager.js';
import { NPCManager } from '../managers/NPCManager.js';

export class WorldbookManager {
    static sectors = [];
    static lanes = [];

    static reset() {
        this.sectors = [];
        this.lanes = [];
    }

    // --- 获取星区当前阵营 ---
    // [重构预留] 以后阵营逻辑变复杂了，在这里统一修改判定
    static getSectorFaction(sectorName) {
        // 目前暂时读取 JSON 中配置的初始 factionId
        const sectorDef = starmapData.sectors.find((s: any) => s.name === sectorName);
        return sectorDef ? sectorDef.factionId : 0;
    }

    /**
     * 在任意星区动态生成一个模板化空间站
     * @param sectorName 星区名称，例如 '太阳系'
     * @param worldX 物理宇宙坐标 X
     * @param worldY 物理宇宙坐标 Y
     * @param factionId 阵营 ID
     * @param templateType 模板类型，目前支持 'shipyard', 'general', 'factory' 等
     */
    static spawnStation(sectorName: string, worldX: number, worldY: number, factionId: number, templateType: string = 'general') {
        const worldState = this.getWorldState();
        if (!worldState.stations) worldState.stations = [];

        const realModuleData = (moduleData as any).MODULES || (moduleData as any).default?.MODULES || {};
        const stationTemplates = (moduleData as any).STATION_TEMPLATES || (moduleData as any).default?.STATION_TEMPLATES || {};

        const generateModule = (moduleId: string, gridX: number, gridY: number, rotation: number, facId: number, internalModulesConfig?: any) => {
            const def = realModuleData[moduleId];
            if (!def) {
                console.error(`[WorldbookManager] 未找到模块数据: ${moduleId}`);
                return null;
            }
            const gw = def.gridSize?.width || 1;
            const gh = def.gridSize?.height || 1;
            
            const modObj: any = {
                uid: 'mod_' + Date.now() + '_' + Math.floor(Math.random() * 1000000),
                moduleId,
                gridX,
                gridY,
                width: (rotation % 180 !== 0) ? gh : gw,
                height: (rotation % 180 !== 0) ? gw : gh,
                rotation,
                hp: def.maxHp || 100000,
                maxHp: def.maxHp || 100000,
                inventoryCapacity: def.inventoryCapacity || 100,
                factionId: facId
            };
            
            // 如果蓝图中定义了 internalSlots，则在生成时直接初始化空的 internalModules 字典
            if (def.internalSlots) {
                modObj.internalModules = {};
                // 如果模板中预配置了内构，直接装配
                if (internalModulesConfig) {
                    for (const [slot, intModId] of Object.entries(internalModulesConfig)) {
                        modObj.internalModules[slot] = {
                            moduleId: intModId,
                            isWorking: true
                        };
                    }
                    // console.log(`[生成模块] ${moduleId} 装配内构成功:`, internalModulesConfig, "生成结果:", modObj.internalModules);
                } else {
                    // console.log(`[生成模块] ${moduleId} 蓝图支持内构，但当前模板未配置内构 (internalModulesConfig为空)`);
                }
            }
            
            return modObj;
        };

        const stationId = 'station_' + templateType + '_' + factionId + '_' + Date.now() + '_' + Math.floor(Math.random()*1000);
        const template = stationTemplates[templateType] || stationTemplates['general'];
        const modules = template.modules.map((m: any) => 
            generateModule(m.moduleId, m.gridX, m.gridY, m.rotation, factionId, m.internalModules)
        ).filter((m: any) => m !== null);

        // [NPC注入] 自动为新生成的空间站分配一个 NPC 拥有者
        let ownerId: string | number = factionId;
        if (factionId && factionId !== 0) {
            ownerId = NPCManager.getInstance().assignOrGetNPCForEntity(factionId);
        }

        const newStation = {
            uid: stationId,
            factionId: factionId,
            ownerId: ownerId,
            worldX: worldX,
            worldY: worldY,
            type: templateType,
            sector: sectorName,
            modules: modules
        };

        if (typeof ownerId === 'string' && ownerId !== 'player') {
            NPCManager.getInstance().addOwnedShip(ownerId, stationId); // 复用 addOwnedShip 也能记录资产 (或者是 addOwnedBuilding)
        }

        worldState.stations.push(newStation);
        this.saveWorldState(worldState);

        // console.log(`[WorldbookManager] 成功在 ${sectorName} 生成了类型为 ${templateType} 的空间站`);
        return newStation;
    }

    // --- Static method to manage world state ---
    static getWorldState() {
        const savedState = localStorage.getItem('world_state');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                if (parsed.sectors) {
                    if (!parsed.relations) parsed.relations = {};
                    if (!parsed.orders) parsed.orders = [];
                    
                    let modified = false;

                    // 兼容旧存档：补全开局未生成的 stations 数据
                    if (!parsed.stations) {
                        parsed.stations = [];
                        modified = true;
                        // console.log("[WorldbookManager] 为旧存档补全了初始空间站数据字段");
                    }
                    
                    if (!parsed.asteroidBelts) {
                        parsed.asteroidBelts = [];
                        modified = true;
                        // console.log("[WorldbookManager] 为旧存档补全了初始矿带数据字段");
                    }

                    // 强制清理旧版存档中冗余的经济属性（减小存档体积并防止干扰新系统）
                    parsed.sectors.forEach(s => {
                        if (s.produces !== undefined) { delete s.produces; modified = true; }
                        if (s.consumes !== undefined) { delete s.consumes; modified = true; }
                        if (s.inventory !== undefined) { delete s.inventory; modified = true; }
                    });

                    // 清理空间站模块上遗留的冗余 inventory 数据
                    if (parsed.stations) {
                        parsed.stations.forEach(station => {
                            if (station.modules) {
                                station.modules.forEach(mod => {
                                    if (mod.inventory !== undefined) {
                                        delete mod.inventory;
                                        modified = true;
                                    }
                                });
                            }
                        });
                    }
                    
                    if (modified) {
                        localStorage.setItem('world_state', JSON.stringify(parsed));
                    }
                    
                    return parsed;
                }
            } catch (e) {
                console.error("Failed to parse world state, will regenerate.", e);
            }
        }

        const factions = [
            { id: 1, name: '银河帝国', color: 'rgba(255, 0, 0, 0.4)', stroke: '#ff0000', nodeColor: '#ff5555', cx: 180, cy: 120, r: 160, influence: 100 },
            { id: 2, name: '自由商业联盟', color: 'rgba(0, 100, 255, 0.4)', stroke: '#0088ff', nodeColor: '#55aaff', cx: 550, cy: 120, r: 180, influence: 100 },
            { id: 3, name: '边缘清道夫', color: 'rgba(0, 255, 0, 0.3)', stroke: '#00ff00', nodeColor: '#55ff55', cx: 200, cy: 300, r: 150, influence: 100 },
            { id: 4, name: '虚空教团', color: 'rgba(150, 0, 255, 0.3)', stroke: '#aa00ff', nodeColor: '#cc55ff', cx: 580, cy: 300, r: 160, influence: 100 }
        ];
        
        let sectors = JSON.parse(JSON.stringify(starmapData.sectors));

        // 仅保留星区的 type 分类标记（用于 UI 或任务），彻底删除老派的 produces / consumes
        sectors.forEach((sector: any) => {
            if (['璀璨星源内核', '琉璃极光星系'].includes(sector.name)) {
                sector.type = 'capital';
            } else if (sector.factionId === 0) {
                sector.type = 'buffer'; // 中立缓冲区
            } else {
                sector.type = 'normal'; // 移除旧的 production 等类型，统一标记为 normal
            }
            // 不再初始化 sector.inventory，因为以后资源存在具体空间站模块中
        });

        const defaultState: any = { factions, sectors, relations: {}, orders: [], ships: [], stations: [], asteroidBelts: [] };

        // --- 开局全随机分配空间站逻辑 ---
        // console.log("[DEBUG] 开始生成 NPC 空间站, moduleData:", moduleData);
        
        // 兼容不同的 JSON 导入格式
        const realModuleData = (moduleData as any).MODULES || (moduleData as any).default?.MODULES || {};
        const stationTemplates = (moduleData as any).STATION_TEMPLATES || (moduleData as any).default?.STATION_TEMPLATES || {};

        const generateModule = (moduleId: string, gridX: number, gridY: number, rotation: number, facId: number, internalModulesConfig?: any) => {
            let def = realModuleData[moduleId];
            if (!def) {
                console.error(`[WorldbookManager] 未找到模块数据: ${moduleId}，将使用后备默认值！`);
                def = { gridSize: { width: 1, height: 1 }, maxHp: 100000, inventoryCapacity: 100 };
            }
            const gw = def.gridSize?.width || 1;
            const gh = def.gridSize?.height || 1;
            
            const modObj: any = {
                uid: 'mod_' + Date.now() + '_' + Math.floor(Math.random() * 1000000),
                moduleId,
                gridX,
                gridY,
                width: (rotation % 180 !== 0) ? gh : gw,
                height: (rotation % 180 !== 0) ? gw : gh,
                rotation,
                hp: def.maxHp || 100000,
                maxHp: def.maxHp || 100000,
                inventoryCapacity: def.inventoryCapacity || 100,
                factionId: facId
            };
            
            // 如果蓝图中定义了 internalSlots，则在生成时直接初始化空的 internalModules 字典
            if (def.internalSlots) {
                modObj.internalModules = {};
                // 如果模板中预配置了内构，直接装配
                if (internalModulesConfig) {
                    for (const [slot, intModId] of Object.entries(internalModulesConfig)) {
                        modObj.internalModules[slot] = {
                            moduleId: intModId,
                            isWorking: true
                        };
                    }
                    // console.log(`[getWorldState生成] ${moduleId} 装配内构成功:`, internalModulesConfig, "生成结果:", modObj.internalModules);
                }
            }
            
            return modObj;
        };

        const targetFactions = [1, 2, 3, 4];
        targetFactions.forEach(factionId => {
            // 获取该阵营的所有星区
            const mySectors = sectors.filter((s: any) => s.factionId === factionId);
            if (mySectors.length === 0) return;

            // 打乱该阵营星区顺序，准备依次分配空间站
            Phaser.Utils.Array.Shuffle(mySectors);

            const factoryTypes = ['factory_mining', 'factory_heavy', 'factory_chemical', 'factory_hightech'];

            mySectors.forEach((sector: any, index: number) => {
                // 开局动态分配工业模板以维持经济循环，铺满所有星区
                const factoryIndex = index % factoryTypes.length;
                const stationType = factoryTypes[factoryIndex];

                const angle = Math.random() * Math.PI * 2;
                const distance = 2000 + Math.random() * 6000;
                
                const stationId = `station_${stationType}_${factionId}_${index}_${Date.now()}_${Math.floor(Math.random()*100)}`;
                const template = stationTemplates[stationType]; // 确保 ModuleData.json 里必定有这4个模板
                
                const modules = template.modules.map((m: any) => 
                    generateModule(m.moduleId, m.gridX, m.gridY, m.rotation, factionId, m.internalModules)
                ).filter((m: any) => m !== null);

                // 前 3 个星区额外获得造船能力：追加一个 drone_dock
                if (index < 3) {
                    const droneDock = generateModule('drone_dock', 2, 0, 0, factionId);
                    if (droneDock) modules.push(droneDock);
                }

                let ownerId: string | number = factionId;
                if (factionId && factionId !== 0) {
                    ownerId = NPCManager.getInstance().assignOrGetNPCForEntity(factionId);
                }

                defaultState.stations.push({
                    uid: stationId,
                    factionId: factionId,
                    ownerId: ownerId,
                    worldX: Math.cos(angle) * distance,
                    worldY: Math.sin(angle) * distance,
                    type: stationType, // type 依然记录它偏向的工业类型
                    sector: sector.name,
                    modules: modules
                });

                if (typeof ownerId === 'string' && ownerId !== 'player') {
                    // 初始化阶段记录其拥有者，注意其实目前只存了 id
                    // 如果需要在NPC身上区分 ship 和 building，需在 NPCManager里用 addOwnedBuilding
                    // 暂时这里为了简单，我们可以加在 npc 数据里（TODO 确保这在 NPCManager 被序列化）
                }
            });
            
            // 每个阵营挑选所有的星区，并在每个星区生成多个矿带，总范围扩大5倍！
            mySectors.forEach((sector: any) => {
                // 在每个星区里生成 2 到 3 个超级大矿带！
                const beltsInSector = 2 + Math.floor(Math.random() * 2); 
                for (let i = 0; i < beltsInSector; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    // 拉开距离避免完全重叠
                    const distance = 3000 + Math.random() * 6000;
                    
                    defaultState.asteroidBelts.push({
                        uid: `belt_${factionId}_${Date.now()}_${Math.floor(Math.random()*10000)}`,
                        sector: sector.name,
                        worldX: Math.cos(angle) * distance,
                        worldY: Math.sin(angle) * distance,
                        // 矿带半径扩大 5 倍！(原来是 1500~2500，现在直接 7500~12500)
                        radius: (1500 + Math.random() * 1000) * 5,
                        resourceType: Math.random() > 0.5 ? 'titanium' : 'crystal',
                        richness: 1.0 + Math.random() * 2.0, // 丰富度也大幅提升，确保挖不空
                        minedFragments: 0,
                        miningRate: 0
                    });
                }
            });
        });

        // 初始化好感度网络 (-100 到 100)
        factions.forEach(f1 => {
            factions.forEach(f2 => {
                if (f1.id < f2.id) {
                    // [重构外交系统]
                    // factionId 3 (拾荒海盗) 和 4 (虚空邪教) 设定为全宇宙公敌
                    if (f1.id === 3 || f1.id === 4 || f2.id === 3 || f2.id === 4) {
                        defaultState.relations[`${f1.id}-${f2.id}`] = -100;
                    } else {
                        // 正规军之间默认中立偏冷淡
                        defaultState.relations[`${f1.id}-${f2.id}`] = 0;
                    }
                }
            });
        });

        localStorage.setItem('world_state', JSON.stringify(defaultState));
        
        return defaultState;
    }

    static saveWorldState(state) {
        localStorage.setItem('world_state', JSON.stringify(state));
    }

    static getRelation(state, f1, f2) {
        // 兼容旧代码调用，转发给 AffinityManager
        return AffinityManager.getRelation(state, f1, f2);
    }

    // --- 疆土意识与入侵者判定接口 ---

    /**
     * 获取指定阵营的“疆土” (属于该阵营的所有星区名称列表)
     */
    static getTerritory(worldState, factionId) {
        if (!worldState || !worldState.sectors) return [];
        return worldState.sectors
            .filter(s => s.factionId === factionId)
            .map(s => s.name);
    }

    /**
     * 检测指定阵营的疆土中，是否存在好感度 < 0 的入侵者飞船
     * @returns 返回一个按星区聚合的入侵者记录对象 { "太阳系": ["ship_id_1", "ship_id_2"], ... }
     */
    static getIntruders(worldState, factionId) {
        const territory = this.getTerritory(worldState, factionId);
        const intrudersMap = {};

        if (territory.length === 0) return intrudersMap;

        // 获取全宇宙当前实体与 OOS 挂起飞船的集合
        // 注意：由于 WorldbookManager 可以独立于前端运行，我们需要通过 ShipManager 获取最新的物理内存数据
        let allShips = [];
        try {
            const ShipManager = (window as any).ShipManager;
            if (ShipManager) {
                allShips = [...ShipManager.ships];
            } else if (worldState.ships) {
                // 如果是纯离线推演
                allShips = [...worldState.ships];
            }
        } catch (e) {
            if (worldState.ships) allShips = [...worldState.ships];
        }

        allShips.forEach(ship => {
            // 如果该飞船死了或者在跃迁空间（不在具体星区）或者停泊在站内，则忽略
            if (ship.stats?.hp <= 0 || ship.state === 'WARP' || ship.state === 'DOCKED') return;
            
            // 如果该飞船处于目标阵营的领土内
            if (territory.includes(ship.location?.sector)) {
                // 检查这艘飞船的主人是否与领土主人有敌意 (好感度 < 0)
                const relation = this.getRelation(worldState, factionId, ship.factionId);
                if (relation < 0) {
                    const sec = ship.location.sector;
                    if (!intrudersMap[sec]) intrudersMap[sec] = [];
                    intrudersMap[sec].push(ship.id);
                }
            }
        });

        return intrudersMap;
    }

    static addRelation(state, f1, f2, delta) {
        // 兼容旧代码调用，转发给 AffinityManager
        AffinityManager.addRelation(state, f1, f2, delta);
    }

    static getStarlanes(allSectors) {
        const result = [];
        const addedSet = new Set();
        
        allSectors.forEach(s1 => {
            if (s1.connections && Array.isArray(s1.connections)) {
                s1.connections.forEach(targetName => {
                    const s2 = allSectors.find(s => s.name === targetName);
                    if (s2) {
                        // 确保每条连线只被添加一次 (无向图)
                        const key = s1.name < s2.name ? `${s1.name}-${s2.name}` : `${s2.name}-${s1.name}`;
                        if (!addedSet.has(key)) {
                            addedSet.add(key);
                            result.push({
                                s1: s1,
                                s2: s2,
                                dist: Math.hypot(s1.x - s2.x, s1.y - s2.y)
                            });
                        }
                    }
                });
            }
        });

        return result;
    }

    static getStarlanePath(startNode, endNode, allSectors) {
        const lanes = this.getStarlanes(allSectors);
        const adj = new Map();
        allSectors.forEach(s => adj.set(s.name, []));
        
        lanes.forEach(lane => {
            adj.get(lane.s1.name).push(lane.s2);
            adj.get(lane.s2.name).push(lane.s1);
        });

        const queue = [[startNode]];
        const visited = new Set([startNode.name]);

        while(queue.length > 0) {
            const path = queue.shift();
            const current = path[path.length - 1];

            if(current.name === endNode.name) {
                return path;
            }

            const neighbors = adj.get(current.name) || [];
            for(const neighbor of neighbors) {
                if(!visited.has(neighbor.name)) {
                    visited.add(neighbor.name);
                    queue.push([...path, neighbor]);
                }
            }
        }
        return null;
    }

    static tickWorld() {
        const worldState = WorldbookManager.getWorldState();
        let stateChanged = false;
        const now = Date.now();

        // [Phase 2] 更新所有实体飞船
        ShipManager.update(0.2, worldState); // 假设 tick 是 200ms
        
        // [OOS 扩展] 更新所有后台虚影和建筑进度
        OOSSimulator.updateGlobalOOS(worldState, 0.2);

        // --- 全局内构数据池与处理器 ---
        // 我们只在核心循环里把全宇宙当前的内构状态收集成一个扁平的数组（池子），
        // 供后续其他专门的逻辑（例如纯工厂转换器）去读取和消费。
        const internalModulesPool = getGlobalInternalModulesPool(worldState);
        (worldState as any)._transientInternalPool = internalModulesPool;
        
        // 将逻辑处理器剥离到 building 管理器下属专门负责小型建筑的文件中
        const internalChanged = InternalModuleProcessor.processGlobalInternalModules(worldState, 0.2);
        if (internalChanged) {
            stateChanged = true;
        }
        
        stateChanged = true; // 飞船移动意味着状态改变需要保存（可选：根据需求优化保存频率）

        // [Phase 1 Cleanup] 移除了所有基于 payload 数字的军舰/商船移动逻辑
        // 我们暂时只保留基础的资源生产逻辑，以便经济系统不崩坏

        // 2. 低频宏观逻辑：10秒循环的生产
        // ----------------------------------------
        // 如果是首次运行，设置一个过去的时间，以便立即触发第一波经济活动
        if (!worldState.lastMacroTick) worldState.lastMacroTick = now - 11000;
        
        const isMacroTick = (now - worldState.lastMacroTick) >= 10000;
        
        if (isMacroTick) {
            worldState.lastMacroTick = now;
            stateChanged = true;

            // 势力影响力自然增长
            worldState.factions.forEach(f => {
                const sectorCount = worldState.sectors.filter(s => s.factionId === f.id).length;
                if (sectorCount > 0) {
                    f.influence += 5 + Math.floor(Math.sqrt(sectorCount) * 2); 
                }
            });

            // 随机起义事件 (保留作为一种动态性，但暂时不生成军队)
            worldState.factions.forEach(f => {
                const count = worldState.sectors.filter(s => s.factionId === f.id).length;
                if (count === 0 && Math.random() < 0.05) { 
                    const target = worldState.sectors[Math.floor(Math.random() * worldState.sectors.length)];
                    target.factionId = f.id;
                    f.influence = 1000; 
                    // console.log(`[星区新闻] 灭亡的势力 '${f.name}' 在 '${target.name}' 发动了武装起义！`);
                }
            });

            // --- 订单生成与派发 ---
            // 提取到拆分模块中处理
            processMacroOrders(worldState, now, WorldbookManager);

        } // end of isMacroTick
        
        if (stateChanged) {
            WorldbookManager.saveWorldState(worldState);
        }
        return stateChanged;
    }
}
