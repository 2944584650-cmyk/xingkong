

import { EventBus, GameEvents } from '../../utils/EventBus.js';
import { PlayerManager } from '../../managers/PlayerManager.js';
import { ShipManager } from '../../managers/ShipManager.js';
import { WorldbookManager } from '../WorldbookManager.js';

/**
 * 处理舰队相关的 UI 指令并下发给宏观或微观舰船
 * @param {Array} selectedUnitIds 当前选中的实体 ID 数组
 * @param {Object} detail 事件详情 (如 x, y, targetId)
 * @param {string} type 指令类型 (GameEvents.CMD_MOVE, GameEvents.CMD_ATTACK 等)
 * @param {Object} context 包含 Base 场景的一些必要环境引用 (如 viewingSector, sectorSimulations, showRTSFeedback 方法)
 */
export function handleFleetCommand(selectedUnitIds, detail, type, context) {
    if (!selectedUnitIds || selectedUnitIds.length === 0) {
        return;
    }

    if (type === GameEvents.CMD_DOCK) {
        const pd = PlayerManager.getStats();
        const validUnitIds = [];
        
        if (pd.ownedShips) {
            selectedUnitIds.forEach(id => {
                if (pd.ownedShips.some(s => s.id === id) && id !== pd.playerShipId) {
                    validUnitIds.push(id);
                }
            });
        }

        if (validUnitIds.length === 0) return;

        validUnitIds.forEach((unitId, index) => {
            const targetShip = ShipManager.getShipById(unitId);
            if (!targetShip) return;

            // 设置命令状态，让微观AI接管去飞向泊位
            targetShip.commandState = 'DOCK';
            targetShip.commandTargetId = detail.targetId; // 这个是目标建筑/泊区的 UID
            
            // 模拟派发停靠申请事件，让底层系统去计算泊位分配并返回坐标
            document.dispatchEvent(new CustomEvent('ui_apply_docking', {
                detail: {
                    moduleId: detail.targetId,
                    shipId: unitId
                }
            }));

            if (index === 0) {
                if (context && typeof context.showRTSFeedback === 'function') {
                    context.showRTSFeedback(null, detail.x || targetShip.location.x, detail.y || targetShip.location.y, '#00ffaa', '申请停靠');
                }
                // console.log(`[战术调试] 指令已发送：要求舰队单位自动停靠至目标端口。`);
            }
        });
        return;
    }
    
    if (!selectedUnitIds || selectedUnitIds.length === 0) {
        if (type !== GameEvents.OPEN_TEXT_ADVENTURE) {
            // console.log(`[战术调试] 无法执行指令：请先左键点击或框选你的舰队单位！`);
        }
        return;
    }
    
    const pd = PlayerManager.getStats();
    const validUnitIds = [];
    
    // 指令可以下达给玩家拥有的任意飞船，不一定要和玩家在同一个舰队
    if (pd.ownedShips) {
        selectedUnitIds.forEach(id => {
            if (pd.ownedShips.some(s => s.id === id) && id !== pd.playerShipId) {
                validUnitIds.push(id);
            }
        });
    }
    
    if (validUnitIds.length === 0) {
        // console.log(`[战术调试] 无法执行指令：选中的目标中没有可接受指令的单位！`);
        return;
    }

    // 计算多单位移动时的阵型偏移
    const formationRadius = Math.max(30, Math.sqrt(validUnitIds.length) * 20);

    validUnitIds.forEach((unitId, index) => {
        const targetShip = ShipManager.getShipById(unitId);
        if (!targetShip) return;

        // 玩家下达新指令时，强制清空旧的 AI 任务队列、路径和动机，避免逻辑打架
        targetShip.orderQueue = [];
        targetShip.taskStack = [];
        targetShip.path = [];
        
        // --- 中断清理：如果有尚未完成的停靠申请，需要释放占用的泊位 ---
        if (targetShip.commandState === 'DOCK' || targetShip.approachingDock) {
            ShipManager.clearDockingGuidance(unitId);
        }
        
        targetShip.commandState = null;
        targetShip.commandTargetId = null;

        // --- 停泊状态拦截与自动出港 ---
        let isDockedOrDocking = false;
        
        let currentSector = localStorage.getItem('current_sector');
        const currentViewSector = context.viewingSector || currentSector;
        const macroSector = context.sectorSimulations[currentViewSector];
        let microEnt = null;
        
        if (macroSector) {
            microEnt = macroSector.defenders.find(s => s.id === unitId) || macroSector.attackers.find(s => s.id === unitId);
            if (microEnt && (microEnt.isAutoDocking || microEnt.isDocked)) {
                isDockedOrDocking = true;
            }
        }
        
        if (targetShip.dockedAt || targetShip.state === 'DOCKED' || targetShip.commandState === 'DOCK') {
            isDockedOrDocking = true;
        }

        if ((type === GameEvents.CMD_MOVE || type === GameEvents.CMD_ATTACK) && isDockedOrDocking) {
            // 如果是在微观层面上处于停泊状态，需要同时解开微观的锁
            if (microEnt) {
                microEnt.isDocked = false;
                microEnt.isAutoDocking = false;
                microEnt.dockingGuidanceTarget = null;
                // 清除物理覆盖变量，防止变成幽灵船
                microEnt.dockingLookOverride = null;
                microEnt.dockingStrafeDx = 0;
                microEnt.dockingStrafeDy = 0;
            }
            
            // 调用宏观的脱离接口
            const spawnX = targetShip.location?.x || (microEnt ? microEnt.x : 500);
            const spawnY = targetShip.location?.y || (microEnt ? microEnt.y : 275);
            const spawnSector = targetShip.location?.sector || currentSector;
            
            ShipManager.undockShip(unitId, { x: spawnX, y: spawnY, sector: spawnSector });
            
            if (index === 0) {
                // console.log(`[战术反馈] 舰船 ${targetShip.name || targetShip.id} 接收到指令，正在自动脱离泊区。`);
                EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { 
                    detail: `<div style="color:#00ffaa;">[系统] 接收到战术指令，舰船已自动脱离停泊端口。</div>` 
                }));
            }
        }

        if (type === GameEvents.CMD_MOVE) {
            if (detail.targetId) {
                targetShip.commandState = 'FOLLOW';
                targetShip.commandTargetId = detail.targetId;
                if (index === 0) { // 只显示一次反馈特效
                    if (context.showRTSFeedback) context.showRTSFeedback(null, detail.x || targetShip.location.x, detail.y || targetShip.location.y, '#00aaff', '跟随目标');
                    // console.log(`[战术调试] 指令已发送：要求舰队跟随目标。目标ID为：${detail.targetId}`);
                }
            } else if (detail.x !== undefined && detail.y !== undefined) {
                // 简单的圆形编队偏移
                let offsetX = 0;
                let offsetY = 0;
                if (validUnitIds.length > 1) {
                    const angle = (index / validUnitIds.length) * Math.PI * 2;
                    const currentRadius = index === 0 ? 0 : formationRadius;
                    offsetX = Math.cos(angle) * currentRadius;
                    offsetY = Math.sin(angle) * currentRadius;
                }

                const targetX = detail.x + offsetX;
                const targetY = detail.y + offsetY;

                let currentSector = localStorage.getItem('current_sector');
                const currentViewSector = context.viewingSector || currentSector;
                
                if (targetShip.location.sector !== currentViewSector) {
                    targetShip.orderQueue = [{ status: 'DEPLOYED', targetSector: currentViewSector }];
                    
                    const ws = WorldbookManager.getWorldState();
                    const startSec = ws.sectors.find(s => s.name === targetShip.location.sector);
                    const endSec = ws.sectors.find(s => s.name === currentViewSector);
                    if (startSec && endSec) {
                        const pathNodes = WorldbookManager.getStarlanePath(startSec, endSec, ws.sectors);
                        if (pathNodes && pathNodes.length > 1) {
                            targetShip.path = pathNodes.map(n => n.name).slice(1);
                            targetShip.state = 'DEPARTURE';
                            targetShip.targetGate = targetShip.path[0];
                            
                            targetShip.commandState = 'MOVE_TO';
                            targetShip.moveTarget = { x: targetX, y: targetY };
                            // console.log(`[调试] 船只 ${targetShip.name} (${targetShip.id}) 得知了跨星系移动目标：${currentViewSector}`);
                        }
                    }
                    
                    if (index === 0) {
                        if (context.showRTSFeedback) context.showRTSFeedback(null, detail.x, detail.y, '#00ff00', '驻防于此');
                        // console.log(`[导航调试] 指令已发送：要求舰队跨星系前往 [${currentViewSector}]。`);
                    }
                } else {
                    targetShip.commandState = 'MOVE_TO';
                    targetShip.moveTarget = { x: targetX, y: targetY };
                    if (!targetShip.orderQueue || targetShip.orderQueue.length === 0 || targetShip.orderQueue[0].status !== 'DEPLOYED') {
                        targetShip.orderQueue = [{ status: 'DEPLOYED', targetSector: currentViewSector }];
                    }
                    
                    // console.log(`[调试] 船只 ${targetShip.name} (${targetShip.id}) 得知了同星系移动目标坐标：X=${targetX.toFixed(2)}, Y=${targetY.toFixed(2)}`);
                    
                    const macroSector = context.sectorSimulations[currentViewSector];
                    if (macroSector) {
                        let microEnt = macroSector.defenders.find(s => s.id === unitId) || macroSector.attackers.find(s => s.id === unitId);
                        if (microEnt) microEnt.moveTarget = { x: targetX, y: targetY };
                    }
                    
                    if (index === 0) {
                        if (context.showRTSFeedback) context.showRTSFeedback(null, detail.x, detail.y, '#00ff00', '移动到此');
                        // console.log(`[战术调试] 指令已发送：要求舰队前往指定坐标。`);
                    }
                }
            }
        } else if (type === GameEvents.CMD_ATTACK) {
            if (detail.targetId) {
                targetShip.commandState = 'ATTACK_TARGET';
                
                let currentSector = localStorage.getItem('current_sector');
                const currentViewSector = context.viewingSector || currentSector;
                const macroSector = context.sectorSimulations[currentViewSector];
                let enemyX = 0; let enemyY = 0;
                if (macroSector) {
                    let microEnt = macroSector.defenders.find(s => s.id === unitId) || macroSector.attackers.find(s => s.id === unitId);
                    let enemyEnt = macroSector.defenders.find(s => s.id === detail.targetId) || macroSector.attackers.find(s => s.id === detail.targetId);
                    if (microEnt && enemyEnt) {
                        microEnt.target = enemyEnt;
                        enemyX = enemyEnt.x; enemyY = enemyEnt.y;
                    }
                }
                if (index === 0) {
                    if (context.showRTSFeedback) context.showRTSFeedback(null, enemyX, enemyY, '#ff0000', '集火目标');
                    // console.log(`[战术调试] 指令已发送：要求舰队集火指定目标！`);
                }
            }
        }
    });
}
