import React, { useState, useEffect, useRef } from 'react';
import { EventBus } from '../utils/EventBus';
import { GameConfig } from '../config';
import { PlayerManager } from '../managers/PlayerManager';
import { ShipManager } from '../managers/ShipManager';
import { BuildingManager } from '../managers/BuildingManager';
import { WorldbookManager } from '../scenes/WorldbookManager';

// --- OPFS 工具函数 ---
const getSaveFile = async (slotId: string, create = false) => {
    const dirHandle = await navigator.storage.getDirectory();
    return await dirHandle.getFileHandle(`save_bundle_${slotId}.json`, { create });
};

const writeToOPFS = async (slotId: string, data: any) => {
    const fileHandle = await getSaveFile(slotId, true);
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
};

const readFromOPFS = async (slotId: string) => {
    try {
        const fileHandle = await getSaveFile(slotId, false);
        const file = await fileHandle.getFile();
        const text = await file.text();
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
};

const deleteFromOPFS = async (slotId: string) => {
    try {
        const dirHandle = await navigator.storage.getDirectory();
        await dirHandle.removeEntry(`save_bundle_${slotId}.json`);
    } catch (e) {
        // File might not exist, ignore
    }
};

interface SaveSlot {
    id: string; // e.g. 'slot_1', 'slot_2'
    timestamp: number;
    sector: string;
    credits: number;
    shipName: string;
    playTime?: number; // optional, for future expansion
}

interface ReactSaveLoadUIProps {
    mode: 'SAVE' | 'LOAD'; // 是在游戏中点击保存，还是在主菜单点击载入
    onClose: () => void;
}

export const ReactSaveLoadUI: React.FC<ReactSaveLoadUIProps> = ({ mode, onClose }) => {
    const [slots, setSlots] = useState<Record<string, SaveSlot>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);
    const MAX_SLOTS = 5;

    // 不包含在单局游戏进度中的系统级配置键
    const SYSTEM_KEYS = [
        'llm_preset_name', 'llm_api_url', 'llm_model', 'llm_api_key',
        'llm_temperature', 'llm_top_p', 'llm_presence_penalty', 'llm_frequency_penalty',
        'llm_max_tokens', 'llm_context_length', 'llm_show_raw', 'llm_safe_mode',
        'llm_lorebook', 'llm_high_priority', 'llm_raw_preset'
    ];

    useEffect(() => {
        loadSlotsMeta();
    }, []);

    const loadSlotsMeta = async () => {
        const loadedSlots: Record<string, SaveSlot> = {};
        for (let i = 1; i <= MAX_SLOTS; i++) {
            const slotId = `slot_${i}`;
            try {
                let saveBundle = await readFromOPFS(slotId);
                
                // 迁移逻辑：如果 OPFS 中没有，检查旧的 localStorage
                if (!saveBundle) {
                    const raw = localStorage.getItem(`save_bundle_${slotId}`);
                    if (raw) {
                        saveBundle = JSON.parse(raw);
                        if (saveBundle) {
                            await writeToOPFS(slotId, saveBundle);
                            localStorage.removeItem(`save_bundle_${slotId}`);
                            console.log(`Migrated save slot ${slotId} to OPFS`);
                        }
                    }
                }

                if (saveBundle && saveBundle.meta) {
                    loadedSlots[slotId] = saveBundle.meta;
                }
            } catch (e) {
                console.error(`Failed to load save slot ${slotId}`, e);
            }
        }
        setSlots(loadedSlots);
    };

    const saveSlotsMeta = (newSlots: Record<string, SaveSlot>) => {
        setSlots(newSlots);
    };

    // --- 强制落盘并收集当前游戏状态 ---
    const collectCurrentGameState = () => {
        // 1. 强制所有管理器落盘到 localStorage
        try {
            const stats = PlayerManager.getStats();
            PlayerManager.saveStats(stats);
            ShipManager.save();
            BuildingManager.save();
            const worldState = WorldbookManager.getWorldState();
            WorldbookManager.saveWorldState(worldState);
        } catch (e) {
            console.warn("部分管理器可能未加载，忽略落盘", e);
        }

        // 2. 收集所有非系统级 key 的数据
        const data: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && !SYSTEM_KEYS.includes(key)) {
                data[key] = localStorage.getItem(key) || '';
            }
        }
        return data;
    };

    // --- 保存到槽位 ---
    const handleSaveToSlot = async (slotId: string) => {
        if (mode !== 'SAVE') return;
        
        const data = collectCurrentGameState();
        
        // 获取摘要信息
        const currentSector = localStorage.getItem('current_sector') || '';
        let credits = 0;
        let shipName = '未知舰船';
        try {
            credits = parseInt(localStorage.getItem('player_credits') || '0');
            const rawOwned = localStorage.getItem('player_owned_ships');
            const pid = localStorage.getItem('player_ship_id');
            if (rawOwned && pid) {
                const ships = JSON.parse(rawOwned);
                const s = ships.find((x: any) => x.id === pid);
                if (s) shipName = s.name || shipName;
            }
        } catch (e) {}

        const meta: SaveSlot = {
            id: slotId,
            timestamp: Date.now(),
            sector: currentSector,
            credits,
            shipName
        };

        // 将该槽位的完整数据保存到 OPFS
        const saveBundle = {
            version: "1.0",
            meta,
            data
        };
        
        try {
            await writeToOPFS(slotId, saveBundle);
            
            // 更新元数据列表
            const newSlots = { ...slots, [slotId]: meta };
            saveSlotsMeta(newSlots);
            
            alert(`已保存至槽位 ${slotId.replace('slot_', '')}`);
        } catch (e) {
            console.error("保存失败", e);
            alert("保存失败！");
        }
    };

    // --- 从槽位载入 ---
    const handleLoadFromSlot = async (slotId: string) => {
        if (mode !== 'LOAD') return;

        const saveBundle = await readFromOPFS(slotId);
        if (!saveBundle) {
            alert("未找到该槽位的存档数据！");
            return;
        }

        try {
            if (!saveBundle || !saveBundle.data) throw new Error("格式损坏");
            applySaveData(saveBundle.data);
        } catch (e) {
            console.error("读取槽位失败", e);
            alert("读取槽位失败，数据可能已损坏。");
        }
    };

    // --- 删除槽位 ---
    const handleDeleteSlot = async (e: React.MouseEvent, slotId: string) => {
        e.stopPropagation();
        
        if (window.confirm(`确定要删除 存档 ${slotId.replace('slot_', '')} 吗？此操作无法恢复！\n(你可以先导出为 JSON 备份)`)) {
            await deleteFromOPFS(slotId);
            
            const newSlots = { ...slots };
            delete newSlots[slotId];
            saveSlotsMeta(newSlots);
        }
    };

    // --- 导出槽位为 JSON 文件 ---
    const handleExportJSON = async (e: React.MouseEvent, slotId: string) => {
        e.stopPropagation(); // 阻止触发载入/保存
        
        let saveBundle;
        if (mode === 'SAVE' && !slots[slotId]) {
            // 如果是 SAVE 模式且槽位为空，允许直接把当前状态导出（不占槽位）
            const data = collectCurrentGameState();
            saveBundle = {
                version: "1.0",
                meta: { timestamp: Date.now(), sector: localStorage.getItem('current_sector') || '', credits: 0, shipName: '' },
                data
            };
        } else {
            saveBundle = await readFromOPFS(slotId);
            if (!saveBundle) {
                alert("该槽位为空，无法导出！");
                return;
            }
        }

        const jsonString = JSON.stringify(saveBundle, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const dateObj = new Date(saveBundle.meta.timestamp);
        const dateStr = `${dateObj.getFullYear()}${(dateObj.getMonth()+1).toString().padStart(2, '0')}${dateObj.getDate().toString().padStart(2, '0')}_${dateObj.getHours().toString().padStart(2, '0')}${dateObj.getMinutes().toString().padStart(2, '0')}`;
        
        const filename = `Save_${saveBundle.meta.sector}_${dateStr}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // --- 从 JSON 文件导入 ---
    const handleImportJSONClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const content = event.target?.result as string;
                const saveBundle = JSON.parse(content);
                
                if (!saveBundle || saveBundle.version === undefined || !saveBundle.data) {
                    alert("无效的存档文件格式！");
                    return;
                }

                // 寻找一个空槽位，如果没有，提示覆盖
                let targetSlot = '';
                for (let i = 1; i <= MAX_SLOTS; i++) {
                    if (!slots[`slot_${i}`]) {
                        targetSlot = `slot_${i}`;
                        break;
                    }
                }
                if (!targetSlot) {
                    if (window.confirm("所有槽位已满，导入将覆盖槽位 1 的数据，是否继续？")) {
                        targetSlot = 'slot_1';
                    } else {
                        return;
                    }
                }

                // 补充 meta (兼容旧版直接导出的 JSON)
                if (!saveBundle.meta) {
                    saveBundle.meta = {
                        id: targetSlot,
                        timestamp: saveBundle.timestamp || Date.now(),
                        sector: saveBundle.data['current_sector'] || '未知星区',
                        credits: parseInt(saveBundle.data['player_credits'] || '0'),
                        shipName: '未知'
                    };
                } else {
                    saveBundle.meta.id = targetSlot; // 修正 ID
                }

                // 写入 OPFS
                await writeToOPFS(targetSlot, saveBundle);
                
                // 更新元数据
                const newSlots = { ...slots, [targetSlot]: saveBundle.meta };
                saveSlotsMeta(newSlots);

                alert(`已成功导入到槽位 ${targetSlot.replace('slot_', '')}！\n请点击该槽位进行载入。`);

            } catch (err) {
                console.error("读取存档失败", err);
                alert("读取存档失败，文件已损坏或格式不正确。");
            }
        };
        reader.readAsText(file);
        
        e.target.value = '';
    };

    // --- 应用数据并重载游戏 ---
    const applySaveData = (data: Record<string, string>) => {
        // 清理当前的进度
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // 不清除 SYSTEM_KEYS，也不清除旧的 save_bundle_ (以防万一)
            if (key && !SYSTEM_KEYS.includes(key) && !key.startsWith('save_bundle_')) {
                keysToRemove.push(key);
            }
        }
        
        // 尝试重置内存
        try {
            if ((PlayerManager as any).reset) (PlayerManager as any).reset();
            if ((ShipManager as any).reset) (ShipManager as any).reset();
            if ((BuildingManager as any).reset) (BuildingManager as any).reset();
            if ((WorldbookManager as any).reset) (WorldbookManager as any).reset();
        } catch (e) {}

        keysToRemove.forEach(k => localStorage.removeItem(k));
        
        // 写入新数据
        for (const key in data) {
            localStorage.setItem(key, data[key]);
        }

        // 触发继续游戏/重启
        if (mode === 'LOAD') {
            EventBus.dispatchEvent(new CustomEvent('MAINMENU_CONTINUE'));
        } else {
            // 如果是在游戏中载入，直接刷新页面最稳妥，或者派发特定重载事件
            window.location.reload(); 
        }
    };


    const renderSlot = (index: number) => {
        const slotId = `slot_${index}`;
        const meta = slots[slotId];
        const isEmpty = !meta;

        return (
            <div 
                key={slotId}
                onClick={() => isEmpty ? handleSaveToSlot(slotId) : (mode === 'SAVE' ? handleSaveToSlot(slotId) : handleLoadFromSlot(slotId))}
                style={{
                    border: `2px solid ${isEmpty ? '#333' : '#00ffff'}`,
                    backgroundColor: isEmpty ? 'rgba(0,0,0,0.5)' : 'rgba(0,40,80,0.8)',
                    borderRadius: '8px',
                    padding: '15px 20px',
                    marginBottom: '15px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s',
                    boxShadow: isEmpty ? 'none' : '0 0 10px rgba(0,255,255,0.2)'
                }}
                onMouseOver={(e) => {
                    e.currentTarget.style.transform = 'scale(1.02)';
                    e.currentTarget.style.borderColor = '#00ffff';
                }}
                onMouseOut={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.borderColor = isEmpty ? '#333' : '#00ffff';
                }}
            >
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: isEmpty ? '#888' : '#fff', marginBottom: '8px' }}>
                        存档 {index} {isEmpty ? '- [空槽位]' : ''}
                    </div>
                    {!isEmpty && (
                        <div style={{ fontSize: '14px', color: '#aaa', display: 'flex', gap: '20px' }}>
                            <span>📍 {meta.sector}</span>
                            <span>⏱️ {new Date(meta.timestamp).toLocaleString()}</span>
                            <span>💰 {meta.credits} 星币</span>
                        </div>
                    )}
                </div>
                
                <div style={{ display: 'flex', gap: '10px' }}>
                    {(!isEmpty || mode === 'SAVE') && (
                        <button 
                            onClick={(e) => handleExportJSON(e, slotId)}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#0055aa',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            ⬇️ 导出JSON
                        </button>
                    )}
                    
                    {!isEmpty && (
                        <button 
                            onClick={(e) => handleDeleteSlot(e, slotId)}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: 'rgba(255, 0, 0, 0.2)',
                                color: '#ff6666',
                                border: '1px solid #ff6666',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                            onMouseOver={(e) => {
                                (e.target as HTMLButtonElement).style.backgroundColor = '#ff4444';
                                (e.target as HTMLButtonElement).style.color = 'white';
                            }}
                            onMouseOut={(e) => {
                                (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                                (e.target as HTMLButtonElement).style.color = '#ff6666';
                            }}
                        >
                            🗑️ 删除
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 5, 15, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 99999,
            pointerEvents: 'auto',
            fontFamily: GameConfig.ui.textStyles.body.fontFamily
        }}>
            <input 
                type="file" 
                accept=".json" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                style={{ display: 'none' }} 
            />

            <div style={{ width: '800px', maxWidth: '90%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '2px solid #00ffff', paddingBottom: '10px' }}>
                    <h1 style={{ color: '#00ffff', margin: 0 }}>
                        {mode === 'SAVE' ? '💾 保存游戏 (Save Data)' : '📂 载入游戏 (Select save data to load)'}
                    </h1>
                    <button 
                        onClick={onClose}
                        style={{ background: 'transparent', border: '1px solid #00ffff', color: '#00ffff', padding: '5px 15px', cursor: 'pointer', borderRadius: '4px', fontSize: '16px' }}
                    >
                        ❌ 关闭 / 返回
                    </button>
                </div>

                <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '10px' }}>
                    {/* 常规存档槽位 */}
                    {[1, 2, 3, 4, 5].map(renderSlot)}
                </div>

                <div style={{ marginTop: '20px', textAlign: 'center', borderTop: '1px solid #333', paddingTop: '20px' }}>
                    <button 
                        onClick={handleImportJSONClick}
                        style={{
                            padding: '12px 25px',
                            backgroundColor: 'transparent',
                            color: '#00ffaa',
                            border: '2px dashed #00ffaa',
                            borderRadius: '8px',
                            fontSize: '18px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        ⬆️ 从 JSON 文件导入存档...
                    </button>
                    <p style={{ color: '#666', fontSize: '12px', marginTop: '10px' }}>
                        导入的 JSON 文件会被放入一个空槽位中。你可以将导出的文件分享给其他玩家，或作为永久备份。
                    </p>
                </div>
            </div>
        </div>
    );
};
