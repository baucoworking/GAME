export class GameLoop {
  constructor(engine) {
    this.engine = engine;
    this._running = false;
    this._last = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this._running = false;
  }

  _frame(now) {
    if (!this._running) return;

    const delta = Math.max(0, Math.min((now - this._last) / 1000, 0.1));
    this._last = now;
    this.engine.update(delta);
    requestAnimationFrame(this._frame);
  }
}
