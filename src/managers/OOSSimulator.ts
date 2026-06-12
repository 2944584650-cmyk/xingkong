import { updateTravel } from './oos/OOS-Travel.js';
import { updateBuildingOOS } from './oos/OOS-Building.js';

/**
 * OOSSimulator (Out-Of-Sector Simulator)
 * 
 * 专门负责处理玩家视野外（活跃星区外）所有飞船和设施的“抽象后台推演”。
 * 职责包括：
 * 1. 后台跨星系跃迁进度的推进
 * 2. 后台建筑队列和虚影下水的推进
 */
export class OOSSimulator {
    private static lastLogTime = 0;
    private static debugShips: any = {};

    /**
     * 全局后台宏观状态更新入口
     * 可供管理世界状态的地方定时调用
     */
    static updateGlobalOOS(worldState: any, dt: number) {
        updateBuildingOOS(worldState, dt);
    }

    // OOSSimulator 中针对单一飞船的冗余推演代码已经被删除
    // 目前所有的物理演算 (包括 OOS 状态下的 DPS 战斗和血量判定) 都已经统一整合到了 Base.ts 中。
    // 而关于星图赶路跃迁进度的推进，也已经被统筹交由 OOS-Travel.ts 的 updateTravel 函数接管。
}
