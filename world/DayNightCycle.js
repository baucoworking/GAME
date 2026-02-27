import * as THREE from "three";

export class AtmosphereSystem {
  constructor(scene) {
    this.scene = scene;

    // Niebla radiactiva base (Verde sucio/grisáceo)
    this.nightFogColor = new THREE.Color(0x0a100d);
    this.dawnFogColor = new THREE.Color(0x4a3b32); // Amanecer rojizo/naranja oxidado

    this.scene.fog = new THREE.FogExp2(this.nightFogColor, 0.04);

    // Luces globales
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Oscuridad casi total
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffaa55, 0.0); // Amanecer
    this.sunLight.position.set(100, 50, 100);
    this.sunLight.castShadow = true;
    // Optimización de sombras
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.scene.add(this.sunLight);
  }

  // 'timeProgress' es un valor de 0.0 (Noche profunda) a 1.0 (Amanecer total)
  updateDawnTransition(timeProgress) {
    // Interpolación de colores y luces
    const currentFogColor = this.nightFogColor
      .clone()
      .lerp(this.dawnFogColor, timeProgress);
    this.scene.fog.color.copy(currentFogColor);

    // En el amanecer, la niebla se asienta un poco, alteramos la densidad
    this.scene.fog.density = THREE.MathUtils.lerp(0.04, 0.02, timeProgress);

    // La luz ambiental sube lentamente
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.05, 0.3, timeProgress);

    // El sol aparece y penetra el techo de cristal
    this.sunLight.intensity = THREE.MathUtils.lerp(0.0, 1.5, timeProgress);

    // Cambiamos el color de fondo para el techo de cristal (Atrio)
    this.scene.background = currentFogColor;
  }
}
