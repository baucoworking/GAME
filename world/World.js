import * as THREE from "three";
import { NavigationMesh } from "./NavigationMesh.js";
import { Hideout } from "../systems/HideoutSystem.js";
import { Zones } from "./Zones.js";

function wall(w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38 }),
  );
  mesh.position.set(x, y, z);
  mesh.userData.navBlocking = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.collidables = [];
    this.navMesh = new NavigationMesh(0.75);
    this.hideouts = [];
    this.zones = null;
    this.patrolRoutes = [];
    this.vigilantePositions = [];
    this.manifestPoints = [];
    this.colectivoZones = ["atrio", "zona_i", "zona_e"];
    this.cameoPosition = new THREE.Vector3(15, 0, 10);
    this.collapseRoomCenter = new THREE.Vector3(22, 0, -16);
  }

  build() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0x0f1318, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const perim = [
      wall(2, 4, 92, -45, 2, 0),
      wall(2, 4, 92, 45, 2, 0),
      wall(92, 4, 2, 0, 2, -45),
      wall(92, 4, 2, 0, 2, 45),
      wall(40, 4, 2, -5, 2, 6),
      wall(2, 4, 30, -16, 2, -10),
      wall(2, 4, 24, 8, 2, -3),
      wall(24, 4, 2, 20, 2, -14),
    ];
    perim.forEach((m) => {
      this.scene.add(m);
      this.collidables.push(m);
    });

    this.navMesh.buildFlat(-42, 42, -42, 42);
    this.navMesh.blockSceneObjects(this.scene);

    this.patrolRoutes = [
      [new THREE.Vector3(-20, 0, 20), new THREE.Vector3(-5, 0, 20), new THREE.Vector3(-5, 0, 0), new THREE.Vector3(-20, 0, 0)],
      [new THREE.Vector3(10, 0, 20), new THREE.Vector3(25, 0, 18), new THREE.Vector3(25, 0, 4), new THREE.Vector3(10, 0, 2)],
      [new THREE.Vector3(-25, 0, -20), new THREE.Vector3(-5, 0, -20), new THREE.Vector3(-5, 0, -35), new THREE.Vector3(-25, 0, -35)],
      [new THREE.Vector3(10, 0, -20), new THREE.Vector3(30, 0, -20), new THREE.Vector3(30, 0, -35), new THREE.Vector3(10, 0, -35)],
    ];

    this.vigilantePositions = [
      new THREE.Vector3(0, 0, 12),
      new THREE.Vector3(12, 0, 10),
      new THREE.Vector3(-12, 0, 10),
    ];

    this.manifestPoints = [
      new THREE.Vector3(-18, 0, -8),
      new THREE.Vector3(4, 0, -6),
      new THREE.Vector3(20, 0, -2),
      new THREE.Vector3(-10, 0, 16),
    ];

    const hideoutPositions = [
      [-10, 0, 12], [-6, 0, 12], [-2, 0, 12], [2, 0, 12],
      [6, 0, 12], [10, 0, 12], [14, 0, 12], [18, 0, 12],
    ];

    this.hideouts = hideoutPositions.map((p, i) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.2, 1.4),
        new THREE.MeshStandardMaterial({ color: 0x384450 }),
      );
      mesh.position.set(p[0], 0.6, p[2]);
      this.scene.add(mesh);
      return new Hideout({
        id: `hideout_${i + 1}`,
        type: "locker",
        position: new THREE.Vector3(p[0], 0, p[2]),
        mesh,
        zoneId: "atrio",
        requiresDiscovery: false,
      });
    });

    this.zones = new Zones([
      { id: "atrio", min: [-35, -1, -2], max: [35, 4, 35], data: { baseRadiation: 0.07 } },
      { id: "zona_i", min: [8, -1, -35], max: [36, 4, -10], data: { baseRadiation: 0.14 } },
      { id: "zona_e", min: [-35, -1, -35], max: [0, 4, -10], data: { baseRadiation: 0.1 } },
    ]);

    return this;
  }
}

export default World;
