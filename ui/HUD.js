import { Bus, EV } from "../core/EventBus.js";

export class HUD {
  constructor() {
    this.el = document.createElement("div");
    this.el.style.position = "fixed";
    this.el.style.top = "10px";
    this.el.style.left = "50%";
    this.el.style.transform = "translateX(-50%)";
    this.el.style.color = "#cfe7ff";
    this.el.style.fontFamily = "monospace";
    this.el.style.fontSize = "13px";
    this.el.style.textAlign = "center";
    this.el.style.pointerEvents = "none";
    this.el.style.textShadow = "0 0 8px rgba(0,0,0,0.9)";
    document.body.appendChild(this.el);

    this.night = 1;
    this.objective = "Recolectá fusibles y encendé el generador";
    this._render();

    Bus.on(EV.NIGHT_START, ({ nightNumber }) => {
      this.night = nightNumber;
      this._render();
    });
    Bus.on(EV.PUZZLE_SOLVED, ({ puzzleId }) => {
      if (puzzleId === "P-01") this.objective = "Buscá la llave del almacén en la caja fuerte";
      if (puzzleId === "P-02") this.objective = "Entrá al almacén y encontrá la llave del director";
      if (puzzleId === "P-08") this.objective = "ESCAPE COMPLETADO";
      this._render();
    });
  }

  _render() {
    this.el.innerHTML = `Noche ${this.night} · Objetivo: ${this.objective}<br><small>WASD mover · Shift correr · C agacharse · E interactuar · F capturar mouse</small>`;
  }
}
