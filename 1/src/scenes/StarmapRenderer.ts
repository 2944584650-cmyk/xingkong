import { WorldbookManager } from './WorldbookManager.js';

export class StarmapRenderer {
    static _mouseMoveHandler = null;
    static _mouseUpHandler = null;
    static _sectorPositions = new Map();

    static init(container, worldState, currentSectorName, viewingSectorName, onSelectSector) {
        console.log("=== StarmapRenderer.init CALLED ===");
        console.log("Container:", container);
        console.log("WorldState:", worldState);
        console.log("CurrentSectorName:", currentSectorName);
        console.log("ViewingSectorName:", viewingSectorName);

        if (!container) {
            console.error("StarmapRenderer: Container is NULL!");
            return;
        }
        
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        container.style.cursor = 'grab';
        container.style.userSelect = 'none';
        
        // DOM-based Starmap
        container.innerHTML = `
            <style>
                .sci-panel {
                    background: rgba(0, 0, 0, 0.95);
                    border: 1px solid #fff;
                    color: #fff;
                    font-family: 'Courier New', Courier, monospace;
                    letter-spacing: 1px;
                }
                .sci-title {
                    color: #fff;
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    font-weight: bold;
                    border-bottom: 1px solid #fff;
                    padding-bottom: 5px;
                    text-transform: uppercase;
                }
                .starmap-viewport {
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background: #000;
                }
                .starmap-content {
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    transform-origin: 0 0;
                }
                .starmap-node {
                    position: absolute;
                    width: 40px;
                    height: 40px;
                    transform: translate(-50%, -50%);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                /* 外侧旋转的科技感虚线圆环 */
                .starmap-node::before {
                    content: '';
                    position: absolute;
                    width: 24px;
                    height: 24px;
                    border: 1px dashed rgba(255, 255, 255, 0.4);
                    border-radius: 50%;
                    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    animation: sm-spin 15s linear infinite;
                }
                @keyframes sm-spin {
                    100% { transform: rotate(360deg); }
                }
                /* 中心的菱形能量核 */
                .starmap-node::after {
                    content: '';
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    background: #fff;
                    box-shadow: 0 0 8px #fff;
                    transform: rotate(45deg);
                    transition: all 0.2s;
                }
                /* 悬停时的全息锁定效果 */
                .starmap-node:hover::before {
                    width: 34px;
                    height: 34px;
                    border: 1px solid rgba(0, 255, 255, 0.9);
                    box-shadow: 0 0 10px rgba(0, 255, 255, 0.5) inset, 0 0 10px rgba(0, 255, 255, 0.5);
                    animation: sm-spin 3s linear infinite;
                }
                .starmap-node:hover::after {
                    transform: rotate(135deg) scale(1.3);
                    background: #0ff;
                    box-shadow: 0 0 15px #0ff;
                }
                /* 当前所在舰队位置的激活态 */
                .starmap-node.current::before {
                    width: 42px;
                    height: 42px;
                    border: 2px dashed #0f0;
                    box-shadow: 0 0 10px rgba(0, 255, 0, 0.2) inset;
                    animation: sm-spin 8s linear infinite reverse;
                }
                .starmap-node.current::after {
                    background: #0f0;
                    box-shadow: 0 0 20px #0f0;
                    transform: rotate(45deg) scale(1.2);
                }
                /* 当前面板选中的观察态 */
                .starmap-node.viewing::before {
                    border-color: #ff0;
                    border-style: solid;
                    box-shadow: 0 0 10px rgba(255, 255, 0, 0.3) inset, 0 0 10px rgba(255, 255, 0, 0.3);
                }
                .starmap-node.viewing::after {
                    background: transparent;
                    border: 2px solid #ff0;
                    box-shadow: 0 0 15px #ff0 inset, 0 0 15px #ff0;
                }
                .starmap-label {
                    position: absolute;
                    color: #fff;
                    font-size: 10px;
                    transform: translate(-50%, 15px);
                    pointer-events: none;
                    white-space: nowrap;
                    text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000;
                }
                .starmap-convoy {
                    position: absolute;
                    width: 0;
                    height: 0;
                    border-left: 5px solid transparent;
                    border-right: 5px solid transparent;
                    border-bottom: 12px solid #fff;
                    cursor: pointer;
                    transform-origin: 50% 50%;
                }
                .starmap-convoy:hover {
                    filter: drop-shadow(0 0 5px #fff);
                }
            </style>
            
            <div class="starmap-viewport" id="sm-viewport">
                <div class="starmap-content" id="sm-content">
                    <!-- 深空背景图层：移入 starmap-content 中，使其能够跟随地图拖动和缩放 -->
                    <div id="sm-space-bg" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; opacity: 1;"></div>
                    <svg id="sm-bg-blobs" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; opacity: 1;">
                        <g id="faction-blobs"></g>
                    </svg>
                    <svg id="sm-lanes" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;"></svg>
                    <div id="sm-nodes" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none;"></div>
                    <div id="sm-convoys" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none;"></div>
                </div>
            </div>

            <!-- 图例 -->
            <div id="sm-legend" class="sci-panel" style="position:absolute; right:20px; top:20px; padding:15px; font-size:12px; z-index:20; pointer-events:none; width: 200px;"></div>
            
            <!-- Tooltip -->
            <div id="sm-tooltip" class="sci-panel" style="position:absolute; bottom:20px; left:20px; width:280px; padding:15px; font-size:12px; pointer-events:none; display:none; z-index:30; transition: opacity 0.2s;">
                <h3 id="sm-tooltip-title" class="sci-title"></h3>
                <div id="sm-tooltip-desc" style="line-height:1.6; color: rgba(255,255,255,0.8);"></div>
            </div>
            
            <!-- 战情通报 -->
            <div id="sm-war-board" class="sci-panel" style="position:absolute; bottom:20px; right:20px; width:320px; padding:15px; z-index:20; pointer-events:none; font-size:12px;">
                <h4 class="sci-title">>> TACTICAL SITUATION REPORT</h4>
                <div id="sm-war-list" style="color:rgba(255,255,255,0.7); max-height:180px; overflow-y:auto; line-height:1.6; padding-right: 5px;">
                    Awaiting data...
                </div>
            </div>
        `;
        
        const legendDiv = container.querySelector('#sm-legend');
        
        const allSectors = worldState.sectors || [];
        const factions = worldState.factions || [];
        
        let currentObj = allSectors.find(s => s.name === currentSectorName) || allSectors[0];
        let viewingObj = allSectors.find(s => s.name === viewingSectorName) || currentObj;

        if (!currentObj) {
            console.error("StarmapRenderer: 无法找到当前星区且星区列表为空！");
            return;
        }

        // Store callback for redraws
        (container as any)._onSelectSector = onSelectSector;

        // 获取地图边界供互动限制使用
        const bounds = StarmapRenderer.drawMap(container, allSectors, currentSectorName, viewingSectorName, onSelectSector);
        StarmapRenderer.setupInteraction(container, currentObj, bounds);
        
        // Render Legend
        try {
            let legHtml = `<div style="color:#fff; font-size:14px; margin-bottom:5px; font-weight:bold;">势力分布</div>`;
            factions.forEach(f => {
                const count = allSectors.filter(s => s.factionId === f.id).length;
                const nodeColor = '#fff';
                const factionName = f.name || '未知势力';
                legHtml += `<div style="color:#aaa; margin-bottom:3px;"><span style="display:inline-block; width:10px; height:10px; background:${nodeColor}; border-radius:50%; margin-right:5px;"></span>${factionName} (${count}星系)</div>`;
            });
            
            const neutralCount = allSectors.filter(s => s.factionId === 0).length;
            if (neutralCount > 0) {
                legHtml += `<div style="color:#aaa; margin-bottom:3px;"><span style="display:inline-block; width:10px; height:10px; background:#fff; border-radius:50%; margin-right:5px;"></span>中立战火缓冲区 (${neutralCount}星系)</div>`;
            }

            legHtml += `<div style="margin-top:5px; color:#aaa;"><span style="display:inline-block; width:8px; height:8px; background:#fff; margin-right:5px; border-radius:2px;"></span>商船</div>`;
            legHtml += `<div style="margin-top:3px; color:#aaa;"><span style="display:inline-block; width:8px; height:8px; background:#fff; margin-right:5px; border-radius:50%; box-shadow:0 0 5px #fff;"></span>军事舰队</div>`;
            legendDiv.innerHTML = legHtml;
        } catch (e) {
            console.warn("StarmapRenderer: 渲染图例时出错", e);
        }
        
        // 初始化战报板
        StarmapRenderer._updateWarBoard(container, worldState);

        console.log("=== StarmapRenderer.init COMPLETED ===");
    }

    static drawMap(container, allSectors, currentSectorName, viewingSectorName, onSelectSector) {
        const lanesSvg = container.querySelector('#sm-lanes');
        const nodesDiv = container.querySelector('#sm-nodes');
        
        const blobsG = container.querySelector('#faction-blobs');
        lanesSvg.innerHTML = '';
        nodesDiv.innerHTML = '';
        if (blobsG) blobsG.innerHTML = '';

        const factions = WorldbookManager.getWorldState().factions || [];
        const mapLanes = WorldbookManager.getStarlanes(allSectors);

        const R = 60; // 六边形标准半径
        
        // 核心改造：将所有星区的坐标“吸附”并重排到标准的六边形网格上
        // 保留它们原本松散、随机的分布状态，只做单纯的网格对齐
        const occupied = new Set();
        
        // 进一步放大缩放系数，使得六边形集群更加离散（1~3格成簇）
        const scale = 3.5; 

        allSectors.forEach((s: any) => {
            if (s.x === undefined || s.y === undefined) return;
            
            // 保护原始坐标，避免被重复计算污染导致漂移
            if (s.originalX === undefined) {
                s.originalX = s.x;
                s.originalY = s.y;
            }
            
            // 使用原始坐标进行计算，移除随机抖动
            const sx = s.originalX * scale;
            const sy = s.originalY * scale;

            // 转换到立方体坐标系
            let q = (Math.sqrt(3)/3 * sx - 1/3 * sy) / R;
            let r = (2/3 * sy) / R;
            
            let x = q;
            let z = r;
            let y = -x - z;
            
            let rx = Math.round(x);
            let ry = Math.round(y);
            let rz = Math.round(z);
            
            const xDiff = Math.abs(rx - x);
            const yDiff = Math.abs(ry - y);
            const zDiff = Math.abs(rz - z);
            
            if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
            else if (yDiff > zDiff) ry = -rx - rz;
            else rz = -rx - ry;
            
            // 解决偶尔的完全重合：使用确定性的螺旋状重叠查找
            let currentRx = rx;
            let currentRz = rz;
            let ring = 1;
            let dirIdx = 0;
            let stepInDir = 0;
            const dirs = [ [1,0], [0,1], [-1,1], [-1,0], [0,-1], [1,-1] ];
            let hexX = currentRx;
            let hexZ = currentRz;
            
            while(occupied.has(`${hexX},${hexZ}`)) {
                if (stepInDir === 0 && dirIdx === 0) {
                    hexX = currentRx + ring * dirs[4][0];
                    hexZ = currentRz + ring * dirs[4][1];
                }
                hexX += dirs[dirIdx][0];
                hexZ += dirs[dirIdx][1];
                stepInDir++;
                if (stepInDir >= ring) {
                    stepInDir = 0;
                    dirIdx++;
                    if (dirIdx >= 6) {
                        dirIdx = 0;
                        ring++;
                    }
                }
            }
            currentRx = hexX;
            currentRz = hexZ;
            occupied.add(`${currentRx},${currentRz}`);
            
            // 转回像素坐标
            s.x = Math.sqrt(3) * R * (currentRx + currentRz/2);
            s.y = 1.5 * R * currentRz;
        });

        // 重新居中地图并获取最终边界
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        allSectors.forEach((s: any) => {
            if(s.x < minX) minX = s.x;
            if(s.y < minY) minY = s.y;
        });
        
        StarmapRenderer._sectorPositions.clear();
        allSectors.forEach((s: any) => {
            s.x = s.x - minX + 250;
            s.y = s.y - minY + 250;
            // 获取居中后的最大边界，供画星海背景使用
            if (s.x > maxX) maxX = s.x;
            if (s.y > maxY) maxY = s.y;
            
            StarmapRenderer._sectorPositions.set(s.name, { x: s.x, y: s.y });
        });

        // 绘制深空背景：银心光圈和星星点缀
        const spaceBg = container.querySelector('#sm-space-bg');
        if (spaceBg) {
            let bgHtml = '';
            
            // 计算目前所有星区分布的真正中心（那个空洞区域的中心）
            let trueCenterX = (minX + maxX) / 2;
            let trueCenterY = (minY + maxY) / 2;
            
            // 1. 在那个空洞中心塞一个代表“银心”的巨大高亮光球和星云层
            // 底层巨型蓝色星云
            bgHtml += `<div style="
                position: absolute; 
                left: ${trueCenterX}px; 
                top: ${trueCenterY}px; 
                width: 3000px; 
                height: 1500px; 
                background: radial-gradient(ellipse at center, rgba(100, 150, 255, 0.05) 0%, rgba(50, 100, 200, 0.02) 40%, rgba(0, 0, 0, 0) 70%);
                transform: translate(-50%, -50%) rotate(20deg);
                pointer-events: none;
                filter: blur(50px);
            "></div>`;

            // 核心强光斑（亮白泛蓝）
            bgHtml += `<div style="
                position: absolute; 
                left: ${trueCenterX}px; 
                top: ${trueCenterY}px; 
                width: 800px; 
                height: 400px; 
                background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.3) 0%, rgba(180, 220, 255, 0.1) 50%, rgba(0, 0, 0, 0) 80%);
                transform: translate(-50%, -50%) rotate(15deg);
                pointer-events: none;
                filter: blur(20px);
            "></div>`;
            
            // 超高亮白核心点
            bgHtml += `<div style="
                position: absolute; 
                left: ${trueCenterX}px; 
                top: ${trueCenterY}px; 
                width: 200px; 
                height: 200px; 
                background: radial-gradient(circle at center, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0) 70%);
                transform: translate(-50%, -50%);
                pointer-events: none;
                filter: blur(10px);
            "></div>`;

            // 根据星图真实尺寸，将星星集中在地图区域及稍微外延一点的地方
            const mapWidth = Math.max(maxX - minX, 2000);
            const mapHeight = Math.max(maxY - minY, 2000);
            const spreadWidth = mapWidth * 1.3;  // 只比地图稍微宽一点，避免过分稀释
            const spreadHeight = mapHeight * 1.3;

            // 2. 随机生成各种色彩的局部星云团块，增加宇宙层次感
            for (let i = 0; i < 15; i++) {
                const nx = (Math.random() - 0.5) * spreadWidth + trueCenterX;
                const ny = (Math.random() - 0.5) * spreadHeight + trueCenterY;
                const size = Math.random() * 800 + 400; // 星云稍微小一点，更聚焦
                const colors = [
                    'rgba(120, 50, 200, 0.04)', // 魅影紫
                    'rgba(50, 150, 255, 0.04)', // 深空蓝
                    'rgba(255, 100, 100, 0.03)', // 铁锈红
                    'rgba(50, 255, 150, 0.03)'  // 翡翠绿
                ];
                const c = colors[Math.floor(Math.random() * colors.length)];
                bgHtml += `<div style="
                    position: absolute;
                    left: ${nx}px;
                    top: ${ny}px;
                    width: ${size}px;
                    height: ${size}px;
                    background: radial-gradient(circle, ${c} 0%, rgba(0,0,0,0) 70%);
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                    filter: blur(40px);
                "></div>`;
            }

            // 3. 高性能生成海量的背景微型繁星 (使用多重 box-shadow 单节点生成，性能无敌)
            const generateStars = (count, color, size) => {
                let shadows = [];
                for(let i = 0; i < count; i++) {
                    const x = Math.floor((Math.random() - 0.5) * spreadWidth) + trueCenterX;
                    const y = Math.floor((Math.random() - 0.5) * spreadHeight) + trueCenterY;
                    shadows.push(`${x}px ${y}px ${color}`);
                }
                return `<div style="
                    position: absolute; left: 0; top: 0; 
                    width: ${size}px; height: ${size}px; 
                    background: transparent;
                    box-shadow: ${shadows.join(', ')};
                    pointer-events: none;
                "></div>`;
            };

            // 密集的微小点点白星 (1500颗)
            bgHtml += generateStars(1500, 'rgba(255,255,255,0.6)', 1);
            // 稍大一点的淡蓝星 (600颗)
            bgHtml += generateStars(600, 'rgba(200,220,255,0.8)', 2);
            // 稍大一点的暖橘色星 (300颗)
            bgHtml += generateStars(300, 'rgba(255,220,180,0.8)', 2);

            // 4. 围绕星区散落几十颗特别耀眼的主序恒星（带双层强烈光晕）
            for (let i = 0; i < 80; i++) {
                const sx = (Math.random() - 0.5) * spreadWidth + trueCenterX;
                const sy = (Math.random() - 0.5) * spreadHeight + trueCenterY;
                const sSize = Math.random() * 3 + 2; // 2~5px，视觉上明显更大
                const sOpacity = Math.random() * 0.5 + 0.5;
                
                const colorType = Math.random();
                let color = '255,255,255';
                if (colorType > 0.7) color = '150,200,255'; // 耀眼的蓝白星
                else if (colorType > 0.5) color = '255,180,150'; // 耀眼的红巨星

                bgHtml += `<div style="
                    position: absolute;
                    left: ${sx}px;
                    top: ${sy}px;
                    width: ${sSize}px;
                    height: ${sSize}px;
                    background: rgba(${color}, ${sOpacity});
                    border-radius: 50%;
                    box-shadow: 0 0 ${sSize * 4}px rgba(${color}, 0.8), 0 0 ${sSize * 15}px rgba(${color}, 0.3);
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                "></div>`;
            }
            
            spaceBg.innerHTML = bgHtml;
        }

        // 渲染极具科技感的赛博六边形地砖
        if (blobsG) {
            blobsG.innerHTML = '';
            
            // 注入特效滤镜，给六边形加上内发光和外发光
            blobsG.innerHTML += `
                <defs>
                    <filter id="hex-glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>
            `;
            
            allSectors.forEach((s: any) => {
                if (s.x === undefined || s.y === undefined) return;
                
                const factionId = s.factionId;
                const faction = factions.find((f: any) => f.id === factionId);
                
                const points = [];
                for (let i = 0; i < 6; i++) {
                    const angle_rad = Math.PI / 180 * (60 * i - 30);
                    // 稍微缩小一点内边距，让边框更锐利
                    points.push(`${s.x + (R - 3) * Math.cos(angle_rad)},${s.y + (R - 3) * Math.sin(angle_rad)}`);
                }
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                polygon.setAttribute('points', points.join(' '));
                
                if (factionId !== 0 && faction) {
                    // 阵营星区：深色科技内透填充 + 高亮荧光边框 + 辉光滤镜
                    polygon.setAttribute('fill', faction.nodeColor);
                    polygon.setAttribute('fill-opacity', '0.15'); // 内部透明度调低，更有玻璃质感
                    polygon.setAttribute('stroke', faction.nodeColor);
                    polygon.setAttribute('stroke-width', '2.5'); // 边框加粗
                    polygon.setAttribute('stroke-opacity', '0.9'); // 边框高亮
                    polygon.setAttribute('filter', 'url(#hex-glow)'); // 加上发光滤镜
                } else {
                    // 中立星区：完全透明背景 + 科技感虚线边框
                    polygon.setAttribute('fill', 'rgba(255,255,255,0.02)');
                    polygon.setAttribute('stroke', 'rgba(255,255,255,0.3)');
                    polygon.setAttribute('stroke-width', '1.5');
                    polygon.setAttribute('stroke-dasharray', '5 5');
                    polygon.setAttribute('filter', 'url(#hex-glow)');
                }
                
                blobsG.appendChild(polygon);
            });
        }

        // Draw Lanes
        mapLanes.forEach(lane => {
            if (lane.s1.x !== undefined && lane.s2.x !== undefined) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', lane.s1.x);
                line.setAttribute('y1', lane.s1.y);
                line.setAttribute('x2', lane.s2.x);
                line.setAttribute('y2', lane.s2.y);
                line.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
                line.setAttribute('stroke-width', '1');
                lanesSvg.appendChild(line);
            }
        });

        // Draw Nodes
        allSectors.forEach(dest => {
            if (dest.x === undefined || dest.y === undefined) return;
            
            const isCurrent = dest.name === currentSectorName;
            const isViewing = dest.name === viewingSectorName;
            
            const node = document.createElement('div');
            node.className = `starmap-node ${isCurrent ? 'current' : ''} ${isViewing ? 'viewing' : ''}`;
            node.setAttribute('data-sector-name', dest.name);
            node.style.left = `${dest.x}px`;
            node.style.top = `${dest.y}px`;
            
            // 确保这些节点不仅可以被点击，还要屏蔽其拖拽事件的干扰
            node.style.pointerEvents = 'auto';
            
            node.addEventListener('pointerdown', (e) => {
                // 防止鼠标按下时触发 viewport 的 drag 拖拽
                e.stopPropagation(); 
            });

            node.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止拖拽等事件干扰
                console.log('--- NODE CLICKED ---', dest.name);
                if (onSelectSector) onSelectSector(dest.name);
            });
            
            node.addEventListener('pointerenter', () => {
                console.log('--- NODE HOVER ---', dest.name);
                const sidebarInfo = document.getElementById('react-sm-sidebar-info');
                if (sidebarInfo) {
                    let html = `<h4 style="color: #fff; margin-bottom: 5px; border-bottom: 1px solid #00ff00; padding-bottom: 5px;">${dest.name}</h4>`;
                    html += `<div style="color: rgba(255, 255, 255, 0.8); margin-bottom: 10px; line-height: 1.4;">${dest.description || '无详细资料。'}</div>`;
                    
                    // 以前这里显示的是 dest.inventory (星区仓储)，而不是产出，且用户目前不需要显示任何产出。
                    html += `<div style="color: rgba(255, 0, 0, 0.6); font-size: 11px; margin-top: 10px;">[无产出]</div>`;
                    
                    sidebarInfo.innerHTML = html;
                }
            });
            
            node.addEventListener('pointerleave', () => {
                const sidebarInfo = document.getElementById('react-sm-sidebar-info');
                if (sidebarInfo) {
                    sidebarInfo.innerHTML = `<div style="color: rgba(255, 255, 255, 0.5); font-style: italic;">将鼠标悬停在星区节点上查看详细信息...</div>`;
                }
            });

            const label = document.createElement('div');
            label.className = 'starmap-label';
            label.innerText = dest.name;
            label.style.left = `${dest.x}px`;
            label.style.top = `${dest.y}px`;

            nodesDiv.appendChild(node);
            nodesDiv.appendChild(label);
        });

        // 返回边界给 setupInteraction 进行拖拽限制
        return {
            minX: minX - 300,
            maxX: maxX + 300,
            minY: minY - 300,
            maxY: maxY + 300,
            width: maxX - minX + 600,
            height: maxY - minY + 600
        };
    }

    static setupInteraction(container, centerObj, bounds) {
        const viewport = container.querySelector('#sm-viewport');
        const content = container.querySelector('#sm-content');
        
        let state = {
            scale: 1,
            x: 0,
            y: 0,
            isDragging: false,
            startX: 0,
            startY: 0
        };

        // Initialize center
        if (centerObj && centerObj.x !== undefined) {
            const rect = viewport.getBoundingClientRect();
            state.x = (rect.width / 2) - centerObj.x;
            state.y = (rect.height / 2) - centerObj.y;
            updateTransform();
        }

        // 动态计算基于当前视口大小的限制范围
        function applyBounds() {
            if (!bounds) return;
            const rect = viewport.getBoundingClientRect();
            
            // 计算内容放大后实际占据的宽高
            const contentWidth = bounds.width * state.scale;
            const contentHeight = bounds.height * state.scale;
            
            // 允许拖动的极限：不能把星图整个拖出屏幕
            // 当内容比视口大时，限制在一侧；当内容比视口小时，限制其居中
            let minTranslateX = rect.width - bounds.maxX * state.scale;
            let maxTranslateX = -bounds.minX * state.scale;
            let minTranslateY = rect.height - bounds.maxY * state.scale;
            let maxTranslateY = -bounds.minY * state.scale;

            // 如果缩放太小，导致内容比屏幕还小，那就让它尽量在中间
            if (contentWidth < rect.width) {
                const margin = (rect.width - contentWidth) / 2;
                minTranslateX = margin - bounds.minX * state.scale;
                maxTranslateX = margin - bounds.minX * state.scale;
            }
            if (contentHeight < rect.height) {
                const margin = (rect.height - contentHeight) / 2;
                minTranslateY = margin - bounds.minY * state.scale;
                maxTranslateY = margin - bounds.minY * state.scale;
            }

            state.x = Math.max(minTranslateX, Math.min(state.x, maxTranslateX));
            state.y = Math.max(minTranslateY, Math.min(state.y, maxTranslateY));
        }

        function updateTransform() {
            applyBounds();
            content.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        }

        viewport.addEventListener('pointerdown', (e) => {
            state.isDragging = true;
            state.startX = e.clientX - state.x;
            state.startY = e.clientY - state.y;
            viewport.style.cursor = 'grabbing';
            // 如果需要在 React 弹出层中拖拽时不影响其他，可以加上 setPointerCapture
            try { viewport.setPointerCapture(e.pointerId); } catch(err){}
        });

        viewport.addEventListener('pointermove', (e) => {
            if (!state.isDragging) return;
            state.x = e.clientX - state.startX;
            state.y = e.clientY - state.startY;
            updateTransform();
        });

        viewport.addEventListener('pointerup', (e) => {
            state.isDragging = false;
            viewport.style.cursor = 'grab';
            try { viewport.releasePointerCapture(e.pointerId); } catch(err){}
        });

        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSensitivity = 0.15;
            const delta = e.deltaY > 0 ? -1 : 1;
            const oldScale = state.scale;
            
            state.scale += delta * zoomSensitivity;
            
            // 动态计算最小缩放值：不能让星图缩小到比视口还小很多（最多允许看到整个星空加上一点边界）
            let minScale = 0.2;
            if (bounds) {
                const rect = viewport.getBoundingClientRect();
                const scaleX = rect.width / bounds.width;
                const scaleY = rect.height / bounds.height;
                // 取二者中较大的那个，确保缩到最小时刚好填满或者适应屏幕
                minScale = Math.min(scaleX, scaleY) * 0.8; 
            }
            
            // 限制缩放比例 (最大放大到每个蜂窝非常清晰，最小不能把星空缩成一个点)
            state.scale = Math.max(minScale, Math.min(state.scale, 2.5));
            
            // 只有当缩放比例真正改变时才调整中心点
            if (state.scale !== oldScale) {
                // Zoom towards mouse position
                const rect = viewport.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                state.x = mouseX - (mouseX - state.x) * (state.scale / oldScale);
                state.y = mouseY - (mouseY - state.y) * (state.scale / oldScale);
                
                updateTransform();
            }
        }, { passive: false });
    }

    // --- 无损状态更新 ---
    static updateMacroState(container, worldState, viewingSectorName) {
        if (!container) return;

        let currentSectorName = localStorage.getItem('current_sector');
        if (!currentSectorName) {
            console.error("[StarmapRenderer] 致命错误：未找到 current_sector！使用默认兜底星区。");
            currentSectorName = '创世星柱废墟';
        }
        
        // 只更新现有节点的选中状态，而不是暴力重绘整个 DOM 导致 hover 动画重置和闪烁
        const nodesDiv = container.querySelector('#sm-nodes');
        if (nodesDiv) {
            const nodes = nodesDiv.querySelectorAll('.starmap-node');
            nodes.forEach((node: any) => {
                const sectorName = node.getAttribute('data-sector-name');
                if (!sectorName) return;
                const isCurrent = sectorName === currentSectorName;
                const isViewing = sectorName === viewingSectorName;
                node.className = `starmap-node ${isCurrent ? 'current' : ''} ${isViewing ? 'viewing' : ''}`;
            });
        }

        StarmapRenderer._updateWarBoard(container, worldState);
    }

    static _updateWarBoard(container, state) {
        const listDiv = container.querySelector('#sm-war-list');
        if (!listDiv) return;
        let html = '';
        
        const factions = state.factions || [];
        
        html = '<div style="color:#666;">各星区目前保持着脆弱的和平...</div>';

        // 添加外交好感度显示
        html += `<div style="margin-top:10px; border-top:1px solid #555; padding-top:5px; color:#aaa; font-size:11px;">[各大阵营外交关系]</div>`;
        factions.forEach(f1 => {
            factions.forEach(f2 => {
                if (f1.id < f2.id) {
                    const rel = Number(WorldbookManager.getRelation(state, f1.id, f2.id));
                    const name1 = f1.name.substring(0, 2);
                    const name2 = f2.name.substring(0, 2);
                    if (rel <= -50) {
                        html += `<div style="color:#fff; font-size:10px;">💥 ${name1} vs ${name2} (全面战争)</div>`;
                    } else if (rel < 0) {
                        html += `<div style="color:#fff; font-size:10px;">⚠️ ${name1} vs ${name2} (边境摩擦)</div>`;
                    } else if (rel > 20) {
                        html += `<div style="color:#fff; font-size:10px;">🕊️ ${name1} 与 ${name2} (和平贸易)</div>`;
                    }
                }
            });
        });

        listDiv.innerHTML = html;
    }

    // --- 新增清理方法 ---
    static cleanup() {
        // No longer relying on global events for hover
    }

    static updateConvoys(container, ships, onRobConvoy) {
        if (!container) return;
        
        const convoysDiv = container.querySelector('#sm-convoys');
        if (!convoysDiv) return;

        convoysDiv.innerHTML = '';

        ships.forEach(ship => {
            if (ship.state !== 'WARP' || !ship.currentLane) return;

            const fromPos: any = StarmapRenderer._sectorPositions.get(ship.currentLane.from);
            const toPos: any = StarmapRenderer._sectorPositions.get(ship.currentLane.to);
            if (!fromPos || !toPos) return;

            const cx = fromPos.x + (toPos.x - fromPos.x) * ship.travelProgress;
            const cy = fromPos.y + (toPos.y - fromPos.y) * ship.travelProgress;
            
            // Calculate angle in degrees
            const dx = toPos.x - fromPos.x;
            const dy = toPos.y - fromPos.y;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90; // +90 because our triangle points up

            const convoy = document.createElement('div');
            convoy.className = 'starmap-convoy';
            // Adjust position so center of triangle is at cx, cy
            convoy.style.left = `${cx}px`;
            convoy.style.top = `${cy}px`;
            // Note: Transform origin is 50% 50% in CSS
            convoy.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

            convoy.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent map drag/click
                if(onRobConvoy) onRobConvoy(ship);
            });

            convoysDiv.appendChild(convoy);
        });
    }
}
