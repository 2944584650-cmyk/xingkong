import React, { useState, useEffect } from 'react';
import { PlayerManager } from '../managers/PlayerManager';
import EquipmentData from '../../json/EquipmentData.json';
import { ZuoXiaJiao } from './ZuoXiaJiao';
import { YouXiaJiao } from './youxiajiao';
import { EventBus, GameEvents } from '../utils/EventBus';
import { StarmapPanel } from './panels/StarmapPanel';
import { JianDui } from './JianDui';
import { ZhuangBei } from './ZhuangBei';
import { CangKu } from './CangKu';
import { CoreUI } from './CoreUI';
import { BoQuUI } from './BoQuUI';
import { ChuanWuUI } from './ChuanWuUI';
import { ObserveUI } from './ObserveUI';
import { EntityContextMenu, ContextMenuData } from './EntityContextMenu';

export const MainUI: React.FC = () => {
    // Component State
    const [showStarmap, setShowStarmap] = useState(false);
    const [showJianDui, setShowJianDui] = useState(false);
    const [showZhuangBei, setShowZhuangBei] = useState(false);
    const [showCangKu, setShowCangKu] = useState(false);
    const [showCoreUI, setShowCoreUI] = useState(false);
    const [showBoQuUI, setShowBoQuUI] = useState(false);
    const [showChuanWuUI, setShowChuanWuUI] = useState(false);
    const [showObserveUI, setShowObserveUI] = useState(false);
    const [observeShipData, setObserveShipData] = useState<any>(null);
    
    // UI Panel Z-Index Management
    const [activePanel, setActivePanel] = useState<string | null>(null);

    const [coreUIModuleData, setCoreUIModuleData] = useState<any>(null);
    const [boQuUIModuleData, setBoQuUIModuleData] = useState<any>(null);
    const [chuanWuUIModuleData, setChuanWuUIModuleData] = useState<any>(null);

    const [equippedItems, setEquippedItems] = useState<any[]>([]);
    
    // Splitter states
    const [leftPanelWidth, setLeftPanelWidth] = useState(38);
    const [bottomPanelHeight, setBottomPanelHeight] = useState(40);
    const [resizing, setResizing] = useState<'vertical' | 'horizontal' | 'both' | null>(null);

    // Background Click Context Menu State
    const [bgContextMenu, setBgContextMenu] = useState<ContextMenuData | null>(null);

    // Module Click UI State
    const [clickedModule, setClickedModule] = useState<{ x: number, y: number, module: any, modData: any } | null>(null);

    // 远程监控状态
    const [isRemoteViewing, setIsRemoteViewing] = useState(false);
    const [currentRealSector, setCurrentRealSector] = useState('');
    const [viewingSector, setViewingSector] = useState('');

    // 玩家跃迁状态
    const [isPlayerWarping, setIsPlayerWarping] = useState(false);

    // Handle Splitter Resizing
    useEffect(() => {
        if (!resizing) return;

        const handlePointerMove = (e: PointerEvent) => {
            if (resizing === 'vertical' || resizing === 'both') {
                const newWidth = (e.clientX / window.innerWidth) * 100;
                if (newWidth > 10 && newWidth < 90) setLeftPanelWidth(newWidth);
            }
            if (resizing === 'horizontal' || resizing === 'both') {
                const newHeight = ((window.innerHeight - e.clientY) / window.innerHeight) * 100;
                if (newHeight > 10 && newHeight < 90) setBottomPanelHeight(newHeight);
            }
        };

        const handlePointerUp = () => {
            setResizing(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [resizing]);

    // Update phaser's radar scene via global event, only sending the values without breaking the camera viewport mapping
    useEffect(() => {
        document.dispatchEvent(new CustomEvent('ui_layout_changed', {
            detail: { leftWidth: leftPanelWidth, bottomHeight: bottomPanelHeight }
        }));

        // 关键修复：动态修改 Phaser 画布容器的真实大小，使游戏画布能跟着UI变大变小
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.style.width = `${100 - leftPanelWidth}vw`;
            gameContainer.style.height = `${100 - bottomPanelHeight}vh`;
            
            // 确保在进入游戏或面板调整时，Phaser 也能接收到立刻 Resize 的指令，而不用等 ResizeObserver
            if ((window as any).game && (window as any).game.scale) {
                const rect = gameContainer.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    (window as any).game.scale.resize(rect.width, rect.height);
                }
            }
        }
    }, [leftPanelWidth, bottomPanelHeight]);
    
    // 初始化挂载时，强制分发一次 layout 事件以适应 UI 占据的四宫格
    useEffect(() => {
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.style.width = `${100 - leftPanelWidth}vw`;
            gameContainer.style.height = `${100 - bottomPanelHeight}vh`;
            
            if ((window as any).game && (window as any).game.scale) {
                setTimeout(() => {
                    const rect = gameContainer.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        (window as any).game.scale.resize(rect.width, rect.height);
                    }
                }, 100);
            }
        }
    }, []);

    // Load data from PlayerManager to populate equipment
    useEffect(() => {
        const loadEquipmentData = () => {
            const stats: any = PlayerManager.getStats();
            if (stats && stats.playerShipId && stats.ownedShips) {
                const ship = stats.ownedShips.find((s: any) => s.id === stats.playerShipId);
                if (ship && ship.slots) {
                    const equipmentList: any[] = [];
                    // Iterate over slots and find all equipments
                    Object.entries(ship.slots).forEach(([slotKey, compId]) => {
                        if (compId) {
                            const components = EquipmentData.COMPONENTS as Record<string, any>;
                            const compDef = components[compId as string];
                            if (compDef && compDef.meta.canToggle) {
                                equipmentList.push({
                                    slotId: slotKey,
                                    name: compDef.meta.name || compId,
                                    active: true // Initially active
                                });
                            }
                        }
                    });
                    setEquippedItems(equipmentList);
                }
            }
        };

        // Initialize equipment data
        loadEquipmentData();

        // High-performance direct DOM manipulation loop for weapon cooldowns
        let rafId: number;
        const updateCooldowns = () => {
            const game = (window as any).Phaser?.GAMES?.[0] || (window as any).game;
            if (game && game.scene) {
                const baseScene = game.scene.getScene('Base');
                if (baseScene && baseScene.radarEntities) {
                    const pd = PlayerManager.getStats();
                    let playerEnt = null;
                    if (baseScene.radarEntities.defenders) {
                        playerEnt = baseScene.radarEntities.defenders.find((e: any) => String(e.id) === String(pd.playerShipId));
                    }
                    if (!playerEnt && baseScene.radarEntities.attackers) {
                        playerEnt = baseScene.radarEntities.attackers.find((e: any) => String(e.id) === String(pd.playerShipId));
                    }
                    
                    if (playerEnt && playerEnt.shipRef) {
                        const weps = playerEnt.shipRef.activeWeapons || [];
                        weps.forEach((w: any) => {
                        const bar = document.getElementById(`cd-bar-${w.slotId}`);
                        if (bar) {
                            const maxCd = w.stats?.fireRate || 1.5;
                            const currentCd = w.cooldown || 0;
                            let ratio = currentCd / maxCd;
                            if (ratio < 0) ratio = 0;
                            if (ratio > 1) ratio = 1;
                            
                            // Calculate width
                            bar.style.width = `${ratio * 100}%`;
                            
                            // Visual effects (flash when firing)
                            if (ratio > 0.95) {
                                bar.style.backgroundColor = 'rgba(0, 255, 204, 0.8)';
                                bar.style.boxShadow = '0 0 15px rgba(0, 255, 204, 1)';
                            } else {
                                bar.style.backgroundColor = 'rgba(0, 255, 204, 0.4)';
                                bar.style.boxShadow = 'none';
                            }
                            
                            // Hide completely if 0
                            if (ratio === 0) {
                                bar.style.opacity = '0';
                            } else {
                                bar.style.opacity = '1';
                            }
                        }
                    });
                    }
                }
            }
            rafId = requestAnimationFrame(updateCooldowns);
        };
        rafId = requestAnimationFrame(updateCooldowns);

        const handleOpenStarmap = () => {
            setShowStarmap(true);
            setActivePanel('starmap');
        };
        EventBus.addEventListener(GameEvents.OPEN_STARMAP, handleOpenStarmap);

        const handleOpenJianDui = () => {
            setShowJianDui(true);
            setActivePanel('fleet');
        };
        EventBus.addEventListener(GameEvents.OPEN_FLEET, handleOpenJianDui);

        const handleOpenZhuangBei = () => {
            setShowZhuangBei(true);
            setActivePanel('equipment');
        };
        EventBus.addEventListener(GameEvents.OPEN_EQUIPMENT, handleOpenZhuangBei);

        const handleOpenCangKu = () => {
            setShowCangKu(true);
            setActivePanel('inventory');
        };
        EventBus.addEventListener(GameEvents.OPEN_INVENTORY, handleOpenCangKu);

        // 监听视图切换事件，以判定是否显示“退出监视”按钮
        const checkViewStatus = () => {
            const game = (window as any).Phaser?.GAMES?.[0] || (window as any).game;
            if (game && game.scene) {
                const baseScene = game.scene.getScene('Base');
                if (baseScene) {
                    let realSector = localStorage.getItem('current_sector');
                    if (!realSector) {
                        console.error("[MainUI] 致命错误：未找到 current_sector！使用默认兜底星区。");
                        realSector = '创世星柱废墟';
                    }
                    const currentView = baseScene.viewingSector || realSector;
                    setCurrentRealSector(realSector);
                    setViewingSector(currentView);
                    setIsRemoteViewing(currentView !== realSector);
                }
            }
        };

        // 定期轮询（或者可以依赖特定的自定义事件），这里用 1 秒轮询保证状态正确
        const viewCheckInterval = setInterval(checkViewStatus, 1000);
        checkViewStatus(); // 立即执行一次

        const handleWarpState = (e: any) => {
            setIsPlayerWarping(e.detail);
        };
        document.addEventListener('player_warp_state', handleWarpState);

        const handleRadarRightClick = (e: any) => {
            const detail = e.detail;
            const game = (window as any).Phaser?.GAMES?.[0] || (window as any).game;
            let hasSelectedUnit = false;
            if (game && game.scene) {
                const baseScene = game.scene.getScene('Base');
                if (baseScene && baseScene.selectedUnitIds && baseScene.selectedUnitIds.length > 0) {
                    hasSelectedUnit = true;
                }
            }

            // 判断当前是否处于“可以下达指令”的状态。
            // 如果玩家单选了一个不是自己的飞船，此时他不具有战术指挥权，右键只能进行“交流”
            let isCommandMode = false;
            let interactTarget = null;
            
            if (hasSelectedUnit && game && game.scene) {
                const baseScene = game.scene.getScene('Base');
                const selectedIds = baseScene?.selectedUnitIds || [];
                
                // 获取玩家拥有的飞船ID列表
                const stats: any = PlayerManager.getStats();
                const ownedIds = stats?.ownedShips?.map((s: any) => String(s.id)) || [];
                
                // 如果选中的单位里有属于玩家的船（且不是母舰），则允许战术指挥
                isCommandMode = selectedIds.some((id: string) => ownedIds.includes(String(id)) && String(id) !== String(stats?.playerShipId));
                
                if (detail.targetShip) {
                    interactTarget = detail.targetShip.id;
                } else if (!isCommandMode && selectedIds.length === 1 && !ownedIds.includes(String(selectedIds[0]))) {
                    interactTarget = selectedIds[0];
                }
            } else if (detail.targetShip) {
                interactTarget = detail.targetShip.id;
            }

            if (isCommandMode || interactTarget) {
                let adjustedWorldX = detail.x;
                let adjustedWorldY = detail.y;
                
                if (!detail.targetNode) {
                    setBgContextMenu({
                        x: detail.screenX,
                        y: detail.screenY,
                        worldX: adjustedWorldX,
                        worldY: adjustedWorldY,
                        targetShip: detail.targetShip,
                        isCommandMode: isCommandMode,
                        interactTargetId: interactTarget
                    });
                } else {
                    setBgContextMenu(null);
                }
            } else {
                setBgContextMenu(null);
            }
        };
        document.addEventListener('radar_right_click', handleRadarRightClick);
        
        const closeBgMenu = (e: Event) => {
            // Only close if it's a left click (button 0)
            if ((e as MouseEvent).button === 0) {
                setBgContextMenu(null);
                // Also close module UI if clicking outside
                setClickedModule(null);
            }
        };
        window.addEventListener('pointerdown', closeBgMenu);

        // Listen for module clicks
        const handleModuleClick = (e: any) => {
            const detail = e.detail;
            if (detail && detail.module && detail.modData) {
                // 直接根据模块类型打开对应界面，完全跳过原来的属性交互小弹窗
                const modName = detail.modData.name || '';
                const modData = detail.modData;
                const category = modData.category || '';

                if (category === 'shipyard') {
                    setChuanWuUIModuleData({ ...modData, module: detail.module });
                    setShowChuanWuUI(true);
                    setActivePanel('chuanwu');
                } else if (category === 'core') {
                    setCoreUIModuleData({ ...modData, module: detail.module });
                    setShowCoreUI(true);
                    setActivePanel('coreui');
                } else if (category === 'docking') {
                    setBoQuUIModuleData({ ...modData, module: detail.module });
                    setShowBoQuUI(true);
                    setActivePanel('boqu');
                } else {
                    // 如果是没有特定UI的模块，可以保留一个提示或者干脆什么都不做
                    console.log(`未绑定直接UI界面: ${modName}`);
                }
                setClickedModule(null);
            }
        };
        document.addEventListener('radar_module_click', handleModuleClick);

        const handleOpenObservePanel = (e: CustomEvent) => {
            setObserveShipData(e.detail);
            setShowObserveUI(true);
            setActivePanel('observe');
        };
        document.addEventListener('OPEN_OBSERVE_PANEL', handleOpenObservePanel as EventListener);

        // Listen for player ship changed event to refresh the equipment
        document.addEventListener('PLAYER_SHIP_CHANGED', loadEquipmentData);
        
        // Optional: Listen for an event if the ship's equipment changes during gameplay
        // EventBus.addEventListener(GameEvents.PLAYER_EQUIPMENT_CHANGED, loadEquipmentData);
        return () => {
            document.removeEventListener('PLAYER_SHIP_CHANGED', loadEquipmentData);
            cancelAnimationFrame(rafId);
            EventBus.removeEventListener(GameEvents.OPEN_STARMAP, handleOpenStarmap);
            EventBus.removeEventListener(GameEvents.OPEN_FLEET, handleOpenJianDui);
            EventBus.removeEventListener(GameEvents.OPEN_EQUIPMENT, handleOpenZhuangBei);
            EventBus.removeEventListener(GameEvents.OPEN_INVENTORY, handleOpenCangKu);
            clearInterval(viewCheckInterval);
            document.removeEventListener('player_warp_state', handleWarpState);
            document.removeEventListener('radar_right_click', handleRadarRightClick);
            window.removeEventListener('pointerdown', closeBgMenu);
            document.removeEventListener('radar_module_click', handleModuleClick);
            document.removeEventListener('OPEN_OBSERVE_PANEL', handleOpenObservePanel as EventListener);
            // EventBus.removeEventListener(GameEvents.PLAYER_EQUIPMENT_CHANGED, loadEquipmentData);
        };
    }, []);

    // 退出远程监控，返回玩家物理所在星区
    const handleExitRemoteView = () => {
        const game = (window as any).Phaser?.GAMES?.[0] || (window as any).game;
        if (game && game.scene) {
            const baseScene = game.scene.getScene('Base');
            if (baseScene && typeof baseScene.switchRadarView === 'function') {
                let realSector = localStorage.getItem('current_sector');
                if (!realSector) {
                    console.error("[MainUI] 致命错误：未找到 current_sector！使用默认兜底星区。");
                    realSector = '创世星柱废墟';
                }
                baseScene.switchRadarView(realSector);
                setIsRemoteViewing(false);
                EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, {
                    detail: `<div style="color:#00ff00;">[系统] 远程监控已断开。视觉已切换回本地坐标 [${realSector}]。</div>`
                }));
            }
        }
    };

    const toggleEquipment = (slotId: string, state: boolean) => {
        setEquippedItems(prev =>
            prev.map(item =>
                item.slotId === slotId ? { ...item, active: state } : item
            )
        );
        document.dispatchEvent(new CustomEvent('TOGGLE_EQUIPMENT', {
            detail: { slotId, active: state }
        }));
    };

    const handleExit = () => {
        // Simple reload for now, as was standard for "Sys.Logout" in previous HUD
        window.location.reload();
    };


    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'none'
        }}>
            
            {/* 远程监控警告与退出按钮（如果激活） */}
            {isRemoteViewing && (
                <div style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    zIndex: 9999,
                    pointerEvents: 'auto',
                    backgroundColor: 'rgba(50, 0, 0, 0.85)',
                    border: '2px solid #ff3333',
                    borderRadius: '8px',
                    padding: '15px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    boxShadow: '0 0 20px rgba(255, 0, 0, 0.4)',
                    color: '#ff3333',
                    fontFamily: 'monospace'
                }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ animation: 'blink 1s infinite' }}>⚠️</span> 远程监控模式已激活
                    </div>
                    <div style={{ fontSize: '0.9rem', marginBottom: '15px', color: '#ffaaaa' }}>
                        当前监视节点: <span style={{ color: '#fff' }}>{viewingSector}</span>
                    </div>
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleExitRemoteView(); }}
                        style={{
                            padding: '8px 25px',
                            backgroundColor: '#ff3333',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            boxShadow: '0 0 10px rgba(255, 50, 50, 0.5)',
                            transition: 'all 0.2s'
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#ff5555')}
                        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ff3333')}
                    >
                        断开连接并返回
                    </button>
                    <style>{`
                        @keyframes blink {
                            0% { opacity: 1; }
                            50% { opacity: 0; }
                            100% { opacity: 1; }
                        }
                    `}</style>
                </div>
            )}

            {/* Top row container to hold the Left Panel and the Empty Right Space (Game View) */}
            <div style={{ display: 'flex', height: `${100 - bottomPanelHeight}%`, overflow: 'hidden' }}>

                {/* Top-Left Panel: Equipment and Exit */}
                <div style={{
                    width: `${leftPanelWidth}%`,
                    height: '100%',
                    background: 'linear-gradient(135deg, rgba(12, 34, 63, 0.95) 0%, rgba(4, 14, 28, 0.98) 100%)',
                    boxShadow: 'inset -2px 0px 15px rgba(0, 255, 255, 0.1), inset 0px 0px 30px rgba(0, 0, 0, 0.8)',
                    backdropFilter: 'blur(5px)',
                    borderRight: '1px solid rgba(0, 255, 255, 0.15)',
                    pointerEvents: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '20px',
                    boxSizing: 'border-box'
                }}>

                    {/* Top Control Bar */}
                    <div style={{
                        width: 'calc(100% + 40px)', // 抵消外部左右的 20px padding
                        marginLeft: '-20px',
                        marginTop: '-20px',
                        marginBottom: '20px',
                        height: '50px',
                        backgroundColor: 'rgba(0, 40, 80, 0.6)',
                        borderBottom: '1px solid rgba(0, 255, 255, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        padding: '0 20px',
                        gap: '15px',
                        boxSizing: 'border-box',
                        flexShrink: 0
                    }}>
                        <button
                            onClick={handleExit}
                            style={{
                                padding: '5px 15px',
                                backgroundColor: 'white',
                                color: '#0096FF',
                                border: 'none',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                height: '80%'
                            }}
                        >
                            退出
                        </button>

                        <button
                            onClick={() => EventBus.dispatchEvent(new CustomEvent('SHOW_SAVE_MENU'))}
                            style={{
                                padding: '5px 15px',
                                backgroundColor: 'transparent',
                                color: '#00ffff',
                                border: '1px solid #00ffff',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                height: '80%',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                            onMouseOver={(e) => {
                                (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0, 255, 255, 0.2)';
                            }}
                            onMouseOut={(e) => {
                                (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                            }}
                        >
                            💾 存储
                        </button>
                    </div>

                    {/* Equipment List with Scroll */}
                    <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '20px',
                        overflowY: 'auto',
                        flex: 1,
                        paddingRight: '10px',
                    }}>
                        {equippedItems.length === 0 ? (
                            <div style={{ color: 'white', fontStyle: 'italic', fontSize: '2rem' }}>无装备</div>
                        ) : (
                            equippedItems.map((item) => (
                                <div key={item.slotId} style={{
                                    display: 'flex',
                                    justifyContent: 'flex-start',
                                    alignItems: 'stretch',
                                    minHeight: '55px',
                                    flexShrink: 0,
                                    backgroundColor: '#8c929a', // 重工底色
                                    border: '2px solid',
                                    borderColor: '#b0b8c0 #4a4e54 #4a4e54 #a0a6ae',
                                    boxShadow: 'inset 0 2px 5px rgba(255,255,255,0.2), 0 4px 8px rgba(0,0,0,0.6)',
                                    padding: '6px',
                                    position: 'relative',
                                    backgroundImage: 'linear-gradient(90deg, transparent 24%, rgba(0, 0, 0, 0.05) 25%, rgba(0, 0, 0, 0.05) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, 0.05) 75%, rgba(255, 255, 255, 0.05) 76%, transparent 77%, transparent)',
                                    backgroundSize: '20px 20px'
                                }}>
                                    {/* 名称显示 */}
                                    <div style={{
                                        position: 'relative', // 为了让内层冷却条绝对定位
                                        color: item.active ? '#e0e0e0' : '#888',
                                        textShadow: item.active ? '0 0 5px rgba(255,255,255,0.3)' : 'none',
                                        fontWeight: 'bold',
                                        fontSize: '1.2rem',
                                        fontFamily: 'monospace',
                                        backgroundColor: '#111',
                                        border: '2px solid',
                                        borderColor: '#000 #333 #333 #000',
                                        boxShadow: 'inset 0 0 10px rgba(0,0,0,0.9)',
                                        padding: '0 15px',
                                        marginRight: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'flex-start',
                                        flex: 1,
                                        zIndex: 1,
                                        overflow: 'hidden' // 确保绿条不溢出黑色边框
                                    }}>
                                        {/* 冷却进度条层 (绝对定位，动态宽度) */}
                                        <div 
                                            id={`cd-bar-${item.slotId}`}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                height: '100%',
                                                width: '0%', // 默认0
                                                backgroundColor: 'rgba(0, 255, 204, 0.4)',
                                                opacity: 0,
                                                zIndex: 0, // 在文字和指示灯下面
                                                pointerEvents: 'none',
                                                // 当开火瞬间会有闪烁过渡，回退冷却时很平滑
                                                transition: 'opacity 0.1s' 
                                            }} 
                                        />

                                        {/* 状态指示灯 */}
                                        <div style={{
                                            width: '10px', height: '10px', borderRadius: '50%',
                                            backgroundColor: item.active ? '#00ffcc' : '#ff3333',
                                            boxShadow: item.active ? '0 0 8px #00ffcc' : '0 0 8px #ff3333',
                                            marginRight: '15px',
                                            border: '1px solid #000',
                                            zIndex: 1
                                        }}/>
                                        <span style={{ zIndex: 1 }}>{item.name}</span>
                                    </div>

                                    {/* 工业风拨动开关 */}
                                    <div style={{
                                        width: '100px',
                                        backgroundColor: '#111',
                                        border: '2px solid',
                                        borderColor: '#000 #333 #333 #000',
                                        position: 'relative',
                                        display: 'flex',
                                        zIndex: 1,
                                        cursor: 'pointer',
                                        boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.9)'
                                    }}
                                    onClick={() => toggleEquipment(item.slotId, !item.active)}
                                    >
                                        {/* 底部文字标记 */}
                                        <div style={{ position: 'absolute', width: '100%', height: '100%', display: 'flex' }}>
                                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff3333', fontSize: '0.9rem', fontWeight: 'bold', opacity: item.active ? 0.3 : 1 }}>OFF</div>
                                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00ffcc', fontSize: '0.9rem', fontWeight: 'bold', opacity: item.active ? 1 : 0.3 }}>ON</div>
                                        </div>

                                        {/* 实体滑块 */}
                                        <div style={{
                                            position: 'absolute',
                                            top: '-3px',
                                            bottom: '-3px',
                                            width: '50%',
                                            backgroundColor: '#6c727a',
                                            border: '2px solid',
                                            borderColor: '#b0b8c0 #3a3e44 #3a3e44 #90969e',
                                            left: item.active ? '50%' : '0',
                                            transition: 'left 0.15s cubic-bezier(0.4, 0.0, 0.2, 1)',
                                            boxShadow: '0 4px 6px rgba(0,0,0,0.6), inset 0 2px 4px rgba(255,255,255,0.2)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            zIndex: 2
                                        }}>
                                            {/* 金属防滑纹理 */}
                                            <div style={{ display: 'flex', gap: '3px' }}>
                                                <div style={{ width: '2px', height: '20px', backgroundColor: '#3a3e44', borderRight: '1px solid #90969e' }}/>
                                                <div style={{ width: '2px', height: '20px', backgroundColor: '#3a3e44', borderRight: '1px solid #90969e' }}/>
                                                <div style={{ width: '2px', height: '20px', backgroundColor: '#3a3e44', borderRight: '1px solid #90969e' }}/>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                        </div>
                    </div>

            {/* Top-Right Area: Empty (transparent) for Game View */}
            <div style={{ flex: '1 1 auto', position: 'relative' }}>
                {/* 跃迁覆盖层 已移除，恢复原本清爽的界面 */}
            </div>
            </div>

            {/* Bottom Row Container */}
            <div style={{ display: 'flex', height: `${bottomPanelHeight}%` }}>

            
                <ZuoXiaJiao width={leftPanelWidth} />

                {/* Bottom-Right Panel: Heavy Industrial Radar Base */}
                <div style={{
                    flex: '1 1 auto',
                    height: '100%',
                    // 重工金属亮灰色底色
                    backgroundColor: '#8c929a', 
                    // 金属拉丝和生锈油污纹理
                    backgroundImage: `
                        linear-gradient(0deg, transparent 24%, rgba(0, 0, 0, 0.1) 25%, rgba(0, 0, 0, 0.1) 26%, transparent 27%, transparent 74%, rgba(0, 0, 0, 0.1) 75%, rgba(0, 0, 0, 0.1) 76%, transparent 77%, transparent),
                        linear-gradient(90deg, transparent 24%, rgba(255, 255, 255, 0.1) 25%, rgba(255, 255, 255, 0.1) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, 0.1) 75%, rgba(255, 255, 255, 0.1) 76%, transparent 77%, transparent),
                        radial-gradient(circle at 30% 70%, rgba(50, 40, 30, 0.2) 0%, transparent 40%),
                        radial-gradient(circle at 80% 20%, rgba(40, 45, 50, 0.3) 0%, transparent 50%)
                    `,
                    backgroundSize: '30px 30px, 30px 30px, 100% 100%, 100% 100%',
                    // 整体边框产生强烈的厚重钢铁切割感
                    boxShadow: 'inset 0px 10px 20px rgba(255, 255, 255, 0.3), inset 0px -10px 30px rgba(0,0,0,0.8), 0 0 15px rgba(0,0,0,0.5)',
                    borderTop: '4px solid #b0b8c0',
                    borderLeft: '2px solid #a0a6ae',
                    borderBottom: '4px solid #4a4e54',
                    borderRight: '2px solid #5a5f66',
                    pointerEvents: 'auto',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative'
                }}>
                    {/* 右侧白炽灯泛光打光效果 */}
                    <div style={{
                        position: 'absolute',
                        top: '-50px', right: '-50px',
                        width: '300px', height: '300px',
                        background: 'radial-gradient(circle, rgba(255, 245, 220, 0.4) 0%, rgba(255, 245, 220, 0.1) 40%, transparent 70%)',
                        pointerEvents: 'none',
                        zIndex: 0
                    }} />

                    {/* 左侧顶明白炽灯光效果 */}
                    <div style={{
                        position: 'absolute',
                        top: '10px', left: '10%',
                        width: '60%', height: '40px',
                        background: 'radial-gradient(ellipse at top, rgba(255, 255, 240, 0.35) 0%, transparent 70%)',
                        pointerEvents: 'none',
                        zIndex: 0
                    }} />

                    {/* 内凹装甲板凹槽，带重工业黄色边框和黑色内底 */}
                    <div style={{
                        position: 'absolute',
                        top: '20px', bottom: '20px', left: '20px', right: '20px',
                        border: '4px solid #d4a017', // 重工黄边框
                        borderBottomColor: '#8a660a',
                        borderRightColor: '#8a660a',
                        borderTopColor: '#ffc11a',
                        borderLeftColor: '#ffc11a',
                        borderRadius: '8px',
                        boxShadow: 'inset 0 0 50px rgba(0,0,0,0.95), 0 0 20px rgba(0,0,0,0.6), 0 2px 0 rgba(255,255,255,0.4)',
                        backgroundColor: '#111', // 内部雷达区域的底色保持黑色
                        pointerEvents: 'none',
                        zIndex: 0
                    }} />

                    {/* 四角重型固定金属螺栓 */}
                    {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((pos, i) => (
                        <div key={i} style={{
                            position: 'absolute',
                            width: '32px', height: '32px',
                            backgroundColor: '#6c727a',
                            borderRadius: '50%',
                            border: '3px solid #4a4e54',
                            borderTopColor: '#b0b8c0',
                            borderLeftColor: '#90969e',
                            boxShadow: 'inset 0 4px 8px rgba(0,0,0,0.6), 0 2px 5px rgba(0,0,0,0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...(pos.includes('top') ? { top: '8px' } : { bottom: '8px' }),
                            ...(pos.includes('left') ? { left: '8px' } : { right: '8px' }),
                            zIndex: 1
                        }}>
                            {/* 内六角/十字螺丝纹理 */}
                            <div style={{ 
                                width: '16px', height: '4px', 
                                backgroundColor: '#222', 
                                boxShadow: '0 1px 0 rgba(255,255,255,0.3)',
                                transform: `rotate(${i * 45 + 10}deg)` 
                            }} />
                            <div style={{ 
                                position: 'absolute',
                                width: '16px', height: '4px', 
                                backgroundColor: '#222', 
                                boxShadow: '0 1px 0 rgba(255,255,255,0.3)',
                                transform: `rotate(${i * 45 + 10 + 90}deg)` 
                            }} />
                        </div>
                    ))}
                    
                    {/* 顶部和底部重工警示漆 (黄黑相间，更加鲜明) */}
                    <div style={{
                        position: 'absolute',
                        bottom: '2px', left: '50%',
                        transform: 'translateX(-50%)',
                        width: '60%', height: '12px',
                        background: 'repeating-linear-gradient(-45deg, #d4a017, #d4a017 12px, #222 12px, #222 24px)',
                        borderTop: '2px solid #555',
                        borderBottom: '2px solid #aaa',
                        boxShadow: '0 0 10px rgba(0,0,0,0.5), inset 0 2px 5px rgba(0,0,0,0.6)',
                        zIndex: 1
                    }} />
                    <div style={{
                        position: 'absolute',
                        top: '2px', left: '50%',
                        transform: 'translateX(-50%)',
                        width: '40%', height: '10px',
                        background: 'repeating-linear-gradient(45deg, #d4a017, #d4a017 10px, #222 10px, #222 20px)',
                        borderTop: '1px solid #eee',
                        borderBottom: '2px solid #444',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.5), inset 0 -2px 4px rgba(0,0,0,0.4)',
                        zIndex: 1
                    }} />

                    {/* 面板大型散热排/进气格栅 (左侧) */}
                    <div style={{
                        position: 'absolute',
                        top: '50%', left: '8px',
                        transform: 'translateY(-50%)',
                        width: '30px', height: '120px',
                        background: 'repeating-linear-gradient(0deg, #111, #111 6px, transparent 6px, transparent 12px)',
                        backgroundColor: '#333',
                        border: '2px solid #5a5f66',
                        borderRightColor: '#b0b8c0',
                        borderBottomColor: '#a0a6ae',
                        boxShadow: 'inset 0 10px 20px rgba(0,0,0,0.9), 0 2px 4px rgba(255,255,255,0.2)',
                        zIndex: 1,
                        borderRadius: '2px'
                    }} />
                    
                    {/* 雷达主体 */}
                    <div style={{ zIndex: 2, width: '100%', height: '100%' }}>
                        <YouXiaJiao />
                    </div>
                </div>
            </div>

            {/* Splitters for resizing the layout */}
            
            {/* Vertical Splitter (机械质感装甲槽线) */}
            <div 
                style={{
                    position: 'absolute',
                    left: `calc(${leftPanelWidth}% - 5px)`,
                    top: 0,
                    bottom: 0,
                    width: '10px',
                    cursor: 'col-resize',
                    zIndex: 999,
                    pointerEvents: 'auto',
                    background: 'linear-gradient(90deg, rgba(5,10,15,0.9) 0%, rgba(20,30,40,1) 50%, rgba(5,10,15,0.9) 100%)',
                    borderLeft: '1px solid rgba(255,255,255,0.05)',
                    borderRight: '1px solid rgba(0,0,0,0.8)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    boxShadow: '0 0 10px rgba(0,0,0,0.8)'
                }}
                onPointerDown={(e) => { e.stopPropagation(); setResizing('vertical'); }}
            >
                {/* 内部发光能量流 */}
                <div style={{
                    width: '2px',
                    height: '100%',
                    background: 'linear-gradient(to bottom, transparent, rgba(0, 255, 255, 0.8) 20%, rgba(0, 255, 255, 0.8) 80%, transparent)',
                    boxShadow: '0 0 8px rgba(0, 255, 255, 0.5)',
                }} />
                {/* 机械防滑纹理点缀 */}
                <div style={{ position: 'absolute', top: '25%', width: '100%', height: '50px', background: 'repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(0, 255, 255, 0.15) 4px, rgba(0, 255, 255, 0.15) 6px)' }} />
                <div style={{ position: 'absolute', top: '75%', width: '100%', height: '50px', background: 'repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(0, 255, 255, 0.15) 4px, rgba(0, 255, 255, 0.15) 6px)' }} />
            </div>

            {/* Horizontal Splitter (机械质感装甲槽线) */}
            <div 
                style={{
                    position: 'absolute',
                    top: `calc(${100 - bottomPanelHeight}% - 5px)`,
                    left: 0,
                    right: 0,
                    height: '10px',
                    cursor: 'row-resize',
                    zIndex: 999,
                    pointerEvents: 'auto',
                    background: 'linear-gradient(180deg, rgba(5,10,15,0.9) 0%, rgba(20,30,40,1) 50%, rgba(5,10,15,0.9) 100%)',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    borderBottom: '1px solid rgba(0,0,0,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    boxShadow: '0 0 10px rgba(0,0,0,0.8)'
                }}
                onPointerDown={(e) => { e.stopPropagation(); setResizing('horizontal'); }}
            >
                {/* 内部发光能量流 */}
                <div style={{
                    height: '2px',
                    width: '100%',
                    background: 'linear-gradient(to right, transparent, rgba(0, 255, 255, 0.8) 20%, rgba(0, 255, 255, 0.8) 80%, transparent)',
                    boxShadow: '0 0 8px rgba(0, 255, 255, 0.5)',
                }} />
                {/* 机械防滑纹理点缀 */}
                <div style={{ position: 'absolute', left: '20%', height: '100%', width: '80px', background: 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(0, 255, 255, 0.15) 4px, rgba(0, 255, 255, 0.15) 6px)' }} />
                <div style={{ position: 'absolute', right: '20%', height: '100%', width: '80px', background: 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(0, 255, 255, 0.15) 4px, rgba(0, 255, 255, 0.15) 6px)' }} />
            </div>


            {/* Background Context Menu */}
            {bgContextMenu && (
                <EntityContextMenu 
                    menuData={bgContextMenu} 
                    onClose={() => setBgContextMenu(null)} 
                />
            )}

            {/* Center Drag Point (机械核心节点) */}
            <div 
                style={{
                    position: 'absolute',
                    left: `calc(${leftPanelWidth}% - 18px)`,
                    top: `calc(${100 - bottomPanelHeight}% - 18px)`,
                    width: '36px',
                    height: '36px',
                    cursor: 'move',
                    zIndex: 1000,
                    pointerEvents: 'auto',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    background: 'linear-gradient(135deg, #2a3a50 0%, #0d1420 100%)',
                    border: '1px solid rgba(0, 255, 255, 0.4)',
                    borderRadius: '6px', // 稍圆角的钻石形
                    transform: 'rotate(45deg)',
                    boxShadow: '0 0 15px rgba(0, 0, 0, 0.9), inset 0 0 8px rgba(0, 255, 255, 0.2)'
                }}
                onPointerDown={(e) => { e.stopPropagation(); setResizing('both'); }}
            >
                {/* 核心发光元件 (反向旋转以保持内部元件水平/垂直) */}
                <div style={{
                    transform: 'rotate(-45deg)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                }}>
                    <div style={{ width: '4px', height: '4px', backgroundColor: '#00ffff', borderRadius: '50%', boxShadow: '0 0 6px #00ffff' }} />
                    <div style={{ width: '16px', height: '2px', backgroundColor: '#00ffff', boxShadow: '0 0 8px #00ffff' }} />
                    <div style={{ width: '4px', height: '4px', backgroundColor: '#00ffff', borderRadius: '50%', boxShadow: '0 0 6px #00ffff' }} />
                </div>
            </div>

            {/* Global Panels */}
            {/* 放最后可以使其 DOM 层级最高 */}
            <div style={{ zIndex: 99999, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                {showStarmap && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'starmap' ? 100 : 10 }} onPointerDown={() => setActivePanel('starmap')}>
                        <StarmapPanel onClose={() => setShowStarmap(false)} />
                    </div>
                )}
                {showJianDui && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'fleet' ? 100 : 10 }} onPointerDown={() => setActivePanel('fleet')}>
                        <JianDui onClose={() => setShowJianDui(false)} />
                    </div>
                )}
                {showZhuangBei && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'equipment' ? 100 : 10 }} onPointerDown={() => setActivePanel('equipment')}>
                        <ZhuangBei onClose={() => setShowZhuangBei(false)} />
                    </div>
                )}
                {showCangKu && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'inventory' ? 100 : 10 }} onPointerDown={() => setActivePanel('inventory')}>
                        <CangKu onClose={() => setShowCangKu(false)} />
                    </div>
                )}
                {showCoreUI && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'coreui' ? 100 : 10 }} onPointerDown={() => setActivePanel('coreui')}>
                        <CoreUI onClose={() => setShowCoreUI(false)} moduleData={coreUIModuleData} />
                    </div>
                )}
                {showBoQuUI && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'boqu' ? 100 : 10 }} onPointerDown={() => setActivePanel('boqu')}>
                        <BoQuUI onClose={() => setShowBoQuUI(false)} moduleData={boQuUIModuleData} />
                    </div>
                )}
                {showChuanWuUI && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'chuanwu' ? 100 : 10 }} onPointerDown={() => setActivePanel('chuanwu')}>
                        <ChuanWuUI onClose={() => setShowChuanWuUI(false)} moduleData={chuanWuUIModuleData} />
                    </div>
                )}
                {showObserveUI && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: activePanel === 'observe' ? 100 : 10 }} onPointerDown={() => setActivePanel('observe')}>
                        <ObserveUI onClose={() => setShowObserveUI(false)} shipData={observeShipData} />
                    </div>
                )}
            </div>

        </div>
    );
};
