export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface QuadTreeItem extends Rect {
    entity: any;
}

export class QuadTree {
    private maxObjects = 10;
    private maxLevels = 5;
    private level: number;
    private bounds: Rect;
    private objects: QuadTreeItem[];
    private nodes: QuadTree[];

    constructor(bounds: Rect, level: number = 0) {
        this.level = level;
        this.bounds = bounds;
        this.objects = [];
        this.nodes = [];
    }

    clear() {
        this.objects = [];
        for (let i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i]) {
                this.nodes[i].clear();
            }
        }
        this.nodes = [];
    }

    private split() {
        const subWidth = this.bounds.width / 2;
        const subHeight = this.bounds.height / 2;
        const x = this.bounds.x;
        const y = this.bounds.y;

        this.nodes[0] = new QuadTree({ x: x + subWidth, y: y, width: subWidth, height: subHeight }, this.level + 1); // 东北
        this.nodes[1] = new QuadTree({ x: x, y: y, width: subWidth, height: subHeight }, this.level + 1); // 西北
        this.nodes[2] = new QuadTree({ x: x, y: y + subHeight, width: subWidth, height: subHeight }, this.level + 1); // 西南
        this.nodes[3] = new QuadTree({ x: x + subWidth, y: y + subHeight, width: subWidth, height: subHeight }, this.level + 1); // 东南
    }

    /**
     * 判断对象属于哪个象限
     * -1 表示对象跨越了边界
     */
    private getIndex(pRect: Rect): number {
        let index = -1;
        const verticalMidpoint = this.bounds.x + (this.bounds.width / 2);
        const horizontalMidpoint = this.bounds.y + (this.bounds.height / 2);

        // 对象完全位于上象限
        const topQuadrant = (pRect.y < horizontalMidpoint && pRect.y + pRect.height < horizontalMidpoint);
        // 对象完全位于下象限
        const bottomQuadrant = (pRect.y > horizontalMidpoint);

        // 对象完全位于左象限
        if (pRect.x < verticalMidpoint && pRect.x + pRect.width < verticalMidpoint) {
            if (topQuadrant) {
                index = 1;
            } else if (bottomQuadrant) {
                index = 2;
            }
        } 
        // 对象完全位于右象限
        else if (pRect.x > verticalMidpoint) {
            if (topQuadrant) {
                index = 0;
            } else if (bottomQuadrant) {
                index = 3;
            }
        }

        return index;
    }

    insert(item: QuadTreeItem) {
        if (this.nodes[0]) {
            const index = this.getIndex(item);
            if (index !== -1) {
                this.nodes[index].insert(item);
                return;
            }
        }

        this.objects.push(item);

        if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
            if (!this.nodes[0]) {
                this.split();
            }

            let i = 0;
            while (i < this.objects.length) {
                const index = this.getIndex(this.objects[i]);
                if (index !== -1) {
                    this.nodes[index].insert(this.objects.splice(i, 1)[0]);
                } else {
                    i++;
                }
            }
        }
    }

    retrieve(pRect: Rect, returnObjects: QuadTreeItem[] = []): QuadTreeItem[] {
        const index = this.getIndex(pRect);
        
        // 如果对象完全在一个象限内，只要查那个象限就行
        if (index !== -1 && this.nodes[0]) {
            this.nodes[index].retrieve(pRect, returnObjects);
        } 
        // 否则，对象跨越了边界，可能要查所有与其相交的象限（这里简化为查所有子象限）
        else if (this.nodes[0]) {
            // 进一步优化：可以只查询相交的子节点
            const verticalMidpoint = this.bounds.x + (this.bounds.width / 2);
            const horizontalMidpoint = this.bounds.y + (this.bounds.height / 2);

            const top = pRect.y < horizontalMidpoint;
            const bottom = pRect.y + pRect.height > horizontalMidpoint;
            const left = pRect.x < verticalMidpoint;
            const right = pRect.x + pRect.width > verticalMidpoint;

            if (top && right) this.nodes[0].retrieve(pRect, returnObjects);
            if (top && left) this.nodes[1].retrieve(pRect, returnObjects);
            if (bottom && left) this.nodes[2].retrieve(pRect, returnObjects);
            if (bottom && right) this.nodes[3].retrieve(pRect, returnObjects);
        }

        returnObjects.push(...this.objects);
        return returnObjects;
    }
}
