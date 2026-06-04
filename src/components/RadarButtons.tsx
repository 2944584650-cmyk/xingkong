import React, { useState } from 'react';
import { emitUIEvent, GameEvents } from '../utils/EventBus';

interface RadarButtonGroupProps {
    side: 'left' | 'right';
    startIndex: number;
}

const BUTTON_CONFIGS = [
    { label: '星图', event: GameEvents.OPEN_STARMAP },
    { label: '舰队', event: GameEvents.OPEN_FLEET },
    { label: '设备', event: GameEvents.OPEN_EQUIPMENT },
    { label: '港务', event: GameEvents.OPEN_PORT },
    { label: '经济', event: GameEvents.OPEN_ECONOMY },
    { label: '仓库', event: GameEvents.OPEN_INVENTORY },
    { label: '功能 7', event: null },
    { label: '功能 8', event: null },
];

export const RadarButtonsList: React.FC<RadarButtonGroupProps> = ({ side, startIndex }) => {
    // ==== 核心数学布局参数 ====
    // youxiajiao.tsx 中的雷达是一个宽度/高度为 300 的 canvas，并且具有 50% 的 borderRadius 和 border。
    // 即雷达的真实外圈半径 (包含边框和 margin) 是 R = 150。
    const W = 100;        // 整个按钮包围盒的宽度
    const H = 48;         // 单个按钮的高度
    const gap = 20;       // 按钮之间的间隙 (加大到 20px)
    const total = 4;      // 单侧按钮数量
    const R = 150;        // 贴合雷达的虚拟大圆半径 (与真实雷达仅差 1px)
    const minWidth = 100;  // 按钮宽度

    // 总体高度和中心计算
    const totalH = total * H + (total - 1) * gap;
    const y_center = totalH / 2;
    
    // 计算虚拟大圆的圆心 X 坐标
    // 如果在左侧，圆心在图形右边；如果右侧，圆心在图形左边
    const cx = side === 'left' ? (minWidth + R) : (W - minWidth - R);

    const [activeIndex, setActiveIndex] = useState(0);

    return (
        <svg 
            width={W} 
            height={totalH} 
            viewBox={`0 0 ${W} ${totalH}`}
            style={{ 
                // SVG 容器本身绝对不拦截鼠标事件！
                // 这样即使它是方形的，也不会像普通的 div 一样阻挡下面雷达和空白区域的点击。
                pointerEvents: 'none', 
                overflow: 'visible' 
            }}
        >
            {Array.from({ length: total }).map((_, i) => {
                const y1 = i * (H + gap); // 按钮顶边 Y
                const y2 = y1 + H;        // 按钮底边 Y
                
                // 利用圆的方程 (x-cx)^2 + (y-cy)^2 = R^2 计算当前高度下，圆弧切入的 X 偏移量
                const dx1 = Math.sqrt(Math.max(0, R * R - Math.pow(y1 - y_center, 2)));
                const dx2 = Math.sqrt(Math.max(0, R * R - Math.pow(y2 - y_center, 2)));

                let x1, x2, pathD;
                if (side === 'left') {
                    // 左侧按钮：左平右凹
                    x1 = cx - dx1;
                    x2 = cx - dx2;
                    // SVG A 命令画圆弧: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                    pathD = `M 0 ${y1} L ${x1} ${y1} A ${R} ${R} 0 0 0 ${x2} ${y2} L 0 ${y2} Z`;
                } else {
                    // 右侧按钮：左凹右平
                    x1 = cx + dx1;
                    x2 = cx + dx2;
                    // 右侧大圆心在左边，顺着圆弧从上往下走是顺时针，所以 sweep-flag = 1
                    pathD = `M ${W} ${y1} L ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2} L ${W} ${y2} Z`;
                }

                const globalIndex = startIndex + i;
                const isActive = activeIndex === globalIndex;
                const btnConfig = BUTTON_CONFIGS[globalIndex] || { label: `功能 ${globalIndex + 1}`, event: null };
                
                return (
                    <RadarButtonPath 
                        key={globalIndex}
                        pathD={pathD}
                        label={btnConfig.label}
                        isActive={isActive}
                        onClick={() => {
                            setActiveIndex(globalIndex);
                            if (btnConfig.event) {
                                emitUIEvent(btnConfig.event);
                            }
                        }}
                        side={side}
                        yCenter={y1 + H / 2}
                        W={W}
                    />
                );
            })}
        </svg>
    );
};

const RadarButtonPath: React.FC<{
    pathD: string, 
    label: string, 
    isActive: boolean, 
    onClick: () => void,
    side: 'left' | 'right',
    yCenter: number,
    W: number
}> = ({ pathD, label, isActive, onClick, side, yCenter, W }) => {
    const [isHovered, setIsHovered] = useState(false);

    // 重新调配色彩，使得默认状态下深邃，悬浮和激活时有强烈霓虹感
    const defaultColor = 'rgba(0, 80, 20, 0.6)';
    const hoverColor = 'rgba(0, 220, 0, 0.85)';
    const activeColor = 'rgba(150, 255, 150, 1)'; 

    const currentColor = isActive ? activeColor : (isHovered ? hoverColor : defaultColor);

    return (
        <g 
            style={{ 
                // 真正的黑科技在这里：只有精确的 SVG Path (甚至不包含切掉的凹陷) 才会拦截鼠标！
                // 完美实现了“不规则按钮区”的点触交互，无视外围边框
                pointerEvents: 'auto', 
                cursor: 'pointer'
            }}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <path 
                d={pathD} 
                fill={currentColor} 
                stroke="rgba(0, 255, 0, 0.8)"
                strokeWidth={isHovered ? "3" : "1"}
                style={{ 
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', 
                    filter: isHovered ? 'drop-shadow(0 0 10px rgba(0,255,0,0.8))' : 'drop-shadow(0 0 2px rgba(0,255,0,0.3))',
                    transformOrigin: side === 'left' ? 'right center' : 'left center',
                    transform: isActive ? (side === 'left' ? 'translateX(-4px)' : 'translateX(4px)') : 'translateX(0)'
                }}
            />
            {/* 按钮内部的发光装饰线 (增加科技感层次) */}
            <path 
                d={pathD} 
                fill="transparent" 
                stroke="rgba(255, 255, 255, 0.4)"
                strokeWidth="1"
                style={{ 
                    pointerEvents: 'none', 
                    transform: 'scale(0.95)', 
                    transformOrigin: 'center' 
                }}
            />
            {/* 文字标签居中处理 */}
            <text 
                x={side === 'left' ? 25 : W - 65} 
                y={yCenter + 6} 
                fill={isActive ? "black" : "#00ff00"} 
                fontSize="16" 
                fontWeight="bold"
                style={{ pointerEvents: 'none' }} // 文字不阻挡鼠标悬浮判定
            >
                {label}
            </text>
        </g>
    );
}
