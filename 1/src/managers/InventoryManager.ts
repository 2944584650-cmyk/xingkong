import ItemData from '../../json/ItemData.json';
import { EventBus } from '../utils/EventBus.js';
import { GameConfig } from '../config.js';

/**
 * 统一库存管理器 (InventoryManager)
 * 负责管理游戏中所有实体(飞船、空间站、建筑模块等)的货舱数据。
 * 提供统一的物品增删改查、转移和容量计算接口，并解耦具体的业务逻辑。
 */
export class InventoryManager {
    // 内存中的所有库存数据，键为实体ID，值为 物品ID -> 数量 映射
    static inventories: Record<string, Record<string, number>> = {};

    /**
     * 从本地存储加载库存数据
     */
    static load() {
        try {
            const data = localStorage.getItem('inventory_data');
            if (data) {
                this.inventories = JSON.parse(data);
            } else {
                this.inventories = {};
            }
        } catch (e) {
            console.error('Failed to load inventory data', e);
            this.inventories = {};
        }
    }

    /**
     * 将当前库存数据持久化到本地存储
     */
    static save() {
        localStorage.setItem('inventory_data', JSON.stringify(this.inventories));
    }

    /**
     * 获取指定实体的完整库存列表
     * @param entityId 实体ID (飞船ID或空间站UID)
     * @returns 物品ID到数量的映射对象
     */
    static getInventory(entityId: string): Record<string, number> {
        if (!entityId) return {};
        if (!this.inventories[entityId]) {
            this.inventories[entityId] = {};
        }
        return this.inventories[entityId];
    }

    /**
     * 查询指定物品的单体体积
     * @param itemId 物品的唯一标识符
     * @returns 单个物品占用的体积数值
     */
    static getItemVolume(itemId: string): number {
        let def = (ItemData.ITEMS as any)[itemId];
        if (!def) def = Object.values(ItemData.ITEMS).find((v: any) => v.name === itemId);
        if (!def && GameConfig.COMPONENTS[itemId]) def = { volume: 5.0 }; // Component default volume
        return def ? def.volume : 1.0;
    }

    /**
     * 计算指定实体当前库存占据的总物理体积
     * @param entityId 实体ID
     * @returns 已使用的总货舱体积
     */
    static getCurrentVolume(entityId: string): number {
        const inv = this.getInventory(entityId);
        let vol = 0;
        for (const [itemId, count] of Object.entries(inv)) {
            vol += this.getItemVolume(itemId) * count;
        }
        return vol;
    }

    /**
     * 获取指定实体的最大货舱容量
     * 会自动向对应的系统 (ShipManager 或 BuildingManager) 索要最新配置
     * @param entityId 实体ID
     * @returns 最大容量数值
     */
    static getCapacity(entityId: string): number {
        let capacity = 100;
        if (typeof window !== 'undefined') {
            const sm = (window as any).ShipManager;
            const bm = (window as any).BuildingManager;

            if (sm) {
                const ship = sm.ships?.find((s: any) => s.id === entityId);
                if (ship) return ship.maxInventory || 100;
            }

            if (bm) {
                const allModules = bm.stationModules || [];
                const stationMods = allModules.filter((m: any) => m.stationUid === entityId || m.uid === entityId);
                if (stationMods.length > 0) {
                    capacity = 0;
                    stationMods.forEach((m: any) => {
                        capacity += m.inventoryCapacity || 100;
                    });
                    return capacity;
                }
            }
        }
        return capacity;
    }

    /**
     * 向实体货舱中添加物品 (受最大容量限制)
     * @param entityId 目标实体ID
     * @param itemId 物品ID
     * @param amount 尝试添加的数量
     * @returns 实际成功添加的数量 (如果空间不足可能小于尝试数量)
     */
    static addCargo(entityId: string, itemId: string, amount: number): number {
        if (amount <= 0 || !entityId) return 0;
        const inv = this.getInventory(entityId);
        const capacity = this.getCapacity(entityId);
        const currentVol = this.getCurrentVolume(entityId);
        const itemVol = this.getItemVolume(itemId);

        const freeVol = capacity - currentVol;
        if (freeVol <= 0) return 0;

        const maxCanAdd = Math.floor(freeVol / itemVol);
        const actualAdd = Math.min(amount, maxCanAdd);

        if (actualAdd > 0) {
            if (!inv[itemId]) inv[itemId] = 0;
            inv[itemId] += actualAdd;
            this.save();
            this.emitChangeEvent(entityId);
        }

        return actualAdd;
    }

    /**
     * 从实体货舱中移除物品
     * @param entityId 目标实体ID
     * @param itemId 物品ID
     * @param amount 尝试移除的数量
     * @returns 实际成功移除的数量 (如果库存不足可能小于尝试数量)
     */
    static removeCargo(entityId: string, itemId: string, amount: number): number {
        if (amount <= 0 || !entityId) return 0;
        const inv = this.getInventory(entityId);
        if (!inv[itemId]) return 0;

        const actualRemove = Math.min(inv[itemId], amount);
        if (actualRemove > 0) {
            inv[itemId] -= actualRemove;
            if (inv[itemId] <= 0) delete inv[itemId];
            this.save();
            this.emitChangeEvent(entityId);
        }

        return actualRemove;
    }

    /**
     * 在两个实体之间转移物品
     * 会同时检查来源库存是否足够，以及目标货舱是否能装下
     * @param fromId 源实体ID
     * @param toId 目标实体ID
     * @param itemId 转移的物品ID
     * @param amount 期望转移的数量
     * @returns 实际成功转移的数量
     */
    static transfer(fromId: string, toId: string, itemId: string, amount: number): number {
        if (!fromId || !toId || amount <= 0) return 0;
        const invFrom = this.getInventory(fromId);
        if (!invFrom[itemId] || invFrom[itemId] <= 0) return 0;

        const available = Math.min(invFrom[itemId], amount);
        if (available <= 0) return 0;

        const capTo = this.getCapacity(toId);
        const volTo = this.getCurrentVolume(toId);
        const itemVol = this.getItemVolume(itemId);
        
        const freeVol = capTo - volTo;
        const maxCanAdd = freeVol > 0 ? Math.floor(freeVol / itemVol) : 0;
        
        const actualTransfer = Math.min(available, maxCanAdd);

        if (actualTransfer > 0) {
            invFrom[itemId] -= actualTransfer;
            if (invFrom[itemId] <= 0) delete invFrom[itemId];
            
            const invTo = this.getInventory(toId);
            if (!invTo[itemId]) invTo[itemId] = 0;
            invTo[itemId] += actualTransfer;

            this.save();
            this.emitChangeEvent(fromId);
            this.emitChangeEvent(toId);
        }

        return actualTransfer;
    }

    /**
     * 强制设置某物品的具体数量 (不检查容量，主要用于初始化或作弊)
     * @param entityId 实体ID
     * @param itemId 物品ID
     * @param amount 目标数量
     */
    static setCargo(entityId: string, itemId: string, amount: number) {
        if (!entityId || amount < 0) return;
        const inv = this.getInventory(entityId);
        if (amount === 0) {
            delete inv[itemId];
        } else {
            inv[itemId] = amount;
        }
        this.save();
        this.emitChangeEvent(entityId);
    }

    /**
     * 触发 UI 更新事件
     * 会根据 entityId 的身份(玩家飞船、空间站等)派发相应的兼容事件
     * @param entityId 变动的实体ID
     */
    static emitChangeEvent(entityId: string) {
        if (typeof window !== 'undefined') {
            let isPlayer = false;
            let isStation = false;

            const pm = (window as any).PlayerManager;
            const bm = (window as any).BuildingManager;

            if (pm && pm.getStats().playerShipId === entityId) {
                isPlayer = true;
            }

            if (bm) {
                const allModules = bm.stationModules || [];
                if (allModules.some((m: any) => m.stationUid === entityId || m.uid === entityId)) {
                    isStation = true;
                }
            }

            if (typeof (EventBus as any)?.emit === 'function') {
                if (isPlayer) (EventBus as any).emit('player_cargo_changed');
                if (isStation) (EventBus as any).emit('building_cargo_changed');
                (EventBus as any).emit('inventory_changed', { entityId });
            }
        }
    }
}

if (typeof window !== 'undefined') {
    (window as any).InventoryManager = InventoryManager;
}
