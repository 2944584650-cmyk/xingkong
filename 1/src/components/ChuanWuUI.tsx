import React, { useState } from 'react';
import EquipmentData from '../../json/EquipmentData.json';
import { BuildingManager } from '../managers/BuildingManager';
import { EventBus } from '../utils/EventBus';

interface ChuanWuUIProps {
    onClose: () => void;
    moduleData?: any;
}

export const ChuanWuUI: React.FC<ChuanWuUIProps> = ({ onClose, moduleData }) => {
    // Drag handlers
    const [pos, setPos] = useState({ x: window.innerWidth * 0.1, y: window.innerHeight * 0.1 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // 选择船体数据
    const [showHullSelect, setShowHullSelect] = useState(false);
    const [selectedHullKey, setSelectedHullKey] = useState<string>("hull_empire_s");
    
    // @ts-ignore
    const selectedHullData = EquipmentData.HULLS[selectedHullKey] || EquipmentData.HULLS["hull_empire_s"];

    // 槽位与装备配置
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
    const [equippedComponents, setEquippedComponents] = useState<Record<string, string>>({});

    const totalCost = React.useMemo(() => {
        let cost = selectedHullData.price || 0;
        Object.values(equippedComponents).forEach(compId => {
            // @ts-ignore
            const comp = EquipmentData.COMPONENTS[compId];
            if (comp) cost += comp.meta.price || 0;
        });
        return cost;
    }, [selectedHullData, equippedComponents]);

    const handleDragStart = (e: React.PointerEvent) => {
        setIsDragging(true);
        setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handleDragMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    };

    const handleDragEnd = (e: React.PointerEvent) => {
        setIsDragging(false);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    };

    const handleStartBuild = () => {
        const sourceModuleUid = moduleData?.module?.uid || moduleData?.uid || moduleData?.id || 'unknown_module_id';
        
        // 关键修复：建造订单的星区属性必须强绑定到触发该界面的建筑模块的自带 sector。
        const targetSector = moduleData?.sector || moduleData?.module?.sector;
        
        if (!targetSector) {
            console.error("[ChuanWuUI] 致命错误：当前交互的船坞模块数据中没有自带的 sector 属性！", moduleData);
            alert("系统数据错误：无法识别当前船坞所在的星区坐标，建造指令已熔断！请检查模块数据加载逻辑。");
            return;
        }

        const mod = moduleData?.module;
        let spawnX = 500;
        let spawnY = 275;
        let finalSpawnRot = 0;
        
        if (mod) {
            const GRID_PIXEL_SIZE = 550;
            // BuildingManager.gridToWorld 并没有基础偏移量
            const worldX = mod.gridX * GRID_PIXEL_SIZE;
            const worldY = mod.gridY * GRID_PIXEL_SIZE;
            
            // 使用 mod.width 和 mod.height，因为它们已经是旋转后的占地网格数
            const pixelW = (mod.width || 1) * GRID_PIXEL_SIZE;
            const pixelH = (mod.height || 1) * GRID_PIXEL_SIZE;
            
            const centerX = worldX + pixelW / 2;
            const centerY = worldY + pixelH / 2;

            let ox = moduleData?.spawnOffset?.x || 0;
            let oy = moduleData?.spawnOffset?.y || 0;
            let baseSpawnRot = moduleData?.spawnRotation || 0;
            const rot = mod.rotation || 0;
            
            let finalOx = ox;
            let finalOy = oy;
            
            if (rot === 90) {
                finalOx = -oy;
                finalOy = ox;
            } else if (rot === 180) {
                finalOx = -ox;
                finalOy = -oy;
            } else if (rot === 270) {
                finalOx = oy;
                finalOy = -ox;
            }
            
            spawnX = centerX + finalOx;
            spawnY = centerY + finalOy;
            finalSpawnRot = (baseSpawnRot + rot) % 360;
        }

        const buildData = {
            isBuilding: true,
            sourceModuleId: sourceModuleUid, // 关键：绑定具体建筑的唯一实例 ID
            hullId: selectedHullKey,
            loadout: equippedComponents, // ShipManager 里叫 loadout，这里映射一下
            factionId: 0, // 假设船厂生成的归属于玩家
            ownerId: 'player',
            type: 'fighter', // 默认占位，ShipManager.recalculateStats 会修复它
            location: {
                sector: targetSector,
                x: spawnX,
                y: spawnY
            },
            rotation: finalSpawnRot,
            timestamp: Date.now(), // 记录下单时间
            name: selectedHullData.name // 记录一下名字方便UI展示
        };
        
        // 【修改】将订单压入对应模块的队列，而不是直接抛出事件生成虚影
        const success = BuildingManager.addBuildOrder(sourceModuleUid, buildData);
        
        if (success) {
            console.log("【开始建造】已向船坞投递排队订单:", buildData);
            alert("已将建造订单下发至船坞排队！您可以继续下单，船坞会自动按顺序建造。");
            // 不关闭窗口，让用户可以连续下单，通过状态触发重新渲染
            setPos({ ...pos }); // 触发一下重新渲染以更新预设面板的队列显示
        } else {
            alert("下单失败，找不到对应的船坞模块数据！");
        }
    };

    // 监听底层刷新事件
    React.useEffect(() => {
        const handler = (e: any) => {
            const uid = e.detail?.uid;
            const sourceModuleUid = moduleData?.module?.uid || moduleData?.uid || moduleData?.id;
            if (uid === sourceModuleUid) {
                // 触发刷新
                setPos(p => ({ ...p }));
            }
        };
        document.addEventListener('ui_chuanwu_refresh', handler);
        return () => document.removeEventListener('ui_chuanwu_refresh', handler);
    }, [moduleData]);

    // 获取当前模块的实时队列数据
    const sourceModuleUid = moduleData?.module?.uid || moduleData?.uid || moduleData?.id;
    const currentModule = BuildingManager.stationModules.find(m => m.uid === sourceModuleUid);
    const currentQueue = currentModule?.buildQueue || [];

    return (
        <div 
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
            position: 'absolute',
            top: `${pos.y}px`,
            left: `${pos.x}px`,
            width: '80vw',
            height: '80vh',
            minWidth: '800px',
            minHeight: '500px',
            backgroundColor: 'rgba(10, 20, 30, 0.95)',
            border: '2px solid #00ffff',
            borderRadius: '8px',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            zIndex: 100000,
            boxShadow: '0 0 20px rgba(0, 255, 255, 0.3)',
            overflow: 'hidden'
        }}>
            {/* Top Header / Drag handle */}
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
                <h2 style={{ margin: 0, color: '#00ffff', textShadow: '0 0 5px #00ffff' }}>
                    造船厂终端 {moduleData?.name ? `- ${moduleData.name}` : ''}
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

            {/* Main Content: 3-Column Layout */}
            <div style={{
                display: 'flex',
                flex: 1,
                width: '100%',
                height: '100%'
            }}>
                {/* Left Column */}
                <div style={{
                    width: '25%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRight: '1px solid rgba(0, 255, 255, 0.3)',
                    padding: '20px'
                }}>
                    {/* 第一份: 最小，只容纳一个按钮 */}
                    <div style={{ position: 'relative' }}>
                        <button 
                            onClick={() => setShowHullSelect(!showHullSelect)}
                            style={{
                                width: '100%',
                                padding: '10px',
                                background: 'rgba(0, 255, 255, 0.1)',
                                border: '1px solid #00ffff',
                                color: '#00ffff',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            切换底盘
                        </button>

                        {/* 下拉选择底盘菜单 */}
                        {showHullSelect && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: '0',
                                right: '0',
                                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                                borderRadius: '4px',
                                zIndex: 100,
                                maxHeight: '300px',
                                overflowY: 'auto',
                                border: '1px solid #00ffff'
                            }}>
                                {Object.entries(EquipmentData.HULLS)
                                    .filter(([key, hull]: [string, any]) => hull.type !== 'drone')
                                    .map(([key, hull]: [string, any]) => (
                                        <div 
                                            key={key}
                                            onClick={() => {
                                                setSelectedHullKey(key);
                                                setShowHullSelect(false);
                                                setSelectedSlotId(null);
                                                setEquippedComponents({});
                                            }}
                                            style={{
                                                padding: '10px 15px',
                                                borderBottom: '1px solid rgba(0,255,255,0.2)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                transition: 'background-color 0.2s'
                                            }}
                                            onMouseOver={e => e.currentTarget.style.backgroundColor = 'rgba(0,255,255,0.2)'}
                                            onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <span style={{ fontWeight: 'bold', color: '#00ffff' }}>{hull.name}</span>
                                            <span style={{ fontSize: '12px', color: '#aaa' }}>{hull.price} 星币</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>

                    {/* 第二份: 槽位配置 (占据剩余空间，允许滚动) */}
                    <div style={{
                        flex: 1,
                        paddingTop: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0, // 关键：允许子元素溢出滚动
                        borderBottom: '1px solid rgba(0,255,255,0.3)',
                        paddingBottom: '20px'
                    }}>
                        <h3 style={{ margin: '0 0 10px 0', color: '#aaaaff', flexShrink: 0 }}>槽位配置</h3>
                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '5px' }}>
                            {Object.entries(selectedHullData.slots || {}).map(([slotId, slotInfo]: [string, any]) => {
                                const equippedId = equippedComponents[slotId];
                                // @ts-ignore
                                const equippedComp = equippedId ? EquipmentData.COMPONENTS[equippedId] : null;
                                const isSelected = selectedSlotId === slotId;
                                
                                return (
                                    <div 
                                        key={slotId} 
                                        onClick={() => setSelectedSlotId(slotId)}
                                        style={{ 
                                            display: 'flex', 
                                            flexDirection: 'column',
                                            padding: '10px',
                                            backgroundColor: isSelected ? 'rgba(0, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.4)',
                                            border: isSelected ? '1px solid #00ffff' : '1px solid rgba(0, 255, 255, 0.2)',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            boxShadow: isSelected ? '0 0 10px rgba(0, 255, 255, 0.2)' : 'none'
                                        }}
                                        onMouseOver={e => {
                                            if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.05)';
                                        }}
                                        onMouseOut={e => {
                                            if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                            <span style={{ 
                                                fontWeight: 'bold', 
                                                color: isSelected ? '#00ffff' : '#fff',
                                                fontSize: '15px'
                                            }}>
                                                {slotId} - {slotInfo.desc}
                                            </span>
                                            <span style={{ 
                                                fontSize: '12px', 
                                                backgroundColor: 'rgba(0, 0, 0, 0.5)', 
                                                border: `1px solid ${isSelected ? '#00ffff' : 'rgba(0, 255, 255, 0.3)'}`,
                                                color: isSelected ? '#00ffff' : '#aaa',
                                                padding: '2px 6px', 
                                                borderRadius: '3px' 
                                            }}>
                                                {slotInfo.size}型
                                            </span>
                                        </div>
                                        
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center',
                                            marginTop: '4px',
                                            padding: '6px',
                                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                            borderRadius: '4px',
                                            borderLeft: `2px solid ${equippedComp ? '#00ffff' : '#444'}`
                                        }}>
                                            <span style={{ 
                                                fontSize: '14px', 
                                                color: equippedComp ? '#00ffff' : '#666',
                                                fontStyle: equippedComp ? 'normal' : 'italic'
                                            }}>
                                                {equippedComp ? `◆ ${equippedComp.meta.name}` : '未装备任何模块'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 第三份: 建造队列展示 */}
                    <div style={{
                        flex: 1,
                        paddingTop: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0 // 允许滚动
                    }}>
                        <h3 style={{ margin: '0 0 10px 0', color: '#ffaa00', flexShrink: 0 }}>船坞建造队列</h3>
                        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '5px' }}>
                            {currentQueue.length === 0 ? (
                                <div style={{ color: '#aaa', textAlign: 'center', marginTop: '20px' }}>当前队列为空</div>
                            ) : (
                                currentQueue.map((order: any, index: number) => (
                                    <div key={order.timestamp + '_' + index} style={{ 
                                        padding: '10px', 
                                        backgroundColor: 'rgba(0, 0, 0, 0.4)', 
                                        border: '1px solid rgba(255, 170, 0, 0.3)', 
                                        borderRadius: '6px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ color: '#ffaa00', fontWeight: 'bold' }}>{index + 1}. {order.name || order.hullId}</span>
                                            <span style={{ color: '#aaa', fontSize: '12px' }}>装备数量: {Object.keys(order.loadout || {}).length}</span>
                                        </div>
                                        {index === 0 && <span style={{ fontSize: '12px', color: '#00ffff', padding: '2px 4px', border: '1px solid #00ffff', borderRadius: '4px' }}>待出列</span>}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Middle Column */}
                <div style={{
                    width: '50%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px',
                }}>
                    {/* 图片展示区 - 尽可能拉伸居中 */}
                    <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        padding: '10px'
                    }}>
                        <img 
                            src={`assets/${selectedHullData.sprite}`} 
                            alt={selectedHullData.name}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                imageRendering: 'pixelated',
                                filter: 'drop-shadow(0px 10px 20px rgba(0, 255, 255, 0.3))'
                            }} 
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                e.currentTarget.parentElement!.innerHTML = '<div style="color: #888; font-size: 24px; border: 2px dashed #00ffff; padding: 50px; border-radius: 10px; background: rgba(0,0,0,0.5)">[ 暂无底盘图片 ]</div>';
                            }}
                        />
                    </div>
                </div>

                {/* Right Column */}
                <div style={{
                    width: '25%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderLeft: '1px solid rgba(0, 255, 255, 0.3)',
                    padding: '20px'
                }}>
                    {/* 上方 3/5 区域: 可选模块 */}
                    <div style={{
                        flex: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        borderBottom: '1px solid rgba(0,255,255,0.3)',
                        paddingBottom: '20px'
                    }}>
                        <h3 style={{ margin: '0 0 10px 0', color: '#aaaaff' }}>可选装备</h3>
                        
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto', paddingRight: '5px' }}>
                            {(() => {
                                if (!selectedSlotId) {
                                    return <div style={{ color: '#aaa', textAlign: 'center', marginTop: '20px' }}>请先在左侧选择一个槽位</div>;
                                }

                                const slotData = selectedHullData.slots[selectedSlotId];
                                
                                // 定义槽位大小级别，小数值表示槽位更小
                                const sizeRank: Record<string, number> = {
                                    'S': 1,
                                    'M': 2,
                                    'L': 3,
                                    'XL': 4
                                };
                                const slotSizeRank = sizeRank[slotData.size] || 0;

                                const availableComps = Object.entries(EquipmentData.COMPONENTS).filter(([compId, comp]: [string, any]) => {
                                    if (comp.type !== slotData.type) return false;
                                    
                                    // 允许安装体积小于或等于槽位容量的装备
                                    const compSizeRank = sizeRank[comp.meta.size] || 0;
                                    if (compSizeRank > slotSizeRank) return false;

                                    return true;
                                });

                                if (availableComps.length === 0) {
                                    return <div style={{ color: '#aaa', textAlign: 'center', marginTop: '20px' }}>无合适装备</div>;
                                }

                                return (
                                    <>
                                        {/* 卸下装备选项 */}
                                        <div 
                                            onClick={() => {
                                                const newEq = { ...equippedComponents };
                                                delete newEq[selectedSlotId];
                                                setEquippedComponents(newEq);
                                            }}
                                            style={{
                                                display: 'flex', justifyContent: 'center', background: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', border: !equippedComponents[selectedSlotId] ? '1px solid #ff3333' : '1px solid rgba(255,51,51,0.3)',
                                                color: '#ff3333'
                                            }}
                                        >
                                            <span>卸下当前装备</span>
                                        </div>
                                        
                                        {availableComps.map(([compId, comp]: [string, any]) => (
                                            <div 
                                                key={compId}
                                                onClick={() => {
                                                    setEquippedComponents(prev => ({
                                                        ...prev,
                                                        [selectedSlotId]: compId
                                                    }));
                                                }}
                                                style={{ 
                                                    display: 'flex', justifyContent: 'space-between', background: equippedComponents[selectedSlotId] === compId ? 'rgba(0,255,255,0.2)' : 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', cursor: 'pointer', 
                                                    border: equippedComponents[selectedSlotId] === compId ? '1px solid #00ffff' : '1px solid rgba(0,255,255,0.3)',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ color: equippedComponents[selectedSlotId] === compId ? '#00ffff' : '#fff' }}>{comp.meta.name}</span>
                                                    <span style={{ fontSize: '12px', color: '#aaa' }}>{comp.meta.price} 星币</span>
                                                </div>
                                                <span style={{ fontSize: '12px', background: '#000', border: '1px solid #00ffff', color: '#00ffff', padding: '2px 6px', borderRadius: '4px', height: 'fit-content' }}>
                                                    {comp.meta.size}槽
                                                </span>
                                            </div>
                                        ))}
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* 下方 2/5 区域: 建造成本和开始建造按钮 */}
                    <div style={{
                        flex: 2,
                        paddingTop: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                    }}>
                        {/* 建造成本 */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '5px', marginBottom: '15px' }}>
                            <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid rgba(0,255,255,0.3)', paddingBottom: '5px', color: '#aaaaff' }}>总计成本</h4>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                                <span style={{ color: '#aaa' }}>星币:</span>
                                <span style={{ color: '#00ffff' }}>{totalCost}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginTop: '5px' }}>
                                <span style={{ color: '#aaa' }}>预计耗时:</span>
                                <span style={{ color: '#00ffff' }}>00:05:00</span>
                            </div>
                        </div>

                        <button 
                            onClick={handleStartBuild}
                            style={{
                                padding: '12px',
                                background: 'rgba(0, 255, 255, 0.2)',
                                color: '#00ffff',
                                border: '1px solid #00ffff',
                                borderRadius: '4px',
                                fontSize: '18px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                marginTop: 'auto'
                            }}
                            onMouseOver={e => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.4)'}
                            onMouseOut={e => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.2)'}
                        >
                            开始建造
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
