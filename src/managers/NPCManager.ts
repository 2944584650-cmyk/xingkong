import { NPCData } from '../data/NPCData';
import { emitUIEvent } from '../utils/EventBus';

export class NPCManager {
    private static instance: NPCManager;
    private npcs: Map<string, NPCData> = new Map();

    private constructor() {}

    public static getInstance(): NPCManager {
        if (!NPCManager.instance) {
            NPCManager.instance = new NPCManager();
        }
        return NPCManager.instance;
    }

    /**
     * 创建或注册一个新的 NPC
     */
    public createNPC(data: Partial<NPCData> & { id: string, name: string, factionId: string }): NPCData {
        if (this.npcs.has(data.id)) {
            console.warn(`NPC with ID ${data.id} already exists. Returning existing.`);
            return this.npcs.get(data.id)!;
        }

        const npc: NPCData = {
            id: data.id,
            name: data.name,
            factionId: data.factionId,
            credits: data.credits || 0,
            ownedShips: data.ownedShips || [],
            ownedBuildings: data.ownedBuildings || [],
            location: data.location,
            inventory: data.inventory || {},
            traits: data.traits || []
        };

        this.npcs.set(npc.id, npc);
        emitUIEvent('npc-created', npc);
        return npc;
    }

    /**
     * 获取指定 ID 的 NPC 数据
     */
    public getNPC(id: string): NPCData | undefined {
        return this.npcs.get(id);
    }

    /**
     * 获取所有 NPC 数据
     */
    public getAllNPCs(): NPCData[] {
        return Array.from(this.npcs.values());
    }

    /**
     * 在两个实体拥有者之间划转资金 (买方 -> 卖方)
     */
    public transferCredits(buyerId: string, sellerId: string, amount: number, force: boolean = false): boolean {
        if (amount <= 0 || buyerId === sellerId) return true;

        // 1. 买方扣钱
        let buyerHasEnough = false;
        if (buyerId === 'player') {
            const pm = (window as any).PlayerManager;
            if (pm && (force || pm.getStats().credits >= amount)) {
                pm.getStats().credits -= amount;
                emitUIEvent('player_stats_changed', pm.getStats());
                buyerHasEnough = true;
            }
        } else {
            const buyer = this.getNPC(buyerId);
            if (buyer && (force || buyer.credits >= amount)) {
                buyer.credits -= amount;
                emitUIEvent('npc-credits-changed', { npcId: buyerId, newCredits: buyer.credits, delta: -amount });
                buyerHasEnough = true;
            }
        }

        // 如果不强制交易且买方钱不够，交易失败
        if (!buyerHasEnough && !force) {
            return false;
        }

        // 2. 卖方加钱
        if (sellerId === 'player') {
            const pm = (window as any).PlayerManager;
            if (pm) {
                pm.getStats().credits += amount;
                emitUIEvent('player_stats_changed', pm.getStats());
            }
        } else {
            this.addCredits(sellerId, amount);
        }

        return true;
    }

    /**
     * 为 NPC 增加货币
     */
    public addCredits(id: string, amount: number): boolean {
        const npc = this.npcs.get(id);
        if (!npc || amount < 0) return false;
        
        npc.credits += amount;
        emitUIEvent('npc-credits-changed', { npcId: id, newCredits: npc.credits, delta: amount });
        return true;
    }

    /**
     * 扣除 NPC 的货币
     */
    public deductCredits(id: string, amount: number): boolean {
        const npc = this.npcs.get(id);
        if (!npc || amount < 0) return false;

        if (npc.credits >= amount) {
            npc.credits -= amount;
            emitUIEvent('npc-credits-changed', { npcId: id, newCredits: npc.credits, delta: -amount });
            return true;
        }
        return false; // 余额不足
    }

    /**
     * 为 NPC 注册一艘拥有的飞船
     */
    public addOwnedShip(npcId: string, shipId: string): boolean {
        const npc = this.npcs.get(npcId);
        if (!npc) return false;

        if (!npc.ownedShips.includes(shipId)) {
            npc.ownedShips.push(shipId);
            return true;
        }
        return false;
    }

    /**
     * 移除 NPC 拥有的某艘飞船
     */
    public removeOwnedShip(npcId: string, shipId: string): boolean {
        const npc = this.npcs.get(npcId);
        if (!npc) return false;

        const index = npc.ownedShips.indexOf(shipId);
        if (index !== -1) {
            npc.ownedShips.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * 获取 NPC 拥有的所有飞船 ID
     */
    public getOwnedShips(npcId: string): string[] {
        const npc = this.npcs.get(npcId);
        return npc ? [...npc.ownedShips] : [];
    }

    /**
     * 序列化所有 NPC 数据 (用于存档)
     */
    public serialize(): any {
        const data: any = {};
        this.npcs.forEach((npc, id) => {
            data[id] = npc;
        });
        return data;
    }

    /**
     * 反序列化加载 NPC 数据 (用于读档)
     */
    public deserialize(data: any): void {
        this.npcs.clear();
        if (!data) return;

        for (const [id, npcData] of Object.entries(data)) {
            this.npcs.set(id, npcData as NPCData);
        }
    }

    /**
     * 清理所有数据 (例如返回主菜单或重新开始游戏时)
     */
    public clear(): void {
        this.npcs.clear();
    }

    /**
     * 宣告 NPC 物理死亡
     */
    public killNPC(id: string): boolean {
        const npc = this.npcs.get(id);
        if (!npc) return false;

        npc.isDead = true;
        // 如果想增加真实感，可以在这里处理其名下资产的遗产继承或无主化
        // 但目前先简单地保留资产，只是人死了
        emitUIEvent('npc-died', npc);
        return true;
    }

    /**
     * 更新 NPC 所在的物理位置 (例如登船)
     */
    public updateLocation(id: string, locationId: string): boolean {
        const npc = this.npcs.get(id);
        if (!npc) return false;
        
        npc.location = locationId;
        return true;
    }

    /**
     * 生成各阵营风格的随机名称
     */
    public generateRandomName(factionId: string | number): string {
        const fId = String(factionId);
        
        // 1 - 帝国
        if (fId === '1') {
            const titles = ["男爵", "统帅", "执行官", "总督", "骑士"];
            const names = ["奥古斯都", "尤里乌斯", "瓦伦里安", "屋大维", "提比略"];
            return `${titles[Math.floor(Math.random() * titles.length)]} ${names[Math.floor(Math.random() * names.length)]}`;
        } 
        // 2 - 自由联邦
        else if (fId === '2') {
            const firstNames = ["杰克", "艾米莉亚", "陈", "约翰", "威廉", "李"];
            const lastNames = ["雷诺", "星", "史密斯", "布莱克", "威廉姆斯"];
            return `${firstNames[Math.floor(Math.random() * firstNames.length)]}·${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
        }
        // 3 - 拾荒者 / 海盗
        else if (fId === '3') {
            const adjectives = ["独眼", "疯子", "血手", "红胡子", "疤面", "贪婪的"];
            const nouns = ["杰克", "老乔", "巴特", "克鲁格", "比尔"];
            return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
        }
        // 4 - 虚空教团
        else if (fId === '4') {
            const prefixes = ["盲眼先知", "虚空行者", "祭司", "低语者", "暗影使徒"];
            const mysticNames = ["卡尔", "玛尔扎", "泽拉图", "莫甘娜", "维克托"];
            return `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${mysticNames[Math.floor(Math.random() * mysticNames.length)]}`;
        }
        
        // 默认 (其他NPC)
        return `独立商人 ${Math.floor(Math.random() * 9000) + 1000}`;
    }

    /**
     * 为实体分配一个NPC (强制每次新建一个独立的 NPC)
     */
    public assignOrGetNPCForEntity(factionId: string | number): string {
        const fId = String(factionId);
        
        const newNpcId = `npc_${Date.now()}_${Math.floor(Math.random()*10000)}`;
        this.createNPC({
            id: newNpcId,
            name: this.generateRandomName(fId),
            factionId: fId,
            credits: 1000 + Math.floor(Math.random() * 5000) // 随机一点初始启动资金
        });
        
        return newNpcId;
    }
}
