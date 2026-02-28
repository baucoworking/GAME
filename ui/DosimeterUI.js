import { Bus, EV } from "../core/EventBus.js";

export class DosimeterUI {
  constructor() {
    this.el = document.createElement("div");
    this.el.style.position = "fixed";
    this.el.style.right = "16px";
    this.el.style.bottom = "16px";
    this.el.style.padding = "8px 10px";
    this.el.style.background = "rgba(0,0,0,0.65)";
    this.el.style.border = "1px solid rgba(162,255,143,0.4)";
    this.el.style.color = "#9dff89";
    this.el.style.font = "12px monospace";
    document.body.appendChild(this.el);

    this._render(0, 0);
    Bus.on(EV.DOSIMETER_CHANGE, ({ normalised, msvh }) => this._render(normalised, msvh));
  }

  _render(normalised, msvh) {
    const bars = Math.round(normalised * 12);
    this.el.innerHTML = `DOSÍMETRO<br>[${"#".repeat(bars)}${"-".repeat(12 - bars)}] ${(normalised * 100).toFixed(0)}%<br>${msvh.toFixed(2)} mSv/h`;
  }
}
