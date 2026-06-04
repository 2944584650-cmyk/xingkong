import React, { useRef } from 'react';
import { EventBus } from '../utils/EventBus';
import { GameConfig } from '../config';
import { PlayerManager } from '../managers/PlayerManager';
import { ShipManager } from '../managers/ShipManager';
import { BuildingManager } from '../managers/BuildingManager';
import { WorldbookManager } from '../scenes/WorldbookManager';
import { ReactSaveLoadUI } from './ReactSaveLoadUI';

export const ReactMainMenu: React.FC = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showSaveLoadUI, setShowSaveLoadUI] = React.useState(false);

    const getKeepKeys = () => [
        // 大模型配置
        'llm_preset_name', 'llm_api_url', 'llm_model', 'llm_api_key',
        'llm_temperature', 'llm_top_p', 'llm_presence_penalty', 'llm_frequency_penalty',
        'llm_max_tokens', 'llm_context_length', 'llm_show_raw', 'llm_safe_mode',
        'llm_lorebook', 'llm_high_priority', 'llm_raw_preset',
        // 玩家自定义的系统级预设槽（如果有的话）
        'llm_save_slots'
    ];

    const clearGameProgress = () => {
        const keepKeys = getKeepKeys();
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // 改为白名单 + 严格保护 save_bundle_slot_x 整个系列
            if (key && !keepKeys.includes(key) && !key.startsWith('save_bundle_')) {
                keysToRemove.push(key);
            }
        }
        
        // --- 第一步：先清空所有相关 Manager 的内存缓存，防止单例脏数据存留并且触发保存 ---
        try {
            if ((PlayerManager as any).reset) (PlayerManager as any).reset();
            if ((ShipManager as any).reset) (ShipManager as any).reset();
            if ((BuildingManager as any).reset) (BuildingManager as any).reset();
            if ((WorldbookManager as any).reset) (WorldbookManager as any).reset();
        } catch (e) {
            console.error("重置内存状态失败，但这通常不影响硬刷新", e);
        }

        // 一口气干掉所有进度
        keysToRemove.forEach(k => localStorage.removeItem(k));
    };

    const handleNewGame = () => {
        if(window.confirm(GameConfig.texts.mainMenu.newGameConfirm)) {
            clearGameProgress();

            // 点击新游戏时，立即赋予默认的兜底星区，防止切换到设定画面瞬间其他系统读取不到而报错
            localStorage.setItem('current_sector', '创世星柱废墟');
            
            EventBus.dispatchEvent(new CustomEvent('MAINMENU_NEWGAME'));
        }
    };

    const handleLoadGame = () => {
        setShowSaveLoadUI(true);
    };

    const handleSettings = () => {
        EventBus.dispatchEvent(new CustomEvent('MAINMENU_SETTINGS'));
    };

    const handleReset = () => {
        if(window.confirm('【危险操作】这会彻底清空您浏览器中关于本游戏的所有本地存储，包括 API Key、模型设置、聊天历史和游戏进度。\n\n您确定要进行彻底格式化吗？（用于模拟新玩家首次打开游戏）')) {
            localStorage.clear();
            // 即使是恢复出厂设置，也最好保证立刻有一个最基础的星区标识，以防刷新后引擎抢跑报错
            localStorage.setItem('current_sector', '创世星柱废墟');
            alert('所有本地数据已清空。游戏现在处于纯净的初始状态！');
            window.location.reload(); // 刷新页面
        }
    };

    const buttonStyle: React.CSSProperties = {
        padding: '10px 20px',
        backgroundColor: GameConfig.ui.colors.darkBg,
        border: 'none',
        fontFamily: GameConfig.ui.textStyles.header.fontFamily,
        fontSize: '32px',
        fontWeight: 'bold',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        textAlign: 'center',
        position: 'relative'
    };

    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
            pointerEvents: 'auto', // 拦截所有点击
            background: `url(${GameConfig.assets.images.background}) center center / cover no-repeat` // 直接使用背景图
        }}>
            
            {showSaveLoadUI && (
                <ReactSaveLoadUI mode="LOAD" onClose={() => setShowSaveLoadUI(false)} />
            )}

            {/* Logo 动画 */}
            <div style={{
                position: 'absolute',
                top: '25%',
                transform: 'translateY(-50%)',
                animation: 'float 3s ease-in-out infinite'
            }}>
                <img src={GameConfig.assets.images.logo} alt="Game Logo" style={{ maxWidth: '80vw' }} />
            </div>

            <style>
                {`
                    @keyframes float {
                        0% { transform: translateY(-50%) translateY(0px); }
                        50% { transform: translateY(-50%) translateY(15px); }
                        100% { transform: translateY(-50%) translateY(0px); }
                    }
                `}
            </style>

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                marginTop: '25vh', // 调整按钮位置，给 Logo 留出空间
                pointerEvents: 'auto',
                zIndex: 2
            }}>
                <button 
                    onClick={handleNewGame}
                    style={buttonStyle}
                    onMouseOver={(e) => (e.target as HTMLButtonElement).style.backgroundColor = GameConfig.ui.colors.buttonHover}
                    onMouseOut={(e) => (e.target as HTMLButtonElement).style.backgroundColor = GameConfig.ui.colors.darkBg}
                >
                    <span style={{ color: GameConfig.ui.colors.secondary }}>{GameConfig.texts.mainMenu.newGame}</span>
                </button>

                <button 
                    onClick={handleLoadGame}
                    style={buttonStyle}
                    onMouseOver={(e) => (e.target as HTMLButtonElement).style.backgroundColor = GameConfig.ui.colors.buttonHover}
                    onMouseOut={(e) => (e.target as HTMLButtonElement).style.backgroundColor = GameConfig.ui.colors.darkBg}
                >
                    <span style={{ color: GameConfig.ui.colors.primary }}>📂 载入存档 (JSON)</span>
                </button>

                <button 
                    onClick={handleSettings}
                    style={buttonStyle}
                    onMouseOver={(e) => (e.target as HTMLButtonElement).style.backgroundColor = GameConfig.ui.colors.buttonHover}
                    onMouseOut={(e) => (e.target as HTMLButtonElement).style.backgroundColor = GameConfig.ui.colors.darkBg}
                >
                    <span style={{ color: GameConfig.ui.colors.info }}>{GameConfig.texts.mainMenu.settings}</span>
                </button>

                <button 
                    onClick={handleReset}
                    style={{ ...buttonStyle, backgroundColor: '#220000', fontSize: '20px', marginTop: '20px' }}
                    onMouseOver={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#440000'}
                    onMouseOut={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#220000'}
                >
                    <span style={{ color: '#ff5555' }}>⚠️ 恢复出厂设置 (清除API与所有存档)</span>
                </button>
            </div>
        </div>
    );
};
