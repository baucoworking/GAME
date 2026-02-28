import { Bus, EV } from "../core/EventBus.js";

export class DosimeterSystem {
  constructor(player) {
    this.player = player;
    this.current = 0;
    Bus.on(EV.DOSIMETER_CHANGE, ({ normalised }) => {
      this.current = normalised;
    });
  }

  update() {}
}
