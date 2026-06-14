import { GameConfig } from '../config.js';
import { ShipSprite } from '../entities/ShipSprite.js';
import { BuildingManager, GRID_PIXEL_SIZE } from '../managers/BuildingManager.js';
import { UniverseEngine } from '../managers/engine/UniverseEngine.js';

export class RadarScene extends (window as any).Phaser.Scene {
    shipSprites: Map<string, ShipSprite>;
    tacticalIcons: Map<string, HTMLElement>;
    tacticalLayer: HTMLElement | null;
    effects: any[];
    projectiles: any[];
    missiles: any[];
    asteroids: any[];
    drops: any[];
    currentNodes: any[];
    currentGates: any[];
    nodeZones: any[];
    gateZones: any[];
    commandLines: any[];
    
    // 渲染层 graphics
    bgGraphics!: any;
    stationGraphics!: any; // 新增：用于绘制建筑模块与网格
    nodeGraphics!: any;
    projectileGraphics!: any;
    effectGraphics!: any;
    targetPointGraphics!: any; // 新增：用于绘制目标点
    selectionBoxGraphics!: any; // 新增：用于绘制多选框
    nodeTexts: any[];
    
    // 小行星贴图缓存
    asteroidSprites: Map<string, any>;

    // 建筑贴图与交互区
    moduleSprites: Map<string, { sprite?: any, zone?: any }>;

    // 框选状态
    isBoxSelecting: boolean;
    boxStartPointer: any;

    // 停泊引导状态
    dockingGuidances: Map<string, {
        worldX: number;
        worldY: number;
        entryAngle: number;
        hullId: string;
        berthId: string;
        sector?: string;
        timestamp?: number;
        sprite?: any;
        textObj?: any; // 新增：悬浮文字对象
    }>;

    constructor() {
        super('RadarScene' as any);
        
        this.asteroidSprites = new Map();
        this.moduleSprites = new Map();
        
        // --- [核心防御] ---
        // 在构造函数（类的实例化时刻）立即分配内存
        // 无论 Phaser 生命周期走到哪一步（哪怕还没 init 和 create），这些基础数组都绝不可能是 undefined
        this.shipSprites = new Map();
        this.tacticalIcons = new Map();
        this.effects = [];
        this.projectiles = [];
        this.missiles = [];
        this.asteroids = [];
        this.drops = [];
        this.currentNodes = [];
        this.currentGates = [];
        this.nodeZones = [];
        this.gateZones = [];
        this.nodeTexts = [];
        this.commandLines = [];
        
        this.isBoxSelecting = false;
        this.boxStartPointer = null;

        this.dockingGuidances = new Map();
    }

    init(data?: any) {
        // 每次场景重启（不是实例化，而是 stop->start 过程）时，彻底清空遗留的实体和状态
        // 只有在这里才去碰 DOM 或者 Map 的重置，因为 constructor 在整个游戏只跑一次
        if (this.shipSprites) {
            for (let sprite of this.shipSprites.values()) {
                if (sprite && sprite.destroy) sprite.destroy(true);
            }
            this.shipSprites.clear();
        }
        
        this.tacticalIcons.clear();
        
        this.tacticalLayer = document.getElementById('tactical-icons-layer');
        if (this.tacticalLayer) {
            this.tacticalLayer.innerHTML = ''; // 清空上一场景遗留的 DOM，防止堆积
        }
        
        this.effects = [];
        this.projectiles = [];
        this.missiles = [];
        this.asteroids = [];
        this.drops = [];
        this.currentNodes = [];
        this.currentGates = [];
        this.commandLines = [];
        
        if (this.nodeZones) {
            this.nodeZones.forEach(z => { if (z && z.destroy) z.destroy(); });
        }
        this.nodeZones = [];
        
        if (this.gateZones) {
            this.gateZones.forEach(z => { if (z && z.destroy) z.destroy(); });
        }
        this.gateZones = [];

        if (this.nodeTexts) {
            this.nodeTexts.forEach(t => { if (t && t.destroy) t.destroy(); });
        }
        this.nodeTexts = [];

        if (this.asteroidSprites) {
            for (let sprite of this.asteroidSprites.values()) {
                if (sprite && sprite.destroy) sprite.destroy();
            }
            this.asteroidSprites.clear();
        }

        if (this.moduleSprites) {
            for (let item of this.moduleSprites.values()) {
                if (item.sprite && item.sprite.destroy) item.sprite.destroy();
                if (item.zone && item.zone.destroy) item.zone.destroy();
            }
            this.moduleSprites.clear();
        }

        if (this.dockingGuidances) {
            for (let guide of this.dockingGuidances.values()) {
                if (guide.sprite) guide.sprite.destroy();
                if (guide.textObj) guide.textObj.destroy();
            }
            this.dockingGuidances.clear();
        }
    }

    preload() {
        // --- [防连点重启防御] ---
        // 为了防止 preload 中被清理了资源再次下载，此处不需要特殊处理
        // 因为 Phaser 自己有缓存机制
        
        // 加载小行星图片
        this.load.image('asteroid_1', 'assets/小行星1.png');
        this.load.image('asteroid_2', 'assets/小行星 2.png');
        this.load.image('asteroid_3', 'assets/小行星3.png');
        this.load.image('asteroid_4', 'assets/小行星4.png');

        Object.values((GameConfig as any).HULLS).forEach((hull: any) => {
            if (hull.sprite) {
                const key = hull.sprite.replace('.png', '');
                this.load.image(key, `assets/${hull.sprite}`);
            }
            if (hull.turretBaseSprite) {
                const key = hull.turretBaseSprite.replace('.png', '');
                const fileName = hull.turretBaseSprite.endsWith('.png') ? hull.turretBaseSprite : `${hull.turretBaseSprite}.png`;
                this.load.image(key, `assets/${fileName}`);
            }
        });

        if ((GameConfig as any).COMPONENTS) {
            Object.values((GameConfig as any).COMPONENTS).forEach((comp: any) => {
                const sprite = comp.meta && comp.meta.sprite;
                if (sprite && sprite !== 'none' && !sprite.startsWith('icon_')) {
                    const key = sprite.replace('.png', '');
                    const fileName = sprite.endsWith('.png') ? sprite : `${sprite}.png`;
                    this.load.image(key, `assets/${fileName}`);
                }
            });
        }

        if ((GameConfig as any).MODULES) {
            Object.values((GameConfig as any).MODULES).forEach((mod: any) => {
                if (mod.sprite) {
                    const key = mod.sprite.replace('.png', '');
                    const fileName = mod.sprite.endsWith('.png') ? mod.sprite : `${mod.sprite}.png`;
                    this.load.image(key, `assets/${fileName}`);
                }
            });
        }
    }

    create() {
        this.cameras.main.setBackgroundColor('#000000'); // Black space background

        // 主摄像机区域不再写死，而是铺满整个 game-container 画布
        const gameWidth = this.scale.width;
        const gameHeight = this.scale.height;
        this.cameras.main.setViewport(0, 0, gameWidth, gameHeight);

        // Graphics layers
        this.bgGraphics = this.add.graphics({ depth: 0 }); // Sun, Orbits
        this.stationGraphics = this.add.graphics({ depth: 0.5 }); // Station Grid and Modules
        this.updateSystemBackground(); // Ensure background is drawn immediately on creation
        
        this.nodeGraphics = this.add.graphics({ depth: 1 }); // Planets, Stations, Gates
        this.projectileGraphics = this.add.graphics({ depth: 4 }); // Bullets, Lasers
        this.effectGraphics = this.add.graphics({ depth: 6 }); // Explosions, Feedback
        this.targetPointGraphics = this.add.graphics({ depth: 8 }); // 目标点层级和引导线，放置于飞船和特效上方
        this.selectionBoxGraphics = this.add.graphics({ depth: 10 }); // 框选UI层级在最上面

        this.nodeTexts = []; // DOM replacement text labels for nodes

        // Mouse Events
        if (this.input.mouse) {
            this.input.mouse.disableContextMenu();
        }
        this.input.on('pointerdown', (pointer: any) => {
            // 背景点击：清理选中目标或发布移动指令
            // 实体点击会被各个对象自身的 setInteractive 拦截 (通过 event.stopPropagation)
            const worldX = pointer.worldX;
            const worldY = pointer.worldY;
            
            if (pointer.button === 2) {
                document.dispatchEvent(new CustomEvent('radar_right_click', { 
                    detail: { x: worldX, y: worldY, screenX: pointer.event.clientX, screenY: pointer.event.clientY, targetShip: null }
                }));
            } else {
                document.dispatchEvent(new CustomEvent('radar_left_click', {
                    detail: { x: worldX, y: worldY, screenX: pointer.event.clientX, screenY: pointer.event.clientY, targetShip: null, targetNode: null }
                }));
                // 开始框选
                this.isBoxSelecting = true;
                this.boxStartPointer = { x: pointer.worldX, y: pointer.worldY, screenX: pointer.event.clientX, screenY: pointer.event.clientY };
            }
        });
        
        this.input.on('pointermove', (pointer: any) => {
            if (this.isBoxSelecting && this.boxStartPointer && pointer.isDown && pointer.button === 0) {
                // 仅绘制框选区域，真实逻辑在 pointerup 时触发
                this.selectionBoxGraphics.clear();
                const startX = this.boxStartPointer.x;
                const startY = this.boxStartPointer.y;
                const curX = pointer.worldX;
                const curY = pointer.worldY;
                
                // 只有移动超过一定距离才算框选
                if (Math.hypot(curX - startX, curY - startY) > 5) {
                    this.selectionBoxGraphics.lineStyle(1, 0x00ff00, 0.8);
                    this.selectionBoxGraphics.fillStyle(0x00ff00, 0.2);
                    this.selectionBoxGraphics.strokeRect(startX, startY, curX - startX, curY - startY);
                    this.selectionBoxGraphics.fillRect(startX, startY, curX - startX, curY - startY);
                }
            }
        });

        this.input.on('pointerup', (pointer: any) => {
            if (this.isBoxSelecting && this.boxStartPointer) {
                this.selectionBoxGraphics.clear();
                
                const startX = this.boxStartPointer.x;
                const startY = this.boxStartPointer.y;
                const endX = pointer.worldX;
                const endY = pointer.worldY;
                
                // 只有移动超过一定距离才算作框选事件，否则是普通的点击
                if (Math.hypot(endX - startX, endY - startY) > 5) {
                    document.dispatchEvent(new CustomEvent('radar_box_select', {
                        detail: {
                            startX: startX,
                            startY: startY,
                            endX: endX,
                            endY: endY,
                            screenStartX: this.boxStartPointer.screenX,
                            screenStartY: this.boxStartPointer.screenY,
                            screenEndX: pointer.event.clientX,
                            screenEndY: pointer.event.clientY
                        }
                    }));
                }
                
                this.isBoxSelecting = false;
                this.boxStartPointer = null;
            }
        });

        // 监听滚轮事件，派发给 UI 层处理缩放
        this.input.on('wheel', (pointer: any, gameObjects: any, deltaX: number, deltaY: number, deltaZ: number) => {
            document.dispatchEvent(new CustomEvent('radar_wheel', { detail: { deltaY } }));
        });

        // 监听来自 UI 的引导请求
        document.addEventListener('ui_select_docking_target', (e: any) => {
            const { worldX, worldY, entryAngle, hullId, berthId, shipId, sector, timestamp } = e.detail;
            // hullId 可能没传过来，不要用它卡死
            if (worldX !== undefined && worldY !== undefined && entryAngle !== undefined && shipId) {
                this.showDockingGuidance(worldX, worldY, entryAngle, hullId || 'hull_fighter_s', berthId, shipId, sector, timestamp);
            }
        });

        // 监听停靠完成事件
        document.addEventListener('ui_docking_completed', (e: any) => {
            const { shipId } = e.detail;
            if (shipId && this.dockingGuidances.has(shipId)) {
                const guide = this.dockingGuidances.get(shipId);
                if (guide && guide.sprite) guide.sprite.destroy();
                if (guide && guide.textObj) guide.textObj.destroy();
                this.dockingGuidances.delete(shipId);
            }
        });
    }

    showDockingGuidance(x: number, y: number, angle: number, hullId: string, berthId: string, shipId: string, sector?: string, timestamp?: number) {
        if (!shipId) return;

        // 清除同一个 shipId 的旧引导
        if (this.dockingGuidances.has(shipId)) {
            const oldGuide = this.dockingGuidances.get(shipId);
            if (oldGuide && oldGuide.sprite) oldGuide.sprite.destroy();
            if (oldGuide && oldGuide.textObj) oldGuide.textObj.destroy();
        }

        const hullDef = (GameConfig as any).HULLS[hullId];
        let spriteKey = 'player'; // default
        let targetScale = 1.0;
        if (hullDef) {
            if (hullDef.sprite) {
                spriteKey = hullDef.sprite.replace('.png', '');
            }
            if (hullDef.scale !== undefined) {
                targetScale = hullDef.scale;
            }
        }

        const sprite = this.add.sprite(x, y, spriteKey);
        sprite.setAngle(angle);
        
        // 除了通用 scale 缩放，检查 hullDef 中是否有专属的 spriteSize（例如高分大图被强制限制为特定大小）
        if (hullDef && hullDef.spriteSize) {
            sprite.setDisplaySize(hullDef.spriteSize.width, hullDef.spriteSize.height);
        } else {
            sprite.setScale(targetScale);
        }
        
        sprite.setAlpha(0.5); // 半透明虚影
        sprite.setTint(0x00ff00); // 绿色调
        sprite.setDepth(8); // 将停泊虚影放在较顶层的 depth，与引导线齐平

        // 默认显示文字
        const textStr = `[停泊] 泊位: ${berthId}`;
        const textObj = this.add.text(x, y - 20, textStr, { 
            fontSize: '12px', 
            fill: '#00ff00',
            backgroundColor: 'rgba(0,0,0,0.5)',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        textObj.setDepth(9);

        // 如果引导信息与当前星区不符，立刻隐藏（不销毁，等切过去还能看到）
        const baseScene = this.scene.manager.getScene('Base') as any;
        const currentViewSector = (baseScene && baseScene.viewingSector) ? baseScene.viewingSector : localStorage.getItem('current_sector');
        
        if (sector && currentViewSector && sector !== currentViewSector) {
            sprite.setVisible(false);
            textObj.setVisible(false);
        }

        this.dockingGuidances.set(shipId, {
            worldX: x,
            worldY: y,
            entryAngle: angle,
            hullId: hullId,
            berthId: berthId,
            sector: sector,
            timestamp: timestamp || Date.now(),
            sprite: sprite,
            textObj: textObj
        });
    }

    update(time: number, delta: number) {
        const startTime = performance.now();
        const dt = delta / 1000;

        // Update Nodes and Gates
        if (this.nodeGraphics) {
            this.nodeGraphics.clear();
            
            // 同步 StationSprite 的缩放和旋转 (可选如果需要额外的动画，但基本坐标已经在 syncEntities 设置了)
            const currentZoom = this.cameras.main ? this.cameras.main.zoom : 1;
            const invZoom = 1 / currentZoom;
            
            // Clear old texts
            this.nodeTexts.forEach(t => t.destroy());
            this.nodeTexts = [];

            // Draw Nodes
            if (this.currentNodes) {
                // 动态调整交互区数量
                while (this.nodeZones.length < this.currentNodes.length) {
                    let zone = this.add.zone(0, 0, 60, 60).setInteractive({ cursor: 'pointer' }) as any;
                    zone.on('pointerdown', (pointer: any, localX: number, localY: number, event: any) => {
                        event.stopPropagation();
                        if (pointer.button !== 2) {
                            document.dispatchEvent(new CustomEvent('radar_left_click', {
                                detail: { x: zone.x, y: zone.y, screenX: pointer.event.clientX, screenY: pointer.event.clientY, targetShip: null, targetNode: zone.nodeRef }
                            }));
                        }
                    });
                    this.nodeZones.push(zone);
                }
                while (this.nodeZones.length > this.currentNodes.length) {
                    const z = this.nodeZones.pop();
                    if (z) z.destroy();
                }

                this.currentNodes.forEach((node, i) => {
                    let color = 0x00aaff;
                    if (node.type === 'planet' || node.type === 'debris1') color = 0x00ff00;
                    if (node.type === 'defense') color = 0xffaa00;
                    
                    if (node.type !== 'station') {
                        this.nodeGraphics.fillStyle(color, 0.8);
                        this.nodeGraphics.fillCircle(node.x, node.y, 6 * invZoom);
                        this.nodeGraphics.lineStyle(1 * invZoom, color, 0.4);
                        this.nodeGraphics.strokeCircle(node.x, node.y, 10 * invZoom);
                        
                        const yOffset = 12 * invZoom;
                        const t = this.add.text(node.x, node.y + yOffset, node.name, { fontSize: '10px', fill: '#00ffff', backgroundColor: 'rgba(0,0,0,0.5)' }).setOrigin(0.5);
                        t.setScale(invZoom);
                        t.setDepth(3);
                        this.nodeTexts.push(t);
                    }

                    // 更新交互区
                    let zone = this.nodeZones[i];
                    zone.setPosition(node.x, node.y);
                    const zoneSize = (60 * invZoom);
                    zone.setSize(zoneSize, zoneSize);
                    zone.nodeRef = node;
                });
            }

            // Draw Gates
            if (this.currentGates) {
                while (this.gateZones.length < this.currentGates.length) {
                    let zone = this.add.zone(0, 0, 80, 80).setInteractive({ cursor: 'pointer' }) as any;
                    zone.on('pointerdown', (pointer: any, localX: number, localY: number, event: any) => {
                        event.stopPropagation();
                        if (pointer.button !== 2) {
                            const nodeData = { id: 'gate-' + zone.nodeRef.name, target: 'gate-' + zone.nodeRef.name, name: zone.nodeRef.name, type: 'gate' };
                            document.dispatchEvent(new CustomEvent('radar_left_click', {
                                detail: { x: zone.x, y: zone.y, screenX: pointer.event.clientX, screenY: pointer.event.clientY, targetShip: null, targetNode: nodeData }
                            }));
                        }
                    });
                    this.gateZones.push(zone);
                }
                while (this.gateZones.length > this.currentGates.length) {
                    const z = this.gateZones.pop();
                    if (z) z.destroy();
                }

                this.currentGates.forEach((gate, i) => {
                    const isNav = gate.isNavTarget;
                    const color = isNav ? 0x00ff00 : 0x00aaff;
                    
                    this.nodeGraphics.fillStyle(color, 0.5);
                    this.nodeGraphics.fillCircle(gate.x, gate.y, (isNav ? 12 : 8) * invZoom);
                    this.nodeGraphics.lineStyle(2 * invZoom, color, 0.8);
                    this.nodeGraphics.strokeCircle(gate.x, gate.y, (isNav ? 16 : 12) * invZoom);
                    
                    const tName = isNav ? `>> 星门: ${gate.name} <<` : `星门: ${gate.name}`;
                    const t = this.add.text(gate.x, gate.y + (18 * invZoom), tName, { fontSize: '10px', fill: isNav ? '#00ff00' : '#00aaff', backgroundColor: 'rgba(0,0,0,0.6)' }).setOrigin(0.5);
                    t.setScale(invZoom);
                    t.setDepth(3);
                    this.nodeTexts.push(t);

                    // 更新交互区
                    let zone = this.gateZones[i];
                    zone.setPosition(gate.x, gate.y);
                    zone.setSize(80 * invZoom, 80 * invZoom);
                    zone.nodeRef = gate;
                });
            }
        }

        // Update Effects (Explosions, Lasers, RTS feedback)
        this.effectGraphics.clear();
        for (let i = this.effects.length - 1; i >= 0; i--) {
            let fx = this.effects[i];
            fx.life -= dt;
            if (fx.life <= 0) {
                this.effects.splice(i, 1);
                continue;
            }
            
            let progress = 1 - (fx.life / fx.maxLife);
            
            if (fx.type === 'explosion') {
                const r = 15 * Math.sin(progress * Math.PI);
                this.effectGraphics.fillStyle(0xffffff, 1 - progress);
                this.effectGraphics.fillCircle(fx.x, fx.y, r);
                this.effectGraphics.fillStyle(0xff5500, (1 - progress) * 0.8);
                this.effectGraphics.fillCircle(fx.x, fx.y, r * 1.5);
            } else if (fx.type === 'implosion') {
                const r = 30 * (1 - progress);
                this.effectGraphics.lineStyle(2, 0x00ffff, 1 - progress);
                this.effectGraphics.strokeCircle(fx.x, fx.y, r);
                this.effectGraphics.fillStyle(0x00ffff, (1 - progress) * 0.3);
                this.effectGraphics.fillCircle(fx.x, fx.y, r);
            } else if (fx.type === 'laser') {
                this.effectGraphics.lineStyle(fx.thickness || 2, (window as any).Phaser.Display.Color.HexStringToColor(fx.color || '#ff0000').color, fx.life / fx.maxLife);
                this.effectGraphics.beginPath();
                this.effectGraphics.moveTo(fx.x1, fx.y1);
                this.effectGraphics.lineTo(fx.x2, fx.y2);
                this.effectGraphics.strokePath();
            } else if (fx.type === 'gateExit') {
                const len = 50 * Math.sin(progress * Math.PI);
                this.effectGraphics.lineStyle(4, 0x00ffff, 1 - progress);
                this.effectGraphics.beginPath();
                this.effectGraphics.moveTo(fx.x, fx.y);
                this.effectGraphics.lineTo(fx.x + Math.cos(fx.angle) * len, fx.y + Math.sin(fx.angle) * len);
                this.effectGraphics.strokePath();
            } else if (fx.type === 'rtsFeedback') {
                const currentZoom = this.cameras.main ? this.cameras.main.zoom : 1;
                const invZoom = 1 / currentZoom;
                const r = 20 * progress * invZoom;
                const cColor = (window as any).Phaser.Display.Color.HexStringToColor(fx.color || '#00ff00').color;
                this.effectGraphics.lineStyle(2 * invZoom, cColor, 1 - progress);
                this.effectGraphics.strokeCircle(fx.x, fx.y, r);
                // Also update floating text position
                if (!fx.textObj) {
                    fx.textObj = this.add.text(fx.x, fx.y - (20 * invZoom), fx.text, { fontSize: '10px', fill: fx.color, fontStyle: 'bold' }).setOrigin(0.5);
                    fx.textObj.setDepth(7);
                }
                fx.textObj.setScale(invZoom);
                fx.textObj.y = fx.y - (20 * invZoom) - (10 * progress * invZoom);
                fx.textObj.setAlpha(1 - progress);
                if (fx.life <= 0 && fx.textObj) {
                    fx.textObj.destroy();
                }
            }
        }

        // 渲染建筑模块与网格
        this.stationGraphics.clear();
        const baseScene = this.scene.manager.getScene('Base') as any;
        const currentViewSector = (baseScene && baseScene.viewingSector) ? baseScene.viewingSector : localStorage.getItem('current_sector');
        
        // 【核心修复】只获取当前正在观察的星区的模块
        let modules = BuildingManager.getAllModules(currentViewSector);
        
        // 【性能修复】修复由于不同星区模块 ID 冲突导致的疯狂创建/销毁循环
        // 如果模块没有独立 ID，我们必须把 sector 加上作为复合主键，否则 A 星区的 (0,0) 和 B 星区的 (0,0) 会互相销毁对方
        const getModuleUniqueId = (m: any) => {
            if (m.id) return m.id;
            if (m.instanceId) return m.instanceId;
            const sector = m.sector || currentViewSector || 'unknown';
            return `${sector}_${m.gridX}_${m.gridY}`;
        };

        // 清理不再存在的模块贴图
        const currentModIds = new Set(modules.map(m => getModuleUniqueId(m)));
        
        for (const [id, item] of this.moduleSprites.entries()) {
            if (!currentModIds.has(id)) {
                if (item.sprite) item.sprite.destroy();
                if (item.zone) item.zone.destroy();
                this.moduleSprites.delete(id);
            }
        }

        modules.forEach(mod => {
            const mAny = mod as any;
            const uniqueId = getModuleUniqueId(mAny);
            const w = mod.width * GRID_PIXEL_SIZE;
            const h = mod.height * GRID_PIXEL_SIZE;
            const modData = (GameConfig as any).MODULES[mod.moduleId];

            // 【架构大一统】：剥夺渲染层计算坐标的权力，完全听命于空间注册表
            let centerX = 0, centerY = 0, worldPosX = 0, worldPosY = 0;
            const registryEntry = UniverseEngine.getRegistryEntry(mod.uid);
            
            if (registryEntry) {
                // 优先使用最高权威：UniverseEngine 算好的纯净几何中心
                centerX = registryEntry.worldX;
                centerY = registryEntry.worldY;
                worldPosX = centerX - w / 2;
                worldPosY = centerY - h / 2;
            } else {
                // 仅作为刚放置但还没进下一帧注册表的临时回退
                const fallbackPos = BuildingManager.gridToWorld(mod.gridX, mod.gridY);
                centerX = fallbackPos.x + w / 2;
                centerY = fallbackPos.y + h / 2;
                worldPosX = fallbackPos.x;
                worldPosY = fallbackPos.y;
            }

            let cacheObj = this.moduleSprites.get(uniqueId);
            if (!cacheObj) {
                cacheObj = {};
                this.moduleSprites.set(uniqueId, cacheObj);
            }

            // 绘制模块的贴图
            if (modData && modData.sprite) {
                const spriteKey = modData.sprite.replace('.png', '');
                let sprite = cacheObj.sprite;
                if (!sprite) {
                    sprite = this.add.sprite(centerX, centerY, spriteKey);
                    sprite.setDepth(0.55); // 在 grid 线上方，文本下方
                    cacheObj.sprite = sprite;
                }
                // 根据旋转角度处理贴图
                const rotation = mod.rotation || 0;
                sprite.setAngle(rotation);

                if (sprite.width > 0 && sprite.height > 0) {
                    const isRotated = rotation % 180 !== 0;
                    const visualOrigW = isRotated ? sprite.height : sprite.width;
                    const visualOrigH = isRotated ? sprite.width : sprite.height;

                    const scale = Math.min(w / visualOrigW, h / visualOrigH);
                    sprite.setScale(scale, scale);
                    
                    let drawX = centerX;
                    let drawY = centerY;
                    
                    // 根据 connectRule 调整对齐位置
                    if (modData.connectRule) {
                        const actualW = visualOrigW * scale;
                        const actualH = visualOrigH * scale;
                        
                        let effectiveRule = { ...modData.connectRule };
                        if (rotation === 90) {
                            effectiveRule = { up: modData.connectRule.left, right: modData.connectRule.up, down: modData.connectRule.right, left: modData.connectRule.down };
                        } else if (rotation === 180) {
                            effectiveRule = { up: modData.connectRule.down, right: modData.connectRule.left, down: modData.connectRule.up, left: modData.connectRule.right };
                        } else if (rotation === 270) {
                            effectiveRule = { up: modData.connectRule.right, right: modData.connectRule.down, down: modData.connectRule.left, left: modData.connectRule.up };
                        }

                        if (effectiveRule.left === "port") {
                            drawX = worldPosX + actualW / 2;
                        } else if (effectiveRule.right === "port") {
                            drawX = worldPosX + w - actualW / 2;
                        }
                        
                        if (effectiveRule.up === "port") {
                            drawY = worldPosY + actualH / 2;
                        } else if (effectiveRule.down === "port") {
                            drawY = worldPosY + h - actualH / 2;
                        }
                    }
                    
                    sprite.setPosition(drawX, drawY);
                } else {
                    sprite.setPosition(centerX, centerY);
                }
            }
            
            // 添加透明交互区
            let zone = cacheObj.zone;
            if (!zone) {
                zone = this.add.zone(centerX, centerY, w, h);
                zone.setInteractive({ cursor: 'pointer' });
                zone.on('pointerdown', (pointer: any, localX: number, localY: number, event: any) => {
                    event.stopPropagation();

                    if (pointer.button === 2) {
                        // 模块右键点击逻辑
                        // 通过模块上的 stationUid 找到真实的 station 实体 ID，没有则降级使用 uniqueId（或假目标）
                        // 这是因为只有拿到真实实体的 ID，UI 层才能打开它的装备/库存面板
                        let targetId = uniqueId;
                        if (mod && mod.stationUid) {
                            targetId = mod.stationUid;
                        }

                        document.dispatchEvent(new CustomEvent('radar_right_click', {
                            detail: {
                                x: centerX,
                                y: centerY,
                                screenX: pointer.event.clientX,
                                screenY: pointer.event.clientY,
                                // 我们将所属的真实实体ID传出去，不管是停泊、观察还是交流都会指向整个空间站
                                targetShip: { id: targetId }
                            }
                        }));
                    } else {
                        // 左键点击：打开该模块专属的 UI 面板
                        document.dispatchEvent(new CustomEvent('radar_module_click', {
                            detail: {
                                module: mod,
                                modData: modData,
                                screenX: pointer.event.clientX,
                                screenY: pointer.event.clientY
                            }
                        }));
                    }
                });
                cacheObj.zone = zone;
            }
            zone.setPosition(centerX, centerY);
            zone.setSize(w, h);

            // 绘制模块的背景填充 (降低透明度以免遮挡贴图)
            const isCore = modData && modData.category === 'core';
            const fillColor = isCore ? 0x0088ff : 0xff8800;
            this.stationGraphics.fillStyle(fillColor, 0.1);
            this.stationGraphics.fillRect(worldPosX, worldPosY, w, h);

            // 绘制模块的外边框
            this.stationGraphics.lineStyle(4, 0x00ff00, 0.8);
            this.stationGraphics.strokeRect(worldPosX, worldPosY, w, h);
            
            // 绘制模块内部的网格线（如果占据多个网格）
            this.stationGraphics.lineStyle(1, 0x00ff00, 0.3);
            for(let i=1; i<mod.width; i++) {
                this.stationGraphics.beginPath();
                this.stationGraphics.moveTo(worldPosX + i*GRID_PIXEL_SIZE, worldPosY);
                this.stationGraphics.lineTo(worldPosX + i*GRID_PIXEL_SIZE, worldPosY + h);
                this.stationGraphics.strokePath();
            }
            for(let j=1; j<mod.height; j++) {
                this.stationGraphics.beginPath();
                this.stationGraphics.moveTo(worldPosX, worldPosY + j*GRID_PIXEL_SIZE);
                this.stationGraphics.lineTo(worldPosX + w, worldPosY + j*GRID_PIXEL_SIZE);
                this.stationGraphics.strokePath();
            }

            // 已移除模块名称文本的显示
            const modAny = mod as any;
            if (modAny.textObj) {
                modAny.textObj.destroy();
                modAny.textObj = null;
            }
        });

        // Render Target Points & Command Lines
        this.targetPointGraphics.clear();
        const currentZoom = this.cameras.main ? this.cameras.main.zoom : 1;
        const invZoom = 1 / currentZoom;

        // 绘制停泊引导线
        if (this.dockingGuidances && this.dockingGuidances.size > 0) {
            const now = Date.now();
            const baseScene = this.scene.manager.getScene('Base') as any;
            const currentViewSector = (baseScene && baseScene.viewingSector) ? baseScene.viewingSector : localStorage.getItem('current_sector');

            for (const [targetId, guidance] of this.dockingGuidances.entries()) {
                
                // 1. 星区过滤：如果不是当前星区的指令，或者当前星区变了，不渲染引导线
                if (guidance.sector && guidance.sector !== currentViewSector) {
                    if (guidance.sprite && guidance.sprite.visible) guidance.sprite.setVisible(false);
                    if (guidance.textObj && guidance.textObj.visible) guidance.textObj.setVisible(false);
                    continue; // 跳过不画线
                } else {
                    // 在当前星区，确保可见并随缩放更新
                    if (guidance.sprite && !guidance.sprite.visible) guidance.sprite.setVisible(true);
                    if (guidance.textObj) {
                        if (!guidance.textObj.visible) guidance.textObj.setVisible(true);
                        guidance.textObj.setScale(invZoom);
                        // 根据时间计算进度并更新文字
                        if (guidance.timestamp) {
                            const elapsed = now - guidance.timestamp;
                            const timeout = 120000; // 2 分钟超时
                            
                            // 检查超时逻辑
                            if (elapsed > timeout) {
                                console.warn(`[港务局] 飞船 ${targetId} 停泊申请超时 (超过 2 分钟)，强制释放泊位。`);
                                // 通过事件通知系统清空占位
                                document.dispatchEvent(new CustomEvent('ui_docking_timeout', {
                                    detail: { shipId: targetId }
                                }));
                                
                                // 自我销毁
                                if (guidance.sprite) guidance.sprite.destroy();
                                if (guidance.textObj) guidance.textObj.destroy();
                                this.dockingGuidances.delete(targetId);
                                continue; // 跳出本次循环
                            }
                            
                            const ratio = Math.max(0, 1 - elapsed / timeout);
                            const remainingSecs = Math.ceil((timeout - elapsed) / 1000);
                            
                            // 修改文字显示时间
                            let textStr = `[引导中] 泊位: ${guidance.berthId} - ${remainingSecs}s`;
                            
                            // 文字颜色警示
                            if (remainingSecs < 30) {
                                guidance.textObj.setColor('#ff3333');
                            } else {
                                guidance.textObj.setColor('#00ff00');
                            }
                            
                            guidance.textObj.setText(textStr);
                            guidance.textObj.y = guidance.worldY - (25 * invZoom);
                        }
                    }
                }

                let playerSprite = this.shipSprites.get(targetId);
                
                // 兜底找玩家飞船 (兼容)
                if (!playerSprite) {
                    const pdForRadar = (window as any).PlayerManager?.getStats();
                    const playerShipIdForRadar = pdForRadar ? pdForRadar.playerShipId : null;
                    if (targetId === playerShipIdForRadar || targetId === 'player_ship') {
                        playerSprite = Array.from(this.shipSprites.values()).find(s => 
                            s.entRef && (s.entRef.id === playerShipIdForRadar || s.entRef.id === 'player_ship' || (s.entRef.shipRef && s.entRef.shipRef.ownerId === 'player' && s.entRef.id === playerShipIdForRadar))
                        );
                    }
                }

                if (playerSprite && playerSprite.entRef) {
                    const startX = playerSprite.entRef.x;
                    const startY = playerSprite.entRef.y;
                    const endX = guidance.worldX;
                    const endY = guidance.worldY;

                    const dx = endX - startX;
                    const dy = endY - startY;
                    const dist = Math.hypot(dx, dy);
                    const dashLen = 15 * invZoom;
                    const gapLen = 10 * invZoom;
                    const dashCount = Math.floor(dist / (dashLen + gapLen));
                    
                    const timeOffset = (time % 1000) / 1000;
                    const totalDashLen = dashLen + gapLen;
                    const startOffset = timeOffset * totalDashLen;

                    this.targetPointGraphics.lineStyle(4 * invZoom, 0x00ffaa, 1.0);

                    if (dist > totalDashLen) {
                        const nx = dx / dist;
                        const ny = dy / dist;
                        
                        for (let k = 0; k <= dashCount + 1; k++) {
                            let dStartDist = k * totalDashLen - startOffset;
                            let dEndDist = dStartDist + dashLen;
                            
                            if (dEndDist < 0) continue;
                            if (dStartDist > dist) break;
                            
                            dStartDist = Math.max(0, dStartDist);
                            dEndDist = Math.min(dist, dEndDist);

                            const dStartX = startX + nx * dStartDist;
                            const dStartY = startY + ny * dStartDist;
                            const dEndX = startX + nx * dEndDist;
                            const dEndY = startY + ny * dEndDist;

                            this.targetPointGraphics.beginPath();
                            this.targetPointGraphics.moveTo(dStartX, dStartY);
                            this.targetPointGraphics.lineTo(dEndX, dEndY);
                            this.targetPointGraphics.strokePath();
                        }
                    } else {
                        this.targetPointGraphics.beginPath();
                        this.targetPointGraphics.moveTo(startX, startY);
                        this.targetPointGraphics.lineTo(endX, endY);
                        this.targetPointGraphics.strokePath();
                    }
                }
            }
        }

        // 绘制采矿特效
        // 由于 entities 的完整列表在 syncEntities 时被抛弃了，我们需要通过 shipSprites 遍历来获取附带的属性
        for (const sprite of this.shipSprites.values()) {
            if (sprite.entRef && sprite.entRef.shipRef && sprite.entRef.shipRef.isActivelyMining) {
                // 绘制收缩波纹
                const cycle = (time % 1000) / 1000; // 0 到 1
                const radius = (60 - cycle * 50) * invZoom; // 半径从 60 缩到 10
                
                // 判定是否超载，超载变红，正常为绿黄
                const isOverloaded = sprite.entRef.shipRef.isMiningOverloaded;
                const baseColor = isOverloaded ? 0xff0000 : 0x00ff00;
                const innerColor = isOverloaded ? 0xffaaaa : 0xffff00;

                this.effectGraphics.lineStyle(2 * invZoom, baseColor, 0.5);
                // 绘制一圈主颜色的吸附特效
                this.effectGraphics.strokeCircle(sprite.entRef.x, sprite.entRef.y, radius);
                
                // 内圈混色
                this.effectGraphics.lineStyle(1 * invZoom, innerColor, Math.max(0, 1 - cycle));
                this.effectGraphics.strokeCircle(sprite.entRef.x, sprite.entRef.y, radius * 0.8);
            }
        }

        // 绘制高级指挥线
        if (this.commandLines) {
            this.commandLines.forEach(cmd => {
                const { startX, startY, endX, endY, type, isDashed, isSelected, colorHex } = cmd;
                
                let baseColor = colorHex ? (window as any).Phaser.Display.Color.HexStringToColor(colorHex).color : 0x00ff00;
                
                // 根据类型覆盖颜色
                if (type === 'ATTACK') baseColor = 0xff3333; // 攻击红色
                else if (type === 'DEFEND') baseColor = 0x00aaff; // 护卫蓝色
                else if (type === 'FOLLOW') baseColor = 0xffaa00; // 跟随橙色
                else if (type === 'MINE') baseColor = 0xffff00; // 采矿黄色

                // 如果未被选中（比如是AI的，或者是没框选的己方单位），降低透明度，避免满屏乱七八糟
                const alpha = isSelected ? 0.6 : 0.15;
                const thickness = isSelected ? 2 : 1;

                this.targetPointGraphics.lineStyle(thickness * invZoom, baseColor, alpha);

                if (isDashed) {
                    // 跨星区/途径星门虚线绘制逻辑
                    const dx = endX - startX;
                    const dy = endY - startY;
                    const dist = Math.hypot(dx, dy);
                    const dashLen = 20 * invZoom;
                    const gapLen = 15 * invZoom;
                    const dashCount = Math.floor(dist / (dashLen + gapLen));
                    
                    if (dashCount > 0) {
                        const nx = dx / dist;
                        const ny = dy / dist;
                        for (let k = 0; k < dashCount; k++) {
                            const dStartX = startX + nx * (k * (dashLen + gapLen));
                            const dStartY = startY + ny * (k * (dashLen + gapLen));
                            const dEndX = dStartX + nx * dashLen;
                            const dEndY = dStartY + ny * dashLen;
                            this.targetPointGraphics.beginPath();
                            this.targetPointGraphics.moveTo(dStartX, dStartY);
                            this.targetPointGraphics.lineTo(dEndX, dEndY);
                            this.targetPointGraphics.strokePath();
                        }
                    } else {
                        // 距离太短直接画实线
                        this.targetPointGraphics.beginPath();
                        this.targetPointGraphics.moveTo(startX, startY);
                        this.targetPointGraphics.lineTo(endX, endY);
                        this.targetPointGraphics.strokePath();
                    }
                } else {
                    // 本星区实线
                    this.targetPointGraphics.beginPath();
                    this.targetPointGraphics.moveTo(startX, startY);
                    this.targetPointGraphics.lineTo(endX, endY);
                    this.targetPointGraphics.strokePath();
                }

                // 在终点画一个目标标记
                if (isSelected) {
                    this.targetPointGraphics.strokeCircle(endX, endY, 4 * invZoom);
                    this.targetPointGraphics.fillStyle(baseColor, alpha);
                    this.targetPointGraphics.fillCircle(endX, endY, 2 * invZoom);

                    // 如果是攻击指令，终点画一个叉
                    if (type === 'ATTACK') {
                        const crossSize = 6 * invZoom;
                        this.targetPointGraphics.beginPath();
                        this.targetPointGraphics.moveTo(endX - crossSize, endY - crossSize);
                        this.targetPointGraphics.lineTo(endX + crossSize, endY + crossSize);
                        this.targetPointGraphics.moveTo(endX + crossSize, endY - crossSize);
                        this.targetPointGraphics.lineTo(endX - crossSize, endY + crossSize);
                        this.targetPointGraphics.strokePath();
                    } else {
                        // 否则画十字
                        const crossSize = 8 * invZoom;
                        this.targetPointGraphics.beginPath();
                        this.targetPointGraphics.moveTo(endX - crossSize, endY);
                        this.targetPointGraphics.lineTo(endX + crossSize, endY);
                        this.targetPointGraphics.moveTo(endX, endY - crossSize);
                        this.targetPointGraphics.lineTo(endX, endY + crossSize);
                        this.targetPointGraphics.strokePath();
                    }
                }
            });
        }

        // Render Asteroids and Drops
        if (this.asteroids) {
            const currentAstIds = new Set(this.asteroids.map(ast => ast.id));
            
            // 清理不再存在的小行星贴图
            for (const [id, sprite] of this.asteroidSprites.entries()) {
                if (!currentAstIds.has(id)) {
                    if (sprite && sprite.destroy) sprite.destroy();
                    this.asteroidSprites.delete(id);
                }
            }

            this.asteroids.forEach(ast => {
                let sprite = this.asteroidSprites.get(ast.id);
                if (!sprite) {
                    // 随机选择一个小行星图片（1-4）
                    const spriteId = Math.floor(Math.random() * 4) + 1;
                    sprite = this.add.sprite(ast.x, ast.y, `asteroid_${spriteId}`);
                    // 随机初始旋转
                    sprite.setAngle(Math.random() * 360);
                    // 稍微增加一点随机缩放偏差
                    const randomScale = 0.8 + Math.random() * 0.4; 
                    sprite.setScale(ast.size * randomScale);
                    sprite.setDepth(1.5); // 在节点层上方，飞船下方
                    
                    // 根据矿物类型稍微染色（可选，如果原图足够好可以不染色）
                    if (ast.resourceType === 'ice') {
                        sprite.setTint(0xaaddff);
                    } else if (ast.resourceType === 'iron') {
                        sprite.setTint(0xffaa88);
                    }
                    
                    this.asteroidSprites.set(ast.id, sprite);
                } else {
                    // 更新位置
                    sprite.setPosition(ast.x, ast.y);
                }

            });
        }
        
        if (this.drops) {
            this.drops.forEach(drop => {
                const color = drop.resourceType === 'titanium' ? 0xffffff : 0x00ffff;
                this.nodeGraphics.fillStyle(color, 1.0);
                this.nodeGraphics.fillRect(drop.x - 4 * invZoom, drop.y - 4 * invZoom, 8 * invZoom, 8 * invZoom);
            });
        }

        // Render Projectiles & Missiles
        this.projectileGraphics.clear();
        this.projectiles.forEach(p => {
            const color = (window as any).Phaser.Display.Color.HexStringToColor(p.color || '#ffff00').color;
            this.projectileGraphics.lineStyle(2, color, 1);
            this.projectileGraphics.beginPath();
            this.projectileGraphics.moveTo(p.x, p.y);
            this.projectileGraphics.lineTo(p.x - Math.cos(Math.atan2(p.vy, p.vx))*6, p.y - Math.sin(Math.atan2(p.vy, p.vx))*6);
            this.projectileGraphics.strokePath();
        });
        
        this.missiles.forEach(m => {
            this.projectileGraphics.fillStyle(0xffff00, 1);
            this.projectileGraphics.fillCircle(m.x, m.y, 2);
            this.projectileGraphics.fillStyle(0xff5500, 0.5);
            this.projectileGraphics.fillCircle(m.x, m.y, 4);
        });

        // 渲染远距离战术图标
        this.updateTacticalIcons();

        const cost = performance.now() - startTime;
        if (cost > 10) { // 如果单帧耗时超过 10ms，打印警告
            console.warn(`[PERF] RadarScene.update 耗时过高: ${cost.toFixed(2)} ms`);
        }
    }

    /**
     * Draw static background (Sun, Orbits)
     */
    updateSystemBackground() {
        if (!this.bgGraphics) return;
        this.bgGraphics.clear();
        
        // Center Sun (缩小回正常视觉比例，避免覆盖整个几万像素的星区导致画面发黄)
        this.bgGraphics.fillStyle(0xffffff, 1);
        this.bgGraphics.fillCircle(500, 275, 300);
        this.bgGraphics.fillStyle(0xffcc00, 0.6);
        this.bgGraphics.fillCircle(500, 275, 600);
        this.bgGraphics.fillStyle(0xff5500, 0.3);
        this.bgGraphics.fillCircle(500, 275, 1200);

        // Orbits (保持巨大的逻辑尺寸不变，但缩放极限已被允许到 0.01 以供全局俯瞰)
        this.bgGraphics.lineStyle(15, 0x00ffff, 0.1); // Thicker lines for giant map
        this.bgGraphics.strokeCircle(500, 275, 28000); // planet
        this.bgGraphics.strokeCircle(500, 275, 38000); // defense
    }

    /**
     * 同步后台实体状态到渲染层
     */
    syncEntities(entitiesData: any) {
        const startTime = performance.now();
        if (!this.shipSprites) return;
        
        const { ships, projectiles, missiles, asteroids, drops, selectedUnitIds, nodes, gates, commandLines } = entitiesData;

        // 同步静态天体
        if (nodes) this.currentNodes = nodes;
        if (gates) this.currentGates = gates;

        // Base 抛出来的 ships 是未停泊的物理飞船实体
        const currentIds = new Set(ships.map(s => s.id));

        // [新增] 拉取当前星区内**所有已停泊**的飞船（它们不在 ships 数组里，只在 ShipManager 内存里）
        const dockedShips = [];
        const bm = (window as any).BuildingManager;
        if (bm && (window as any).ShipManager) {
            const ShipManager = (window as any).ShipManager;
            const currentSector = localStorage.getItem('current_sector');
            // 只寻找当前星区内的所有已停泊飞船
            const allSectorShips = ShipManager.ships.filter((s: any) => s.location.sector === currentSector && s.dockedAt && s.dockedBerthId);
            dockedShips.push(...allSectorShips);
        }

        dockedShips.forEach(s => currentIds.add(s.id)); // 把停泊飞船的ID也加进来，防止被销毁

        // 移除死去的飞船
        for (const [id, sprite] of this.shipSprites.entries()) {
            if (!currentIds.has(id)) {
                sprite.destroy(true); // 使用 true 彻底销毁
                this.shipSprites.delete(id);
                
                // 清理战术图标
                if (this.tacticalIcons.has(id)) {
                    const el = this.tacticalIcons.get(id);
                    if (el && el.parentNode) {
                        el.parentNode.removeChild(el);
                    }
                    this.tacticalIcons.delete(id);
                }
            }
        }

        const selectionArray = Array.isArray(selectedUnitIds) ? selectedUnitIds : [];

        // 更新未停泊（物理）飞船
        ships.forEach(ent => {
            let sprite = this.shipSprites.get(ent.id);
            if (!sprite) {
                sprite = new ShipSprite(this, ent.x, ent.y, 'player');
                this.shipSprites.set(ent.id, sprite);
            }
            // 物理飞船正常更新状态和位置
            sprite.updateData(ent, selectionArray.includes(ent.id));
        });

        // 静态渲染已停泊飞船
        dockedShips.forEach(ent => {
            let sprite = this.shipSprites.get(ent.id);
            if (!sprite) {
                sprite = new ShipSprite(this, 0, 0, 'player');
                this.shipSprites.set(ent.id, sprite);
            }

            // 让 RadarScene 直接读取宏观数据层中记录的绝对坐标进行渲染，不再重复自行推算
            // ShipManager/Base-Docking 分配泊位时已经将确切的世界坐标写入了 dockingGuidanceTarget 或 location
            if (ent.location) {
                // 如果 ent 已经在物理层，直接使用物理坐标，无需任何改动。
                // 停泊的飞船，其绝对物理坐标 (location.x, location.y, rotation) 
                // 已经在触发 DOCKED 时由 Base-Docking / UniverseEngine 计算并固化。
            }

            // 伪造一个能给 ShipSprite 读取的 entRef
            const fakeEntData = {
                id: ent.id,
                x: ent.location.x,
                y: ent.location.y,
                rotation: ent.rotation,
                shipRef: ent,
                color: ent.ownerId === 'player' ? '#00ff00' : '#888888', // 停泊状态置灰或显示绿色
            };

            // 强制覆盖它的物理位置
            sprite.updateData(fakeEntData, false);
            // 给个变暗的效果，表示是在停泊中
            if (sprite.hullSprite) sprite.hullSprite.setAlpha(0.7);
        });
        
        // 简单存储弹道引用供 update 渲染
        this.projectiles = projectiles || [];
        this.missiles = missiles || [];
        this.asteroids = asteroids || [];
        this.drops = drops || [];
        this.commandLines = commandLines || [];

        // 检查引导状态是否需要取消
        // 当实体状态变为 dockedAt !== null 时，说明已经进港，主动清理该实体的引导
        if (this.dockingGuidances && this.dockingGuidances.size > 0) {
            for (const [shipId, guidance] of this.dockingGuidances.entries()) {
                // 如果发现飞船成功停靠，也要销毁文本
                // 通过内存里的 dockedShips 或者 ships 检查
                let isDocked = false;
                
                const dockedMatch = dockedShips.find(s => s.id === shipId);
                if (dockedMatch && dockedMatch.dockedAt) {
                    isDocked = true;
                } else {
                    const ent = ships.find(s => s.id === shipId || (s.shipRef && s.shipRef.ownerId === 'player' && s.id === 'player_ship' && shipId === 'player_ship'));
                    if (ent && ent.shipRef && ent.shipRef.dockedAt) {
                        isDocked = true;
                    }
                }
                
                if (isDocked) {
                    if (guidance.sprite) guidance.sprite.destroy();
                    if (guidance.textObj) guidance.textObj.destroy();
                    this.dockingGuidances.delete(shipId);
                }
            }
        }
        
        const cost = performance.now() - startTime;
        if (cost > 10) {
            console.warn(`[PERF] RadarScene.syncEntities 耗时过高: ${cost.toFixed(2)} ms`);
        }
    }

    syncCamera(panX: number, panY: number, scale: number) {
        if (!this.cameras.main) return;
        
        // 动态读取当前 game-container 画布的宽高
        const mainCamWidth = this.scale.width;
        const mainCamHeight = this.scale.height;
        
        this.cameras.main.setViewport(0, 0, mainCamWidth, mainCamHeight);
        this.cameras.main.setZoom(scale);
        
        // 直接让相机中心对准给定的物理坐标，告别旧的相对偏移计算
        this.cameras.main.centerOn(panX, panY);
    }

    updateTacticalIcons() {
        if (!this.tacticalLayer) {
            this.tacticalLayer = document.getElementById('tactical-icons-layer');
        }
        if (!this.tacticalLayer || !this.cameras.main) return;

        const zoom = this.cameras.main.zoom;
        if (zoom >= 0.4) {
            this.tacticalLayer.style.opacity = '0';
            return;
        } else {
            this.tacticalLayer.style.opacity = '1';
        }

        const camera = this.cameras.main;
        // 获取 Canvas 实际位置，计算相对于视窗的偏移
        let offsetX = 0;
        let offsetY = 0;
        if (this.sys.game.canvas) {
            const rect = this.sys.game.canvas.getBoundingClientRect();
            offsetX = rect.left;
            offsetY = rect.top;
        }

        for (const [id, sprite] of this.shipSprites.entries()) {
            const entData = sprite.entRef;
            if (!entData) continue;

            // 检查是否还在视野内 (粗略判定，为了防止边界误差可以稍微扩大一点判定范围)
            const viewViewRect = camera.worldView;
            if (entData.x < viewViewRect.left - 100 || entData.x > viewViewRect.right + 100 || 
                entData.y < viewViewRect.top - 100 || entData.y > viewViewRect.bottom + 100) {
                if (this.tacticalIcons.has(id)) {
                    this.tacticalIcons.get(id).style.display = 'none';
                }
                continue;
            }

            // 精确计算屏幕坐标: (世界坐标 - 相机中心点) * 缩放比例 + 屏幕中心点 + 画布偏移
            const screenX = (entData.x - camera.midPoint.x) * zoom + camera.centerX + offsetX;
            const screenY = (entData.y - camera.midPoint.y) * zoom + camera.centerY + offsetY;

            let el = this.tacticalIcons.get(id);
            if (!el) {
                el = document.createElement('div');
                el.style.position = 'absolute';
                el.style.transformOrigin = 'center center';
                // 默认样式
                el.style.fontSize = '14px';
                el.style.lineHeight = '1';
                el.style.userSelect = 'none';
                // 居中偏移
                el.style.left = '-7px';
                el.style.top = '-7px';
                el.style.display = 'flex';
                el.style.justifyContent = 'center';
                el.style.alignItems = 'center';
                
                // 开启指针穿透和光标样式，确保能接收鼠标事件
                el.style.pointerEvents = 'auto';
                el.style.cursor = 'pointer';
                
                // 首次创建时绑定事件，杜绝重复绑定
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    document.dispatchEvent(new CustomEvent('radar_left_click', {
                        detail: { 
                            x: entData.x, 
                            y: entData.y, 
                            screenX: e.clientX, 
                            screenY: e.clientY, 
                            targetShip: entData, 
                            targetNode: null 
                        }
                    }));
                });
                
                el.addEventListener('contextmenu', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    document.dispatchEvent(new CustomEvent('radar_right_click', {
                        detail: { 
                            x: entData.x, 
                            y: entData.y, 
                            screenX: e.clientX, 
                            screenY: e.clientY, 
                            targetShip: entData 
                        }
                    }));
                });
                
                this.tacticalLayer.appendChild(el);
                this.tacticalIcons.set(id, el);
            }

            // 更新颜色 (从 Base.js 动态计算好的红/蓝二元颜色传过来)
            const color = entData.color || '#33ccff';
            el.style.color = color;
            el.style.textShadow = `0 0 3px ${color}`;

            // 决定形状
            let iconChar = '▶';
            if (entData.shipRef && entData.shipRef.hullId) {
                const hullDef = (GameConfig as any).HULLS[entData.shipRef.hullId];
                if (hullDef) {
                    if (hullDef.type === 'freighter' || hullDef.name.includes('货')) {
                        iconChar = '■';
                        el.style.fontSize = '10px';
                    } else if (hullDef.size === 'large' || hullDef.name.includes('驱逐')) {
                        iconChar = '▶▶';
                        el.style.letterSpacing = '-4px';
                        el.style.paddingLeft = '4px';
                    }
                }
            }
            el.innerText = iconChar;

            el.style.display = 'flex';
            // 应用位置和旋转
            el.style.transform = `translate(${screenX}px, ${screenY}px) rotate(${entData.rotation}deg)`;
        }
    }

    // Effect triggers
    // --- [生命周期防御] ---
    // 防止在 this.effects 被某些极端操作置空（虽然构造函数已经初始化了）时报错
    // 即使出错也能默默吃掉，不中断物理引擎的核心循环
    addExplosion(x: number, y: number) {
        if (!this.effects) this.effects = [];
        this.effects.push({ type: 'explosion', x, y, life: 0.3, maxLife: 0.3 });
    }
    
    addImplosion(x: number, y: number) {
        if (!this.effects) this.effects = [];
        this.effects.push({ type: 'implosion', x, y, life: 0.4, maxLife: 0.4 });
    }
    
    addLaser(x1: number, y1: number, x2: number, y2: number, color: string, thickness: number = 2) {
        if (!this.effects) this.effects = [];
        this.effects.push({ type: 'laser', x1, y1, x2, y2, color, thickness, life: 0.2, maxLife: 0.2 });
    }
    
    addGateExit(x: number, y: number, angle: number) {
        if (!this.effects) this.effects = [];
        this.effects.push({ type: 'gateExit', x, y, angle, life: 0.5, maxLife: 0.5 });
    }
    
    addRTSFeedback(x: number, y: number, color: string, text: string) {
        if (!this.effects) this.effects = [];
        this.effects.push({ type: 'rtsFeedback', x, y, color, text, life: 1.0, maxLife: 1.0 });
    }
}
