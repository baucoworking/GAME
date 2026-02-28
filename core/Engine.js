import * as THREE from "three";
import { GameLoop } from "./GameLoop.js";
import { SceneManager } from "./SceneManager.js";
import { PostProcessingSystem } from "../graphics/PostProcessingSystem.js";
import { AtmosphereSystem } from "../world/DayNightCycle.js";
import { AudioSystem } from "../systems/AudioSystem.js";

export class Engine {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(this.renderer.domElement);

    this.atmosphere = new AtmosphereSystem(this.scene);
    this.postProcessing = new PostProcessingSystem(
      this.renderer,
      this.scene,
      this.camera,
    );

    this.sceneManager = new SceneManager(this);
    this.loop = new GameLoop(this);

    this.systems = new Map();

    this.audioSystem = null;

    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  registerSystem(name, system) {
    this.systems.set(name, system);
  }

  getSystem(name) {
    if (name === "postProcessing") return this.postProcessing;
    return this.systems.get(name);
  }

  start() {
    this.sceneManager.init();
    this.audioSystem = new AudioSystem(this.sceneManager.player);
    this.registerSystem("audio", this.audioSystem);
    this.loop.start();
  }

  update(delta) {
    this.sceneManager.update(delta);

    for (const [, system] of this.systems) {
      system?.update?.(delta);
    }

    const tension = this.getSystem("tension")?.tension ?? 0;
    this.postProcessing.update(delta, tension);
    this.postProcessing.render();
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postProcessing.resize(window.innerWidth, window.innerHeight);
  }
}
