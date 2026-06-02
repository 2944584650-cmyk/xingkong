import React, { useState, useEffect } from 'react';
import { ZuobiPanel } from './zuobi';
import { MainUI } from './components/MainUI';
import { ReactMainMenu } from './components/ReactMainMenu';
import { ReactSettings } from './components/ReactSettings';
import { ReactNewGame } from './components/ReactNewGame';
import { ReactSaveLoadUI } from './components/ReactSaveLoadUI';
import { EventBus } from './utils/EventBus';
import ZheZhao from './components/ZheZhao';
import { initPhaserGame } from './main';

const App: React.FC = () => {
    // 根据 localStorage 判断是否有初始进度，避免强行跳回会导致数据重置的页面
    const hasStarted = !!localStorage.getItem('game_has_started');
    const [sceneState, setSceneState] = useState<'MAINMENU' | 'INGAME' | 'SETTINGS' | 'NEWGAME_SETUP'>(hasStarted ? 'MAINMENU' : 'MAINMENU');
    const [showSaveLoadUI, setShowSaveLoadUI] = useState(false);

    useEffect(() => {
        // Listen for events to toggle the main UI visibility based on whether we are in the main menu or in game
        const handleEnterGame = () => {
            setSceneState('INGAME');
            initPhaserGame(); // 只有在进入游戏时才初始化 Phaser
        };
        const handleExitGame = () => {
            setSceneState('MAINMENU');
        };
        const handleStartSettings = () => {
            setSceneState('SETTINGS');
        };
        const handleStartNewGameSetup = () => {
            setSceneState('NEWGAME_SETUP');
        };
        const handleReturnMainMenu = () => {
            setSceneState('MAINMENU');
        };
        const handleShowSaveMenu = () => {
            setShowSaveLoadUI(true);
        };

        // Assume game emits these when starting/exiting the base scene
        EventBus.addEventListener('game_started', handleEnterGame);
        EventBus.addEventListener('game_ended', handleExitGame);
        
        // Listen for new ReactMainMenu events
        EventBus.addEventListener('MAINMENU_CONTINUE', handleEnterGame);
        EventBus.addEventListener('MAINMENU_NEWGAME', handleStartNewGameSetup); // 不再直接进游戏，而是跳转到开局设定
        EventBus.addEventListener('NEWGAME_START', handleEnterGame); // 在开局设定里点击“开启旅程”才进游戏
        EventBus.addEventListener('MAINMENU_SETTINGS', handleStartSettings);
        EventBus.addEventListener('MAINMENU_RETURN', handleReturnMainMenu);
        EventBus.addEventListener('SHOW_SAVE_MENU', handleShowSaveMenu);

        return () => {
            EventBus.removeEventListener('game_started', handleEnterGame);
            EventBus.removeEventListener('game_ended', handleExitGame);
            EventBus.removeEventListener('MAINMENU_CONTINUE', handleEnterGame);
            EventBus.removeEventListener('MAINMENU_NEWGAME', handleStartNewGameSetup);
            EventBus.removeEventListener('NEWGAME_START', handleEnterGame);
            EventBus.removeEventListener('MAINMENU_SETTINGS', handleStartSettings);
            EventBus.removeEventListener('MAINMENU_RETURN', handleReturnMainMenu);
            EventBus.removeEventListener('SHOW_SAVE_MENU', handleShowSaveMenu);
        };
    }, []);

    // Reset game-container to full screen when not in game
    useEffect(() => {
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            if (sceneState !== 'INGAME') {
                gameContainer.style.width = '100vw';
                gameContainer.style.height = '100vh';
            }
        }
    }, [sceneState]);

    return (
        <>
            {sceneState === 'MAINMENU' && <ReactMainMenu />}
            {sceneState === 'SETTINGS' && <ReactSettings />}
            {sceneState === 'NEWGAME_SETUP' && <ReactNewGame />}
            {sceneState === 'INGAME' && <MainUI />}
            {showSaveLoadUI && <ReactSaveLoadUI mode="SAVE" onClose={() => setShowSaveLoadUI(false)} />}
            <ZuobiPanel />
            <ZheZhao />
        </>
    );
};

export default App;
