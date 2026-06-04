import React, { useState, useEffect, useRef } from 'react';
import { PlayerManager } from '../managers/PlayerManager';
import EquipmentData from '../../json/EquipmentData.json';

interface ZhuangBeiProps {
    onClose: () => void;
}

export const ZhuangBei: React.FC<ZhuangBeiProps> = ({ onClose }) => {
    // 窗口位置和尺寸 (使用绝对像素而非百分比，参照 JianDui.tsx)
    const [pos, setPos] = useState({ x: window.innerWidth * 0.15, y: window.innerHeight * 0.15 });
    const [size, setSize] = useState({ w: window.innerWidth * 0.7, h: window.innerHeight * 0.7 });
    
    // 拖拽相关状态
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // 缩放相关状态
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

    // 飞船数据
    const [shipUrl, setShipUrl] = useState<string>('');
    const [hullDef, setHullDef] = useState<any>(null);
    const [equippedSlots, setEquippedSlots] = useState<Record<string, string>>({});

    useEffect(() => {
        const loadShipData = () => {
            const stats: any = PlayerManager.getStats();
            if (stats && stats.playerShipId) {
                import('../managers/ShipManager').then(({ ShipManager }) => {
                    const realShip = ShipManager.getShipById(stats.playerShipId);
                    const hullId = realShip?.hullId || stats.hullId;
                    const slots = realShip?.slots || stats.slots || {};
                    
                    if (hullId) {
                        const hulls = EquipmentData.HULLS as Record<string, any>;
                        const hullData = hulls[hullId];
                        setHullDef(hullData);
                        setEquippedSlots(slots);
                        if (hullData && hullData.sprite) {
                            setShipUrl(`assets/${hullData.sprite}`);
                        }
                    }
                });
            }
        };
        loadShipData();
    }, []);

    // 辅助函数：获取装备名称
    const getComponentName = (compId: string) => {
        if (!compId) return "空";
        const comps = EquipmentData.COMPONENTS as Record<string, any>;
        return comps[compId]?.meta?.name || compId;
    };

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
            border: '2px solid #00ffff',
            borderRadius: '8px',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            zIndex: 100000,
            boxShadow: '0 0 20px rgba(0, 255, 255, 0.3)'
        }}>
            {/* 顶部拖拽条 */}
            <div 
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                style={{
                    padding: '15px 20px',
                    borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: 'rgba(0, 255, 255, 0.1)',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    borderTopLeftRadius: '6px',
                    borderTopRightRadius: '6px',
                }}
            >
                <h2 style={{ margin: 0, color: '#00ffff', textShadow: '0 0 5px #00ffff', letterSpacing: '2px' }}>
                    设备装配 (EQUIPMENT)
                </h2>
                <button 
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onClose} 
                    style={{
                        background: 'none', border: '1px solid #ff3333', color: '#ff3333', 
                        padding: '5px 15px', cursor: 'pointer', borderRadius: '4px'
                    }}
                >
                    关闭
                </button>
            </div>

            {/* 内容区域 */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* 左侧 50%：内构与槽位列表 */}
                <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {hullDef && hullDef.areas ? (
                        hullDef.areas.map((area: any) => (
                            <div key={area.id} style={{ 
                                backgroundColor: 'rgba(0, 255, 255, 0.05)', 
                                border: '1px solid rgba(0, 255, 255, 0.2)', 
                                borderRadius: '6px', 
                                padding: '10px' 
                            }}>
                                <h3 style={{ margin: '0 0 10px 0', color: '#00ffff', borderBottom: '1px solid rgba(0,255,255,0.2)', paddingBottom: '5px' }}>
                                    {area.name}
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {Object.entries(hullDef.slots || {})
                                        .filter(([slotId, slotDef]: [string, any]) => slotDef.area === area.id)
                                        .map(([slotId, slotDef]: [string, any]) => {
                                            const equippedItem = equippedSlots[slotId];
                                            return (
                                                <div key={slotId} style={{ 
                                                    display: 'flex', 
                                                    justifyContent: 'space-between', 
                                                    alignItems: 'center',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                                    padding: '8px 12px',
                                                    borderRadius: '4px',
                                                    border: '1px dashed rgba(255, 255, 255, 0.2)'
                                                }}>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                            <div style={{ color: '#fff', fontWeight: 'bold' }}>{slotId} - {slotDef.desc || '槽位'}</div>
                                                            <div style={{ color: equippedItem ? '#00ffaa' : '#ffaa00', fontWeight: 'bold' }}>
                                                                {getComponentName(equippedItem)}
                                                            </div>
                                                        </div>
                                                        <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                                                            尺寸: {slotDef.size} {slotDef.isTurret ? '| (炮塔)' : ''}
                                                        </div>
                                                        {equippedItem && (
                                                            <div style={{ fontSize: '12px', color: '#aaa', borderTop: '1px dotted rgba(255,255,255,0.1)', paddingTop: '4px', marginTop: '4px' }}>
                                                                {(EquipmentData.COMPONENTS as Record<string, any>)[equippedItem]?.meta?.desc || "暂无介绍"}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    {Object.entries(hullDef.slots || {}).filter(([_, slotDef]: [string, any]) => slotDef.area === area.id).length === 0 && (
                                        <div style={{ color: '#666', fontStyle: 'italic' }}>该区域无可用槽位</div>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div style={{ color: '#aaa' }}>当前飞船没有定义内构区域数据。</div>
                    )}

                    {/* 显示未分配区域的槽位 (容错处理) */}
                    {hullDef && Object.entries(hullDef.slots || {}).filter(([_, slotDef]: [string, any]) => !slotDef.area).length > 0 && (
                        <div style={{ 
                            backgroundColor: 'rgba(255, 100, 100, 0.05)', 
                            border: '1px solid rgba(255, 100, 100, 0.2)', 
                            borderRadius: '6px', 
                            padding: '10px' 
                        }}>
                            <h3 style={{ margin: '0 0 10px 0', color: '#ff6666', borderBottom: '1px solid rgba(255,100,100,0.2)', paddingBottom: '5px' }}>
                                未分配区域的槽位
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {Object.entries(hullDef.slots || {})
                                    .filter(([_, slotDef]: [string, any]) => !slotDef.area)
                                    .map(([slotId, slotDef]: [string, any]) => {
                                        const equippedItem = equippedSlots[slotId];
                                        return (
                                            <div key={slotId} style={{ 
                                                display: 'flex', 
                                                justifyContent: 'space-between', 
                                                alignItems: 'center',
                                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                                padding: '8px 12px',
                                                borderRadius: '4px',
                                                border: '1px dashed rgba(255, 100, 100, 0.2)'
                                            }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                        <div style={{ color: '#fff', fontWeight: 'bold' }}>{slotId} - {slotDef.desc || '槽位'}</div>
                                                        <div style={{ color: equippedItem ? '#00ffaa' : '#ffaa00', fontWeight: 'bold' }}>
                                                            {getComponentName(equippedItem)}
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                                                        尺寸: {slotDef.size} {slotDef.isTurret ? '| (炮塔)' : ''}
                                                    </div>
                                                    {equippedItem && (
                                                        <div style={{ fontSize: '12px', color: '#aaa', borderTop: '1px dotted rgba(255,255,255,0.1)', paddingTop: '4px', marginTop: '4px' }}>
                                                            {(EquipmentData.COMPONENTS as Record<string, any>)[equippedItem]?.meta?.desc || "暂无介绍"}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}
                </div>

                {/* 分割线 */}
                <div style={{ width: '2px', backgroundColor: 'rgba(0, 255, 255, 0.3)', boxShadow: '0 0 5px rgba(0, 255, 255, 0.5)' }} />

                {/* 右侧 50%：飞船立绘 */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {shipUrl ? (
                        <img 
                            src={shipUrl} 
                            alt="Player Ship" 
                            style={{
                                height: '90%',
                                width: 'auto',
                                objectFit: 'contain',
                                imageRendering: 'pixelated',
                                display: 'block',
                                transform: 'rotate(-90deg)'
                            }} 
                        />
                    ) : (
                        <div style={{ color: '#aaa' }}>加载飞船数据中...</div>
                    )}
                </div>
            </div>

            {/* 右下角缩放手柄 */}
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
                    borderRight: '3px solid #00ffff',
                    borderBottom: '3px solid #00ffff',
                    borderBottomRightRadius: '6px',
                    opacity: 0.7
                }}
            />
        </div>
    );
};
