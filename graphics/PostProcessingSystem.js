import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { RadiationShader } from "../shaders/RadiationShader.js";

export class PostProcessingSystem {
  constructor(renderer, scene, camera) {
    this.camera = camera;
    this.baseCameraPosition = camera.position.clone();
    this.composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

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

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.8,
      0.4,
      0.85,
    );
    this.composer.addPass(this.bloomPass);

    this.radiationPass = new ShaderPass(RadiationShader);
    this.composer.addPass(this.radiationPass);

    this._shake = new THREE.Vector3();
  }

  setChromaticAberration(v) {
    this.radiationPass.uniforms["chromatic"].value = v;
  }

  setVignetteDesaturation(v) {
    this.radiationPass.uniforms["desaturation"].value = v;
  }

  setDistortion(v) {
    this.radiationPass.uniforms["distortion"].value = v;
  }

  setCameraShake(v) {
    this._shake.copy(v);
  }

  update(delta, tensionLevel) {
    this.radiationPass.uniforms["time"].value += delta;
    const currentIntensity = this.radiationPass.uniforms["intensity"].value;
    this.radiationPass.uniforms["intensity"].value = THREE.MathUtils.lerp(
      currentIntensity,
      tensionLevel,
      delta * 2.0,
    );
  }

  render() {
    this.camera.position.add(this._shake);
    this.composer.render();
    this.camera.position.sub(this._shake);
  }

  resize(width, height) {
    this.composer.setSize(width, height);
    this.ssaoPass.setSize(width, height);
  }
}
