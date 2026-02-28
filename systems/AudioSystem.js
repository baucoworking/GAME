/**
 * systems/AudioSystem.js
 * Gestiona el audio dinámico con Howler.js:
 * - Música base nocturna y transición al día.
 * - Capas de tensión interactivas (explore, alert, danger, contact).
 * - Sonidos 3D espaciales de monstruos.
 * - Ambiente de radiación (dosímetro).
 * - Reverberación y muffling para eventos como el Boss en las alcantarillas.
 */

import { Bus, EV } from "../core/EventBus.js";
import * as THREE from "three";

export class AudioSystem {
  constructor(playerRef) {
    this.player = playerRef;

    // Configuración global de Howler
    Howler.volume(0.8);

    // ── CAPAS DE MÚSICA (Stems dinámicos) ──
    this.musicLayers = {
      day_ambient: new Howl({
        src: ["assets/audio/day_wind.wav"],
        loop: true,
        volume: 0,
      }),
      explore: new Howl({
        src: ["assets/audio/music_explore.wav"],
        loop: true,
        volume: 0,
      }),
      alert: new Howl({
        src: ["assets/audio/music_alert.wav"],
        loop: true,
        volume: 0,
      }),
      danger: new Howl({
        src: ["assets/audio/music_danger.wav"],
        loop: true,
        volume: 0,
      }),
      contact: new Howl({
        src: ["assets/audio/music_contact.wav"],
        loop: true,
        volume: 0,
      }),
    };

    // ── AMBIENTE Y EFECTOS ──
    this.radiationSfx = new Howl({
      src: ["assets/audio/geiger_counter.wav"],
      loop: true,
      volume: 0,
    });

    this.sewerReverb = new Howl({
      loop: true,
      volume: 0,
    });

    // ── CATÁLOGO DE SFX 3D (Criaturas e Interacciones) ──
    // Se configuran como sprites o archivos individuales listos para posicionamiento 3D
    this.sfxLib = {
      rezagado_drag: new Howl({ src: ["assets/audio/rezagado_drag.wav"] }),
      vigilante_click: new Howl({ src: ["assets/audio/vigilante_click.wav"] }),
      colectivo_step: new Howl({ src: ["assets/audio/colectivo_step.wav"] }),
      viktor_limb_scrape: new Howl({ src: ["assets/audio/viktor_scrape.wav"] }),
      typewriter_burst: new Howl({ src: ["assets/audio/typewriter.wav"] }), // La Presencia
    };

    this.currentState = "explore";
    this.isNight = false;

    this._bindEvents();
    this._startPlayback();
  }

  _bindEvents() {
    Bus.on(EV.NIGHT_START, () => this.transitionToNight());
    Bus.on(EV.DAY_START, () => this.transitionToDay());
    Bus.on(EV.AUDIO_STATE, (d) => this.setMusicState(d.state));
    Bus.on(EV.DOSIMETER_CHANGE, (d) => this.updateRadiation(d.normalised));

    // Reproducción 3D (Emitida por EnemyManager)
    Bus.on("audio:play_3d", (d) => this.play3D(d.id, d.position, d.volume));

    // Sonidos fantasma por alta radiación (Emitido por TensionSystem)
    Bus.on("audio:phantom", (d) => this.playPhantom(d.sound, d.position));

    // Eventos especiales del Jefe Final
    Bus.on("boss:trigger_sewer", () => this.startSewerSequence());
  }
}
