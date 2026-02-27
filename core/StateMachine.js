/**
 * core/StateMachine.js
 * Generic Finite State Machine — used by every AI entity in Chernobyl Mall.
 *
 * Usage:
 *   const fsm = new StateMachine(owner);
 *   fsm.add(new PatrolState('patrol', owner))
 *      .add(new ChaseState ('chase',  owner));
 *   fsm.setState('patrol');
 *   // in game loop:
 *   fsm.update(dt);
 */

// ─────────────────────────────────────────────────────────────
// State base class
// ─────────────────────────────────────────────────────────────
export class State {
  constructor(name, owner) {
    this.name = name;
    this.owner = owner;
    this.machine = null; // injected by StateMachine.add()
  }

  /** Called once when the FSM enters this state. @param {State|null} prev */
  onEnter(prev) {}

  /** Called every game-loop tick while this state is active. @param {number} dt */
  onUpdate(dt) {}

  /** Called once when the FSM leaves this state. @param {State} next */
  onExit(next) {}

  /** Convenience shortcut so states can request their own transitions. */
  go(stateName) {
    this.machine.setState(stateName);
  }
}

// ─────────────────────────────────────────────────────────────
// Shared AI state-name constants
// ─────────────────────────────────────────────────────────────
export const AI_STATE = {
  DORMANT: "dormant", // daytime rest — no activity
  IDLE: "idle", // night, standing still
  PATROL: "patrol", // following waypoint loop
  ALERT: "alert", // heard/sensed something — moving to investigate
  SEARCH: "search", // lost player — spiral / grid search
  CHASE: "chase", // has LOS on player — pursuing
  CHECK_HIDEOUT: "check_hideout", // walking to inspect a suspected hideout
  STUNNED: "stunned", // distracted by projector / radio lure
  FRENZY: "frenzy", // night 5 max-aggression
};

// ─────────────────────────────────────────────────────────────
// StateMachine
// ─────────────────────────────────────────────────────────────
export class StateMachine {
  constructor(owner) {
    this.owner = owner;
    this._states = new Map();
    this.current = null;
    this.previous = null;
    this._history = []; // ring-buffer of past state names
    this._maxHistory = 8;
    this._transitioning = false; // guard against re-entrant transitions
  }

  // ── Registration ──────────────────────────────────────────

  /** Add a State. Returns `this` for chaining. */
  add(state) {
    state.machine = this;
    state.owner = this.owner;
    this._states.set(state.name, state);
    return this;
  }

  // ── Transition ────────────────────────────────────────────

  /**
   * Transition to `name`. Safe to call from inside onUpdate / onEnter / onExit.
   * @param {string}  name
   * @param {boolean} [force=false]  Allow self-transition
   * @returns {boolean}
   */
  setState(name, force = false) {
    if (this._transitioning) {
      // Defer to avoid stack overflow on re-entrant calls
      Promise.resolve().then(() => this.setState(name, force));
      return false;
    }

    const next = this._states.get(name);
    if (!next) {
      console.warn(
        `[StateMachine:${this.owner?.id ?? "?"}] Unknown state "${name}"`,
      );
      return false;
    }
    if (!force && this.current?.name === name) return false;

    this._transitioning = true;

    const prev = this.current;
    prev?.onExit(next);

    if (prev) {
      this._history.unshift(prev.name);
      if (this._history.length > this._maxHistory) this._history.pop();
    }

    this.previous = prev;
    this.current = next;
    next.onEnter(prev);

    this._transitioning = false;
    return true;
  }

  // ── Tick ──────────────────────────────────────────────────

  /** Delegates update to the active state. */
  update(dt) {
    this.current?.onUpdate(dt);
  }

  // ── Queries ───────────────────────────────────────────────

  is(name) {
    return this.current?.name === name;
  }
  isAny(...names) {
    return names.includes(this.current?.name);
  }
  get name() {
    return this.current?.name ?? null;
  }
  get prevName() {
    return this._history[0] ?? null;
  }
}

export default StateMachine;
