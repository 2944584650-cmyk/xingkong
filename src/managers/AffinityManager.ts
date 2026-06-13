/**
 * 好感度与派系关系管理器
 * 负责处理派系之间的基础关系、个体的记忆仇恨以及伤害触发的好感度变动。
 */

export class AffinityManager {
    /**
     * 获取全局派系好感度
     * @param state 世界状态对象
     * @param f1 派系1 ID
     * @param f2 派系2 ID
     * @returns 派系基础好感度
     */
    static getRelation(state: any, f1: number, f2: number): number {
        if (f1 === 0 || f2 === 0 || f1 === f2 || !state?.relations) return 0;
        const key = f1 < f2 ? `${f1}-${f2}` : `${f2}-${f1}`;
        return state.relations[key] || 0;
    }

    /**
     * 修改派系间的好感度
     */
    static addRelation(state: any, f1: number, f2: number, delta: number) {
        if (f1 === 0 || f2 === 0 || f1 === f2 || !state?.relations) return;
        const key = f1 < f2 ? `${f1}-${f2}` : `${f2}-${f1}`;
        let rel = (state.relations[key] || 0) + delta;
        rel = Math.max(-100, Math.min(100, rel));
        
        if (delta < 0 && (state.relations[key] || 0) > -50 && rel <= -50) {
            const fac1 = state.factions.find((f: any) => f.id === f1);
            const fac2 = state.factions.find((f: any) => f.id === f2);
            // console.log(`[外交破裂] ${fac1?.name} 与 ${fac2?.name} 之间的好感度跌破冰点(${rel})，进入全面战争状态！`);
        } else if (delta > 0 && (state.relations[key] || 0) <= -50 && rel > -50) {
            const fac1 = state.factions.find((f: any) => f.id === f1);
            const fac2 = state.factions.find((f: any) => f.id === f2);
            // console.log(`[外交缓和] ${fac1?.name} 与 ${fac2?.name} 签署了停火协议，好感度回暖(${rel})，恢复仅限缓冲区的克制摩擦。`);
        }
        
        state.relations[key] = rel;
    }

    /**
     * 获取实体A对实体B的最终好感度
     * @param A 发起者 (通常是炮台/船只的所有者)
     * @param B 目标
     * @returns 最终好感度。 < 0 视为敌对 (可开火)
     */
    static getAffinity(A: any, B: any): number {
        if (!A || !B) return 0;

        // 初始化记忆库（防御性）
        if (!A.memory) A.memory = {};
        if (!B.memory) B.memory = {};

        // 默认基础好感度
        let affinity = 100;

        const ownerA = A.ownerId !== undefined ? A.ownerId : (A.factionId !== undefined ? A.factionId : -1);
        const ownerB = B.ownerId !== undefined ? B.ownerId : (B.factionId !== undefined ? B.factionId : -1);

        // 1. 绝对信任机制（允许实体子弹完全穿透）
        let isAbsoluteTrust = false;
        const aTrueId = A.id;
        const bTrueId = B.id;
        const playerShipId = localStorage.getItem('player_ship_id');

        // 母体/召唤物关系
        if (A.parentId === bTrueId || B.parentId === aTrueId) isAbsoluteTrust = true;

        // 玩家体系的绝对信任
        if (ownerA === 'player' && ownerB === 'player') isAbsoluteTrust = true;
        if (A.isWingman && B.id === playerShipId) isAbsoluteTrust = true;
        if (B.isWingman && A.id === playerShipId) isAbsoluteTrust = true;
        if (A.isWingman && ownerB === 'player') isAbsoluteTrust = true;
        if (B.isWingman && ownerA === 'player') isAbsoluteTrust = true;

        // 同一AI阵营之间的绝对信任 (帝国、联邦、海盗等同阵营内部)
        if (ownerA === ownerB && ownerA !== -1 && ownerA !== 'player') {
            isAbsoluteTrust = true;
        }

        if (isAbsoluteTrust) {
            // 如果满足绝对信任，后续无论发生什么直接返回 1000 (甚至无视临时仇恨)
            return 1000;
        }

        // 2. 派系宏观声望关系
        // 利用全局缓存的派系关系，避免每帧高频执行 JSON.parse(localStorage)
        const getCachedRelations = () => {
            const now = Date.now();
            if (!(window as any)._affinityRelationsCache || now - (window as any)._affinityRelationsCacheTime > 5000) {
                try {
                    const savedState = localStorage.getItem('world_state');
                    if (savedState) {
                        const worldState = JSON.parse(savedState);
                        (window as any)._affinityRelationsCache = worldState.relations || {};
                    } else {
                        (window as any)._affinityRelationsCache = {};
                    }
                } catch (e) {
                    (window as any)._affinityRelationsCache = {};
                }
                (window as any)._affinityRelationsCacheTime = now;
            }
            return (window as any)._affinityRelationsCache;
        };

        if (typeof ownerA === 'number' && typeof ownerB === 'number') {
            const relations = getCachedRelations();
            const key = ownerA < ownerB ? `${ownerA}-${ownerB}` : `${ownerB}-${ownerA}`;
            const factionAffinity = relations[key] || 0;
            
            if (factionAffinity < 0) {
                affinity += (factionAffinity - 50); 
            } else {
                affinity += factionAffinity;
            }
        } else {
            // 后备逻辑（如果 owner 不是数字，或者是未能解析阵营）
            // 海盗 (3) 默认敌视
            if (ownerA === 3 && ownerA !== ownerB) affinity -= 150;
            if (ownerB === 3 && ownerA !== ownerB) affinity -= 150;
            // 虚空 (4) 默认敌视
            if (ownerA === 4 && ownerA !== ownerB) affinity -= 150;
            if (ownerB === 4 && ownerA !== ownerB) affinity -= 150;
        }

        // 正规军与独立商船之间的被动和平光环
        if (B.type === 'freighter' && ownerA !== 3 && ownerA !== 4) {
            affinity += 50;
        }

        // 3. 记忆系统（临时仇恨）
        // 如果A记恨B，降低好感
        if (A.memory && A.memory[bTrueId] !== undefined) {
            affinity += A.memory[bTrueId];
        }

        // 如果A记恨B的归属阵营（这里暂时简化为只看个人仇恨，派系外交后续可在此扩展）

        return affinity;
    }

    /**
     * 修改实体A对实体B的仇恨（通常在受到伤害时调用）
     * @param target 受到影响的实体 (记仇者)
     * @param shooter 来源实体 (被记恨者)
     * @param amount 改变的数值，负数为降低好感(增加仇恨)
     */
    static modifyAffinity(target: any, shooter: any, amount: number) {
        if (!target || !shooter) return;
        if (!target.memory) target.memory = {};
        
        target.memory[shooter.id] = (target.memory[shooter.id] || 0) + amount;
        
        // 触发自动反击逻辑：如果原本没有目标，且好感度降为敌对，则自动锁定来源
        if (target.memory[shooter.id] < -50) {
            if (!target.target || Math.random() < 0.3) {
                target.target = shooter;
            }
        }
    }
}
