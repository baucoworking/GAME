import { Bus } from "../core/EventBus.js";

export class LightingSystem {
  constructor(engine) {
    this.engine = engine;
    this._isBlackout = false;
    this._intensityBackup = null;
    this._sunIntensityBackup = null;
    Bus.on("world:blackout", () => this.blackout());
    Bus.on("world:power_restore", () => this.restore());
  }

  blackout() {
    if (this._isBlackout) return;
    this._isBlackout = true;
    this._intensityBackup = this.engine.atmosphere.ambientLight.intensity;
    this._sunIntensityBackup = this.engine.atmosphere.sunLight.intensity;
    this.engine.atmosphere.ambientLight.intensity = 0.06;
    this.engine.atmosphere.sunLight.intensity = 0.04;
  }

  restore() {
    if (!this._isBlackout) return;
    this._isBlackout = false;
    this.engine.atmosphere.ambientLight.intensity = this._intensityBackup ?? 0.22;
    this.engine.atmosphere.sunLight.intensity = this._sunIntensityBackup ?? 0.35;
  }

  update() {}
}
