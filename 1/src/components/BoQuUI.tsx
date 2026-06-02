import React, { useState } from 'react';

interface BoQuUIProps {
    onClose: () => void;
    moduleData?: any;
}

import { BuildingManager } from '../managers/BuildingManager';
import { ShipManager } from '../managers/ShipManager';
import GameConfig from '../../json/ModuleData.json';
import DockingLayoutConfig from '../../json/DockingLayout.json';

export const BoQuUI: React.FC<BoQuUIProps> = ({ onClose, moduleData }) => {
    // Read berths configuration from JSON
    const moduleId = moduleData?.moduleId || 'dock_berth';
    const modConfig = (GameConfig as any).MODULES[moduleId];
    const berths = modConfig?.berths || [];
    
    // Read UI Layout from the new separate layout JSON
    const uiLayout = (DockingLayoutConfig as any)[moduleId];
    const capacity = berths.length || 7;

    const [dockedShips, setDockedShips] = useState<any[]>([]);

    // 实时读取全局泊位注册表和 ShipManager 数据
    React.useEffect(() => {
        const updateDockedShips = () => {
            const registry = (window as any).BerthRegistry || {};
            const activeShips: any[] = [];
            const processedShipIds = new Set<string>();
            
            // 尝试获取实际的模块 UID
            let targetUid = moduleData?.uid;
            if (!targetUid) {
                const mod = BuildingManager.getAllModules().find(m => m.moduleId === moduleId);
                if (mod) targetUid = mod.uid;
            }

            // 我们需要放宽判断条件。对于玩家手动发起的申请，UI 内部的 moduleId 可能跟 targetUid 存在匹配不上的问题。
            // 获取当前模块的可能标识列表
            const matchIds = [targetUid, moduleId, moduleData?.moduleId, 'station'].filter(Boolean);

            // 1. 先从全局正在分配的注册表里读取 (包含正在路上和刚停好的)
            for (const [shipId, record] of Object.entries(registry)) {
                if (matchIds.includes((record as any).moduleId)) {
                    const shipObj = ShipManager.getShipById(shipId);
                    if (shipObj) {
                        activeShips.push({
                            id: shipObj.id,
                            name: shipObj.name || `舰船 ${shipObj.id.substring(0, 4)}`,
                            owner: shipObj.ownerId === 'player' ? '玩家' : (shipObj.factionId === 0 ? '中立' : 'AI'),
                            status: (record as any).status === 'APPROACHING' ? '接近中' : '已停靠',
                            berthId: (record as any).berthId,
                            time: '--',
                            categoryCode: shipObj.type === 'freighter' ? '商' : (shipObj.type === 'fighter' ? '战' : '舰'),
                            maxCapacity: shipObj.maxInventory || 0
                        });
                        processedShipIds.add(shipObj.id);
                    }
                }
            }
            
            // 2. 兜底：从 ShipManager 宏观数据里读取早已停靠的飞船
            // 用户反馈不要匹配旧存档（比如读档前停靠且没有泊位ID的旧数据，避免影响展示逻辑和新逻辑）
            // 我们只获取有明确合法 dockedBerthId 并且在当前基地的飞船
            const dockedInManager = ShipManager.ships.filter(s => matchIds.includes(s.dockedAt) && (s as any).dockedBerthId);
            for (const shipObj of dockedInManager) {
                if (!processedShipIds.has(shipObj.id)) {
                    activeShips.push({
                        id: shipObj.id,
                        name: shipObj.name || `舰船 ${shipObj.id.substring(0, 4)}`,
                        owner: shipObj.ownerId === 'player' ? '玩家' : (shipObj.factionId === 0 ? '中立' : 'AI'),
                        status: '已停靠',
                        berthId: (shipObj as any).dockedBerthId,
                        time: '--',
                        categoryCode: shipObj.type === 'freighter' ? '商' : (shipObj.type === 'fighter' ? '战' : '舰'),
                        maxCapacity: shipObj.maxInventory || 0
                    });
                    processedShipIds.add(shipObj.id);
                }
            }

            setDockedShips(activeShips);
        };

        updateDockedShips(); // 初始化读取
        const intervalId = setInterval(updateDockedShips, 1000); // 每秒刷新

        return () => clearInterval(intervalId);
    }, [moduleData?.uid, moduleId]);

    // Drag handlers
    const [pos, setPos] = useState({ x: window.innerWidth * 0.2, y: window.innerHeight * 0.2 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

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

    return (
        <div 
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
            position: 'absolute',
            top: `${pos.y}px`,
            left: `${pos.x}px`,
            width: '60%',
            height: '60%',
            minWidth: '600px',
            minHeight: '400px',
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
            {/* Top Cyan Header */}
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
                    borderTopLeftRadius: '6px',
                    borderTopRightRadius: '6px',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none'
                }}
            >
                <h2 style={{ margin: 0, color: '#00ffff', textShadow: '0 0 5px #00ffff', letterSpacing: '2px', fontSize: '20px' }}>
                    泊区管理终端 {moduleData?.name ? `- ${moduleData.name.toUpperCase()}` : ''}
                </h2>
                <button 
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onClose}
                    style={{
                        background: 'none', border: '1px solid #ff3333', color: '#ff3333', 
                        padding: '5px 15px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold',
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 51, 51, 0.2)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                    关闭
                </button>
            </div>

            {/* Main Body */}
            <div style={{
                display: 'flex',
                flex: 1,
                overflow: 'hidden',
                padding: '20px',
                gap: '20px'
            }}>
                {/* Left Side: Overview & Capacity */}
                <div style={{
                    width: '35%',
                    backgroundColor: 'rgba(0, 255, 255, 0.05)',
                    border: '1px solid rgba(0, 255, 255, 0.2)',
                    borderRadius: '6px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <h3 style={{ margin: '0 0 20px 0', color: '#00ffff', borderBottom: '1px solid rgba(0, 255, 255, 0.2)', paddingBottom: '10px' }}>泊位状态总览</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                        {uiLayout ? (
                            (function renderNode(node: any, index: number = 0): React.ReactNode {
                                if (node.type === 'div') {
                                    return (
                                        <div key={`node-${index}`} style={node.style || {}}>
                                            {node.children && node.children.map((child: any, childIndex: number) => 
                                                renderNode(child, childIndex)
                                            )}
                                        </div>
                                    );
                                } else if (node.type === 'berth_slot') {
                                    const berthId = node.berthId;
                                    const shipInBerth = dockedShips.find(s => s.berthId === berthId);
                                    const isOccupied = !!shipInBerth;

                                    return (
                                        <div key={berthId || `slot-${index}`} style={{
                                            ...(node.style || {}),
                                            backgroundColor: isOccupied ? 'rgba(0, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.3)',
                                            border: isOccupied ? '1px solid #00ffff' : '1px dashed rgba(0, 255, 255, 0.15)',
                                            boxShadow: isOccupied ? 'inset 0 0 15px rgba(0, 255, 255, 0.2)' : 'none',
                                            borderRadius: '4px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            position: 'relative',
                                            overflow: 'hidden'
                                        }}>
                                            {isOccupied ? (
                                                <>
                                                    {/* 主黄色大字 (如果能从飞船数据提取类别代号更好，目前暂用固定字或ID首字母) */}
                                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '5px' }}>
                                                        <span style={{ color: '#ffcc00', fontSize: '24px', fontWeight: 'bold', textShadow: '0 0 10px rgba(255, 204, 0, 0.5)' }}>
                                                            {shipInBerth.categoryCode || 'S'}
                                                        </span>
                                                        <span style={{ color: '#888', fontSize: '12px' }}>/ {shipInBerth.maxCapacity || 5}</span>
                                                    </div>
                                                    {/* 底部青色小字说明 */}
                                                    <div style={{ color: '#00ffff', fontSize: '10px', letterSpacing: '1px' }}>已占用泊位</div>
                                                    {/* 极简进度条或底线 */}
                                                    <div style={{ position: 'absolute', bottom: '0', left: '10%', width: '80%', height: '3px', display: 'flex' }}>
                                                        <div style={{ flex: 0.7, backgroundColor: '#00ffff', boxShadow: '0 0 5px #00ffff' }}></div>
                                                        <div style={{ flex: 0.3, backgroundColor: '#333' }}></div>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div style={{ color: 'rgba(0, 255, 255, 0.2)', fontSize: '12px', fontStyle: 'italic', letterSpacing: '1px' }}>
                                                        [ 空闲 ]
                                                    </div>
                                                    {/* 空闲底线 */}
                                                    <div style={{ position: 'absolute', bottom: '0', left: '10%', width: '80%', height: '1px', backgroundColor: 'rgba(0, 255, 255, 0.1)' }}></div>
                                                </>
                                            )}
                                        </div>
                                    );
                                }
                                return null;
                            })(uiLayout)
                        ) : (
                            <div style={{ color: '#555', fontStyle: 'italic' }}>暂无总览视图配置</div>
                        )}
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px', marginTop: '20px', fontSize: '14px', color: '#aaa' }}>
                        <div><span style={{ color: '#00ffff' }}>系统:</span> 自动引导协议在线</div>
                        <div style={{ marginTop: '5px' }}><span style={{ color: '#00ffff' }}>能源:</span> 供应稳定</div>
                    </div>
                </div>

                {/* Right Side: Docked Ships List */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#fff', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#ffcc00' }}>▶</span> 当前停靠飞船名单
                    </h3>
                    
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '10px' }}>
                        {dockedShips.length > 0 ? dockedShips.map((ship, index) => (
                            <div key={ship.id} style={{
                                backgroundColor: ship.owner === '玩家' ? 'rgba(0, 255, 204, 0.1)' : 'rgba(0, 0, 0, 0.5)',
                                border: ship.owner === '玩家' ? '1px solid #00ffcc' : '1px dashed rgba(255, 255, 255, 0.2)',
                                borderRadius: '6px',
                                padding: '15px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                transition: 'all 0.2s',
                                cursor: 'pointer'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.backgroundColor = ship.owner === '玩家' ? 'rgba(0, 255, 204, 0.2)' : 'rgba(255, 255, 255, 0.05)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.backgroundColor = ship.owner === '玩家' ? 'rgba(0, 255, 204, 0.1)' : 'rgba(0, 0, 0, 0.5)';
                            }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: ship.owner === '玩家' ? '#00ffcc' : '#fff' }}>
                                        {ship.name}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#aaa', display: 'flex', gap: '15px' }}>
                                        <span>隶属: <span style={{ color: '#fff' }}>{ship.owner}</span></span>
                                        <span>ID: {ship.id}</span>
                                    </div>
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
                                    <div style={{ 
                                        padding: '3px 8px', 
                                        borderRadius: '3px', 
                                        fontSize: '12px',
                                        backgroundColor: ship.status === '补给中' ? 'rgba(255, 204, 0, 0.2)' : 'rgba(0, 255, 255, 0.2)',
                                        color: ship.status === '补给中' ? '#ffcc00' : '#00ffff',
                                        border: `1px solid ${ship.status === '补给中' ? '#ffcc00' : '#00ffff'}`
                                    }}>
                                        {ship.status}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>剩余时间: {ship.time}</div>
                                </div>
                            </div>
                        )) : (
                            <div style={{ textAlign: 'center', color: '#888', marginTop: '50px', fontSize: '18px' }}>
                                目前没有飞船停靠。
                            </div>
                        )}
                        
                        {/* Empty Docking Bay Slots Placeholders */}
                        {/* Since we have the 7-grid layout on the left, we can choose to just show the docked list on the right, or keep the empty placeholders. We will keep them for clarity of the right-side list. */}
                        {berths.map((berth: any, index: number) => {
                            const shipInBerth = dockedShips.find(s => s.berthId === berth.id);
                            if (shipInBerth) return null; // Already rendered above

                            return (
                                <div key={`empty-list-${berth.id}`} style={{
                                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                    border: '1px dashed rgba(0, 255, 255, 0.3)',
                                    borderRadius: '6px',
                                    padding: '15px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '40px',
                                    color: '#555',
                                    fontStyle: 'italic'
                                }}>
                                    [ {berth.id.replace('berth_', '泊位 ')} - 空闲 ]
                                </div>
                            );
                        })}
                    </div>
                    
                    {/* Apply Docking Button */}
                    <button 
                        style={{
                            marginTop: '15px',
                            padding: '12px',
                            backgroundColor: 'rgba(0, 255, 255, 0.1)',
                            border: '1px solid #00ffff',
                            borderRadius: '6px',
                            color: '#00ffff',
                            fontSize: '16px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            boxShadow: '0 0 10px rgba(0, 255, 255, 0.2)',
                            letterSpacing: '2px',
                            pointerEvents: 'auto'
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            document.dispatchEvent(new CustomEvent('ui_apply_docking', { 
                                detail: { moduleId: moduleData?.uid || 'station' } 
                            }));
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.2)';
                            e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 255, 255, 0.4)';
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.1)';
                            e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 255, 255, 0.2)';
                        }}
                    >
                        申请停靠
                    </button>
                </div>
            </div>
        </div>
    );
};
