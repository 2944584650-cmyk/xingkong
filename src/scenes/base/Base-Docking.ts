import { ShipManager } from '../../managers/ShipManager.js';
import { PlayerManager } from '../../managers/PlayerManager.js';
import { EventBus, GameEvents } from '../../utils/EventBus.js';

/**
 * 停泊吸附判定系统 (通用)
 * 检查微观实体是否满足停靠到引导目标的条件，若满足则强制吸附
 * @param ent 微观飞船实体
 * @returns 是否吸附成功
 */
export function checkDockingGuidance(ent: any): boolean {
    if (ent.dockingGuidanceTarget && !ent.isDocked) {
        const dockTarget = ent.dockingGuidanceTarget;
        const dx = dockTarget.worldX - ent.x;
        const dy = dockTarget.worldY - ent.y;
        const dist = Math.hypot(dx, dy);
        
        // 计算角度差
        let angleDiff = dockTarget.entryAngle - (ent.rotation || 0);
        angleDiff = Math.abs(((angleDiff + 180) % 360 + 360) % 360 - 180);

        // 增加调试信息，输出当前检测的距离和角度，以及目标坐标与玩家实际坐标
        // 缩小最终锁死入库的阈值，要求极为精准
        if (dist < 5 && angleDiff < 5) {
            // [触发吸附]
            ent.x = dockTarget.worldX;
            ent.y = dockTarget.worldY;
            ent.rotation = dockTarget.entryAngle;
            ent.vx = 0;
            ent.vy = 0;
            ent.isDocked = true; // 微观层标记为已停泊
            
            // 清理辅助变量
            delete ent.lastDockingRotation;
            ent.isAutoDocking = false;
            
            // 清理近距离吸附带来的锁死变量
            ent.dockingLookOverride = null;
            ent.dockingStrafeDx = 0;
            ent.dockingStrafeDy = 0;

            // 挂靠到对应建筑，彻底转为宏观停泊状态
            ShipManager.dockShip(ent.id, dockTarget.targetId, dockTarget.berthId);

            // 更新注册表状态为已停靠 (兼容旧代码)
            if (berthRegistry[ent.id]) {
                berthRegistry[ent.id].status = 'DOCKED';
            }

            // 推进飞船的任务栈：如果当前是停泊任务，则完成它
            if (ent.shipRef && ent.shipRef.taskStack && ent.shipRef.taskStack.length > 0) {
                const currentTask = ent.shipRef.taskStack[0];
                if (currentTask.action === 'DOCK_AT_STATION') {
                    console.log(`[停靠物理系统] 飞船 ${ent.shipRef.name} 物理吸附停靠完成，弹出任务 DOCK_AT_STATION`);
                    ent.shipRef.taskStack.shift();
                }
            }

            // 通知 RadarScene 和 UI 引导完成
            document.dispatchEvent(new CustomEvent('ui_docking_completed', { detail: { shipId: ent.id, targetId: dockTarget.targetId } }));
            EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:#00ffaa;">[系统] 自动停泊程序执行完毕。舰船已成功接入端口。</div>` }));

            ent.dockingGuidanceTarget = null;
            // 注意：不要返回 true 中断物理循环，否则会导致该实体被当作安全脱离而移出内存！
            // 这里我们只做状态标记和 UI 通知。
            return false;
        } else {
             // 自动吸附逻辑 (物理强制牵引)
             // 只有当玩家手动操作飞船非常接近泊位且角度大致对准时，才触发强制吸附
             if (dist < 20 && angleDiff < 15) {
                 ent.isAutoDocking = true; // 标记正在自动停靠
                 
                 // 强制覆盖速度，接管操作，抵消玩家的物理移动
                 ent.vx = 0;
                 ent.vy = 0;

                 // 1. 位置平滑牵引：速度大幅调小，使得吸附过程拉长到 2-3 秒
                 const autoDockSpeed = 3; 
                 const dt = 0.05; // 约一帧时间
                 
                 if (dist < autoDockSpeed * dt) {
                     ent.x = dockTarget.worldX;
                     ent.y = dockTarget.worldY;
                 } else {
                     const angleToTarget = Math.atan2(dy, dx);
                     ent.x += Math.cos(angleToTarget) * autoDockSpeed * dt;
                     ent.y += Math.sin(angleToTarget) * autoDockSpeed * dt;
                 }
                 
                 // 2. 角度平滑对齐：接管并无视玩家当前的鼠标输入
                 let tAngle = dockTarget.entryAngle;
                 
                 // 使用 lastDockingRotation 绕开玩家实时覆盖的 ent.rotation
                 if (ent.lastDockingRotation === undefined) {
                     ent.lastDockingRotation = ent.rotation || 0;
                 }
                 
                 let diff = tAngle - ent.lastDockingRotation;
                 diff = ((diff + 180) % 360 + 360) % 360 - 180;
                 
                 // 平滑插值，减慢旋转速度以匹配较慢的移动
                 ent.lastDockingRotation += diff * 0.02; 
                 // 强制覆盖飞船实际朝向
                 ent.rotation = ent.lastDockingRotation;
             } else {
                 // 不在牵引范围内，取消控制接管
                 ent.isAutoDocking = false;
                 delete ent.lastDockingRotation;
             }
        }
    }
    return false;
}

/**
 * 停泊系统 4.0: 港务局后台调度
 * 遍历当前星区所有已停泊的飞船，取消了基于 dockTimer 的自动踢出机制。
 * 现在所有舰船进港后都永久停靠，直到接收到新的外部指令(如贸易寻路)主动离港。
 * @param currentSectorName 当前星区名
 */
export function processMacroDockingQueue(currentSectorName: string) {
    // 自动踢出机制已被移除。
    // 如果后续需要添加新的离开条件算法，可以在此处编写。
}

import { BuildingManager, GRID_PIXEL_SIZE } from '../../managers/BuildingManager.js';
import { GameConfig } from '../../config.js';

// 旧版记录表保留用于向下兼容某些 UI
export const berthRegistry: Record<string, { moduleId: string, berthId: string, status: string }> = {};
(window as any).BerthRegistry = berthRegistry;

// 核心分配逻辑已移交 ShipManager.allocateDockingBerth
export function allocateDockingBerth(moduleId: string, shipId: string): string | null {
    const berthId = (ShipManager as any).allocateDockingBerth(moduleId, shipId);
    if (berthId) {
        berthRegistry[shipId] = {
            moduleId: moduleId,
            berthId: berthId,
            status: 'APPROACHING'
        };
    }
    return berthId;
}

/**
 * 接收 UI 终端的停靠申请
 * @param e 事件对象
 */
export function debugDockingStatus(sectorName: string) {
    console.warn(`\n[调试] 正在检测星区【${sectorName}】的所有泊区状态...`);
    console.log("当前泊位全局注册表字典:", berthRegistry);
    const allModules = BuildingManager.getAllModules();
    if (!allModules) {
        console.warn("未能获取到 BuildingManager 模块数据。");
        return;
    }

    let report = [];
    const stats: Record<string, { total: number, free: number }> = {};

    allModules.forEach((mod: any) => {
        // 读取游戏配置表
        const modData = (GameConfig as any).MODULES[mod.moduleId];
        if (!modData || !modData.berths || modData.berths.length === 0) return;

        const maxBerths = modData.berths.length;
        const dockedShips = ShipManager.ships.filter((s: any) => s.dockedAt === mod.uid) || [];
        
        // 查找异常数据：停泊的飞船有没有泊位 ID，或者泊位 ID 是不是重复的
        const occupiedBerthIds = dockedShips.map((s: any) => s.dockedBerthId).filter((id: any) => id != null);
        const freeBerths = maxBerths - occupiedBerthIds.length;

        // 更新汇总统计
        if (!stats[mod.moduleId]) stats[mod.moduleId] = { total: 0, free: 0 };
        stats[mod.moduleId].total += maxBerths;
        stats[mod.moduleId].free += freeBerths;

        // 详细记录当前模块
        let details = `  - 模块UID: ${mod.uid} (${modData.name || mod.moduleId})\n`;
        details += `  - 设计总泊位: ${maxBerths} | 当前剩余空闲: ${freeBerths}\n`;
        
        if (dockedShips.length > 0) {
            details += `  - 当前在港飞船:\n`;
            dockedShips.forEach((s: any) => {
                details += `      > 飞船[${s.id}](${s.name || s.type}) - 占用泊位ID: ${s.dockedBerthId || '【异常：无分配泊位】'}\n`;
            });

            // 交叉验证异常情况
            const idCounts = occupiedBerthIds.reduce((acc: Record<string, number>, id: string) => {
                acc[id] = (acc[id] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            for (const [id, count] of Object.entries(idCounts)) {
                if ((count as number) > 1) {
                    details += `      > 🚨 警告：泊位 ${id} 被多艘 (${count}) 飞船同时占用！\n`;
                }
                const isValidId = modData.berths.some((b: any) => b.id === id);
                if (!isValidId) {
                    details += `      > 🚨 警告：泊位 ${id} 根本不存在于此模块的设计图纸中！\n`;
                }
            }
        } else {
            details += `  - 当前无飞船在港。\n`;
        }
        
        report.push(details);
    });

    if (report.length === 0) {
        console.log("该星区内没有发现带有泊位的模块。");
    } else {
        report.forEach(r => console.log(r));
        console.warn("\n==== 泊位资源汇总 ====");
        for (const [type, data] of Object.entries(stats)) {
            console.log(`型号 [${type}]: 共计 ${data.total} 个泊位，剩余 ${data.free} 个空位`);
        }
    }
    console.warn("==============================\n");
}

export function handleApplyDocking(e: any) {
    console.log("【调试】收到停靠申请事件 ui_apply_docking", e.detail);

    const detail = e.detail;
    let moduleId = detail.moduleId || 'station';
    
    // 如果指定了舰船 ID，则为该舰船申请；否则默认是玩家座驾
    let targetShipId = detail.shipId;
    const pd = PlayerManager.getStats();
    
    if (!targetShipId) {
        if (!pd || !pd.playerShipId) {
            EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:red;">[系统] 无法申请停靠：未检测到有效座驾。</div>` }));
            return;
        }
        targetShipId = pd.playerShipId;
    }
    
    const ship = ShipManager.getShipById(targetShipId);
    if (!ship) {
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:red;">[系统] 无法申请停靠：舰船 [${targetShipId}] 数据异常。</div>` }));
        return;
    }
    
    if (ship.dockedAt) {
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:yellow;">[系统] 舰船 [${ship.name || ship.id}] 已经处于停泊状态。</div>` }));
        return;
    }
    
    // 重新修正 moduleId 以匹配实际带泊位的建筑模块 UID (兼容 'station' fallback)
    let actualMod = BuildingManager.getAllModules().find(m => m.uid === moduleId);
    if (!actualMod || !((GameConfig as any).MODULES[actualMod.moduleId]?.berths?.length > 0)) {
        actualMod = BuildingManager.getAllModules().find(m => {
            const data = (GameConfig as any).MODULES[m.moduleId];
            return data && data.berths && data.berths.length > 0;
        });
    }
    if (actualMod) {
        moduleId = actualMod.uid;
    }

    // 检查是否有空闲泊位
    const freeBerthId = allocateDockingBerth(moduleId, ship.id);
    if (!freeBerthId) {
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:red;">[港务局] 停靠申请被驳回：目标泊区已满，无空闲泊位。</div>` }));
        return;
    }

    // 分配成功，预记录
    (ship as any).dockedBerthId = freeBerthId;

    // 假设符合条件，打印日志
    EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:#00ffff;">[港务局] 收到舰船 [${ship.name || ship.id}] 的停靠申请，已分配泊位 [${freeBerthId}]。引导协议启动。</div>` }));
    
    // --- 计算泊位在世界坐标系中的绝对位置和角度 ---
    let berthWorldX = 0;
    let berthWorldY = 0;
    let entryAngle = 0;
    let hullId = ship.hullId || ship.type || 'fighter';

    const mod = BuildingManager.getAllModules().find(m => m.uid === moduleId);
    if (mod) {
        const modData = (GameConfig as any).MODULES[mod.moduleId];
        if (modData && modData.berths) {
            const berth = modData.berths.find((b: any) => b.id === freeBerthId);
            if (berth) {
                // 网格转世界坐标
                const worldPos = BuildingManager.gridToWorld(mod.gridX, mod.gridY);
                // 使用真正的 GRID_PIXEL_SIZE 进行换算
                const w = mod.width * GRID_PIXEL_SIZE;
                const h = mod.height * GRID_PIXEL_SIZE;
                let drawX = worldPos.x + w / 2;
                let drawY = worldPos.y + h / 2;
                let scale = 1; // 记录缩放比例

                const rotation = mod.rotation || 0;

                // --- 同步 RadarScene 中的对齐逻辑 ---
                if (modData.connectRule) {
                    const isRotated = rotation % 180 !== 0;
                    // 读取模块贴图定义的宽高
                    const spriteOrigW = modData.spriteSize ? modData.spriteSize.width : w;
                    const spriteOrigH = modData.spriteSize ? modData.spriteSize.height : h;
                    
                    const visualOrigW = isRotated ? spriteOrigH : spriteOrigW;
                    const visualOrigH = isRotated ? spriteOrigW : spriteOrigH;

                    scale = Math.min(w / visualOrigW, h / visualOrigH);
                    const actualW = visualOrigW * scale;
                    const actualH = visualOrigH * scale;

                    let effectiveRule = { ...modData.connectRule };
                    if (rotation === 90) {
                        effectiveRule = { up: modData.connectRule.left, right: modData.connectRule.up, down: modData.connectRule.right, left: modData.connectRule.down };
                    } else if (rotation === 180) {
                        effectiveRule = { up: modData.connectRule.down, right: modData.connectRule.left, down: modData.connectRule.up, left: modData.connectRule.right };
                    } else if (rotation === 270) {
                        effectiveRule = { up: modData.connectRule.right, right: modData.connectRule.down, down: modData.connectRule.left, left: modData.connectRule.up };
                    }

                    if (effectiveRule.left === "port") {
                        drawX = worldPos.x + actualW / 2;
                    } else if (effectiveRule.right === "port") {
                        drawX = worldPos.x + w - actualW / 2;
                    }
                    
                    if (effectiveRule.up === "port") {
                        drawY = worldPos.y + actualH / 2;
                    } else if (effectiveRule.down === "port") {
                        drawY = worldPos.y + h - actualH / 2;
                    }
                }

                const rad = rotation * Math.PI / 180;
                // 将相对原图的 offset 乘以缩放比例 scale，映射到网格实际尺寸上
                const ox = berth.offset.x * scale;
                const oy = berth.offset.y * scale;

                // 旋转偏移量
                const rotatedOffsetX = ox * Math.cos(rad) - oy * Math.sin(rad);
                const rotatedOffsetY = ox * Math.sin(rad) + oy * Math.cos(rad);

                berthWorldX = drawX + rotatedOffsetX;
                berthWorldY = drawY + rotatedOffsetY;
                
                // 计算进入角度 (停泊虚影的朝向)，模块自身的旋转也会影响进场角度
                entryAngle = (berth.entryAngle + rotation) % 360;
            }
        }
    }

    // 调度自动驾驶目标 (传递 berthId 给自动驾驶AI，后续AI可以根据berth的坐标进行精确导航)
    // 将计算好的世界坐标与朝向也一并派发给 RadarScene 做特效渲染
    document.dispatchEvent(new CustomEvent('ui_select_docking_target', { 
        detail: { 
            targetId: moduleId, 
            berthId: freeBerthId,
            worldX: berthWorldX,
            worldY: berthWorldY,
            entryAngle: entryAngle,
            hullId: hullId,
            shipId: ship.id // 直接传飞船的真实验明正身的 ID
        } 
    }));
}
