import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { atmosphereUniforms, SkyLUT, sunDirection, sunTransmittance } from './sky/atmosphere';
import { createSkyDome } from './sky/SkyDome';
import { buildCliff } from './terrain/cliff';
import { buildCypress, buildShrub, createVegetationMaterial, ledgePlants, scatterVegetation } from './terrain/vegetation';
import { buildBoulders, buildHeadlands, buildTerrain, createBoulderMaterial, createTerrainMaterial } from './terrain/terrain';
import { createOcean } from './ocean/ocean';
import { buildBowl, PROFILE } from './stadium/bowl';
import { bakeSpectatorAtlas } from './crowd/spectator';
import { CROWD_DRAWN, createCrowd } from './crowd/crowd';
import { crowdEnergy } from './crowd/reactions';
import { createPrecipitation } from './weather/precip';
import { createConcreteMaterial, createGlassMaterial, createLightBankMaterial, createRoofMaterial, createSeatingMaterial, stadiumUniforms } from './stadium/materials';
import { createFieldMaterial, createFieldPaint } from './field/field';
import { buildPlazaGeometry, plazaLampPositions, createLightHeadMaterial, createMetalMaterial, createPavingMaterial, createScreenMaterial, createVideoBoardTexture } from './stadium/props';
import { LIGHTING_PRESETS, type LightingPreset } from './lighting/presets';
import { createShadowRig, type ShadowRig } from './lighting/shadows';
import { STAND } from './world/constants';

export interface WorldQuality {
  shadowMapSize: number; // 0 = shadows off
  terrainSegments: number;
  /** Graphics settings that scale instance counts without rebuilding. */
  crowdDensity: 'low' | 'medium' | 'high' | 'ultra';
  vegetationDensity: number; // 0..1 share of scattered plants drawn
  weatherParticles: boolean;
}

/**
 * The persistent Blackcliff scene: sky, sea, cliffs, stadium, field. Built
 * once and kept alive across every app state (TECH_PLAN §4.2).
 */
export function World({ preset, quality, onReady }: { preset: LightingPreset; quality: WorldQuality; onReady?: () => void }) {
  const { gl, scene, camera } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null!);
  // The key light as the preset defines it; with cascaded shadows on, the
  // cascade lights carry it and the plain directional light is dark.
  const keyRef = useRef({ color: new THREE.Color(), intensity: 0, dir: new THREE.Vector3(0, 1, 0) });
  const rigRef = useRef<ShadowRig | null>(null);

  const assets = useMemo(() => {
    const terrain = buildTerrain(quality.terrainSegments);
    const ocean = createOcean(terrain.heightTexture, terrain.heightTextureExtent);
    const sky = createSkyDome(true);
    const bowl = buildBowl();
    const paint = createFieldPaint();
    const boardTex = createVideoBoardTexture();
    return {
      terrain,
      terrainMat: createTerrainMaterial(false),
      cliff: buildCliff(),
      headlands: buildHeadlands(),
      headlandMat: createTerrainMaterial(true),
      ocean,
      sky,
      bowl,
      seatingMat: createSeatingMaterial(),
      concreteMat: createConcreteMaterial(),
      glassMat: createGlassMaterial(),
      roofMat: createRoofMaterial(),
      lightBankMat: createLightBankMaterial(),
      fieldMat: createFieldMaterial(paint),
      pavingMat: createPavingMaterial(),
      metalMat: createMetalMaterial(),
      darkMetalMat: createMetalMaterial(0x121214),
      lightHeadMat: createLightHeadMaterial(),
      screenMat: createScreenMaterial(boardTex),
    };
    // Built once; quality changes that need a rebuild remount the World.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The crowd atlas is rendered with the renderer, once.
  const crowd = useMemo(() => {
    const atlas = bakeSpectatorAtlas(gl);
    return { atlas, mesh: createCrowd(atlas) };
  }, [gl]);
  useEffect(() => () => crowd.atlas.dispose(), [crowd]);

  const precip = useMemo(() => createPrecipitation(), []);
  useEffect(() => {
    const g = crowd.mesh.geometry as THREE.InstancedBufferGeometry;
    const total = (g.attributes.aSeat as THREE.InstancedBufferAttribute).count;
    g.instanceCount = Math.round(total * CROWD_DRAWN[quality.crowdDensity]);
  }, [crowd, quality.crowdDensity]);
  const plaza = useMemo(() => buildPlazaGeometry(), []);
  // Plaza lamp posts: 6 m poles with a luminaire head (pools painted by the paving shader).
  const lamps = useMemo(() => {
    const at = plazaLampPositions();
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 6, 8).translate(0, 3, 0), assets.darkMetalMat, at.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.18, 0.7).translate(0, 6.05, 0), assets.lightHeadMat, at.length);
    at.forEach((p, i) => {
      const m = new THREE.Matrix4().makeTranslation(p.x, 0, p.y);
      pole.setMatrixAt(i, m);
      head.setMatrixAt(i, m);
    });
    pole.castShadow = true;
    const g = new THREE.Group();
    g.add(pole, head);
    return g;
  }, [assets.darkMetalMat, assets.lightHeadMat]);

  // Sky LUT + IBL, regenerated whenever the lighting preset changes.
  const lut = useMemo(() => new SkyLUT(512, 256), []);
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl]);
  // The IBL source scene owns its own dome (a mesh can only have one parent).
  const env = useMemo(() => {
    const s = new THREE.Scene();
    const dome = createSkyDome(true);
    s.add(dome.mesh);
    return { scene: s, dome };
  }, []);
  const envScene = env.scene;

  useEffect(() => {
    lut.render(gl, preset);
    const dir = sunDirection(preset);
    const trans = sunTransmittance(preset);
    const sunColor = trans.clone().multiplyScalar(preset.sunIlluminance);
    atmosphereUniforms.uSkyLUT.value = lut.target.texture;
    atmosphereUniforms.uSunDir.value.copy(dir);
    atmosphereUniforms.uSunColor.value.copy(sunColor);
    atmosphereUniforms.uFogDensity.value = preset.fogDensity;
    atmosphereUniforms.uFogFalloff.value = preset.fogHeightFalloff;
    atmosphereUniforms.uFogBrightness.value = preset.fogBrightness;
    for (const m of [assets.sky.material, env.dome.material]) {
      m.uniforms.uCloudCover!.value = preset.cloudCover;
      m.uniforms.uCloudStreak!.value = preset.cloudStreak;
      m.uniforms.uSunDiscColor!.value.copy(trans).multiplyScalar(preset.sunIlluminance * 45);
      m.uniforms.uNight!.value = preset.moon ? 1 : 0;
    }
    atmosphereUniforms.uStadiumGlow.value = preset.stadiumGlow ?? 0;
    atmosphereUniforms.uWet.value = preset.wetness ?? 0;
    atmosphereUniforms.uSnow.value = preset.snowCover ?? 0;
    // Particles are lit like a white diffuse surface under the (clouded) key
    // light: radiance ≈ irradiance / π.
    const p = preset.precipitation;
    precip.set(p && quality.weatherParticles ? p : null, trans.clone().multiplyScalar(preset.sunIlluminance / Math.PI));
    stadiumUniforms.uLights.value = preset.stadiumLights;
    assets.ocean.material.uniforms.uStadiumLights!.value = preset.stadiumLights;

    const sun = sunRef.current;
    sun.color.copy(trans).multiplyScalar(1 / Math.max(trans.r, trans.g, trans.b, 1e-4));
    if (preset.keyTint) {
      const [tr, tg, tb] = preset.keyTint;
      sun.color.multiply(new THREE.Color(tr, tg, tb));
      sunColor.multiply(new THREE.Color(tr, tg, tb));
      atmosphereUniforms.uSunColor.value.copy(sunColor);
    }
    sun.intensity = preset.sunIlluminance * Math.max(trans.r, trans.g, trans.b) * (dir.y > 0 ? 1 : 0);
    sun.position.copy(dir).multiplyScalar(600);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    keyRef.current = { color: sun.color.clone(), intensity: sun.intensity, dir: dir.clone() };

    // IBL from the same sky (clouds included) so ambient light matches it.
    const rt = pmrem.fromScene(envScene, 0, 1, 2000);
    const prev = scene.environment;
    scene.environment = rt.texture;
    scene.environmentIntensity = import.meta.env.DEV && new URLSearchParams(location.search).has("envI") ? Number(new URLSearchParams(location.search).get("envI")) : preset.envIntensity;
    if (prev && prev !== rt.texture) prev.dispose();
    if (import.meta.env.DEV) Object.assign(window, { __btbCrowd: crowdEnergy, __btbScene: scene, __btbEnvScene: envScene, __btbGl: gl, __btbPmrem: pmrem });
  }, [preset, gl, lut, pmrem, envScene, env, assets, scene, precip, quality.weatherParticles]);

  // Shadows follow quality: cascaded shadow maps (lighting/shadows.ts), sized
  // per tier; the plain key light never casts.
  useEffect(() => {
    sunRef.current.castShadow = false;
    if (quality.shadowMapSize <= 0 || (import.meta.env.DEV && location.search.includes('noshadow'))) return;
    const rig = createShadowRig({
      camera: camera as THREE.PerspectiveCamera,
      parent: scene,
      // Per cascade: high 4 × 2048², medium 3 × 2048², low 3 × 1024².
      mapSize: quality.shadowMapSize >= 2048 ? 2048 : 1024,
      cascades: quality.shadowMapSize >= 4096 ? 4 : 3,
    });
    rig.attachTree(scene);
    rigRef.current = rig;
    return () => {
      rigRef.current = null;
      rig.dispose();
    };
  }, [quality.shadowMapSize, camera, scene]);

  useEffect(() => {
    // Let the first frames compile shaders before announcing readiness.
    let raf = 0;
    let frames = 0;
    const tick = () => {
      if (++frames > 3) onReady?.();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onReady]);

  const frameRef = useRef(0);
  useFrame(({ camera, clock }) => {
    atmosphereUniforms.uTime.value = clock.elapsedTime;
    const key = keyRef.current;
    const rig = rigRef.current;
    if (rig) {
      sunRef.current.intensity = 0;
      rig.setKey(key.color, key.intensity, key.dir);
      // Objects mounted later (players, props) pick up the cascades too.
      if (frameRef.current++ % 120 === 0) rig.attachTree(scene);
      rig.update();
    } else {
      sunRef.current.intensity = key.intensity;
    }
    stadiumUniforms.uCrowdEnergy.value = crowdEnergy.value(clock.elapsedTime);
    assets.sky.mesh.position.copy(camera.position);
  });

  const { bowl } = assets;
  const lightBankGeo = useMemo(() => new THREE.BoxGeometry(5.5, 1.6, 0.5), []);
  const lightBanks = useMemo(() => {
    const mesh = new THREE.InstancedMesh(lightBankGeo, assets.lightBankMat, bowl.lightBanks.length);
    bowl.lightBanks.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [bowl, lightBankGeo, assets.lightBankMat]);

  const vegetation = useMemo(() => {
    const mat = createVegetationMaterial();
    const scatter = scatterVegetation();
    const ledges = ledgePlants(assets.cliff.geometry);
    const group = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mats: THREE.Matrix4[], tints: THREE.Color[]) => {
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, tints[i]!);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.userData.fullCount = mats.length;
      group.add(mesh);
    };
    // Three shrub and two cypress variants, instances dealt round-robin.
    const deal = <T,>(list: T[], k: number, i: number) => list.filter((_, j) => j % k === i);
    for (let v = 0; v < 3; v++) {
      add(buildShrub(11 + v), deal(scatter.shrubs, 3, v), deal(scatter.tints[0]!, 3, v));
      add(buildShrub(21 + v), deal(ledges.matrices, 3, v), deal(ledges.tints, 3, v));
    }
    for (let v = 0; v < 2; v++) add(buildCypress(31 + v), deal(scatter.cypress, 2, v), deal(scatter.tints[1]!, 2, v));
    return group;
  }, [assets.cliff]);
  // Scatter order is random, so drawing a prefix thins plants evenly.
  useEffect(() => {
    for (const m of vegetation.children as THREE.InstancedMesh[]) m.count = Math.round((m.userData.fullCount as number) * quality.vegetationDensity);
  }, [vegetation, quality.vegetationDensity]);

  const boulders = useMemo(() => {
    const b = buildBoulders(quality.terrainSegments >= 320 ? 700 : 350);
    const mesh = new THREE.InstancedMesh(b.geometry, createBoulderMaterial(), b.matrices.length);
    b.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Floodlights: roof-corner and mast banks aimed at the field. They carry the
  // light at night and add to it in rain and snow; off at golden hour and
  // overcast. (Milestone 3 replaces these with full light-tower banks.)
  const flood = useMemo(() => {
    const aims: [number, number, number][] = [
      [-60, 46, -95], [60, 46, -95], [-62, 46, 20], [62, 46, 20], [-55, 61, 66], [55, 61, 66],
    ];
    return aims.map((p) => {
      const l = new THREE.SpotLight(0xfff1dc, 0, 320, 0.62, 0.55, 2);
      l.position.set(...p);
      l.target.position.set(p[0] * 0.15, 0, p[2] * 0.2);
      l.castShadow = false;
      return l;
    });
  }, []);
  useEffect(() => {
    const factor = preset.stadiumLights * (preset.moon ? 1 : preset.id === 'rain' || preset.id === 'snow' ? 0.35 : 0);
    for (const l of flood) {
      // Divided by the preset exposure so the field reads the same under the
      // brighter night exposure that lets the moonlit sky and sea show.
      l.intensity = (17000 * factor) / preset.exposure;
      l.target.updateMatrixWorld();
    }
  }, [preset, flood]);

  const boardZ = STAND.northZ + 6;
  const roofFrontH = PROFILE.roof.hFront;

  return (
    <>
      <directionalLight ref={sunRef} castShadow>
        <object3D attach="target" />
      </directionalLight>

      <primitive object={assets.sky.mesh} />
      <mesh geometry={assets.terrain.geometry} material={assets.terrainMat} receiveShadow castShadow />
      <mesh geometry={assets.cliff.geometry} material={assets.terrainMat} receiveShadow castShadow />
      <mesh geometry={assets.headlands} material={assets.headlandMat} />
      <primitive object={assets.ocean.mesh} />
      <primitive object={boulders} />
      <primitive object={vegetation} />

      {/* Stadium bowl */}
      <mesh geometry={bowl.seating} material={assets.seatingMat} receiveShadow castShadow />
      <primitive object={crowd.mesh} />
      <primitive object={precip.mesh} />
      <mesh geometry={bowl.concrete} material={assets.concreteMat} receiveShadow castShadow />
      <mesh geometry={bowl.glass} material={assets.glassMat} />
      <mesh geometry={bowl.roof} material={assets.roofMat} receiveShadow castShadow />
      <primitive object={lightBanks} />
      {flood.map((l, i) => (
        <group key={i}>
          <primitive object={l} />
          <primitive object={l.target} />
        </group>
      ))}

      {/* Playing surface and apron */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, -2]} material={assets.fieldMat} receiveShadow>
        <planeGeometry args={[STAND.halfWidth * 2, 138, 1, 1]} />
      </mesh>

      {/* Plaza ring around the stadium and the open-end terrace */}
      <mesh geometry={plaza} position={[0, 0.02, 0]} material={assets.pavingMat} receiveShadow />
      <primitive object={lamps} />
      <mesh position={[0, 0.6, 71]} material={assets.concreteMat} receiveShadow castShadow>
        <boxGeometry args={[100, 1.2, 0.4]} />
      </mesh>
      <mesh position={[0, 1.7, 71]} material={assets.glassMat}>
        <boxGeometry args={[100, 1.0, 0.06]} />
      </mesh>

      {/* Video board on the north roof lip */}
      <group position={[0, roofFrontH - 1, boardZ - 2]}>
        <mesh position={[0, 7.5, 0]} material={assets.darkMetalMat} castShadow>
          <boxGeometry args={[34, 14, 2.2]} />
        </mesh>
        <mesh position={[0, 7.5, 1.11]} material={assets.screenMat}>
          <planeGeometry args={[32.5, 12.6]} />
        </mesh>
      </group>

      {/* Light masts flanking the open end */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 55, 0, 66]}>
          <mesh position={[0, 30, 0]} material={assets.metalMat} castShadow>
            <cylinderGeometry args={[0.7, 1.3, 60, 12]} />
          </mesh>
          <mesh position={[0, 61, 0]} rotation-x={0.5} rotation-y={s * -0.6} material={assets.darkMetalMat} castShadow>
            <boxGeometry args={[12, 7, 1.2]} />
          </mesh>
          <mesh position={[0, 61, 0]} rotation-x={0.5} rotation-y={s * -0.6 + Math.PI} material={assets.lightHeadMat}>
            <planeGeometry args={[11, 6]} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export const DEFAULT_PRESET = LIGHTING_PRESETS.golden;
