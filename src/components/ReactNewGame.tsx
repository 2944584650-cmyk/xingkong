import React, { useState, useEffect } from 'react';
import { EventBus } from '../utils/EventBus';
import { GameConfig } from '../config';
import { initPhaserGame } from '../main';

export const ReactNewGame: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'career' | 'ship'>('career');
    const [selectedLocation, setSelectedLocation] = useState('创世星柱废墟');
    const [selectedShip, setSelectedShip] = useState('hull_scavenger_s');
    const [sectors, setSectors] = useState<{name: string, description: string}[]>([]);

    useEffect(() => {
        // 读取全部星区数据
        fetch('./json/StarmapData.json')
            .then(res => res.json())
            .then(data => {
                if (data && data.sectors) {
                    setSectors(data.sectors);
                }
            })
            .catch(err => console.error("加载星图数据失败:", err));
    }, []);

    const handleStartJourney = () => {
        localStorage.setItem('current_sector', selectedLocation);
        
        // 强制清理旧宇宙数据，确保生成全新的随机空间站和星图配置
        localStorage.removeItem('world_state');
        
        // 在触发开局事件之前，主动初始化一次带有空间站数据的纯净存档
        import('../scenes/WorldbookManager').then(m => {
            const defaultState = m.WorldbookManager.getWorldState();
            m.WorldbookManager.saveWorldState(defaultState);
            
            // 重要：新建游戏时，首先强制重写一个“空存档”来覆盖可能残留的脏数据，并确保拥有最新的默认数据
            // 我们将所有管理器的数据落盘到 localStorage 中
            import('../managers/PlayerManager').then(pm => {
                import('../managers/ShipManager').then(sm => {
                    import('../managers/BuildingManager').then(bm => {
                        try {
                            if ((pm.PlayerManager as any).reset) (pm.PlayerManager as any).reset();
                            if ((sm.ShipManager as any).reset) (sm.ShipManager as any).reset();
                            if ((bm.BuildingManager as any).reset) (bm.BuildingManager as any).reset();
                        } catch (e) {}

                        const initialStats = pm.PlayerManager.getStats();
                        initialStats.credits = 1000;
                        initialStats.hullId = selectedShip;
                        initialStats.slots = {"W1": "laser_mk1", "D1": "armor_titanium", "E1": "engine_basic_s"};
                        
                        // 生成座驾与编队
                        const initShipId = 'ship_' + Date.now();
                        let initialMaxHp = 100;
                        const hDef = GameConfig.HULLS[selectedShip];
                        if (hDef) initialMaxHp = hDef.baseHp;
                        Object.values(initialStats.slots || {}).forEach(cId => {
                            const cDef = (GameConfig.COMPONENTS as Record<string, any>)[cId as string];
                            if (cDef && cDef.type === 'defense' && cDef.stats && cDef.stats.hpBonus) {
                                initialMaxHp += cDef.stats.hpBonus;
                            }
                        });

                        const initShip = {
                            id: initShipId,
                            name: '我的座驾',
                            hullId: selectedShip,
                            slots: initialStats.slots,
                            turretRules: {},
                            hp: initialMaxHp
                        };

                        initialStats.ownedShips = [initShip];
                        initialStats.playerShipId = initShipId;
                        
                        initialStats.fleets = [{
                            id: 'fleet_1',
                            name: '第一中队',
                            flagshipId: initShipId,
                            members: [],
                            orders: 'follow_leader'
                        }];

                        pm.PlayerManager.saveStats(initialStats);
                        localStorage.setItem('game_has_started_v3', '1');

                        // 注册到宏观宇宙，使其成为一个普通的物理实体
                        sm.ShipManager.createShip({
                            id: initShipId,
                            type: GameConfig.HULLS[selectedShip]?.type === 'freighter' ? 'freighter' : 'fighter',
                            name: '我的座驾',
                            hullId: selectedShip,
                            ownerId: 'player',
                            factionId: 0,
                            location: { sector: selectedLocation, x: 500, y: 300 },
                            sector: selectedLocation,
                            stats: { hp: initialMaxHp, maxHp: initialMaxHp, speed: 100 },
                            state: 'IDLE',
                            behavior: 'IDLE'
                        });
                        
                        sm.ShipManager.save();
                        
                        // [重构] 渲染加载由 Base.ts 控制，此处仅保证内存清空防污染
                        bm.BuildingManager.reset();

                        // 既然已经生成了初始数据到 localStorage 的工作区，我们就可以进入游戏了
                        EventBus.dispatchEvent(new CustomEvent('NEWGAME_START'));
                    });
                });
            });
        });
    };

    const handleBack = () => {
        // 返回主菜单
        EventBus.dispatchEvent(new CustomEvent('MAINMENU_RETURN'));
    };

    return (
        <>
        <style>
            {`
                .newgame-scrollbar::-webkit-scrollbar {
                    width: 8px;
                }
                .newgame-scrollbar::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 4px;
                }
                .newgame-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(0, 255, 255, 0.3);
                    border-radius: 4px;
                }
                .newgame-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 255, 255, 0.5);
                }
            `}
        </style>
        <div style={{
            position: 'absolute',
            top: 0, left: 0, width: '100%', height: '100%',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            background: `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${GameConfig.assets.images.background}) center center / cover no-repeat`,
            zIndex: 10000,
            pointerEvents: 'auto'
        }}>
            <div style={{
                width: '80vw',
                height: '80vh',
                display: 'flex',
                backgroundColor: 'rgba(20, 20, 30, 0.8)',
                border: '2px solid #00ffff',
                borderRadius: '10px',
                overflow: 'hidden',
                boxShadow: '0 0 30px rgba(0, 255, 255, 0.2)',
                padding: '20px',
                gap: '20px'
            }}>
                {/* 左侧固定栏 */}
                <div style={{
                    width: '30%',
                    backgroundColor: '#00bfff', // 浅蓝色
                    borderRadius: '5px',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '20px',
                    boxSizing: 'border-box'
                }}>
                    <h2 style={{ color: '#fff', textAlign: 'center', textShadow: '1px 1px 2px #000', marginBottom: '30px' }}>档案建立</h2>
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button
                            onClick={() => setActiveTab('career')}
                            style={{
                                padding: '15px',
                                backgroundColor: activeTab === 'career' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                                color: '#fff',
                                border: activeTab === 'career' ? '2px solid #fff' : '1px solid rgba(255, 255, 255, 0.3)',
                                borderRadius: '5px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '18px',
                                textAlign: 'left',
                                transition: 'all 0.3s ease'
                            }}
                        >
                            生涯开局
                        </button>
                        <button
                            onClick={() => setActiveTab('ship')}
                            style={{
                                padding: '15px',
                                backgroundColor: activeTab === 'ship' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                                color: '#fff',
                                border: activeTab === 'ship' ? '2px solid #fff' : '1px solid rgba(255, 255, 255, 0.3)',
                                borderRadius: '5px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '18px',
                                textAlign: 'left',
                                transition: 'all 0.3s ease'
                            }}
                        >
                            座驾选择
                        </button>
                    </div>

                    <button 
                        onClick={handleBack}
                        style={{
                            padding: '12px',
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            color: '#fff',
                            border: '1px solid #fff',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            fontSize: '16px',
                            marginTop: '10px'
                        }}
                        onMouseOver={(e) => (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,0,0,0.8)'}
                        onMouseOut={(e) => (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,0,0,0.5)'}
                    >
                        返回主菜单
                    </button>
                </div>

                {/* 右侧区域 */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    minWidth: 0,
                    minHeight: 0
                }}>
                    {/* 右上横幅 */}
                    <div style={{
                        height: '60px',
                        backgroundColor: '#00bfff', // 浅蓝色
                        borderRadius: '5px',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 20px',
                        color: '#fff',
                        fontWeight: 'bold',
                        fontSize: '20px',
                        textShadow: '1px 1px 2px #000'
                    }}>
                        初始金额：1000
                    </div>

                    {/* 右下主区域 (透明网格部分) */}
                    <div style={{
                        flex: 1,
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        border: '1px dashed #00bfff',
                        borderRadius: '5px',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        padding: '20px',
                        minHeight: 0,
                        /* 简单的网格背景效果 */
                        backgroundImage: 'linear-gradient(rgba(0, 191, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 191, 255, 0.1) 1px, transparent 1px)',
                        backgroundSize: '20px 20px'
                    }}>
                        
                        {/* 选项列表区域 */}
                        <div className="newgame-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingRight: '10px', minHeight: 0 }}>
                            {activeTab === 'career' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <h3 style={{ color: '#00ffff', margin: '0 0 10px 0', textShadow: '0 0 5px rgba(0,255,255,0.5)' }}>选择开局地点</h3>
                                    
                                    {sectors.map((sector, index) => (
                                        <div 
                                            key={index}
                                            onClick={() => setSelectedLocation(sector.name)}
                                            style={{
                                                padding: '15px',
                                                backgroundColor: selectedLocation === sector.name ? 'rgba(0, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.4)',
                                                border: selectedLocation === sector.name ? '2px solid #00ffff' : '1px solid #444',
                                                borderRadius: '8px',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <div style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold', marginBottom: '5px' }}>{sector.name}</div>
                                            <div style={{ color: '#aaa', fontSize: '14px' }}>{sector.description}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            
                            {activeTab === 'ship' && (
                                <div style={{ display: 'flex', height: '100%', gap: '20px' }}>
                                    {/* 左半边：分为上下两部分 */}
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                        {/* 左上半部分：飞船列表，占 1/3 */}
                                        <div className="newgame-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '5px' }}>
                                            {Object.entries(GameConfig.HULLS).filter(([key, hull]: [string, any]) => hull.type !== 'drone').map(([hullId, hull]: [string, any]) => (
                                                <div 
                                                    key={hullId}
                                                    onClick={() => setSelectedShip(hullId)}
                                                    style={{
                                                        padding: '10px 15px',
                                                        backgroundColor: selectedShip === hullId ? 'rgba(0, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.4)',
                                                        border: selectedShip === hullId ? '1px solid #00ffff' : '1px solid rgba(0, 255, 255, 0.2)',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s',
                                                        boxShadow: selectedShip === hullId ? '0 0 10px rgba(0, 255, 255, 0.2)' : 'none'
                                                    }}
                                                    onMouseOver={e => {
                                                        if (selectedShip !== hullId) e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.05)';
                                                    }}
                                                    onMouseOut={e => {
                                                        if (selectedShip !== hullId) e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
                                                    }}
                                                >
                                                    <div style={{ fontWeight: 'bold', color: selectedShip === hullId ? '#00ffff' : '#fff', fontSize: '16px' }}>{hull.name}</div>
                                                    <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>基础血量: {hull.baseHp}</div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* 左下半部分：空出 2/3 的空间给新div */}
                                        <div style={{ flex: 2, display: 'flex' }}>
                                            {/* 这个空 div 留给您写新功能 */}
                                            <div style={{ width: '100%', height: '100%' }}></div>
                                        </div>
                                    </div>

                                    {/* 右半边：飞船显示的大方框 */}
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid rgba(0, 255, 255, 0.3)', paddingLeft: '20px' }}>
                                        <div style={{
                                            width: '100%',
                                            height: '100%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            overflow: 'hidden',
                                            padding: '10px',
                                            backgroundColor: 'rgba(0, 0, 0, 0.2)',
                                            borderRadius: '8px',
                                            border: '1px solid rgba(0, 255, 255, 0.1)'
                                        }}>
                                            <img 
                                                src={`assets/${GameConfig.HULLS[selectedShip]?.sprite || 'phaser.png'}`} 
                                                alt={GameConfig.HULLS[selectedShip]?.name}
                                                style={{
                                                    maxWidth: '100%',
                                                    maxHeight: '100%',
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
                                </div>
                            )}
                        </div>
                        
                        {/* 开始按钮 */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                            <button 
                                onClick={handleStartJourney}
                                style={{
                                    padding: '15px 40px',
                                    backgroundColor: '#00ffaa',
                                    color: '#003300',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '20px',
                                    boxShadow: '0 0 10px rgba(0, 255, 170, 0.5)'
                                }}
                                onMouseOver={(e) => {
                                    (e.target as HTMLButtonElement).style.backgroundColor = '#00cc88';
                                    (e.target as HTMLButtonElement).style.transform = 'scale(1.05)';
                                }}
                                onMouseOut={(e) => {
                                    (e.target as HTMLButtonElement).style.backgroundColor = '#00ffaa';
                                    (e.target as HTMLButtonElement).style.transform = 'scale(1)';
                                }}
                            >
                                开启旅程
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </>
    );
};
