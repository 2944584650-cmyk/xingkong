// @ts-nocheck
export function createExplosion(scene: any, layer: any, x: number, y: number) {
    const radar = scene.scene.get('RadarScene');
    if (radar) radar.addExplosion(x, y);
}

export function createImplosion(scene: any, layer: any, x: number, y: number) {
    const radar = scene.scene.get('RadarScene');
    if (radar) radar.addImplosion(x, y);
}

export function createGateExitEffect(scene: any, layer: any, x: number, y: number, angle: number) {
    const radar = scene.scene.get('RadarScene');
    if (radar) radar.addGateExit(x, y, angle);
}

export function showRTSFeedback(scene: any, layer: any, x: number, y: number, color: string, text: string) {
    const radar = scene.scene.get('RadarScene');
    if (radar) radar.addRTSFeedback(x, y, color, text);
}

export function createLaserBeam(scene: any, layer: any, x1: number, y1: number, x2: number, y2: number, color: string, thickness: number = 2) {
    const radar = scene.scene.get('RadarScene');
    if (radar) radar.addLaser(x1, y1, x2, y2, color, thickness);
}
