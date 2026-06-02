import React, { useState, useEffect } from 'react';
import { PlayerManager } from '../managers/PlayerManager';

interface JianDuiProps {
    onClose: () => void;
}

export const JianDui: React.FC<JianDuiProps> = ({ onClose }) => {
    const [stats, setStats] = useState<any>(null);
    const [selectedShipId, setSelectedShipId] = useState<string | null>(null);

    // Window position and size
    const [pos, setPos] = useState({ x: window.innerWidth * 0.1, y: window.innerHeight * 0.1 });
    const [size, setSize] = useState({ w: window.innerWidth * 0.8, h: window.innerHeight * 0.8 });
    
    // Drag state
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Resize state
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

    const loadStats = () => {
        const s = PlayerManager.getStats();
        setStats(s);
    };

    useEffect(() => {
        loadStats();

        // 监听后台物理引擎高频抛出的真实最新舰队数据（包含了强行同步的最新位置）
        const handleUpdateFleetData = (e: any) => {
            if (e.detail) {
                setStats(e.detail);
            }
        };

        // 绑定事件
        document.addEventListener('UPDATE_FLEET_DATA', handleUpdateFleetData);

        return () => {
            document.removeEventListener('UPDATE_FLEET_DATA', handleUpdateFleetData);
        };
    }, []);

    if (!stats) return null;

    const { ownedShips, fleets, playerShipId } = stats;

    const unassignedShips = ownedShips.filter((ship: any) => {
        return !fleets.some((fleet: any) => fleet.flagshipId === ship.id || fleet.members.includes(ship.id));
    });

    const handleCreateFleet = () => {
        const name = prompt('请输入新中队名称：');
        if (name) {
            PlayerManager.createFleet(name);
            loadStats();
        }
    };

    const handleRemoveFleet = (fleetId: string) => {
        if (window.confirm('确定解散该中队吗？')) {
            PlayerManager.removeFleet(fleetId);
            loadStats();
        }
    };

    const handleAssignShip = (shipId: string, fleetId: string, asFlagship: boolean) => {
        PlayerManager.assignShipToFleet(shipId, fleetId, asFlagship);
        loadStats();
    };

    const handleRemoveShipFromFleet = (shipId: string) => {
        PlayerManager.removeShipFromFleet(shipId);
        loadStats();
    };

    const handleSetPlayerShip = (shipId: string) => {
        PlayerManager.setPlayerShip(shipId);
        loadStats();
        // 通知其他组件（如左下角内构UI）玩家座驾已更换
        document.dispatchEvent(new CustomEvent('PLAYER_SHIP_CHANGED'));
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
                <h2 style={{ margin: 0, color: '#00ffff', textShadow: '0 0 5px #00ffff' }}>舰队战术终端 [CMD]</h2>
                <button 
                    onPointerDown={(e) => e.stopPropagation()} // Prevent drag when clicking close
                    onClick={onClose} 
                    style={{
                        background: 'none', border: '1px solid #ff3333', color: '#ff3333', 
                        padding: '5px 15px', cursor: 'pointer', borderRadius: '4px'
                    }}
                >
                    关闭
                </button>
            </div>

            {/* Content */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                
                {/* Left Panel - Fleets */}
                <div style={{ flex: 1, borderRight: '1px solid rgba(0, 255, 255, 0.3)', padding: '20px', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3 style={{ margin: 0, color: '#aaaaff' }}>编制中队</h3>
                        <button onClick={handleCreateFleet} style={{
                            background: 'rgba(0, 255, 255, 0.2)', border: '1px solid #00ffff', color: '#00ffff',
                            padding: '5px 10px', cursor: 'pointer', borderRadius: '4px'
                        }}>新建中队</button>
                    </div>

                    {fleets.length === 0 ? (
                        <div style={{ color: '#888', fontStyle: 'italic' }}>暂无编制中队</div>
                    ) : (
                        fleets.map((fleet: any) => (
                            <div key={fleet.id} style={{
                                border: '1px solid rgba(0, 255, 255, 0.5)',
                                borderRadius: '4px',
                                padding: '10px',
                                marginBottom: '15px',
                                backgroundColor: 'rgba(0, 0, 0, 0.3)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                    <h4 style={{ margin: 0, color: '#fff' }}>{fleet.name}</h4>
                                    <div>
                                        <select 
                                            value={fleet.orders} 
                                            onChange={(e) => {
                                                PlayerManager.setFleetOrders(fleet.id, e.target.value);
                                                loadStats();
                                            }}
                                            style={{ background: '#000', color: '#00ffff', border: '1px solid #00ffff', marginRight: '10px' }}
                                        >
                                            <option value="follow_leader">跟随旗舰</option>
                                            <option value="free_engage">自由交战</option>
                                            <option value="hold_position">坚守原地</option>
                                        </select>
                                        <button onClick={() => {
                                            // 派发自定义事件，模拟在雷达上左键选中了该舰队的所有成员
                                            const fleetMembers = [...fleet.members];
                                            if (fleet.flagshipId) fleetMembers.push(fleet.flagshipId);
                                            
                                            // 构造虚拟的 targetShip 对象以兼容左键点击逻辑，或者你可以修改 Base.ts 让它支持接受一批 ID
                                            // 但最简单的方式是直接修改 document 级别的事件或全局变量
                                            
                                            // 我们发一个专用的指令给 Base.ts 告诉它选中这些 ID
                                            document.dispatchEvent(new CustomEvent('ui_select_fleet_units', {
                                                detail: { unitIds: fleetMembers }
                                            }));
                                            
                                            // 关闭舰队面板以便玩家能立刻看到并在雷达上操作
                                            onClose();
                                        }} style={{
                                            background: 'rgba(0, 255, 255, 0.2)', border: '1px solid #00ffff', color: '#00ffff', cursor: 'pointer', marginRight: '10px', padding: '2px 8px', borderRadius: '3px'
                                        }}>指挥</button>
                                        <button onClick={() => handleRemoveFleet(fleet.id)} style={{
                                            background: 'none', border: '1px solid #ff3333', color: '#ff3333', cursor: 'pointer'
                                        }}>解散</button>
                                    </div>
                                </div>

                                {/* Flagship */}
                                <div>
                                    <strong style={{ color: '#ffcc00' }}>旗舰: </strong>
                                    {fleet.flagshipId ? (
                                        <ShipCard 
                                            shipId={fleet.flagshipId} 
                                            stats={stats} 
                                            isSelected={selectedShipId === fleet.flagshipId}
                                            onClick={() => setSelectedShipId(fleet.flagshipId === selectedShipId ? null : fleet.flagshipId)}
                                            onRemove={() => handleRemoveShipFromFleet(fleet.flagshipId)}
                                        />
                                    ) : (
                                        <span style={{ color: '#888' }}>空缺</span>
                                    )}
                                </div>

                                {/* Members */}
                                <div style={{ marginTop: '10px' }}>
                                    <strong style={{ color: '#aaaaff' }}>僚机: </strong>
                                    {fleet.members.length === 0 ? (
                                        <span style={{ color: '#888' }}>无</span>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '5px' }}>
                                            {fleet.members.map((mId: string) => (
                                                <ShipCard 
                                                    key={mId} 
                                                    shipId={mId} 
                                                    stats={stats}
                                                    isSelected={selectedShipId === mId}
                                                    onClick={() => setSelectedShipId(mId === selectedShipId ? null : mId)}
                                                    onRemove={() => handleRemoveShipFromFleet(mId)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Right Panel - Unassigned & Details */}
                <div style={{ width: '40%', padding: '20px', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: '0 0 20px 0', color: '#aaaaff' }}>闲置资产</h3>
                    
                    <div style={{ flex: 1, overflowY: 'auto', marginBottom: '20px', borderBottom: '1px solid rgba(0,255,255,0.3)', paddingBottom: '10px' }}>
                        {unassignedShips.length === 0 ? (
                            <div style={{ color: '#888', fontStyle: 'italic' }}>无闲置船只</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                {unassignedShips.map((ship: any) => (
                                    <ShipCard 
                                        key={ship.id} 
                                        shipId={ship.id} 
                                        stats={stats}
                                        isSelected={selectedShipId === ship.id}
                                        onClick={() => setSelectedShipId(ship.id === selectedShipId ? null : ship.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Action Area for Selected Ship */}
                    <div style={{ height: '150px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px dashed #00ffff', padding: '10px' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#00ffff' }}>操作面板</h4>
                        {selectedShipId ? (
                            <div>
                                <div style={{ marginBottom: '10px', color: '#fff' }}>
                                    选中目标: {ownedShips.find((s:any) => s.id === selectedShipId)?.name}
                                </div>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    {selectedShipId !== playerShipId && (
                                        <button onClick={() => handleSetPlayerShip(selectedShipId)} style={btnStyle}>设为座驾 (登舰)</button>
                                    )}
                                    
                                    <select id="fleetSelect" style={{ background: '#000', color: '#00ffff', border: '1px solid #00ffff' }}>
                                        {fleets.map((f:any) => <option key={f.id} value={f.id}>{f.name}</option>)}
                                    </select>
                                    <button onClick={() => {
                                        const select = document.getElementById('fleetSelect') as HTMLSelectElement;
                                        if (select && select.value) handleAssignShip(selectedShipId, select.value, false);
                                    }} style={btnStyle}>编入所选 (僚机)</button>
                                    <button onClick={() => {
                                        const select = document.getElementById('fleetSelect') as HTMLSelectElement;
                                        if (select && select.value) handleAssignShip(selectedShipId, select.value, true);
                                    }} style={btnStyle}>编入所选 (旗舰)</button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: '#888', fontStyle: 'italic' }}>请在左侧或上方选择一艘飞船</div>
                        )}
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
                    borderRight: '3px solid #00ffff',
                    borderBottom: '3px solid #00ffff',
                    borderBottomRightRadius: '6px',
                    opacity: 0.7
                }}
            />
        </div>
    );
};

const ShipCard = ({ shipId, stats, isSelected, onClick, onRemove }: any) => {
    const ship = stats.ownedShips.find((s: any) => s.id === shipId);
    if (!ship) return null;

    const isPlayer = stats.playerShipId === shipId;
    
    // 直接读取 stats 中传递过来的 location 信息
    const locationStr = ship.location && ship.location.sector ? ship.location.sector : '未知星区';

    return (
        <div 
            onClick={onClick}
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px',
                backgroundColor: isSelected ? 'rgba(0, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: isSelected ? '1px solid #00ffff' : '1px solid transparent',
                cursor: 'pointer',
                borderRadius: '4px'
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div>
                    <span style={{ color: '#fff', fontWeight: 'bold' }}>{ship.name}</span>
                    <span style={{ color: '#aaa', fontSize: '0.8em', marginLeft: '10px' }}>[{ship.hullId}]</span>
                    {isPlayer && <span style={{ color: '#00ff00', fontSize: '0.8em', marginLeft: '10px', border: '1px solid #00ff00', padding: '1px 4px', borderRadius:'3px' }}>玩家座驾</span>}
                </div>
                <div style={{ fontSize: '0.8em', color: '#00ffff', marginTop: '4px' }}>
                    <span style={{ opacity: 0.7 }}>位置:</span> {locationStr}
                </div>
                
                {/* 血条显示 */}
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center' }}>
                    <div style={{ 
                        flex: 1, 
                        height: '6px', 
                        backgroundColor: 'rgba(255, 0, 0, 0.3)', 
                        borderRadius: '3px',
                        overflow: 'hidden',
                        marginRight: '10px'
                    }}>
                        <div style={{ 
                            height: '100%', 
                            width: `${Math.max(0, Math.min(100, (ship.hp / ship.maxHp) * 100))}%`, 
                            backgroundColor: '#00ff00',
                            transition: 'width 0.3s ease'
                        }} />
                    </div>
                    <span style={{ fontSize: '0.8em', color: '#aaa', minWidth: '60px', textAlign: 'right' }}>
                        {Math.floor(ship.hp)} / {Math.floor(ship.maxHp)}
                    </span>
                </div>
            </div>
            {onRemove && (
                <div style={{ marginLeft: '10px' }}>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        style={{ background: 'none', border: '1px solid #aaa', color: '#aaa', padding: '4px 8px', cursor: 'pointer', borderRadius: '4px' }}
                    >
                        移出
                    </button>
                </div>
            )}
        </div>
    );
}

const btnStyle = {
    background: 'rgba(0, 255, 255, 0.1)',
    border: '1px solid #00ffff',
    color: '#00ffff',
    padding: '5px 10px',
    cursor: 'pointer',
    borderRadius: '4px'
};
