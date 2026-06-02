export class Projectile extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, texture) {
        super(scene, x, y, texture);
        
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.lifeTimer = 0;
        this.damage = 0;
        this.sourceId = null;
        this.isInstant = false; // 是否是瞬间命中（如激光）
    }

    /**
     * 发射实弹
     */
    fire(x, y, angle, speed, life, colorStr, damage, sourceId) {
        this.enableBody(true, x, y, true, true);
        this.setActive(true);
        this.setVisible(true);
        
        this.setPosition(x, y);
        this.setRotation(angle * Math.PI / 180);
        
        // 使用原生物理引擎设定速度
        this.scene.physics.velocityFromAngle(angle, speed, this.body.velocity);
        
        this.lifeTimer = life;
        this.damage = damage;
        this.sourceId = sourceId;
        this.isInstant = false;

        // 如果传入了颜色字符串（如 '#ff0000'），将其转换为 Phaser 的色值并进行着色
        if (colorStr) {
            const colorInt = Phaser.Display.Color.HexStringToColor(colorStr).color;
            this.setTint(colorInt);
        }
        
        // 稍微拉伸一下贴图让它看起来像激光弹丸
        this.setScale(2.0, 0.5); 
    }

    /**
     * 激光专属逻辑 (不需要物理移动，只需在目标和源之间画一条线)
     */
    fireLaser(startX, startY, targetX, targetY, colorStr, damage, sourceId) {
        // 激光不由普通的 Sprite 移动来表现，这里只做数据载体，具体视觉表现由场景的 Graphics 接管
        this.setPosition(targetX, targetY); // 把碰撞体直接放到目标身上
        this.body.setVelocity(0, 0);
        
        this.lifeTimer = 0.1; // 激光存留时间极短
        this.damage = damage;
        this.sourceId = sourceId;
        this.isInstant = true;
        
        this.setActive(true);
        this.setVisible(false); // 激光精灵本身不显示，场景层会画线
    }

    preUpdate(time, delta) {
        super.preUpdate(time, delta);
        
        const dt = delta / 1000;
        this.lifeTimer -= dt;

        if (this.lifeTimer <= 0) {
            this.despawn();
        }
    }

    despawn() {
        this.setActive(false);
        this.setVisible(false);
        this.body.stop();
    }
}
