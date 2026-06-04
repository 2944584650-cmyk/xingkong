import React, { useEffect, useRef, useState } from 'react';
import { EventBus, GameEvents } from '../../utils/EventBus';
import { WorldbookManager } from '../../scenes/WorldbookManager';
import { StarmapRenderer } from '../../scenes/StarmapRenderer';

export const StarmapPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [currentSector, setCurrentSector] = useState<string>('');
    const [selectedSector, setSelectedSector] = useState<string>('');

    // Window position and size
    const [pos, setPos] = useState({ x: window.innerWidth * 0.1, y: window.innerHeight * 0.1 });
    const [size, setSize] = useState({ w: window.innerWidth * 0.8, h: window.innerHeight * 0.8 });
    
    // Drag state
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Resize state
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

    useEffect(() => {
        // Init state
        let cs = localStorage.getItem('current_sector');
        if (!cs) {
            console.error("[StarmapPanel] 致命错误：未找到 current_sector！使用默认兜底星区。");
            cs = '创世星柱废墟';
        }
        setCurrentSector(cs);
        setSelectedSector(cs);

        // Init StarmapRenderer
        if (containerRef.current) {
            const worldState = WorldbookManager.getWorldState();
            
            const handleSelectSector = (sectorName: string) => {
                setSelectedSector(sectorName);
                // 不再在此处直接强制跳转视角和关闭窗口，给玩家时间在侧边栏查看详细信息并手动操作
            };

            // StarmapRenderer.init signature: container, worldState, currentSectorName, viewingSectorName, onSelectSector
            StarmapRenderer.init(
                containerRef.current, 
                worldState, 
                cs, 
                cs, 
                handleSelectSector
            );

            return () => {
                StarmapRenderer.cleanup();
            };
        }
    }, []);

    // Drag Handlers
    const handleDragStart = (e: React.PointerEvent) => {
        setIsDragging(true);
        setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handleDragMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
        e.stopPropagation();
    };

    const handleDragEnd = (e: React.PointerEvent) => {
        setIsDragging(false);
        e.stopPropagation();
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    };

    // Resize Handlers
    const handleResizeStart = (e: React.PointerEvent) => {
        setIsResizing(true);
        setResizeStart({ x: e.clientX, y: e.clientY, w: size.w, h: size.h });
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handleResizeMove = (e: React.PointerEvent) => {
        if (!isResizing) return;
        const newW = resizeStart.w + (e.clientX - resizeStart.x);
        const newH = resizeStart.h + (e.clientY - resizeStart.y);
        setSize({ w: Math.max(400, newW), h: Math.max(300, newH) });
        e.stopPropagation();
    };

    const handleResizeEnd = (e: React.PointerEvent) => {
        setIsResizing(false);
        e.stopPropagation();
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    };

    return (
        <div 
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
            position: 'absolute',
            top: `${pos.y}px`,
            left: `${pos.x}px`,
            width: `${size.w}px`,
            height: `${size.h}px`,
            backgroundColor: 'rgba(10, 20, 30, 0.95)',
            border: '2px solid #00ff00',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1000,
            pointerEvents: 'auto',
            color: '#00ff00',
            fontFamily: 'monospace',
            boxShadow: '0 0 20px rgba(0, 255, 0, 0.2)'
        }}>
            {/* Title Bar - Draggable */}
            <div 
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    borderBottom: '1px solid #00ff00', 
                    padding: '10px 20px', 
                    cursor: isDragging ? 'grabbing' : 'grab',
                    backgroundColor: 'rgba(0, 255, 0, 0.1)',
                    borderTopLeftRadius: '6px',
                    borderTopRightRadius: '6px',
                    userSelect: 'none'
                }}
            >
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>NAV / 星图导航</h2>
                <button 
                    onPointerDown={(e) => e.stopPropagation()} // Prevent drag when clicking close
                    onClick={onClose}
                    style={{ background: 'transparent', color: '#00ff00', border: '1px solid #00ff00', cursor: 'pointer', padding: '5px 15px' }}
                >
                    关闭 [X]
                </button>
            </div>

            <div style={{ display: 'flex', flex: 1, gap: '20px', padding: '20px', overflow: 'hidden' }}>
                {/* 渲染器容器 */}
                <div 
                    id="starmap-react-container"
                    ref={containerRef} 
                    style={{ 
                        flex: 2, 
                        border: '1px solid rgba(0,255,0,0.3)',
                        position: 'relative',
                        overflow: 'hidden',
                        backgroundColor: '#000'
                    }}
                >
                    {/* StarmapRenderer will mount its canvas here */}
                </div>

                {/* 侧边信息栏 */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', border: '1px solid rgba(0,255,0,0.3)', padding: '15px' }}>
                    <div>
                        <h3>当前星区</h3>
                        <p>{currentSector || '未知'}</p>
                    </div>
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <h3>目标星区</h3>
                        <p style={{ color: selectedSector !== currentSector ? '#00ffff' : '#00ff00', marginBottom: '10px' }}>
                            {selectedSector || '未选择'}
                        </p>

                        {/* 操作按钮区 */}
                        {selectedSector && selectedSector !== currentSector && (
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        
                                        // 兼容两种不同的聊天日志派发格式
                                        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                                            detail: { message: `[SYS] 测试：已点击【远程监控】按钮，目标 ${selectedSector}`, type: 'system' }
                                        }));
                                        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                                            detail: `<div style="color:#00ffff;">[系统] 已切换远程监控节点：${selectedSector}</div>`
                                        }));
                                        
                                        const game = (window as any).game;
                                        if (game && game.scene) {
                                            const baseScene = game.scene.getScene('Base');
                                            if (baseScene && typeof baseScene.switchRadarView === 'function') {
                                                baseScene.switchRadarView(selectedSector);
                                                onClose();
                                            } else {
                                                console.error("未能找到 Base 场景或 switchRadarView 方法", baseScene);
                                            }
                                        } else {
                                            console.error("未能找到 window.game 实例");
                                        }
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: '8px',
                                        backgroundColor: 'rgba(0, 255, 255, 0.2)',
                                        border: '1px solid #00ffff',
                                        color: '#00ffff',
                                        cursor: 'pointer',
                                        borderRadius: '4px'
                                    }}
                                >
                                    👁️ 远程监控
                                </button>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        
                                        // 兼容聊天框输出格式
                                        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                                            detail: `<div style="color:#00ff00;">[导航] 已将 [${selectedSector}] 设为导航目标，正在计算航线...</div>`
                                        }));

                                        // 1. 触发后台导航数据更新，让星门高亮染色生效
                                        const worldState = WorldbookManager.getWorldState();
                                        const startNode = worldState.sectors.find(s => s.name === currentSector);
                                        const endNode = worldState.sectors.find(s => s.name === selectedSector);
                                        
                                        if (startNode && endNode && startNode.name !== endNode.name) {
                                            const pathNodes = WorldbookManager.getStarlanePath(startNode, endNode, worldState.sectors);
                                            if (pathNodes && pathNodes.length > 1) {
                                                const pathNames = pathNodes.map(n => n.name).slice(1);
                                                
                                                EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                                                    detail: `<div style="color:#00ffaa;">[导航] 航线规划完毕，请通过星门前往下个节点。</div>`
                                                }));
                                                
                                                document.dispatchEvent(new CustomEvent('ui_set_nav_target', {
                                                    detail: { targetSector: selectedSector, path: pathNames }
                                                }));
                                            } else {
                                                EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                                                    detail: `<div style="color:red;">[警告] 无法找到通往 [${selectedSector}] 的航线！</div>`
                                                }));
                                            }
                                        }

                                        // 2. 设定导航后，自动把视角切回玩家当前真正所在的物理星区，并关闭星图
                                        const game = (window as any).game;
                                        if (game && game.scene) {
                                            const baseScene = game.scene.getScene('Base');
                                            if (baseScene && typeof baseScene.switchRadarView === 'function') {
                                                let realSector = localStorage.getItem('current_sector');
                                                if (!realSector) {
                                                    console.error("[StarmapPanel/switchRadarView] 致命错误：未找到 current_sector！使用默认兜底星区。");
                                                    realSector = '创世星柱废墟';
                                                }
                                                baseScene.switchRadarView(realSector); // 切回真实的物理星区，防止变量过期导致跳入空星系
                                                onClose();
                                            }
                                        } else {
                                            onClose();
                                        }
                                    }}
                                    style={{
                                        flex: 1,
                                        padding: '8px',
                                        backgroundColor: 'rgba(0, 255, 0, 0.2)',
                                        border: '1px solid #00ff00',
                                        color: '#00ff00',
                                        cursor: 'pointer',
                                        borderRadius: '4px',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    🚀 设定导航
                                </button>
                            </div>
                        )}
                        
                        {/* 我们把 Tooltip 的内容挂载点放在这里 */}
                        <div id="react-sm-sidebar-info" style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid rgba(0, 255, 0, 0.3)', paddingTop: '10px' }}>
                            <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontStyle: 'italic' }}>
                                将鼠标悬停在星区节点上查看详细信息...
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Resize Handle */}
            <div 
                onPointerDown={handleResizeStart}
                onPointerMove={handleResizeMove}
                onPointerUp={handleResizeEnd}
                onPointerCancel={handleResizeEnd}
                style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: '20px',
                    height: '20px',
                    cursor: 'nwse-resize',
                    borderRight: '3px solid #00ff00',
                    borderBottom: '3px solid #00ff00',
                    borderBottomRightRadius: '6px',
                    opacity: 0.7
                }}
            />
        </div>
    );
};
