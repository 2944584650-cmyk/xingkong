import React, { useState, useEffect } from 'react';
import { GameConfig } from './config';
import { ShipManager } from './managers/ShipManager';
import { PlayerManager } from './managers/PlayerManager';
import { EventBus, GameEvents } from './utils/EventBus';
import { BuildingManager } from './managers/BuildingManager';
import { InventoryManager } from './managers/InventoryManager';
import { NPCManager } from './managers/NPCManager';

export const ZuobiPanel: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'base' | 'fleet' | 'items' | 'building' | 'orders' | 'npcs'>('base');
    const [ordersList, setOrdersList] = useState<any[]>([]);
    const [npcList, setNpcList] = useState<any[]>([]);
    const [orderFilter, setOrderFilter] = useState<'ALL' | 'BUILD' | 'COMBAT' | 'PATROL'>('ALL');

    const refreshOrders = () => {
        import('./scenes/WorldbookManager').then(module => {
            const ws = module.WorldbookManager.getWorldState();
            setOrdersList(ws.orders || []);
        });
    };

    const refreshNPCs = () => {
        const npcs = NPCManager.getInstance().getAllNPCs();
        setNpcList(npcs || []);
    };

    useEffect(() => {
        if (activeTab === 'orders') {
            refreshOrders();
        } else if (activeTab === 'npcs') {
            refreshNPCs();
        }
    }, [activeTab]);
    
    // 拖拽相关状态
    const [pos, setPos] = useState({ x: window.innerWidth - 400, y: 50 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    
    // 基础作弊状态
    const [selectedPreset, setSelectedPreset] = useState<string>(Object.keys(GameConfig.FACTION_PRESETS)[0] || '');
    const [selectedFaction, setSelectedFaction] = useState<string>('0');
    const [affinity, setAffinity] = useState<number>(0);
    const [invincible, setInvincible] = useState<boolean>(false);
    const [message, setMessage] = useState<string | null>(null);

    // 舰队作弊状态
    const [cart, setCart] = useState<{ preset: string, count: number }[]>([]);
    const [cartPreset, setCartPreset] = useState<string>(Object.keys(GameConfig.FACTION_PRESETS)[0] || '');
    const [cartCount, setCartCount] = useState<number>(1);
    
    const [fleetSector, setFleetSector] = useState<string>('');
    const [fleetX, setFleetX] = useState<number>(50);
    const [fleetY, setFleetY] = useState<number>(50);
    const [fleetFaction, setFleetFaction] = useState<string>('1');

    const [generatedFleets, setGeneratedFleets] = useState<{ id: string, name: string }[]>([]);
    const [warFleetA, setWarFleetA] = useState<string>('');
    const [warFleetB, setWarFleetB] = useState<string>('');

    // 物品作弊状态
    const [itemPreset, setItemPreset] = useState<string>('attack_drone');
    const [itemCount, setItemCount] = useState<number>(1);

    // 初始化时获取当前星区
    useEffect(() => {
        if (isOpen && !fleetSector) {
            const currentSector = localStorage.getItem('current_sector');
            setFleetSector(currentSector || '');
        }
    }, [isOpen]);

    const showMessage = (msg: string) => {
        setMessage(msg);
        setTimeout(() => setMessage(null), 3000);
    };

    // Toggle panel visibility with F10
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'F10') {
                setIsOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // 拖拽处理
    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (isDragging) {
                setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
            }
        };
        const handlePointerUp = () => setIsDragging(false);

        if (isDragging) {
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        }
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isDragging, dragOffset]);

    // Handle Invincibility
    useEffect(() => {
        let interval: any;
        if (invincible) {
            interval = setInterval(() => {
                const pd = PlayerManager.getStats();
                if (pd && pd.playerShipId) {
                    const pShip = pd.ownedShips.find((s: any) => s.id === pd.playerShipId);
                    if (pShip) {
                        pShip.hp = pShip.maxHp || 100;
                    }
                    const macroShip = ShipManager.getShipById(pd.playerShipId);
                    if (macroShip && macroShip.stats) {
                        macroShip.stats.hp = macroShip.stats.maxHp;
                    }
                }
            }, 100); // 10 times a second
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [invincible]);

    const spawnShip = () => {
        const presetKey = selectedPreset;
        const preset = (GameConfig.FACTION_PRESETS as any)[presetKey];
        if (!preset) return;

        const currentSector = localStorage.getItem('current_sector');
        const sectorToUse = currentSector;
        
        // 获取玩家当前坐标作为生成坐标（稍微偏移一点）
        let spawnX = 500;
        let spawnY = 275;
        const pd = PlayerManager.getStats();
        if (pd && pd.playerShipId) {
            const macroShip = ShipManager.getShipById(pd.playerShipId);
            if (macroShip) {
                spawnX = macroShip.location.x + (Math.random() - 0.5) * 200;
                spawnY = macroShip.location.y + (Math.random() - 0.5) * 200;
            }
        }

            const pdId = PlayerManager.getStats()?.playerShipId;
            const newShipData: any = {
                id: `cheat_ship_${Date.now()}`,
                name: `作弊生成_${presetKey}`,
                hullId: preset.hullId,
                factionId: selectedFaction === 'player' ? 0 : parseInt(selectedFaction),
                ownerId: selectedFaction === 'player' ? 'player' : undefined,
                location: { sector: sectorToUse, x: spawnX, y: spawnY },
                loadout: JSON.parse(JSON.stringify(preset.slots)),
                state: 'IDLE',
                memory: pdId ? { [pdId]: affinity } : {}
            };

        // Create the ship
        const newShip = ShipManager.createShip(newShipData);
        if (newShip) {
            newShip.recalculateStats();
            newShip.stats.hp = newShip.stats.maxHp;

            // 如果是玩家阵营，自动加入玩家资产并尝试分配为僚机
            if (selectedFaction === 'player') {
                const pd = PlayerManager.getStats();
                pd.ownedShips.push({
                    id: newShip.id,
                    name: newShip.name,
                    hullId: newShip.hullId,
                    slots: newShip.loadout,
                    hp: newShip.stats.hp,
                    maxHp: newShip.stats.maxHp,
                    location: newShip.location
                });

                // 自动编入当前玩家舰队
                if (pd.fleets && pd.fleets.length > 0) {
                    const myFleet = pd.fleets.find((f: any) => f.flagshipId === pd.playerShipId || f.members.includes(pd.playerShipId));
                    if (myFleet) {
                        myFleet.members.push(newShip.id);
                    } else {
                        pd.fleets[0].members.push(newShip.id);
                    }
                }

                PlayerManager.saveStats(pd);
                showMessage(`[成功] 已生成玩家僚机 [${newShip.name}] 并加入舰队！`);
            } else {
                showMessage(`[成功] 已生成 NPC 飞船 [${newShip.name}]，阵营: ${selectedFaction}`);
            }
        }
    };

    const spawnDummy = () => {
        let currentSector = localStorage.getItem('current_sector');
        
        let spawnX = 500;
        let spawnY = 275;
        const pd = PlayerManager.getStats();
        if (pd && pd.playerShipId) {
            const macroShip = ShipManager.getShipById(pd.playerShipId);
            if (macroShip) {
                spawnX = macroShip.location.x + (Math.random() - 0.5) * 200;
                spawnY = macroShip.location.y + (Math.random() - 0.5) * 200;
            }
        }

        const pdId = PlayerManager.getStats()?.playerShipId;
        const newShipData: any = {
            id: `dummy_ship_${Date.now()}`,
            name: `测试木桩`,
            hullId: 'hull_freighter_s', // 使用商船底盘
            factionId: selectedFaction === 'player' ? 0 : parseInt(selectedFaction),
            ownerId: selectedFaction === 'player' ? 'player' : undefined,
            location: { sector: currentSector, x: spawnX, y: spawnY },
            loadout: {}, // 无装备
            state: 'IDLE',
            memory: pdId ? { [pdId]: affinity } : {}
        };

        const newShip = ShipManager.createShip(newShipData);
        if (newShip) {
            newShip.recalculateStats();
            newShip.stats.maxHp = 10000;
            newShip.stats.hp = 10000;
            newShip.stats.thrust = 0;
            newShip.stats.turnThrust = 0;
            newShip.activeWeapons = [];
            newShip.orderQueue = [];
            ShipManager.save(); // 保存修改后的属性

            showMessage(`[成功] 已生成 10000 血测试木桩！`);
        }
    };

    const clearDummies = () => {
        let count = 0;
        const shipsToRemove = ShipManager.ships.filter(s => s.id.startsWith('dummy_ship_') || s.name === '测试木桩');
        shipsToRemove.forEach(s => {
            ShipManager.removeShip(s.id);
            count++;
        });
        showMessage(`[成功] 已清除 ${count} 个测试木桩！`);
    };

    // 舰队作弊逻辑
    const addToCart = () => {
        if (cartCount <= 0) return;
        setCart(prev => {
            const existing = prev.find(item => item.preset === cartPreset);
            if (existing) {
                return prev.map(item => item.preset === cartPreset ? { ...item, count: item.count + cartCount } : item);
            }
            return [...prev, { preset: cartPreset, count: cartCount }];
        });
        showMessage(`已添加 ${cartCount} 艘 ${cartPreset} 到购物车`);
    };

    const removeFromCart = (preset: string) => {
        setCart(prev => prev.filter(item => item.preset !== preset));
    };

    const handleGenerateFleet = () => {
        if (cart.length === 0) {
            showMessage('购物车为空！');
            return;
        }
        
        const sector = fleetSector;
        // 将 0-100% 映射到雷达的合理坐标范围，比如 X: 0-1000, Y: 0-550 (50% 50% 就是 500, 275)
        const startX = (fleetX / 100) * 1000;
        const startY = (fleetY / 100) * 550;

        let createdShips: any[] = [];
        
        cart.forEach(item => {
            const presetKey = item.preset;
            const preset = (GameConfig.FACTION_PRESETS as any)[presetKey];
            if (!preset) return;

            for (let i = 0; i < item.count; i++) {
                const offsetX = (Math.random() - 0.5) * 150;
                const offsetY = (Math.random() - 0.5) * 150;
                
                const newShipData = {
                    id: `cheat_fleet_${Date.now()}_${Math.floor(Math.random()*10000)}`,
                    name: `AI_${presetKey}_${i}`,
                    hullId: preset.hullId,
                    factionId: parseInt(fleetFaction),
                    ownerId: undefined,
                    location: { sector: sector, x: startX + offsetX, y: startY + offsetY },
                    loadout: JSON.parse(JSON.stringify(preset.slots)),
                    state: 'IDLE'
                };
                const newShip = ShipManager.createShip(newShipData);
                if (newShip) {
                    newShip.recalculateStats();
                    newShip.stats.hp = newShip.stats.maxHp;
                    createdShips.push(newShip);
                }
            }
        });

        if (createdShips.length > 0) {
            const flagshipId = createdShips[0].id;
            const memberIds = createdShips.slice(1).map(s => s.id);
            const newFleet = ShipManager.createAIFleet(parseInt(fleetFaction), flagshipId, memberIds);
            
            const fleetName = `阵营${fleetFaction} 舰队 (${createdShips.length}艘)`;
            const newGeneratedFleet = { id: newFleet.fleetId, name: fleetName };
            setGeneratedFleets(prev => [...prev, newGeneratedFleet]);
            
            // 自动填充战争选项
            if (!warFleetA) setWarFleetA(newGeneratedFleet.id);
            else if (!warFleetB) setWarFleetB(newGeneratedFleet.id);
            
            showMessage(`成功生成舰队！包含 ${createdShips.length} 艘战舰。`);
        }
    };

    const handleStartWar = () => {
        if (!warFleetA || !warFleetB) {
            showMessage('请选择两支舰队！');
            return;
        }
        if (warFleetA === warFleetB) {
            showMessage('不能自己打自己！');
            return;
        }
        
        const fleetA = ShipManager.fleets.find((f: any) => f.fleetId === warFleetA);
        const fleetB = ShipManager.fleets.find((f: any) => f.fleetId === warFleetB);
        
        if (!fleetA || !fleetB) {
            showMessage('舰队不存在，可能已被摧毁或解散。');
            return;
        }
        
        const shipsA = [fleetA.flagshipId, ...fleetA.members].map((id: string) => ShipManager.getShipById(id)).filter(Boolean);
        const shipsB = [fleetB.flagshipId, ...fleetB.members].map((id: string) => ShipManager.getShipById(id)).filter(Boolean);
        
        if (shipsA.length === 0 || shipsB.length === 0) {
            showMessage('其中一支舰队已没有存活的飞船！');
            return;
        }
        
        // 赋予死敌好感度，并下达强制攻击指令
        
        // --- 核心修复：将修改通过 EventBus 广播到微观物理层进行同步 ---
        // 既然这是在 React 层操作宏观数据，我们必须通知 Base.ts 把 memory 同步给物理对象
        const syncMemoryPayload: any = [];

        shipsA.forEach((a: any) => {
            shipsB.forEach((b: any) => {
                if (!a.memory) a.memory = {};
                if (!b.memory) b.memory = {};
                a.memory[b.id] = -1000;
                b.memory[a.id] = -1000;
                
                syncMemoryPayload.push({ A: a.id, B: b.id, val: -1000 });
                syncMemoryPayload.push({ A: b.id, B: a.id, val: -1000 });
            });
            a.commandState = 'ATTACK_TARGET';
            a.commandTargetId = shipsB[0]?.id;
        });
        
        shipsB.forEach((b: any) => {
            b.commandState = 'ATTACK_TARGET';
            b.commandTargetId = shipsA[0]?.id;
        });

        // 触发自定义事件，让 Base.ts 接收到强制仇恨注入
        document.dispatchEvent(new CustomEvent('cheat_inject_memory', { detail: syncMemoryPayload }));
        
        showMessage('战争指令已下达，双方开始交火！');
    };

    const handleGiveItem = () => {
        const pd = PlayerManager.getStats();
        if (pd && pd.playerShipId) {
            InventoryManager.addCargo(pd.playerShipId, itemPreset, itemCount);
            showMessage(`已给予玩家 ${itemCount} 个 [${itemPreset}]`);
        }
    }

    const handleRefresh = () => {
        window.location.reload();
    };

    if (!isOpen) return null;

    const handlePlaceModule = (moduleId: string, rotation: number, name: string) => {
        let placed = false;
        
        // 从核心(0,0)向外扩展搜索
        for (let r = 0; r <= 5; r++) { 
            for (let y = -r; y <= r; y++) {
                for (let x = -r; x <= r; x++) {
                    if (Math.abs(x) === r || Math.abs(y) === r) {
                        const check = BuildingManager.canPlaceModule(moduleId, x, y, rotation);
                        if (check.valid) {
                            if (BuildingManager.placeModule(moduleId, x, y, rotation)) {
                                showMessage(`${name} (旋转${rotation}°) 成功放置于 (${x}, ${y})！`);
                                placed = true;
                                break;
                            }
                        }
                    }
                }
                if (placed) break;
            }
            if (placed) break;
        }
        
        if (!placed) {
            showMessage(`${name} 放置失败！可能周围没有匹配此旋转角度的接口，或者位置已被占用。`);
        }
    };

    const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
        <div
            onPointerDown={stopPropagation}
            onKeyDown={stopPropagation}
            onClick={stopPropagation}
            onWheel={stopPropagation}
            className="ga-pointer-events-auto"
            style={{
            position: 'absolute',
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            width: '380px',
            background: 'rgba(20, 20, 20, 0.95)',
            border: '2px solid #ff00ff',
            color: '#fff',
            padding: '15px',
            zIndex: 9999,
            borderRadius: '8px',
            boxShadow: '0 0 15px #ff00ff',
            fontFamily: 'Arial, sans-serif',
            maxHeight: '80vh',
            overflowY: 'auto'
        }}>
            <div 
                onPointerDown={(e) => {
                    setIsDragging(true);
                    setDragOffset({ x: e.clientX - pos.x, y: e.clientY - pos.y });
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.stopPropagation();
                }}
                style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ff00ff', paddingBottom: '10px', marginBottom: '10px', cursor: 'move' }}
            >
                <h3 style={{ margin: 0, color: '#ff00ff', textShadow: '0 0 5px #ff00ff' }}>作弊控制台 (F10)</h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onPointerDown={stopPropagation} onClick={handleRefresh} style={{ background: 'transparent', border: '1px solid #ff00ff', color: '#ff00ff', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px', padding: '0 5px' }}>刷新页面</button>
                    <button onPointerDown={stopPropagation} onClick={() => setIsOpen(false)} style={{ background: 'transparent', border: 'none', color: '#ff00ff', cursor: 'pointer', fontWeight: 'bold' }}>X</button>
                </div>
            </div>

            {/* 顶部 Tab 切换 */}
            <div style={{ display: 'flex', marginBottom: '15px', borderBottom: '1px solid #555' }}>
                <button 
                    onClick={() => setActiveTab('base')}
                    style={{ flex: 1, padding: '8px', background: activeTab === 'base' ? '#ff00ff' : 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                >
                    基础作弊
                </button>
                <button 
                    onClick={() => setActiveTab('fleet')}
                    style={{ flex: 1, padding: '8px', background: activeTab === 'fleet' ? '#ff00ff' : 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                >
                    大乱斗
                </button>
                <button 
                    onClick={() => setActiveTab('items')}
                    style={{ flex: 1, padding: '8px', background: activeTab === 'items' ? '#ff00ff' : 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                >
                    刷货物
                </button>
                <button 
                    onClick={() => setActiveTab('building')}
                    style={{ flex: 1, padding: '8px', background: activeTab === 'building' ? '#ff00ff' : 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                >
                    建筑测试
                </button>
                <button 
                    onClick={() => setActiveTab('orders')}
                    style={{ flex: 1, padding: '8px', background: activeTab === 'orders' ? '#ff00ff' : 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                >
                    全宇宙订单
                </button>
                <button 
                    onClick={() => setActiveTab('npcs')}
                    style={{ flex: 1, padding: '8px', background: activeTab === 'npcs' ? '#ff00ff' : 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                >
                    NPC 池
                </button>
            </div>

            {message && (
                <div style={{ marginBottom: '15px', padding: '8px', background: 'rgba(0, 255, 0, 0.2)', border: '1px solid #00ff00', color: '#00ff00', borderRadius: '4px', fontSize: '14px', textAlign: 'center' }}>
                    {message}
                </div>
            )}

            {activeTab === 'base' && (
                <>
            <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#ccc', fontSize: '14px' }}>飞船预设 (Preset):</label>
                <select 
                    value={selectedPreset} 
                    onChange={e => setSelectedPreset(e.target.value)}
                    style={{ width: '100%', padding: '8px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                >
                    {Object.keys(GameConfig.FACTION_PRESETS).map(preset => (
                        <option key={preset} value={preset}>{preset}</option>
                    ))}
                </select>
            </div>

            <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#ccc', fontSize: '14px' }}>归属阵营 (Faction):</label>
                <select 
                    value={selectedFaction} 
                    onChange={e => setSelectedFaction(e.target.value)}
                    style={{ width: '100%', padding: '8px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                >
                    <option value="player">玩家 (Player)</option>
                    <option value="0">中立 / 商船 (0)</option>
                    <option value="1">帝国 (1)</option>
                    <option value="2">联邦 (2)</option>
                    <option value="3">拾荒者/海盗 (3)</option>
                    <option value="4">邪教 (4)</option>
                </select>
            </div>

            <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#ccc', fontSize: '14px' }}>初始对玩家好感度 (Affinity):</label>
                <input 
                    type="number" 
                    value={affinity}
                    onChange={e => setAffinity(parseInt(e.target.value) || 0)}
                    style={{ width: '100%', padding: '8px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px', boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: '12px', color: '#888', marginTop: '5px' }}>
                    * 提示: 负数代表敌意，-100以下为死敌
                </div>
            </div>

            <button 
                onClick={spawnShip}
                style={{
                    width: '100%',
                    padding: '10px',
                    background: 'linear-gradient(to bottom, #ff00ff, #aa00aa)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    marginBottom: '15px',
                    textShadow: '0 1px 2px #000'
                }}
            >
                生成飞船 (Spawn Ship)
            </button>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button 
                    onClick={spawnDummy}
                    style={{
                        flex: 1,
                        padding: '10px',
                        background: 'linear-gradient(to bottom, #00ffff, #00aaaa)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        textShadow: '0 1px 2px #000'
                    }}
                >
                    生成测试木桩 (10k HP)
                </button>
                <button 
                    onClick={clearDummies}
                    style={{
                        flex: 1,
                        padding: '10px',
                        background: 'linear-gradient(to bottom, #ff0000, #aa0000)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        textShadow: '0 1px 2px #000'
                    }}
                >
                    清除所有木桩
                </button>
            </div>

            <hr style={{ border: '0', borderTop: '1px solid #555', margin: '15px 0' }} />

            <div style={{ display: 'flex', alignItems: 'center' }}>
                <input 
                    type="checkbox" 
                    id="invincible-toggle"
                    checked={invincible}
                    onChange={e => setInvincible(e.target.checked)}
                    style={{ marginRight: '10px', width: '16px', height: '16px' }}
                />
                <label htmlFor="invincible-toggle" style={{ color: invincible ? '#00ff00' : '#ccc', fontWeight: invincible ? 'bold' : 'normal', cursor: 'pointer' }}>
                    玩家旗舰血量不减 (Invincible)
                </label>
            </div>
                </>
            )}

            {activeTab === 'fleet' && (
                <>
                    <div style={{ background: 'rgba(255, 0, 255, 0.1)', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#ff00ff' }}>1. 挑选战舰 (购物车)</h4>
                        <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                            <select 
                                value={cartPreset} 
                                onChange={e => setCartPreset(e.target.value)}
                                style={{ flex: 2, padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                            >
                                {Object.keys(GameConfig.FACTION_PRESETS).map(preset => (
                                    <option key={preset} value={preset}>{preset}</option>
                                ))}
                            </select>
                            <input 
                                type="number" 
                                min="1"
                                value={cartCount}
                                onChange={e => setCartCount(parseInt(e.target.value) || 1)}
                                style={{ flex: 1, padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                            />
                            <button 
                                onClick={addToCart}
                                style={{ padding: '5px 10px', background: '#00ccff', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                添加
                            </button>
                        </div>
                        
                        {/* 购物车列表 */}
                        <div style={{ maxHeight: '100px', overflowY: 'auto', background: '#000', border: '1px solid #555', borderRadius: '4px', padding: '5px' }}>
                            {cart.length === 0 ? <div style={{ color: '#888', fontSize: '12px', textAlign: 'center' }}>暂无战舰</div> : null}
                            {cart.map((item, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '3px', borderBottom: '1px solid #333' }}>
                                    <span>{item.preset} <span style={{ color: '#00ccff' }}>x{item.count}</span></span>
                                    <button onClick={() => removeFromCart(item.preset)} style={{ background: 'none', border: 'none', color: '#ff0000', cursor: 'pointer' }}>X</button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={{ background: 'rgba(255, 0, 255, 0.1)', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#ff00ff' }}>2. 生成设定</h4>
                        
                        <div style={{ marginBottom: '5px' }}>
                            <label style={{ fontSize: '12px', color: '#ccc' }}>目标星区:</label>
                            <input 
                                type="text" 
                                value={fleetSector}
                                onChange={e => setFleetSector(e.target.value)}
                                style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px', boxSizing: 'border-box' }}
                            />
                        </div>
                        
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '5px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '12px', color: '#ccc' }}>X坐标比例(0-100%):</label>
                                <input 
                                    type="number" 
                                    value={fleetX}
                                    onChange={e => setFleetX(parseInt(e.target.value) || 0)}
                                    style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px', boxSizing: 'border-box' }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '12px', color: '#ccc' }}>Y坐标比例(0-100%):</label>
                                <input 
                                    type="number" 
                                    value={fleetY}
                                    onChange={e => setFleetY(parseInt(e.target.value) || 0)}
                                    style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px', boxSizing: 'border-box' }}
                                />
                            </div>
                        </div>
                        
                        <div style={{ marginBottom: '10px' }}>
                            <label style={{ fontSize: '12px', color: '#ccc' }}>所属阵营:</label>
                            <select 
                                value={fleetFaction} 
                                onChange={e => setFleetFaction(e.target.value)}
                                style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                            >
                                <option value="1">帝国 (1)</option>
                                <option value="2">联邦 (2)</option>
                                <option value="3">海盗 (3)</option>
                                <option value="4">邪教 (4)</option>
                                <option value="98">雇佣兵A[原地待命] (98)</option>
                                <option value="99">雇佣兵B[原地待命] (99)</option>
                            </select>
                        </div>
                        
                        <button 
                            onClick={handleGenerateFleet}
                            style={{ width: '100%', padding: '8px', background: '#ff00ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            在指定位置生成舰队
                        </button>
                    </div>

                    <div style={{ background: 'rgba(255, 0, 0, 0.1)', padding: '10px', borderRadius: '4px', border: '1px solid #aa0000' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#ff3333' }}>3. 挑起战争！</h4>
                        
                        <div style={{ marginBottom: '5px' }}>
                            <label style={{ fontSize: '12px', color: '#ccc' }}>选择舰队 A:</label>
                            <select 
                                value={warFleetA} 
                                onChange={e => setWarFleetA(e.target.value)}
                                style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                            >
                                <option value="">-- 请选择 --</option>
                                {generatedFleets.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        </div>
                        
                        <div style={{ marginBottom: '10px' }}>
                            <label style={{ fontSize: '12px', color: '#ccc' }}>选择舰队 B:</label>
                            <select 
                                value={warFleetB} 
                                onChange={e => setWarFleetB(e.target.value)}
                                style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                            >
                                <option value="">-- 请选择 --</option>
                                {generatedFleets.map(f => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        </div>
                        
                        <button 
                            onClick={handleStartWar}
                            style={{ width: '100%', padding: '10px', background: 'linear-gradient(to bottom, #ff0000, #880000)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', textShadow: '0 1px 2px #000' }}
                        >
                            令 A 舰队 与 B 舰队 开战！
                        </button>
                    </div>
                </>
            )}

            {activeTab === 'items' && (
                <>
                    <div style={{ background: 'rgba(255, 0, 255, 0.1)', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#ff00ff' }}>给予物品</h4>
                        
                        <div style={{ marginBottom: '10px' }}>
                            <label style={{ fontSize: '12px', color: '#ccc', display: 'block', marginBottom: '5px' }}>物品ID (如 attack_drone):</label>
                            <input 
                                type="text" 
                                value={itemPreset}
                                onChange={e => setItemPreset(e.target.value)}
                                style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px', boxSizing: 'border-box' }}
                            />
                        </div>

                        <div style={{ marginBottom: '10px' }}>
                            <label style={{ fontSize: '12px', color: '#ccc', display: 'block', marginBottom: '5px' }}>数量:</label>
                            <input 
                                type="number" 
                                min="1"
                                value={itemCount}
                                onChange={e => setItemCount(parseInt(e.target.value) || 1)}
                                style={{ width: '100%', padding: '5px', background: '#000', color: '#fff', border: '1px solid #555', borderRadius: '4px', boxSizing: 'border-box' }}
                            />
                        </div>
                        
                        <button 
                            onClick={handleGiveItem}
                            style={{ width: '100%', padding: '8px', background: '#ff00ff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            给予玩家
                        </button>
                    </div>
                </>
            )}

            {activeTab === 'building' && (
                <>
                    <div style={{ background: 'rgba(255, 128, 0, 0.1)', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
                        <h4 style={{ margin: '0 0 10px 0', color: '#ffaa00' }}>空间站建造系统测试</h4>
                        
                        <p style={{ fontSize: '12px', color: '#ccc', marginBottom: '15px' }}>
                            由于雷达底层的更新循环会自动抓取模块数据并绘制网格，你可以直接点击召唤并在雷达中缩小画面(滑轮)查看。
                        </p>
                        
                        <button 
                            onClick={() => {
                                BuildingManager.initStation(0, 0);
                                showMessage("核心已召唤于 (0, 0)！请在雷达缩小画面查看蓝色的核心网格。");
                            }}
                            style={{ width: '100%', padding: '10px', background: 'linear-gradient(to bottom, #ff8800, #aa5500)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', textShadow: '0 1px 2px #000', marginBottom: '10px' }}
                        >
                            召唤核心模块 (Core)
                        </button>
                        
                        {Object.entries(GameConfig.MODULES).filter(([id, mod]) => (mod as any).category !== 'core').map(([moduleId, modData]: [string, any]) => (
                            <div key={moduleId} style={{ marginBottom: '15px' }}>
                                <div style={{ fontSize: '14px', color: '#fff', marginBottom: '5px' }}>召唤{modData.name}:</div>
                                <button 
                                    onClick={() => handlePlaceModule(moduleId, 0, modData.name)}
                                    style={{ width: '100%', padding: '8px', background: 'linear-gradient(to bottom, #0088ff, #0055aa)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', textShadow: '0 1px 2px #000', marginBottom: '5px' }}
                                >
                                    召唤{modData.name} (默认 0°)
                                </button>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button onClick={() => handlePlaceModule(moduleId, 0, modData.name)} style={{ flex: 1, padding: '5px', background: '#004488', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>上 (0°)</button>
                                    <button onClick={() => handlePlaceModule(moduleId, 90, modData.name)} style={{ flex: 1, padding: '5px', background: '#004488', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>右 (90°)</button>
                                    <button onClick={() => handlePlaceModule(moduleId, 180, modData.name)} style={{ flex: 1, padding: '5px', background: '#004488', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>下 (180°)</button>
                                    <button onClick={() => handlePlaceModule(moduleId, 270, modData.name)} style={{ flex: 1, padding: '5px', background: '#004488', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>左 (270°)</button>
                                </div>
                            </div>
                        ))}

                    </div>
                </>
            )}

            {activeTab === 'orders' && (
                <>
                    <div style={{ background: 'rgba(0, 255, 255, 0.1)', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <h4 style={{ margin: 0, color: '#00ffff' }}>全宇宙订单列表 ({ordersList.length})</h4>
                            <button 
                                onClick={refreshOrders}
                                style={{ padding: '5px 10px', background: '#00aaaa', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                刷新列表
                            </button>
                        </div>

                        {/* 订单子分类过滤器 */}
                        <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                            <button 
                                onClick={() => setOrderFilter('ALL')}
                                style={{ flex: 1, padding: '5px', background: orderFilter === 'ALL' ? '#00ffff' : 'transparent', color: orderFilter === 'ALL' ? '#000' : '#00ffff', border: '1px solid #00ffff', cursor: 'pointer', fontSize: '12px', borderRadius: '2px' }}
                            >
                                全部
                            </button>
                            <button 
                                onClick={() => setOrderFilter('BUILD')}
                                style={{ flex: 1, padding: '5px', background: orderFilter === 'BUILD' ? '#00ffff' : 'transparent', color: orderFilter === 'BUILD' ? '#000' : '#00ffff', border: '1px solid #00ffff', cursor: 'pointer', fontSize: '12px', borderRadius: '2px' }}
                            >
                                建筑
                            </button>
                            <button 
                                onClick={() => setOrderFilter('COMBAT')}
                                style={{ flex: 1, padding: '5px', background: orderFilter === 'COMBAT' ? '#00ffff' : 'transparent', color: orderFilter === 'COMBAT' ? '#000' : '#00ffff', border: '1px solid #00ffff', cursor: 'pointer', fontSize: '12px', borderRadius: '2px' }}
                            >
                                战斗
                            </button>
                            <button 
                                onClick={() => setOrderFilter('PATROL')}
                                style={{ flex: 1, padding: '5px', background: orderFilter === 'PATROL' ? '#00ffff' : 'transparent', color: orderFilter === 'PATROL' ? '#000' : '#00ffff', border: '1px solid #00ffff', cursor: 'pointer', fontSize: '12px', borderRadius: '2px' }}
                            >
                                巡逻
                            </button>
                        </div>
                        
                        <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '5px' }}>
                            {ordersList.length === 0 ? (
                                <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>当前没有任何订单</div>
                            ) : (
                                ordersList.filter(o => orderFilter === 'ALL' || o.type === orderFilter).map((order: any) => (
                                    <div key={order.id} style={{ background: 'rgba(0, 0, 0, 0.5)', border: '1px solid #00ffff', padding: '8px', borderRadius: '4px' }}>
                                        <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '4px', wordBreak: 'break-all' }}>ID: {order.id}</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: '#fff', fontWeight: 'bold' }}>类型: <span style={{ color: '#00ffff' }}>{order.type}</span></span>
                                            <span style={{ color: '#fff' }}>阵营: <span style={{ color: '#ffaa00' }}>{order.factionId}</span></span>
                                        </div>
                                        <div style={{ fontSize: '13px', color: '#ccc', marginTop: '4px' }}>
                                            状态: <span style={{ color: order.status === 'PENDING' ? '#ff0' : '#0f0' }}>{order.status}</span>
                                            
                                            {/* 根据不同类型显示 payload 详情 */}
                                            {order.type === 'BUILD' && order.payload && order.payload.hullId && ` | 目标船型: ${order.payload.hullId}`}
                                            
                                            {order.type === 'COMBAT' && order.payload && (
                                                <div style={{ color: '#ff6666', marginTop: '2px' }}>
                                                    目标星区: {order.payload.targetSector}
                                                    {order.payload.priority && ` | 优先级: ${order.payload.priority}`}
                                                    {order.payload.assigneeId && ` | 接单者: ${order.payload.assigneeId}`}
                                                </div>
                                            )}
                                            
                                            {order.type === 'PATROL' && order.payload && (
                                                <div style={{ color: '#66ccff', marginTop: '2px' }}>
                                                    巡逻星区: {order.payload.targetSector}
                                                    {order.payload.duration && ` | 驻留时长: ${order.payload.duration}s`}
                                                    {order.payload.assigneeId && ` | 接单者: ${order.payload.assigneeId}`}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                            生成时间: {new Date(order.timestamp).toLocaleString()}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <p style={{ fontSize: '12px', color: '#888', marginTop: '10px', textAlign: 'center' }}>
                            订单数据由 WorldbookManager 的宏观结算（每 10 秒）自动生成。
                        </p>
                    </div>
                </>
            )}

            {activeTab === 'npcs' && (
                <>
                    <div style={{ background: 'rgba(255, 255, 0, 0.1)', padding: '10px', borderRadius: '4px', marginBottom: '15px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <h4 style={{ margin: 0, color: '#ffff00' }}>NPC 实体池 ({npcList.length})</h4>
                            <button 
                                onClick={refreshNPCs}
                                style={{ padding: '5px 10px', background: '#aaaa00', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                刷新列表
                            </button>
                        </div>
                        
                        <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '5px' }}>
                            {npcList.length === 0 ? (
                                <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>当前没有任何 NPC</div>
                            ) : (
                                npcList.map((npc: any) => (
                                    <div key={npc.id} style={{ background: 'rgba(0, 0, 0, 0.5)', border: '1px solid #ffff00', padding: '8px', borderRadius: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>{npc.name}</span>
                                            <span style={{ color: '#ffaa00', fontSize: '12px' }}>阵营: {npc.factionId}</span>
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#aaa', margin: '4px 0', wordBreak: 'break-all' }}>ID: {npc.id}</div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#ccc' }}>
                                            <span>资金: <span style={{ color: '#0f0' }}>{Math.floor(npc.credits)} 币</span></span>
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#66ccff', marginTop: '4px' }}>
                                            飞船资产: {npc.ownedShips?.length || 0} 艘 | 基地资产: {npc.ownedBuildings?.length || 0} 座
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
