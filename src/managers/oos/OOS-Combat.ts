/**
 * OOS 纯数值战斗结算
 * 将武器面板转化为秒伤，直接扣除目标血量
 */
export function applyDamage(attacker: any, target: any, dt: number) {
    let dps = 0;
    if (attacker.activeWeapons) {
        attacker.activeWeapons.forEach((w: any) => {
            const dmg = w.stats.attack || 10;
            const cooldown = (w.stats.fireRate || 1.5); 
            dps += dmg / cooldown;
        });
    }
    if (dps === 0) dps = 10; // 保底伤害

    target.stats.hp -= dps * dt;
    
    target.state = 'COMBAT'; 
    attacker.state = 'COMBAT';
    attacker.combatTimer = 2.0;
    target.combatTimer = 2.0;
    
    attacker.combatTargetId = target.id;
    if (!target.combatTargetId) {
        target.combatTargetId = attacker.id;
    }
}
