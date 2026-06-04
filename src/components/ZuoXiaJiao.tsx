import React, { useState, useEffect } from 'react';
import { PlayerManager } from '../managers/PlayerManager';
import EquipmentData from '../../json/EquipmentData.json';

interface ShipArea {
    id: string;
    name: string;
    x: string;
    y: string;
    context: string;
}

interface Particle {
    id: number;
    left: number;
    size: number;
    duration: number;
    delay: number;
}

export const ZuoXiaJiao: React.FC<{ width?: string | number }> = ({ width = '38%' }) => {
    const [hullId, setHullId] = useState<string>('');
    const [shipUrl, setShipUrl] = useState<string>('');
    const [shipSize, setShipSize] = useState<{width: number, height: number} | null>(null);
    const [areas, setAreas] = useState<ShipArea[]>([]);
    const [particles, setParticles] = useState<Particle[]>([]);

    useEffect(() => {
        // Generate particles for background effect
        const pts = Array.from({ length: 40 }).map((_, i) => ({
            id: i,
            left: Math.random() * 100, // 0-100%
            size: Math.random() * 4 + 8, // 8px - 12px
            duration: Math.random() * 4 + 2, // 2s - 6s
            delay: Math.random() * 5 // 0s - 5s
        }));
        setParticles(pts);

        // Load ship data
        const loadShipData = () => {
            const stats: any = PlayerManager.getStats();
            if (stats && stats.hullId) {
                setHullId(stats.hullId);
                const hulls = EquipmentData.HULLS as Record<string, any>;
                const hullDef = hulls[stats.hullId];
                if (hullDef && hullDef.sprite) {
                    setShipUrl(`assets/${hullDef.sprite}`);
                    if (hullDef.spriteSize) {
                        setShipSize(hullDef.spriteSize);
                    } else {
                        setShipSize(null);
                    }
                }
            }
        };

        loadShipData();
        
        // 监听玩家座驾更换事件
        const handleShipChange = () => {
            loadShipData();
        };
        document.addEventListener('PLAYER_SHIP_CHANGED', handleShipChange);
        
        return () => {
            document.removeEventListener('PLAYER_SHIP_CHANGED', handleShipChange);
        };
    }, []);

    useEffect(() => {
        if (hullId) {
            // 从 EquipmentData 中直接读取内构区域配置
            const hulls = EquipmentData.HULLS as Record<string, any>;
            const hullDef = hulls[hullId];
            if (hullDef && hullDef.areas) {
                setAreas(hullDef.areas);
            } else {
                setAreas([]);
            }
        }
    }, [hullId]);

    const handleAreaClick = (area: ShipArea) => {
        console.log(`Clicked area: ${area.name}`);
        // Here you can implement the logic to pass the context to the LLM
        // For example, calling an LLMService method or dispatching an event
        document.dispatchEvent(new CustomEvent('ship_area_clicked', {
            detail: area
        }));
    };

    return (
        <div style={{
            width: typeof width === 'number' ? `${width}%` : width,
            height: '100%',
            backgroundColor: 'black',
            pointerEvents: 'auto', // Needs to be auto to receive clicks
            boxSizing: 'border-box',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden', // Ensure content doesn't spill out
            zIndex: 1
        }}>
            <style>
                {`
                @keyframes zuoxiajiao_scanline {
                    0% { top: -10%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 110%; opacity: 0; }
                }
                @keyframes zuoxiajiao_particleMove {
                    0% { bottom: -5%; opacity: 0; }
                    10% { opacity: 1; }
                    80% { opacity: 1; }
                    100% { bottom: 105%; opacity: 0; }
                }
                `}
            </style>

            {/* 绿色网格线背景，最底层 */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage: 'linear-gradient(rgba(0, 255, 0, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 0, 0.15) 1px, transparent 1px)',
                backgroundSize: '30px 30px',
                zIndex: -2,
                pointerEvents: 'none'
            }} />

            {/* 扫描的动态效果 */}
            <div style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: '4px',
                background: 'linear-gradient(to bottom, transparent, rgba(0, 255, 0, 0.8), transparent)',
                boxShadow: '0 0 10px rgba(0, 255, 0, 0.5)',
                animation: 'zuoxiajiao_scanline 3s linear infinite',
                zIndex: -1,
                pointerEvents: 'none'
            }} />

            {/* 底部20%绿色渐变 */}
            <div style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: '20%',
                background: 'linear-gradient(to top, rgba(0, 255, 0, 0.4), transparent)',
                zIndex: -1,
                pointerEvents: 'none'
            }} />

            {/* 绿色小方块 */}
            {particles.map(p => (
                <div
                    key={p.id}
                    style={{
                        position: 'absolute',
                        left: `${p.left}%`,
                        width: `${p.size}px`,
                        height: `${p.size}px`,
                        backgroundColor: 'rgba(0, 255, 0, 0.8)',
                        boxShadow: '0 0 3px rgba(0, 255, 0, 0.8)',
                        animation: `zuoxiajiao_particleMove ${p.duration}s linear ${p.delay}s infinite`,
                        zIndex: -1,
                        pointerEvents: 'none',
                        opacity: 0
                    }}
                />
            ))}

            {shipUrl ? (
                <div style={{
                    width: '90%',
                    height: '90%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <div style={{
                        width: shipSize ? (shipSize.width >= shipSize.height ? '100%' : 'auto') : '90%',
                        height: shipSize ? (shipSize.width >= shipSize.height ? 'auto' : '100%') : 'auto',
                        aspectRatio: shipSize ? `${shipSize.width} / ${shipSize.height}` : 'auto',
                        position: 'relative'
                    }}>
                        <img 
                            src={shipUrl} 
                            alt="Player Ship" 
                            style={{
                                width: '100%',
                                height: '100%',
                                display: 'block',
                                imageRendering: 'pixelated' // 禁止模糊抗锯齿
                            }} 
                        />
                        
                        {/* Render Buttons based on json configuration */}
                        {areas.map(area => (
                        <button
                            key={area.id}
                            onClick={() => handleAreaClick(area)}
                            style={{
                                position: 'absolute',
                                left: area.x,
                                top: area.y,
                                transform: 'translate(-50%, -50%)',
                                padding: '4px 8px',
                                backgroundColor: 'transparent',
                                color: 'rgba(0, 255, 0, 0.9)',
                                border: '1px solid rgba(0, 255, 0, 0.8)',
                                boxShadow: '0 0 4px rgba(0, 255, 0, 0.5) inset, 0 0 4px rgba(0, 255, 0, 0.5)',
                                borderRadius: '2px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '0.9rem',
                                whiteSpace: 'nowrap',
                                textShadow: '0 0 3px rgba(0, 255, 0, 0.8)',
                                zIndex: 10
                            }}
                            title={area.name}
                        >
                            {area.name}
                        </button>
                    ))}
                    </div>
                </div>
            ) : (
                <div style={{ color: 'white' }}>加载飞船数据中...</div>
            )}

            {/* 科幻感内边框与角标装饰 */}
            <div style={{
                position: 'absolute',
                top: '15px',
                left: '15px',
                right: '15px',
                bottom: '15px',
                border: '1px solid rgba(0, 255, 0, 0.2)',
                pointerEvents: 'none',
                zIndex: 5
            }}>
                {/* 左上角 */}
                <div style={{ position: 'absolute', top: '-2px', left: '-2px', width: '25px', height: '25px', borderTop: '3px solid rgba(0, 255, 0, 0.9)', borderLeft: '3px solid rgba(0, 255, 0, 0.9)' }} />
                {/* 右上角 */}
                <div style={{ position: 'absolute', top: '-2px', right: '-2px', width: '25px', height: '25px', borderTop: '3px solid rgba(0, 255, 0, 0.9)', borderRight: '3px solid rgba(0, 255, 0, 0.9)' }} />
                {/* 左下角 */}
                <div style={{ position: 'absolute', bottom: '-2px', left: '-2px', width: '25px', height: '25px', borderBottom: '3px solid rgba(0, 255, 0, 0.9)', borderLeft: '3px solid rgba(0, 255, 0, 0.9)' }} />
                {/* 右下角 */}
                <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '25px', height: '25px', borderBottom: '3px solid rgba(0, 255, 0, 0.9)', borderRight: '3px solid rgba(0, 255, 0, 0.9)' }} />
                
                {/* 增加一些额外的科技感线条和标尺 */}
                <div style={{ position: 'absolute', top: '50%', left: '-3px', width: '5px', height: '40px', backgroundColor: 'rgba(0, 255, 0, 0.8)', transform: 'translateY(-50%)' }} />
                <div style={{ position: 'absolute', top: '50%', right: '-3px', width: '5px', height: '40px', backgroundColor: 'rgba(0, 255, 0, 0.8)', transform: 'translateY(-50%)' }} />
                <div style={{ position: 'absolute', top: '-3px', left: '50%', width: '60px', height: '5px', backgroundColor: 'rgba(0, 255, 0, 0.8)', transform: 'translateX(-50%)' }} />
                <div style={{ position: 'absolute', bottom: '-3px', left: '50%', width: '60px', height: '5px', backgroundColor: 'rgba(0, 255, 0, 0.8)', transform: 'translateX(-50%)' }} />
                
                {/* 内部小十字准星装饰 */}
                <div style={{ position: 'absolute', top: '10px', left: '10px', width: '5px', height: '1px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
                <div style={{ position: 'absolute', top: '10px', left: '10px', width: '1px', height: '5px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
                <div style={{ position: 'absolute', top: '10px', right: '10px', width: '5px', height: '1px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
                <div style={{ position: 'absolute', top: '10px', right: '14px', width: '1px', height: '5px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
                <div style={{ position: 'absolute', bottom: '10px', left: '10px', width: '5px', height: '1px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
                <div style={{ position: 'absolute', bottom: '14px', left: '10px', width: '1px', height: '5px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
                <div style={{ position: 'absolute', bottom: '10px', right: '10px', width: '5px', height: '1px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
                <div style={{ position: 'absolute', bottom: '14px', right: '14px', width: '1px', height: '5px', backgroundColor: 'rgba(0, 255, 0, 0.5)' }} />
            </div>
        </div>
    );
};
