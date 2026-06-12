import { ShipOrder, AtomicTask } from './OrderData';

/**
 * 飞船核心数据层 (宏观/物理共用)
 */
export interface ShipData {
    id: string;
    name: string;
    
    // --- 身份与所有权 ---
    ownerId: string;             // 'player' 或 NPC id (资产拥有者)
    pilotId?: string;            // 'player' 或 NPC id (当前实际驾驶员，为空则视为AI/无人驾驶)
    factionId: number;           // 阵营 ID
    type: 'fighter' | 'freighter' | 'drone' | 'station' | string;
    size: 'small' | 'medium' | 'large' | 'capital' | string;
    
    // --- 底盘与装备 ---
    hullId: string;
    loadout: Record<string, string>; // 武器/组件槽位装备
    maxInventory: number;
    
    // --- 物理与状态 ---
    state: 'IDLE' | 'WARP' | 'COMBAT' | 'DOCKED' | 'DEPARTURE' | 'TRANSIT' | 'ARRIVAL' | 'BUILDING' | string;
    location: {
        sector: string;
        x: number;
        y: number;
    };
    rotation: number;
    
    stats: {
        hp: number;
        maxHp: number;
        mass: number;
        drag: number;
        thrust: number;
        turnThrust: number;
        hpRegen: number;
        speed?: number; // 已废弃，向后兼容
    };
    
    // --- 逻辑堆栈 (AI/行为) ---
    orderQueue: ShipOrder[];     // 宏观任务队列
    taskStack: AtomicTask[];     // 微观/原子任务堆栈
    combatTimer: number;         // 脱战倒计时
    
    // --- 导航与物流 ---
    dockedAt?: string | null;            // 停靠的宿主 ID (空间站/航母)
    dockedBerthId?: string | null;       // 占用的具体泊位 ID
    approachingDock?: string | null;     // 正在前往停靠的目标 UID (预占泊位)
    targetSector?: string | null;
    path?: string[];                     // 跨星区路径
    travelProgress?: number;
    
    // --- 无人机专属属性 ---
    droneEquips?: Record<string, string>; // { "DR1": "mine_drone" }
    droneStates?: Record<string, 'IDLE' | 'WORKING' | 'RETURNING'>;
    activeDrones?: Record<string, string>; // { "DR1": "drone_entity_id_xxx" }
    
    // 以下为作为"被发射出的无人机实体"时存在的属性
    parentId?: string | null;             // 记住自己的母舰/母站 ID
    sourceSlotId?: string | null;         // 记住自己是从哪个槽位出来的
    droneType?: 'GENERAL' | 'ATTACK' | 'MINE' | 'BUILD';
    isReturning?: boolean;                // 是否正在返航
}
