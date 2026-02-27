/**
 * enemies/AIStateMachine.js
 * Specialised FSM wiring with built-in state implementations
 * shared across all enemy types in Chernobyl Mall.
 *
 * Each concrete enemy (Rezagado, Vigilante…) uses this as a base
 * and can override individual state classes for custom behaviour.
 *
 * Depends on:
 *   core/StateMachine.js  — State, StateMachine, AI_STATE
 *   core/EventBus.js      — Bus, EV
 *   world/NavigationMesh.js
 */

import * as THREE from "three";
import { State, StateMachine, AI_STATE } from "../core/StateMachine.js";
import { Bus, EV } from "../core/EventBus.js";

// ─────────────────────────────────────────────────────────────
// Helper: move `mesh` along a navmesh path toward `target`.
// Returns true when the waypoint is reached.
// ─────────────────────────────────────────────────────────────
function moveAlongPath(mesh, path, speed, dt) {
  if (!path || path.length === 0) return true;

  const target = path[0];
  const dir = new THREE.Vector3(
    target.x - mesh.position.x,
    0,
    target.z - mesh.position.z,
  );
  const dist = dir.length();

  if (dist < 0.15) {
    path.shift();
    return path.length === 0;
  }

  dir.normalize().multiplyScalar(speed * dt);
  mesh.position.add(dir);

  // Face movement direction
  mesh.rotation.y = Math.atan2(dir.x, dir.z);
  return false;
}

// ─────────────────────────────────────────────────────────────
// DORMANT — daytime, completely inactive
// ─────────────────────────────────────────────────────────────
export class DormantState extends State {
  constructor(owner) {
    super(AI_STATE.DORMANT, owner);
  }

  onEnter() {
    this.owner.mesh.visible = false; // hide during day
  }

  onExit() {
    this.owner.mesh.visible = true;
  }
}

// ─────────────────────────────────────────────────────────────
// IDLE — night, standing at current position
// ─────────────────────────────────────────────────────────────
export class IdleState extends State {
  constructor(owner) {
    super(AI_STATE.IDLE, owner);
  }
  onEnter() {
    this.owner._idleTimer = 1 + Math.random() * 2;
  }

  onUpdate(dt) {
    this.owner._idleTimer -= dt;
    if (this.owner._idleTimer <= 0) {
      this.go(AI_STATE.PATROL);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// PATROL — follow waypoint loop
// ─────────────────────────────────────────────────────────────
export class PatrolState extends State {
  constructor(owner) {
    super(AI_STATE.PATROL, owner);
  }

  onEnter() {
    this._path = [];
    this._waypointIndex = this.owner._patrolIndex ?? 0;
    this._requestPath();
  }

  _requestPath() {
    const waypoints = this.owner.patrolWaypoints;
    if (!waypoints || waypoints.length === 0) return;
    const target = waypoints[this._waypointIndex];
    this._path = this.owner.navMesh.findPath(this.owner.mesh.position, target);
    this._path = this.owner.navMesh.smoothPath(this._path);
  }

  onUpdate(dt) {
    const reached = moveAlongPath(
      this.owner.mesh,
      this._path,
      this.owner.patrolSpeed,
      dt,
    );
    if (reached) {
      const wp = this.owner.patrolWaypoints;
      this._waypointIndex = (this._waypointIndex + 1) % wp.length;
      this.owner._patrolIndex = this._waypointIndex;
      this.go(AI_STATE.IDLE);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ALERT — heard a noise, moving to investigate last-heard position
// ─────────────────────────────────────────────────────────────
export class AlertState extends State {
  constructor(owner) {
    super(AI_STATE.ALERT, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    this._path = this.owner.navMesh.findPath(
      this.owner.mesh.position,
      this.owner._alertTarget.clone(),
    );
    this._path = this.owner.navMesh.smoothPath(this._path);
    this._timeout = 8; // give up after 8 s if nothing found
  }

  onUpdate(dt) {
    this._timeout -= dt;
    if (this._timeout <= 0) {
      this.go(AI_STATE.SEARCH);
      return;
    }

    const reached = moveAlongPath(
      this.owner.mesh,
      this._path,
      this.owner.alertSpeed,
      dt,
    );

    if (reached) {
      // Arrived at noise origin — switch to search
      this.go(AI_STATE.SEARCH);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SEARCH — lost player, executing expanding spiral search
// ─────────────────────────────────────────────────────────────
export class SearchState extends State {
  constructor(owner) {
    super(AI_STATE.SEARCH, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    this._buildSpiralPoints();
    this._pointIndex = 0;
    this._totalTime = 0;
    this._maxSearchTime = 20 + Math.random() * 10;
    this._goToNext();
  }

  _buildSpiralPoints() {
    // Archimedean spiral centred on last known player position
    const centre =
      this.owner._lastKnownPlayerPos?.clone() ??
      this.owner.mesh.position.clone();
    this._points = [];
    const steps = 12;
    const coils = 3;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2 * coils;
      const r = (i / steps) * this.owner.searchRadius;
      const x = centre.x + Math.cos(angle) * r;
      const z = centre.z + Math.sin(angle) * r;
      this._points.push(new THREE.Vector3(x, centre.y, z));
    }
  }

  _goToNext() {
    if (this._pointIndex >= this._points.length) {
      this.go(AI_STATE.PATROL);
      return;
    }
    this._path = this.owner.navMesh.findPath(
      this.owner.mesh.position,
      this._points[this._pointIndex],
    );
    this._path = this.owner.navMesh.smoothPath(this._path);
  }

  onUpdate(dt) {
    this._totalTime += dt;
    if (this._totalTime >= this._maxSearchTime) {
      this.go(AI_STATE.PATROL);
      return;
    }

    const reached = moveAlongPath(
      this.owner.mesh,
      this._path,
      this.owner.alertSpeed,
      dt,
    );
    if (reached) {
      this._pointIndex++;
      this._goToNext();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// CHASE — has direct LOS to player, pursuing
// ─────────────────────────────────────────────────────────────
export class ChaseState extends State {
  constructor(owner) {
    super(AI_STATE.CHASE, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    Bus.emit(EV.ENEMY_SAW_PLAYER, { enemy: this.owner });
    this._pathRefreshTimer = 0;
    this._lostTimer = 0;
    this._catchRadius = 1.0;
  }

  onUpdate(dt) {
    const player = this.owner._playerRef;
    if (!player) return;

    const dist = this.owner.mesh.position.distanceTo(player.position);

    // Catch
    if (dist < this._catchRadius) {
      Bus.emit(EV.ENEMY_CAUGHT_PLAYER, { enemy: this.owner });
      Bus.emit(EV.PLAYER_CAUGHT);
      this.go(AI_STATE.IDLE);
      return;
    }

    // Check if still has LOS
    if (!this.owner._checkLOS(player.position)) {
      this._lostTimer += dt;
      if (this._lostTimer > 1.5) {
        this.owner._lastKnownPlayerPos = player.position.clone();
        Bus.emit(EV.ENEMY_LOST_PLAYER, { enemy: this.owner });
        this.go(AI_STATE.SEARCH);
        return;
      }
    } else {
      this._lostTimer = 0;
      this.owner._lastKnownPlayerPos = player.position.clone();
    }

    // Refresh path toward player
    this._pathRefreshTimer -= dt;
    if (this._pathRefreshTimer <= 0) {
      this._pathRefreshTimer = 0.35; // re-path every 350 ms
      this._path = this.owner.navMesh.findPath(
        this.owner.mesh.position,
        player.position,
      );
    }

    moveAlongPath(this.owner.mesh, this._path, this.owner.chaseSpeed, dt);
  }
}

// ─────────────────────────────────────────────────────────────
// CHECK_HIDEOUT — walking to inspect a suspected hideout
// ─────────────────────────────────────────────────────────────
export class CheckHideoutState extends State {
  constructor(owner) {
    super(AI_STATE.CHECK_HIDEOUT, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    const hideout = this.owner._hideoutToCheck;
    if (!hideout) {
      this.go(AI_STATE.PATROL);
      return;
    }

    Bus.emit(EV.ENEMY_CHECK_HIDEOUT, { enemy: this.owner, hideout });
    this._path = this.owner.navMesh.findPath(
      this.owner.mesh.position,
      hideout.position,
    );
    this._path = this.owner.navMesh.smoothPath(this._path);
    this._hideout = hideout;
  }

  onUpdate(dt) {
    const reached = moveAlongPath(
      this.owner.mesh,
      this._path,
      this.owner.alertSpeed,
      dt,
    );

    if (reached) {
      // Check if player is hiding here
      const player = this.owner._playerRef;
      const hiding =
        player?.isHiding && player?.currentHideout === this._hideout;
      Bus.emit(EV.HIDEOUT_CHECKED, {
        hideout: this._hideout,
        foundPlayer: hiding,
      });
      if (hiding) {
        Bus.emit(EV.PLAYER_CAUGHT);
      }
      this.go(AI_STATE.PATROL);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// STUNNED — distracted by audio lure (projector / radio)
// ─────────────────────────────────────────────────────────────
export class StunnedState extends State {
  constructor(owner) {
    super(AI_STATE.STUNNED, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    this._timer = this.owner._stunDuration ?? 30; // seconds
    // Move toward lure source
    const lurePos = this.owner._lurePosition;
    if (lurePos) {
      this._path = this.owner.navMesh.findPath(
        this.owner.mesh.position,
        lurePos,
      );
    }
    this._atLure = false;
  }

  onUpdate(dt) {
    this._timer -= dt;
    if (this._timer <= 0) {
      this.go(AI_STATE.PATROL);
      return;
    }
    if (!this._atLure && this._path?.length) {
      this._atLure = moveAlongPath(
        this.owner.mesh,
        this._path,
        this.owner.patrolSpeed,
        dt,
      );
    }
    // oscillate slightly while at lure (watching projector screen)
    if (this._atLure) {
      this.owner.mesh.rotation.y += Math.sin(Date.now() * 0.002) * 0.01;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// FRENZY — Night 5, max aggression, no search phase
// ─────────────────────────────────────────────────────────────
export class FrenzyState extends State {
  constructor(owner) {
    super(AI_STATE.FRENZY, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    this._pathTimer = 0;
  }

  onUpdate(dt) {
    const player = this.owner._playerRef;
    if (!player) return;

    const dist = this.owner.mesh.position.distanceTo(player.position);
    if (dist < 1.0) {
      Bus.emit(EV.PLAYER_CAUGHT);
      return;
    }

    this._pathTimer -= dt;
    if (this._pathTimer <= 0) {
      this._pathTimer = 0.2;
      this._path = this.owner.navMesh.findPath(
        this.owner.mesh.position,
        player.position,
      );
    }
    moveAlongPath(this.owner.mesh, this._path, this.owner.chaseSpeed * 1.3, dt);
  }
}

// ─────────────────────────────────────────────────────────────
// Factory: build a full AI FSM with all standard states
// ─────────────────────────────────────────────────────────────
export function buildAIFSM(enemy, overrides = {}) {
  const fsm = new StateMachine(enemy);

  const stateClasses = {
    [AI_STATE.DORMANT]: DormantState,
    [AI_STATE.IDLE]: IdleState,
    [AI_STATE.PATROL]: PatrolState,
    [AI_STATE.ALERT]: AlertState,
    [AI_STATE.SEARCH]: SearchState,
    [AI_STATE.CHASE]: ChaseState,
    [AI_STATE.CHECK_HIDEOUT]: CheckHideoutState,
    [AI_STATE.STUNNED]: StunnedState,
    [AI_STATE.FRENZY]: FrenzyState,
    ...overrides, // enemy-specific overrides
  };

  for (const [, StateClass] of Object.entries(stateClasses)) {
    fsm.add(new StateClass(enemy));
  }

  return fsm;
}

export default buildAIFSM;
