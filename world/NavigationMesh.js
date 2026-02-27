/**
 * world/NavigationMesh.js
 * Grid-based A* pathfinding. All AI enemies use this to compute paths.
 *
 * The navmesh is built once from world geometry and re-queried at runtime.
 * Grid cell size of 0.5 m gives adequate granularity for 1.5 m corridors.
 */

import * as THREE from "three";

// ── Min-heap priority queue ────────────────────────────────────
class MinHeap {
  constructor() {
    this._data = [];
  }

  push(item, priority) {
    this._data.push({ item, priority });
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    const top = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top?.item;
  }

  get size() {
    return this._data.length;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].priority <= this._data[i].priority) break;
      [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1,
        r = 2 * i + 2;
      if (l < n && this._data[l].priority < this._data[smallest].priority)
        smallest = l;
      if (r < n && this._data[r].priority < this._data[smallest].priority)
        smallest = r;
      if (smallest === i) break;
      [this._data[smallest], this._data[i]] = [
        this._data[i],
        this._data[smallest],
      ];
      i = smallest;
    }
  }
}

// ── NavigationMesh ─────────────────────────────────────────────
export class NavigationMesh {
  /**
   * @param {number} [cellSize=0.5]  Grid resolution in world units
   */
  constructor(cellSize = 0.5) {
    this.cellSize = cellSize;
    this._walkable = new Map(); // "gx,gz" -> bool
    this._bounds = null; // { minX, maxX, minZ, maxZ }
  }

  // ── Building ───────────────────────────────────────────────

  /**
   * Populate the grid from a flat AABB (xz plane).
   * Then call `blockBox` / `blockObject` to mark obstacles.
   */
  buildFlat(minX, maxX, minZ, maxZ) {
    this._bounds = { minX, maxX, minZ, maxZ };
    const s = this.cellSize;
    for (let x = minX; x <= maxX; x += s) {
      for (let z = minZ; z <= maxZ; z += s) {
        this._walkable.set(this._key(x, z), true);
      }
    }
  }

  /** Mark all grid cells overlapping a THREE.Box3 as non-walkable. */
  blockBox(box3, padding = 0) {
    const s = this.cellSize;
    const minX = box3.min.x - padding;
    const maxX = box3.max.x + padding;
    const minZ = box3.min.z - padding;
    const maxZ = box3.max.z + padding;
    for (let x = minX; x <= maxX; x += s) {
      for (let z = minZ; z <= maxZ; z += s) {
        this._walkable.set(this._key(x, z), false);
      }
    }
  }

  /** Convenience: block all meshes in a THREE.Object3D that have `userData.navBlocking`. */
  blockSceneObjects(root) {
    const box = new THREE.Box3();
    root.traverse((obj) => {
      if (obj.isMesh && obj.userData.navBlocking) {
        box.setFromObject(obj);
        this.blockBox(box, this.cellSize);
      }
    });
  }

  // ── Queries ────────────────────────────────────────────────

  isWalkable(x, z) {
    const v = this._walkable.get(this._key(x, z));
    return v === true; // false or undefined -> blocked
  }

  setWalkable(x, z, v) {
    this._walkable.set(this._key(x, z), v);
  }

  // ── Pathfinding (A*) ───────────────────────────────────────

  /**
   * Find a path from `start` to `end` (THREE.Vector3, y ignored).
   * Returns an array of THREE.Vector3 waypoints (empty if no path).
   * @param {THREE.Vector3} start
   * @param {THREE.Vector3} end
   * @param {number}        [maxIterations=4000]
   * @returns {THREE.Vector3[]}
   */
  findPath(start, end, maxIterations = 4000) {
    const snap = (v) => [
      Math.round(v.x / this.cellSize) * this.cellSize,
      Math.round(v.z / this.cellSize) * this.cellSize,
    ];

    const [sx, sz] = snap(start);
    const [ex, ez] = snap(end);
    const startKey = this._key(sx, sz);
    const endKey = this._key(ex, ez);

    if (startKey === endKey) return [end.clone()];

    // Snap end to nearest walkable if blocked
    const resolvedEnd = this._nearestWalkable(ex, ez) ?? [ex, ez];

    const open = new MinHeap();
    const cameFrom = new Map();
    const gScore = new Map();

    open.push(startKey, 0);
    gScore.set(startKey, 0);

    const h = (x, z) =>
      Math.abs(x - resolvedEnd[0]) + Math.abs(z - resolvedEnd[1]);

    const resolvedKey = this._key(...resolvedEnd);
    let iter = 0;

    while (open.size > 0 && iter++ < maxIterations) {
      const current = open.pop();
      if (current === resolvedKey) {
        return this._reconstruct(cameFrom, current, start.y);
      }

      const [cx, cz] = this._parseKey(current);

      for (const [nx, nz, cost] of this._neighbors(cx, cz)) {
        const nKey = this._key(nx, nz);
        const g = (gScore.get(current) ?? Infinity) + cost;
        if (g < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, current);
          gScore.set(nKey, g);
          open.push(nKey, g + h(nx, nz));
        }
      }
    }

    return []; // no path
  }

  /**
   * Post-process path: remove redundant collinear nodes using LOS checks.
   * @param {THREE.Vector3[]} path
   * @returns {THREE.Vector3[]}
   */
  smoothPath(path) {
    if (path.length <= 2) return path;
    const result = [path[0]];
    let anchor = 0;

    for (let i = 2; i < path.length; i++) {
      if (!this._hasLOS(path[anchor], path[i])) {
        result.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    result.push(path[path.length - 1]);
    return result;
  }

  // ── Internals ──────────────────────────────────────────────

  _key(x, z) {
    // Round to cell grid to avoid float drift
    const gx = Math.round(x / this.cellSize);
    const gz = Math.round(z / this.cellSize);
    return `${gx},${gz}`;
  }

  _parseKey(key) {
    const [gx, gz] = key.split(",").map(Number);
    return [gx * this.cellSize, gz * this.cellSize];
  }

  _neighbors(x, z) {
    const s = this.cellSize;
    const SQRT2 = 1.41421356;
    const candidates = [
      [x + s, z, 1],
      [x - s, z, 1],
      [x, z + s, 1],
      [x, z - s, 1],
      [x + s, z + s, SQRT2],
      [x - s, z - s, SQRT2],
      [x + s, z - s, SQRT2],
      [x - s, z + s, SQRT2],
    ];
    return candidates.filter(([nx, nz]) => this.isWalkable(nx, nz));
  }

  _reconstruct(cameFrom, endKey, y = 0) {
    const path = [];
    let cur = endKey;
    while (cameFrom.has(cur)) {
      const [x, z] = this._parseKey(cur);
      path.unshift(new THREE.Vector3(x, y, z));
      cur = cameFrom.get(cur);
    }
    return path;
  }

  _hasLOS(a, b) {
    const dist = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
    const steps = Math.ceil(dist / (this.cellSize * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t))
        return false;
    }
    return true;
  }

  _nearestWalkable(x, z) {
    // BFS outward to find nearest walkable cell
    const s = this.cellSize;
    for (let r = s; r <= s * 8; r += s) {
      for (let dx = -r; dx <= r; dx += s) {
        for (let dz = -r; dz <= r; dz += s) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (this.isWalkable(x + dx, z + dz)) return [x + dx, z + dz];
        }
      }
    }
    return null;
  }

  // ── Utility ────────────────────────────────────────────────

  /** Random walkable position within bounds. Useful for patrol point generation. */
  randomWalkable() {
    if (!this._bounds) return new THREE.Vector3();
    const { minX, maxX, minZ, maxZ } = this._bounds;
    const s = this.cellSize;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = minX + Math.floor(Math.random() * ((maxX - minX) / s)) * s;
      const z = minZ + Math.floor(Math.random() * ((maxZ - minZ) / s)) * s;
      if (this.isWalkable(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3();
  }
}

export default NavigationMesh;
