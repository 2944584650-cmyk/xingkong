/**
 * 内构池生成器 (Internal Modules Pool Generator)
 * 将全宇宙所有空间站模块的内部插槽状态收集并扁平化，生成一个统一的数据池，
 * 方便后续的工厂转换、护盾充能等逻辑去遍历和操作。
 */
export function getGlobalInternalModulesPool(worldState: any) {
    if (!worldState.stations) return [];
    
    const pool: any[] = [];
    
    worldState.stations.forEach((station: any) => {
        if (!station.modules) return;
        
        station.modules.forEach((mod: any) => {
            // [兼容性修复] 发现未初始化时，可以直接预先初始化空字典（不报错）
            if (!mod.internalModules) {
                // 判断是否是支持内构的模块，如果无法引入 GameConfig，则先简单给个 {}
                mod.internalModules = {};
            }

            if (mod.internalModules) {
                Object.entries(mod.internalModules).forEach(([slotId, internal]: [string, any]) => {
                    if (internal) {
                        pool.push({
                            stationUid: station.uid,
                            moduleId: mod.moduleId,
                            slotId: slotId,
                            internal: internal
                        });
                    }
                });
            }
        });
    });
    
    return pool;
}
