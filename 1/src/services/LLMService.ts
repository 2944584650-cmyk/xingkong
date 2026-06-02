import { GameConfig } from '../config.js';
import { PlayerManager } from '../managers/PlayerManager.js';

export class LLMService {
    /**
     * 发送请求给 LLM
     * @param {Array} chatHistory - 聊天记录
     * @param {Function} onChunk - 流式回调
     * @returns {Promise<Object>} - { fullReply, cleanReply, commands }
     */
    static async request(chatHistory, onChunk = null) {
        const messages = this._injectSystemPrompts(chatHistory);
        const payload = this._buildPayload(messages);
        
        const API_KEY = localStorage.getItem('llm_api_key') || '';
        const API_URL = this._getApiUrl();
        
        if (!API_KEY) {
            throw new Error('未配置 API Key');
        }

        const response = await fetch('http://localhost:3000/proxy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'x-target-url': API_URL
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const fullReply = await this._readStream(response, onChunk);
        return this._parseResponse(fullReply);
    }

    // --- 内部私有方法 ---

    static _getApiUrl() {
        let url = localStorage.getItem('llm_api_url') || GameConfig.llm.defaultApiUrl;
        if (!url.endsWith('/chat/completions')) {
            url = url.replace(/\/+$/, '') + '/chat/completions';
        }
        return url;
    }

    static _buildPayload(messages) {
        const temp = parseFloat(localStorage.getItem('llm_temperature'));
        const top_p = parseFloat(localStorage.getItem('llm_top_p'));
        const max_tokens = parseInt(localStorage.getItem('llm_max_tokens')) || GameConfig.llm.defaultMaxTokens;
        
        const payload: any = {
            model: localStorage.getItem('llm_model') || GameConfig.llm.defaultModel,
            messages: messages,
            max_tokens: Math.max(4096, max_tokens),
            temperature: (isNaN(temp) || temp <= 0) ? 0.8 : temp,
            top_p: (isNaN(top_p) || top_p <= 0 || top_p > 1) ? 1.0 : top_p,
            stream: true
        };

        const presence_pen = parseFloat(localStorage.getItem('llm_presence_penalty'));
        const freq_pen = parseFloat(localStorage.getItem('llm_frequency_penalty'));
        if (presence_pen) payload.presence_penalty = presence_pen;
        if (freq_pen) payload.frequency_penalty = freq_pen;

        return payload;
    }

    static _injectSystemPrompts(originalMessages) {
        let messages = [...originalMessages];
        let systemContent = "";
        
        // 1. 提取原有 System Prompt
        messages.forEach(m => {
            if (m.role === 'system') systemContent += m.content + "\n\n";
        });

        // 2. 注入玩家实时状态
        const stats = PlayerManager.getStats();
        const inv = PlayerManager.getInventory();
        systemContent += `\n【系统实时状态同步】\n当前玩家星币：${stats.credits}\n当前玩家装备库/货舱：[${inv.length > 0 ? inv.join('], [') : '空'}]\n(注：此数值仅供剧情参考，不要自行计算数值变动)\n`;

        // 3. 注入世界书 (Worldbook)
        const wbInjection = this._getWorldbookInjection(messages);
        if (wbInjection) systemContent += `\n【Worldbook Injection】\n${wbInjection}\n`;

        // 4. 注入最高优先级指令 (Jailbreak)
        let tailJailbreak = "";
        const storedHighPriority = localStorage.getItem('llm_high_priority');
        if (storedHighPriority) tailJailbreak += "\n\n" + storedHighPriority;

        // 5. 注入防幻觉位置锁定
        let currentSector = localStorage.getItem('current_sector');
        if (!currentSector) {
            console.error("[LLMService/injectSystemPrompts] 致命错误：未找到 current_sector！使用默认兜底星区。");
            currentSector = '创世星柱废墟';
        }
        const currentPoi = localStorage.getItem('current_poi') || '机库';
        tailJailbreak += `\n\n[🔥系统绝对指令🔥：玩家当前真实位置绝对是在【${currentSector}】的【${currentPoi}】。星币余额【${stats.credits}】。]`;

        // 重组消息列表
        let finalMessages = [];
        if (systemContent) finalMessages.push({ role: 'system', content: systemContent.trim() });
        
        let lastRole = null;
        messages.forEach(m => {
            if (m.role !== 'system') {
                if (m.role === lastRole) {
                    finalMessages[finalMessages.length - 1].content += "\n\n" + m.content;
                } else {
                    finalMessages.push({ role: m.role, content: m.content });
                    lastRole = m.role;
                }
            }
        });

        if (finalMessages.length > 0) {
            finalMessages[finalMessages.length - 1].content += tailJailbreak;
        }

        return finalMessages;
    }

    static _getWorldbookInjection(messages) {
        const entries = JSON.parse(localStorage.getItem('llm_worldbook_entries') || '[]');
        if (entries.length === 0) return "";

        const scanText = messages.slice(-6).map(m => m.content).join('\n').toLowerCase();
        let injected = [];
        
        entries.forEach(entry => {
            if (entry.alwaysOn) {
                injected.push(entry.content);
                return;
            }
            if (entry.keys) {
                const keys = entry.keys.split(/[,，]/).map(k => k.trim().toLowerCase()).filter(k => k);
                for (const key of keys) {
                    if (scanText.includes(key)) {
                        injected.push(entry.content);
                        break; 
                    }
                }
            }
        });
        return injected.join('\n\n');
    }

    static async _readStream(response, onChunk) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullReply = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n');
            buffer = lines.pop(); 
            
            for (let line of lines) {
                line = line.trim();
                if (line === '' || line === 'data: [DONE]') continue;
                if (line.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(line.slice(6));
                        if (json.choices?.[0]?.delta?.content) {
                            const chunk = json.choices[0].delta.content;
                            fullReply += chunk;
                            if (onChunk) onChunk(fullReply);
                        }
                    } catch (e) {}
                }
            }
        }
        return fullReply;
    }

    static _parseResponse(fullReply) {
        let cleanReply = fullReply;
        
        // 1. 清理思维链等标签
        const tagsToRemove = [
            /<disclaimer>[\s\S]*?<\/disclaimer>/gi,
            /<thinking>[\s\S]*?<\/thinking>/gi,
            /<CONTEXT_thinking>[\s\S]*?<\/CONTEXT_thinking>/gi,
            /```set_log[\s\S]*?```/gi
        ];
        tagsToRemove.forEach(tag => cleanReply = cleanReply.replace(tag, ''));

        // 2. 提取指令
        const commands = [];
        const regexOld = /\[CMD:([^\]]+)\]/g;
        const regexNew = /\{\{FDEP:([^\}]+)\}\}/g;
        
        let match;
        while ((match = regexOld.exec(fullReply)) !== null) commands.push(match[1].trim());
        while ((match = regexNew.exec(fullReply)) !== null) commands.push(match[1].trim());

        // 3. 从显示文本中移除指令
        cleanReply = cleanReply.replace(regexOld, '').replace(regexNew, '').trim();

        return { fullReply, cleanReply, commands };
    }
}
