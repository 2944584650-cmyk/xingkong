import React, { useEffect, useRef } from 'react';
import { RadarButtonsList } from './RadarButtons';

interface Entity {
    id: string;
    x: number;
    y: number;
    type: string;
    faction: number | string | null;
}

interface PlayerData {
    x: number;
    y: number;
    rotation: number;
}

export const YouXiaJiao: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // 雷达半径（代表游戏世界里的最大探测距离）
    const RADAR_WORLD_RADIUS = 40000;

    useEffect(() => {
        const handleRadarUpdate = (e: Event) => {
            const customEvent = e as CustomEvent;
            const data = customEvent.detail;
            if (!data || !data.player || !data.entities) return;

            const player: PlayerData = data.player;
            const entities: Entity[] = data.entities;

            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // 保持画布内部像素大小一致，为了清晰度，可以固定分辨率或动态调整
            const width = canvas.width;
            const height = canvas.height;
            const cx = width / 2;
            const cy = height / 2;
            const radarScreenRadius = Math.min(cx, cy) - 10;

            // 清空画布
            ctx.clearRect(0, 0, width, height);

            // 画雷达背景
            ctx.beginPath();
            ctx.arc(cx, cy, radarScreenRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 20, 0, 0.4)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 画同心圆和十字线
            ctx.beginPath();
            ctx.arc(cx, cy, radarScreenRadius * 0.33, 0, Math.PI * 2);
            ctx.arc(cx, cy, radarScreenRadius * 0.66, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(cx, cy - radarScreenRadius);
            ctx.lineTo(cx, cy + radarScreenRadius);
            ctx.moveTo(cx - radarScreenRadius, cy);
            ctx.lineTo(cx + radarScreenRadius, cy);
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
            ctx.stroke();

            // Base.ts 中的 rotation 是角度
            const pRotDeg = player.rotation || 0;
            const pRotRad = (pRotDeg * Math.PI) / 180;
            
            // 将所有物体的相对位置反向旋转，使玩家箭头始终指向上方（-90度 / -PI/2）
            const offsetRad = -pRotRad - Math.PI / 2;

            // 绘制其他实体
            const pdForRadar = (window as any).PlayerManager?.getStats();
            const playerShipIdForRadar = pdForRadar ? pdForRadar.playerShipId : null;
            
            // 找到真正的玩家实体坐标，如果没传，使用 data.player(因为此时可能已经没有特权的玩家了)
            let realPlayerX = player.x;
            let realPlayerY = player.y;
            const realPlayerEnt = entities.find(e => String(e.id) === String(playerShipIdForRadar));
            if (realPlayerEnt) {
                realPlayerX = realPlayerEnt.x;
                realPlayerY = realPlayerEnt.y;
            }

            entities.forEach(ent => {
                if (String(ent.id) === String(playerShipIdForRadar)) return;

                const dx = ent.x - realPlayerX;
                const dy = ent.y - realPlayerY;
                const dist = Math.hypot(dx, dy);

                // 如果超出雷达范围，不画或画在边缘
                if (dist > RADAR_WORLD_RADIUS) return;

                // 原始角度
                const angle = Math.atan2(dy, dx);
                // 相对于玩家朝上的角度
                const relativeAngle = angle + offsetRad;

                // 映射到屏幕上的距离
                const drawDist = (dist / RADAR_WORLD_RADIUS) * radarScreenRadius;

                const drawX = cx + Math.cos(relativeAngle) * drawDist;
                const drawY = cy + Math.sin(relativeAngle) * drawDist;

                // 简单颜色区分：由于传过来没有直接带红蓝颜色，我们可以尝试依赖派系判定或者类型
                // 如果对方是海盗(faction 3)或者被玩家认为是敌人，画成红色；否则蓝色/绿色
                let color = '#33ccff'; 
                if (ent.faction === 3 || ent.type === 'fighter') color = '#ff3333'; 
                if (ent.type === 'freighter') color = '#00ff00';

                ctx.fillStyle = color;
                ctx.fillRect(drawX - 2.5, drawY - 2.5, 5, 5);
            });

            // 最后在正中心绘制玩家箭头 (永远朝上)
            ctx.translate(cx, cy);
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(6, 6);
            ctx.lineTo(0, 3);
            ctx.lineTo(-6, 6);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.translate(-cx, -cy);

        };

        document.addEventListener('ui_mini_radar_update', handleRadarUpdate);
        return () => document.removeEventListener('ui_mini_radar_update', handleRadarUpdate);
    }, []);

    return (
        <div style={{ 
            width: '100%', 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            position: 'relative'
        }}>
            {/* 雷达外圈科技感装饰 */}
            {/* 最底下的最外层高亮装饰线，在黑底之上，但在雷达边框之下 */}
            <div style={{
                position: 'absolute',
                width: '340px',
                height: '340px',
                borderRadius: '50%',
                border: '2px solid rgba(0, 255, 0, 0.1)',
                borderLeft: '4px solid rgba(0, 255, 0, 0.8)',
                borderRight: '4px solid rgba(0, 255, 0, 0.8)',
                animation: 'youxiajiao_spin 12s linear infinite',
                pointerEvents: 'none',
                zIndex: 1
            }} />
            
            <div style={{
                position: 'absolute',
                width: '360px',
                height: '360px',
                borderRadius: '50%',
                border: '1px dashed rgba(0, 255, 0, 0.4)',
                animation: 'youxiajiao_spin_reverse 25s linear infinite',
                pointerEvents: 'none',
                zIndex: 1
            }} />

            {/* 雷达外层金属边框 - 修改层级以配合外围的虚线框 */}
            <div style={{
                position: 'absolute',
                width: '316px',
                height: '316px',
                borderRadius: '50%',
                boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.9), 0 0 10px rgba(0,0,0,0.5)',
                border: '6px solid rgba(20, 30, 20, 1)',
                borderTopColor: 'rgba(50, 60, 50, 1)',
                borderBottomColor: 'rgba(5, 10, 5, 1)',
                pointerEvents: 'none',
                zIndex: 10 // 将这里的 zIndex 改为 10（位于按钮和虚线框之后，位于 canvas 和内圈之上）
            }} />

            {/* 内部扫描波圈 (修正错位，覆盖整个圆形雷达，使用伪元素或嵌套结构控制原点) */}
            <div style={{
                position: 'absolute',
                width: '300px',
                height: '300px',
                borderRadius: '50%',
                pointerEvents: 'none',
                zIndex: 2,
                overflow: 'hidden', // 遮罩多余部分
            }}>
                {/* 真正的旋转光锥 */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    left: '-50%',
                    width: '200%',
                    height: '200%',
                    background: 'conic-gradient(from 0deg, transparent 70%, rgba(0, 255, 0, 0.3) 98%, rgba(200, 255, 200, 0.8) 100%)',
                    animation: 'youxiajiao_spin 3s linear infinite',
                    transformOrigin: 'center center',
                }} />
            </div>

            <style>
                {`
                @keyframes youxiajiao_spin {
                    100% { transform: rotate(360deg); }
                }
                @keyframes youxiajiao_spin_reverse {
                    100% { transform: rotate(-360deg); }
                }
                `}
            </style>

            <canvas 
                ref={canvasRef}
                width={300}
                height={300}
                style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    borderRadius: '50%',
                    zIndex: 3,
                    backgroundColor: 'rgba(0, 15, 0, 0.8)' // 更加不透明，防止下方黑色底板影响雷达内绿色元素的清晰度，同时稍微透出扫描波圈
                }}
            />

            {/* 实体小圆点扫描特效 (覆盖在 canvas 之上) */}
            <div style={{
                position: 'absolute',
                width: '300px',
                height: '300px',
                borderRadius: '50%',
                pointerEvents: 'none',
                zIndex: 4,
            }}>
                <div style={{
                    position: 'absolute',
                    top: '0',
                    left: '49%',
                    width: '2%',
                    height: '50%',
                    transformOrigin: 'bottom center',
                    animation: 'youxiajiao_spin 3s linear infinite',
                }}>
                    <div style={{
                        position: 'absolute',
                        top: '10%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '6px',
                        height: '6px',
                        backgroundColor: '#00ff00',
                        borderRadius: '50%',
                        boxShadow: '0 0 10px #00ff00'
                    }} />
                </div>
            </div>
            
            {/* 雷达左侧按钮组，恢复原来的层级和位置 */}
            <div style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-251px, -50%)', // 半径150 + 按钮总宽度100 + 间隙1
                pointerEvents: 'auto',
                zIndex: 100 // 恢复 zIndex 为 100
            }}>
                <RadarButtonsList side="left" startIndex={0} />
            </div>

            {/* 雷达右侧按钮组，恢复原来的层级和位置 */}
            <div style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(151px, -50%)', // 半径150 + 间隙1
                pointerEvents: 'auto',
                zIndex: 100 // 恢复 zIndex 为 100
            }}>
                <RadarButtonsList side="right" startIndex={4} />
            </div>
        </div>
    );
};
