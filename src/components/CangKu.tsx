import React, { useState, useEffect } from 'react';
import { PlayerManager } from '../managers/PlayerManager';
import { ShipManager } from '../managers/ShipManager';
import { InventoryManager } from '../managers/InventoryManager';
import { BuildingManager } from '../managers/BuildingManager';
import ItemData from '../../json/ItemData.json';

interface CangKuProps {
    onClose: () => void;
}

export const CangKu: React.FC<CangKuProps> = ({ onClose }) => {
    // Window position and size
    const [pos, setPos] = useState({ x: window.innerWidth * 0.1, y: window.innerHeight * 0.1 });
    const [size, setSize] = useState({ w: window.innerWidth * 0.8, h: window.innerHeight * 0.8 });
    
    // Drag state
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Resize state
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

    // Data states
    const [cargo, setCargo] = useState<Record<string, number>>({});
    const [capacity, setCapacity] = useState<number>(100);
    
    // External Host States (停泊的宿主货舱)
    const [hostCargo, setHostCargo] = useState<Record<string, number>>({});
    const [hostCapacity, setHostCapacity] = useState<number>(100);
    const [hostName, setHostName] = useState<string>('');
    const [hasHost, setHasHost] = useState<boolean>(false);
    const [hostId, setHostId] = useState<string | null>(null);

    const [selectedItem, setSelectedItem] = useState<{ key: string, source: 'player' | 'host' } | null>(null);

    const refreshCargo = () => {
        const stats = PlayerManager.getStats();
        if (stats.playerShipId) {
            // [重构] 抛弃 PlayerManager 缓存的旧数据，直接去 ShipManager 里查这艘船现在的真实物理肚子
            const realShip = ShipManager.getShipById(stats.playerShipId);
            if (realShip) {
                setCargo({ ...InventoryManager.getInventory(stats.playerShipId) });
                setCapacity(InventoryManager.getCapacity(stats.playerShipId, realShip));
                
                // 检查是否停泊在某个宿主中 (空间站或母舰)
                if (realShip.dockedAt) {
                    let actualHostId = realShip.dockedAt;
                    let finalHostName = '外部仓库';

                    // 1. 优先尝试解析为空间站的统一聚合大库（解决单体模块储量与总库隔离的问题）
                    const stationVirtualShip = BuildingManager.getStationAsVirtualShip(actualHostId);
                    let hostEntity: any = null;
                    if (stationVirtualShip) {
                        actualHostId = stationVirtualShip.id;
                        finalHostName = stationVirtualShip.name || '联邦空间站';
                    } else {
                        // 2. 否则当作常规飞船/母舰提取名称
                        hostEntity = ShipManager.getShipById(actualHostId);
                        if (hostEntity) finalHostName = hostEntity.name;
                    }

                    setHostCargo({ ...InventoryManager.getInventory(actualHostId) });
                    
                    // 为宿主也提供兜底对象
                    let hostFallback = null;
                    if (stationVirtualShip) hostFallback = stationVirtualShip;
                    else if (hostEntity) hostFallback = hostEntity;
                    
                    setHostCapacity(InventoryManager.getCapacity(actualHostId, hostFallback));
                    setHostName(finalHostName);
                    setHasHost(true);
                    setHostId(actualHostId);
                } else {
                    setHasHost(false);
                    setHostId(null);
                }
            }
        }
    };

    useEffect(() => {
        refreshCargo();
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
        setSize({ w: Math.max(500, newW), h: Math.max(400, newH) });
        e.stopPropagation();
    };

    const handleResizeEnd = (e: React.PointerEvent) => {
        setIsResizing(false);
        e.stopPropagation();
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    };

    // 计算玩家总占用和列表
    let currentVolume = 0;
    const inventoryList: any[] = [];
    Object.entries(cargo).forEach(([key, count]) => {
        let def = (ItemData.ITEMS as any)[key];
        if (!def) def = Object.values(ItemData.ITEMS).find((v: any) => v.name === key);
        const volume = def ? def.volume : 1.0;
        const totalVol = volume * count;
        currentVolume += totalVol;
        inventoryList.push({ key, count, def: def || { name: key, basePrice: 0, volume: 1.0, desc: "未知异常物品" }, totalVol });
    });

    // 计算外部宿主总占用和列表
    let hostVolume = 0;
    const hostInventoryList: any[] = [];
    if (hasHost) {
        Object.entries(hostCargo).forEach(([key, count]) => {
            let def = (ItemData.ITEMS as any)[key];
            if (!def) def = Object.values(ItemData.ITEMS).find((v: any) => v.name === key);
            const volume = def ? def.volume : 1.0;
            const totalVol = volume * count;
            hostVolume += totalVol;
            hostInventoryList.push({ key, count, def: def || { name: key, basePrice: 0, volume: 1.0, desc: "未知异常物品" }, totalVol });
        });
    }

    const percent = Math.min(100, (currentVolume / capacity) * 100) || 0;
    const barColor = percent > 90 ? '#ff3333' : '#00ffff';
    
    const hostPercent = hasHost ? (Math.min(100, (hostVolume / hostCapacity) * 100) || 0) : 0;
    const hostBarColor = hostPercent > 90 ? '#ff3333' : '#ff9900';

    let selectedInfo = null;
    if (selectedItem) {
        if (selectedItem.source === 'player') {
            selectedInfo = inventoryList.find(i => i.key === selectedItem.key);
        } else {
            selectedInfo = hostInventoryList.find(i => i.key === selectedItem.key);
        }
    }

    // --- 物资转移核心逻辑 ---
    const handleTransfer = (amount: number) => {
        if (!selectedInfo || !hasHost || !hostId) return;
        const stats = PlayerManager.getStats();
        if (!stats.playerShipId) return;

        if (selectedItem?.source === 'player') {
            // 玩家 -> 宿主
            InventoryManager.transfer(stats.playerShipId, hostId, selectedInfo.key, amount);
        } else {
            // 宿主 -> 玩家
            InventoryManager.transfer(hostId, stats.playerShipId, selectedInfo.key, amount);
        }
        
        refreshCargo();
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
            border: '2px solid #ffcc00',
            borderRadius: '8px',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            zIndex: 100000,
            boxShadow: '0 0 20px rgba(255, 204, 0, 0.3)'
        }}>
            {/* Header - Draggable */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <h2 style={{ margin: 0, color: '#00ffff', textShadow: '0 0 5px #00ffff' }}>舰队货舱系统 [CARGO]</h2>
                    <button 
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={refreshCargo}
                        style={{
                            background: 'rgba(0, 255, 255, 0.2)', border: '1px solid #00ffff', color: '#00ffff',
                            padding: '4px 10px', cursor: 'pointer', borderRadius: '4px', fontSize: '12px'
                        }}
                    >
                        ↻ 刷新
                    </button>
                </div>
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

            {/* Content Area - 3 Columns Layout */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '20px', gap: '15px' }}>
                
                {/* Left Column: Player Inventory */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '10px' }}>
                    <div style={{ marginBottom: '10px' }}>
                        <h3 style={{ margin: 0, color: '#00ffff' }}>我的货舱</h3>
                        <div style={{ fontSize: '12px', color: '#aaa', marginTop: '5px' }}>
                            {currentVolume.toFixed(1)} / {capacity.toFixed(1)} 吨
                        </div>
                        <div style={{ width: '100%', height: '4px', backgroundColor: '#223', marginTop: '4px' }}>
                            <div style={{ width: `${percent}%`, height: '100%', backgroundColor: barColor }} />
                        </div>
                    </div>
                    
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {inventoryList.length === 0 && <div style={{ color: '#888', textAlign: 'center', marginTop: '20px' }}>空</div>}
                        {inventoryList.map(item => (
                            <div 
                                key={item.key}
                                onClick={() => setSelectedItem({ key: item.key, source: 'player' })}
                                style={{
                                    padding: '8px 12px',
                                    margin: '4px 0',
                                    backgroundColor: (selectedItem?.key === item.key && selectedItem?.source === 'player') ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 255, 255, 0.05)',
                                    border: `1px solid ${(selectedItem?.key === item.key && selectedItem?.source === 'player') ? '#00ffff' : '#223'}`,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    borderRadius: '4px',
                                }}
                            >
                                <span style={{ color: '#fff' }}>{item.def.name}</span>
                                <span style={{ color: '#00ffff' }}>{item.count}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Middle Column: Item Details & Actions */}
                <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '6px', padding: '15px', border: '1px solid #334' }}>
                    {selectedInfo ? (
                        <>
                            <h2 style={{ margin: '0 0 10px 0', color: selectedItem?.source === 'player' ? '#00ffff' : '#ff9900' }}>
                                {selectedInfo.def.name}
                            </h2>
                            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '15px', height: '60px', overflowY: 'auto' }}>
                                {selectedInfo.def.desc}
                            </div>
                            
                            <div style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: '15px', borderRadius: '4px', marginBottom: '15px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ color: '#888' }}>来源库位</span>
                                    <span style={{ color: selectedItem?.source === 'player' ? '#00ffff' : '#ff9900' }}>
                                        {selectedItem?.source === 'player' ? '我的货舱' : hostName}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ color: '#888' }}>单品体积</span>
                                    <span style={{ color: '#fff' }}>{selectedInfo.def.volume} 吨</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ color: '#888' }}>当前拥有</span>
                                    <span style={{ color: '#fff' }}>{selectedInfo.count} 单位</span>
                                </div>
                            </div>

                            {/* Actions */}
                            {selectedItem?.source === 'player' && (selectedInfo.def.type === 'drone' || selectedInfo.key.includes('_drone')) && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        const stats = PlayerManager.getStats();
                                        if (stats.playerShipId) {
                                            const realShip = ShipManager.getShipById(stats.playerShipId);
                                            if (realShip && realShip.hullId) {
                                                import('../../json/EquipmentData.json').then(data => {
                                                    const hullData = (data.default.HULLS as any)[realShip.hullId];
                                                    if (hullData && hullData.droneSlots) {
                                                        const slots = Object.keys(hullData.droneSlots);
                                                        const equips = realShip.droneEquips || {};
                                                        const emptySlot = slots.find(s => !equips[s]);
                                                        
                                                        if (emptySlot) {
                                                            if (ShipManager.equipDrone(stats.playerShipId, emptySlot, selectedInfo!.key)) {
                                                                refreshCargo();
                                                            }
                                                        } else {
                                                            alert("没有空闲的无人机槽位，请先在无人机面板卸载现有装备！");
                                                        }
                                                    }
                                                });
                                            }
                                        }
                                    }}
                                    style={{
                                        width: '100%', padding: '12px', marginTop: '15px', marginBottom: hasHost ? '15px' : 'auto',
                                        backgroundColor: 'rgba(0, 255, 255, 0.1)', border: '1px solid #00ffff',
                                        color: '#00ffff', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                                    }}
                                >
                                    ⚙️ 装备到槽位
                                </button>
                            )}

                            {/* Transfer Actions */}
                            {hasHost && (
                                <div style={{ marginTop: selectedItem?.source === 'player' && (selectedInfo.def.type === 'drone' || selectedInfo.key.includes('_drone')) ? '0' : 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ color: '#888', fontSize: '12px', textAlign: 'center' }}>
                                        {selectedItem?.source === 'player' ? '>>> 转移至宿主 >>>' : '<<< 提取至货舱 <<<'}
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={() => handleTransfer(1)} style={{ flex: 1, padding: '10px', background: '#334', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '4px' }}>转移 1</button>
                                        <button onClick={() => handleTransfer(10)} style={{ flex: 1, padding: '10px', background: '#334', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '4px' }}>转移 10</button>
                                        <button onClick={() => handleTransfer(selectedInfo!.count)} style={{ flex: 1, padding: '10px', background: '#445', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '4px' }}>全部</button>
                                    </div>
                                </div>
                            )}

                        </>
                    ) : (
                        <div style={{ color: '#556', fontStyle: 'italic', display: 'flex', height: '100%', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                            在两侧选择物品<br/>查看详情或转移
                        </div>
                    )}
                </div>

                {/* Right Column: Host Inventory */}
                {hasHost ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '10px' }}>
                        <div style={{ marginBottom: '10px' }}>
                            <h3 style={{ margin: 0, color: '#ff9900' }}>外部仓库 ({hostName})</h3>
                            <div style={{ fontSize: '12px', color: '#aaa', marginTop: '5px' }}>
                                {hostVolume.toFixed(1)} / {hostCapacity.toFixed(1)} 吨
                            </div>
                            <div style={{ width: '100%', height: '4px', backgroundColor: '#223', marginTop: '4px' }}>
                                <div style={{ width: `${hostPercent}%`, height: '100%', backgroundColor: hostBarColor }} />
                            </div>
                        </div>
                        
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {hostInventoryList.length === 0 && <div style={{ color: '#888', textAlign: 'center', marginTop: '20px' }}>空</div>}
                            {hostInventoryList.map(item => (
                                <div 
                                    key={item.key}
                                    onClick={() => setSelectedItem({ key: item.key, source: 'host' })}
                                    style={{
                                        padding: '8px 12px',
                                        margin: '4px 0',
                                        backgroundColor: (selectedItem?.key === item.key && selectedItem?.source === 'host') ? 'rgba(255, 153, 0, 0.2)' : 'rgba(255, 153, 0, 0.05)',
                                        border: `1px solid ${(selectedItem?.key === item.key && selectedItem?.source === 'host') ? '#ff9900' : '#223'}`,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        borderRadius: '4px',
                                    }}
                                >
                                    <span style={{ color: '#fff' }}>{item.def.name}</span>
                                    <span style={{ color: '#ff9900' }}>{item.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px dashed #334', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ color: '#556', textAlign: 'center' }}>
                            未停靠<br/>
                            <span style={{ fontSize: '12px' }}>(飞至空间站泊区模块附近点击停靠)</span>
                        </div>
                    </div>
                )}
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
                    borderRight: '3px solid #00ffff',
                    borderBottom: '3px solid #00ffff',
                    borderBottomRightRadius: '6px',
                    opacity: 0.7
                }}
            />
        </div>
    );
};
