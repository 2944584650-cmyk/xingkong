import { GameConfig } from '../config.js';
import { EventBus } from '../utils/EventBus.js';

export class MainMenu extends Phaser.Scene {
    constructor() {
        super('MainMenu');
    }

    // 预加载资源，这样后面的场景都可以直接用
    preload() {
        this.load.image('background', GameConfig.assets.images.background);
        this.load.image('logo', GameConfig.assets.images.logo);
        this.load.spritesheet('ship', GameConfig.assets.spritesheets.ship.path, { frameWidth: GameConfig.assets.spritesheets.ship.frameWidth, frameHeight: GameConfig.assets.spritesheets.ship.frameHeight });
        this.load.image('convoy', GameConfig.assets.images.convoy);
        this.load.image('spaceship', 'assets/spaceship.png');
        
        // 动态加载所有通过配置定义的舰船底盘和炮塔贴图
        if (GameConfig.HULLS) {
            Object.values(GameConfig.HULLS).forEach((hull: any) => {
                if (hull.sprite) {
                    const key = hull.sprite.replace('.png', '');
                    this.load.image(key, `assets/${hull.sprite}`);
                }
                if (hull.turretBaseSprite) {
                    const key = hull.turretBaseSprite.replace('.png', '');
                    const fileName = hull.turretBaseSprite.endsWith('.png') ? hull.turretBaseSprite : `${hull.turretBaseSprite}.png`;
                    this.load.image(key, `assets/${fileName}`);
                }
            });
        }
        
        // 加载组件(武器)相关贴图
        if (GameConfig.COMPONENTS) {
            Object.values(GameConfig.COMPONENTS).forEach(comp => {
                const sprite = comp.meta && comp.meta.sprite;
                if (sprite && sprite !== 'none' && !sprite.startsWith('icon_')) {
                    const key = sprite.replace('.png', '');
                    const fileName = sprite.endsWith('.png') ? sprite : `${sprite}.png`;
                    this.load.image(key, `assets/${fileName}`);
                }
            });
        }
    }

    create() {
        // 由于我们把 Phaser 的启动延迟到了玩家点击之后，
        // 当这个场景启动并加载完资源后，它不需要停留在主菜单，直接进入 Base 场景即可。
        this.scene.start('Base');
    }
}
