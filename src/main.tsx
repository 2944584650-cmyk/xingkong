import { MainMenu } from './scenes/MainMenu.js';
import { Base } from './scenes/Base.js';
import { SaveManager } from './scenes/SaveManager.js';
import { WorldbookManager } from './scenes/WorldbookManager.js';
import { RadarScene } from './scenes/RadarScene.js';
import { StarmapScene } from './scenes/StarmapScene.js';
import { GameConfig } from './config.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// 渲染 React UI 覆盖层
let root = (window as any).__REACT_ROOT__;
const rootElement = document.getElementById('react-root');
if (rootElement) {
    if (!root) {
        root = createRoot(rootElement);
        (window as any).__REACT_ROOT__ = root;
    }
    root.render(<App />);
}

const config = {
    type: Phaser.AUTO,
    title: GameConfig.game.title,
    description: 'Game + LLM Demo',
    parent: 'game-container',
    width: '100%',
    height: '100%',
    backgroundColor: GameConfig.game.backgroundColor,
    pixelArt: true,
    dom: {
        createContainer: true
    },
    scene: [
        MainMenu,
        Base,
        SaveManager,
        WorldbookManager,
        RadarScene,
        StarmapScene
    ],
    resolution: window.devicePixelRatio || 1, 
    scale: {
        mode: Phaser.Scale.RESIZE, // Use RESIZE to automatically fit the parent container
        parent: 'game-container',
        width: '100%',
        height: '100%',
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: GameConfig.game.debug
        }
    }
};

// 禁用浏览器默认右键菜单，为 RTS 指挥系统做准备
document.addEventListener('contextmenu', event => event.preventDefault());

export const initPhaserGame = () => {
    // 防止重复初始化
    if ((window as any).game) return;

    const game = new Phaser.Game(config);
    // 暴露游戏实例到全局，以便 React 组件能够调用
    (window as any).game = game;

    // Use ResizeObserver to ensure the game accurately matches the game-container dimensions
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (entry.target.id === 'game-container') {
                const width = entry.contentRect.width;
                const height = entry.contentRect.height;
                if (width > 0 && height > 0) {
                    game.scale.resize(width, height);
                }
            }
        }
    });

    const container = document.getElementById('game-container');
    if (container) {
        resizeObserver.observe(container);
    }
};
