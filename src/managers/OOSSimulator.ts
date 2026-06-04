import { updateCombatAndMove } from './oos/OOS-Movement.js';
import { updateTravel } from './oos/OOS-Travel.js';
import { updateBuildingOOS } from './oos/OOS-Building.js';

/**
 * OOSSimulator (Out-Of-Sector Simulator)
 * 
 * 专门负责处理玩家视野外（活跃星区外）所有飞船和设施的“抽象后台推演”。
 * 职责包括：
 * 1. 后台飞船的坐标更新（无物理碰撞的纯数学运动）
 * 2. 后台跨星系跃迁进度的推进
 * 3. 后台舰队之间的纯数值对战结算
 * 4. 后台建筑队列和虚影下水的推进
 */
export class OOSSimulator {
    /**
     * 全局后台宏观状态更新入口
     * 可供管理世界状态的地方定时调用
     */
    static updateGlobalOOS(worldState: any, dt: number) {
        updateBuildingOOS(worldState, dt);
    }

    /**
     * 主更新入口：处理一艘在后台的飞船
     * 由 ShipManager 的 update() 循环调用
     */
    static updateShipOOS(ship: any, dt: number, worldState: any, allShips: any[]) {
        // 如果正在停泊，不进行任何位移或战斗推演
        if (ship.state === 'DOCKED') return;

        // 如果是闲置状态，执行巡航与找打架逻辑
        if (ship.state === 'IDLE') {
            updateCombatAndMove(ship, dt, allShips);
        }
        
        // 赶路/跃迁等状态通过 travel 统筹
        if (['DEPARTURE', 'WARP', 'TRANSIT', 'ARRIVAL'].includes(ship.state)) {
            updateTravel(ship, dt, worldState);
        }
    }
}
