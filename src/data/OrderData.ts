/**
 * 飞船或舰队的宏观指令/任务状态
 */
export interface ShipOrder {
    status: 'FOLLOW' | 'DEPLOYED' | 'MINE' | 'TRADE' | 'PATROL' | string;
    targetSector?: string;
    targetId?: string;
    [key: string]: any; // 其他具体指令需要的附加参数
}

/**
 * 原子的任务结构 (供微观的 ShipExecution 使用)
 */
export interface AtomicTask {
    type: 'MOVE' | 'ATTACK' | 'DOCK' | 'UNDOCK' | 'TRANSFER_CARGO' | 'WARP' | string;
    targetId?: string;
    targetPos?: { x: number; y: number; sector?: string };
    params?: any; // 额外参数，例如转移的物品名和数量
}

/**
 * 建筑系统的建造订单 (无人机会提取它进行建造)
 */
export interface BuildOrder {
    id: string;               // 订单唯一ID
    moduleId: string;         // 要建造的模块蓝图 ID (如 'solar_panel')
    targetGridX: number;      // 目标网格 X
    targetGridY: number;      // 目标网格 Y
    targetRotation: number;   // 模块旋转角度
    requiredMaterials: Record<string, number>; // 仍需的材料 { 'steel': 100 }
    progress: number;         // 建造进度 0-100 或 0-1
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    builderDroneId?: string;  // 正在执行此订单的无人机 ID
}
