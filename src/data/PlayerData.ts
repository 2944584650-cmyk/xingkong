import { FleetData } from './FleetData';

export interface PlayerData {
    // --- 核心经济与身份 ---
    credits: number;
    gameHasStarted: boolean;      // 对应 localStorage 的 game_has_started
    gameHasStartedV3: boolean;    // 对应 localStorage 的 game_has_started_v3

    // --- 资产数据 ---
    ownedShips: any[];            // 拥有的飞船的序列化数据
    fleets: FleetData[];          // 玩家组建的中队列表
    ownedComponents: string[];    // 已拥有但未装配的组件
    inventory: string[];          // 随身物品 / 私人物品 (与空间站库存区分)
    
    // --- 当前状态 ---
    playerShipId: string | null;  // 玩家当前“魂穿”/驾驶的飞船 ID
    
    // --- 为了兼容旧系统的缓存属性 ---
    // (通常会与 playerShipId 对应的 ownedShip 强同步，但不作为真实源)
    hullId?: string | null;
    slots?: Record<string, string>;
    turretRules?: any;
}
