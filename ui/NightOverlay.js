import { Bus, EV } from "../core/EventBus.js";

export class NightOverlay {
  constructor() {
    this.el = document.createElement("div");
    this.el.style.position = "fixed";
    this.el.style.inset = "0";
    this.el.style.display = "grid";
    this.el.style.placeItems = "center";
    this.el.style.background = "rgba(0,0,0,0.7)";
    this.el.style.color = "#d7e8ff";
    this.el.style.font = "700 42px/1 monospace";
    this.el.style.letterSpacing = "3px";
    this.el.style.opacity = "0";
    this.el.style.pointerEvents = "none";
    this.el.style.transition = "opacity 400ms";
    document.body.appendChild(this.el);

    Bus.on(EV.NIGHT_START, ({ nightNumber }) => this.show(`NOCHE ${nightNumber}`));
    Bus.on(EV.GAME_OVER, () => this.show("TE ATRAPARON"));
    Bus.on(EV.GAME_WIN, () => this.show("ESCAPASTE"));
  }

  show(text) {
    this.el.textContent = text;
    this.el.style.opacity = "1";
    setTimeout(() => {
      this.el.style.opacity = "0";
    }, 1700);
  }
}
