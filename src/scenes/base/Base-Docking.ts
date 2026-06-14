import { ShipManager } from '../../managers/ShipManager.js';
import { PlayerManager } from '../../managers/PlayerManager.js';
import { EventBus, GameEvents } from '../../utils/EventBus.js';

// 监听港务局超时的事件，清空被占用的泊位
document.addEventListener('ui_docking_timeout', (e: any) => {
    const { shipId } = e.detail;
    if (shipId && berthRegistry[shipId]) {
        // console.log(`[Base-Docking] 收到超时事件，清空飞船 ${shipId} 的占位记录`);
        delete berthRegistry[shipId];
        
        // 尝试从 ShipManager 的内存属性中抹除预分配记录
        const ship = ShipManager.getShipById(shipId);
        if (ship && (ship as any).dockedBerthId) {
            delete (ship as any).dockedBerthId;
        }
    }
});

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
                    // console.log(`[停靠物理系统] 飞船 ${ent.shipRef.name} 物理吸附停靠完成。不在此处越权 shift，交由 ShipDecision 处理。`);
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
import { UniverseEngine } from '../../managers/engine/UniverseEngine.js';

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
    // console.log("当前泊位全局注册表字典:", berthRegistry);
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
        // console.log("该星区内没有发现带有泊位的模块。");
    } else {
        // report.forEach(r => console.log(r));
        console.warn("\n==== 泊位资源汇总 ====");
        for (const [type, data] of Object.entries(stats)) {
            // console.log(`型号 [${type}]: 共计 ${data.total} 个泊位，剩余 ${data.free} 个空位`);
        }
    }
    console.warn("==============================\n");
}

export function handleApplyDocking(e: any) {
    // console.log("【调试】收到停靠申请事件 ui_apply_docking", e.detail);

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
    // 【核心修复】如果飞船发来了泛泛的 'station' 请求，我们需要在它所在的星区找泊位，而不是在玩家正看着的星区找！
    const shipSector = ship.location?.sector || '未知星区';
    
    // 如果指名道姓要某个具体的 uid，我们就先假设这是对的
    let actualModUid = moduleId !== 'station' ? moduleId : null;

    if (!actualModUid || !((UniverseEngine as any).spatialRegistry?.get(actualModUid)?.berths)) {
        // 如果它没指名道姓，或者指名的那个模块在注册表里没找到泊位，我们就必须后台遍历世界找一个给它
        let worldState = null;
        try {
            const wbSaved = localStorage.getItem('world_state');
            if (wbSaved) worldState = JSON.parse(wbSaved);
        } catch(e) {}
        
        let foundFallback = false;
        if (worldState && worldState.stations) {
            for (const st of worldState.stations) {
                // 必须在飞船同一个星区找
                if (st.sector !== shipSector) continue;
                
                for (const mod of st.modules) {
                    const modData = (GameConfig as any).MODULES[mod.moduleId];
                    if (modData && modData.berths && modData.berths.length > 0) {
                        actualModUid = mod.uid;
                        foundFallback = true;
                        break;
                    }
                }
                if (foundFallback) break;
            }
        }
        
        // 如果实在找不到，只能回退看当前场景里有没有（这其实就是以前引发 bug 的旧逻辑，权当保底）
        if (!actualModUid) {
            const localFallback = BuildingManager.getAllModules().find(m => {
                const data = (GameConfig as any).MODULES[m.moduleId];
                return data && data.berths && data.berths.length > 0;
            });
            if (localFallback) actualModUid = localFallback.uid;
        }
    }

    if (actualModUid) {
        moduleId = actualModUid;
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
    
    let hullId = ship.hullId || ship.type || 'fighter';
    const currentSector = (ship.location && ship.location.sector) ? ship.location.sector : (localStorage.getItem('current_sector') || '翡翠生态穹顶');

    // --- 将绝对坐标计算交由底层 OOS 引擎 / 数据流负责，我们只需要触发一个申请事件，引擎自然会给船赋值 ---
    // （虽然在这里算也行，但我们现在把它直接写入 ship 的指导数据中，不再依赖 RadarScene）
    // 为了平滑过渡，我们暂时把之前的计算方法提炼后直接赋值给船，或者通知 ShipDecision
    
    // ... 但是由于这里本来就是 Base-Docking 的全局处理函数，
    // 我们在此处算出来的结果，应该直接写进 ShipManager 中的 ship.dockingGuidanceTarget 属性，
    // 而不再仅仅只传给前端去画 UI 虚影！
    
    // --- 【重构更新】抛弃本地冗长的坐标计算逻辑，全面改用 Universal API (空间注册表) ---
    const transform = UniverseEngine.getDockingTransform(moduleId, freeBerthId);

    if (!transform) {
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:red;">[系统] 无法解析目标泊位的物理坐标，注册表中不存在。</div>` }));
        // 回退清理状态
        delete (ship as any).dockedBerthId;
        if (berthRegistry[ship.id]) delete berthRegistry[ship.id];
        return;
    }

    const berthWorldX = transform.worldX;
    const berthWorldY = transform.worldY;
    const entryAngle = transform.entryAngle;
    const sourceOfCoordinates = `宇宙引擎空间注册表 (UniverseEngine)`;

    // 核心修改点：将引导目标绝对坐标强行写入宏观飞船实体
    // 这样即便玩家不在场 (OOS)，ShipDecision也能在后台读到坐标并引导其飞过去
    (ship as any).dockingGuidanceTarget = {
        targetId: moduleId,
        berthId: freeBerthId,
        worldX: berthWorldX,
        worldY: berthWorldY,
        entryAngle: entryAngle,
        timestamp: Date.now() // 记录分配时间，超时后可主动清除
    };

    // --- 调试信息优化：对比模块自身的坐标与注册表中的坐标 ---
    // 获取注册表内的记录用于对比
    const registryEntry = (UniverseEngine as any).spatialRegistry?.get(moduleId);
    
    // 尝试找出模块原本的记录
    let actualModSector = '未知';
    let actualModWorldX = 0;
    let actualModWorldY = 0;
    
    let worldState = null;
    try {
        const wbSaved = localStorage.getItem('world_state');
        if (wbSaved) worldState = JSON.parse(wbSaved);
    } catch(e) {}
    
    if (worldState && worldState.stations) {
        for (const st of worldState.stations) {
            const found = st.modules.find((m: any) => m.uid === moduleId);
            if (found) {
                actualModSector = st.sector;
                const baseGridX = Math.floor((st.worldX || 0) / GRID_PIXEL_SIZE);
                const baseGridY = Math.floor((st.worldY || 0) / GRID_PIXEL_SIZE);
                const parentStationX = baseGridX * GRID_PIXEL_SIZE;
                const parentStationY = baseGridY * GRID_PIXEL_SIZE;
                actualModWorldX = parentStationX + found.gridX * GRID_PIXEL_SIZE;
                actualModWorldY = parentStationY + found.gridY * GRID_PIXEL_SIZE;
                break;
            }
        }
    }

    console.warn(`[Base-Docking] 飞船 [${ship.name || ship.id}] (所在星区: ${shipSector}) 正在停泊 -> 目标模块: ${moduleId}`);
    
    if (registryEntry) {
        console.warn(`  ↳ 【对比1】注册表中该模块信息 -> 星区: ${registryEntry.sector} | 中心坐标 X: ${registryEntry.worldX.toFixed(2)}, Y: ${registryEntry.worldY.toFixed(2)}`);
    } else {
        console.warn(`  ↳ 【对比1】注册表中该模块信息 -> 🚨 缺失!`);
    }
    
    console.warn(`  ↳ 【对比2】模块真实设定信息   -> 星区: ${actualModSector} | 网格推算 X: ${actualModWorldX.toFixed(2)}, Y: ${actualModWorldY.toFixed(2)}`);
    
    console.warn(`  ↳ 【对比3】飞船(货船)认为自己应该停泊的坐标 -> X: ${berthWorldX.toFixed(2)}, Y: ${berthWorldY.toFixed(2)} (泊位: ${freeBerthId})`);
    
    // 对比4：如果此时在全局有这个建筑节点，看看这个建筑的泊位实际上在哪（用于彻底揭露“找错建筑”的问题）
    // 注意：getAllModules 默认返回全部模块（如果不传参数的话），所以这里要找对应 moduleId 应该是能找到的。
    let localMod = BuildingManager.getAllModules().find(m => m.uid === moduleId);
    if (localMod) {
        let modData = (GameConfig as any).MODULES[localMod.moduleId];
        if (modData && modData.berths) {
            let b = modData.berths.find((bb:any) => bb.id === freeBerthId);
            if (b) {
                // 本地数据存储的是网格坐标 (gridX, gridY)，由于此处无法直接获取 parentStationX/Y，我们用已知的 actualModWorldX 替代
                const localWorldX = actualModWorldX;
                const localWorldY = actualModWorldY;
                
                console.warn(`  ↳ 【对比4】本地渲染节点/理论推算所指引的该泊位坐标 -> X: ${(localWorldX + b.offset.x).toFixed(2)}, Y: ${(localWorldY + b.offset.y).toFixed(2)}`);
            } else {
                console.warn(`  ↳ 【对比4】本地渲染节点有这个建筑，但没找到对应泊位 ID`);
            }
        }
    } else {
        console.warn(`  ↳ 【对比4】全宇宙内存缓存中，找不到该模块的数据 (可能未初始化或跨星区加载失败)`);
    }
    // 保留事件派发：让 RadarScene 在玩家在场时能捕捉并画出绿色指引线
    document.dispatchEvent(new CustomEvent('ui_select_docking_target', { 
        detail: { 
            targetId: moduleId, 
            berthId: freeBerthId,
            worldX: berthWorldX,
            worldY: berthWorldY,
            entryAngle: entryAngle,
            hullId: hullId,
            shipId: ship.id, // 直接传飞船的真实验明正身的 ID
            sector: currentSector, // 附加当前发出指令的星区信息，避免跨星区渲染引导线
            timestamp: Date.now() // 记录发起时间，用于后续超时清理
        } 
    }));
}
