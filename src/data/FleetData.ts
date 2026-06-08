export interface FleetData {
    id: string;                  // 中队唯一标识
    name: string;                // 中队名称
    flagshipId: string | null;   // 旗舰的飞船 ID
    members: string[];           // 僚机的飞船 ID 列表
    orders: string;              // 舰队宏观指令 (如 'follow_leader')
    factionId?: string | number; // 阵营标识，区分玩家舰队和 AI 舰队
}
