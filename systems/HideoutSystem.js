/**
 * systems/HideoutSystem.js
 * Manages all hideout objects: discovery, entry/exit, usage tracking,
 * and the progressive nightly closure mechanic.
 *
 * CLOSURE LOGIC (key design rule):
 *  - Hideouts NEVER close at random.
 *  - The MOST RECENTLY USED hideout closes first each night.
 *  - Closure happens during the day phase (player can't witness it).
 *  - At night start, closures are "revealed" with narrative context.
 *
 * HIDEOUT TYPES:
 *  'rack'       — clothing rack in Zona B / Zona H
 *  'locker'     — taquilla / storage cabinet
 *  'duct'       — ventilation shaft entrance
 *  'under_seat' — cinema seats in Zona E
 *  'desk'       — under a desk
 *  'shelf'      — behind a shelving unit
 *
 * Each hideout has:
 *  id, type, position, mesh, isOpen, isDiscovered, useCount[]
 */

import * as THREE from "three";
import { Bus, EV } from "../core/EventBus.js";

// ── Per-night hideout availability table ─────────────────────
const OPEN_COUNTS_PER_NIGHT = [8, 6, 4, 3, 2];

// ── Hideout class ─────────────────────────────────────────────
export class Hideout {
  /**
   * @param {object} cfg
   * @param {string}          cfg.id
   * @param {string}          cfg.type
   * @param {THREE.Vector3}   cfg.position
   * @param {THREE.Object3D}  cfg.mesh
   * @param {string}          cfg.zoneId
   * @param {boolean}         [cfg.requiresDiscovery=false] — true = hidden until player finds it
   */
  constructor(cfg) {
    this.id = cfg.id;
    this.type = cfg.type;
    this.position = cfg.position.clone();
    this.mesh = cfg.mesh;
    this.zoneId = cfg.zoneId;

    this.isOpen = true;
    this.isDiscovered = !cfg.requiresDiscovery; // discoverable ones start hidden
    this.requiresDiscovery = cfg.requiresDiscovery ?? false;

    // Per-night usage log: array indexed by nightNumber
    this._usesByNight = []; // [0]=night1 uses, [1]=night2 uses…

    // The timestamp of last use (for sorting)
    this.lastUsedAt = 0;
  }

  recordUse(nightNumber) {
    const idx = nightNumber - 1;
    this._usesByNight[idx] = (this._usesByNight[idx] ?? 0) + 1;
    this.lastUsedAt = Date.now();
  }

  getUseCount(nightNumber) {
    return this._usesByNight[nightNumber - 1] ?? 0;
  }

  getTotalUses() {
    return this._usesByNight.reduce((a, b) => a + (b ?? 0), 0);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    // Visual: add chain / weld marks (handled by caller)
    if (this.mesh) {
      this.mesh.userData.closed = true;
      // Tint the mesh red-ish to hint it's been sealed
      this.mesh.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mat = obj.material.clone();
          mat.color?.multiplyScalar(0.6);
          obj.material = mat;
        }
      });
    }
    Bus.emit(EV.HIDEOUT_CLOSED, { hideout: this });
  }

  /**
   * Forcibly destroy hideout (by El Colectivo).
   * More dramatic than close() — the mesh scatters.
   */
  destroy() {
    this.close();
    if (this.mesh) {
      // Simple "broken" effect: random rotation
      this.mesh.rotation.set(
        Math.random() * 0.3,
        Math.random() * Math.PI,
        Math.random() * 0.3,
      );
      this.mesh.position.y -= 0.1;
    }
  }
}

// ── HideoutSystem ─────────────────────────────────────────────
export class HideoutSystem {
  constructor(engine) {
    this.engine = engine;
    this._all = new Map(); // id -> Hideout
    this._open = new Set(); // ids of currently open hideouts
    this._closed = new Set(); // ids closed this run

    this._currentNight = 0;
    this._playerIsHiding = false;
    this._activeHideout = null; // Hideout player is currently in

    // Usage history: queue of hideout ids ordered by last use
    this._usageQueue = []; // most recent LAST

    this._unsubs = [];
    this._unsubs.push(
      Bus.on(EV.NIGHT_START, (d) => this._onNightStart(d)),
      Bus.on(EV.DAY_START, () => this._onDayStart()),
      Bus.on(EV.PLAYER_INTERACT, (d) => this._onPlayerInteract(d)),
      Bus.on(EV.HIDEOUT_CHECKED, (d) => this._onHideoutChecked(d)),
    );
  }

  // ── Registration ──────────────────────────────────────────

  /** Register a hideout into the system. Call during world setup. */
  register(hideout) {
    this._all.set(hideout.id, hideout);
    if (hideout.isOpen) this._open.add(hideout.id);
    return hideout;
  }

  /** Bulk-register an array of Hideout objects. */
  registerAll(hideouts) {
    hideouts.forEach((h) => this.register(h));
  }

  // ── Player interaction ────────────────────────────────────

  /**
   * Attempt to hide the player in a hideout.
   * @param {string} hideoutId
   * @param {object} player
   * @returns {boolean} success
   */
  enter(hideoutId, player) {
    const hideout = this._all.get(hideoutId);
    if (!hideout || !hideout.isOpen || !hideout.isDiscovered) return false;
    if (this._playerIsHiding) return false;

    this._playerIsHiding = true;
    this._activeHideout = hideout;

    hideout.recordUse(this._currentNight);
    this._updateUsageQueue(hideoutId);

    player.isHiding = true;
    player.currentHideout = hideout;

    Bus.emit(EV.PLAYER_HIDE, { hideout });
    Bus.emit(EV.HIDEOUT_USED, { hideout, nightNumber: this._currentNight });
    Bus.emit(EV.UI_HINT, {
      text: "Hold [E] to leave hiding spot",
      duration: 4,
    });
    return true;
  }

  /**
   * Remove player from current hideout.
   * @param {object} player
   */
  exit(player) {
    if (!this._playerIsHiding) return;
    this._playerIsHiding = false;
    this._activeHideout = null;
    player.isHiding = false;
    player.currentHideout = null;
    Bus.emit(EV.PLAYER_UNHIDE);
  }

  isPlayerHiding() {
    return this._playerIsHiding;
  }
  getActiveHideout() {
    return this._activeHideout;
  }

  // ── Discovery ─────────────────────────────────────────────

  /**
   * Called when the player walks close to a requiresDiscovery hideout.
   * @param {string} hideoutId
   * @param {object} player
   */
  discover(hideoutId, player) {
    const hideout = this._all.get(hideoutId);
    if (!hideout || hideout.isDiscovered) return;
    hideout.isDiscovered = true;
    Bus.emit(EV.HIDEOUT_DISCOVERED, { hideout, player });
    Bus.emit(EV.UI_HINT, {
      text: `Found hiding spot: ${hideout.type}`,
      duration: 3,
    });
  }

  // ── Usage queue ───────────────────────────────────────────

  _updateUsageQueue(id) {
    // Remove any existing entry and add to end (most recent)
    this._usageQueue = this._usageQueue.filter((x) => x !== id);
    this._usageQueue.push(id);
  }

  // ── Night lifecycle ───────────────────────────────────────

  _onNightStart({ nightNumber }) {
    this._currentNight = nightNumber;

    // How many hideouts should be open this night
    const targetOpen =
      OPEN_COUNTS_PER_NIGHT[
        Math.min(nightNumber - 1, OPEN_COUNTS_PER_NIGHT.length - 1)
      ];

    // Close the most-recently-used until we reach the target count
    const currentOpenList = [...this._open].filter((id) => {
      const h = this._all.get(id);
      return h && h.isOpen && h.isDiscovered;
    });

    const toClose = currentOpenList.length - targetOpen;

    if (toClose > 0) {
      // Sort by most recently used (front of usage queue = oldest, back = newest)
      const sortedByRecency = [...this._usageQueue].reverse(); // newest first
      let closed = 0;
      for (const id of sortedByRecency) {
        if (closed >= toClose) break;
        const h = this._all.get(id);
        if (h && h.isOpen) {
          h.close();
          this._open.delete(id);
          this._closed.add(id);
          closed++;
          // Hint: closed hideout gets a visible chain/seal in the world
        }
      }
    }

    // Night 5: one more may close MID-NIGHT (scheduled below)
    if (nightNumber >= 5) {
      this._scheduleNightClosure();
    }
  }

  _scheduleNightClosure() {
    // Close one more hideout randomly between 2-6 minutes into the night
    const delay = (120 + Math.random() * 240) * 1000;
    this._nightClosureTimeout = setTimeout(() => {
      const candidates = [...this._open].filter((id) => {
        const h = this._all.get(id);
        return h?.isDiscovered && h.isOpen;
      });
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const hideout = this._all.get(pick);
        hideout.close();
        this._open.delete(pick);
        // Dramatic: trigger nearby enemy to be near it when it closes
        Bus.emit("hideout:mid_night_close", { hideout });
      }
    }, delay);
  }

  _onDayStart() {
    // Cancel any pending mid-night closures
    if (this._nightClosureTimeout) {
      clearTimeout(this._nightClosureTimeout);
      this._nightClosureTimeout = null;
    }
    // If player is still hiding, force them out
    if (this._playerIsHiding) {
      Bus.emit(EV.PLAYER_UNHIDE);
      this._playerIsHiding = false;
      this._activeHideout = null;
    }
  }

  // ── Enemy checks ──────────────────────────────────────────

  _onHideoutChecked({ hideout, foundPlayer }) {
    if (!foundPlayer) return;
    // Enemy checked and player is there — caught handled in CheckHideoutState
  }

  _onPlayerInteract({ target }) {
    if (!target?.hideoutId) return;
    // Handled externally by Player.InteractionSystem
  }

  // ── Queries ───────────────────────────────────────────────

  getAll() {
    return [...this._all.values()];
  }
  getOpen() {
    return [...this._open].map((id) => this._all.get(id)).filter(Boolean);
  }
  getClosed() {
    return [...this._closed].map((id) => this._all.get(id)).filter(Boolean);
  }
  getDiscovered() {
    return this.getAll().filter((h) => h.isDiscovered);
  }
  getByZone(zoneId) {
    return this.getAll().filter((h) => h.zoneId === zoneId);
  }

  /** Returns the most recently used hideout id (for enemy AI). */
  getMostRecentlyUsedId() {
    return this._usageQueue.length
      ? this._usageQueue[this._usageQueue.length - 1]
      : null;
  }

  // ── Disposal ─────────────────────────────────────────────

  dispose() {
    this._unsubs.forEach((u) => u());
    if (this._nightClosureTimeout) clearTimeout(this._nightClosureTimeout);
  }

  update(dt) {}
}

export default HideoutSystem;
