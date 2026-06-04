const fs = require('fs');
// Mocking the game config and building manager logic

const GameConfig = {
    MODULES: {
        "core_base": {
            "name": "核心",
            "gridSize": { "width": 2, "height": 2 }
        },
        "dock_berth": {
            "name": "泊区",
            "gridSize": { "width": 1, "height": 1 },
            "connectRule": { "up": "outside", "down": "inside" }
        },
        "drone_dock": {
            "name": "船厂",
            "gridSize": { "width": 1, "height": 2 },
            "connectRule": { "left": "inside", "right": "outside" }
        }
    }
};

class BuildingManager {
    static stationModules = [];
    static corePlaced = false;

    static getOccupiedGrids(moduleId, gridX, gridY, rotation = 0) {
        const modData = GameConfig.MODULES[moduleId];
        if (!modData) return [];

        const grids = [];
        const gw = (rotation % 180 !== 0) ? modData.gridSize.height : modData.gridSize.width;
        const gh = (rotation % 180 !== 0) ? modData.gridSize.width : modData.gridSize.height;

        for (let i = 0; i < gw; i++) {
            for (let j = 0; j < gh; j++) {
                grids.push({ x: gridX + i, y: gridY + j });
            }
        }
        return grids;
    }

    static checkConnectsToCore(moduleId, gridX, gridY, rotation) {
        const modData = GameConfig.MODULES[moduleId];
        if (!modData || !modData.connectRule) return false;
        
        let effectiveRule = { ...modData.connectRule };
        if (rotation === 90) {
            effectiveRule = { up: modData.connectRule.left, right: modData.connectRule.up, down: modData.connectRule.right, left: modData.connectRule.down };
        } else if (rotation === 180) {
            effectiveRule = { up: modData.connectRule.down, right: modData.connectRule.left, down: modData.connectRule.up, left: modData.connectRule.right };
        } else if (rotation === 270) {
            effectiveRule = { up: modData.connectRule.right, right: modData.connectRule.down, down: modData.connectRule.left, left: modData.connectRule.up };
        }

        const gw = (rotation % 180 !== 0) ? modData.gridSize.height : modData.gridSize.width;
        const gh = (rotation % 180 !== 0) ? modData.gridSize.width : modData.gridSize.height;

        let connectsToCore = false;

        const checkFaceForCore = (dx, dy) => {
            for (let i = 0; i < gw; i++) {
                for (let j = 0; j < gh; j++) {
                    let checkX = gridX + i;
                    let checkY = gridY + j;
                    if (dx === -1 && i === 0) checkX -= 1;
                    else if (dx === 1 && i === gw - 1) checkX += 1;
                    else if (dy === -1 && j === 0) checkY -= 1;
                    else if (dy === 1 && j === gh - 1) checkY += 1;
                    else continue;

                    const isCore = this.stationModules.some(mod => {
                        if (mod.moduleId !== 'core_base') return false;
                        const existingGrids = this.getOccupiedGrids(mod.moduleId, mod.gridX, mod.gridY, mod.rotation || 0);
                        return existingGrids.some(eg => eg.x === checkX && eg.y === checkY);
                    });
                    if (isCore) return true;
                }
            }
            return false;
        };

        if (effectiveRule.up === "inside" && checkFaceForCore(0, -1)) connectsToCore = true;
        if (effectiveRule.down === "inside" && checkFaceForCore(0, 1)) connectsToCore = true;
        if (effectiveRule.left === "inside" && checkFaceForCore(-1, 0)) connectsToCore = true;
        if (effectiveRule.right === "inside" && checkFaceForCore(1, 0)) connectsToCore = true;

        return connectsToCore;
    }

    static canPlaceModule(moduleId, gridX, gridY, rotation = 0) {
        if (!this.corePlaced && moduleId !== 'core_base') return { valid: false, reason: "No core" };

        const targetGrids = this.getOccupiedGrids(moduleId, gridX, gridY, rotation);
        const modData = GameConfig.MODULES[moduleId];

        for (const mod of this.stationModules) {
            const existingGrids = this.getOccupiedGrids(mod.moduleId, mod.gridX, mod.gridY, mod.rotation || 0);
            for (const tg of targetGrids) {
                for (const eg of existingGrids) {
                    if (tg.x === eg.x && tg.y === eg.y) return { valid: false, reason: "Overlap" };
                }
            }
        }

        if (modData.connectRule) {
            let effectiveRule = { ...modData.connectRule };
            if (rotation === 90) {
                effectiveRule = { up: modData.connectRule.left, right: modData.connectRule.up, down: modData.connectRule.right, left: modData.connectRule.down };
            } else if (rotation === 180) {
                effectiveRule = { up: modData.connectRule.down, right: modData.connectRule.left, down: modData.connectRule.up, left: modData.connectRule.right };
            } else if (rotation === 270) {
                effectiveRule = { up: modData.connectRule.right, right: modData.connectRule.down, down: modData.connectRule.left, left: modData.connectRule.up };
            }

            const checkFace = (dx, dy, rule, faceName) => {
                if (!rule) return { valid: true };
                
                let isOccupied = false;
                const gw = (rotation % 180 !== 0) ? modData.gridSize.height : modData.gridSize.width;
                const gh = (rotation % 180 !== 0) ? modData.gridSize.width : modData.gridSize.height;

                for (let i = 0; i < gw; i++) {
                    for (let j = 0; j < gh; j++) {
                        let checkX = gridX + i;
                        let checkY = gridY + j;
                        
                        if (dx === -1 && i === 0) checkX -= 1;
                        else if (dx === 1 && i === gw - 1) checkX += 1;
                        else if (dy === -1 && j === 0) checkY -= 1;
                        else if (dy === 1 && j === gh - 1) checkY += 1;
                        else continue;

                        const occupied = this.stationModules.some(mod => {
                            const existingGrids = this.getOccupiedGrids(mod.moduleId, mod.gridX, mod.gridY, mod.rotation || 0);
                            return existingGrids.some(eg => eg.x === checkX && eg.y === checkY);
                        });
                        
                        if (occupied) {
                            isOccupied = true;
                            break;
                        }
                    }
                    if (isOccupied) break;
                }

                if (rule === "inside" && !isOccupied) return { valid: false, reason: `Face ${faceName} must be inside` };
                if (rule === "outside" && isOccupied) return { valid: false, reason: `Face ${faceName} must be outside` };
                return { valid: true };
            };

            const upCheck = checkFace(0, -1, effectiveRule.up, "up");
            if (!upCheck.valid) return upCheck;
            
            const downCheck = checkFace(0, 1, effectiveRule.down, "down");
            if (!downCheck.valid) return downCheck;

            const leftCheck = checkFace(-1, 0, effectiveRule.left, "left");
            if (!leftCheck.valid) return leftCheck;

            const rightCheck = checkFace(1, 0, effectiveRule.right, "right");
            if (!rightCheck.valid) return rightCheck;
        }

        return { valid: true };
    }

    static placeModule(moduleId, gridX, gridY, forceRotation) {
        let finalRotation = forceRotation !== undefined ? forceRotation : 0;
        let check = this.canPlaceModule(moduleId, gridX, gridY, finalRotation);

        if (forceRotation === undefined) {
            const rotations = [0, 90, 180, 270];
            let bestR = -1;
            let fallbackR = -1;
            let fallbackCheck = check;

            for (const r of rotations) {
                const rCheck = this.canPlaceModule(moduleId, gridX, gridY, r);
                console.log(`Checking ${moduleId} at ${gridX},${gridY} rot ${r} - Valid: ${rCheck.valid}, ConnectsToCore: ${this.checkConnectsToCore(moduleId, gridX, gridY, r)}`);
                if (rCheck.valid) {
                    if (fallbackR === -1) {
                        fallbackR = r;
                        fallbackCheck = rCheck;
                    }
                    if (this.checkConnectsToCore(moduleId, gridX, gridY, r)) {
                        bestR = r;
                        check = rCheck;
                        break;
                    }
                }
            }

            if (bestR !== -1) {
                finalRotation = bestR;
            } else if (fallbackR !== -1) {
                finalRotation = fallbackR;
                check = fallbackCheck;
            } else {
                check = { valid: false, reason: "No valid rotation" };
            }
        }

        if (!check.valid && moduleId !== 'core_base') return false;

        this.stationModules.push({ moduleId, gridX, gridY, rotation: finalRotation });
        if (moduleId === 'core_base') this.corePlaced = true;
        return true;
    }
}

BuildingManager.placeModule('core_base', 0, 0);

console.log("--- Testing dock_berth at Top (0, -1) ---");
console.log(BuildingManager.placeModule('dock_berth', 0, -1) ? "Success" : "Failed");

console.log("--- Testing dock_berth at Top (1, -1) ---");
console.log(BuildingManager.placeModule('dock_berth', 1, -1) ? "Success" : "Failed");

console.log("--- Testing dock_berth at Left (-1, 0) ---");
console.log(BuildingManager.placeModule('dock_berth', -1, 0) ? "Success" : "Failed");

console.log("--- Testing drone_dock at Right (2, 0) ---");
console.log(BuildingManager.placeModule('drone_dock', 2, 0) ? "Success" : "Failed");

console.log("--- Testing drone_dock at Bottom (0, 2) ---");
console.log(BuildingManager.placeModule('drone_dock', 0, 2) ? "Success" : "Failed");
