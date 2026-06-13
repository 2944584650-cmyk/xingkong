import React, { useEffect, useState } from 'react';
import { PlayerManager } from '../managers/PlayerManager';
import { ShipManager } from '../managers/ShipManager';

const ZheZhao: React.FC = () => {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [isWarping, setIsWarping] = useState(false);

    useEffect(() => {
        // 监听玩家状态的定时器
        const warpCheckInterval = setInterval(() => {
            const pd = PlayerManager.getStats();
            if (pd && pd.playerShipId) {
                const macroShip = ShipManager.getShipById(pd.playerShipId);
                if (macroShip && macroShip.state === 'WARP') {
                    if (!isWarping) {
                        setIsWarping(true);
                        // console.log(`%c[ZheZhao Debug] 玩家进入 WARP 状态！当前进度: ${(macroShip.travelProgress * 100).toFixed(2)}%`, 'color: #00ffff; font-weight: bold;');
                    }
                } else {
                    if (isWarping) {
                        setIsWarping(false);
                        // console.log(`%c[ZheZhao Debug] 玩家脱离 WARP 状态！当前状态: ${macroShip ? macroShip.state : '未知'}`, 'color: #ffaa00; font-weight: bold;');
                    }
                }
            }
        }, 100);

        return () => clearInterval(warpCheckInterval);
    }, [isWarping]);

    useEffect(() => {
        let observer: MutationObserver | null = null;

        const updateSize = (canvas: Element) => {
            const w = parseInt(canvas.getAttribute('width') || '0', 10);
            const h = parseInt(canvas.getAttribute('height') || '0', 10);
            setSize({ width: w, height: h });
        };

        const setupObserver = (canvas: Element) => {
            // 监听 attributes 的变化
            observer = new MutationObserver((mutations) => {
                let changed = false;
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && (mutation.attributeName === 'width' || mutation.attributeName === 'height')) {
                        changed = true;
                    }
                });

                if (changed) {
                    updateSize(canvas);
                }
            });

            observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });

            // 初始挂载时先获取一次
            updateSize(canvas);
        };

        // 轮询等待 canvas 渲染
        const findCanvasInterval = setInterval(() => {
            const canvas = document.querySelector('#game-container canvas');
            if (canvas) {
                clearInterval(findCanvasInterval);
                setupObserver(canvas);
            }
        }, 500);

        return () => {
            clearInterval(findCanvasInterval);
            if (observer) {
                observer.disconnect();
            }
        };
    }, []);

    if (size.width === 0 || size.height === 0) return null;

    // 渲染底层静态/闪烁星空背景
    const renderBackgroundStars = () => {
        if (!isWarping) return null;
        
        const stars = [];
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const size = Math.random() * 2 + 1;
            const opacity = Math.random() * 0.5 + 0.1;
            
            stars.push(
                <div
                    key={`bg-${i}`}
                    style={{
                        position: 'absolute',
                        top: `${y}%`,
                        left: `${x}%`,
                        width: `${size}px`,
                        height: `${size}px`,
                        backgroundColor: '#ffffff',
                        opacity: opacity,
                        borderRadius: '50%',
                        animation: `twinkle ${Math.random() * 3 + 2}s infinite alternate`
                    }}
                />
            );
        }
        return stars;
    };

    // 生成一些向外扩散的星星线条来模拟跃迁效果
    const renderWarpStars = () => {
        if (!isWarping) return null;
        
        const stars = [];

        // 增加到 400 条让其更密集
        for (let i = 0; i < 400; i++) {
            // 随机角度和初始距离
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 80 + 5; // 从中心附近开始
            const length = Math.random() * 200 + 50; // 线条长度
            const duration = Math.random() * 0.6 + 0.2; // 动画时长
            const delay = Math.random() * 1.0; // 延迟
            
            // 使用 HSL 随机生成所有光谱颜色 (从红到紫: H 取值 0 - 360)
            // S (饱和度) 80-100%, L (亮度) 60-80% 保证颜色鲜艳明亮
            const hue = Math.floor(Math.random() * 360);
            const sat = Math.floor(Math.random() * 20 + 80);
            const light = Math.floor(Math.random() * 20 + 60);
            const colorHSLaEnd = `hsla(${hue}, ${sat}%, ${light}%, 0.9)`;
            const colorHSLaStart = `hsla(${hue}, ${sat}%, ${light}%, 0)`;
            const colorHSLShadow = `hsla(${hue}, ${sat}%, ${light}%, 0.6)`;

            stars.push(
                <div
                    key={i}
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        width: `${length}px`,
                        height: `${Math.random() * 2 + 1}px`, // 随机粗细 1px-3px
                        background: `linear-gradient(90deg, ${colorHSLaStart} 0%, ${colorHSLaEnd} 100%)`,
                        transformOrigin: '0 50%',
                        transform: `rotate(${angle}rad)`,
                        opacity: 0,
                        boxShadow: `0 0 ${Math.random() * 6 + 2}px ${colorHSLShadow}`, // 随机发光大小
                        animation: `warpStar ${duration}s ease-in ${delay}s infinite`,
                        '--angle': `${angle}rad`,
                        '--dist': `${distance}px`
                    } as React.CSSProperties}
                />
            );
        }
        return stars;
    };

    return (
        <>
            <style>
                {`
                    @keyframes warpStar {
                        0% {
                            opacity: 0;
                            transform: rotate(var(--angle)) translateX(var(--dist)) scaleX(0.1);
                        }
                        20% {
                            opacity: 1;
                        }
                        100% {
                            opacity: 0;
                            transform: rotate(var(--angle)) translateX(1000px) scaleX(1);
                        }
                    }
                    @keyframes twinkle {
                        0% { opacity: 0.1; transform: scale(0.8); }
                        100% { opacity: 0.8; transform: scale(1.2); }
                    }
                    @keyframes scanner {
                        0% { left: -50%; width: 50%; }
                        100% { left: 100%; width: 50%; }
                    }
                    @keyframes pulseBorder {
                        0% { border-color: rgba(0, 255, 255, 0.2); box-shadow: 0 0 20px rgba(0, 255, 255, 0.1), inset 0 0 10px rgba(0, 255, 255, 0.05); }
                        100% { border-color: rgba(0, 255, 255, 0.6); box-shadow: 0 0 40px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.15); }
                    }
                `}
            </style>
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    width: `${size.width}px`,
                    height: `${size.height}px`,
                    pointerEvents: 'none',
                    background: isWarping ? 'radial-gradient(circle at center, #0a0a2a 0%, #000000 100%)' : 'transparent',
                    zIndex: -1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    overflow: 'hidden'
                }}
            >
                {/* 静态星空背景层 */}
                {renderBackgroundStars()}

                {/* 跃迁星空线条特效 */}
                {renderWarpStars()}

                {isWarping && (
                    <div style={{
                        zIndex: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '30px 60px',
                        background: 'linear-gradient(135deg, rgba(12, 34, 63, 0.85) 0%, rgba(4, 14, 28, 0.95) 100%)',
                        border: '1px solid rgba(0, 255, 255, 0.4)',
                        borderRadius: '4px',
                        animation: 'pulseBorder 2s ease-in-out infinite alternate',
                        backdropFilter: 'blur(8px)',
                        position: 'relative'
                    }}>
                        {/* 科幻感边角装饰 */}
                        <div style={{ position: 'absolute', top: '-1px', left: '-1px', width: '15px', height: '15px', borderTop: '3px solid #00ffff', borderLeft: '3px solid #00ffff' }} />
                        <div style={{ position: 'absolute', top: '-1px', right: '-1px', width: '15px', height: '15px', borderTop: '3px solid #00ffff', borderRight: '3px solid #00ffff' }} />
                        <div style={{ position: 'absolute', bottom: '-1px', left: '-1px', width: '15px', height: '15px', borderBottom: '3px solid #00ffff', borderLeft: '3px solid #00ffff' }} />
                        <div style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '15px', height: '15px', borderBottom: '3px solid #00ffff', borderRight: '3px solid #00ffff' }} />

                        <div style={{ 
                            color: '#00ffff', 
                            fontSize: '32px', 
                            fontWeight: '900', 
                            letterSpacing: '4px',
                            textShadow: '0 0 15px #00ffff',
                            marginBottom: '15px',
                            fontFamily: 'monospace'
                        }}>
                            WARP DRIVE ACTIVE
                        </div>
                        <div style={{ 
                            color: '#ffffff', 
                            fontSize: '18px', 
                            letterSpacing: '2px',
                            opacity: 0.9
                        }}>
                            跃迁序列执行中，请坐稳扶好...
                        </div>
                        
                        {/* 模拟进度条/扫描线 */}
                        <div style={{
                            width: '100%',
                            height: '4px',
                            background: 'rgba(0, 255, 255, 0.1)',
                            marginTop: '20px',
                            borderRadius: '2px',
                            overflow: 'hidden',
                            position: 'relative'
                        }}>
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                height: '100%',
                                width: '50%',
                                background: 'linear-gradient(90deg, transparent 0%, #00ffff 50%, transparent 100%)',
                                boxShadow: '0 0 10px #00ffff',
                                animation: 'scanner 1.5s ease-in-out infinite'
                            }} />
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default ZheZhao;
