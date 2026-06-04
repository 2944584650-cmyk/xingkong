// @ts-ignore
const Phaser = window.Phaser;
import { EventBus } from '../utils/EventBus';

// 新版 SaveManager 只作为一个极简的桥梁，用来暂停游戏并派发事件唤起 React UI
export class SaveManager extends Phaser.Scene {
    constructor() {
        super('SaveManager');
    }

    create() {
        // 游戏内调出保存菜单时，派发 React 事件让上层 UI 渲染
        EventBus.dispatchEvent(new CustomEvent('SHOW_SAVE_MENU'));
        
        // 我们不需要在这个 Scene 里渲染任何东西了，直接在 Base 等待或者干脆停止自己
        // 为了防止 React 关闭后依然停留在 SaveManager 阻塞游戏，我们可以让 ReactSaveLoadUI 的 onClose 恢复 Base
        // 但既然此时处于 React 控制之下，其实最简单的就是把自己关掉，恢复 Base。然后 ReactUI 会作为 Overlay 盖在 Base 之上
        this.scene.stop();
        this.scene.resume('Base');
    }
}
