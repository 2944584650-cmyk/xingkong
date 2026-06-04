import React, { useState, useEffect } from 'react';
import { PlayerManager } from '../managers/PlayerManager';
import { ShipManager } from '../managers/ShipManager';
import { InventoryManager } from '../managers/InventoryManager';
import EquipmentData from '../../json/EquipmentData.json';

export const WuRenJiPanel: React.FC = () => {
    const [hullDef, setHullDef] = useState<any>(null);
    const [equippedSlots, setEquippedSlots] = useState<Record<string, string>>({});
    const [droneStates, setDroneStates] = useState<Record<string, string>>({});
    const [playerShipId, setPlayerShipId] = useState<string | null>(null);

    const loadShipData = () => {
        const stats: any = PlayerManager.getStats();
        if (stats && stats.playerShipId) {
            setPlayerShipId(stats.playerShipId);
            const realShip = ShipManager.getShipById(stats.playerShipId);
            const hullId = realShip?.hullId || stats.hullId;
            
            if (hullId) {
                const hulls = EquipmentData.HULLS as Record<string, any>;
                const hullData = hulls[hullId];
                setHullDef(hullData);
                
                // 确保这里读取的是我们新增的 droneEquips 和 droneStates
                // 使用浅拷贝，避免 React 因为对象引用没变而拒绝刷新
                setEquippedSlots({ ...(realShip?.droneEquips || {}) });
                setDroneStates({ ...(realShip?.droneStates || {}) });
            }
        }
    };

    useEffect(() => {
        loadShipData();
        
        document.addEventListener('DRONE_STATE_CHANGED', loadShipData);
        document.addEventListener('PLAYER_SHIP_CHANGED', loadShipData);
        return () => {
            document.removeEventListener('DRONE_STATE_CHANGED', loadShipData);
            document.removeEventListener('PLAYER_SHIP_CHANGED', loadShipData);
        };
    }, []);

    const getComponentName = (compId: string) => {
        if (!compId) return "空槽";
        if (compId === 'attack_drone') return "进攻无人机";
        if (compId === 'mine_drone') return "采矿无人机";
        if (compId === 'builder_drone') return "建筑无人机";
        const comps = EquipmentData.COMPONENTS as Record<string, any>;
        return comps[compId]?.meta?.name || compId;
    };

    const handleUnequip = (slotId: string) => {
        if (!playerShipId) return;
        if (ShipManager.unequipDrone(playerShipId, slotId)) {
            loadShipData();
        }
    };

    const handleToggleState = (slotId: string, currentState: string) => {
        if (!playerShipId) return;
        if (currentState === 'IDLE') {
            if (ShipManager.launchDrone(playerShipId, slotId)) {
                loadShipData();
            }
        } else if (currentState === 'WORKING') {
            if (ShipManager.recallDrone(playerShipId, slotId)) {
                loadShipData();
            }
        }
    };

    return (
        <div style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 20px 20px 30px',
            boxSizing: 'border-box',
            position: 'relative',
        }}>
            <div style={{
                color: '#d4a017',
                fontSize: '1.1rem',
                fontWeight: 'bold',
                textShadow: '0 0 5px rgba(212, 160, 23, 0.5)',
                marginBottom: '10px',
                borderBottom: '2px solid #8a660a',
                paddingBottom: '5px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            }}>
                <span style={{ fontSize: '1.4rem' }}>☗</span> 无人机控制阵列
            </div>
            
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                overflowY: 'auto',
                flex: 1,
                paddingRight: '10px'
            }}>
                {hullDef && hullDef.droneSlots && Object.keys(hullDef.droneSlots).length > 0 ? (
                    Object.entries(hullDef.droneSlots).map(([slotId, slotDef]: [string, any]) => {
                        const equippedItem = equippedSlots[slotId];
                        return (
                            <div key={slotId} style={{
                                backgroundColor: '#111',
                                border: '2px solid',
                                borderColor: '#4a4e54 #222 #222 #4a4e54',
                                borderLeft: equippedItem ? '4px solid #00ffcc' : '4px solid #ff3333',
                                padding: '8px 12px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                boxShadow: 'inset 0 0 15px rgba(0,0,0,1), 0 2px 4px rgba(0,0,0,0.5)',
                                position: 'relative',
                                overflow: 'hidden'
                            }}>
                                {/* Scanline overlay */}
                                <div style={{
                                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                    background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 4px)',
                                    pointerEvents: 'none'
                                }}/>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', zIndex: 1, flex: 1 }}>
                                    <span style={{ color: '#ccc', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '1.1rem' }}>{slotId}</span>
                                    <span style={{ color: '#666', fontSize: '0.75rem' }}>{slotDef.desc}</span>
                                </div>

                                {/* Controls */}
                                <div style={{ display: 'flex', gap: '10px', zIndex: 1, alignItems: 'center' }}>
                                    {!equippedItem ? (
                                        <div style={{ 
                                            color: '#666',
                                            fontWeight: 'bold',
                                            backgroundColor: 'rgba(0,0,0,0.8)',
                                            padding: '4px 10px',
                                            border: '1px dashed #666',
                                            fontFamily: 'monospace'
                                        }}>
                                            空槽位
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ 
                                                color: '#00ffcc',
                                                fontWeight: 'bold',
                                                backgroundColor: 'rgba(0,0,0,0.8)',
                                                padding: '4px 10px',
                                                border: '1px solid #00ffcc',
                                                boxShadow: '0 0 8px rgba(0,255,204,0.3)',
                                                fontFamily: 'monospace'
                                            }}>
                                                {getComponentName(equippedItem)}
                                            </div>
                                            
                                            {droneStates[slotId] === 'IDLE' && (
                                                <>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleToggleState(slotId, 'IDLE'); }}
                                                        style={{ background: '#00ffcc', color: '#000', border: 'none', padding: '4px 10px', cursor: 'pointer', fontWeight: 'bold' }}
                                                    >
                                                        出击
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleUnequip(slotId); }}
                                                        style={{ background: 'transparent', color: '#ff3333', border: '1px solid #ff3333', padding: '4px 10px', cursor: 'pointer' }}
                                                    >
                                                        卸载
                                                    </button>
                                                </>
                                            )}
                                            
                                            {droneStates[slotId] === 'WORKING' && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleToggleState(slotId, 'WORKING'); }}
                                                    style={{ background: '#ff9900', color: '#000', border: 'none', padding: '4px 10px', cursor: 'pointer', fontWeight: 'bold' }}
                                                >
                                                    召回
                                                </button>
                                            )}

                                            {droneStates[slotId] === 'RETURNING' && (
                                                <div style={{ color: '#aaa', fontSize: '12px', padding: '4px 10px', border: '1px dashed #aaa' }}>
                                                    返航中...
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div style={{ 
                        color: '#555', 
                        fontStyle: 'italic', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        height: '100%',
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        border: '1px dashed #444'
                    }}>
                        该底盘未配备无人机接口
                    </div>
                )}
            </div>
        </div>
    );
};