import { WorldbookManager } from './WorldbookManager.js';

export class StarmapScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StarmapScene' });
    }

    init(data) {
        this.worldState = data.worldState;
        this.currentSectorName = data.currentSectorName;
        this.viewingSectorName = data.viewingSectorName;
        this.onSelectSector = data.onSelectSector;
        this.onRobConvoy = data.onRobConvoy;
        
        // 存储节点映射和商队映射，方便更新
        this.sectorNodes = new Map();
        this.convoySprites = new Map();
    }

    create() {
        // Headless scene for tracking data only
        const allSectors = this.worldState.sectors || [];
        allSectors.forEach(dest => {
            if (dest.x !== undefined && dest.y !== undefined) {
                this.sectorNodes.set(dest.name, { x: dest.x, y: dest.y });
            }
        });
    }

    updateConvoys(ships) {
        // Let StarmapRenderer handle rendering
    }
}
