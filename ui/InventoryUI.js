import { Bus, EV } from "../core/EventBus.js";

export class InventoryUI {
  constructor(player) {
    this.player = player;
    this.container = document.createElement("div");
    this.container.id = "inventory-ui";
    this.container.style.position = "fixed";
    this.container.style.left = "16px";
    this.container.style.bottom = "16px";
    this.container.style.padding = "10px 12px";
    this.container.style.background = "rgba(0,0,0,0.6)";
    this.container.style.color = "#d8e1e8";
    this.container.style.fontFamily = "monospace";
    this.container.style.fontSize = "12px";
    this.container.style.maxWidth = "300px";
    this.container.style.border = "1px solid rgba(120,150,170,0.35)";

    document.body.appendChild(this.container);

    Bus.on(EV.ITEM_PICKUP, () => this.render());
    Bus.on(EV.ITEM_USED, () => this.render());

    this.render();
  }

  render() {
    const items = this.player.inventory.getAll();
    const list = items.map((i) => `• ${i.name} (${i.id})`).join("<br>");
    this.container.innerHTML = `<strong>Inventario</strong><br>${list || "(vacío)"}`;
  }
}
