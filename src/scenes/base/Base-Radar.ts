// @ts-nocheck
import { ShipManager } from '../../managers/ShipManager.js';
import { WorldbookManager } from '../WorldbookManager.js';
import { PlayerManager } from '../../managers/PlayerManager.js';
import { initAsteroidsForSector, updateAsteroids } from './Base-Asteroid.js';
import { BuildingManager } from '../../managers/BuildingManager.js';
import { getAffinity } from '../Base.js';
import { checkDroneSurvival } from './Base-WuRenJi.js';
import { processAILogic } from './Base-AI.js';
import { checkDockingGuidance } from './Base-Docking.js';
import { GameConfig } from '../../config.js';
import { AffinityManager } from '../../managers/AffinityManager.js';
import { processBuildingBeamHit } from './Base-Building.js';

export function updateSystemRadar(scene: any, time: number, delta: number) {
    scene.systemMapOrbitTime += delta * 0.000015; 
    const dt = Math.min(delta / 1000, 0.1);

    // 删除了对旧系统 DOM container 的依赖，允许在 React 重构后也能驱动核心物理循环
    // 获取视角状态
    let currentRealSector = localStorage.getItem('current_sector');
    const viewingSector = scene.viewingSector || currentRealSector;

    // --- 多星区并行仿真调度 (全宇宙物理大一统) ---
    const allShipSectors = new Set<string>();
    ShipManager.ships.forEach(s => {
        if (s.location && s.location.sector) {
            allShipSectors.add(s.location.sector);
        }
    });
    const activeSectors = Array.from(allShipSectors);
    if (currentRealSector && !activeSectors.includes(currentRealSector)) activeSectors.push(currentRealSector);
    if (viewingSector && !activeSectors.includes(viewingSector)) activeSectors.push(viewingSector);
    
    // 1. 告知 ShipManager
    ShipManager.setActiveSectors(activeSectors);

    // 2. 清理
    Object.keys(scene.sectorSimulations).forEach(sec => {
        if (!activeSectors.includes(sec)) delete scene.sectorSimulations[sec];
    });

    // 3. 遍历活跃星区
    activeSectors.forEach(simSectorName => {
        const currentSectorPd = PlayerManager.getStats();
        const isRendering = (simSectorName === viewingSector);
        const isLocal = (simSectorName === currentRealSector);
        
        // 初始化仿真数据
        if (!scene.sectorSimulations[simSectorName]) {
            scene.sectorSimulations[simSectorName] = { 
                defenders: [], attackers: [], projectiles: [], missiles: []
            };
        }
        
        // 上下文切换
        scene.radarEntities = scene.sectorSimulations[simSectorName];

        // 伪装变量以便复用旧逻辑
        const targetSectorName = simSectorName;
        // isRemote 在物理层面上不再重要，因为我们只在 activeSectors 里跑
        // 但为了兼容旧代码的渲染判断（虽然我们会用 isRendering 覆盖它）
        const isRemote = !isLocal; 

        const worldState = WorldbookManager.getWorldState();
        const sector = worldState.sectors.find(s => s.name === simSectorName); 
        if (!sector) return;
        
        // --- 初始化小行星 ---
        initAsteroidsForSector(simSectorName, worldState, scene.sectorSimulations);

        // [新增修复] 将保存在 WorldState 里的空间站数据灌入当前的 BuildingManager
        // 关键点：BuildingManager.stationModules 是全局单例，如果我们当前在计算一个后台星区（isRendering = false）
        // 那我们绝不能把后台星区的空间站塞进内存！只应该在渲染主星区时进行赋值！
        if (isRendering) {
            BuildingManager.loadFromWorldState(worldState, simSectorName);
        }

        // [重构：完全同步、绝对无状态污染的星门计算]
        // 动态计算当前活跃星区的所有星门物理位置
        const simGates = {};
        const lanes = WorldbookManager.getStarlanes(worldState.sectors);
        lanes.forEach(l => {
            let adj = null;
            if (l.s1.name === sector.name) adj = l.s2;
            else if (l.s2.name === sector.name) adj = l.s1;
            if (adj) {
                // 确保新坐标系下星门生成的缩放是正确的
                // 如果需要改变星图坐标到星系坐标的映射系数，可以在这里调整
                const angle = Math.atan2(adj.y - sector.y, adj.x - sector.x);
                simGates[adj.name] = { 
                    x: 500 + Math.cos(angle) * 45000, 
                    y: 275 + Math.sin(angle) * 45000,
                    angle: angle
                };
            }
        });
        
        // 将星门数据存入仿真容器，供当前循环其他逻辑取用
        scene.sectorSimulations[simSectorName].gates = simGates;

        // 获取真实的玩家微观实体，用作后续操作的基准
        const realPlayerEntForFrame = [...(scene.radarEntities.defenders || []), ...(scene.radarEntities.attackers || [])].find(e => e.id === currentSectorPd.playerShipId);

        // 视角平移逻辑 (仅渲染时生效)
        if (isRendering) {
            if (isRemote) {
                scene.radarPanX = 500;
                scene.radarPanY = 275;
            } else {
                if (realPlayerEntForFrame) {
                    scene.radarPanX = realPlayerEntForFrame.x;
                    scene.radarPanY = realPlayerEntForFrame.y;
                }
            }
        }

        // 动态更新天体位置（遗留清理：目前所有目标统一指向星区中心）
        const cx = 500;
        const cy = 275;
        
        let defenseX = cx; 
        let defenseY = cy;
        let planetX = cx;
        let planetY = cy;

        let activeNodes = [];

        // 读取导航目标，确保微观层能够动态刷新星门颜色
        let navTarget = localStorage.getItem('nav_target_sector');
        let nextStepName = null;
        
        // 获取玩家真正的实体（不再是特权对象，而是从防卫者/攻击者中找）
        const realPlayerEnt = realPlayerEntForFrame;

        // 1. 如果玩家实体的船有明确的 targetGate (最高优先级)
        if (realPlayerEnt && realPlayerEnt.shipRef && realPlayerEnt.shipRef.targetGate) {
            nextStepName = realPlayerEnt.shipRef.targetGate;
        } 
        // 2. 如果玩家飞船没数据，但是存了 nav_target_sector，则重新算一次路
        else if (navTarget && navTarget !== currentRealSector) {
            const endNode = worldState.sectors.find(s => s.name === navTarget);
            if (endNode) {
                const path = WorldbookManager.getStarlanePath(sector, endNode, worldState.sectors);
                if (path && path.length > 1) {
                    nextStepName = path[1].name;
                }
            }
        }
        
        // 如果已经抵达了目标星区，清理导航状态
        if (navTarget === currentRealSector) {
            localStorage.removeItem('nav_target_sector');
            localStorage.removeItem('nav_path');
            nextStepName = null;
            if (realPlayerEnt && realPlayerEnt.shipRef && realPlayerEnt.shipRef.state === 'DEPARTURE') {
                realPlayerEnt.shipRef.state = 'IDLE';
                realPlayerEnt.shipRef.targetGate = null;
                realPlayerEnt.shipRef.path = [];
            }
        }

        let activeGates = [];
        for (const [gateName, gatePos] of Object.entries(simGates)) {
            activeGates.push({
                name: gateName,
                x: gatePos.x,
                y: gatePos.y,
                isNavTarget: gateName === nextStepName
            });
        }

        scene.sectorSimulations[simSectorName].nodes = activeNodes;
        scene.sectorSimulations[simSectorName].gatesArray = activeGates;

        // 确定造船地点：统一使用行星坐标或预设坐标
        let constructionX = planetX;
        let constructionY = planetY;

        // ----------------------------------------------------
        // 核心：处理 RTS 实体逻辑 (AI、寻路、战斗)
        // ----------------------------------------------------

        // 播放延迟的星门特效 (Phaser 层面直接渲染，无需依赖 DOM)
        if (scene.pendingArrivalEffect) {
            scene.createGateExitEffect(null, scene.pendingArrivalEffect.x, scene.pendingArrivalEffect.y, scene.pendingArrivalEffect.angle);
            scene.pendingArrivalEffect = null;
        }

        // ==========================================
        // 【第一阶段：活跃星区物理与AI后台演算】
        // 依次对玩家所在星区以及正在监视的异地星区执行物理演算
        // ==========================================
        const localShips = ShipManager.getShipsInSector(simSectorName);
        
        const newAttackers = [];
        const newDefenders = [];
        
        // --- 核心修复：追踪已处理的船只 ID，杜绝重复创建 ---
        const processedShipIds = new Set();
        
        localShips.forEach(ship => {
            if (ship.stats.hp <= 0 && !ship.isBuilding) return; // 忽略已死亡但尚未被 ShipManager 清理的飞船，防止诈尸

            // [核心防御] 防止幽灵船：跳过正在跃迁状态异常的船，防止它们强行挤进物理层
            // 注意：移除了 ship.dockedAt 的拦截，允许已停泊的飞船继续进入微观渲染层显示在泊位上
            if (ship.state === 'WARP') return;

            // [终极防御] 拦截同一个宏观实体因为某种原因被 forEach 塞两次
            if (processedShipIds.has(String(ship.id))) return;
            processedShipIds.add(String(ship.id));

            // [重构核心：众生平等]
            // 彻底删除针对玩家实体的拦截。玩家的飞船同样会被正常分配为一个普通的微观实体，存放在 attackers/defenders 数组中。
            // 只是如果 String(ship.id) === String(pd.playerShipId)，稍后在 updateShipEntity 内部它会受到鼠标键盘控制。

            // [重构] 统合判定：无论是玩家资产还是NPC，只要它被明确编入了舰队，或是玩家的私有资产，才算作可执行编队战术的单位
            let isActiveWingman = false;
            const fleet = ShipManager.getFleetByShipId(ship.id);
            if (fleet || ship.ownerId === 'player') {
                isActiveWingman = true;
            }

            // 将宏观 Ship 数据映射到微观雷达实体
            let entity = scene.radarEntities.attackers.find(e => e.id === ship.id) || 
                         scene.radarEntities.defenders.find(e => e.id === ship.id);
            
            if (!entity) {
                let spawnX = ship.location.x;
                let spawnY = ship.location.y;

                // 如果没有微观坐标（或者为初始值 0,0），为其分配初始出生点
                let initVx = 0;
                let initVy = 0;

                if (!spawnX && !spawnY) {
                    // [重构] 统合处理：所有刚到达本星区的飞船（无论玩家还是AI），都应从入口星门出生
                    // 由于玩家由于重启场景可能变成了 IDLE 丢失状态，但我们可以通过 localStorage 判断是不是刚过门
                    const arrivedFromGate = localStorage.getItem('arrived_from_gate');
                    const isPlayerJustArrived = (ship.ownerId === 'player' && ship.id === currentSectorPd.playerShipId && arrivedFromGate && simGates[arrivedFromGate]);

                    if (ship.state === 'ARRIVAL' || ship.state === 'TRANSIT' || isPlayerJustArrived) {
                        const targetGateStr = isPlayerJustArrived ? arrivedFromGate : ship.transitFromGate;
                        
                        if (simGates[targetGateStr]) {
                            const gate = simGates[targetGateStr];
                            spawnX = gate.x;
                            spawnY = gate.y;
                            
                            // [星门吐出物理] 赋予指向星系中心的初速度，模拟从虫洞喷射而出
                            const angleToCenter = Math.atan2(275 - spawnY, 500 - spawnX);
                            
                            // [修复] 向中心推进 1500 像素，防止立刻再次触碰星门触发死循环跃迁
                            spawnX += Math.cos(angleToCenter) * 1500;
                            spawnY += Math.sin(angleToCenter) * 1500;

                            initVx = Math.cos(angleToCenter) * 1000;
                            initVy = Math.sin(angleToCenter) * 1000;
                            
                            // 针对玩家特别调整初始视角，并在事后清理缓存
                            if (isPlayerJustArrived) {
                                ship.rotation = angleToCenter * 180 / Math.PI;
                                scene.pendingArrivalEffect = { x: gate.x, y: gate.y, angle: angleToCenter };
                                // 清理标记防止下一次重新分配
                                localStorage.removeItem('arrived_from_gate');
                                // 马上存入雷达坐标，接管后续物理引擎的持久化
                                localStorage.setItem('player_radar_x', spawnX.toString());
                                localStorage.setItem('player_radar_y', spawnY.toString());
                            } else {
                                scene.createGateExitEffect(null, spawnX, spawnY, angleToCenter);
                            }
                        }
                    } else {
                        // 真的没有坐标的本地船：随机出生点
                        spawnX = ship.type === 'freighter' ? planetX : defenseX;
                        spawnY = ship.type === 'freighter' ? planetY : defenseY;
                        spawnX += (Math.random() - 0.5) * 150;
                        spawnY += (Math.random() - 0.5) * 150;
                    }
                }

                entity = {
                    id: ship.id,
                    type: ship.type,
                    factionId: ship.factionId,
                    ownerId: ship.ownerId !== undefined ? ship.ownerId : ship.factionId,
                    parentId: ship.parentId, // [修复] 将宏观记录的母体ID传递给微观引擎，防止无人机被判定为幽灵
                    x: spawnX, 
                    y: spawnY,
                    vx: initVx, vy: initVy, rotation: ship.rotation !== undefined ? ship.rotation : 0,
                    hp: ship.stats.hp,
                    maxHp: ship.stats.maxHp,
                    color: '#33ccff', // 默认蓝色
                    target: null,
                    cooldown: 0,
                    orbitDir: Math.random() > 0.5 ? 1 : -1,
                    patrolPhase: Math.random() * Math.PI * 2,
                    hitFlash: 0,
                    behavior: (ship.type === 'freighter' && !isActiveWingman) ? 'DOCKING' : 'COMBAT',
                    isWingman: isActiveWingman,
                    superCruiseTimer: 0, 
                    isSuperCruising: false,
                    shipRef: ship // 绑定回宏观对象
                };
            }
            
            // 实时同步状态
            if (isActiveWingman) {
                entity.isWingman = true;
            }
            
            // [重构] 纯粹通过对玩家的好感度决定其在微观雷达上的颜色与攻击意图：
            // 好感度 < 0 为红色敌人（放入 attackers）
            // 好感度 >= 0 为蓝色友军/中立（放入 defenders）
            let isHostile = false;
            
            // [重构] 因为玩家可能是一个普通的 entity 混在数组里，我们在组装阶段不再直接依赖 scene.radarEntities.player
            // 先尝试从现有的 entity 池中找出玩家，或者如果玩家不在场就用兜底逻辑
            let localPlayerEnt = null;
            if (currentSectorPd.playerShipId) {
                localPlayerEnt = scene.radarEntities.defenders.find(e => String(e.id) === String(currentSectorPd.playerShipId)) ||
                                 scene.radarEntities.attackers.find(e => String(e.id) === String(currentSectorPd.playerShipId));
            }

            if (localPlayerEnt && String(entity.id) !== String(currentSectorPd.playerShipId)) {
                if (getAffinity(entity, localPlayerEnt) < 0) {
                    isHostile = true;
                }
            } else {
                // 如果是玩家自己，或者是玩家不在场的异地模拟，根据阵营判定
                if (String(entity.id) === String(currentSectorPd.playerShipId)) {
                    isHostile = false; // 玩家永远是自己眼里的防卫者(蓝名)
                } else {
                    const shipOwnerId = ship.ownerId !== undefined ? ship.ownerId : ship.factionId;
                    if (shipOwnerId === 3) {
                        isHostile = true; // 海盗
                    } else if (ship.type !== 'freighter' && shipOwnerId !== 0 && shipOwnerId !== 'player' && shipOwnerId !== sector.factionId) {
                        isHostile = true; // 跨界战机
                    }
                }
            }
            
            // 【最核心】：将颜色强制指定为红/蓝二元
            entity.color = isHostile ? '#ff3333' : '#33ccff';
            
            if (isHostile) {
                newAttackers.push(entity);
            } else {
                newDefenders.push(entity);
            }
        });
        
        // 替换为新帧的列表，保留了已有实体的引用，自动清理了跃迁离开或被彻底摧毁的实体
        // [修复] 在这里强制过滤掉可能混入的 null、undefined 或者重复引用的死对象
        scene.radarEntities.attackers = [...new Map(newAttackers.filter(e => e && e.id).map(e => [e.id, e])).values()];
        scene.radarEntities.defenders = [...new Map(newDefenders.filter(e => e && e.id).map(e => [e.id, e])).values()];

        // --- 0. 玩家星门检测逻辑 ---
        if (realPlayerEnt) {
            // [重构] 使用通用星门检测函数
            if (!scene.isJumping) {
                scene.tryEnterStargate(realPlayerEnt, true, null);
            }
        }

        // 收集要传递给渲染层的高级指挥线数据
        const renderCommandLines = [];
        
        // 临时保存在当前循环外层的变量，以便在下面的 [收尾] 阶段使用
        if (!scene._tempCommandLines) scene._tempCommandLines = [];

        // 2. 实体物理与 AI 更新循环
        const allFighters = [...scene.radarEntities.defenders, ...scene.radarEntities.attackers];

        // 工具函数：基于动态好感度公式的真实阵营索敌
        const findTarget = (entity, allShipsList) => {
            let closest = null;
            let minDist = Infinity;
            
            allShipsList.forEach(other => {
                if (other.hp > 0 && other.id !== entity.id) {
                    // 统一使用全局好感度公式，动态读取 A 对 B 的记忆
                    const aff = getAffinity(entity, other);
                    
                    // 判断是否为敌人
                    let isEnemy = false;
                    
                    if (other.type === 'freighter') {
                        // 对方是商船：海盗默认 -50，直接开火。普通人默认 +50，受击十次 (-100) 才会变 -50 开火
                        if (aff <= -50) isEnemy = true;
                    } else {
                        // 对方是战机/玩家：只要关系为负 (<0) 就会主动开火
                        if (aff < 0) isEnemy = true;
                    }
                    
                    if (isEnemy) {
                        const d = Math.hypot(other.x - entity.x, other.y - entity.y);
                        // 优先打近的
                        if (d < minDist) { 
                            minDist = d; 
                            closest = other; 
                        }
                    }
                }
            });
            return closest;
        };

        // ==========================================
        // 【核心大一统】：统一的实体物理与开火演算函数
        // ==========================================
        const updateShipEntity = (ent, allShipsList) => {
            const pd = PlayerManager.getStats();
            // [核心修复] 底层区块同步防误杀机制：防止坐标异常或星区错位导致无辜舰船被强制销毁
            // 严格排除玩家母舰，并确保 location.sector 存在时才进行跨区比对
            if (isNaN(ent.x) || isNaN(ent.y) || (ent.id !== pd.playerShipId && ent.shipRef && ent.shipRef.location && ent.shipRef.location.sector && ent.shipRef.location.sector !== simSectorName)) {
                ent.isSafeRemoved = true; // 赋予绝对安全脱离标识
                return false; // 中断物理演算，交由外层静默回收
            }

            // [新增] 无人机存活检查：必须有 parentId，且父实体必须存活于当前星区，否则2秒后自毁
            if (ent.type === 'drone') {
                if (!checkDroneSurvival(ent, allShipsList, scene.sectorSimulations[simSectorName]?.asteroids)) {
                    if (ent.droneDieTimer === undefined) {
                        ent.droneDieTimer = 2.0;
                    }
                    ent.droneDieTimer -= dt;
                    if (ent.droneDieTimer <= 0) {
                        ent.hp = 0;
                        return false;
                    }
                } else {
                    ent.droneDieTimer = undefined;
                }
            }

            // [玩家控制解耦标识]
            const isPlayerControlled = (ent.id === pd.playerShipId || ent.isHijacked);

            // [核心修复] AI 目标校验：防止对着已跃迁离开的“幽灵目标”开火
            if (ent.target) {
                // 检查目标对象是否仍然存在于当前的物理实体列表中
                const isTargetStillHere = allShipsList.some(t => t.id === ent.target.id);
                if (!isTargetStillHere) {
                    ent.target = null; // 目标已不在当前星区（可能跃迁走了），丢失锁定
                }
            }

            // 更新炮塔的默认闲置动画
            if (ent.shipRef && ent.shipRef.activeWeapons) {
                ent.shipRef.activeWeapons.forEach(wep => {
                    if (wep.isTurret) {
                        if (wep.idlePhase === undefined) wep.idlePhase = Math.random() * Math.PI * 2;
                        wep.idlePhase += dt * 1.5;
                        wep.rotation = ent.rotation + Math.sin(wep.idlePhase) * 40;
                    } else {
                        wep.rotation = ent.rotation;
                    }
                });
            }

            let moveTarget = null;
            let lookTarget = null;
            
            // [重构] 获取飞船的真实物理推力与质量
            const thrust = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.thrust) ? ent.shipRef.stats.thrust : 0;
            const turnThrust = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.turnThrust) ? ent.shipRef.stats.turnThrust : 0;
            const mass = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.mass) ? ent.shipRef.stats.mass : (ent.type === 'freighter' ? 80 : 10);
            const drag = (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.drag) ? ent.shipRef.stats.drag : 0.15;

            // F = ma -> a = F/m (如果没有引擎，加速度就是0，飞船将无法移动)
            let baseAccel = mass > 0 ? (thrust / mass) : 0;
            let thrustMultiplier = 1.0; // 替代原来的 thrustSpeed 被直接赋值的情况
            
            // 理论基础极速上限计算 (防止退出巡航后保持极高速度滑行)
            // v = a * dt / (1 - drag^dt) 是个粗略极限，我们简化用常数来规范化
            // 常规引擎在 drag 0.98 下大概能跑到 500-1500 左右，这里给出一个动态截断值
            const baseMaxSpeed = Math.max(300, (baseAccel / 2)); 
            
            let targetDx = 0;
            let targetDy = 0;
            
            // 记录当前帧之前是否处于巡航状态
            const wasSuperCruising = ent.isSuperCruising === true;

            if (isPlayerControlled) {
                const isModalsOpen = () => {
                    if (!scene.input.keyboard.enabled) return true;
                    const textModal = scene.contentDOM?.node?.querySelector('#text-adventure-modal');
                    if (textModal && textModal.style.display !== 'none') return true;
                    const overlay = scene.contentDOM?.node?.querySelector('#modals-overlay');
                    if (overlay && overlay.style.display !== 'none') return true;
                    return false;
                };

                const isFlightInputAllowed = () => {
                    if (isModalsOpen()) return false;
                    // [Fix] 进站后不允许玩家鼠标/键盘控制
                    if (ent.isAutoDocking || ent.isDocked || (ent.shipRef && ent.shipRef.state === 'DOCKED')) return false;
                    return true;
                };

                // ------ 玩家的控制器输入与自动驾驶 ------
                if (ent.id === pd.playerShipId && scene.playerAutoPilot) {
                    const ap = scene.playerAutoPilot;
                    let tx = ap.x;
                    let ty = ap.y;
                    
                    if (scene.radarEntities && scene.radarEntities.nodes) {
                        const targetNode = scene.radarEntities.nodes.find(n => n.id === ap.target);
                        if (targetNode) {
                            tx = targetNode.x;
                            ty = targetNode.y;
                        }
                    }

                    const dx = tx - ent.x;
                    const dy = ty - ent.y;
                    const dist = Math.hypot(dx, dy);
                    
                    if (dist < 150) { 
                        scene.playerAutoPilot = null;
                        const pd = PlayerManager.getStats();
                        ShipManager.dockShip(pd.playerShipId, ap.target);
                        ent.isDocked = true; 
                        scene.activeSystemNode = ap.target;
                        
                        return false;
                    } else {
                        lookTarget = { x: tx, y: ty };
                        const rad = (ent.rotation || 0) * Math.PI / 180;
                        targetDx = Math.cos(rad);
                        targetDy = Math.sin(rad);
                        ent.isFiring = false;
                    }
                } else if (!isModalsOpen() && (ent.isAutoDocking || ent.isDocked || (ent.shipRef && ent.shipRef.state === 'DOCKED'))) {
                    // --- 长按前进键出库逻辑 ---
                    if (scene.playerKeys.w.isDown) {
                        if (ent.undockHoldTimer === undefined) ent.undockHoldTimer = 0;
                        ent.undockHoldTimer += dt;
                        
                        if (ent.undockHoldTimer >= 1.0) {
                            ent.isDocked = false;
                            ent.isAutoDocking = false;
                            if (ent.shipRef) {
                                ent.shipRef.state = 'IDLE';
                                ent.shipRef.dockedAt = null;
                            }
                            ShipManager.undockShip(ent.id, { x: ent.x, y: ent.y, sector: simSectorName });
                            
                            // 给予一个向前的初始速度，模拟引擎弹射出库
                            const rad = (ent.rotation || 0) * Math.PI / 180;
                            ent.vx = Math.cos(rad) * 300;
                            ent.vy = Math.sin(rad) * 300;
                            
                            ent.undockHoldTimer = 0;
                        }
                    } else {
                        ent.undockHoldTimer = 0;
                    }
                } else if (isFlightInputAllowed()) {
                    let moveForward = 0;
                    let moveRight = 0;

                    if (scene.playerKeys.w.isDown) moveForward += 1;
                    if (scene.playerKeys.s.isDown) moveForward -= 1;
                    if (scene.playerKeys.a.isDown) moveRight -= 1;
                    if (scene.playerKeys.d.isDown) moveRight += 1;

                    // 仅使用空格键进行开火判定
                    if (scene.playerKeys.space.isDown) {
                        ent.isFiring = true;
                    } else {
                        ent.isFiring = false;
                    }

                    // 空间巡航状态重置与打断检测 (移至 Shift 键)
                    if (!scene.playerKeys.shift.isDown) {
                        ent.superCruiseTimer = 0;
                        ent.isSuperCruising = false;
                        ent.spaceInterrupted = false;
                    }
                    // 进行其他操作（开火 或 按 S 倒车刹车）则立刻取消巡航
                    if (ent.isFiring || scene.playerKeys.s.isDown) {
                        ent.spaceInterrupted = true;
                    }

                    // 冲刺与巡航系统接管
                    if (scene.playerKeys.ctrl && scene.playerKeys.ctrl.isDown) {
                        // 玩家按住 Ctrl 逐渐降速到0
                        ent.vx *= Math.pow(0.92, dt * 60);
                        ent.vy *= Math.pow(0.92, dt * 60);
                        moveForward = 0;
                        moveRight = 0;
                        scene.playerAutoPilot = null;
                        ent.superCruiseTimer = 0;
                        ent.isSuperCruising = false;
                        ent.spaceInterrupted = true;
                    } else if (scene.playerKeys.tab.isDown) {
                        // TAB 盾冲：强制一直向前冲，推力直接翻 4 倍
                        thrustMultiplier = 4.0;
                        moveForward = 1;
                        moveRight = 0;
                        scene.playerAutoPilot = null;
                    } else if (scene.playerKeys.shift.isDown && !ent.spaceInterrupted) {
                        // SHIFT 巡航检测与重置
                        if (ent.superCruiseTimer === undefined) ent.superCruiseTimer = 0;
                        
                        // [新增机制] 如果在巡航充能或飞行期间，机头转向角速度过大（或者偏离了原本正在前进的方向）
                        // 说明玩家正在进行剧烈机动，必须强制中断巡航进入停滞
                        const isTurningHard = scene.playerKeys.q.isDown || scene.playerKeys.e.isDown || (scene.sysMouseX !== 0 && scene.sysMouseY !== 0 && ent.isSuperCruising && Math.abs(ent.rotation - (ent.lastCruiseAngle || ent.rotation)) > 20);

                        if (isTurningHard && ent.isSuperCruising) {
                            ent.spaceInterrupted = true;
                            ent.superCruiseTimer = 0;
                            ent.isSuperCruising = false;
                        } else {
                            ent.superCruiseTimer += dt;
                            scene.playerAutoPilot = null;

                            if (ent.superCruiseTimer >= 3.0) {
                                // 超过 3 秒后，强制向前冲，并从 3.0 倍起步，每秒增加 1.0 倍推力，直至最高 6.0 倍
                                ent.isSuperCruising = true;
                                ent.lastCruiseAngle = ent.rotation; // 记录巡航时的锁定朝向
                                moveForward = 1;
                                moveRight = 0;
                                thrustMultiplier = Math.min(6.0, 3.0 + (ent.superCruiseTimer - 3.0) * 1.0);
                            } else {
                                // [预热阶段] 原地蓄力，不能移动，但可以缓慢转向
                                moveForward = 0;
                                moveRight = 0;
                                thrustMultiplier = 0.0; 
                            }
                        }
                    }

                    // 真实物理转向速度计算：由引擎转向推力除以质量决定
                    // [新设定] 转向推力需求提升为移动的 3 倍，等效于同样的转向推力提供的角速度减小到 1/3
                    let pTurnRate = mass > 0 ? (turnThrust / mass) / 3 : 0;
                    // 如果船体没装引擎或者转不动，给个极小值防卡死，但如果是0就彻底无法控制
                    if (pTurnRate === 0 && thrust === 0) pTurnRate = 0; // 完全瘫痪
                    else if (pTurnRate < 10) pTurnRate = 10; // 保底微弱转向 (同比例下调)
                    
                    pTurnRate *= 1.2; // 玩家专属灵活性加成

                    // [Fix] 进站后鼠标自动跟随彻底禁用，只能在 isFlightInputAllowed 里拦截了
                    // 为了以防万一，如果处于吸附或停泊状态，彻底跳过转向计算
                    if (!ent.isAutoDocking && !ent.isDocked && !(ent.shipRef && ent.shipRef.state === 'DOCKED')) {
                        if (scene.playerKeys.q.isDown) {
                            ent.rotation -= pTurnRate * dt;
                        } else if (scene.playerKeys.e.isDown) {
                            ent.rotation += pTurnRate * dt;
                        } else {
                            // 鼠标自动跟随
                            // 摒弃容易出错的手动屏幕比例映射，直接使用 Phaser 底层渲染场景相机的 getWorldPoint 进行绝对精确转换
                            if (scene.sysMouseX !== 0 || scene.sysMouseY !== 0) {
                                const radarScene = scene.scene.get('RadarScene');
                                if (radarScene && radarScene.cameras && radarScene.cameras.main && scene.sys.game.canvas) {
                                    // 1. 将系统级窗口鼠标坐标 (sysMouseX/Y) 减去 Canvas 本身的 CSS 偏移，得到 Canvas DOM 内的像素坐标 (clientX/Y)
                                    const rect = scene.sys.game.canvas.getBoundingClientRect();
                                    const canvasX = scene.sysMouseX - rect.left;
                                    const canvasY = scene.sysMouseY - rect.top;

                                    // 2. 检查鼠标是否在 Canvas 范围内 (稍微扩大一点容差也行)，如果在范围内才转换并跟随
                                    // 这样即使因为 DOM 遮挡 Phaser 收不到 pointer 移动，我们依然能完美计算
                                    const worldPoint = radarScene.cameras.main.getWorldPoint(canvasX, canvasY);
                                    
                                    const mouseWorldX = worldPoint.x;
                                    const mouseWorldY = worldPoint.y;

                                    let targetAngle = Math.atan2(mouseWorldY - ent.y, mouseWorldX - ent.x) * 180 / Math.PI;
                                    let angleDiff = targetAngle - ent.rotation;
                                    angleDiff = ((angleDiff + 180) % 360 + 360) % 360 - 180;
                                    
                                    if (Math.abs(angleDiff) < pTurnRate * dt) {
                                        ent.rotation = targetAngle;
                                    } else {
                                        ent.rotation += Math.sign(angleDiff) * pTurnRate * dt;
                                    }
                                }
                            }
                        }
                    }
                    
                    ent.rotation = ((ent.rotation + 180) % 360 + 360) % 360 - 180;

                    if (moveForward !== 0 || moveRight !== 0) {
                        const rad = (ent.rotation || 0) * Math.PI / 180;
                        targetDx = moveForward * Math.cos(rad) + moveRight * Math.cos(rad + Math.PI / 2);
                        targetDy = moveForward * Math.sin(rad) + moveRight * Math.sin(rad + Math.PI / 2);
                        
                        const len = Math.hypot(targetDx, targetDy);
                        if (len > 0) {
                            targetDx /= len;
                            targetDy /= len;
                        }
                        scene.playerAutoPilot = null;
                    }
                }

                // 强制边界限制，防止玩家跑出外太空
                ent.x = Math.max(-75000, Math.min(76000, ent.x));
                ent.y = Math.max(-75000, Math.min(76000, ent.y));
            }

            if (!isPlayerControlled) {
                // ------ 调用通用 AI 行为逻辑 ------
                const aiResult = processAILogic(ent, allShipsList, dt, {
                    simGates,
                    simSectorName,
                    planetX,
                    planetY,
                    defenseX,
                    defenseY,
                    baseMaxSpeed,
                    pd,
                    worldState,
                    systemMapOrbitTime: scene.systemMapOrbitTime
                });

                if (aiResult.action === 'tryEnterStargate') {
                    if (scene.tryEnterStargate(ent, false, null)) return false;
                } else if (aiResult.action === 'dock') {
                    return false;
                }

                moveTarget = aiResult.moveTarget;
                lookTarget = aiResult.lookTarget;
                thrustMultiplier = aiResult.thrustMultiplier;
                targetDx = aiResult.targetDx;
                targetDy = aiResult.targetDy;
            }

            // ==========================================
            // 【停泊吸附判定系统 (通用)】
            // ==========================================
            // checkDockingGuidance 会修改 ent.isDocked 为 true
            checkDockingGuidance(ent);
            
            // 如果处于自动吸附接管状态或已经彻底吸附，则跳过后续的所有玩家输入/AI行为执行，直接结束本实体的物理逻辑刷新
            if (ent.isAutoDocking || ent.isDocked) {
                if (ent.isDocked) {
                    ent.vx = 0;
                    ent.vy = 0;
                }
                // 但保留碰撞体积、渲染和基础位移应用
                ent.x += ent.vx * dt;
                ent.y += ent.vy * dt;
                
                // [更新] 返回 true，告诉外层循环：“我还活着，我要留在场景里，请渲染我！”
                return true; 
            }

            // ==========================================
            // 【指挥线 (Command Line) 数据收集逻辑】
            // ==========================================
            // [新增] 只给玩家拥有的实体（或者玩家舰队里的实体）绘制指挥线，不再给 AI 绘制
            const shouldRenderLine = isPlayerControlled || ent.ownerId === 'player';
            if (ent.shipRef && isRendering && shouldRenderLine) {
                let cmdType = null;
                let cmdTargetNode = null;
                let cmdTargetPos = null;
                let isDashed = false;
                const isSelected = scene.selectedUnitIds.includes(ent.id);

                // 1. 如果有明确的攻击指令或正在追击目标
                if (ent.shipRef.commandState === 'ATTACK_TARGET' && ent.shipRef.commandTargetId) {
                    cmdType = 'ATTACK';
                    const enemy = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
                    if (enemy) {
                        cmdTargetPos = { x: enemy.x, y: enemy.y };
                    }
                } 
                else if (ent.shipRef.commandState === 'DEFEND' && ent.shipRef.commandTargetId) {
                    cmdType = 'DEFEND';
                    const guardTarget = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
                    if (guardTarget) {
                        cmdTargetPos = { x: guardTarget.x, y: guardTarget.y };
                    }
                }
                else if (ent.shipRef.commandState === 'FOLLOW' && ent.shipRef.commandTargetId) {
                    cmdType = 'FOLLOW';
                    const followTarget = allShipsList.find(t => t.id === ent.shipRef.commandTargetId);
                    if (followTarget) {
                        cmdTargetPos = { x: followTarget.x, y: followTarget.y };
                    }
                }
                else if (ent.shipRef.commandState === 'MOVE_TO' && ent.shipRef.moveTarget) {
                    cmdType = 'MOVE';
                    // 如果跨星系赶路中，目标点可能没到，但这里优先取 moveTarget 作为本星系的最终目标
                    if (ent.shipRef.location.sector === simSectorName) {
                        cmdTargetPos = { x: ent.shipRef.moveTarget.x, y: ent.shipRef.moveTarget.y };
                    }
                }
                else if (ent.shipRef.commandState === 'MINING' && ent.miningTargetPos) {
                    cmdType = 'MINE';
                    cmdTargetPos = { x: ent.miningTargetPos.x, y: ent.miningTargetPos.y };
                }
                else if (ent.shipRef.state === 'DEPARTURE' || ent.shipRef.state === 'TRANSIT') {
                    cmdType = 'MOVE';
                }

                // 2. 计算跨星系的路径映射
                if (cmdType) {
                    let cStartX = ent.x;
                    let cStartY = ent.y;
                    let cEndX = null;
                    let cEndY = null;

                    // 飞船在当前渲染的星区
                    if (ent.shipRef.location.sector === simSectorName) {
                        if (ent.shipRef.state === 'DEPARTURE' || ent.shipRef.state === 'TRANSIT') {
                            // 正在离开或穿过本星区，连线到出口星门
                            const targetGateName = ent.shipRef.state === 'DEPARTURE' ? ent.shipRef.targetGate : ent.shipRef.transitToGate;
                            const gatePos = simGates[targetGateName];
                            if (gatePos) {
                                cEndX = gatePos.x;
                                cEndY = gatePos.y;
                            }
                        } else if (cmdTargetPos) {
                            // 在本星区内的目标
                            cEndX = cmdTargetPos.x;
                            cEndY = cmdTargetPos.y;
                        }
                    } 
                    // 飞船不在当前渲染的星区，但它的路径经过这里
                    else if (ent.shipRef.path && ent.shipRef.path.length > 0) {
                        // 寻找当前星区在它的 path 中的位置
                        const pathIndex = ent.shipRef.path.indexOf(simSectorName);
                        if (pathIndex !== -1 || ent.shipRef.location.sector !== simSectorName) {
                            // 需要找到它从哪个门进来，从哪个门出去
                            
                            // 默认使用它当前的 moveTarget 作为终点兜底（如果已经到站了）
                            if (cmdTargetPos && ent.shipRef.path[ent.shipRef.path.length - 1] === simSectorName) {
                                cEndX = cmdTargetPos.x;
                                cEndY = cmdTargetPos.y;
                            }

                            // 尝试找到它进入本星区的门 (它前一个目标星系的名字，或者是它当前所在的星系)
                            let entryGateName = null;
                            if (pathIndex > 0) {
                                entryGateName = ent.shipRef.path[pathIndex - 1];
                            } else if (pathIndex === 0) {
                                entryGateName = ent.shipRef.location.sector;
                            } else if (ent.shipRef.path.length > 0 && ent.shipRef.targetGate === simSectorName) {
                                // 正在前往本星区
                                entryGateName = ent.shipRef.location.sector;
                            }

                            // 尝试找到它离开本星区的门 (它下一个目标星系)
                            let exitGateName = null;
                            if (pathIndex !== -1 && pathIndex < ent.shipRef.path.length - 1) {
                                exitGateName = ent.shipRef.path[pathIndex + 1];
                            }

                            if (entryGateName && simGates[entryGateName]) {
                                cStartX = simGates[entryGateName].x;
                                cStartY = simGates[entryGateName].y;
                                isDashed = true; // 跨星区投影用虚线
                            }

                            if (exitGateName && simGates[exitGateName]) {
                                cEndX = simGates[exitGateName].x;
                                cEndY = simGates[exitGateName].y;
                                isDashed = true;
                            }
                        }
                    }

                    if (cEndX !== null && cEndY !== null) {
                        renderCommandLines.push({
                            shipId: ent.id,
                            startX: cStartX,
                            startY: cStartY,
                            endX: cEndX,
                            endY: cEndY,
                            type: cmdType,
                            isDashed: isDashed,
                            isSelected: isSelected,
                            colorHex: ent.color
                        });
                    }
                }
            }

            // ==========================================
            // 【多炮塔独立开火重构】：无论玩家还是AI都走这里
            // ==========================================
            if (ent.shipRef && ent.shipRef.activeWeapons && ent.shipRef.activeWeapons.length > 0) {
                ent.shipRef.activeWeapons.forEach(wep => {
                    if (wep.cooldown > 0) wep.cooldown -= dt;
                    
                    const rad = ent.rotation * Math.PI / 180;
                    const wepAbsoluteX = ent.x + (wep.x * Math.cos(rad) - wep.y * Math.sin(rad));
                    const wepAbsoluteY = ent.y + (wep.x * Math.sin(rad) + wep.y * Math.cos(rad));
                    
                    let wepTarget = null;
                    let shouldFire = false;

                    // 1. 根据控制者类型与武器类型决定瞄准与开火意图
                    if (wep.isTurret) {
                        if (isPlayerControlled) {
                            // 玩家炮塔：自律索敌
                            let closest = null;
                            let minDist = wep.stats.range || 250;
                            if (wep.turretRule === 'auto' || !wep.turretRule || wep.turretRule === 'defense' || wep.turretRule === 'manual') {
                                allShipsList.forEach(t => {
                                    if (t.id === ent.id) return;
                                    let valid = false;
                                    
                                    // 建造光束，只能锁定己方存活或正在建造的虚影
                                    if (wep.subType === 'builder') {
                                        if ((t.hp > 0 || (t.shipRef && t.shipRef.isBuilding)) && getAffinity(ent, t) >= 0) {
                                            if (t.shipRef && t.shipRef.isBuilding) valid = true; // 优先修虚影
                                        }
                                    } else {
                                        // 普通武器：必须是活的，且是敌人
                                        if (t.hp <= 0) return;
                                        
                                        const affToThem = getAffinity(ent, t);
                                        const affToMe = getAffinity(t, ent);
                                        
                                        if (affToThem < 0 || affToMe < 0) {
                                            if (wep.turretRule === 'manual') valid = true; // 手动模式：辅助瞄准最近敌人
                                            else if (wep.turretRule === 'auto' || !wep.turretRule) valid = true; // 自动模式：攻击任何敌人
                                            else if (wep.turretRule === 'defense' && affToMe <= -100) valid = true; // 防御模式：只打死敌
                                        }
                                    }
                                    
                                    if (valid) {
                                        const d = Math.hypot(t.x - ent.x, t.y - ent.y);
                                        if (d < minDist) { minDist = d; closest = t; }
                                    }
                                });
                            }
                            if (closest) {
                                wepTarget = closest;
                                wep.rotation = Math.atan2(wepTarget.y - wepAbsoluteY, wepTarget.x - wepAbsoluteX) * 180 / Math.PI;
                                if (wep.turretRule === 'auto' || !wep.turretRule || wep.turretRule === 'defense') shouldFire = true;
                                else if (wep.turretRule === 'manual') shouldFire = ent.isFiring;
                            }
                        } else {
                            // AI炮塔：瞄准本舰的 target
                            if (ent.target && Math.hypot(ent.target.x - ent.x, ent.target.y - ent.y) < (wep.stats.range || 200)) {
                                wepTarget = ent.target;
                                wep.rotation = Math.atan2(wepTarget.y - wepAbsoluteY, wepTarget.x - wepAbsoluteX) * 180 / Math.PI;
                                shouldFire = true;
                            }
                        }
                    } else {
                        // 主炮：永远固定向船头
                        wep.rotation = ent.rotation;
                        if (isPlayerControlled) {
                            if (ent.isFiring) shouldFire = true;
                        } else {
                            if (ent.target) {
                                const wdx = ent.target.x - wepAbsoluteX;
                                const wdy = ent.target.y - wepAbsoluteY;
                                let wepAngleToEnemy = Math.atan2(wdy, wdx) * 180 / Math.PI;
                                let angleDiff = Math.abs(((wepAngleToEnemy - ent.rotation + 180) % 360 + 360) % 360 - 180);
                                // 移除 AI 主炮开火角度限制，只要目标在射程内即开火
                                if (Math.hypot(wdx, wdy) < (wep.stats.range || 200)) {
                                    // [优化补偿] 由于删除了角度限制，为了确保主炮发射的实体弹丸能朝向目标，强制把炮口对准目标
                                    wep.rotation = wepAngleToEnemy;
                                    shouldFire = true;
                                    wepTarget = ent.target;

                                    if (ent.type === 'drone') {
                                        if (wep.cooldown <= 0) {
                                            // console.log(`[无人机 ${ent.id}] 主炮/光束开火 -> 目标[${wepTarget.id}], 距离:${Math.round(Math.hypot(wdx, wdy))}`);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 2. 根据武器的 subType 制造弹道 (或建造射线)
                    if (isPlayerControlled && scene.disabledWeaponSlots.has(wep.slotId)) {
                        shouldFire = false;
                    }

                    if (shouldFire && wep.cooldown <= 0) {
                        wep.cooldown = wep.stats.fireRate || 1.5;
                        const isLaser = (wep.subType === 'laser');
                        const isBuilder = (wep.subType === 'builder');
                        const isMissile = (wep.subType === 'missile');

                        // =====================================
                        // OOS (Out Of Sector) 静默伤害推演
                        // =====================================
                        if (!isRendering) {
                            if (wepTarget && !isBuilder) {
                                const dmg = (wep.stats && wep.stats.attack !== undefined) ? wep.stats.attack : 15;
                                const isHittingBuilding = (wepTarget.shipRef && wepTarget.shipRef.isBuilding);
                                
                                if (!isHittingBuilding) {
                                    wepTarget.hp -= dmg;
                                    if (wepTarget.shipRef) {
                                        wepTarget.shipRef.stats.hp -= dmg;
                                        wepTarget.shipRef.combatTimer = 5.0;
                                    }
                                }

                                // 记录仇恨
                                let shooter = ent;
                                if (shooter && !isHittingBuilding) {
                                    const pdForHate = PlayerManager.getStats();
                                    const amount = (ent.id === pdForHate.playerShipId && wepTarget.type === 'freighter') ? -100 : -10;
                                    AffinityManager.modifyAffinity(wepTarget, shooter, amount);
                                    
                                    if (shooter.id !== pdForHate.playerShipId) shooter.target = wepTarget;
                                }

                                if (ent.shipRef) ent.shipRef.combatTimer = 5.0;
                            } else if (wepTarget && isBuilder) {
                                // OOS 建筑光束直接生效
                                processBuildingBeamHit({ target: wepTarget, buildSpeed: (wep.stats && wep.stats.buildSpeed) ? wep.stats.buildSpeed : 2 });
                            }
                            return; // 结束当前武器 OOS 结算，跳过生成任何实体对象
                        }

                        if (isLaser || isBuilder) {
                            // 激光如果没有锁定特定目标(如玩家主炮盲射)，需要发射射线检测寻找目标
                            if (!wepTarget && !wep.isTurret) {
                                let minDist = wep.stats.range || 250;
                                allShipsList.forEach(t => {
                                    if (t.id === ent.id || t.hp <= 0) return;
                                    // 排除自己人
                                    if (isPlayerControlled && (t.isWingman || t.ownerId === 'player')) return;
                                    if (!isPlayerControlled && getAffinity(ent, t) >= 0) return;

                                    const d = Math.hypot(t.x - wepAbsoluteX, t.y - wepAbsoluteY);
                                    if (d > minDist) return;
                                    const angleToT = Math.atan2(t.y - wepAbsoluteY, t.x - wepAbsoluteX) * 180 / Math.PI;
                                    const angleDiff = Math.abs(((angleToT - wep.rotation + 180) % 360 + 360) % 360 - 180);
                                    if (angleDiff < 5 && d < minDist) { minDist = d; wepTarget = t; }
                                });
                            }

                            if (wepTarget) {
                                if (isBuilder) {
                                    // 专门制造一条瞬间且无害的建造射线，交给后面的 projectile 处理逻辑
                                    scene.radarEntities.projectiles.push({
                                        isInstant: true,
                                        isBuilderBeam: true,
                                        buildSpeed: (wep.stats && wep.stats.buildSpeed) ? wep.stats.buildSpeed : 2,
                                        x: wepAbsoluteX, y: wepAbsoluteY, target: wepTarget,
                                        sourceId: ent.id,
                                        color: (wep.stats && wep.stats.color) ? wep.stats.color : '#00ff00', 
                                        damage: 0,
                                        thickness: 3
                                    });
                                } else {
                                    scene.radarEntities.projectiles.push({
                                        isInstant: true,
                                        x: wepAbsoluteX, y: wepAbsoluteY, target: wepTarget,
                                        sourceId: ent.id,
                                        color: (wep.stats && wep.stats.color) ? wep.stats.color : '#ff0000', // 从武器属性读取
                                        damage: (wep.stats && wep.stats.attack !== undefined) ? wep.stats.attack : 15,
                                        thickness: (wep.stats && wep.stats.color === '#8a2be2') ? 10 : 2
                                    });
                                }
                            } else {
                                // 射空
                                const endX = wepAbsoluteX + Math.cos(wep.rotation * Math.PI / 180) * (wep.stats.range || 250);
                                const endY = wepAbsoluteY + Math.sin(wep.rotation * Math.PI / 180) * (wep.stats.range || 250);
                                scene.createLaserBeam(null, wepAbsoluteX, wepAbsoluteY, endX, endY, wep.stats.color || '#ff0000', wep.stats.color === '#8a2be2' ? 10 : 2);
                            }
                        } else if (isMissile && wepTarget) {
                            scene.radarMissiles.push({
                                x: wepAbsoluteX, y: wepAbsoluteY,
                                targetObj: wepTarget,
                                sourceId: ent.id,
                                speed: 250,
                                life: 8.0,
                                damage: wep.stats.attack || 30
                            });
                        } else {
                            // 默认动能实体弹丸
                            const shootRad = wep.rotation * Math.PI / 180;
                            const bulletSpeed = isPlayerControlled ? 600 : 500;
                            scene.radarEntities.projectiles.push({
                                isInstant: false,
                                x: wepAbsoluteX, y: wepAbsoluteY,
                                vx: Math.cos(shootRad) * bulletSpeed,
                                vy: Math.sin(shootRad) * bulletSpeed,
                                life: ((wep.stats && wep.stats.range) ? wep.stats.range : 200) / bulletSpeed,
                                sourceId: ent.id,
                                color: (wep.stats && wep.stats.color) ? wep.stats.color : '#ffff00', // 从武器属性读取
                                damage: (wep.stats && wep.stats.attack !== undefined) ? wep.stats.attack : 15
                            });
                        }
                        
                        if (ent.shipRef) ent.shipRef.combatTimer = 5.0;
                        if (wepTarget && wepTarget.shipRef) wepTarget.shipRef.combatTimer = 5.0;
                    }
                });
            }

            // [逻辑修复] 战斗状态计时器衰减 (否则飞机永远无法自动返航)
            if (ent.shipRef && ent.shipRef.combatTimer > 0) {
                ent.shipRef.combatTimer -= dt;
            }

            // [Fix] 异常状态自愈：如果出现物理破坏级的 NaN 错误，强制归零，防止飞船永久消失或卡死
            if (isNaN(targetDx) || isNaN(targetDy)) { targetDx = 0; targetDy = 0; }
            if (isNaN(ent.vx) || isNaN(ent.vy)) { ent.vx = 0; ent.vy = 0; }
            if (isNaN(ent.x) || isNaN(ent.y)) { 
                ent.x = (ent.parentId && allShipsList.find(p=>p.id===ent.parentId)) ? allShipsList.find(p=>p.id===ent.parentId).x : 500; 
                ent.y = (ent.parentId && allShipsList.find(p=>p.id===ent.parentId)) ? allShipsList.find(p=>p.id===ent.parentId).y : 275; 
            }

            // [核心修复] 超速航行(巡航)断开时的强行熔断截速
            if (wasSuperCruising && !ent.isSuperCruising) {
                // 将速度瞬间截断到基础极速的 0.8 倍以内，防止巨大的惯性把船甩飞
                const currentV = Math.hypot(ent.vx, ent.vy);
                const limitV = baseMaxSpeed * 0.8;
                if (currentV > limitV) {
                    const ratio = limitV / currentV;
                    ent.vx *= ratio;
                    ent.vy *= ratio;
                }
            }

            // 平滑转向逻辑 (物理驱动)
            if (lookTarget) {
                let targetAngle = Math.atan2(lookTarget.y - ent.y, lookTarget.x - ent.x) * 180 / Math.PI;
                if (isNaN(targetAngle)) targetAngle = 0;
                if (ent.rotation === undefined || isNaN(ent.rotation)) ent.rotation = targetAngle;
                
                let angleDiff = targetAngle - ent.rotation;
                angleDiff = ((angleDiff + 180) % 360 + 360) % 360 - 180;
                
                let maxTurnRate = mass > 0 ? (turnThrust / mass) / 3 : 0;
                
                if (maxTurnRate === 0 && thrust === 0) maxTurnRate = 0; 
                else if (maxTurnRate < 10) maxTurnRate = 10; 

                if (Math.abs(angleDiff) < maxTurnRate * dt) {
                    ent.rotation = targetAngle;
                } else {
                    ent.rotation += Math.sign(angleDiff) * maxTurnRate * dt;
                }
            }

            // 真实物理引擎推进
            if (targetDx !== 0 || targetDy !== 0) {
                let accel = baseAccel * thrustMultiplier;
                const limitV = baseMaxSpeed * Math.max(0, thrustMultiplier);
                
                const vDot = (ent.vx * targetDx + ent.vy * targetDy);
                
                if (vDot < limitV) {
                    const addV = Math.min(accel * dt, limitV - vDot);
                    ent.vx += targetDx * addV;
                    ent.vy += targetDy * addV;
                }
            }

            // 物理衰减
            const friction = Math.pow(drag, dt); 
            ent.vx *= friction;
            ent.vy *= friction;
            ent.x += ent.vx * dt;
            ent.y += ent.vy * dt;

            // [新增] 纯时间倒计时建造（微观实机状态下）
            if (ent.shipRef && ent.shipRef.isBuilding) {
                if (ent.shipRef.buildProgress === undefined) ent.shipRef.buildProgress = 0;
                
                let timeToBuild = ent.type === 'destroyer' ? 30.0 : 10.0;
                let buildPowerPerSec = 100.0 / timeToBuild; 

                ent.shipRef.buildProgress += buildPowerPerSec * dt;

                // 下水实体化
                if (ent.shipRef.buildProgress >= 100 && !ent.shipRef.isSpawning) {
                    ent.shipRef.isSpawning = true;
                    import('./Base-Building.js').then(module => {
                        module.finishShipBuilding(ent.id, ent.shipRef, ent.x, ent.y, ent.rotation);
                    });
                }
            }

            // 装备附加装甲自动回血逻辑
            if (ent.shipRef && ent.shipRef.stats && ent.shipRef.stats.hpRegen && !ent.shipRef.isBuilding) {
                if (ent.hp < ent.maxHp) {
                    ent.hp = Math.min(ent.maxHp, ent.hp + ent.shipRef.stats.hpRegen * dt);
                }
            }

            if (ent.hitFlash > 0) ent.hitFlash -= dt;

            if (ent.hp <= 0 && !(ent.shipRef && ent.shipRef.isBuilding)) {
                if (ent.id === pd.playerShipId && scene.sys.game.loop.time < 5000) {
                    console.warn("[防误杀] 玩家飞船开局血量异常，强制恢复:", ent.hp);
                    ent.hp = ent.maxHp || 100;
                    return true;
                }

                if (ent.ownerId === 'player' && ent.id !== pd.playerShipId) {
                    const removedName = PlayerManager.removeShip(ent.id);
                    if (removedName) {
                        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style="color:red; font-weight:bold; margin-top:5px; border:1px solid red; padding:5px; background:rgba(50,0,0,0.5);">⚠️ 战斗警报：友军舰船 [${removedName}] 已被彻底摧毁，从资产库抹除。</div>` }));
                        if (true) {
                            const pd = PlayerManager.getStats();
                            EventBus.dispatchEvent(new CustomEvent(GameEvents.UPDATE_FLEET_DATA, { detail: pd }));
                        }
                    }
                }
                return false; 
            } else {
                if (ent.shipRef) {
                    if (ent.shipRef.stats) ent.shipRef.stats.hp = ent.hp; 
                    if (!ent.shipRef.location) ent.shipRef.location = { x: ent.x, y: ent.y };
                    ent.shipRef.location.x = ent.x;
                    ent.shipRef.location.y = ent.y;
                }
                if (ent.isWingman) {
                    const pd = PlayerManager.getStats();
                    if (pd.ownedShips) {
                        const ship = pd.ownedShips.find(s => s.id === ent.id);
                        if (ship) ship.hp = ent.hp;
                    }
                }
                return true;
            }
        };

        // 将所有实体合并为单一列表传递给开火演算进行真实阵营判定
        let allEntitiesRaw = [...scene.radarEntities.defenders, ...scene.radarEntities.attackers];
        if (scene.radarEntities.player) allEntitiesRaw.push(scene.radarEntities.player);
        const allEntities = [...new Map(allEntitiesRaw.map(e => [e.id, e])).values()];

        // [重构] 无论是防卫者还是攻击者，统一在循环中进行玩家死亡的特判
        const checkPlayerDeath = (ent) => {
            const currentPd = PlayerManager.getStats();
            if (ent.id === currentPd.playerShipId && !ent.isSafeRemoved && !ent.isWarping && !ent.isDocked && !(ent.shipRef && ent.shipRef.state === 'DOCKED')) {
                // 玩家被击毁，触发强制重生逻辑
                setTimeout(() => {
                    const pd = PlayerManager.getStats();
                    const penalty = Math.floor(pd.credits * 0.1); 
                    PlayerManager.updateStat('credits', -penalty);
                    
                    alert(`⚠️ 警告：旗舰核心熔毁！\n\n紧急逃生舱已启动... 搜救队已将您打捞至安全区域。\n(损失 ${penalty} 星币作为打捞与舰体修复费)`);
                    
                    const allShipsList = ShipManager.getShipsInSector(simSectorName);
                    allShipsList.forEach(s => {
                        if (s.target && s.target.id === pd.playerShipId) s.target = null;
                        if (s.memory && s.memory[pd.playerShipId]) delete s.memory[pd.playerShipId];
                        if (s.memory && s.memory['player_ship']) delete s.memory['player_ship']; 
                    });

                    if (pd.playerShipId) {
                        const flagship = pd.ownedShips.find(s => s.id === pd.playerShipId);
                        if (flagship) {
                            flagship.hp = flagship.maxHp || 100;
                            PlayerManager.saveStats(pd);
                        }
                    }

                    scene.currentPoiId = 'poi-dock';
                    localStorage.setItem('current_poi', 'poi-dock');
                    localStorage.removeItem('player_radar_x');
                    localStorage.removeItem('player_radar_y');
                    
                    scene.scene.restart();
                }, 1000);
            }
        };

        for (let i = scene.radarEntities.defenders.length - 1; i >= 0; i--) {
            let def = scene.radarEntities.defenders[i];
            let alive = updateShipEntity(def, allEntities);
            if (!alive) {
                if (!def.isDocked && !(def.shipRef && def.shipRef.state === 'DOCKED') && !def.isWarping && !def.isSafeRemoved) {
                    scene.createExplosion(null, def.x, def.y);
                    if (def.shipRef) def.shipRef.stats.hp = 0;
                    checkPlayerDeath(def);
                }
                scene.radarEntities.defenders.splice(i, 1);
            }
        }

        for (let i = scene.radarEntities.attackers.length - 1; i >= 0; i--) {
            let att = scene.radarEntities.attackers[i];
            let alive = updateShipEntity(att, allEntities);
            if (!alive) {
                if (!att.isDocked && !(att.shipRef && att.shipRef.state === 'DOCKED') && !att.isWarping && !att.isSafeRemoved) {
                    scene.createExplosion(null, att.x, att.y);
                    if (att.shipRef) att.shipRef.stats.hp = 0;
                    checkPlayerDeath(att);
                }
                scene.radarEntities.attackers.splice(i, 1);
            }
        }

        // 处理飞行弹道 (追踪炮塔瞬间激光 vs 直线物理弹丸)
        for (let i = scene.radarEntities.projectiles.length - 1; i >= 0; i--) {
            let p = scene.radarEntities.projectiles[i];
            
            // --- 追踪炮塔：瞬间命中激光 ---
            if (p.isInstant) {
                const targetAliveOrBuilding = p.target && (p.target.hp > 0 || (p.target.shipRef && p.target.shipRef.isBuilding));
                
                if (targetAliveOrBuilding) {
                    scene.createLaserBeam(null, p.x, p.y, p.target.x, p.target.y, p.color, p.thickness);
                    
                    const isBuildingBeam = p.isBuilderBeam || (p.damage === 0 && p.target.shipRef && p.target.shipRef.isBuilding);
                    
                    if (isBuildingBeam) {
                        processBuildingBeamHit(p);
                    } else {
                        if (!p.target.shipRef || !p.target.shipRef.isBuilding) {
                            p.target.hp -= p.damage;
                        }
                    }
                
                    // 记录仇恨记忆
                    if (p.sourceId && p.target.id !== p.sourceId && !isBuildingBeam) {
                        let allPossibleTargets = [...scene.radarEntities.defenders, ...scene.radarEntities.attackers];
                        let shooter = allPossibleTargets.find(e => e.id === p.sourceId);
                        
                        if (shooter) {
                            const pdForProj = PlayerManager.getStats();
                            const amount = (p.sourceId === pdForProj.playerShipId && p.target.type === 'freighter') ? -100 : -10;
                            AffinityManager.modifyAffinity(p.target, shooter, amount);
                            
                            if (shooter.id !== pdForProj.playerShipId) shooter.target = p.target;
                        }
                    }

                    if (p.target.hp <= 0) {
                        scene.createExplosion(null, p.target.x, p.target.y);
                    } else {
                        p.target.hitFlash = 0.1; 
                    }
                }
                scene.radarEntities.projectiles.splice(i, 1);
            } 
            // --- 固定主炮：真实直线飞行的物理弹丸 ---
            else {
                p.life -= dt;
                if (p.life <= 0) {
                    if (p.el && p.el.parentNode) p.el.remove();
                    scene.radarEntities.projectiles.splice(i, 1);
                    continue;
                }

                p.x += p.vx * dt;
                p.y += p.vy * dt;

                // 物理碰撞检测
                let hitTarget = null;
                let allPossibleTargets = [...scene.radarEntities.defenders, ...scene.radarEntities.attackers];

                let shooter = allPossibleTargets.find(e => e.id === p.sourceId);

                for (let j = 0; j < allPossibleTargets.length; j++) {
                    let ent = allPossibleTargets[j];
                    
                    if (ent.hp <= 0 || ent.id === p.sourceId) continue;
                    
                    if (shooter) {
                        const aff = getAffinity(shooter, ent);
                        if (aff >= 1000) continue; 
                    }

                    const pdForColl = PlayerManager.getStats();
                    const dist = Math.hypot(ent.x - p.x, ent.y - p.y);
                    let hitbox = 30; 
                    if (ent.id === pdForColl.playerShipId) hitbox = 30;
                    else if (ent.shipRef && ent.shipRef.hullId && GameConfig.HULLS[ent.shipRef.hullId]) {
                        const hSize = GameConfig.HULLS[ent.shipRef.hullId].size;
                        if (ent.shipRef.hullId === 'destroyer_alliance') hitbox = 100;
                        else if (ent.shipRef.hullId === 'destroyer_pirate') hitbox = 100;
                        else if (hSize === 'large') hitbox = 80;
                        else if (hSize === 'medium') hitbox = 45;
                    } else if (ent.type === 'freighter') hitbox = 50;

                    if (dist < hitbox + 10) {
                        hitTarget = ent;
                        break;
                    }
                }

                if (hitTarget) {
                    const isHittingBuilding = (hitTarget.shipRef && hitTarget.shipRef.isBuilding);
                    
                    if (!isHittingBuilding) {
                        hitTarget.hp -= p.damage;
                    }
                    
                    if (p.sourceId && !isHittingBuilding) {
                        if (shooter) {
                            const pdForHate = PlayerManager.getStats();
                            const amount = (p.sourceId === pdForHate.playerShipId && hitTarget.type === 'freighter') ? -100 : -10;
                            AffinityManager.modifyAffinity(hitTarget, shooter, amount);
                            
                            if (shooter.id !== pdForHate.playerShipId) shooter.target = hitTarget;
                        }
                    }

                    if (hitTarget.shipRef && !isHittingBuilding) {
                        hitTarget.shipRef.stats.hp -= p.damage; 
                        hitTarget.shipRef.combatTimer = 5.0; 
                    }
                    
                    scene.createExplosion(null, p.x, p.y);
                    if (hitTarget.hp <= 0) {
                        scene.createExplosion(null, hitTarget.x, hitTarget.y);
                    }
                    if (hitTarget.hp > 0 && !isHittingBuilding) hitTarget.hitFlash = 0.1; 

                    if (p.el && p.el.parentNode) p.el.remove();
                    scene.radarEntities.projectiles.splice(i, 1);
                }
            }
        }

        // --- 调用小行星更新与受击 ---
        updateAsteroids(dt, simSectorName, scene.sectorSimulations, scene.radarEntities.projectiles);

        for (let i = scene.radarMissiles.length - 1; i >= 0; i--) {
            let m = scene.radarMissiles[i];
            m.life -= dt;

            if (m.life <= 0 || !m.targetObj || m.targetObj.hp <= 0) {
                scene.radarMissiles.splice(i, 1);
                continue;
            }

            const dx = m.targetObj.x - m.x;
            const dy = m.targetObj.y - m.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 10) {
                const dmg = m.damage || 40; 
                const isHittingBuilding = (m.targetObj.shipRef && m.targetObj.shipRef.isBuilding);
                
                if (!isHittingBuilding) {
                    m.targetObj.hp -= dmg; 
                    if (m.targetObj.shipRef) {
                        m.targetObj.shipRef.stats.hp -= dmg;
                        m.targetObj.shipRef.combatTimer = 5.0;
                    }
                }
                
                scene.createExplosion(null, m.x, m.y);
                if (m.targetObj.hp <= 0 && m.targetObj.x !== undefined) {
                    scene.createExplosion(null, m.targetObj.x, m.targetObj.y);
                }
                
                scene.radarMissiles.splice(i, 1);
                continue;
            }

            m.x += (dx / dist) * m.speed * dt;
            m.y += (dy / dist) * m.speed * dt;
        }

        // 将本星区收集到的指挥线存入全局临时缓存
        scene._tempCommandLines.push(...renderCommandLines);

    }); // End of activeSectors.forEach

    // [收尾] 恢复上下文
    if (scene.sectorSimulations[viewingSector]) {
        scene.radarEntities = scene.sectorSimulations[viewingSector];
        
        // ==========================================
        // 【跨星区全局指挥线补充投影】
        // ==========================================
        const simGates = scene.sectorSimulations[viewingSector].gates;
        if (simGates) {
            const pd = PlayerManager.getStats();
            const allPlayerShips = pd.ownedShips || [];
            const drawnShipIds = new Set(scene._tempCommandLines.map(l => l.shipId));

            allPlayerShips.forEach(pShip => {
                const macroShip = ShipManager.getShipById(pShip.id);
                if (!macroShip) return;
                
                if (drawnShipIds.has(macroShip.id)) return;
                
                let cmdType = null;
                let isTargetingView = false;
                let targetPos = null;

                if (macroShip.commandState === 'MOVE_TO' || macroShip.state === 'DEPARTURE' || macroShip.state === 'TRANSIT' || macroShip.state === 'WARP') {
                    cmdType = 'MOVE';
                    
                    let targetSec = null;
                    if (macroShip.orderQueue && macroShip.orderQueue.length > 0) {
                        targetSec = macroShip.orderQueue[0].targetSector;
                    } else if (macroShip.path && macroShip.path.length > 0) {
                        targetSec = macroShip.path[macroShip.path.length - 1];
                    }
                    
                    if (targetSec === viewingSector) {
                        isTargetingView = true;
                        if (macroShip.moveTarget) {
                            targetPos = { x: macroShip.moveTarget.x, y: macroShip.moveTarget.y };
                        } else {
                            targetPos = { x: 500, y: 275 };
                        }
                    }
                }

                if (!cmdType) return;

                const pathIncludesView = macroShip.path && macroShip.path.includes(viewingSector);
                const isWarpingToView = macroShip.state === 'WARP' && macroShip.currentLane && macroShip.currentLane.to === viewingSector;
                
                if (!pathIncludesView && !isTargetingView && !isWarpingToView) return;

                const isSelected = scene.selectedUnitIds.includes(macroShip.id);
                let cStartX = null;
                let cStartY = null;
                let cEndX = null;
                let cEndY = null;

                let entryGateName = null;
                let exitGateName = null;
                
                const pathIndex = macroShip.path ? macroShip.path.indexOf(viewingSector) : -1;
                
                if (pathIndex > 0) {
                    entryGateName = macroShip.path[pathIndex - 1];
                    if (pathIndex < macroShip.path.length - 1) {
                        exitGateName = macroShip.path[pathIndex + 1];
                    }
                } else if (pathIndex === 0) {
                    if (macroShip.state === 'WARP' && macroShip.currentLane) {
                        entryGateName = macroShip.currentLane.from;
                    } else {
                        entryGateName = macroShip.location.sector;
                    }
                    if (macroShip.path.length > 1) {
                        exitGateName = macroShip.path[1];
                    }
                } else if (pathIndex === -1) {
                    if (isWarpingToView) {
                        entryGateName = macroShip.currentLane.from;
                        if (macroShip.path && macroShip.path.length > 0) {
                            exitGateName = macroShip.path[0];
                        }
                    } else if (isTargetingView) {
                        entryGateName = macroShip.location.sector;
                    }
                }

                if (entryGateName && simGates[entryGateName]) {
                    cStartX = simGates[entryGateName].x;
                    cStartY = simGates[entryGateName].y;
                }

                if (exitGateName && simGates[exitGateName]) {
                    cEndX = simGates[exitGateName].x;
                    cEndY = simGates[exitGateName].y;
                } else if (isTargetingView && targetPos) {
                    cEndX = targetPos.x;
                    cEndY = targetPos.y;
                } else if (!exitGateName && pathIncludesView && pathIndex === macroShip.path.length - 1) {
                    cEndX = 500;
                    cEndY = 275;
                }

                if (cStartX !== null && cEndX !== null) {
                    scene._tempCommandLines.push({
                        shipId: macroShip.id,
                        startX: cStartX,
                        startY: cStartY,
                        endX: cEndX,
                        endY: cEndY,
                        type: cmdType,
                        isDashed: true, 
                        isSelected: isSelected,
                        colorHex: '#33ccff' 
                    });
                }
            });
        }

        // [引擎换血] 同步至原生 Phaser 物理渲染层
        const radar = scene.scene.get('RadarScene');
        if (radar) {
            let allSimsRaw = [...scene.radarEntities.defenders, ...scene.radarEntities.attackers];
            
            // 再次严格排重，杜绝因为数组引用污染导致的同 ID 多实体传给前端
            const allSims = [...new Map(allSimsRaw.map(e => [e.id, e])).values()];
            
            const finalShips = allSims.filter(e => e && (e.hp > 0 || (e.shipRef && e.shipRef.isBuilding)));

            // 将所有实体坐标、状态及弹道传给 RadarScene 绘制
            radar.syncEntities({
                ships: finalShips,
                projectiles: scene.radarEntities.projectiles,
                missiles: scene.radarEntities.missiles || [],
                asteroids: scene.radarEntities.asteroids || [],
                drops: scene.radarEntities.drops || [],
                selectedUnitIds: scene.selectedUnitIds,
                nodes: scene.radarEntities.nodes || [],
                gates: scene.radarEntities.gatesArray || [],
                commandLines: scene._tempCommandLines || []
            });
            
            // 绘制完清空，准备下一帧
            scene._tempCommandLines = [];

            radar.syncCamera(scene.radarPanX, scene.radarPanY, scene.radarScale);
        }

        // --- 为新的右下角UI雷达广播数据 ---
        // 找到真正的玩家实体广播自身位置
        const pdForUI = PlayerManager.getStats();
        let finalRealPlayerEnt = [...scene.radarEntities.defenders, ...scene.radarEntities.attackers].find(e => String(e.id) === String(pdForUI.playerShipId));
        if (finalRealPlayerEnt) {
            const validShips = [...scene.radarEntities.defenders, ...scene.radarEntities.attackers].filter(e => e && e.hp > 0);
            const radarPayload = {
                player: { x: finalRealPlayerEnt.x, y: finalRealPlayerEnt.y, rotation: finalRealPlayerEnt.rotation },
                entities: validShips.map(s => ({
                    id: s.id,
                    x: s.x,
                    y: s.y,
                    type: s.type,
                    faction: s.shipRef ? s.shipRef.faction : null
                }))
            };
            document.dispatchEvent(new CustomEvent('ui_mini_radar_update', { detail: radarPayload }));
        }
    }
}
