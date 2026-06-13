import { BuildingManager } from '../BuildingManager';

export class InternalModuleManager {
    /**
     * 安装内置小型建筑/模块到指定槽位
     */
    static installInternalModule(stationUid: string, slotIndex: number, internalModuleId: string) {
        // console.log(`[InternalModuleManager] 准备安装模块 -> stationUid: ${stationUid}, slotIndex: ${slotIndex}, internalModuleId: ${internalModuleId}`);
        const targetMod = BuildingManager.stationModules.find(m => m.uid === stationUid || m.stationUid === stationUid && m.moduleId.startsWith('core_'));
        if (!targetMod) {
            console.error(`[InternalModuleManager] installInternalModule: 找不到目标空间站或核心模块 (stationUid: ${stationUid})`);
            // console.log(`[InternalModuleManager] 当前内存中的模块:`, BuildingManager.stationModules.map(m => ({ uid: m.uid, stationUid: m.stationUid, moduleId: m.moduleId })));
            return false;
        }

        if (!targetMod.internalModules) {
            console.warn(`[InternalModuleManager] installInternalModule: 目标模块没有预初始化的 internalModules，正尝试创建。 (stationUid: ${stationUid})`);
            targetMod.internalModules = {};
        }

        targetMod.internalModules[slotIndex] = { id: internalModuleId, progress: 0 };
        BuildingManager.save();
        // console.log(`[InternalModuleManager] 成功在 ${targetMod.uid} 的槽位 ${slotIndex} 安装内置模块 ${internalModuleId}`);
        return true;
    }

    /**
     * 卸载内置小型建筑/模块
     */
    static uninstallInternalModule(stationUid: string, slotIndex: number) {
        // console.log(`[InternalModuleManager] 准备卸载模块 -> stationUid: ${stationUid}, slotIndex: ${slotIndex}`);
        const targetMod = BuildingManager.stationModules.find(m => m.uid === stationUid || m.stationUid === stationUid && m.moduleId.startsWith('core_'));
        if (!targetMod || !targetMod.internalModules || targetMod.internalModules[slotIndex] === undefined) {
            console.warn(`[InternalModuleManager] uninstallInternalModule: 槽位不存在或找不到目标 (stationUid: ${stationUid})`);
            return false;
        }

        targetMod.internalModules[slotIndex] = null;
        BuildingManager.save();
        // console.log(`[InternalModuleManager] 成功卸载 ${targetMod.uid} 的槽位 ${slotIndex} 的内置模块`);
        return true;
    }
}
