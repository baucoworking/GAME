import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { RadiationShader } from "../shaders/RadiationShader.js";

export class PostProcessingSystem {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);

    // 1. Render Base
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // 2. SSAO (Oclusión Ambiental) - Da peso y terror a las esquinas
    this.ssaoPass = new SSAOPass(
      scene,
      camera,
      window.innerWidth,
      window.innerHeight,
    );
    this.ssaoPass.kernelRadius = 16;
    this.ssaoPass.minDistance = 0.005;
    this.ssaoPass.maxDistance = 0.1;
    this.composer.addPass(this.ssaoPass);

    // 3. Unreal Bloom - Para bioluminiscencia (ojos ámbar) y luces de sirena
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.8, // strength
      0.4, // radius
      0.85, // threshold (solo objetos muy brillantes emitirán luz)
    );
    this.composer.addPass(this.bloomPass);

    // 4. Shader de Radiación
    this.radiationPass = new ShaderPass(RadiationShader);
    this.composer.addPass(this.radiationPass);
  }

  // Se actualiza en tu GameLoop
  update(delta, tensionLevel) {
    // Escalar el shader en función del sistema de tensión o dosímetro
    this.radiationPass.uniforms["time"].value += delta;

    // Suavizamos la transición de la intensidad con un LERP
    const currentIntensity = this.radiationPass.uniforms["intensity"].value;
    this.radiationPass.uniforms["intensity"].value = THREE.MathUtils.lerp(
      currentIntensity,
      tensionLevel,
      delta * 2.0,
    );
  }

  render() {
    this.composer.render();
  }

  resize(width, height) {
    this.composer.setSize(width, height);
    this.ssaoPass.setSize(width, height);
  }
}
