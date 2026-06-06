import React, { useState } from 'react';
import ItemData from '../../json/ItemData.json';
import EquipmentData from '../../json/EquipmentData.json';
import ModuleDataConfig from '../../json/ModuleData.json';
import { InventoryManager } from '../managers/InventoryManager';

interface ObserveUIProps {
    shipData: any;
    onClose: () => void;
}

export const ObserveUI: React.FC<ObserveUIProps> = ({ shipData, onClose }) => {
    const [pos, setPos] = useState({ x: window.innerWidth / 2 - 300, y: window.innerHeight / 2 - 200 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

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

    // 适配新的库存系统：无论是飞船还是空间站，都从 InventoryManager 查实际货舱
    const inventory = shipData ? InventoryManager.getInventory(shipData.id) : {};
    
    // ShipManager 里的 NPC 实体，装备数据存在 loadout 字段，而不是 slots 字段。
    const slots = shipData?.loadout || shipData?.slots || shipData?.shipRef?.slots || shipData?.shipRef?.loadout || {};
    const hullId = shipData?.hullId || shipData?.shipRef?.hullId;
    const shipName = shipData?.name || hullId || shipData?.id || '未知目标';

    // 传入 shipData 自身作为 fallbackObj，解决微观实体由于 ID 不同导致在宏观列表找不到从而 fallback 到 100 的问题
    const capacity = shipData ? InventoryManager.getCapacity(shipData.id, shipData) : 100;

    // 装备处理
    const getComponentName = (compId: string) => {
        if (!compId) return "空";
        const comps = EquipmentData.COMPONENTS as Record<string, any>;
        return comps[compId]?.meta?.name || compId;
    };

    const hullDef = hullId ? (EquipmentData.HULLS as Record<string, any>)[hullId] : null;

    // 货舱处理
    const inventoryList = Object.entries(inventory).map(([key, count]) => {
        let def = (ItemData.ITEMS as any)[key];
        if (!def) {
            def = Object.values(ItemData.ITEMS).find((v: any) => v.name === key);
        }
        return {
            key,
            count: count as number,
            name: def ? def.name : key
        };
    });

    return (
        <div 
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                top: `${pos.y}px`,
                left: `${pos.x}px`,
                width: '600px',
                height: '400px',
                backgroundColor: 'rgba(10, 20, 30, 0.95)',
                border: '2px solid #ff00ff',
                borderRadius: '8px',
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'auto',
                zIndex: 100000,
                boxShadow: '0 0 20px rgba(255, 0, 255, 0.3)'
            }}>
            {/* Header */}
            <div 
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                style={{
                    padding: '10px 15px',
                    borderBottom: '1px solid rgba(255, 0, 255, 0.3)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: 'rgba(255, 0, 255, 0.1)',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    borderTopLeftRadius: '6px',
                    borderTopRightRadius: '6px',
                }}
            >
                <h3 style={{ margin: 0, color: '#ff00ff', letterSpacing: '1px' }}>🔍 观察数据链: {shipName}</h3>
                <button 
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onClose} 
                    style={{ background: 'none', border: '1px solid #ff3333', color: '#ff3333', padding: '4px 12px', cursor: 'pointer', borderRadius: '4px' }}
                >关闭</button>
            </div>

            {/* 顶部额外信息栏：坐标显示 */}
            <div style={{ padding: '8px 15px', backgroundColor: 'rgba(0, 0, 0, 0.6)', borderBottom: '1px solid rgba(255, 0, 255, 0.2)', fontSize: '13px', color: '#00ffff', display: 'flex', justifyContent: 'space-between' }}>
                <div>当前坐标: X={Math.round(shipData?.location?.x || 0)}, Y={Math.round(shipData?.location?.y || 0)}</div>
                <div>所属星区: {shipData?.location?.sector || '未知'}</div>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* 货舱 */}
                <div style={{ flex: 1, borderRight: '1px solid rgba(255,0,255,0.2)', padding: '15px', overflowY: 'auto' }}>
                    <h4 style={{ color: '#ff00ff', borderBottom: '1px solid #550055', paddingBottom: '8px', marginTop: 0 }}>
                        货舱物资 ({capacity} 吨)
                    </h4>
                    {inventoryList.length === 0 ? <div style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>空空如也</div> : (
                        inventoryList.map(item => (
                            <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', margin: '4px 0', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: '4px', border: '1px solid #333' }}>
                                <span style={{ color: '#ccc' }}>{item.name}</span>
                                <span style={{ color: '#00ffff', fontWeight: 'bold' }}>x{item.count}</span>
                            </div>
                        ))
                    )}
                </div>

                {/* 装备 / 建筑模块 */}
                <div style={{ flex: 1, padding: '15px', overflowY: 'auto' }}>
                    <h4 style={{ color: '#ff00ff', borderBottom: '1px solid #550055', paddingBottom: '8px', marginTop: 0 }}>
                        {shipData?.isStationVirtualShip ? "建筑设施 (Modules)" : "设备装配 (Equipment)"}
                    </h4>
                    
                    {shipData?.isStationVirtualShip && shipData?.stationModulesList ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {shipData.stationModulesList.map((mod: any, index: number) => {
                                // @ts-ignore
                                const modDef = ModuleDataConfig.MODULES?.[mod.moduleId] || (window as any).GameConfig?.MODULES?.[mod.moduleId];
                                const modName = modDef?.name || mod.moduleId;
                                
                                // 处理内部模块
                                let internalModsStr = '';
                                if (mod.internalModules && Object.keys(mod.internalModules).length > 0) {
                                    const installedNames = Object.values(mod.internalModules).map((imod: any) => {
                                        const iId = imod.id || imod;
                                        // @ts-ignore
                                        return ModuleDataConfig.INTERNAL_MODULES?.[iId]?.name || iId;
                                    });
                                    internalModsStr = installedNames.join(' | ');
                                }

                                return (
                                    <div key={mod.uid || index} style={{ 
                                        backgroundColor: 'rgba(255, 0, 255, 0.05)', 
                                        border: '1px solid rgba(255, 0, 255, 0.2)', 
                                        borderRadius: '6px', 
                                        padding: '10px'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ color: '#00ffaa', fontWeight: 'bold', fontSize: '15px' }}>{modName}</div>
                                            <div style={{ fontSize: '12px', color: '#ff00ff' }}>HP: {Math.floor(mod.hp)}/{mod.maxHp}</div>
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#aaa', marginTop: '8px', borderTop: '1px dashed rgba(255,0,255,0.2)', paddingTop: '6px' }}>
                                            <span style={{ color: '#ff00ff' }}>内部设施：</span> 
                                            <span style={{ color: internalModsStr ? '#fff' : '#666' }}>
                                                {internalModsStr ? internalModsStr : '无附加设施'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            {shipData.stationModulesList.length === 0 && (
                                <div style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>无任何设施</div>
                            )}
                        </div>
                    ) : hullDef && hullDef.areas ? (
                        hullDef.areas.map((area: any) => (
                            <div key={area.id} style={{ 
                                backgroundColor: 'rgba(255, 0, 255, 0.05)', 
                                border: '1px solid rgba(255, 0, 255, 0.2)', 
                                borderRadius: '6px', 
                                padding: '10px',
                                marginBottom: '15px'
                            }}>
                                <h5 style={{ margin: '0 0 10px 0', color: '#ff00ff', borderBottom: '1px solid rgba(255,0,255,0.2)', paddingBottom: '5px' }}>
                                    {area.name}
                                </h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {Object.entries(hullDef.slots || {})
                                        .filter(([slotId, slotDef]: [string, any]) => slotDef.area === area.id)
                                        .map(([slotId, slotDef]: [string, any]) => {
                                            const equippedItem = slots[slotId];
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
                    ) : hullDef && hullDef.slots ? (
                        // Fallback for ships without areas defined
                        Object.entries(hullDef.slots).map(([slotId, slotDef]: [string, any]) => {
                            const equippedItem = slots[slotId];
                            return (
                                <div key={slotId} style={{ marginBottom: '10px', padding: '8px 12px', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: '4px', border: '1px solid #333' }}>
                                    <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>{slotId} (尺寸: {slotDef.size})</div>
                                    <div style={{ color: equippedItem ? '#00ffaa' : '#555', fontWeight: 'bold' }}>
                                        {getComponentName(equippedItem)}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>无公开装配信息</div>
                    )}
                    
                    {/* 无人机配置 */}
                    {hullDef && hullDef.droneSlots && Object.keys(hullDef.droneSlots).length > 0 && !shipData?.isStationVirtualShip && (
                        <div style={{ 
                            backgroundColor: 'rgba(0, 255, 204, 0.05)', 
                            border: '1px solid rgba(0, 255, 204, 0.2)', 
                            borderRadius: '6px', 
                            padding: '10px',
                            marginTop: '15px'
                        }}>
                            <h5 style={{ margin: '0 0 10px 0', color: '#00ffcc', borderBottom: '1px solid rgba(0,255,204,0.2)', paddingBottom: '5px' }}>
                                无人机配置
                            </h5>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {Object.entries(hullDef.droneSlots).map(([slotId, slotDef]: [string, any]) => {
                                    const droneEquips = shipData?.droneEquips || shipData?.shipRef?.droneEquips || {};
                                    const droneStates = shipData?.droneStates || shipData?.shipRef?.droneStates || {};
                                    const equippedItem = droneEquips[slotId];
                                    const currentState = droneStates[slotId] || 'IDLE';

                                    let stateColor = '#666';
                                    let stateText = '待命中';
                                    if (currentState === 'WORKING') { stateColor = '#ff9900'; stateText = '出击中'; }
                                    else if (currentState === 'RETURNING') { stateColor = '#aaa'; stateText = '返航中'; }

                                    let itemName = '空';
                                    if (equippedItem) {
                                        const def = (ItemData.ITEMS as any)[equippedItem];
                                        if (def) itemName = def.name;
                                        else itemName = getComponentName(equippedItem);
                                    }

                                    return (
                                        <div key={slotId} style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'center',
                                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                            padding: '8px 12px',
                                            borderRadius: '4px',
                                            border: equippedItem ? '1px solid rgba(0, 255, 204, 0.3)' : '1px dashed rgba(255, 255, 255, 0.2)'
                                        }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                    <div style={{ color: '#fff', fontWeight: 'bold' }}>{slotId} - {slotDef.desc || '无人机槽'}</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <div style={{ color: equippedItem ? '#00ffaa' : '#666', fontWeight: 'bold' }}>
                                                            {itemName}
                                                        </div>
                                                        {equippedItem && (
                                                            <div style={{ fontSize: '12px', color: stateColor, padding: '2px 6px', border: `1px solid ${stateColor}`, borderRadius: '3px' }}>
                                                                {stateText}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 显示未分配区域的槽位 (容错处理) */}
                    {hullDef && Object.entries(hullDef.slots || {}).filter(([_, slotDef]: [string, any]) => !slotDef.area).length > 0 && (
                        <div style={{ 
                            backgroundColor: 'rgba(255, 100, 100, 0.05)', 
                            border: '1px solid rgba(255, 100, 100, 0.2)', 
                            borderRadius: '6px', 
                            padding: '10px',
                            marginTop: hullDef.areas ? '15px' : '0'
                        }}>
                            <h5 style={{ margin: '0 0 10px 0', color: '#ff6666', borderBottom: '1px solid rgba(255,100,100,0.2)', paddingBottom: '5px' }}>
                                未分配区域的槽位
                            </h5>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {Object.entries(hullDef.slots || {})
                                    .filter(([_, slotDef]: [string, any]) => !slotDef.area)
                                    .map(([slotId, slotDef]: [string, any]) => {
                                        const equippedItem = slots[slotId];
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
            </div>
        </div>
    );
};
