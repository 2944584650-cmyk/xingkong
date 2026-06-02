import { GameConfig } from '../config.js';
import { ShipManager } from './ShipManager.js';

export class PlayerManager {
    /**
     * 获取玩家基本属性
     */
    static getStats() {
        let credits = parseInt(localStorage.getItem('player_credits'));
        if (isNaN(credits)) credits = 0;
        
        // [测试福利] 移除强制兜底发钱逻辑，避免覆盖正常载入的存档数据
        // 只有在完全没有开局标记时（表示这是真正的新游戏）才发钱
        if (!localStorage.getItem('game_has_started')) {
            credits += 1000;
            localStorage.setItem('player_credits', credits.toString());
            localStorage.setItem('game_has_started', '1');
        }

        let stats: any = {
            credits: credits,
            hullId: localStorage.getItem('player_hull_id') || null,
        };
        
        try {
            const rawSlots = localStorage.getItem('player_slots');
            stats.slots = rawSlots ? JSON.parse(rawSlots) : {};
        } catch(e) {
            stats.slots = {};
        }

        try {
            stats.turretRules = JSON.parse(localStorage.getItem('player_turret_rules') || '{}');
        } catch(e) {
            stats.turretRules = {};
        }

        // --- 多中队系统数据读取 (V3) ---
        try {
            const rawOwned = localStorage.getItem('player_owned_ships');
            const rawFleets = localStorage.getItem('player_fleets');
            let pShipId = localStorage.getItem('player_ship_id');
            
            if (rawOwned) {
                stats.ownedShips = JSON.parse(rawOwned);
            } else {
                stats.ownedShips = [];
            }
            
            if (rawFleets) {
                stats.fleets = JSON.parse(rawFleets);
            } else {
                stats.fleets = [];
            }

            // 兼容 V2 到 V3 的平滑过渡
            const rawFleetV2 = localStorage.getItem('player_active_fleet');
            if (rawFleetV2 && !rawFleets) {
                const oldFleet = JSON.parse(rawFleetV2);
                pShipId = oldFleet.flagshipId;
                
                // V2的 activeFleet 转为 V3 的第一中队
                stats.fleets.push({
                    id: 'fleet_1',
                    name: '第一中队',
                    flagshipId: oldFleet.flagshipId,
                    members: oldFleet.members || [],
                    orders: 'follow_leader' // 默认跟随旗舰
                });

                localStorage.setItem('player_fleets', JSON.stringify(stats.fleets));
                localStorage.removeItem('player_active_fleet'); // 清理旧数据
            }

            // 移除首次开局自动分配默认船只和中队的逻辑
            const isFirstStart = !localStorage.getItem('game_has_started_v3');
            if (stats.ownedShips.length === 0 && isFirstStart) {
                localStorage.setItem('game_has_started_v3', '1');
            }

            stats.playerShipId = pShipId;

            // 修复 V2 时期留下的 isFlagship 脏数据
            stats.ownedShips.forEach(s => { delete s.isFlagship; });

        } catch(e) {
            console.error('Fleet init error:', e);
            stats.ownedShips = [];
            stats.fleets = [];
            stats.playerShipId = null;
        }

        // [核心修正] 强制优先使用资产库中的真实数据覆盖根节点缓存
        // 彻底解决双重真实（Double Source of Truth）导致的旧数据回写污染问题
        if (stats.playerShipId && stats.ownedShips) {
            const currentShip = stats.ownedShips.find(s => s.id === stats.playerShipId);
            if (currentShip) {
                // 使用深拷贝阻断引用，防止隐式修改
                stats.hullId = currentShip.hullId;
                stats.slots = JSON.parse(JSON.stringify(currentShip.slots || {}));
                stats.turretRules = JSON.parse(JSON.stringify(currentShip.turretRules || {}));
            }
        }

        // 统一为所有所有拥有的船只动态计算并挂载真实的 maxHp 和 cargoCapacity
        if (stats.ownedShips) {
            stats.ownedShips.forEach(ship => {
                const hull = GameConfig.HULLS[ship.hullId] || { baseHp: 100 };
                let mHp = hull.baseHp;
                // 优先读取 maxInventory, 如果没有才尝试 cargoCapacity 等
                let cCap = hull.maxInventory || hull.cargoCapacity || Math.floor(hull.baseHp / 2) || 50;
                
                if (!ship.cargo) ship.cargo = {}; // 初始化货舱数据

                if (ship.slots) {
                    Object.values(ship.slots).forEach(compId => {
                        const cDef = (GameConfig.COMPONENTS as Record<string, any>)[compId as string];
                        if (cDef) {
                            if (cDef.type === 'defense' && cDef.stats && cDef.stats.hpBonus) {
                                mHp += cDef.stats.hpBonus;
                            }
                            if (cDef.stats && cDef.stats.cargoBonus) {
                                cCap += cDef.stats.cargoBonus;
                            }
                        }
                    });
                }
                ship.maxHp = mHp;
                ship.cargoCapacity = cCap;
                
                // 安全兜底
                if (ship.hp === undefined) {
                    ship.hp = ship.maxHp;
                } else if (ship.hp > ship.maxHp) {
                    ship.hp = ship.maxHp;
                }
            });
        }

        return stats;
    }

    /**
     * 保存玩家基本属性
     */
    static saveStats(data) {
        // [核心修正] 任何对根节点的修改，必须同步回资产库中的实体
        // 确保 ownedShips 永远是唯一且最新的数据源
        if (data.playerShipId && data.ownedShips) {
            const currentShip = data.ownedShips.find(s => s.id === data.playerShipId);
            if (currentShip) {
                if (data.hullId !== undefined) currentShip.hullId = data.hullId;
                if (data.slots !== undefined) currentShip.slots = JSON.parse(JSON.stringify(data.slots));
                if (data.turretRules !== undefined) currentShip.turretRules = JSON.parse(JSON.stringify(data.turretRules));
            }
        }

        if (data.credits !== undefined) localStorage.setItem('player_credits', data.credits);
        
        // 彻底移除对 player_hull_id/slots/turretRules 的写入
        // 不再维护任何“双重真实”，杜绝脏数据污染
        
        // 保存 V3 舰队与座驾数据
        if (data.ownedShips !== undefined) localStorage.setItem('player_owned_ships', JSON.stringify(data.ownedShips));
        if (data.fleets !== undefined) localStorage.setItem('player_fleets', JSON.stringify(data.fleets));
        if (data.playerShipId !== undefined) localStorage.setItem('player_ship_id', data.playerShipId);
    }
    
    /**
     * 重置所有静态缓存状态（如果有）
     */
    static reset() {
        // PlayerManager 主要是依靠 localStorage 进行存取
        // 这里提供 reset 方法以满足统一清理接口的需要
    }

    /**
     * 兼容旧代码的 save 方法
     */
    static save(data) {
        if (data) {
            this.saveStats(data);
        }
    }

    /**
     * 更新单个属性
     */
    static updateStat(key, delta) {
        const stats = this.getStats();
        if (stats[key] !== undefined) {
            stats[key] = Math.max(0, stats[key] + delta);
            this.saveStats(stats);
            return stats[key];
        }
        return 0;
    }

    // --- 舰队管理辅助方法 ---

    /**
     * 购买新船到资产库
     */
    static buyShipToGarage(hullId, price, name = '新购舰船', baseHp = 100) {
        const stats = this.getStats();
        if (stats.credits < price) return false;
        
        stats.credits -= price;
        const newShipId = 'ship_' + Date.now() + '_' + Math.floor(Math.random()*1000);
        
        let currentSector = localStorage.getItem('current_sector');
        
        const newShip = {
            id: newShipId,
            name: name,
            hullId: hullId,
            slots: {}, // 初始为空插槽
            cargo: {}, // 初始为空货舱
            hp: baseHp,
            // 记录初始位置 (为了离队后能找到)
            location: { sector: currentSector, x: 500 + (Math.random()-0.5)*200, y: 300 + (Math.random()-0.5)*200 }
        };
        stats.ownedShips.push(newShip);
        this.saveStats(stats);

        // 同步注册到宏观宇宙 ShipManager，使其成为物理存在的实体
        // 这样即使不编队，它也会停留在当前星区

        const buildData = {
            id: newShipId,
            type: 'fighter', // 暂时统称fighter，Base.js渲染时会根据 hullId 修正
            name: name,
            hullId: hullId,
            ownerId: 'player',
            factionId: 0,
            location: newShip.location,
            sector: currentSector,
            stats: { hp: baseHp, maxHp: baseHp, speed: 100 },
            state: 'IDLE', // 直接处于闲置状态，取消建造系统
            behavior: 'IDLE'
        };

        ShipManager.createShip(buildData);

        return true;
    }

    /**
     * 切换玩家个人座驾 (魂穿操作，改变视角，不影响原舰队编制位置)
     */
    static setPlayerShip(targetShipId) {
        const stats = this.getStats();
        const target = stats.ownedShips.find(s => s.id === targetShipId);
        if (!target) return false;
        
        // 1. 同步旧座驾状态
        this.saveStats(stats);
        
        // 2. 将旧座驾交还给 AI (它依然留在原地)
        const oldMacroShip = ShipManager.getShipById(stats.playerShipId);
        if (oldMacroShip) {
            // [Fix] 如果旧座驾刚脱离玩家控制，并且没有跟随或移动指令，设为闲置
            if (!oldMacroShip.commandState) {
                oldMacroShip.state = 'IDLE';
            }
        }

        // 3. 读取新座驾的真实位置，更新玩家视角和所在的星区
        const newMacroShip = ShipManager.getShipById(targetShipId);
        if (newMacroShip) {
            // [修改] 绝不瞬移飞船，而是传送玩家的灵魂视角
            const targetSector = newMacroShip.location.sector;
            localStorage.setItem('current_sector', targetSector);
            
            // 写入坐标，这样 Base.js 重载时就会以这个坐标出生
            if (newMacroShip.location.x !== undefined) {
                localStorage.setItem('player_radar_x', newMacroShip.location.x.toString());
                localStorage.setItem('player_radar_y', newMacroShip.location.y.toString());
            }

            // 如果新座驾有离港倒计时，清除之，防止刚接管就被系统踢出
            newMacroShip.dockTimer = 0;
        }

        // 4. 切换 ID 并保存
        stats.playerShipId = targetShipId;
        
        // 为了让当前内存中的 stats 立即反映新船状态（供后续 UI 使用），手动拉取一次
        stats.hullId = target.hullId;
        stats.slots = JSON.parse(JSON.stringify(target.slots || {}));
        stats.turretRules = JSON.parse(JSON.stringify(target.turretRules || {}));

        this.saveStats(stats);
        return true;
    }

    // --- 中队 (Fleet) 管理系统 (V3) ---

    static createFleet(fleetName) {
        const stats = this.getStats();
        const newFleet = {
            id: 'fleet_' + Date.now(),
            name: fleetName || `中队-${stats.fleets.length + 1}`,
            flagshipId: null,
            members: [],
            orders: 'follow_leader' // 默认僚机跟随本队队长
        };
        stats.fleets.push(newFleet);
        this.saveStats(stats);
        return newFleet.id;
    }

    static removeFleet(fleetId) {
        const stats = this.getStats();
        stats.fleets = stats.fleets.filter(f => f.id !== fleetId);
        this.saveStats(stats);
        return true;
    }

    static setFleetOrders(fleetId, orders) {
        const stats = this.getStats();
        const fleet = stats.fleets.find(f => f.id === fleetId);
        if (fleet) {
            fleet.orders = orders;
            this.saveStats(stats);
            return true;
        }
        return false;
    }

    // 内部方法：从任何中队中无情移除一艘船
    static _removeShipFromAnyFleetInternal(stats, shipId) {
        stats.fleets.forEach(fleet => {
            fleet.members = fleet.members.filter(mId => mId !== shipId);
            
            if (fleet.flagshipId === shipId) {
                if (fleet.members.length > 0) {
                    fleet.flagshipId = fleet.members[0];
                    fleet.members.shift(); 
                } else {
                    fleet.flagshipId = null;
                }
            }
        });
    }

    /**
     * 将船只分配到指定中队 (作为僚机或旗舰)
     * 注意：玩家当前的座驾也可以被编入任何舰队，扮演队长或僚机
     */
    static assignShipToFleet(shipId, fleetId, asFlagship = false) {
        const stats = this.getStats();
        
        // 先把它从所有已有编制中拔除
        this._removeShipFromAnyFleetInternal(stats, shipId);
        
        const targetFleet = stats.fleets.find(f => f.id === fleetId);
        if (!targetFleet) return false;

        if (asFlagship) {
            // 原旗舰降级为普通僚机
            if (targetFleet.flagshipId) {
                targetFleet.members.push(targetFleet.flagshipId);
            }
            targetFleet.flagshipId = shipId;
        } else {
            // 如果该中队连旗舰都没有，它被迫当旗舰
            if (!targetFleet.flagshipId) {
                targetFleet.flagshipId = shipId;
            } else {
                targetFleet.members.push(shipId);
            }
        }

        this.saveStats(stats);
        return true;
    }

    /**
     * 永久移除（销毁）一艘船只
     */
    static removeShip(shipId) {
        const stats = this.getStats();
        
        const shipIndex = stats.ownedShips.findIndex(s => s.id === shipId);
        if (shipIndex === -1) return null;

        const shipName = stats.ownedShips[shipIndex].name;
        
        // 1. 从资产库移除
        stats.ownedShips.splice(shipIndex, 1);
        
        // 2. 从任何服役中队中移除
        this._removeShipFromAnyFleetInternal(stats, shipId);
        
        // 3. 玩家座驾被毁（如果在此处销毁，设空即可，Base.js会有重生逻辑）
        if (stats.playerShipId === shipId) {
            stats.playerShipId = null;
        }

        this.saveStats(stats);

        // 同步从宇宙中抹除
        ShipManager.removeShip(shipId);

        return shipName;
    }

    /**
     * 获取已拥有但未装备的配件库存 (Owned Components)
     */
    static getOwnedComponents() {
        try {
            let comps = JSON.parse(localStorage.getItem('player_owned_components'));
            if (!comps || comps.length === 0) {
                // 首次初始化送点破烂
                comps = ['laser_mk1', 'armor_titanium', 'engine_basic_s'];
                this.saveOwnedComponents(comps);
            }
            return comps;
        } catch (e) {
            return ['laser_mk1', 'engine_basic_s'];
        }
    }

    /**
     * 保存已拥有的配件
     */
    static saveOwnedComponents(compArray) {
        localStorage.setItem('player_owned_components', JSON.stringify(compArray));
    }

    /**
     * 将船只从中队中移出（变回无编制的备用资产）
     */
    static removeShipFromFleet(shipId) {
        const stats = this.getStats();
        this._removeShipFromAnyFleetInternal(stats, shipId);
        this.saveStats(stats);
        
        // 离队后，该船只应在宏观管理器中被标记为“闲置”，并停留在当前玩家所在的星区
        let currentSector = localStorage.getItem('current_sector');
        
        const shipRef = ShipManager.getShipById(shipId);
        if (shipRef) {
            shipRef.state = 'IDLE';
            shipRef.behavior = 'IDLE';
            // 如果它之前是跟随状态，现在把它定在当前位置
            // 这里我们无法精确获取玩家微观坐标，但可以更新其宏观星区为当前星区
            shipRef.sector = currentSector; 
            // 如果它在当前星区内，Base.js 会自动接管它的物理位置
        }
        
        return true;
    }

    /**
     * 从闲置库存移除配件
     */
    static removeComponent(compId) {
        const comps = this.getOwnedComponents();
        const index = comps.indexOf(compId);
        if (index > -1) {
            comps.splice(index, 1);
            this.saveOwnedComponents(comps);
            return true;
        }
        return false;
    }

    /**
     * 获取库存
     */
    static getInventory() {
        try {
            return JSON.parse(localStorage.getItem('player_inventory') || '[]');
        } catch (e) {
            return [];
        }
    }

    /**
     * 保存库存
     */
    static saveInventory(inventoryArray) {
        localStorage.setItem('player_inventory', JSON.stringify(inventoryArray));
    }

    /**
     * 添加物品
     */
    static addItem(itemName) {
        const inv = this.getInventory();
        inv.push(itemName);
        this.saveInventory(inv);
        return inv;
    }

    /**
     * 添加货物到当前座驾货舱
     */
    static addCargo(goodId, amount = 1) {
        const stats = this.getStats();
        if (!stats.playerShipId) return false;
        
        const ship = stats.ownedShips.find(s => s.id === stats.playerShipId);
        if (!ship) return false;
        if (!ship.cargo) ship.cargo = {};
        
        // 简单计算重量
        let itemData = null;
        try {
            const rawData = localStorage.getItem('game_items_cache') || '{}';
            const allItems = JSON.parse(rawData);
            itemData = allItems[goodId];
        } catch(e) {}
        
        const unitWeight = itemData ? (itemData.weight || 1) : 1;
        const addWeight = unitWeight * amount;
        
        // 计算当前总重
        let currentWeight = 0;
        Object.entries(ship.cargo).forEach(([id, qty]) => {
            let w = 1;
            try {
                const allItems = JSON.parse(localStorage.getItem('game_items_cache') || '{}');
                if(allItems[id]) w = allItems[id].weight || 1;
            } catch(e) {}
            currentWeight += w * (qty as number);
        });
        
        if (currentWeight + addWeight > (ship.cargoCapacity || 50)) {
            // 超重
            return false;
        }

        if (ship.cargo[goodId]) {
            ship.cargo[goodId] += amount;
        } else {
            ship.cargo[goodId] = amount;
        }
        
        this.saveStats(stats);

        // 同步给宏观实体
        const macroShip = ShipManager.getShipById(stats.playerShipId);
        if (macroShip) {
            if (!macroShip.inventory) macroShip.inventory = {};
            if (macroShip.inventory[goodId]) {
                macroShip.inventory[goodId] += amount;
            } else {
                macroShip.inventory[goodId] = amount;
            }
        }
        
        return true;
    }

    /**
     * 移除物品
     */
    static removeItem(itemName) {
        const inv = this.getInventory();
        const index = inv.indexOf(itemName);
        if (index > -1) {
            inv.splice(index, 1);
            this.saveInventory(inv);
            return true;
        } else {
            // 模糊匹配
            let coreName = itemName.replace(/[0-9]+(个|单位|箱|件|块)?的?/g, '').trim();
            if (!coreName) coreName = itemName;
            for (let i = 0; i < inv.length; i++) {
                if (inv[i].includes(coreName) || coreName.includes(inv[i])) {
                    inv.splice(i, 1);
                    this.saveInventory(inv);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 获取指定飞船的货舱数据和容量
     */
    static getShipCargo(shipId) {
        const stats = this.getStats();
        const ship = stats.ownedShips.find(s => s.id === shipId);
        if (ship) {
            return {
                cargo: ship.cargo || {},
                capacity: ship.cargoCapacity || 50
            };
        }
        return null;
    }

    /**
     * 移除指定船只的货物 (适用于玩家所属的任何舰队船只)
     */
    static removeShipCargo(shipId, goodId, amount) {
        const stats = this.getStats();
        const ship = stats.ownedShips.find(s => s.id === shipId);
        if (!ship || !ship.cargo || !ship.cargo[goodId]) return false;
        
        if (ship.cargo[goodId] >= amount) {
            ship.cargo[goodId] -= amount;
            if (ship.cargo[goodId] <= 0) {
                delete ship.cargo[goodId];
            }
            this.saveStats(stats);

            // 同步给宏观实体
            const macroShip = ShipManager.getShipById(shipId);
            if (macroShip && macroShip.inventory && macroShip.inventory[goodId]) {
                macroShip.inventory[goodId] -= amount;
                if (macroShip.inventory[goodId] <= 0) delete macroShip.inventory[goodId];
            }

            return true;
        }
        return false;
    }

    /**
     * 从当前座驾移除指定数量的货物
     */
    static removeCargo(goodId, amount) {
        const stats = this.getStats();
        if (!stats.playerShipId) return false;
        
        const ship = stats.ownedShips.find(s => s.id === stats.playerShipId);
        if (!ship || !ship.cargo || !ship.cargo[goodId]) return false;
        
        if (ship.cargo[goodId] >= amount) {
            ship.cargo[goodId] -= amount;
            if (ship.cargo[goodId] <= 0) {
                delete ship.cargo[goodId];
            }
            this.saveStats(stats);

            // 同步给宏观实体
            const macroShip = ShipManager.getShipById(stats.playerShipId);
            if (macroShip && macroShip.inventory && macroShip.inventory[goodId]) {
                macroShip.inventory[goodId] -= amount;
                if (macroShip.inventory[goodId] <= 0) delete macroShip.inventory[goodId];
            }

            return true;
        }
        return false;
    }

    /**
     * 解析装备特效状态
     */
    static getEquipmentBuffs() {
        const inv = this.getInventory();
        return {
            hasShield: inv.some(i => i.includes('护盾') || i.includes('力场')),
            hasLaser: inv.some(i => i.includes('激光') || i.includes('光束')),
            hasShotgun: inv.some(i => i.includes('散弹') || i.includes('矩阵'))
        };
    }
}
