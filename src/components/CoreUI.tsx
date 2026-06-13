import React, { useMemo, useState, useEffect } from 'react';
import { WorldbookManager } from '../scenes/WorldbookManager';
import { OrderSystem, Order } from '../scenes/worldbook/Worldbook-Orders';
import { ShipManager } from '../managers/ShipManager';
import { PlayerManager } from '../managers/PlayerManager';
import { BuildingManager } from '../managers/BuildingManager';
import { InternalModuleManager } from '../managers/building/InternalModuleManager';
import ModuleDataConfig from '../../json/ModuleData.json';

interface CoreUIProps {
    onClose: () => void;
    moduleData?: any;
}

// === Mock Data Generator for Stock Chart ===
const generateMockData = () => {
    const data = [];
    let prevClose = 4107.51; // 昨收
    let currentPrice = prevClose;
    let avgSum = 0;
    
    // 240分钟的数据点 (9:30-11:30, 13:00-15:00)
    for (let i = 0; i <= 240; i++) {
        // 随机波动
        const change = (Math.random() - 0.48) * 5; // 稍微偏上的随机游走
        currentPrice += change;
        
        avgSum += currentPrice;
        const avgPrice = avgSum / (i + 1);
        
        // 随机成交量，早盘和尾盘较高
        const isStartOrEnd = i < 30 || i > 210;
        const baseVol = isStartOrEnd ? 500 : 200;
        const volume = baseVol + Math.random() * 800;
        
        data.push({
            index: i,
            price: currentPrice,
            avgPrice: avgPrice,
            volume: volume,
            isUp: change >= 0
        });
    }
    return { data, prevClose };
};

export const CoreUI: React.FC<CoreUIProps> = ({ onClose, moduleData }) => {
    const { data, prevClose } = useMemo(() => generateMockData(), []);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    
    // Order state
    const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
    const [inProgressOrders, setInProgressOrders] = useState<Order[]>([]);

    useEffect(() => {
        const fetchOrders = () => {
            // 获取最新世界状态
            const worldState = WorldbookManager.getWorldState();
            if (!worldState) return;

            // 1. 获取当前空间站所处星区的阵营归属
            const currentSectorName = localStorage.getItem('current_sector');
            if (!currentSectorName) {
                console.error("CoreUI: 无法获取当前星区信息");
                return;
            }
            const factionId = WorldbookManager.getSectorFaction(currentSectorName);
            if (factionId === undefined || factionId === null) {
                console.error(`CoreUI: 无法获取星区 ${currentSectorName} 的阵营归属信息`);
                return;
            }
            
            // 2. 获取所有订单
            const allOrders = OrderSystem.getOrders(worldState);
            
            // 3. 筛选当前阵营的可接取订单
            const pendingOrders = allOrders.filter(o => 
                o.factionId === factionId && 
                o.status === 'PENDING' && 
                (o.type === 'COMBAT' || o.type === 'PATROL' || o.type === 'TRANSPORT')
            );
            
            // 4. 智能更新可接取订单（避免随机频繁闪烁）
            setAvailableOrders(prevAvailable => {
                // 保留当前显示且依然有效的订单，并且获取最新状态
                let nextAvailable = prevAvailable
                    .map(prevOrder => pendingOrders.find(po => po.id === prevOrder.id))
                    .filter(Boolean) as Order[];
                
                // 如果不足 3 个，从剩余列表中随机抽选补齐
                if (nextAvailable.length < 3) {
                    const existingIds = nextAvailable.map(o => o.id);
                    const newCandidates = pendingOrders.filter(po => !existingIds.includes(po.id));
                    const shuffled = [...newCandidates].sort(() => 0.5 - Math.random());
                    nextAvailable = [...nextAvailable, ...shuffled.slice(0, 3 - nextAvailable.length)];
                }
                return nextAvailable;
            });
            
            // 5. 获取进行中的订单
            const inProgress = allOrders.filter(o => 
                o.factionId === factionId && 
                o.status === 'IN_PROGRESS'
            ).slice(0, 3);

            setInProgressOrders(inProgress);
        };

        fetchOrders();
        // 与底层世界模拟 10 秒一个 tick 保持同步，避免刷太快
        const interval = setInterval(fetchOrders, 10000);
        return () => clearInterval(interval);
    }, [moduleData]);

    // Drag state
    const [pos, setPos] = useState({ x: window.innerWidth * 0.1, y: window.innerHeight * 0.1 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Internal Modules State
    const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
    const [installedSlots, setInstalledSlots] = useState<{ [key: number]: any }>({});

    // Initialize installed slots from actual station data
    useEffect(() => {
        const fetchInternalModules = () => {
            const realMod = (moduleData && moduleData.module) ? moduleData.module : moduleData;
            const targetUid = realMod?.stationUid || realMod?.uid;
            
            let sourceOfTruth = realMod;
            
            // 1. 尝试从 BuildingManager 内存中获取最新鲜的对象
            if (targetUid && BuildingManager.stationModules) {
                const memMod = BuildingManager.stationModules.find(m => m.uid === targetUid || (m.stationUid === targetUid && m.moduleId.startsWith('core_')));
                if (memMod) {
                    sourceOfTruth = memMod;
                }
            }

            // 2. 如果内存没找到（OOS状态），直接读 world_state 大地图数据
            if ((!sourceOfTruth || !sourceOfTruth.internalModules) && targetUid) {
                const worldState = WorldbookManager.getWorldState();
                if (worldState && worldState.stations) {
                    for (const station of worldState.stations) {
                        const targetMod = station.modules.find((m: any) => m.uid === targetUid || (m.moduleId.startsWith('core_') && station.uid === targetUid));
                        if (targetMod && targetMod.internalModules) {
                            sourceOfTruth = targetMod;
                            break;
                        }
                    }
                }
            }

            // console.log("[CoreUI Debug] 定时读取目标模块 UID:", targetUid, "-> 源数据对象:", sourceOfTruth);

            if (sourceOfTruth && sourceOfTruth.internalModules) {
                const mappedSlots: { [key: number]: any } = {};
                let installedCount = 0;
                // 找出所有的内部模块并映射为真实数据对象
                Object.entries(sourceOfTruth.internalModules).forEach(([slotIndexStr, internalModData]: [string, any]) => {
                    if (!internalModData) return; // 跳过空槽位 (null 或 undefined)
                    installedCount++;
                    
                    // 解析槽位序号，兼容 "slot_0" 和 "0" 两种格式，统一转换为 + 1 (UI按1、2、3、4展示)
                    let parsedIndex = NaN;
                    if (slotIndexStr.startsWith('slot_')) {
                        parsedIndex = parseInt(slotIndexStr.replace('slot_', ''), 10) + 1; // "slot_0" -> 1
                    } else {
                        parsedIndex = parseInt(slotIndexStr, 10);
                    }
                    
                    if (isNaN(parsedIndex)) return; // 忽略无效槽位

                    // 兼容数据格式：我们的新生成逻辑写入的是 { moduleId: 'xxx', isWorking: true }
                    const modId = internalModData.moduleId || internalModData.id || internalModData; 
                    
                    // @ts-ignore
                    if (ModuleDataConfig.INTERNAL_MODULES && ModuleDataConfig.INTERNAL_MODULES[modId]) {
                        // @ts-ignore
                        mappedSlots[parsedIndex] = {
                            ...ModuleDataConfig.INTERNAL_MODULES[modId],
                            isWorking: internalModData.isWorking || false // 继承运行状态
                        };
                    }
                });
                
                // 为了避免 React 的无限渲染，只有当数据确实不同时才更新
                setInstalledSlots(prev => JSON.stringify(prev) !== JSON.stringify(mappedSlots) ? mappedSlots : prev);
            }
        };

        // 组件挂载时立即获取一次
        fetchInternalModules();
        
        // 开启轮询，每隔 1 秒获取一次，确保状态（如 isWorking 动画）和新加装的设备能及时反映在 UI 上
        const interval = setInterval(fetchInternalModules, 1000);
        return () => clearInterval(interval);
    }, [moduleData]);

    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - pos.x,
            y: e.clientY - pos.y
        });
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (isDragging) {
            setPos({
                x: e.clientX - dragOffset.x,
                y: e.clientY - dragOffset.y
            });
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    // Chart properties
    const chartWidth = 800;
    const chartHeight = 280;
    const priceHeight = 160;
    const volumeHeight = 40;
    const padding = { top: 20, right: 60, bottom: 20, left: 60 };
    
    const innerWidth = chartWidth - padding.left - padding.right;
    
    // Calculate Y axis limits
    const maxPrice = Math.max(...data.map(d => d.price), prevClose * 1.01);
    const minPrice = Math.min(...data.map(d => d.price), prevClose * 0.99);
    
    // Symmetric limits to keep prevClose perfectly centered
    const maxDiff = Math.max(maxPrice - prevClose, prevClose - minPrice);
    const chartMax = prevClose + maxDiff * 1.05; 
    const chartMin = prevClose - maxDiff * 1.05;
    
    const maxVolume = Math.max(...data.map(d => d.volume));

    // Coordinate mappers
    const getX = (index: number) => padding.left + (index / 240) * innerWidth;
    const getY = (price: number) => padding.top + priceHeight - ((price - chartMin) / (chartMax - chartMin)) * priceHeight;
    const getVolY = (volume: number) => padding.top + priceHeight + 30 + volumeHeight - (volume / maxVolume) * volumeHeight;

    const pricePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(d.index)} ${getY(d.price)}`).join(' ');
    const avgPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(d.index)} ${getY(d.avgPrice)}`).join(' ');

    const yTicks = [
        { price: chartMax, percent: (chartMax - prevClose) / prevClose * 100 },
        { price: prevClose + maxDiff / 2, percent: (maxDiff / 2) / prevClose * 100 },
        { price: prevClose, percent: 0 },
        { price: prevClose - maxDiff / 2, percent: -(maxDiff / 2) / prevClose * 100 },
        { price: chartMin, percent: -(chartMax - prevClose) / prevClose * 100 }
    ];

    const xTicks = [
        { label: '9:30', index: 0 },
        { label: '10:30', index: 60 },
        { label: '11:30/13:00', index: 120 },
        { label: '14:00', index: 180 },
        { label: '15:00', index: 240 }
    ];

    const latestData = data[data.length - 1];
    const hoverData = hoverIndex !== null ? data[hoverIndex] : latestData;

    return (
        <div style={{
            position: 'absolute',
            top: pos.y,
            left: pos.x,
            width: '80vw',
            height: '80vh',
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
            {/* Top Cyan Bar */}
            <div 
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
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
            }}>
                <h2 style={{ margin: 0, color: '#00ffff', textShadow: '0 0 5px #00ffff', letterSpacing: '2px', fontSize: '20px' }}>
                    核心控制台 {moduleData?.name ? `- ${moduleData.name.toUpperCase()}` : ''}
                </h2>
                <button 
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onClose}
                    style={{
                        background: 'none', border: '1px solid #ff3333', color: '#ff3333', 
                        padding: '5px 15px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold',
                        pointerEvents: 'auto'
                    }}
                >
                    关闭
                </button>
            </div>

            {/* Main Body */}
            <div style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'row',
                overflow: 'hidden'
            }}>
                {/* Left Dark Sidebar - Mission Board */}
                <div style={{
                    width: '30%',
                    borderRight: '1px solid rgba(0, 255, 255, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '15px',
                    boxSizing: 'border-box',
                    overflowY: 'auto'
                }}>
                    <h2 style={{ margin: '0 0 15px 0', color: '#00ffff', borderBottom: '1px solid rgba(0,255,255,0.2)', paddingBottom: '10px' }}>任务终端 / 订单系统</h2>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {/* 待接取任务区 */}
                        <div>
                            <h3 style={{ margin: '0 0 10px 0', color: '#fff', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#00ffff' }}>▶</span> 可接取任务
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {availableOrders.length === 0 ? (
                                    <div style={{ color: '#aaa', fontSize: '12px', padding: '10px', textAlign: 'center' }}>暂无可用任务</div>
                                ) : (
                                    availableOrders.map((order, idx) => (
                                        <div key={order.id} style={{ backgroundColor: 'rgba(0, 255, 255, 0.05)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(0, 255, 255, 0.2)' }}>
                                            <div style={{ fontWeight: 'bold', color: '#00ffff', marginBottom: '5px' }}>
                                                {order.type === 'COMBAT' ? '紧急防卫' : order.type === 'PATROL' ? '星区巡逻' : '物资运输'}
                                            </div>
                                            <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '8px' }}>
                                                {order.type === 'COMBAT' && `前往 ${order.payload?.targetSector} 清理敌对入侵目标。`}
                                                {order.type === 'PATROL' && `在 ${order.payload?.targetSector} 巡逻驻防 ${(order.payload?.duration || 0)/60} 分钟。`}
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: '#ffcc00', fontWeight: 'bold', fontSize: '14px' }}>
                                                    赏金: {order.type === 'COMBAT' ? '120,000' : '50,000'} CR
                                                </span>
                                                <button style={{ backgroundColor: 'rgba(0, 255, 255, 0.2)', color: '#00ffff', border: '1px solid #00ffff', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer' }}>接取</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* 进行中的订单/任务 */}
                        <div>
                            <h3 style={{ margin: '0 0 10px 0', color: '#fff', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#ffcc00' }}>▶</span> 进行中的订单
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {inProgressOrders.length === 0 ? (
                                    <div style={{ color: '#aaa', fontSize: '12px', padding: '10px', textAlign: 'center' }}>暂无进行中的订单</div>
                                ) : (
                                    inProgressOrders.map((order, idx) => (
                                        <div key={order.id} style={{ backgroundColor: 'rgba(255, 204, 0, 0.05)', padding: '12px', borderRadius: '6px', border: '1px dashed rgba(255, 204, 0, 0.3)' }}>
                                            <div style={{ fontWeight: 'bold', color: '#ffcc00', marginBottom: '5px' }}>
                                                {order.type === 'COMBAT' ? '紧急防卫执行中' : order.type === 'PATROL' ? '星区巡逻执行中' : '任务执行中'}
                                            </div>
                                            <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '8px' }}>
                                                {order.type === 'COMBAT' && `正在 ${order.payload?.targetSector} 清理目标。`}
                                                {order.type === 'PATROL' && `正在 ${order.payload?.targetSector} 巡逻驻防。`}
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: '#fff', fontSize: '12px' }}>状态: 进行中</span>
                                                <button style={{ backgroundColor: 'rgba(255, 204, 0, 0.2)', color: '#ffcc00', border: '1px solid #ffcc00', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer' }}>查看</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Content Area */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    {/* Top Detailed Stock Chart (Dark Mode) */}
                    <div style={{
                        height: '50%',
                        minHeight: '250px',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)', 
                        borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}>
                        {/* Chart Header */}
                        <div style={{ padding: '5px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'baseline', gap: '15px', flexShrink: 0 }}>
                            <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#00ffff' }}>自由联邦交易指数</span>
                            <span style={{ fontSize: '12px', color: '#888' }}>2026-04-30 15:00</span>
                            <span style={{ fontSize: '12px', color: '#ccc' }}>价格: <span style={{ color: latestData.price >= prevClose ? '#ff3333' : '#00ffaa', fontWeight: 'bold' }}>{latestData.price.toFixed(2)}</span></span>
                            <span style={{ fontSize: '12px', color: '#ccc' }}>涨幅: <span style={{ color: latestData.price >= prevClose ? '#ff3333' : '#00ffaa', fontWeight: 'bold' }}>{((latestData.price - prevClose) / prevClose * 100).toFixed(2)}%</span></span>
                            <span style={{ fontSize: '12px', color: '#ccc' }}>成交量: 438.37万</span>
                        </div>

                        {/* Chart SVG */}
                        <div style={{ flex: 1, position: 'relative' }} 
                            onMouseLeave={() => setHoverIndex(null)}
                            onMouseMove={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const scaleX = chartWidth / rect.width;
                                const x = (e.clientX - rect.left) * scaleX - padding.left;
                                if (x >= 0 && x <= innerWidth) {
                                    const index = Math.round((x / innerWidth) * 240);
                                    setHoverIndex(Math.max(0, Math.min(240, index)));
                                } else {
                                    setHoverIndex(null);
                                }
                            }}
                        >
                            <svg width="100%" height="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                                {/* Base grids */}
                                <rect x={padding.left} y={padding.top} width={innerWidth} height={priceHeight} fill="none" stroke="rgba(255,255,255,0.1)" />
                                <rect x={padding.left} y={padding.top + priceHeight + 30} width={innerWidth} height={volumeHeight} fill="none" stroke="rgba(255,255,255,0.1)" />

                                {/* Y Ticks */}
                                {yTicks.map((tick, i) => {
                                    const y = padding.top + (i / 4) * priceHeight;
                                    const isCenter = i === 2;
                                    const color = isCenter ? '#888' : (tick.price > prevClose ? '#ff3333' : '#00ffaa');
                                    return (
                                        <g key={`y-${i}`}>
                                            <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="rgba(255,255,255,0.1)" strokeDasharray={isCenter ? "none" : "4 4"} />
                                            <text x={padding.left - 5} y={y + 4} textAnchor="end" fontSize="12" fill={color}>{tick.price.toFixed(2)}</text>
                                            <text x={chartWidth - padding.right + 5} y={y + 4} textAnchor="start" fontSize="12" fill={color}>{tick.percent > 0 ? '+' : ''}{tick.percent.toFixed(2)}%</text>
                                        </g>
                                    );
                                })}

                                {/* X Ticks */}
                                {xTicks.map((tick, i) => {
                                    const x = getX(tick.index);
                                    return (
                                        <g key={`x-${i}`}>
                                            {i > 0 && i < 4 && (
                                                <>
                                                    <line x1={x} y1={padding.top} x2={x} y2={padding.top + priceHeight} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                                                    <line x1={x} y1={padding.top + priceHeight + 30} x2={x} y2={padding.top + priceHeight + 30 + volumeHeight} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                                                </>
                                            )}
                                            <text x={x} y={padding.top + priceHeight + 15} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize="12" fill="#888">{tick.label}</text>
                                        </g>
                                    );
                                })}

                                {/* Lines */}
                                <path d={avgPath} fill="none" stroke="#ffcc00" strokeWidth="1.5" />
                                <path d={pricePath} fill="none" stroke="#00ffff" strokeWidth="1.5" />

                                {/* Volume Bars */}
                                {data.map((d, i) => {
                                    const x = getX(d.index);
                                    const y = getVolY(d.volume);
                                    const h = padding.top + priceHeight + 30 + volumeHeight - y;
                                    const color = d.isUp ? '#ff3333' : '#00ffaa';
                                    return (
                                        <rect key={`v-${i}`} x={x - 1} y={y} width="2" height={h} fill={color} />
                                    );
                                })}

                                {/* Crosshair */}
                                {hoverIndex !== null && hoverData && (
                                    <g>
                                        <line x1={getX(hoverIndex)} y1={padding.top} x2={getX(hoverIndex)} y2={padding.top + priceHeight + 30 + volumeHeight} stroke="#ccc" strokeDasharray="4 4" />
                                        <line x1={padding.left} y1={getY(hoverData.price)} x2={chartWidth - padding.right} y2={getY(hoverData.price)} stroke="#ccc" strokeDasharray="4 4" />
                                        
                                        <rect x={padding.left - 55} y={getY(hoverData.price) - 10} width="50" height="20" fill="#222" stroke="#444" strokeWidth="1" rx="2" />
                                        <text x={padding.left - 30} y={getY(hoverData.price) + 4} fill="#fff" fontSize="12" textAnchor="middle">{hoverData.price.toFixed(2)}</text>
                                        
                                        <rect x={chartWidth - padding.right + 5} y={getY(hoverData.price) - 10} width="50" height="20" fill="#222" rx="2" />
                                        <text x={chartWidth - padding.right + 30} y={getY(hoverData.price) + 4} fill="#fff" fontSize="12" textAnchor="middle">{((hoverData.price - prevClose)/prevClose*100).toFixed(2)}%</text>

                                        <rect x={getX(hoverIndex) - 20} y={padding.top + priceHeight} width="40" height="20" fill="#222" rx="2" />
                                        <text x={getX(hoverIndex)} y={padding.top + priceHeight + 14} fill="#fff" fontSize="12" textAnchor="middle">
                                            {(() => {
                                                let h = 9; let m = 30 + hoverIndex;
                                                if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
                                                if (h >= 11 && m > 30) { h += 1; if (h === 12) { h = 13; m -= 30; } }
                                                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                                            })()}
                                        </text>
                                        
                                        <rect x={getX(hoverIndex) + 5} y={getVolY(hoverData.volume) - 20} width="60" height="20" fill="#222" rx="2" />
                                        <text x={getX(hoverIndex) + 35} y={getVolY(hoverData.volume) - 6} fill="#fff" fontSize="12" textAnchor="middle">{hoverData.volume.toFixed(1)}万</text>
                                    </g>
                                )}
                            </svg>
                        </div>
                        
                        {/* Bottom Toolbar */}
                        <div style={{ padding: '5px 20px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '5px', backgroundColor: 'rgba(0,0,0,0.3)', flexShrink: 0 }}>
                            {['分时', '日K', '周K', '月K', '5分钟', '15分钟', '30分钟', '60分钟'].map((lbl, i) => (
                                <button key={i} style={{ 
                                    padding: '4px 10px', 
                                    backgroundColor: i === 0 ? 'rgba(0, 255, 255, 0.2)' : 'transparent', 
                                    color: i === 0 ? '#00ffff' : '#aaa', 
                                    border: i === 0 ? '1px solid #00ffff' : '1px solid #444', 
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    borderRadius: '3px'
                                }}>
                                    {lbl}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Bottom Dark Area (Internal Modules UI) */}
                    <div style={{
                        flex: 1,
                        position: 'relative',
                        padding: '20px',
                        overflowY: 'auto',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'flex-start'
                    }}>
                        {(() => {
                            const realMod = moduleData?.module || moduleData;
                            const modId = realMod?.moduleId;
                            // @ts-ignore
                            const totalSlots = (modId && ModuleDataConfig.MODULES[modId]?.internalSlots) ? ModuleDataConfig.MODULES[modId].internalSlots : 4;
                            
                            // 动态列数：少于等于4个则2列，大于4个则3列
                            const columns = totalSlots <= 4 ? 2 : 3;
                            
                            return (
                                <div style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '15px',
                                    justifyContent: 'center',
                                    maxWidth: `${columns * 120 + (columns - 1) * 15}px`,
                                    margin: '0 auto'
                                }}>
                                    {Array.from({ length: totalSlots }, (_, i) => i + 1).map((slotIndex) => {
                                        const isWorking = installedSlots[slotIndex]?.isWorking;
                                        
                                        // 核心工作时的重工业动画样式（类似熔炉/呼吸灯）
                                        const workingStyle = isWorking ? {
                                            backgroundColor: 'rgba(255, 102, 0, 0.2)', // 橙色半透明底色
                                            border: '1px solid #ff6600',              // 橙色边框
                                            color: '#ffaa00',                         // 亮橙色文字
                                            boxShadow: '0 0 15px rgba(255, 102, 0, 0.6), inset 0 0 10px rgba(255, 102, 0, 0.2)',
                                            animation: 'pulse-orange 1.5s infinite alternate' // 假定一个呼吸动画，可以在 global.css 里定义，或者直接靠这个高亮颜色
                                        } : {};

                                        return (
                                            <div key={slotIndex} style={{
                                                width: '120px',
                                                height: '120px',
                                                flexShrink: 0,
                                                backgroundColor: installedSlots[slotIndex] ? 'rgba(0, 255, 255, 0.15)' : 'rgba(0, 255, 255, 0.05)',
                                                border: installedSlots[slotIndex] ? '1px solid #00ffff' : '1px dashed rgba(0, 255, 255, 0.3)',
                                                borderRadius: '8px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                                color: installedSlots[slotIndex] ? '#00ffff' : 'rgba(0, 255, 255, 0.5)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                boxShadow: installedSlots[slotIndex] ? '0 0 10px rgba(0,255,255,0.2)' : 'inset 0 0 10px rgba(0,0,0,0.5)',
                                                padding: '10px',
                                                textAlign: 'center',
                                                ...workingStyle
                                            }}
                                            onClick={() => setSelectedSlotIndex(slotIndex)}
                                            onMouseOver={(e) => {
                                                if (isWorking) {
                                                    e.currentTarget.style.backgroundColor = 'rgba(255, 102, 0, 0.3)';
                                                    e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 102, 0, 0.8), inset 0 0 10px rgba(255, 102, 0, 0.4)';
                                                } else {
                                                    e.currentTarget.style.backgroundColor = installedSlots[slotIndex] ? 'rgba(0, 255, 255, 0.25)' : 'rgba(0, 255, 255, 0.1)';
                                                    e.currentTarget.style.border = '1px solid #00ffff';
                                                    e.currentTarget.style.color = '#00ffff';
                                                    e.currentTarget.style.boxShadow = '0 0 15px rgba(0,255,255,0.4), inset 0 0 10px rgba(0,0,0,0.5)';
                                                }
                                            }}
                                            onMouseOut={(e) => {
                                                if (isWorking) {
                                                    e.currentTarget.style.backgroundColor = 'rgba(255, 102, 0, 0.2)';
                                                    e.currentTarget.style.boxShadow = '0 0 15px rgba(255, 102, 0, 0.6), inset 0 0 10px rgba(255, 102, 0, 0.2)';
                                                } else {
                                                    e.currentTarget.style.backgroundColor = installedSlots[slotIndex] ? 'rgba(0, 255, 255, 0.15)' : 'rgba(0, 255, 255, 0.05)';
                                                    e.currentTarget.style.border = installedSlots[slotIndex] ? '1px solid #00ffff' : '1px dashed rgba(0, 255, 255, 0.3)';
                                                    e.currentTarget.style.color = installedSlots[slotIndex] ? '#00ffff' : 'rgba(0, 255, 255, 0.5)';
                                                    e.currentTarget.style.boxShadow = installedSlots[slotIndex] ? '0 0 10px rgba(0,255,255,0.2)' : 'inset 0 0 10px rgba(0,0,0,0.5)';
                                                }
                                            }}
                                            >
                                                {installedSlots[slotIndex] ? (
                                                    <>
                                                        <span style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>{installedSlots[slotIndex].name}</span>
                                                        <span style={{ fontSize: '10px', color: isWorking ? '#ffaa00' : '#ccc' }}>
                                                            {installedSlots[slotIndex].type === 'factory' ? (isWorking ? '🔥运行中' : '💤待机中') : '模块'}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span style={{ fontSize: '32px' }}>+</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            </div>

            {/* Internal Module Selection Modal */}
            {selectedSlotIndex !== null && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 100001,
                    borderRadius: '8px'
                }} onClick={() => setSelectedSlotIndex(null)}>
                    <div style={{
                        width: '500px',
                        backgroundColor: '#112233',
                        border: '2px solid #00ffff',
                        borderRadius: '8px',
                        padding: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '15px'
                    }} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ margin: 0, color: '#00ffff', borderBottom: '1px solid rgba(0,255,255,0.3)', paddingBottom: '10px' }}>
                            为槽位 {selectedSlotIndex} 选择内置模块
                        </h3>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '400px', overflowY: 'auto' }}>
                            {Object.entries(ModuleDataConfig.INTERNAL_MODULES || {}).map(([key, module]: [string, any]) => (
                                <div key={key} style={{
                                    border: '1px solid rgba(0, 255, 255, 0.2)',
                                    backgroundColor: 'rgba(0, 255, 255, 0.05)',
                                    padding: '12px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.15)'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 255, 255, 0.05)'}
                                onClick={() => {
                                    const realMod = moduleData.module || moduleData;
                                    const targetUid = realMod.stationUid || realMod.uid;
                                    // console.log("[CoreUI] 加装模块:", { targetUid, selectedSlotIndex, key, realMod });
                                    if (targetUid) {
                                        InternalModuleManager.installInternalModule(targetUid, selectedSlotIndex, key);
                                    }
                                    setInstalledSlots(prev => ({ ...prev, [selectedSlotIndex]: module }));
                                    setSelectedSlotIndex(null);
                                }}
                                >
                                    <div>
                                        <div style={{ color: '#00ffff', fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>{module.name}</div>
                                        <div style={{ color: '#aaa', fontSize: '12px' }}>{module.desc}</div>
                                    </div>
                                    <button style={{
                                        backgroundColor: 'rgba(0, 255, 255, 0.2)',
                                        border: '1px solid #00ffff',
                                        color: '#00ffff',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}>加装</button>
                                </div>
                            ))}
                            
                            {installedSlots[selectedSlotIndex] && (
                                <div style={{
                                    border: '1px solid rgba(255, 51, 51, 0.3)',
                                    backgroundColor: 'rgba(255, 51, 51, 0.05)',
                                    padding: '12px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    marginTop: '10px'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 51, 51, 0.15)'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 51, 51, 0.05)'}
                                onClick={() => {
                                    const realMod = moduleData.module || moduleData;
                                    const targetUid = realMod.stationUid || realMod.uid;
                                    // console.log("[CoreUI] 卸载模块:", { targetUid, selectedSlotIndex, realMod });
                                    if (targetUid) {
                                        InternalModuleManager.uninstallInternalModule(targetUid, selectedSlotIndex);
                                    }
                                    setInstalledSlots(prev => {
                                        const next = { ...prev };
                                        delete next[selectedSlotIndex];
                                        return next;
                                    });
                                    setSelectedSlotIndex(null);
                                }}
                                >
                                    <span style={{ color: '#ff3333', fontWeight: 'bold' }}>卸载当前模块</span>
                                </div>
                            )}
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                            <button style={{
                                backgroundColor: 'transparent',
                                border: '1px solid #ccc',
                                color: '#ccc',
                                padding: '6px 16px',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }} onClick={() => setSelectedSlotIndex(null)}>取消</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
