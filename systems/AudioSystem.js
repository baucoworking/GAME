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
        src: ["assets/audio/day_wind.ogg"],
        loop: true,
        volume: 0,
      }),
      explore: new Howl({
        src: ["assets/audio/music_explore.ogg"],
        loop: true,
        volume: 0,
      }),
      alert: new Howl({
        src: ["assets/audio/music_alert.ogg"],
        loop: true,
        volume: 0,
      }),
      danger: new Howl({
        src: ["assets/audio/music_danger.ogg"],
        loop: true,
        volume: 0,
      }),
      contact: new Howl({
        src: ["assets/audio/music_contact.ogg"],
        loop: true,
        volume: 0,
      }),
    };

    // ── AMBIENTE Y EFECTOS ──
    this.radiationSfx = new Howl({
      src: ["assets/audio/geiger_counter.ogg"],
      loop: true,
      volume: 0,
    });

    this.sewerReverb = new Howl({
      src: ["assets/audio/sewer_drone.ogg"],
      loop: true,
      volume: 0,
    });

    // ── CATÁLOGO DE SFX 3D (Criaturas e Interacciones) ──
    // Se configuran como sprites o archivos individuales listos para posicionamiento 3D
    this.sfxLib = {
      rezagado_drag: new Howl({ src: ["assets/audio/rezagado_drag.ogg"] }),
      vigilante_click: new Howl({ src: ["assets/audio/vigilante_click.ogg"] }),
      colectivo_step: new Howl({ src: ["assets/audio/colectivo_step.ogg"] }),
      viktor_limb_scrape: new Howl({ src: ["assets/audio/viktor_scrape.ogg"] }),
      typewriter_burst: new Howl({ src: ["assets/audio/typewriter.ogg"] }), // La Presencia
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

  _startPlayback() {
    // Iniciar todas las capas de música silenciadas
    Object.values(this.musicLayers).forEach((howl) => howl.play());
    this.radiationSfx.play();
  }

  // ── ACTUALIZACIÓN DEL LISTENER ESPACIAL (Llamar en el GameLoop) ──
  update(dt) {
    if (!this.player) return;

    const pos = this.player.position;
    const fwd = this.player.forward; // Asumiendo que guardas el vector forward del jugador

    // Actualizar la posición de los "oídos" del jugador en Howler
    Howler.pos(pos.x, pos.y, pos.z);

    // Actualizar hacia dónde mira el jugador para el audio direccional (paneo)
    Howler.orientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
  }

  // ── MÚSICA Y TRANSICIONES (Tensión y Día/Noche) ──

  transitionToNight() {
    this.isNight = true;
    this.musicLayers.day_ambient.fade(
      this.musicLayers.day_ambient.volume(),
      0,
      4000,
    );
    this.setMusicState("explore"); // Comienza el terror basal
  }

  transitionToDay() {
    this.isNight = false;
    // Apagar todas las capas de tensión
    Object.values(this.musicLayers).forEach((howl) => {
      if (howl !== this.musicLayers.day_ambient) {
        howl.fade(howl.volume(), 0, 6000);
      }
    });
    this.musicLayers.day_ambient.fade(0, 0.4, 6000); // Entra el viento del amanecer
  }

  setMusicState(newState) {
    if (!this.isNight) return;
    if (newState === this.currentState) return;

    const fadeDuration = newState === "contact" ? 500 : 3000; // Si lo atrapan, sube de golpe

    // Bajar la capa anterior
    if (this.musicLayers[this.currentState]) {
      this.musicLayers[this.currentState].fade(
        this.musicLayers[this.currentState].volume(),
        0,
        fadeDuration,
      );
    }

    // Subir la nueva capa (Crossfade vertical)
    if (this.musicLayers[newState]) {
      this.musicLayers[newState].fade(0, 0.8, fadeDuration);
    }

    this.currentState = newState;
  }

  // ── SISTEMA DOSÍMETRO ──

  updateRadiation(normalisedDosimeter) {
    // Escalar el sonido del contador Geiger según el nivel de tensión/radiación [0..1]
    const targetVol = THREE.MathUtils.clamp(normalisedDosimeter * 0.7, 0, 0.7);
    this.radiationSfx.volume(targetVol);

    // Si la radiación es muy alta, aplicar un filtro paso bajo a la música (efecto de ensordecimiento)
    if (normalisedDosimeter > 0.8) {
      // (Si usas un plugin de espacialización/filtros avanzado de Howler, aquí se modularía)
      Howler.volume(
        THREE.MathUtils.lerp(0.8, 0.4, (normalisedDosimeter - 0.8) * 5),
      );
    } else {
      Howler.volume(0.8);
    }
  }

  // ── SONIDO 3D ESPACIAL (Monstruos) ──

  play3D(soundId, position, baseVolume = 1.0) {
    const sfx = this.sfxLib[soundId];
    if (!sfx) {
      console.warn(`[AudioSystem] Sonido no encontrado: ${soundId}`);
      return;
    }

    const id = sfx.play();

    // Configuración 3D de atenuación (Rolloff logarítmico)
    sfx.pos(position.x, position.y, position.z, id);
    sfx.volume(baseVolume, id);
    sfx.pannerAttr(
      {
        panningModel: "HRTF",
        distanceModel: "exponential",
        refDistance: 2.0, // Distancia a la que el volumen está al 100%
        maxDistance: 35.0, // Distancia máxima de escucha
        rolloffFactor: 1.5,
      },
      id,
    );
  }

  // ── ALUCINACIONES (Tensión alta) ──

  playPhantom(soundId, position) {
    // Reproduce un sonido fantasma modificando su pitch para dar sensación irreal
    const sfx = this.sfxLib[soundId];
    if (!sfx) return;

    const id = sfx.play();
    sfx.pos(position.x, position.y, position.z, id);
    sfx.volume(0.5, id);
    sfx.rate(0.85 + Math.random() * 0.3, id); // Pitch warping para efecto terror psicológico
  }

  // ── EVENTOS DEL BOSS (Viktor) ──

  startSewerSequence() {
    // Cuando baja al nivel 2 de la alcantarilla (Fase 2 del Lore)
    this.sewerReverb.play();
    this.sewerReverb.fade(0, 0.6, 5000);

    // La música normal se suprime para que sólo se escuche el drone y los "scrapes" de Viktor
    Object.values(this.musicLayers).forEach((howl) => {
      howl.fade(howl.volume(), 0, 4000);
    });
  }
}
