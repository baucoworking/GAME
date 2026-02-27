/**
 * systems/NightProgression.js
 * Manages which enemies are active each night, their difficulty scaling,
 * and special scripted events.
 *
 * Night summary:
 *  N1: 1 Rezagado. Fixed patrol. Slow. First LESNOJ note.
 *  N2: 2 Rezagados + 1 Vigilante. Blackout event. Hideout B closed.
 *  N3: 3 Rezagados + Vigilante + La Presencia. Radio event.
 *  N4: 4 Rezagados + Vigilante + Presencia + Colectivo. Viktor cameo.
 *  N5: All enemies, frenzy mode. Viktor boss sequence.
 *
 * Adaptation:
 *  - adaptRate increases linearly from 0 → 1 across each night
 *  - Enemies poll setNightLevel(night, adaptRate) from this system
 */

import { Bus, EV } from "../core/EventBus.js";
import { AI_STATE } from "../core/StateMachine.js";
import { VIKTOR_STATE } from "../enemies/ViktorBoss.js";

// ── Night script definitions ─────────────────────────────────
const NIGHT_SCRIPTS = {
  1: {
    enemies: ["rezagado_1"],
    events: [
      {
        type: "scripted_appearance",
        enemyId: "rezagado_1",
        delay: 30,
        note: "Something drags across the floor in the distance…",
      },
    ],
  },
  2: {
    enemies: ["rezagado_1", "rezagado_2", "vigilante_1"],
    events: [
      {
        type: "blackout",
        delay: 180,
        duration: 90,
        note: "The emergency generator just failed.",
      },
      { type: "presencia_scripted", delay: 300, note: "" }, // Presencia appears silently — no hint
    ],
  },
  3: {
    enemies: [
      "rezagado_1",
      "rezagado_2",
      "rezagado_3",
      "vigilante_1",
      "presencia_1",
    ],
    events: [
      {
        type: "radio_plays",
        delay: 120,
        note: "A voice crackles from the cafeteria radio…",
      },
    ],
  },
  4: {
    enemies: [
      "rezagado_1",
      "rezagado_2",
      "rezagado_3",
      "rezagado_4",
      "vigilante_1",
      "presencia_1",
      "colectivo_1",
    ],
    events: [
      { type: "viktor_cameo", delay: 400, note: "" }, // No hint — sudden silhouette
    ],
  },
  5: {
    enemies: [
      "rezagado_1",
      "rezagado_2",
      "rezagado_3",
      "rezagado_4",
      "vigilante_1",
      "presencia_1",
      "colectivo_1",
      "viktor",
    ],
    events: [{ type: "frenzy_start", delay: 60, note: "" }],
    isFinal: true,
  },
};

export class NightProgression {
  /**
   * @param {object} cfg
   * @param {Map}    cfg.enemyRegistry  — Map<id, EnemyBase> with all enemies pre-created
   * @param {object} cfg.hideoutSystem
   * @param {object} cfg.tensionSystem
   */
  constructor(cfg) {
    this._registry = cfg.enemyRegistry; // Map<string, EnemyBase>
    this._hideouts = cfg.hideoutSystem;
    this._tension = cfg.tensionSystem;

    this._currentNight = 0;
    this._nightElapsed = 0;
    this._nightDuration = 600; // 10 min
    this._adaptRate = 0;

    this._activeEnemyIds = new Set();
    this._firedEvents = new Set(); // "N-eventIndex" keys
    this._isDay = false;
    this._pendingTimers = [];

    this._unsubs = [];
    this._unsubs.push(
      Bus.on(EV.NIGHT_START, (d) => this._onNightStart(d)),
      Bus.on(EV.DAY_START, () => this._onDayStart()),
    );
  }

  // ── Night start ───────────────────────────────────────────────

  _onNightStart({ nightNumber }) {
    this._currentNight = nightNumber;
    this._nightElapsed = 0;
    this._adaptRate = 0;
    this._isDay = false;
    this._firedEvents.clear();
    this._clearTimers();

    const script = NIGHT_SCRIPTS[nightNumber];
    if (!script) {
      console.warn(`[NightProgression] No script for night ${nightNumber}`);
      return;
    }

    // Deactivate enemies not in this night
    for (const [id, enemy] of this._registry) {
      if (!script.enemies.includes(id)) {
        enemy.fsm.setState(AI_STATE.DORMANT);
        this._activeEnemyIds.delete(id);
      }
    }

    // Activate enemies for this night
    for (const id of script.enemies) {
      const enemy = this._registry.get(id);
      if (enemy) {
        enemy.setNightLevel(nightNumber, 0);
        // Note: enemy._onNightStart handles the actual state transition via Bus
        this._activeEnemyIds.add(id);
      }
    }

    // Schedule scripted events
    script.events.forEach((event, idx) => {
      const timer = setTimeout(
        () => {
          if (!this._isDay) this._fireEvent(event, nightNumber, idx);
        },
        (event.delay ?? 0) * 1000,
      );
      this._pendingTimers.push(timer);
    });

    // Night 5: reset Rezagado night memory (fresh start for final night)
    if (nightNumber >= 5) {
      for (const [, enemy] of this._registry) {
        enemy.resetNightMemory?.();
      }
    }
  }

  // ── Day start ─────────────────────────────────────────────────

  _onDayStart() {
    this._isDay = true;
    this._clearTimers();

    // Reset per-night Rezagado hide counts
    for (const [, enemy] of this._registry) {
      enemy.resetNightMemory?.();
    }
  }

  // ── Per-frame ─────────────────────────────────────────────────

  update(dt) {
    if (this._isDay) return;
    this._nightElapsed += dt;

    // Adaptation rate: 0 → 1 over night duration
    this._adaptRate = Math.min(this._nightElapsed / this._nightDuration, 1);

    // Push adaptation to active enemies
    for (const id of this._activeEnemyIds) {
      const enemy = this._registry.get(id);
      enemy?.setNightLevel(this._currentNight, this._adaptRate);
    }

    // Coordination: Night 4+ coordinate hide-checking between Rezagados
    if (this._currentNight >= 4 && Math.random() < 0.005) {
      this._coordinateEnemies();
    }
  }

  // ── Scripted events ───────────────────────────────────────────

  _fireEvent(event, nightNumber, idx) {
    const key = `${nightNumber}-${idx}`;
    if (this._firedEvents.has(key)) return;
    this._firedEvents.add(key);

    if (event.note) {
      Bus.emit(EV.UI_HINT, { text: event.note, duration: 5 });
    }

    switch (event.type) {
      case "scripted_appearance":
        // Rezagado crosses the atrium at a distance
        Bus.emit("scripted:first_appearance", { enemyId: event.enemyId });
        break;

      case "blackout":
        Bus.emit("world:blackout", { duration: event.duration });
        setTimeout(
          () => Bus.emit("world:power_restore"),
          event.duration * 1000,
        );
        break;

      case "presencia_scripted":
        const presencia = this._registry.get("presencia_1");
        if (presencia) {
          presencia.fsm.setState(AI_STATE.IDLE);
        }
        break;

      case "radio_plays":
        Bus.emit("world:radio_activate");
        break;

      case "viktor_cameo":
        Bus.emit("boss:trigger_cameo");
        break;

      case "frenzy_start":
        // Switch all active enemies to frenzy mode
        for (const id of this._activeEnemyIds) {
          const enemy = this._registry.get(id);
          if (enemy && !enemy.fsm.is(AI_STATE.DORMANT)) {
            enemy.fsm.setState(AI_STATE.FRENZY);
          }
        }
        Bus.emit(EV.AUDIO_STATE, { state: "contact" });
        break;
    }
  }

  // ── Enemy coordination (Night 4+) ─────────────────────────────

  /**
   * Pick one Rezagado to check the most recently used hideout
   * while others continue patrolling nearby — coordinated pressure.
   */
  _coordinateEnemies() {
    const mostRecent = this._hideouts?.getMostRecentlyUsedId?.();
    if (!mostRecent) return;

    const hideout = this._hideouts?._all?.get(mostRecent);
    if (!hideout) return;

    // Find the Rezagado closest to the hideout
    let closest = null;
    let closestD = Infinity;

    for (const id of this._activeEnemyIds) {
      const enemy = this._registry.get(id);
      if (!enemy || !id.startsWith("rezagado")) continue;
      if (!enemy.fsm.isAny(AI_STATE.PATROL, AI_STATE.IDLE)) continue;

      const d = enemy.mesh.position.distanceTo(hideout.position);
      if (d < closestD) {
        closestD = d;
        closest = enemy;
      }
    }

    if (closest) {
      closest.scheduleHideoutCheck(hideout);
    }
  }

  // ── Viktor sewer triggers ─────────────────────────────────────

  /** Call from SewerSystem when player enters sewer level 2 */
  triggerViktorSewer() {
    Bus.emit("boss:trigger_sewer");
  }

  /** Call from SewerSystem when player reaches the trigger point */
  triggerViktorPursue() {
    Bus.emit("boss:trigger_pursue");
  }

  // ── Utility ───────────────────────────────────────────────────

  _clearTimers() {
    this._pendingTimers.forEach((t) => clearTimeout(t));
    this._pendingTimers = [];
  }

  getActiveEnemies() {
    return [...this._activeEnemyIds]
      .map((id) => this._registry.get(id))
      .filter(Boolean);
  }

  dispose() {
    this._unsubs.forEach((u) => u());
    this._clearTimers();
  }
}

export default NightProgression;
