import { GameConfig } from '../../config.js';
import { InventoryManager } from '../InventoryManager.js';
import { EventBus } from '../../utils/EventBus.js';

export class InternalModuleProcessor {
    /**
     * 消费内构数据池，处理全宇宙所有工厂等内部模块的转换逻辑
     * @param worldState 当前的世界状态（其中包含了刚才生成的 internalModulesPool）
     * @param dt 经过的时间（秒）
     * @returns stateChanged 布尔值，标识是否发生了需要存盘的改变
     */
    static processGlobalInternalModules(worldState: any, dt: number): boolean {
        // 从临时变量获取我们刚在 WorldbookManager 里生成的数据池
        const pool = (worldState as any)._transientInternalPool;
        if (!pool || pool.length === 0) return false;

        const internalConfig = (GameConfig as any).INTERNAL_MODULES || {};
        let globalStateChanged = false;
        const updatedStations = new Set<string>();

        pool.forEach((item: any) => {
            const { stationUid, moduleId, slotId, internal } = item;
            
            // 兼容性读取真实内构ID
            const realInternalId = internal.moduleId || internal.id;
            const data = internalConfig[realInternalId];
            if (!data) return;

            // --------------------------------------------------------
            // 工厂类型处理逻辑
            // --------------------------------------------------------
            if (data.type === 'factory' && data.recipe) {
                if (internal.progress === undefined) internal.progress = 0;
                
                const stationInventoryId = stationUid;
                let hasInputs = true;
                const inventory = InventoryManager.getInventory(stationInventoryId);
                
                if (inventory) {
                    for (const [res, count] of Object.entries(data.recipe.inputs)) {
                        if (!inventory[res] || inventory[res] < (count as number)) {
                            hasInputs = false;
                            break;
                        }
                    }
                } else {
                    hasInputs = false;
                }

                // 记录状态供 UI 渲染动画使用
                const wasWorking = internal.isWorking;
                internal.isWorking = hasInputs;
                if (wasWorking !== internal.isWorking) {
                    globalStateChanged = true;
                    updatedStations.add(stationUid); // 状态改变，通知 UI 刷新
                }

                if (hasInputs) {
                    internal.progress += dt; 
                    
                    if (internal.progress >= data.recipe.cycleTime) {
                        internal.progress -= data.recipe.cycleTime;
                        
                        for (const [res, count] of Object.entries(data.recipe.inputs)) {
                            InventoryManager.removeCargo(stationInventoryId, res, count as number);
                        }
                        for (const [res, count] of Object.entries(data.recipe.outputs)) {
                            InventoryManager.addCargo(stationInventoryId, res, count as number);
                        }
                        
                        updatedStations.add(stationUid);
                        globalStateChanged = true;
                        // console.log(`[工厂处理器] 站点 ${stationUid} 槽位 ${slotId} 生产了 ${data.name}`);
                    } else {
                        globalStateChanged = true;
                    }
                }
            }
        });

        // 统一广播 UI 刷新
        updatedStations.forEach(stationUid => {
            EventBus.dispatchEvent(new CustomEvent('ui_inventory_refresh', { detail: { targetId: stationUid } }));
        });

        return globalStateChanged;
    }
}
