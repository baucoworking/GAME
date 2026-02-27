import * as THREE from "three";

export class InteractionSystem {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.raycaster = new THREE.Raycaster();
    this.interactables = [];

    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "e") this.tryInteract();
    });
  }

  register(obj) {
    this.interactables.push(obj);
  }

  tryInteract() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const intersects = this.raycaster.intersectObjects(this.interactables);

    if (intersects.length > 0) {
      const target = intersects[0].object;
      if (target.userData.onInteract) {
        target.userData.onInteract();
      }
    }
  }
}

// Cada objeto tiene:

// mesh.userData.onInteract = () => {
//    puzzle.activate();
// };
