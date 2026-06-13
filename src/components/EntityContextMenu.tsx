import React, { useEffect, useState } from 'react';
import { EventBus, GameEvents } from '../utils/EventBus';
import { ShipManager } from '../managers/ShipManager';
import { BuildingManager } from '../managers/BuildingManager';
import { InventoryManager } from '../managers/InventoryManager';
import { WorldbookManager } from '../scenes/WorldbookManager';
import EquipmentData from '../../json/EquipmentData.json';

/**
 * 右键上下文菜单所需的数据结构
 * 由 MainUI 监听到引擎抛出的 radar_right_click 事件后组装并传入
 */
export interface ContextMenuData {
    x: number;               // 菜单渲染的屏幕 X 坐标 (px)
    y: number;               // 菜单渲染的屏幕 Y 坐标 (px)
    worldX: number;          // 鼠标点击的宇宙物理世界 X 坐标
    worldY: number;          // 鼠标点击的宇宙物理世界 Y 坐标
    targetShip?: any;        // 右键明确点中的实体数据（如果有的话）
    isCommandMode: boolean;  // 当前是否处于“指挥模式”（玩家框选了己方舰队，准备下达战术指令）
    interactTargetId?: string; // 交互目标ID（右键点中了除自己之外的实体时存在，用于实体级交互如交流、观察）
}

interface Props {
    menuData: ContextMenuData;
    onClose: () => void;     // 点击任意按钮后触发的关闭菜单回调
}

/**
 * 独立的右键实体交互/战术指挥菜单组件
 * 负责渲染各个按钮，并根据点击抛出相应的事件给物理引擎或UI系统
 */
export const EntityContextMenu: React.FC<Props> = ({ menuData, onClose }) => {
    
    // 调试：右键点击实体时直接打印其库存信息到 F12
    useEffect(() => {
        const targetId = menuData.interactTargetId || menuData.targetShip?.id;
        if (targetId) {
            const inv = InventoryManager.getInventory(targetId);
            console.group(`%c[Debug]%c 实体 [${targetId}] 库存信息`, 'color: #00ff00; background: #222; padding: 2px 4px; border-radius: 3px;', 'color: unset;');
            // console.log("容量使用:", InventoryManager.getCurrentVolume(targetId), "/", InventoryManager.getCapacity(targetId));
            console.table(inv);
            console.groupEnd();
        }
    }, [menuData]);

    // 统一处理菜单按钮点击事件
    const handleCommand = (type: string, e: React.MouseEvent) => {
        e.stopPropagation();
        
        // -------------------------
        // 1. 战术指令类事件分发
        // -------------------------
        if (type === GameEvents.CMD_ATTACK && menuData.targetShip) {
            EventBus.dispatchEvent(new CustomEvent(type, {
                detail: { targetId: menuData.targetShip.id }
            }));
        } else if (type === GameEvents.CMD_MOVE) {
            EventBus.dispatchEvent(new CustomEvent(type, {
                detail: { x: menuData.worldX, y: menuData.worldY }
            }));
        } else if (type === GameEvents.CMD_DOCK) {
            EventBus.dispatchEvent(new CustomEvent(type, {
                detail: { targetId: menuData.targetShip?.id }
            }));
        } else if (type === GameEvents.CMD_MINE) {
            const currentSector = localStorage.getItem('current_sector') || '未知星区';
            EventBus.dispatchEvent(new CustomEvent(type, {
                detail: { x: menuData.worldX, y: menuData.worldY, targetSector: currentSector }
            }));

        // -------------------------
        // 2. 实体交互类事件分发
        // -------------------------
        } else if (type === 'COMMUNICATE') {
            // 交流：向目标发起通讯请求，并呼出LLM聊天终端
            const targetId = menuData.interactTargetId;
            if (targetId) {
                EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                    detail: `<div style="color:#00ffaa; font-style:italic;">[系统] 正在尝试建立与目标飞船 [${targetId}] 的通信链路...</div>`
                }));
                
                // 获取当前正在运行的 Phaser Base 场景
                const game = (window as any).Phaser?.GAMES?.[0] || (window as any).game;
                if (game && game.scene) {
                    const baseScene = game.scene.getScene('Base');
                    if (baseScene) {
                        // 利用终端组件的 handlePlayerAction 接口，静默注入系统提示词发起对话
                        const dom = baseScene.contentDOM;
                        baseScene.pendingSystemPrompt = `(玩家通过无线电频道，尝试向未知飞船 [${targetId}] 发起呼叫。请你扮演这艘飞船的船长或者AI，根据你们之间的立场进行回应。)`;
                        baseScene.handlePlayerAction(dom, `频道呼叫请求：飞船 ${targetId} 收到请回答。`);
                    }
                }
            }
        } else if (type === 'OBSERVE') {
            // 观察：获取目标飞船数据并打开独立的观察面板 (ObserveUI)
            const targetId = menuData.interactTargetId;
            if (targetId) {
                // 1. 优先从 BuildingManager 提取建筑数据
                const stationVirtualShip = BuildingManager.getStationAsVirtualShip(targetId);
                
                if (stationVirtualShip) {
                    const testInv = InventoryManager.getInventory(stationVirtualShip.id);
                    // console.log(`[ContextMenu] 本星区观察建筑 (${stationVirtualShip.id}) 肚子里有:`, JSON.parse(JSON.stringify(testInv)));
                    document.dispatchEvent(new CustomEvent('OPEN_OBSERVE_PANEL', { detail: stationVirtualShip }));
                } else {
                    // 2. 如果不是建筑，再去 ShipManager 当作飞船提取
                    let targetData = ShipManager.getShipById(targetId);
                    if (targetData) {
                        // console.log("[ContextMenu] 获取飞船数据成功，发送 OPEN_OBSERVE_PANEL", targetData);
                        document.dispatchEvent(new CustomEvent('OPEN_OBSERVE_PANEL', { detail: targetData }));
                    } else {
                        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                            detail: `<div style="color:#ff3333; font-style:italic;">[系统] 无法获取目标实体的数据链。</div>`
                        }));
                    }
                }
            }
        }
        
        // 无论执行了什么操作，点击后都关闭菜单
        onClose();
    };

    // 检查是否点在矿带中 (精确圆盘碰撞检测，同步执行以避免 UI 闪烁)
    let canMine = false;
    let closestBeltDist = Infinity;
    let targetBelt = null;
    const currentSector = localStorage.getItem('current_sector');
    const ws = WorldbookManager.getWorldState();
    if (ws && ws.asteroidBelts && currentSector) {
        const localBelts = ws.asteroidBelts.filter((b: any) => b.sector === currentSector);
        for (const belt of localBelts) {
            const dist = Math.hypot(menuData.worldX - belt.worldX, menuData.worldY - belt.worldY);
            if (dist < closestBeltDist) {
                closestBeltDist = dist;
                targetBelt = belt;
            }
            if (dist <= belt.radius) {
                canMine = true;
                // 不 break，继续找最近的用来输出 debug
            }
        }
    }

    // [新增] 检查选中的舰队中是否至少有一艘飞船具备采矿能力 (装备了采矿捕获网和采矿无人机)
    let hasMiningCapability = false;
    let debugMiningInfo = {
        isCommandMode: menuData.isCommandMode,
        hasTargetShip: !!menuData.targetShip,
        canMine: canMine,
        closestBelt: targetBelt ? { x: targetBelt.worldX, y: targetBelt.worldY, radius: targetBelt.radius, distToClick: closestBeltDist } : "无",
        clickPos: { x: menuData.worldX, y: menuData.worldY },
        selectedShips: [] as any[]
    };

    if (menuData.isCommandMode) {
        const game = (window as any).Phaser?.GAMES?.[0] || (window as any).game;
        if (game && game.scene) {
            const baseScene = game.scene.getScene('Base');
            if (baseScene && baseScene.selectedUnitIds && baseScene.selectedUnitIds.length > 0) {
                for (const shipId of baseScene.selectedUnitIds) {
                    const ship = ShipManager.getShipById(shipId);
                    if (ship) {
                        let hasMiningLaser = false;
                        let hasMiningDrone = false;
                        let equippedLasers = [] as string[];
                        let equippedDrones = [] as string[];

                        if (ship.loadout) {
                            hasMiningLaser = Object.values(ship.loadout).some((modId: any) => {
                                if (!modId) return false;
                                const compName = (EquipmentData.COMPONENTS as any)[modId]?.meta?.name || '';
                                const isMiner = String(modId).includes('mine') || String(modId).includes('miner') || compName.includes('采矿') || compName.includes('矿物');
                                equippedLasers.push(`${compName}(${modId})[${isMiner?'✔矿':'✘'}]`);
                                return isMiner;
                            });
                        }
                        
                        if (ship.droneEquips) {
                            hasMiningDrone = Object.values(ship.droneEquips).some((droneId: any) => {
                                if (!droneId) return false;
                                const droneName = (EquipmentData.HULLS as any)[droneId]?.name || '';
                                const isMiner = String(droneId).includes('mine') || String(droneId).includes('miner') || droneName.includes('采矿') || droneName.includes('矿物');
                                equippedDrones.push(`${droneName}(${droneId})[${isMiner?'✔矿':'✘'}]`);
                                return isMiner;
                            });
                        }
                        
                        debugMiningInfo.selectedShips.push({
                            id: shipId,
                            name: ship.name,
                            lasers: equippedLasers,
                            drones: equippedDrones,
                            capable: hasMiningLaser || hasMiningDrone
                        });

                        // 只要有任意一种采矿装备或采矿无人机就认为可以采矿
                        if (hasMiningLaser || hasMiningDrone) {
                            hasMiningCapability = true;
                        }
                    }
                }
            }
        }
    }

    // 只在指挥模式右键时输出调试信息，防止干扰正常游玩
    useEffect(() => {
        if (menuData.isCommandMode && !menuData.targetShip) {
            // console.group(`%c[采矿判定调试]%c 右键空地采矿条件分析`, 'color: #ffff00; background: #222; padding: 2px 4px; border-radius: 3px;', 'color: unset;');
            // console.log(`1. 是否点中实体? ${debugMiningInfo.hasTargetShip ? '❌是(无法采矿)' : '✅否(点中空地)'}`);
            // console.log(`2. 点击坐标: X:${debugMiningInfo.clickPos.x.toFixed(1)}, Y:${debugMiningInfo.clickPos.y.toFixed(1)}`);
            // if (debugMiningInfo.closestBelt !== "无") {
            //     const belt: any = debugMiningInfo.closestBelt;
            //     console.log(`   最近矿带: 中心(${belt.x.toFixed(1)}, ${belt.y.toFixed(1)}), 半径=${belt.radius}`);
            //     console.log(`   点击距离: ${belt.distToClick.toFixed(1)}`);
            // } else {
            //     console.log(`   最近矿带: 当前星区没有矿带`);
            // }
            // console.log(`3. 是否判定为在矿带内? ${debugMiningInfo.canMine ? '✅是' : '❌否'}`);
            // 
            // console.log(`4. 舰队采矿装备检测结果: ${hasMiningCapability ? '✅满足' : '❌未满足(所有选中的船都没有采矿设备)'}`);
            // console.table(debugMiningInfo.selectedShips.map(s => ({
            //     飞船: `${s.name}(${s.id})`,
            //     装备: s.lasers.join(' | '),
            //     无人机: s.drones.join(' | '),
            //     合格: s.capable ? '✅' : '❌'
            // })));
            // 
            // if (debugMiningInfo.canMine && hasMiningCapability && !debugMiningInfo.hasTargetShip) {
            //     console.log("%c⭐ 最终结果: 采矿按钮 [已成功显示]", "color: #00ff00; font-weight: bold");
            // } else {
            //     console.log("%c💥 最终结果: 采矿按钮 [被隐藏]", "color: #ff3333; font-weight: bold");
            // }
            // console.groupEnd();
        }
    }, [menuData, hasMiningCapability, debugMiningInfo]);

    // 菜单按钮的基础样式生成器
    const btnStyle = (color: string) => ({
        backgroundColor: 'transparent',
        color: color,
        border: 'none',
        padding: '5px 10px',
        cursor: 'pointer',
        textAlign: 'left' as const,
        fontSize: '14px',
        transition: 'background-color 0.2s',
    });

    // 只有在指挥模式、没有点在具体船只上，正好点在矿带圆形范围内，并且选中的船具备采矿能力时，才显示采矿按钮
    const renderMineBtn = menuData.isCommandMode && !menuData.targetShip && canMine && hasMiningCapability;
    
    // 计算当前星区所有矿带的总热力值 (碎片/分钟)
    let sectorTotalMiningRate = 0;
    if (ws && ws.asteroidBelts && currentSector) {
        const localBelts = ws.asteroidBelts.filter((b: any) => b.sector === currentSector);
        sectorTotalMiningRate = localBelts.reduce((sum: number, belt: any) => sum + (belt.miningRate || 0), 0);
    }

    return (
        <div style={{
            position: 'absolute',
            left: menuData.x,
            top: menuData.y,
            backgroundColor: 'rgba(10, 20, 30, 0.95)',
            border: '1px solid #00ffff',
            borderRadius: '5px',
            padding: '5px',
            zIndex: 10000,
            pointerEvents: 'auto',
            boxShadow: '0 0 10px rgba(0, 255, 255, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '5px'
        }}
        onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        onDoubleClick={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        >
            {/* 战术指令部分 */}
            {menuData.isCommandMode && (
                <>
                    <div style={{ color: '#00ffff', fontSize: '12px', borderBottom: '1px solid #00ffff', paddingBottom: '3px', marginBottom: '3px', textAlign: 'center' }}>战术指令</div>
                    <button
                        onClick={(e) => handleCommand(GameEvents.CMD_MOVE, e)}
                        style={btnStyle('#fff')}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.2)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        ➤ 移动到此
                    </button>

                    {renderMineBtn && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '5px' }}>
                            <button
                                onClick={(e) => handleCommand(GameEvents.CMD_MINE, e)}
                                style={btnStyle('#00ffff')}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.2)'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                ⛏ 采矿作业
                            </button>
                            <span style={{ fontSize: '12px', color: '#aaaaaa', marginLeft: '5px' }}>
                                ({sectorTotalMiningRate} 碎/分)
                            </span>
                        </div>
                    )}
                    
                    {menuData.targetShip && (
                        <>
                            <button
                                onClick={(e) => handleCommand(GameEvents.CMD_ATTACK, e)}
                                style={btnStyle('#ff3333')}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 51, 51, 0.2)'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                ⚔ 集火目标
                            </button>
                            
                            <button
                                onClick={(e) => handleCommand(GameEvents.CMD_DOCK, e)}
                                style={btnStyle('#00ff00')}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 0, 0.2)'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                ⚓ 申请停泊
                            </button>
                        </>
                    )}
                </>
            )}

            {/* 实体交互部分 */}
            {menuData.interactTargetId && (
                <>
                    <div style={{ color: '#00ffff', fontSize: '12px', borderBottom: '1px solid #00ffff', paddingBottom: '3px', marginBottom: '3px', marginTop: menuData.isCommandMode ? '5px' : '0', textAlign: 'center' }}>实体交互</div>
                    <button
                        onClick={(e) => handleCommand('COMMUNICATE', e)}
                        style={btnStyle('#fff')}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.2)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        📡 交流
                    </button>
                    <button
                        onClick={(e) => handleCommand('OBSERVE', e)}
                        style={btnStyle('#fff')}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.2)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        🔍 观察
                    </button>
                </>
            )}
        </div>
    );
};
