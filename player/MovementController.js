import * as THREE from "three";
import { Bus, EV } from "../core/EventBus.js";
import Config from "../core/Config.js";

export class MovementController {
  constructor(player, camera, collidables = []) {
    this.player = player;
    this.camera = camera;
    this.collidables = collidables;

    this.keys = new Set();
    this.pitch = 0;
    this.yaw = 0;
    this._ray = new THREE.Raycaster();
    this._running = false;
    this._noiseTimer = 0;

    this._bind();
    this._syncCamera();
  }

  _bind() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === "Shift") {
        this._running = true;
        Bus.emit(EV.PLAYER_RUN_START);
      }
      if (e.key.toLowerCase() === "c") {
        Bus.emit(EV.PLAYER_CROUCH, { isCrouching: true });
      }
      if (e.key.toLowerCase() === "f") {
        document.body.requestPointerLock?.();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.key === "Shift") {
        this._running = false;
        Bus.emit(EV.PLAYER_RUN_STOP);
      }
      if (e.key.toLowerCase() === "c") {
        Bus.emit(EV.PLAYER_CROUCH, { isCrouching: false });
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== document.body) return;
      this.yaw -= e.movementX * Config.MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * Config.MOUSE_SENSITIVITY;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
      this._syncCamera();
    });
  }

  update(dt) {
    const dir = new THREE.Vector3();
    if (this.keys.has("w")) dir.z -= 1;
    if (this.keys.has("s")) dir.z += 1;
    if (this.keys.has("a")) dir.x -= 1;
    if (this.keys.has("d")) dir.x += 1;

    const crouching = this.keys.has("c");
    const speed = crouching
      ? Config.PLAYER_SPEED_CROUCH
      : this._running
        ? Config.PLAYER_SPEED_RUN
        : Config.PLAYER_SPEED_WALK;

    if (dir.lengthSq() > 0) {
      dir.normalize();
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

      const next = this.player.position.clone().addScaledVector(dir, speed * dt);
      if (!this._collides(next)) {
        this.player.position.copy(next);
      }

      this._noiseTimer -= dt;
      if (this._noiseTimer <= 0) {
        this._noiseTimer = this._running ? 0.22 : crouching ? 0.65 : 0.4;
        Bus.emit(EV.PLAYER_NOISE, {
          position: this.player.position.clone(),
          intensity: this._running ? 4.0 : crouching ? 0.2 : 1.0,
          wet: false,
        });
      }
    }

    this.player.rotation.y = this.yaw;
    this._syncCamera();
  }

  _syncCamera() {
    const eye = this.player.position.clone();
    eye.y += Config.PLAYER_HEIGHT;
    this.camera.position.copy(eye);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation).normalize();
    this.player.lookAt(fwd);
  }

  _collides(pos) {
    for (const obj of this.collidables) {
      const box = new THREE.Box3().setFromObject(obj).expandByScalar(0.35);
      if (box.containsPoint(pos)) return true;
    }
    return false;
  }
}
