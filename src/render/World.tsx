import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { atmosphereUniforms, SkyLUT, sunDirection, sunTransmittance } from './sky/atmosphere';
import { createSkyDome } from './sky/SkyDome';
import { buildCliff } from './terrain/cliff';
import { buildCypress, buildShrub, buildShrubLod, createVegetationMaterial, ledgePlants, scatterVegetation } from './terrain/vegetation';
import { buildChunkedScatter } from './terrain/scatterChunks';
import { buildBoulders, buildHeadlands, buildTerrain, createBoulderMaterial, createTerrainMaterial } from './terrain/terrain';
import { createOcean } from './ocean/ocean';
import { buildBowl, PROFILE } from './stadium/bowl';
import { bakeSpectatorAtlas } from './crowd/spectator';
import { CROWD_DRAWN, CROWD_HIGH_CAMERA, createCrowd } from './crowd/crowd';
import { crowdEnergy } from './crowd/reactions';
import { createPrecipitation, PRECIP_COUNT } from './weather/precip';
import { createParticlePool } from './vfx/particles';
import type { EffectId } from './vfx/effects';
import { urlFlags } from '@/app/platform';
import { createConcreteMaterial, createGlassMaterial, createLightBankMaterial, createRoofMaterial, createSeatingMaterial, stadiumUniforms } from './stadium/materials';
import { createFieldMaterial, createFieldPaint } from './field/field';
import { createGrassShells, GRASS_SHELLS } from './field/grass';
import { buildPlazaGeometry, plazaLampPositions, createLightHeadMaterial, createMetalMaterial, createPavingMaterial, createScreenMaterial, createVideoBoardTexture } from './stadium/props';
import { LIGHTING_PRESETS, type LightingPreset } from './lighting/presets';
import { createShadowRig, shadowAttach, type ShadowRig } from './lighting/shadows';
import { STAND } from './world/constants';

export interface WorldQuality {
  /** Shadow tier (graphics.shadows): cascades, map size, distance. */
  shadows: 'off' | 'low' | 'medium' | 'high';
  /** Overall tier: the floodlight count at night. */
  tier: 'low' | 'medium' | 'high' | 'ultra';
  grassDetail: 'low' | 'medium' | 'high' | 'ultra';
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
    ocean.mesh.name = 'ocean';
    sky.mesh.name = 'sky';
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
      paint,
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
  const vfx = useMemo(() => createParticlePool(), []);
  // Spectators drawn: the density setting's share of the (shuffled) seats.
  // On Low and Medium, a high camera (broadcast, All-22) draws 75% of that:
  // from there a spectator is a few pixels and a thinner crowd reads the
  // same, and the crowd is a big share of that view's cost (M5 perf).
  const crowdBase = useRef(0);
  useEffect(() => {
    const g = crowd.mesh.geometry as THREE.InstancedBufferGeometry;
    const total = (g.attributes.aSeat as THREE.InstancedBufferAttribute).count;
    crowdBase.current = Math.round(total * CROWD_DRAWN[quality.crowdDensity]);
    g.instanceCount = crowdBase.current;
  }, [crowd, quality.crowdDensity]);
  const thinHigh = quality.tier === 'low' || quality.tier === 'medium';
  useFrame(({ camera }) => {
    const g = crowd.mesh.geometry as THREE.InstancedBufferGeometry;
    const high = thinHigh && camera.position.y > 10;
    g.instanceCount = Math.round(crowdBase.current * (high ? CROWD_HIGH_CAMERA : 1));
  });
  const plaza = useMemo(() => buildPlazaGeometry(), []);
  const grass = useMemo(() => createGrassShells(assets.paint), [assets.paint]);
  useEffect(() => {
    grass.setShells(GRASS_SHELLS[quality.grassDetail]);
  }, [grass, quality.grassDetail]);
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
    // Particle budget per tier (each is a camera-facing, blended quad).
    (precip.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.round(PRECIP_COUNT * { low: 0.3, medium: 0.5, high: 1, ultra: 1 }[quality.tier]);
    // Particles: sky ambient from straight up, sun as the key.
    vfx.setLight(new THREE.Color(0.25, 0.28, 0.33).multiplyScalar(preset.envIntensity), sunColor.clone().multiplyScalar(0.25));
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
    if (import.meta.env.DEV) Object.assign(window, { __btbVfx: vfx, __btbCrowd: crowdEnergy, __btbScene: scene, __btbEnvScene: envScene, __btbGl: gl, __btbPmrem: pmrem });
  }, [preset, gl, lut, pmrem, envScene, env, assets, scene, precip, vfx, quality.weatherParticles, quality.tier]);
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __btbCamera: camera });
  }, [camera]);

  // Shadows follow quality: cascaded shadow maps (lighting/shadows.ts), sized
  // per tier. With the rig on, its cascade lights carry the key light and the
  // plain directional light leaves the scene (a zero-intensity light still
  // costs every lit pixel a trip through the light loop).
  useEffect(() => {
    const sun = sunRef.current;
    sun.castShadow = false;
    sun.visible = true;
    if (quality.shadows === 'off' || (import.meta.env.DEV && location.search.includes('noshadow'))) return;
    // Per tier (shadow cost on the GPU is casters × cascades × map area):
    // high 4 × 2048² to 700 m with cascade fades; medium 2 × 2048² to 350 m;
    // low 2 × 1024² to 250 m. Beyond that, aerial perspective carries depth.
    const cfg = { low: { mapSize: 1024, cascades: 2, maxFar: 250, fade: false }, medium: { mapSize: 2048, cascades: 2, maxFar: 350, fade: false }, high: { mapSize: 2048, cascades: 4, maxFar: 700, fade: true } }[quality.shadows];
    const rig = createShadowRig({ camera: camera as THREE.PerspectiveCamera, parent: scene, ...cfg });
    rig.attachTree(scene);
    rigRef.current = rig;
    shadowAttach.rig = rig;
    sun.visible = false;
    return () => {
      rigRef.current = null;
      if (shadowAttach.rig === rig) shadowAttach.rig = null;
      sun.visible = true;
      rig.dispose();
    };
  }, [quality.shadows, camera, scene]);

  useEffect(() => {
    // Compile every program before announcing readiness, including objects
    // that start hidden (grass shells, precipitation, particles, the crowd's
    // shadow material): a program compiled the first time a view shows it
    // stalls the GPU for up to seconds on some drivers. Then let a few
    // frames settle.
    let raf = 0;
    let frames = 0;
    let cancelled = false;
    const tick = () => {
      if (++frames > 3) onReady?.();
      else raf = requestAnimationFrame(tick);
    };
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible && (o as THREE.Mesh).isMesh) {
        hidden.push(o);
        o.visible = true;
      }
    });
    gl.compileAsync(scene, camera)
      .catch(() => undefined)
      .finally(() => {
        for (const o of hidden) o.visible = false;
        if (!cancelled) raf = requestAnimationFrame(tick);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReady]);

  const frameRef = useRef(0);
  // Shader time. In the screenshot harness it advances a fixed 1/60 s per
  // rendered frame instead of wall time: the software renderer takes
  // seconds per frame, and wall time would make every capture differ (and
  // let short effects live and die between two frames).
  const simTime = useRef(0);
  // Dev preview (?vfx=<id>): loop the effect around midfield every 3 s.
  const vfxLoop = useRef(-1e9);
  const previewVfx = (t: number) => {
    const id = urlFlags.vfx as EffectId | null;
    // Pyro fountains burn continuously; the rest repeat.
    if (!id || t - vfxLoop.current < (id === 'pyro' ? 0.15 : id === 'confetti' ? 3 : 1)) return;
    vfxLoop.current = t;
    const at: [number, number, number][] = id === 'confetti' ? [[-15, 26, -20], [15, 26, -20], [0, 28, 10]] : id === 'pyro' ? [[-20, 0, 55], [20, 0, 55]] : [[0, id === 'breath' ? 1.75 : 0.02, 0], [2, id === 'breath' ? 1.8 : 0.02, 1]];
    at.forEach((pos) => vfx.emit(id, pos, { dir: [0, 0, 1], scale: id === 'pyro' ? 0.15 : 1, age: urlFlags.vfxAge }));
  };
  useFrame(({ camera, clock, gl: r }) => {
    simTime.current = urlFlags.shot !== null ? simTime.current + 1 / 60 : clock.elapsedTime;
    const now = simTime.current;
    atmosphereUniforms.uTime.value = now;
    vfx.setViewportHeight(r.domElement.height);
    const key = keyRef.current;
    const rig = rigRef.current;
    if (rig) {
      sunRef.current.intensity = 0;
      rig.setKey(key.color, key.intensity, key.dir);
      // Objects mounted later (players, props) pick up the cascades too.
      if (frameRef.current++ % 120 === 0 || shadowAttach.requested) {
        rig.attachTree(scene);
        shadowAttach.requested = false;
      }
      rig.update();
    } else {
      sunRef.current.intensity = key.intensity;
    }
    stadiumUniforms.uCrowdEnergy.value = crowdEnergy.value(now);
    grass.update(camera);
    if (import.meta.env.DEV) previewVfx(now);
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
    const scatter = scatterVegetation();
    const ledges = ledgePlants(assets.cliff.geometry);
    // Spatial chunks (terrain/scatterChunks.ts) so the camera and each shadow
    // cascade draw only the plants they can see; scrub drops to a lighter
    // LOD for chunks more than 50 m away. Only the cypress cast shadows:
    // scrub shadows are a few pixels at broadcast distances, and the scrub
    // still receives them.
    const chunked = buildChunkedScatter(
      createVegetationMaterial(),
      [
        {
          name: 'scrub',
          variants: [0, 1, 2].map((v) => buildShrub(11 + v)),
          far: buildShrubLod(17),
          lodDistance: 50,
          matrices: [...scatter.shrubs, ...ledges.matrices],
          tints: [...scatter.tints[0]!, ...ledges.tints],
          castShadow: false,
        },
        { name: 'cypress', variants: [0, 1].map((v) => buildCypress(31 + v)), matrices: scatter.cypress, tints: scatter.tints[1]!, castShadow: true },
      ],
      180,
    );
    chunked.group.name = 'vegetation';
    return chunked;
  }, [assets.cliff]);
  useEffect(() => {
    vegetation.setDensity(quality.vegetationDensity);
  }, [vegetation, quality.vegetationDensity]);
  useFrame(({ camera }) => vegetation.update(camera.position));

  const boulders = useMemo(() => {
    // Built in full; the tier draws a prefix (placement is sequential from one
    // seed, so the first 350 are exactly Low's set) and a preset switch
    // matches a fresh load.
    const b = buildBoulders(700);
    const white = new THREE.Color(1, 1, 1);
    const chunked = buildChunkedScatter(createBoulderMaterial(), [{ name: 'boulders', variants: [b.geometry], matrices: b.matrices, tints: b.matrices.map(() => white), castShadow: true }], 180);
    chunked.group.name = 'boulders';
    return chunked;
  }, []);
  // The terrain mesh follows the tier at runtime (the height texture the
  // ocean reads is a fixed 512², so only the mesh is rebuilt).
  const firstSegments = useRef(quality.terrainSegments).current;
  const terrainGeo = useMemo(
    () => (quality.terrainSegments === firstSegments ? assets.terrain.geometry : buildTerrain(quality.terrainSegments).geometry),
    [assets, firstSegments, quality.terrainSegments],
  );
  useEffect(() => () => terrainGeo.dispose(), [terrainGeo]);

  useEffect(() => {
    boulders.setDensity(quality.terrainSegments >= 320 ? 1 : 0.5);
  }, [boulders, quality.terrainSegments]);
  // Boulder shadows are a few pixels at broadcast distance: High only.
  useEffect(() => {
    boulders.group.traverse((o) => void (o.castShadow = quality.shadows === 'high'));
  }, [boulders, quality.shadows]);

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
    // Floodlights are only in the scene when they're on (every light in the
    // scene is a pass through the light loop for every lit pixel, even at
    // zero intensity). Low and Medium use every other bank at double power.
    const every = quality.tier === 'high' || quality.tier === 'ultra' ? 1 : 2;
    flood.forEach((l, i) => {
      l.visible = factor > 0 && i % every === 0;
      // Divided by the preset exposure so the field reads the same under the
      // brighter night exposure that lets the moonlit sky and sea show.
      l.intensity = (17000 * factor * every) / preset.exposure;
      l.target.updateMatrixWorld();
    });
  }, [preset, flood, quality.tier]);

  const boardZ = STAND.northZ + 6;
  const roofFrontH = PROFILE.roof.hFront;

  return (
    <>
      <directionalLight ref={sunRef} name="sun" castShadow>
        <object3D attach="target" />
      </directionalLight>

      <primitive object={assets.sky.mesh} />
      {/* The heightfield receives but doesn't cast: 320 k triangles × 4 cascades,
          and the cliff face (its own mesh) casts the shadows that matter. */}
      <mesh name="terrain" geometry={terrainGeo} material={assets.terrainMat} receiveShadow />
      <mesh name="cliff" geometry={assets.cliff.geometry} material={assets.terrainMat} receiveShadow castShadow />
      <mesh name="headlands" geometry={assets.headlands} material={assets.headlandMat} />
      <primitive object={assets.ocean.mesh} />
      <primitive object={boulders.group} />
      <primitive object={vegetation.group} />

      {/* Stadium bowl */}
      <mesh name="seating" geometry={bowl.seating} material={assets.seatingMat} receiveShadow castShadow />
      <primitive object={crowd.mesh} />
      <primitive object={precip.mesh} />
      <primitive object={vfx.mesh} />
      <mesh name="concrete" geometry={bowl.concrete} material={assets.concreteMat} receiveShadow castShadow />
      <mesh geometry={bowl.glass} material={assets.glassMat} />
      <mesh name="roof" geometry={bowl.roof} material={assets.roofMat} receiveShadow castShadow />
      <primitive object={lightBanks} />
      {flood.map((l, i) => (
        <group key={i}>
          <primitive object={l} />
          <primitive object={l.target} />
        </group>
      ))}

      <primitive object={grass.mesh} />
      {/* Playing surface and apron */}
      <mesh name="field" rotation-x={-Math.PI / 2} position={[0, 0.02, -2]} material={assets.fieldMat} receiveShadow>
        <planeGeometry args={[STAND.halfWidth * 2, 138, 1, 1]} />
      </mesh>

      {/* Plaza ring around the stadium and the open-end terrace */}
      <mesh name="plaza" geometry={plaza} position={[0, 0.02, 0]} material={assets.pavingMat} receiveShadow />
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
