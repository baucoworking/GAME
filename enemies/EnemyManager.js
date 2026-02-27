/**
 * enemies/EnemyManager.js
 * Top-level integration layer.
 *
 * Responsibilities:
 *  1. Instantiate all enemy types with correct parameters
 *  2. Provide a single update(dt) call the game loop uses
 *  3. Expose the enemyRegistry Map used by NightProgression
 *  4. Wire enemy list to TensionSystem
 *  5. Handle sound event dispatch to AudioSystem via userData flags
 *
 * HOW TO USE:
 *
 *   // During world setup (after navmesh is built):
 *   const manager = new EnemyManager({
 *     scene, navMesh, playerRef, collidables,
 *     patrolRoutes, strategicPositions, manifestPoints,
 *     cameoPosition, collapseRoomCenter,
 *   });
 *   manager.init();
 *
 *   // In the game loop:
 *   manager.update(dt);
 *
 *   // Pass registry to other systems:
 *   new NightProgression({ enemyRegistry: manager.registry, ... });
 *   new TensionSystem(engine, playerRef, manager.activeEnemyList, zones);
 */

import { Rezagado } from "./Rezagado.js";
import { Vigilante } from "./Vigilante.js";
import { Presencia } from "./Presencia.js";
import { Colectivo } from "./Colectivo.js";
import { ViktorBoss } from "./ViktorBoss.js";
import { Bus, EV } from "../core/EventBus.js";
import * as THREE from "three";

export class EnemyManager {
  /**
   * @param {object}             cfg
   * @param {THREE.Scene}        cfg.scene
   * @param {NavigationMesh}     cfg.navMesh
   * @param {object}             cfg.playerRef         — live player object
   * @param {THREE.Object3D[]}   cfg.collidables        — walls for raycasting LOS
   *
   * — Patrol / positioning —
   * @param {THREE.Vector3[][]}  cfg.patrolRoutes        — [route1[], route2[], route3[], route4[]]
   * @param {THREE.Vector3[]}    cfg.vigilantePositions  — strategic guard positions
   * @param {THREE.Vector3[]}    cfg.manifestPoints      — Presencia teleport points
   * @param {string[]}           cfg.colectivoZones      — large zone IDs for Colectivo
   * @param {THREE.Vector3}      cfg.cameoPosition       — Viktor Night 4 sighting
   * @param {THREE.Vector3}      cfg.collapseRoomCenter  — boss chamber centre
   */
  constructor(cfg) {
    this._cfg = cfg;
    this.registry = new Map(); // id -> EnemyBase
    this._list = []; // ordered list for update loop
  }

  // ── Initialisation ────────────────────────────────────────────

  init() {
    const {
      scene,
      navMesh,
      playerRef,
      collidables,
      patrolRoutes,
      vigilantePositions,
      manifestPoints,
      colectivoZones,
      cameoPosition,
      collapseRoomCenter,
    } = this._cfg;

    const base = { scene, navMesh, playerRef, collidables };

    // ── Rezagados (up to 4) ──────────────────────────────────
    for (let i = 0; i < 4; i++) {
      const rezagado = new Rezagado({
        ...base,
        patrolWaypoints: patrolRoutes?.[i] ?? [],
      });
      this._register(`rezagado_${i + 1}`, rezagado);
    }

    // ── Vigilante ────────────────────────────────────────────
    const vigilante = new Vigilante({
      ...base,
      patrolWaypoints: vigilantePositions ?? [],
      strategicPositions: vigilantePositions ?? [],
    });
    this._register("vigilante_1", vigilante);

    // ── La Presencia ─────────────────────────────────────────
    const presencia = new Presencia({
      ...base,
      manifestPoints: manifestPoints ?? [],
    });
    this._register("presencia_1", presencia);

    // ── El Colectivo ──────────────────────────────────────────
    const colectivo = new Colectivo({
      ...base,
      allowedZoneIds: colectivoZones ?? [],
    });
    this._register("colectivo_1", colectivo);

    // ── Viktor Boss ───────────────────────────────────────────
    const viktor = new ViktorBoss({
      ...base,
      cameoPosition,
      collapseRoomCenter,
    });
    this._register("viktor", viktor);

    // All enemies start dormant — NightProgression activates them
    for (const [, enemy] of this.registry) {
      enemy.fsm.setState("dormant");
    }
  }

  _register(id, enemy) {
    enemy.id = id; // override auto-id with semantic id
    this.registry.set(id, enemy);
    this._list.push(enemy);
  }

  // ── Public API ────────────────────────────────────────────────

  /** Main update — call once per frame from game loop. */
  update(dt) {
    for (const enemy of this._list) {
      enemy.update(dt);
      this._flushSoundCues(enemy);
    }
  }

  /** Live array of all enemies (used by TensionSystem). */
  get activeEnemyList() {
    return this._list;
  }

  getEnemy(id) {
    return this.registry.get(id);
  }

  /** Set night level on all registered enemies. */
  setNightLevel(night, adaptRate) {
    for (const [, enemy] of this.registry) {
      enemy.setNightLevel(night, adaptRate);
    }
  }

  // ── Sound cue dispatch ────────────────────────────────────────

  /**
   * Enemies flag sound cues via userData properties.
   * This reads them each frame and dispatches to AudioSystem via Bus.
   */
  _flushSoundCues(enemy) {
    const ud = enemy.mesh?.userData;
    if (!ud) return;

    if (ud.playSound) {
      Bus.emit("audio:play_3d", {
        id: ud.playSound,
        position: enemy.mesh.position.clone(),
        volume: 1.0,
      });
      ud.playSound = null;
    }

    if (ud.gaitStep) {
      const sound =
        ud.audioType === "colectivo" ? "colectivo_step" : "rezagado_drag";
      Bus.emit("audio:play_3d", {
        id: sound,
        position: enemy.mesh.position.clone(),
        volume: 0.6,
      });
      ud.gaitStep = false;
    }
  }

  // ── Disposal ─────────────────────────────────────────────────

  dispose() {
    for (const [, enemy] of this.registry) {
      enemy.dispose();
    }
    this.registry.clear();
    this._list = [];
  }
}

export default EnemyManager;
