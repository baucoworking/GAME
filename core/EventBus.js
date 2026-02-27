/**
 * core/EventBus.js
 * Lightweight pub/sub event bus. Singleton exported as `Bus`.
 *
 * Usage:
 *   import { Bus, EV } from './core/EventBus.js';
 *   Bus.on(EV.PLAYER_NOISE, ({ position, intensity }) => { ... });
 *   Bus.emit(EV.PLAYER_NOISE, { position: vec3, intensity: 3 });
 */

class EventBus {
  constructor() {
    this._map = new Map(); // eventName -> Set<Function>
  }

  /**
   * Subscribe to an event.
   * @param {string}   event
   * @param {Function} cb
   * @returns {Function} unsubscribe function
   */
  on(event, cb) {
    if (!this._map.has(event)) this._map.set(event, new Set());
    this._map.get(event).add(cb);
    return () => this._map.get(event)?.delete(cb);
  }

  /** Subscribe once — automatically removed after first call. */
  once(event, cb) {
    const wrapper = (data) => {
      cb(data);
      this._map.get(event)?.delete(wrapper);
    };
    return this.on(event, wrapper);
  }

  /** Unsubscribe a specific callback. */
  off(event, cb) {
    this._map.get(event)?.delete(cb);
  }

  /** Publish an event to all subscribers. */
  emit(event, data) {
    this._map.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (e) {
        console.error(`[EventBus] Error in "${event}" handler:`, e);
      }
    });
  }

  /** Remove all listeners for an event (or all events if none given). */
  clear(event) {
    if (event) this._map.delete(event);
    else this._map.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────
export const Bus = new EventBus();

// ── Event name catalogue ──────────────────────────────────────
export const EV = {
  // Lifecycle
  GAME_INIT: "game:init",
  GAME_OVER: "game:over",
  GAME_WIN: "game:win",

  // Night/Day
  NIGHT_START: "night:start", // { nightNumber }
  NIGHT_END: "night:end", // { nightNumber }
  DAY_START: "day:start",
  DAY_END: "day:end",
  DAYTIME_PROGRESS: "day:progress", // { t: 0..1 }

  // Player
  PLAYER_NOISE: "player:noise", // { position:Vector3, intensity:number, wet:bool }
  PLAYER_RUN_START: "player:run_start",
  PLAYER_RUN_STOP: "player:run_stop",
  PLAYER_CROUCH: "player:crouch", // { isCrouching }
  PLAYER_HIDE: "player:hide", // { hideout }
  PLAYER_UNHIDE: "player:unhide",
  PLAYER_INTERACT: "player:interact", // { target }
  PLAYER_CAUGHT: "player:caught",
  PLAYER_WET: "player:wet", // { isWet }
  PLAYER_ZONE_CHANGE: "player:zone", // { zoneId }

  // Enemies
  ENEMY_SPAWNED: "enemy:spawned", // { enemy }
  ENEMY_STATE_CHANGE: "enemy:state", // { enemy, from, to }
  ENEMY_HEARD_NOISE: "enemy:heard", // { enemy, noisePos }
  ENEMY_SAW_PLAYER: "enemy:saw", // { enemy, playerPos }
  ENEMY_LOST_PLAYER: "enemy:lost", // { enemy }
  ENEMY_CAUGHT_PLAYER: "enemy:caught",
  ENEMY_CHECK_HIDEOUT: "enemy:checking", // { enemy, hideout }

  // Hideouts
  HIDEOUT_DISCOVERED: "hideout:found", // { hideout, player }
  HIDEOUT_USED: "hideout:used", // { hideout, nightNumber }
  HIDEOUT_CLOSED: "hideout:closed", // { hideout }
  HIDEOUT_CHECKED: "hideout:checked", // { hideout, foundPlayer:bool }

  // Puzzles / Items
  PUZZLE_SOLVED: "puzzle:solved", // { puzzleId }
  ITEM_PICKUP: "item:pickup", // { itemId }
  ITEM_USED: "item:used", // { itemId, targetId }
  ELECTRICITY_ON: "world:electricity_on",

  // Tension
  TENSION_CHANGE: "tension:change", // { value:0..1 }
  DOSIMETER_CHANGE: "dosimeter:change", // { normalised:0..1, msvh:number }

  // Audio
  AUDIO_STATE: "audio:state", // { state:'explore'|'alert'|'danger'|'contact' }
  AUDIO_LURE_START: "audio:lure", // { position, duration }

  // Perception distortion (La Presencia)
  PERCEPTION_DISTORT: "perception:distort", // { intensity }
  PERCEPTION_RESTORE: "perception:restore",

  // UI
  UI_HINT: "ui:hint", // { text, duration }
  UI_NOTE: "ui:note", // { title, body }
  UI_NIGHT_OVERLAY: "ui:night", // { nightNumber }
};

export default Bus;
