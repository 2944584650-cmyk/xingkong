import { WorldbookManager } from '../../../scenes/WorldbookManager.js';
import { triggerWarp, updateTravel } from '../../oos/OOS-Travel.js';

export class NavigationSystem {
    /**
     * 处理宏观宇宙中的飞船移动、超空间飞行进度以及星门接触判定
     */
    static update(ship: any, dt: number, worldState: any) {
        // 1. 处理已经在超空间通道内的进度
        if (ship.state === 'WARP' || ship.state === 'ARRIVAL') {
            updateTravel(ship, dt, worldState);
            return;
        }

        // 2. 如果正在前往星门，执行物理级别的距离判定
        if (ship.state === 'DEPARTURE' || ship.state === 'TRANSIT') {
            const targetGate = ship.state === 'DEPARTURE' ? ship.targetGate : ship.transitToGate;
            if (!targetGate) return;

            // 获取该星系内的星门坐标
            const gatePos = this.getGatePositionInSector(ship.location.sector, targetGate, worldState);
            if (!gatePos) return;

            const dist = Math.hypot(ship.location.x - gatePos.x, ship.location.y - gatePos.y);

            // 如果距离足够近，触发跃迁
            // 玩家由 Base.ts 物理撞门处理，这里只处理 AI/OOS 商船
            if (dist < 800) {
                // 如果是玩家自己的船，且它正在被微观雷达控制，我们不要在这里替他跃迁
                const pdStr = localStorage.getItem('player_ship_id');
                if (ship.ownerId === 'player' && ship.id === pdStr) {
                    return; 
                }

                // AI 飞船抵达星门，进入 WARP 状态
                triggerWarp(ship, targetGate, worldState);
            }
        }
    }

    /**
     * 根据连线数据计算某个星系内通往目标星系的星门坐标
     */
    private static getGatePositionInSector(currentSectorName: string, targetSectorName: string, worldState: any) {
        const sector = worldState.sectors.find((s: any) => s.name === currentSectorName);
        const target = worldState.sectors.find((s: any) => s.name === targetSectorName);
        if (!sector || !target) return null;
        
        const angle = Math.atan2(target.y - sector.y, target.x - sector.x);
        const gateRadius = 450; // 与 OOS-Travel 中定义的保持一致
        return {
            x: 500 + Math.cos(angle) * gateRadius,
            y: 275 + Math.sin(angle) * gateRadius
        };
    }
}
