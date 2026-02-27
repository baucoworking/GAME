import { Bus, EV } from "../core/EventBus.js";

function length(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v) {
  const l = length(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class InteractionSystem {
  constructor(player, { maxDistance = 2.5, minFacingDot = 0.35 } = {}) {
    this.player = player;
    this.maxDistance = maxDistance;
    this.minFacingDot = minFacingDot;
    this.interactables = [];
    this.currentTarget = null;

    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "e") this.tryInteract();
    });
  }

  register(interactable) {
    this.interactables.push(interactable);
  }

  update() {
    const forward = normalize(this.player.forward);
    const from = this.player.position;

    let best = null;
    let bestScore = Infinity;

    for (const obj of this.interactables) {
      if (obj.disabled) continue;
      if (!obj.position) continue;

      const d = distance(from, obj.position);
      if (d > (obj.maxDistance ?? this.maxDistance)) continue;

      const to = normalize({
        x: obj.position.x - from.x,
        y: obj.position.y - from.y,
        z: obj.position.z - from.z,
      });

      if (dot(forward, to) < this.minFacingDot) continue;

      if (typeof obj.canInteract === "function" && !obj.canInteract(this.player)) {
        continue;
      }

      if (d < bestScore) {
        best = obj;
        bestScore = d;
      }
    }

    this.currentTarget = best;

    if (best) {
      const text =
        typeof best.getPrompt === "function"
          ? best.getPrompt(this.player)
          : `Pulsa E para interactuar: ${best.label ?? best.id}`;
      Bus.emit(EV.UI_HINT, { text, duration: 0.15 });
    }
  }

  tryInteract() {
    if (!this.currentTarget) return;

    Bus.emit(EV.PLAYER_INTERACT, { target: this.currentTarget.id });
    this.currentTarget.onInteract?.(this.player);
  }
}
