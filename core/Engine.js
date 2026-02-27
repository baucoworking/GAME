import * as THREE from "three";
import { GameLoop } from "./GameLoop.js";
import { SceneManager } from "./SceneManager.js";
import { PostProcessingSystem } from "../graphics/PostProcessingSystem.js";
import { AtmosphereSystem } from "../world/DayNightCycle.js";

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

    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  start() {
    this.sceneManager.init();
    this.loop.start();
  }

  update(delta) {
    this.sceneManager.update(delta);
    const currentTension = 0.0;
    this.postProcessing.update(delta, currentTension);
    this.postProcessing.render();
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postProcessing.resize(window.innerWidth, window.innerHeight);
  }
}
