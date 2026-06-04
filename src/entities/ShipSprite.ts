import { GameConfig } from '../config.js';

export class ShipSprite extends Phaser.GameObjects.Container {
    constructor(scene, x, y, defaultTexture) {
        super(scene, x, y);
        scene.add.existing(this);

        this.hullSprite = scene.add.sprite(0, 0, defaultTexture);
        this.add(this.hullSprite);
        
        this.turretSprites = [];
        this.entRef = null; // 绑定的微观实体引用
        
        // 选中高亮光环
        this.selectRing = scene.add.graphics();
        this.add(this.selectRing);
        this.isSelected = false;

        // 引擎尾焰粒子 (为“大作感”添加发光与混合模式)
        if (scene.add.particles) {
            this.engineParticles = scene.add.particles(0, 0, 'spaceship', {
                scale: { start: 0.2, end: 0 },
                alpha: { start: 0.6, end: 0 },
                lifespan: 300,
                blendMode: 'ADD',
                tint: 0x00ffff,
                frequency: -1 // 默认不发射，运动时再打开
            });
            // 尾焰在底盘下方，但作为场景级别的对象更方便控制绝对坐标
            this.engineParticles.setDepth(1);
        }
        
        // 血条
        this.hpBarBg = scene.add.graphics();
        this.hpBarFill = scene.add.graphics();
        this.add(this.hpBarBg);
        this.add(this.hpBarFill);

        // 设置深度
        this.setDepth(2);

        // 绑定原生交互事件
        this.hullSprite.setInteractive({ cursor: 'pointer' });
        this.hullSprite.on('pointerdown', (pointer, localX, localY, event) => {
            event.stopPropagation(); // 阻止事件冒泡到场景背景
            if (pointer.button === 2) {
                document.dispatchEvent(new CustomEvent('radar_right_click', { 
                    detail: { x: this.x, y: this.y, screenX: pointer.event.clientX, screenY: pointer.event.clientY, targetShip: this.entRef }
                }));
            } else {
                document.dispatchEvent(new CustomEvent('radar_left_click', {
                    detail: { x: this.x, y: this.y, screenX: pointer.event.clientX, screenY: pointer.event.clientY, targetShip: this.entRef, targetNode: null }
                }));
            }
        });
    }

    updateData(entData, isSelected) {
        this.entRef = entData;
        
        // 1. 同步位置和旋转
        this.setPosition(entData.x, entData.y);
        this.setRotation(entData.rotation * Math.PI / 180);

        // 处理引擎尾焰
        if (this.engineParticles) {
            // 根据速度决定是否发射尾焰
            const speed = Math.hypot(entData.vx || 0, entData.vy || 0);
            if (speed > 5) {
                // 计算尾焰发射点 (在飞船尾部)
                const hw = this.hullSprite.displayWidth;
                const hh = this.hullSprite.displayHeight;
                const radius = Math.max(hw, hh) / 2;
                const tailX = entData.x - Math.cos(this.rotation) * radius * 0.8;
                const tailY = entData.y - Math.sin(this.rotation) * radius * 0.8;
                
                this.engineParticles.emitParticleAt(tailX, tailY);
                // 也可以根据阵营改变尾焰颜色
                if (entData.shipRef) {
                    if (entData.shipRef.factionId === 1) this.engineParticles.setParticleTint(0xff5500); // 帝国红
                    else if (entData.shipRef.factionId === 2) this.engineParticles.setParticleTint(0x0055ff); // 联邦蓝
                    else this.engineParticles.setParticleTint(0x00ffff);
                }
            }
        }

        // 2. 同步底盘贴图
        let spriteKey = 'spaceship'; // default to spaceship instead of missing player texture
        if (entData.shipRef && entData.shipRef.hullId) {
            const hullDef = GameConfig.HULLS[entData.shipRef.hullId];
            if (hullDef && hullDef.sprite) {
                spriteKey = hullDef.sprite.replace('.png', '');
                this.hullSprite.setTexture(spriteKey);
                if (hullDef.spriteSize) {
                    this.hullSprite.setDisplaySize(hullDef.spriteSize.width, hullDef.spriteSize.height);
                }
            }
        } else {
            this.hullSprite.setTexture(spriteKey);
            this.hullSprite.setDisplaySize(20, 20);
        }

        // 3. 状态表现 (建造虚影 或 受击闪白)
        if (entData.shipRef && entData.shipRef.isBuilding) {
            // 建造状态呈现全息虚影
            this.hullSprite.setAlpha(0.5);
            this.hullSprite.setTint(0x00ffff);
            // 也可以启用添加混合模式增加科技感
            if (this.hullSprite.blendMode !== Phaser.BlendModes.ADD) {
                this.hullSprite.setBlendMode(Phaser.BlendModes.ADD);
            }
        } else {
            // 正常状态
            if (this.hullSprite.blendMode !== Phaser.BlendModes.NORMAL) {
                this.hullSprite.setBlendMode(Phaser.BlendModes.NORMAL);
            }
            this.hullSprite.setAlpha(1);
            if (entData.hitFlash > 0) {
                this.hullSprite.setTintFill(0xffffff);
            } else {
                this.hullSprite.clearTint();
            }
        }

        // 4. 同步炮塔
        this.syncTurrets(entData);

        // 5. 同步选中状态和血条
        this.updateUI(entData, isSelected);
    }

    syncTurrets(entData) {
        // 如果没有武器数据，清空炮塔
        if (!entData.shipRef || !entData.shipRef.activeWeapons) {
            this.turretSprites.forEach(t => t.sprite && t.sprite.destroy());
            this.turretSprites = [];
            return;
        }

        const weps = entData.shipRef.activeWeapons;
        
        // 过滤出真正需要渲染的炮塔模型
        const visibleWeps = weps.filter(wep => wep.sprite && wep.sprite !== 'none');
        
        // 检查是否需要重新构建炮塔贴图组（数量不匹配，或者贴图Key变了）
        let needsRebuild = false;
        if (this.turretSprites.length !== visibleWeps.length) {
            needsRebuild = true;
        } else {
            for (let i = 0; i < visibleWeps.length; i++) {
                const expectedKey = visibleWeps[i].sprite.replace('.png', '');
                const currentSprite = this.turretSprites[i].sprite;
                if (!currentSprite || currentSprite.texture.key !== expectedKey) {
                    needsRebuild = true;
                    break;
                }
            }
        }

        if (needsRebuild) {
            // 彻底销毁旧的炮塔精灵
            this.turretSprites.forEach(t => t.sprite && t.sprite.destroy());
            this.turretSprites = [];
            
            // 重新创建新的炮塔精灵
            visibleWeps.forEach(wep => {
                const key = wep.sprite.replace('.png', '');
                const ts = this.scene.add.sprite(0, 0, key);
                this.add(ts);
                this.turretSprites.push({ sprite: ts, wepRef: wep });
            });
        }

        // 更新各炮塔状态
        for (let i = 0; i < visibleWeps.length; i++) {
            const wep = visibleWeps[i];
            const tsData = this.turretSprites[i];
            if (!tsData || !tsData.sprite) continue;
            
            const ts = tsData.sprite;
            
            // 局部坐标偏移
            const wx = wep.x || 0;
            const wy = wep.y || 0;
            
            ts.setPosition(wx, wy);
            
            if (wep.spriteSize) {
                ts.setDisplaySize(wep.spriteSize.width, wep.spriteSize.height);
            }

            // 设置旋转中心
            if (wep.origin) {
                // 如果有自定义旋转中心，需要先确保贴图加载完毕且有原始尺寸
                let tw = ts.texture.getSourceImage().width || ts.width;
                let th = ts.texture.getSourceImage().height || ts.height;
                if (tw > 0 && th > 0) {
                    let ox = wep.origin.x / tw;
                    let oy = wep.origin.y / th;
                    ts.setOrigin(ox, oy);
                } else {
                    ts.setOrigin(0.5, 0.5);
                }
            } else {
                ts.setOrigin(0.5, 0.5);
            }
            
            // 相对旋转系计算：因为 Container 本身已经包含 rotation，所以炮塔内部只需补偿相对角度
            const imgRotOffset = wep.imgRotOffset || 0;
            // 获取炮塔的绝对朝向（如果是在Base中控制，就是 wep.rotation，如果没有则默认为飞船朝向）
            const absoluteRot = (wep.rotation !== undefined) ? wep.rotation : entData.rotation;
            
            // 计算相对容器的旋转角度
            let targetRot = absoluteRot - entData.rotation + imgRotOffset;
            ts.setRotation(targetRot * Math.PI / 180);
        }
    }

    updateUI(entData, isSelected) {
        const hw = this.hullSprite.displayWidth;
        const hh = this.hullSprite.displayHeight;
        const maxR = Math.max(hw, hh) / 2 + 10;
        
        const zoom = this.scene.cameras.main ? this.scene.cameras.main.zoom : 1;
        const invZoom = 1 / zoom;

        // 选中光环 (反向旋转抵消容器旋转，使其看起来是静态的)
        this.selectRing.clear();
        this.selectRing.setRotation(-this.rotation);
        if (isSelected) {
            this.selectRing.lineStyle(2, 0x00ff00, 1); // 绿色选中框
            // 绘制带有四个角的瞄准框效果
            const r = maxR;
            const len = r * 0.3;
            // 左上角
            this.selectRing.beginPath();
            this.selectRing.moveTo(-r, -r + len);
            this.selectRing.lineTo(-r, -r);
            this.selectRing.lineTo(-r + len, -r);
            this.selectRing.strokePath();
            // 右上角
            this.selectRing.beginPath();
            this.selectRing.moveTo(r - len, -r);
            this.selectRing.lineTo(r, -r);
            this.selectRing.lineTo(r, -r + len);
            this.selectRing.strokePath();
            // 右下角
            this.selectRing.beginPath();
            this.selectRing.moveTo(r, r - len);
            this.selectRing.lineTo(r, r);
            this.selectRing.lineTo(r - len, r);
            this.selectRing.strokePath();
            // 左下角
            this.selectRing.beginPath();
            this.selectRing.moveTo(-r + len, r);
            this.selectRing.lineTo(-r, r);
            this.selectRing.lineTo(-r, r - len);
            this.selectRing.strokePath();
        }

        // 血条或进度条 (在头顶固定位置，同样反向旋转抵消)
        this.hpBarBg.clear();
        this.hpBarFill.clear();
        this.hpBarBg.setRotation(-this.rotation);
        this.hpBarFill.setRotation(-this.rotation);
        
        const barW = maxR * 1.5;
        const barH = 3;
        const by = -maxR - 10;
        const bx = -barW / 2;

        if (entData.shipRef && entData.shipRef.isBuilding) {
            // 建造中的飞船，绘制蓝色建造进度条
            this.hpBarBg.fillStyle(0x002244, 0.5);
            this.hpBarBg.fillRect(bx, by, barW, barH);
            
            // 读取真实的 buildProgress
            let buildProgress = 0;
            if (entData.shipRef.buildProgress !== undefined) {
                buildProgress = Math.max(0, Math.min(1, entData.shipRef.buildProgress / 100));
            }
            
            this.hpBarFill.fillStyle(0x00ffff, 0.8);
            this.hpBarFill.fillRect(bx, by, barW * buildProgress, barH);
            
        } else {
            // 战损才显示血条，或者被选中
            if (isSelected || (entData.hp < entData.maxHp && entData.hp > 0)) {
                this.hpBarBg.fillStyle(0xff0000, 0.5);
                this.hpBarBg.fillRect(bx, by, barW, barH);
                
                const hpRatio = Math.max(0, Math.min(1, entData.hp / entData.maxHp));
                this.hpBarFill.fillStyle(0x00ff00, 0.8);
                this.hpBarFill.fillRect(bx, by, barW * hpRatio, barH);
            }
        }
    }

    destroy(fromScene) {
        if (this.turretSprites) {
            this.turretSprites.forEach(t => t.sprite && t.sprite.destroy());
            this.turretSprites = [];
        }
        if (this.selectRing) this.selectRing.destroy();
        if (this.hpBarBg) this.hpBarBg.destroy();
        if (this.hpBarFill) this.hpBarFill.destroy();
        if (this.engineParticles) this.engineParticles.destroy();
        super.destroy(fromScene);
    }
}
