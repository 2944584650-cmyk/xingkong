import { BuildOrder } from './OrderData';

/**
 * 单个部署的空间站模块结构
 */
export interface PlacedModuleData {
    uid: string;                 // 模块的唯一 ID
    moduleId: string;            // 对应配置 (GameConfig.MODULES) 的标识
    
    // --- 坐标与布局 ---
    gridX: number;               // 绝对网格坐标 X
    gridY: number;               // 绝对网格坐标 Y
    width: number;               // 占据的网格宽
    height: number;              // 占据的网格高
    rotation: number;            // 旋转角度 (0, 90, 180, 270)
    sector?: string;             // 所属星区名称
    
    // --- 属性 ---
    hp: number;                  // 当前血量
    maxHp: number;               // 最大血量
    inventoryCapacity: number;   // 库房容量
    
    // --- 所有权体系 ---
    stationUid?: string;         // 所归属的虚拟空间站总 ID
    factionId?: string | number; // 阵营标签 (用于兼容所有权逻辑)
    
    // --- 制造与升级系统 ---
    buildQueue?: BuildOrder[];   // 该模块正在负责/排队的建筑订单
    internalModules?: Record<number, { id: string, progress?: number } | null>; // 内置插槽升级件
}

/**
 * 宏观虚拟空间站数据结构 (多个模块聚合后的呈现形式)
 */
export interface VirtualStationData {
    id: string;                  // 等同于 stationUid
    name: string;                // 空间站名称
    type: 'station';             // 类型标识
    
    // --- 所有权 ---
    factionId: string | number;
    ownerId: string;             // 对应 Player 或 NPC ID
    
    // --- 聚合数据 ---
    stationModulesList: {
        uid: string;
        moduleId: string;
        hp: number;
        maxHp: number;
    }[];
    
    stats: {
        hp: number;
        maxHp: number;
    };
    maxInventory: number;
    
    // --- 位置 ---
    location: {
        sector: string;
        x: number;
        y: number;
    };
    
    state: string; // 'IDLE' 等
    isStationVirtualShip: boolean;
}
