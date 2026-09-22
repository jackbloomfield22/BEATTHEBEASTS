import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { atmosphereUniforms, SkyLUT, sunDirection, sunTransmittance } from './sky/atmosphere';
import { createSkyDome } from './sky/SkyDome';
import { buildBoulders, buildHeadlands, buildTerrain, createBoulderMaterial, createTerrainMaterial } from './terrain/terrain';
import { createOcean } from './ocean/ocean';
import { buildBowl, PROFILE } from './stadium/bowl';
import { createConcreteMaterial, createGlassMaterial, createLightBankMaterial, createRoofMaterial, createSeatingMaterial, stadiumUniforms } from './stadium/materials';
import { createFieldMaterial, createFieldPaint } from './field/field';
import { createLightHeadMaterial, createMetalMaterial, createPavingMaterial, createScreenMaterial, createVideoBoardTexture } from './stadium/props';
import { LIGHTING_PRESETS, type LightingPreset } from './lighting/presets';
import { STAND } from './world/constants';

export interface WorldQuality {
  shadowMapSize: number; // 0 = shadows off
  terrainSegments: number;
}

/**
 * The persistent Blackcliff scene: sky, sea, cliffs, stadium, field. Built
 * once and kept alive across every app state (TECH_PLAN §4.2).
 */
export function World({ preset, quality, onReady }: { preset: LightingPreset; quality: WorldQuality; onReady?: () => void }) {
  const { gl, scene } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null!);

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
    stadiumUniforms.uLights.value = preset.stadiumLights;
    assets.ocean.material.uniforms.uStadiumLights!.value = preset.stadiumLights;

    const sun = sunRef.current;
    sun.color.copy(trans).multiplyScalar(1 / Math.max(trans.r, trans.g, trans.b, 1e-4));
    sun.intensity = preset.sunIlluminance * Math.max(trans.r, trans.g, trans.b) * (dir.y > 0 ? 1 : 0);
    sun.position.copy(dir).multiplyScalar(600);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    // IBL from the same sky (clouds included) so ambient light matches it.
    const rt = pmrem.fromScene(envScene, 0, 1, 2000);
    const prev = scene.environment;
    scene.environment = rt.texture;
    scene.environmentIntensity = import.meta.env.DEV && new URLSearchParams(location.search).has("envI") ? Number(new URLSearchParams(location.search).get("envI")) : preset.envIntensity;
    if (prev && prev !== rt.texture) prev.dispose();
    if (import.meta.env.DEV) Object.assign(window, { __btbScene: scene, __btbEnvScene: envScene, __btbGl: gl, __btbPmrem: pmrem });
  }, [preset, gl, lut, pmrem, envScene, env, assets, scene]);

  // Shadows follow quality.
  useEffect(() => {
    const sun = sunRef.current;
    sun.castShadow = quality.shadowMapSize > 0;
    if (quality.shadowMapSize > 0) {
      sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      const cam = sun.shadow.camera;
      cam.left = -175;
      cam.right = 175;
      cam.top = 175;
      cam.bottom = -175;
      cam.near = 100;
      cam.far = 1100;
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.35;
    }
  }, [quality.shadowMapSize]);

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

  useFrame(({ camera, clock }) => {
    atmosphereUniforms.uTime.value = clock.elapsedTime;
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
    const factor = preset.stadiumLights * (preset.sunElevationDeg < 0 ? 1 : preset.id === 'rain' || preset.id === 'snow' ? 0.35 : 0);
    for (const l of flood) {
      l.intensity = 17000 * factor;
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
      <mesh geometry={assets.headlands} material={assets.headlandMat} />
      <primitive object={assets.ocean.mesh} />
      <primitive object={boulders} />

      {/* Stadium bowl */}
      <mesh geometry={bowl.seating} material={assets.seatingMat} receiveShadow castShadow />
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
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, -10]} material={assets.pavingMat} receiveShadow>
        <planeGeometry args={[250, 250]} />
      </mesh>
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
