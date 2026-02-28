import * as THREE from "three";

export class Zones {
  constructor(defs = []) {
    this._zones = defs.map((z) => ({
      ...z,
      box: new THREE.Box3(new THREE.Vector3(...z.min), new THREE.Vector3(...z.max)),
    }));
  }

  getPlayerZone(position) {
    return this._zones.find((z) => z.box.containsPoint(position)) ?? null;
  }

  all() {
    return this._zones;
  }
}

export default Zones;
