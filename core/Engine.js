import * as THREE from "three";
import { GameLoop } from "./GameLoop.js";
import { SceneManager } from "./SceneManager.js";
import { EventBus } from "./EventBus.js";
import { PostProcessingSystem } from "../graphics/PostProcessingSystem.js";
import { AtmosphereSystem } from "../world/DayNightCycle.js";

export class Engine {
  constructor() {
    // 1. Entidades espaciales base
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );

    // 2. Inicialización del Renderer (Debe ejecutarse ANTES del PostProcessing)
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // Apagado por defecto para ganar rendimiento, el post-procesado lo manejará
      powerPreference: "high-performance", // Fuerza el uso de la GPU dedicada
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Evita sobrecarga en pantallas 4K/Retina
    document.body.appendChild(this.renderer.domElement);

    // 3. Subsistemas de renderizado avanzado
    this.atmosphere = new AtmosphereSystem(this.scene);
    this.postProcessing = new PostProcessingSystem(
      this.renderer,
      this.scene,
      this.camera,
    );

    // 4. Arquitectura de control
    this.events = new EventBus();
    this.sceneManager = new SceneManager(this);
    this.loop = new GameLoop(this);

    // 5. Manejadores de eventos del sistema
    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  start() {
    this.sceneManager.init();
    this.loop.start();
  }

  /**
   * Ciclo de actualización principal.
   * Asumo que tu GameLoop.js invoca engine.update(delta) en cada requestAnimationFrame.
   */
  update(delta) {
    // TODO: Conectar con tu sistema de tensión real cuando esté instanciado en SceneManager
    // const tension = this.sceneManager.tensionSystem.level / 10.0;
    const currentTension = 0.0;

    // Actualiza los shaders (aberración, ruido, etc.)
    this.postProcessing.update(delta, currentTension);

    // Delega el renderizado al Composer, no al renderer base
    this.postProcessing.render();
  }

  onWindowResize() {
    // Actualizar matriz de proyección de la cámara
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    // Actualizar dimensiones de los buffers de renderizado
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postProcessing.resize(window.innerWidth, window.innerHeight);
  }
}
