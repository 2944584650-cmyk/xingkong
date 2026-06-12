// @ts-nocheck
import { GameConfig } from '../../config.js';
import { PlayerManager } from '../../managers/PlayerManager.js';
import { LLMService } from '../../services/LLMService.js';
import { EventBus, GameEvents } from '../../utils/EventBus.js';

export async function initChatContext(scene: any, terminalDOM: any) {
    const defaultLore = GameConfig.llm.defaultLore;
    const worldbook = localStorage.getItem('llm_lorebook') || defaultLore;
    let currentSector = localStorage.getItem('current_sector');

    const systemPrompt = `以下是世界背景设定：\n${worldbook}\n当前位置：玩家在【${currentSector}】的接驳口。\n\n【DM 绝对铁律】：\n1. 财产不可侵犯：绝不能未经玩家明确同意就私自没收、扣除玩家的任何物品或战利品。\n2. 世界真实性：这个宇宙是真实残酷的物理世界。绝对禁止在剧情中加入“这只是模拟/测试”、“这只是一场梦/演习”之类的强行反转或自我加戏。\n3. 行为边界：每次只需针对玩家当前的动作给出即时反应，不要过度推演未来，绝对不要擅自给剧情强行画上“大结局”的句号。`;
    
    const lastLog = localStorage.getItem('last_mission_log');
    
    // 如果有最新战报，开启新对话
    if (lastLog) {
        scene.chatHistory = [{ role: 'system', content: systemPrompt }];
        scene.currentPoiId = 'poi-dock';
        localStorage.setItem('current_poi', 'poi-dock');
        scene.renderSectorView(terminalDOM);
        
        const modal = terminalDOM?.node?.querySelector('#text-adventure-modal');
        if (modal) modal.style.display = 'flex';

        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div class="msg-system" style="border: 1px dashed #ffaa00; padding: 10px; color: #ffaa00;">[战报同步] ${lastLog}</div>`, clear: true } }));
        
        const prompt = `(系统提示：玩家刚结束战斗，战报：【${lastLog}】。回到【${currentSector}】的停泊区。请扮演地勤或AI迎接。)`;
        await performLLMRequest(scene, terminalDOM, prompt);
        
        localStorage.removeItem('last_mission_log');
    } else {
        // 加载历史，但不自动弹出文游面板
        const saved = localStorage.getItem('llm_chat_history');
        if (saved) {
            try {
                scene.chatHistory = JSON.parse(saved);
                if (scene.chatHistory[0]?.role === 'system') scene.chatHistory[0].content = systemPrompt;
                const lastAss = [...scene.chatHistory].reverse().find(m => m.role === 'assistant');
                if (lastAss) {
                    EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div class="msg-ai" style='color: #dddddd;'>${lastAss.content.replace(/\[CMD:.*?\]/g, '').replace(/\{\{FDEP:.*?\}\}/g, '')}</div>`, clear: true } }));
                }
            } catch(e) { scene.chatHistory = [{ role: 'system', content: systemPrompt }]; }
        } else {
            scene.chatHistory = [{ role: 'system', content: systemPrompt }];
        }
    }
}

export function executePlayerMove(scene: any, terminalDOM: any, newPoiId: string, newPoiName: string) {
    if (scene.isLLMBusy) return;
    
    const input = terminalDOM?.node?.querySelector('#chat-input');
    scene.pendingPoiId = newPoiId;
    const text = `(我走进了【${newPoiName}】。请描述我在这里看到的众生百态，并根据这里的环境向我搭话。)`;
    handlePlayerAction(scene, terminalDOM, text);
}

export async function handlePlayerAction(scene: any, terminalDOM: any, text: string) {
    if (scene.isLLMBusy || !text) return;
    
    const input = terminalDOM?.node?.querySelector('#chat-input');
    if (input) input.value = '';
    
    // 显示玩家输入
    EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div class="msg-player" style='color: #ffaa00;'><b>> ${text}</b></div>`, clear: true } }));
    
    let finalSendText = text;
    
    // 如果有暂存的系统接入提示词（比如刚点开面板还没有发送），合并后一并发送
    if (scene.pendingSystemPrompt) {
        finalSendText = scene.pendingSystemPrompt + "\n(玩家动作：" + text + ")";
        scene.pendingSystemPrompt = null;
    }

    await performLLMRequest(scene, terminalDOM, finalSendText);
}

export async function performLLMRequest(scene: any, terminalDOM: any, userText: string) {
    scene.isLLMBusy = true;
    EventBus.dispatchEvent(new CustomEvent(GameEvents.TOGGLE_INPUT_STATE, { detail: true }));
    
    scene.chatHistory.push({ role: 'user', content: userText });
    saveHistory(scene);

    const replyId = 'reply-' + Date.now();
    EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div class="msg-ai" id="${replyId}" style='color: #dddddd;'>...</div>` }));

    try {
        const { fullReply, cleanReply, commands } = await LLMService.request(scene.chatHistory, (chunk: string) => {
            const el = terminalDOM?.node?.querySelector(`#${replyId}`);
            if (el) el.innerHTML = chunk.replace(/\[CMD:.*?\]/g, '').replace(/\{\{FDEP:.*?\}\}/g, '') + '_';
        });

        // 更新最终显示
        const el = terminalDOM?.node?.querySelector(`#${replyId}`);
        if (el) el.innerHTML = cleanReply;

        // 执行指令
        executeCommands(scene, commands, terminalDOM);

        // 保存
        scene.chatHistory.push({ role: 'assistant', content: fullReply });
        saveHistory(scene);
        scene.lastRawResponse = fullReply;

        // 如果有位置变更
        if (scene.pendingPoiId) {
            scene.currentPoiId = scene.pendingPoiId;
            localStorage.setItem('current_poi', scene.pendingPoiId);
            scene.pendingPoiId = null;
            scene.renderSectorView(terminalDOM);
        }

    } catch (e: any) {
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: `<div style='color:red'>Error: ${e.message}</div>` }));
        scene.chatHistory.pop(); // 回滚
    } finally {
        scene.isLLMBusy = false;
        EventBus.dispatchEvent(new CustomEvent(GameEvents.TOGGLE_INPUT_STATE, { detail: false }));
    }
}

export function executeCommands(scene: any, commands: string[], terminalDOM: any) {
    if (!commands || commands.length === 0) return;
    
    let logs: string[] = [];
    commands.forEach(cmdStr => {
        const [cmd, ...valParts] = cmdStr.split(/[:|]/);
        const val = valParts.join(':').trim();
        
        switch(cmd.toUpperCase()) {
            case 'MOD_CREDITS': case 'CREDIT':
                const cD = parseInt(val);
                PlayerManager.updateStat('credits', cD);
                logs.push(`星币 ${cD>0?'+':''}${cD}`);
                break;
            case 'ADD_EQUIP': case 'INV_ADD':
                PlayerManager.addItem(val);
                logs.push(`获得: ${val}`);
                break;
            case 'REMOVE_EQUIP': case 'INV_DEL':
                PlayerManager.removeItem(val);
                logs.push(`失去: ${val}`);
                break;
            case 'OP':
                // 选项按钮，追加到聊天框
                const optHtml = `<button class="chat-option-btn" data-text="${val}" style="margin:5px;padding:5px 10px;background:#ffaa00;color:black;border:none;border-radius:10px;cursor:pointer;">${val}</button>`;
                const chatBox = terminalDOM?.node?.querySelector('#chat-history');
                if (chatBox) chatBox.innerHTML += optHtml;
                break;
        }
    });

    if (logs.length > 0) {
        scene.playerData = PlayerManager.getStats(); // 刷新本地缓存
        const uiTopBar = terminalDOM?.node?.querySelector('#ui-top-bar');
        if (uiTopBar && typeof scene.getTopBarText === 'function') {
            uiTopBar.innerText = scene.getTopBarText();
        }
        EventBus.dispatchEvent(new CustomEvent(GameEvents.UPDATE_INVENTORY, { detail: PlayerManager.getInventory() }));
        EventBus.dispatchEvent(new CustomEvent(GameEvents.APPEND_CHAT, { detail: { html: `<div style='color:#0f0;font-size:12px;'>[系统日志] ${logs.join(', ')}</div>` } }));
    }
}

export function saveHistory(scene: any) {
    // 简单的截断逻辑
    if (scene.chatHistory.length > 20) {
        const sys = scene.chatHistory[0];
        scene.chatHistory = [sys, ...scene.chatHistory.slice(-10)];
    }
    localStorage.setItem('llm_chat_history', JSON.stringify(scene.chatHistory));
}
