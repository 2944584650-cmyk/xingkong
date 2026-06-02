import React, { useEffect } from 'react';
import { EventBus, GameEvents } from '../utils/EventBus';
import { ShipManager } from '../managers/ShipManager';
import { BuildingManager } from '../managers/BuildingManager';
import { InventoryManager } from '../managers/InventoryManager';

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
            console.log("容量使用:", InventoryManager.getCurrentVolume(targetId), "/", InventoryManager.getCapacity(targetId));
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
                    console.log(`[ContextMenu] 本星区观察建筑 (${stationVirtualShip.id}) 肚子里有:`, JSON.parse(JSON.stringify(testInv)));
                    document.dispatchEvent(new CustomEvent('OPEN_OBSERVE_PANEL', { detail: stationVirtualShip }));
                } else {
                    // 2. 如果不是建筑，再去 ShipManager 当作飞船提取
                    let targetData = ShipManager.getShipById(targetId);
                    if (targetData) {
                        console.log("[ContextMenu] 获取飞船数据成功，发送 OPEN_OBSERVE_PANEL", targetData);
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
