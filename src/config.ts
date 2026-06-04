/**
 * 游戏全局配置文件
 * 这里集中了游戏的所有可调整参数，方便进行游戏平衡和UI设计的调整。
 */
import EquipmentData from '../json/EquipmentData.json';
import ModuleData from '../json/ModuleData.json';

export const GameConfig = {
    // --- 基础设置 ---
    game: {
        title: 'AI Driven Space Shooter',
        width: 1280,
        height: 720,
        backgroundColor: '#000000',
        debug: false, // 开启物理调试框
    },

    // --- 玩家设置 ---
    player: {
        startPos: { x: 150, y: 360 },
        speed: 400,
        baseHp: 3,
        shieldHpBonus: 2,
        hitbox: { width: 100, height: 40 },
        fireRate: {
            base: 150, // 毫秒
            min: 50,
            levelReduction: 20 // 每级减少的射击间隔
        },
        damage: {
            base: 1,
            levelBonus: 0.5,
            laserMultiplier: 0.8 // 激光伤害倍率
        }
    },

    // --- 敌人设置 ---
    enemy: {
        spawnDelay: 1500, // 毫秒
        spawnX: 1350,
        yMin: 50,
        yMax: 670,
        scale: 1.2,
        baseHp: 2,
        hpGrowthRate: 5, // 每击杀多少个敌人血量+1
        speed: {
            min: -300,
            max: -150,
            difficultyFactor: 5 // 难度系数
        },
        shootDelay: {
            min: 1000,
            max: 2000
        },
        bulletSpeed: 250
    },

    // --- 经济与奖励 ---
    economy: {
        baseKillReward: 15,
        prices: {
            hpUpgradeBase: 100, // 基础价格 * 等级
            weaponUpgradeBase: 150, // 基础价格 * 等级
        }
    },

    // --- 资源路径 ---
    assets: {
        images: {
            background: 'assets/space.png',
            logo: 'assets/phaser.png',
            enemy: 'assets/empire_fighter.png',
            convoy: 'assets/freighter.png'
        },
        spritesheets: {
            ship: { path: 'assets/spaceship.png', frameWidth: 176, frameHeight: 96 }
        }
    },

    // --- 舰船设计局：船体底盘 (Hulls) ---
    // 船体只提供基础属性、贴图外观和槽位数量，不绑定具体的武器。
    // [REF] 数据源已抽离至 src/data/EquipmentData.js
    HULLS: EquipmentData.HULLS,

    // --- 舰船设计局：组件字典 (Components) ---
    // [REF] 数据源已抽离至 src/data/EquipmentData.js
    COMPONENTS: EquipmentData.COMPONENTS,

    // --- 空间站建造局：建筑模块字典 (Modules) ---
    // 为未来的模块化建造系统预留的数据接口
    MODULES: ModuleData.MODULES,
    
    // --- 空间站建造局：内部建筑字典 (Internal Modules) ---
    INTERNAL_MODULES: (ModuleData as any).INTERNAL_MODULES || {},

    // --- UI 样式 ---
    ui: {
        fonts: {
            main: 'Arial',
            code: 'Courier New'
        },
        colors: {
            text: '#ffffff',
            primary: '#00ff00',   // 绿色
            secondary: '#ffaa00', // 橙色
            danger: '#ff0000',    // 红色
            info: '#00ffff',      // 青色
            warning: '#ffff00',   // 黄色
            darkBg: '#222222',
            buttonHover: '#444444',
            panelBg: '#000a1a',
            border: '#00aaff'
        },
        textStyles: {
            header: { fontFamily: 'Arial', fontSize: 40, fontStyle: 'bold' },
            subHeader: { fontFamily: 'Arial', fontSize: 32, fontStyle: 'bold' },
            body: { fontFamily: 'Arial', fontSize: 24 },
            code: { fontFamily: 'Courier New', fontSize: 28 },
            small: { fontFamily: 'Arial', fontSize: 16 }
        }
    },
    
    // --- 文本内容 ---
    texts: {
        mainMenu: {
            continue: '🛰️ 继续任务 (Continue)',
            newGame: '🆕 新的征程 (New Game)',
            settings: '⚙️ 模型设置 (API Settings)',
            newGameConfirm: '警告：这将会清空你当前的自动存档（包括星币、装备、对话进度等）！确定要重新开始吗？'
        },
        game: {
            startHint: 'Click screen to Focus!\nArrow Keys to Move, SPACE to Shoot',
            returnToBase: '🚀 返回基地 (Return to Base)'
        },
        base: {
            topBar: (credits) => `💰 星币 (Credits): ${credits}`,
            backToMenu: '⬅ 退回主菜单',
            launch: '🚀 立即出击',
            shopBuy: '购买升级',
            shopNoMoney: '星币不足！去战场多杀点敌人吧。'
        }
    },

    // --- 阵营装配预设 (Faction Presets) ---
    // 定义不同阵营或单位在刷出时，使用什么底盘以及配套什么零件
    FACTION_PRESETS: {
        'empire_fighter': {
            hullId: 'hull_empire_s',
            slots: { 'W1': 'laser_mk1', 'D1': 'armor_titanium', 'E1': 'engine_military_s' }
        },
        'alliance_fighter': {
            hullId: 'hull_alliance_s',
            slots: { 'W1': 'laser_mk1', 'A1': 'ai_basic', 'E1': 'engine_basic_s' }
        },
        'scavenger_fighter': {
            hullId: 'hull_scavenger_s',
            slots: { 'W1': 'kinetic_cannon', 'D1': 'armor_titanium', 'E1': 'engine_basic_s' }
        },
        'cult_fighter': {
            hullId: 'hull_cult_s',
            slots: { 'W1': 'plasma_beam', 'W2': 'plasma_beam', 'E1': 'engine_military_s' }
        },
        'basic_freighter': {
            'hullId': 'hull_freighter_s',
            'slots': { 'W1': 'kinetic_artillery', 'D1': 'armor_regen', 'U1': 'cargo_expander', 'E1': 'engine_heavy_m' }
        },
        'basic_miner': {
            'hullId': 'hull_miner_s',
            'slots': { 'W1': 'laser_mk1', 'D1': 'armor_titanium', 'U1': 'cargo_expander', 'E1': 'engine_heavy_m' }
        },
        'empire_destroyer': {
            hullId: 'destroyer_empire',
            slots: { 
                'W1': 'laser_mk1', 
                'W2': 'laser_mk1',
                'T1': 'kinetic_artillery', 
                'T2': 'kinetic_artillery',
                'E1': 'engine_heavy_m'
            }
        },
        'alliance_destroyer': {
            hullId: 'destroyer_alliance',
            slots: { 
                'T1': 'kinetic_artillery_alliance', 
                'T2': 'kinetic_artillery_alliance',
                'U1': 'cargo_expander',
                'D1': 'armor_titanium',
                'D2': 'shield_basic',
                'E1': 'engine_alliance_m'
            }
        },
        'pirate_destroyer': {
            hullId: 'destroyer_pirate',
            slots: {
                'W1': 'kinetic_cannon',
                'T1': 'kinetic_cannon',
                'E1': 'engine_basic_s'
            }
        },
        'cult_destroyer': {
            hullId: 'destroyer_cult',
            slots: {
                'W1': 'void_annihilator_l',
                'W2': 'plasma_beam',
                'W3': 'plasma_beam',
                'E1': 'engine_heavy_m'
            }
        },
        'cult_cruiser': {
            hullId: 'cruiser_cult',
            slots: {
                'T1': 'plasma_beam',
                'T2': 'plasma_beam',
                'T3': 'plasma_beam',
                'T4': 'plasma_beam',
                'T5': 'plasma_beam',
                'T6': 'plasma_beam',
                'T7': 'plasma_beam',
                'T8': 'plasma_beam',
                'T9': 'plasma_beam',
                'T10': 'plasma_beam',
                'T11': 'plasma_beam',
                'T12': 'plasma_beam',
                'T13': 'plasma_beam',
                'E1': 'engine_heavy_m'
            }
        },
        'attack_drone_gongji': {
            hullId: 'drone_basic',
            slots: {
                'W1': 'laser_mk1',
                'E1': 'engine_drone_s'
            }
        },
        'drone_builder': {
            hullId: 'drone_basic',
            slots: {
                'W1': 'builder_beam_mk1',
                'E1': 'engine_drone_s'
            }
        },
        'mine_drone_preset': {
            hullId: 'drone_basic',
            slots: {
                'W1': 'miner_beam_mk1',
                'E1': 'engine_drone_s'
            }
        }
    },

    // --- LLM 默认设置 ---
    llm: {
        defaultContextLength: 4096,
        defaultMaxTokens: 2048,
        defaultApiUrl: 'https://api.deepseek.com/chat/completions',
        defaultModel: 'deepseek-chat',
        defaultLore: "你是一个科幻背景下的AI记录员。\n你现在是游戏《前线基地》的文字冒险系统(DM)。你需要根据玩家的动作，以第二人称(\"你\")描述发生的生活片段、人物对话。要求：富有沉浸感，详细且生动，绝不跳出角色。"
    }
};
