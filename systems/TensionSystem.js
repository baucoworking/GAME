/**
 * systems/TensionSystem.js
 * Manages global tension (0..1) and drives:
 *  - Audio state transitions (explore → alert → danger → contact)
 *  - Dosimeter level (from enemy proximity + zone radiation)
 *  - Post-processing intensity (chromatic aberration, camera shake, desaturation)
 *  - Hallucination audio triggers (false creature sounds at high dosimeter)
 *
 * Tension sources:
 *  +0.3 / s  — enemy in same zone as player
 *  +0.8 / s  — enemy in alert state targeting player zone
 *  +1.0 / s  — enemy in direct chase of player
 *  -0.02 / s — passive decay (enemy not nearby)
 *
 * Dosimeter is driven by:
 *  - Zone base radiation
 *  - Sum of (radiationEmit / dist²) for each enemy within 15 m
 */

import * as THREE from "three";
import { Bus, EV } from "../core/EventBus.js";

// Audio state thresholds
const AUDIO_STATES = [
  { threshold: 0.0, state: "explore" },
  { threshold: 0.25, state: "alert" },
  { threshold: 0.55, state: "danger" },
  { threshold: 0.8, state: "contact" },
];

// Post-FX thresholds
const FX = {
  CHROMATIC_START: 0.3, // mild aberration begins
  SHAKE_START: 0.5, // camera tremor begins
  DESATURATE_START: 0.65, // colour drains from edges
  HALLUCINATE_START: 0.75, // phantom sounds
  DISTORT_START: 0.9, // screen warping
};

export class TensionSystem {
  /**
   * @param {object}  engine
   * @param {object}  playerRef    — { position:Vector3 }
   * @param {Array}   enemyList    — live array of EnemyBase instances
   * @param {object}  [zoneManager]
   */
  constructor(engine, playerRef, enemyList, zoneManager = null) {
    this.engine = engine;
    this._player = playerRef;
    this._enemies = enemyList;
    this._zones = zoneManager;

    this.tension = 0; // 0..1
    this.dosimeter = 0; // 0..1 normalised
    this._dosimeterRaw = 0; // mSv/h

    this._audioState = "explore";
    this._hallucinateTimer = 0;
    this._shakeOffset = new THREE.Vector3();

    this._nightLevel = 1;

    this._unsubs = [];
    this._unsubs.push(
      Bus.on(EV.NIGHT_START, (d) => {
        this._nightLevel = d.nightNumber;
      }),
      Bus.on(EV.ENEMY_CAUGHT_PLAYER, () => {
        this.tension = 1.0;
      }),
    );
  }

  // ── Per-frame update ─────────────────────────────────────────

  update(dt) {
    if (!this._player) return;

    this._updateTension(dt);
    this._updateDosimeter(dt);
    this._syncAudioState();
    this._syncPostFX();
    this._updateHallucinations(dt);
  }

  // ── Tension ──────────────────────────────────────────────────

  _updateTension(dt) {
    const playerPos = this._player.position;
    let maxSource = 0;

    for (const enemy of this._enemies) {
      if (!enemy.mesh.visible) continue;
      const dist = enemy.mesh.position.distanceTo(playerPos);
      const state = enemy.fsm?.name;
      let source = 0;

      if (
        state === "chase" ||
        state === "frenzy" ||
        state === "viktor_pursue"
      ) {
        source = 1.0;
      } else if (state === "alert" || state === "check_hideout") {
        source = dist < 20 ? 0.8 : 0;
      } else if (state === "search") {
        source = dist < 15 ? 0.5 : 0;
      } else if (state === "patrol") {
        source = dist < 10 ? 0.3 : 0;
      }

      maxSource = Math.max(maxSource, source);
    }

    const target = maxSource;
    if (this.tension < target) {
      // Build up fast
      this.tension = Math.min(
        this.tension + (target - this.tension) * 3 * dt,
        1,
      );
    } else {
      // Decay slowly
      const decayRate = 0.025 + (1 - this.tension) * 0.01;
      this.tension = Math.max(this.tension - decayRate * dt, 0);
    }

    Bus.emit(EV.TENSION_CHANGE, { value: this.tension });
  }

  // ── Dosimeter ────────────────────────────────────────────────

  _updateDosimeter(dt) {
    const playerPos = this._player.position;

    // Zone base radiation
    let zoneRad = 0.05; // baseline ambient
    if (this._zones) {
      const zone = this._zones.getPlayerZone(playerPos);
      zoneRad = zone?.data?.baseRadiation ?? 0.05;
    }

    // Enemy emission (inverse-square)
    let enemyRad = 0;
    for (const enemy of this._enemies) {
      if (!enemy.mesh.visible) continue;
      const dist = Math.max(enemy.mesh.position.distanceTo(playerPos), 0.5);
      enemyRad += (enemy.radiationEmit ?? 0) / (dist * dist);
    }

    const targetRaw = zoneRad + enemyRad;
    // Smooth toward target
    this._dosimeterRaw += (targetRaw - this._dosimeterRaw) * 2 * dt;

    // Normalise against max expected (approx 3 mSv/h = 1.0)
    this.dosimeter = THREE.MathUtils.clamp(this._dosimeterRaw / 3.0, 0, 1);

    Bus.emit(EV.DOSIMETER_CHANGE, {
      normalised: this.dosimeter,
      msvh: this._dosimeterRaw,
    });
  }

  // ── Audio state machine ───────────────────────────────────────

  _syncAudioState() {
    const v = this.tension;
    let newState = "explore";
    for (const { threshold, state } of AUDIO_STATES) {
      if (v >= threshold) newState = state;
    }
    if (newState !== this._audioState) {
      this._audioState = newState;
      Bus.emit(EV.AUDIO_STATE, { state: newState });
    }
  }

  // ── Post-processing driver ────────────────────────────────────

  _syncPostFX() {
    const t = this.tension;
    const d = this.dosimeter;
    const fx = this.engine.getSystem?.("postProcessing");
    if (!fx) return;

    // Chromatic aberration (driven by tension)
    const chromatic =
      t > FX.CHROMATIC_START
        ? THREE.MathUtils.smoothstep(t, FX.CHROMATIC_START, 1) * 0.015
        : 0;
    fx.setChromaticAberration?.(chromatic);

    // Desaturation at screen edges (driven by dosimeter)
    const desaturation =
      d > FX.DESATURATE_START
        ? THREE.MathUtils.smoothstep(d, FX.DESATURATE_START, 1)
        : 0;
    fx.setVignetteDesaturation?.(desaturation);

    // Distortion (near-caught or high dosimeter)
    const distort =
      t > FX.DISTORT_START || d > 0.95
        ? THREE.MathUtils.smoothstep(Math.max(t, d), FX.DISTORT_START, 1) * 0.02
        : 0;
    fx.setDistortion?.(distort);

    // Camera shake (driven by tension > 0.5)
    if (t > FX.SHAKE_START && this.engine.camera) {
      const intensity =
        THREE.MathUtils.smoothstep(t, FX.SHAKE_START, 1) * 0.015;
      this._shakeOffset.set(
        (Math.random() - 0.5) * intensity,
        (Math.random() - 0.5) * intensity,
        0,
      );
      fx.setCameraShake?.(this._shakeOffset);
    } else {
      fx.setCameraShake?.(new THREE.Vector3());
    }
  }

  // ── Hallucination audio ───────────────────────────────────────

  _updateHallucinations(dt) {
    if (this.dosimeter < FX.HALLUCINATE_START) {
      this._hallucinateTimer = 0;
      return;
    }

    this._hallucinateTimer -= dt;
    if (this._hallucinateTimer <= 0) {
      // Fire false creature sound at a random position near player
      const interval = THREE.MathUtils.lerp(
        20,
        5,
        (this.dosimeter - FX.HALLUCINATE_START) / 0.25,
      );
      this._hallucinateTimer = interval * (0.7 + Math.random() * 0.6);

      // Pick a phantom sound type (matches real enemy sounds but is "fake")
      const phantoms = [
        "rezagado_drag",
        "vigilante_click",
        "colectivo_step",
      ];
      const sound = phantoms[Math.floor(Math.random() * phantoms.length)];

      // Position 8-20 m away from player in a random direction
      const angle = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 12;
      const pos = this._player.position
        .clone()
        .add(
          new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist),
        );

      Bus.emit("audio:phantom", { sound, position: pos });
    }
  }

  // ── Night level ───────────────────────────────────────────────

  setNightLevel(n) {
    this._nightLevel = n;
  }

  // ── Public state getters ─────────────────────────────────────

  getAudioState() {
    return this._audioState;
  }
  getTension() {
    return this.tension;
  }
  getDosimeter() {
    return this.dosimeter;
  }

  // ── Disposal ─────────────────────────────────────────────────

  dispose() {
    this._unsubs.forEach((u) => u());
  }
}

export default TensionSystem;
