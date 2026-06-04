export const EventBus = new EventTarget();

export enum GameEvents {
    // 基础导航
    OPEN_STARMAP = 'OPEN_STARMAP',
    OPEN_FLEET = 'OPEN_FLEET',
    OPEN_HANGAR = 'OPEN_HANGAR',
    OPEN_PORT = 'OPEN_PORT',
    OPEN_ECONOMY = 'OPEN_ECONOMY',
    OPEN_EQUIPMENT = 'OPEN_EQUIPMENT', // 新增设备面板事件
    OPEN_INVENTORY = 'OPEN_INVENTORY', // 仓库面板事件
    
    // 聊天/提示
    APPEND_CHAT = 'APPEND_CHAT',
    TOGGLE_INPUT_STATE = 'TOGGLE_INPUT_STATE',
    
    // 数据更新
    UPDATE_INVENTORY = 'UPDATE_INVENTORY',
    UPDATE_FLEET_DATA = 'UPDATE_FLEET_DATA',
    UPDATE_PORT_DATA = 'UPDATE_PORT_DATA',
    UPDATE_SHIPYARD_DATA = 'UPDATE_SHIPYARD_DATA',
    UPDATE_DRYDOCK_DATA = 'UPDATE_DRYDOCK_DATA',
    
    // 设施交互
    OPEN_TEXT_ADVENTURE = 'OPEN_TEXT_ADVENTURE',
    CLOSE_TEXT_ADVENTURE = 'CLOSE_TEXT_ADVENTURE',
    
    // 玩家发起的命令（React -> Phaser）
    CMD_MOVE = 'CMD_MOVE',
    CMD_ATTACK = 'CMD_ATTACK',
    CMD_DOCK = 'CMD_DOCK',
    CMD_MINE = 'CMD_MINE',
    CMD_EXECUTE_CHAT = 'CMD_EXECUTE_CHAT',
    CMD_BUY_SHIP = 'CMD_BUY_SHIP',
    CMD_EQUIP_MODULE = 'CMD_EQUIP_MODULE',
    CMD_UNEQUIP_MODULE = 'CMD_UNEQUIP_MODULE',
    CMD_SET_FLEET_ROLE = 'CMD_SET_FLEET_ROLE',
}

export function emitUIEvent(event: string, detail?: any) {
    EventBus.dispatchEvent(new CustomEvent(event, { detail }));
}
