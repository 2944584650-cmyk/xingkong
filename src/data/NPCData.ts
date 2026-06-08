export interface NPCData {
    id: string;               // 唯一标识符
    name: string;             // NPC 姓名
    factionId: string;        // 所属阵营 ID
    
    // --- 核心经济属性 ---
    credits: number;          // 货币/星币储备 (挂载点)
    
    // --- 资产所有权 (Ownership) ---
    ownedShips: string[];     // 拥有的飞船 ID 列表
    ownedBuildings: string[]; // 拥有的建筑/空间站 ID 列表
    
    // --- 其他可选属性 ---
    location?: string;        // 当前所在的星区/空间站 ID
    inventory?: Record<string, number>; // NPC个人的随身物品/私密仓库 (物品ID -> 数量)
    traits?: string[];        // 性格/特质
}
