import * as THREE from 'three';

export type SceneState = 'IDLE' | 'RESCUE' | 'RETURN';

export interface SceneCallbacks {
  onArrive: () => void;
  onReturn: () => void;
  onIdle: () => void;
  onLog: (msg: string, type?: 'new' | 'warn') => void;
  onTelemetry: (t: { speed: number; state: SceneState }) => void;
  onRadarVictim: (pos: { x: number; z: number } | null) => void;
}

const SUN_DIR = new THREE.Vector3(0.45, 0.55, -0.7).normalize();

/**
 * Realistic maritime rescue scene built on three.js.
 * Exposes a small imperative API (trigger, dispose, resize) plus
 * a telemetry stream consumed by the React HUD overlay.
 */
export class ShorelineScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private cb: SceneCallbacks;

  private oceanMat: THREE.ShaderMaterial;
  private seaFloorMat: THREE.ShaderMaterial;
  private skyMat: THREE.ShaderMaterial;
  private foamStrips: THREE.Mesh[] = [];
  private buoys: THREE.Group[] = [];
  private buoyLights: THREE.Mesh[] = [];
  private buoyBeams: THREE.Mesh[] = [];
  private boat!: THREE.Group;
  private victim!: THREE.Group;
  private wake!: THREE.Mesh;
  private siren!: THREE.Mesh;
  private flag!: THREE.Mesh;

  private targetPos = new THREE.Vector3();
  private state: SceneState = 'IDLE';
  private boatSpeed = 0;
  private rescueBusy = false;

  // camera orbit
  private yaw = 0;
  private pitch = 0.52;
  private radius = 75;
  private height = 28;
  private targetYaw = 0;
  private targetPitch = 0.52;
  private targetRadius = 75;
  private targetHeight = 28;
  private camTarget = new THREE.Vector3(0, 0, 55);
  private focusTarget = new THREE.Vector3(0, 0, 55);

  // input
  private drag = { on: false, x: 0, y: 0, btn: -1, shift: false };

  constructor(canvas: HTMLCanvasElement, cb: SceneCallbacks) {
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xbfe9ff, 0.0048);

    this.camera = new THREE.PerspectiveCamera(
      58,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.updateCamera();

    // Materials created upfront so build functions can reference them.
    this.oceanMat = this.makeOceanMaterial();
    this.seaFloorMat = this.makeSeaFloorMaterial();
    this.skyMat = this.makeSkyMaterial();

    this.buildLights();
    this.buildSky();
    this.buildOcean();
    this.buildSeaFloor();
    this.buildShoreline();
    this.buildTower();
    this.buildBoat();
    this.buildBuoys();
    this.buildBuoyShelter();
    this.buildVictim();

    this.attachControls(canvas);
    window.addEventListener('resize', this.onResize);
  }

  // ── materials ──────────────────────────────────────────────────────────────
  private makeOceanMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        sunDir: { value: SUN_DIR.clone() },
        deep: { value: new THREE.Color(0x013a5b) },
        shallow: { value: new THREE.Color(0x0a9bc8) },
        foam: { value: new THREE.Color(0xeafcff) },
        camPos: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        uniform float time;
        varying vec3 vWorld;
        varying float vH;
        varying vec3 vNormal;

        // Smooth oscillating wave: rolls in then recedes without stutter
        vec3 wave(vec2 p, vec2 dir, float freq, float speed, float amp, float t){
          float phase = dot(p, dir) * freq + sin(t * speed) * 2.0;
          float c = cos(phase);
          float s = sin(phase);
          return vec3(dir.x * s * amp * 0.12, amp * c, dir.y * s * amp * 0.12);
        }

        void main(){
          vec3 pos = position;
          vec2 hp = pos.xy;
          vec3 disp = vec3(0.0);
          disp += wave(hp, normalize(vec2(0.0, 1.0)), 0.085, 0.85, 0.55, time);
          disp += wave(hp, normalize(vec2(0.1, 1.0)), 0.13, 1.15, 0.34, time);
          disp += wave(hp, normalize(vec2(-0.08, 1.0)), 0.21, 1.55, 0.18, time);
          disp += wave(hp, normalize(vec2(0.05, 1.0)), 0.34, 2.1, 0.08, time);
          pos += disp;
          vH = pos.z;

          // Approximate normal from wave derivatives
          vec3 n = normalize(vec3(-disp.x * 0.6, -disp.y * 0.6, 1.0));
          vNormal = normalize(mat3(modelMatrix) * n);

          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 deep, shallow, foam, sunDir, camPos;
        uniform float time;
        varying vec3 vWorld;
        varying float vH;
        varying vec3 vNormal;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }

        void main(){
          float depth = clamp((vH + 1.4) / 2.8, 0.0, 1.0);
          vec3 col = mix(deep, shallow, depth);

          // Fresnel sky reflection
          vec3 viewDir = normalize(camPos - vWorld);
          float fres = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
          vec3 sky = mix(vec3(0.55, 0.78, 0.95), vec3(0.18, 0.45, 0.78), 0.5);
          col = mix(col, sky, fres * 0.55);

          // Sun specular highlight
          vec3 h = normalize(sunDir + viewDir);
          float spec = pow(max(dot(vNormal, h), 0.0), 200.0);
          col += vec3(1.0, 0.96, 0.85) * spec * 1.6;

          // Wave-crest foam
          float foamN = noise(vWorld.xz * 0.6 + time * 0.2);
          float foamMask = smoothstep(0.78, 1.0, vH + foamN * 0.25);
          col = mix(col, foam, foamMask * 0.7);

          // Shoreline whitewash (z near beach)
          float shore = smoothstep(70.0, 95.0, vWorld.z);
          col = mix(col, foam, shore * 0.35);

          gl_FragColor = vec4(col, 0.94);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
    });
  }

  private makeSeaFloorMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        sandLight: { value: new THREE.Color(0x6fe3d6) },
        sandDark: { value: new THREE.Color(0x1a6f86) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vP;
        void main(){
          vUv = uv;
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 sandLight, sandDark;
        uniform float time;
        varying vec2 vUv;
        varying vec3 vP;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                     mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
        }
        void main(){
          float r = noise(vUv * 42.0) * 0.5 + noise(vUv * 18.0) * 0.3 + noise(vUv * 90.0) * 0.15;
          vec3 col = mix(sandDark, sandLight, r);
          float ca = sin(vP.x * 0.42 + time * 1.3) * cos(vP.z * 0.37 + time * 1.0);
          float cb = cos(vP.x * 0.31 + time * 0.85) * sin(vP.z * 0.48 + time * 1.15);
          float caust = pow(clamp((ca + cb) * 0.5 + 0.5, 0.0, 1.0), 2.8) * 0.75;
          col += vec3(caust * 0.28, caust * 0.48, caust * 0.58);
          float dist = length(vUv - 0.5) * 2.0;
          col = mix(col, vec3(0.01, 0.10, 0.20), clamp(dist - 0.15, 0.0, 1.0) * 0.58);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }

  private makeSkyMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x1f6fb8) },
        mid: { value: new THREE.Color(0x8fd0f0) },
        bottom: { value: new THREE.Color(0xe8f7ff) },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 top, mid, bottom, sunDir;
        varying vec3 vDir;
        void main(){
          float h = vDir.y;
          float t1 = smoothstep(0.0, 0.45, h);
          float t2 = smoothstep(-0.15, 0.05, h);
          vec3 col = mix(bottom, mid, t2);
          col = mix(col, top, t1);
          float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 220.0);
          col += vec3(1.0, 0.93, 0.78) * sun * 2.0;
          float glow = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 12.0);
          col += vec3(1.0, 0.85, 0.6) * glow * 0.25;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }

  // ── build ──────────────────────────────────────────────────────────────────
  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0xcce6ff, 0.55));

    const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
    sun.position.copy(SUN_DIR).multiplyScalar(220);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -180, right: 180, top: 180, bottom: -180, near: 1, far: 600,
    });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    const sky = new THREE.HemisphereLight(0x9fd4ff, 0x14424f, 0.6);
    this.scene.add(sky);

    const bounce = new THREE.DirectionalLight(0x3fb8ff, 0.35);
    bounce.position.set(-40, -8, 80);
    this.scene.add(bounce);

    [
      [0, -6, 0, 0x00ddff, 2.2, 110],
      [60, -8, 30, 0x00ccee, 1.6, 85],
      [-60, -8, -30, 0x0099bb, 1.6, 85],
    ].forEach(([x, y, z, col, i, d]) => {
      const l = new THREE.PointLight(col as number, i as number, d as number);
      l.position.set(x as number, y as number, z as number);
      this.scene.add(l);
    });
  }

  private buildSky() {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.scene.add(dome);

    // Volumetric-ish clouds: clusters of soft spheres
    for (let ci = 0; ci < 14; ci++) {
      const cg = new THREE.Group();
      const count = 4 + Math.floor(Math.random() * 6);
      for (let b = 0; b < count; b++) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(7 + Math.random() * 7, 8, 6),
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 1,
            transparent: true,
            opacity: 0.82,
          })
        );
        m.position.set(
          (Math.random() - 0.5) * 24,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 18
        );
        cg.add(m);
      }
      cg.position.set(
        (Math.random() - 0.5) * 700,
        115 + Math.random() * 70,
        (Math.random() - 0.5) * 700
      );
      this.scene.add(cg);
    }
  }

  private buildOcean() {
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800, 160, 160),
      this.oceanMat
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.receiveShadow = true;
    this.scene.add(ocean);
  }

  private buildSeaFloor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800, 120, 120),
      this.seaFloorMat
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -14, 0);
    this.scene.add(floor);

    const COLS = [
      [0xff6b9d, 0xff4757], [0xff9f43, 0xfeca57], [0x48dbfb, 0x0abde3],
      [0xa29bfe, 0x6c5ce7], [0xff9ff3, 0xf368e0], [0xff6348, 0xff4757],
    ];
    for (let i = 0; i < 60; i++) {
      const cc = COLS[i % COLS.length];
      this.makeCoral(
        (Math.random() - 0.5) * 300,
        (Math.random() - 0.5) * 300,
        cc[0], cc[1]
      );
    }
    for (let i = 0; i < 35; i++) {
      const rs = 0.8 + Math.random() * 3.8;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rs, 0),
        new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 1 })
      );
      rock.position.set(
        (Math.random() - 0.5) * 300, -13.5, (Math.random() - 0.5) * 300
      );
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      rock.castShadow = true;
      this.scene.add(rock);
    }
    for (let i = 0; i < 90; i++) {
      const h = 1.5 + Math.random() * 4;
      const sw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.15, h, 4),
        new THREE.MeshStandardMaterial({
          color: Math.random() > 0.5 ? 0x1aaa55 : 0x0d7a40, roughness: 1,
        })
      );
      sw.position.set((Math.random() - 0.5) * 300, -13 + h / 2, (Math.random() - 0.5) * 300);
      sw.rotation.z = (Math.random() - 0.5) * 0.55;
      this.scene.add(sw);
    }
    for (let i = 0; i < 18; i++) {
      const sf = new THREE.Mesh(
        new THREE.TorusGeometry(0.65, 0.16, 4, 5),
        new THREE.MeshStandardMaterial({
          color: 0xff7043, roughness: 0.8, emissive: 0xff4500, emissiveIntensity: 0.12,
        })
      );
      sf.rotation.x = -Math.PI / 2;
      sf.position.set((Math.random() - 0.5) * 240, -13.92, (Math.random() - 0.5) * 240);
      this.scene.add(sf);
    }
  }

  private makeCoral(x: number, z: number, c1: number, c2: number) {
    const g = new THREE.Group();
    for (let i = 0; i < 3 + Math.floor(Math.random() * 5); i++) {
      const h = 1 + Math.random() * 3.2;
      const r = 0.15 + Math.random() * 0.3;
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.25, r, h, 6),
        new THREE.MeshStandardMaterial({
          color: Math.random() > 0.5 ? c1 : c2, roughness: 0.8,
          emissive: c1, emissiveIntensity: 0.22,
        })
      );
      m.position.set((Math.random() - 0.5) * 3, h / 2, (Math.random() - 0.5) * 3);
      m.rotation.z = (Math.random() - 0.5) * 0.45;
      m.castShadow = true;
      g.add(m);
    }
    g.position.set(x, -13.3, z);
    this.scene.add(g);
  }

  private buildShoreline() {
    // dry beach with wet→dry gradient, speckle and subtle dune ripples
    const beach = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 88),
      new THREE.ShaderMaterial({
        uniforms: {
          wet: { value: new THREE.Color(0xc9b07a) },
          dry: { value: new THREE.Color(0xf0dca8) },
          speck: { value: new THREE.Color(0xb89968) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 wet, dry, speck; varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                       mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
          }
          void main(){
            float t = smoothstep(0.0, 0.35, vUv.y);
            vec3 col = mix(wet, dry, t);
            float n = noise(vUv * 80.0);
            col = mix(col, speck, n * 0.25);
            float ripple = sin(vUv.x * 120.0 + noise(vUv * 14.0) * 8.0) * 0.5 + 0.5;
            col = mix(col, col * 1.06, ripple * 0.15);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      })
    );
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(0, 0.05, 152);
    beach.receiveShadow = true;
    this.scene.add(beach);

    // breaking-wave foam strips
    for (let fi = 0; fi < 5; fi++) {
      const fm = new THREE.Mesh(
        new THREE.PlaneGeometry(800, 3.5 + fi * 1.2),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.3 - fi * 0.05,
        })
      );
      fm.rotation.x = -Math.PI / 2;
      fm.position.set(0, 0.13, 104 + fi * 2.6);
      fm.userData = { base: 104 + fi * 2.6, phase: fi * 1.2 };
      this.scene.add(fm);
      this.foamStrips.push(fm);
    }

    // pebbles along the strand
    for (let pi = 0; pi < 90; pi++) {
      const ps = 0.1 + Math.random() * 0.5;
      const peb = new THREE.Mesh(
        new THREE.SphereGeometry(ps, 5, 4),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(0.6, 0.12, 0.35 + Math.random() * 0.3),
          roughness: 0.9,
        })
      );
      peb.position.set((Math.random() - 0.5) * 760, 0.08, 102 + Math.random() * 26);
      peb.rotation.set(Math.random(), Math.random(), Math.random());
      this.scene.add(peb);
    }

    // backshore cliff
    const cliff = new THREE.Mesh(
      new THREE.BoxGeometry(800, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 1 })
    );
    cliff.position.set(0, 8, 200);
    cliff.castShadow = true;
    cliff.receiveShadow = true;
    this.scene.add(cliff);

    // wooden boardwalk / pier extending into the water (offset to the side so it doesn't overlap the buoys)
    this.makePier(70, 118, 24);

    // palms along the back of the beach
    [-150, -110, -72, -40, -10, 28, 62, 100, 140, 178, 212].forEach((x, i) =>
      this.makePalm(x, 158 + (i % 3) * 5)
    );

    // umbrellas paired with lounge chairs
    this.makeUmb(-100, 138, 0xff6b6b); this.makeBeachChair(-100, 140);
    this.makeUmb(-72, 146, 0xffd166); this.makeBeachChair(-72, 148);
    this.makeUmb(60, 142, 0x06d6a0); this.makeBeachChair(60, 144);
    this.makeUmb(112, 138, 0x118ab2); this.makeBeachChair(112, 140);
    this.makeUmb(150, 144, 0xff9ff3); this.makeBeachChair(150, 146);

    // brightly coloured towels
    this.makeTowel(-86, 136, 0xe74c3c);
    this.makeTowel(30, 140, 0x3498db);
    this.makeTowel(86, 136, 0xf1c40f);
    this.makeTowel(132, 142, 0x2ecc71);

    // driftwood logs
    this.makeDriftwood(-30, 134, 1.2, 0.4);
    this.makeDriftwood(44, 138, -0.8, 0.6);
    this.makeDriftwood(160, 140, 0.3, 0.5);

    // beach grass tufts near the dunes
    for (let gi = 0; gi < 40; gi++) {
      this.makeBeachGrass((Math.random() - 0.5) * 720, 168 + Math.random() * 22);
    }

    // scattered boulders
    for (let bi = 0; bi < 8; bi++) {
      this.makeBeachBoulder(
        (Math.random() - 0.5) * 600,
        120 + Math.random() * 30,
        0.8 + Math.random() * 1.6
      );
    }

    // a little sandcastle
    this.makeSandcastle(-54, 132);

    // post-and-rope fence along the back of the beach
    this.makeFence();
  }

  private makePier(cx: number, cz: number, len: number) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x6e4a28, roughness: 0.95 });
    const planks = 14;
    for (let i = 0; i < planks; i++) {
      const t = i / (planks - 1);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(7, 0.18, 1.6), wood);
      plank.position.set(0, 0.5, -t * len);
      plank.castShadow = true; plank.receiveShadow = true;
      g.add(plank);
    }
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      [-3.2, 3.2].forEach((x) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), dark);
        post.position.set(x, -2.6, -t * len);
        post.castShadow = true;
        g.add(post);
      });
    }
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      [-3.4, 3.4].forEach((x) => {
        const rp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), dark);
        rp.position.set(x, 1.6, -t * len);
        g.add(rp);
      });
    }
    [-3.4, 3.4].forEach((x) => {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 4), dark);
      rope.rotation.x = Math.PI / 2;
      rope.position.set(x, 1.4, -len / 2);
      g.add(rope);
    });
    g.position.set(cx, 0, cz);
    this.scene.add(g);
  }

  private makeBeachChair(x: number, z: number) {
    const g = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.8 });
    const legs = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), frame);
    legs.position.y = 0.25; g.add(legs);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.08), seat);
    back.position.set(0, 0.8, -0.4); back.rotation.x = -0.5; g.add(back);
    const seatM = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9), seat);
    seatM.position.set(0, 0.55, 0); g.add(seatM);
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * 0.4 - 0.2;
    this.scene.add(g);
  }

  private makeTowel(x: number, z: number, col: number) {
    const t = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.4),
      new THREE.MeshStandardMaterial({ color: col, roughness: 1, side: THREE.DoubleSide })
    );
    t.rotation.x = -Math.PI / 2;
    t.rotation.z = Math.random() * 0.6;
    t.position.set(x, 0.12, z);
    t.receiveShadow = true;
    this.scene.add(t);
  }

  private makeDriftwood(x: number, z: number, rot: number, scale: number) {
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25 * scale, 0.3 * scale, 4 * scale, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a7050, roughness: 1 })
    );
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rot;
    log.position.set(x, 0.18, z);
    log.castShadow = true;
    this.scene.add(log);
  }

  private makeBeachGrass(x: number, z: number) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa040, roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.9 + Math.random() * 0.5, 3), mat);
      blade.position.set((Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6);
      blade.rotation.z = (Math.random() - 0.5) * 0.5;
      g.add(blade);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
  }

  private makeBeachBoulder(x: number, z: number, r: number) {
    const b = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r, 0),
      new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 1 })
    );
    b.position.set(x, r * 0.4, z);
    b.rotation.set(Math.random(), Math.random(), Math.random());
    b.castShadow = true; b.receiveShadow = true;
    this.scene.add(b);
  }

  private makeSandcastle(x: number, z: number) {
    const g = new THREE.Group();
    const sand = new THREE.MeshStandardMaterial({ color: 0xe8c890, roughness: 1 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.7, 12), sand);
    base.position.y = 0.35; g.add(base);
    [0, 1, 2, 3].forEach((i) => {
      const a = (i / 4) * Math.PI * 2;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.1, 8), sand);
      tower.position.set(Math.cos(a) * 1.0, 0.55, Math.sin(a) * 1.0);
      g.add(tower);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.4, 8), sand);
      cap.position.set(Math.cos(a) * 1.0, 1.3, Math.sin(a) * 1.0);
      g.add(cap);
    });
    g.position.set(x, 0, z);
    this.scene.add(g);
  }

  private makeFence() {
    const wood = new THREE.MeshStandardMaterial({ color: 0xc9a063, roughness: 0.9 });
    for (let x = -380; x <= 380; x += 12) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6), wood);
      post.position.set(x, 0.8, 186);
      post.castShadow = true;
      this.scene.add(post);
    }
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 760, 4),
      new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 1 })
    );
    rope.rotation.z = Math.PI / 2;
    rope.position.set(0, 1.2, 186);
    this.scene.add(rope);
  }

  private makePalm(x: number, z: number) {
    const g = new THREE.Group();
    const lean = (Math.random() - 0.5) * 0.38;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.45, 9, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 1 })
    );
    trunk.position.y = 4.5;
    trunk.rotation.z = lean;
    g.add(trunk);
    for (let f = 0; f < 8; f++) {
      const ang = (f / 8) * Math.PI * 2;
      const frond = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 4.5, 4),
        new THREE.MeshStandardMaterial({ color: 0x2d7a3c, roughness: 0.8 })
      );
      frond.position.set(Math.cos(ang) * 1.65 + lean * 3, 9.3, Math.sin(ang) * 1.65);
      frond.rotation.set(Math.PI * 0.34, 0, ang + Math.PI * 0.5);
      g.add(frond);
    }
    for (let c = 0; c < 3; c++) {
      const coc = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 })
      );
      coc.position.set((Math.random() - 0.5) * 1.4 + lean * 3, 8.5, (Math.random() - 0.5) * 1.4);
      g.add(coc);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
  }

  private makeUmb(x: number, z: number, col: number) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0xdddddd })
    );
    pole.position.y = 2;
    g.add(pole);
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 1, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, side: THREE.DoubleSide })
    );
    top.position.y = 4.3;
    g.add(top);
    g.position.set(x, 0, z);
    this.scene.add(g);
  }

  private buildTower() {
    const g = new THREE.Group();
    const legM = new THREE.MeshStandardMaterial({ color: 0xd4a857, roughness: 0.8 });
    const lG = new THREE.CylinderGeometry(0.15, 0.15, 5);
    [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(([x, z]) => {
      const l = new THREE.Mesh(lG, legM);
      l.position.set(x, 2.5, z);
      l.castShadow = true;
      g.add(l);
    });
    const plat = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 5), legM);
    plat.position.y = 5;
    plat.castShadow = true;
    g.add(plat);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(4, 3.1, 4),
      new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.9 })
    );
    cab.position.y = 6.7;
    cab.castShadow = true;
    g.add(cab);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.3, 4.6),
      new THREE.MeshStandardMaterial({ color: 0xff4500 })
    );
    roof.position.y = 8.4;
    g.add(roof);
    const cm = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
    [new THREE.BoxGeometry(2.1, 0.06, 0.4), new THREE.BoxGeometry(0.4, 0.06, 2.1)].forEach((geo, i) => {
      const m = new THREE.Mesh(geo, cm);
      m.position.set(0, 8.48 + i * 0.01, 2.08);
      g.add(m);
    });
    const fp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 4),
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    fp.position.set(2, 10.5, -1.5);
    g.add(fp);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.9),
      new THREE.MeshBasicMaterial({ color: 0xff4500, side: THREE.DoubleSide })
    );
    flag.position.set(2.85, 11.7, -1.5);
    g.add(flag);
    this.flag = flag;
    g.position.set(-32, 0, 144);
    this.scene.add(g);
  }

  private buildBoat() {
    this.boat = new THREE.Group();
    const hullM = new THREE.MeshStandardMaterial({ color: 0xff4500, roughness: 0.5, metalness: 0.1 });
    const whiteM = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.6 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.35, roughness: 0.1 });
    const redM = new THREE.MeshBasicMaterial({ color: 0xff2d55 });

    [[-2.3, 0], [2.3, 0]].forEach(([x]) => {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 8), hullM);
      hull.position.set(x, 0, 0);
      hull.castShadow = true;
      this.boat.add(hull);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.3, 8), hullM);
      nose.rotation.x = -Math.PI / 2;
      nose.position.set(x, 0, -5.1);
      nose.castShadow = true;
      this.boat.add(nose);
    });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.4, 7.4), whiteM);
    deck.position.y = 0.96;
    deck.castShadow = true;
    this.boat.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.7, 2.1, 3.3), darkM);
    cabin.position.set(0, 2.18, -0.4);
    cabin.castShadow = true;
    this.boat.add(cabin);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.3, 0.1), glassM);
    ws.position.set(0, 2.42, 1.25);
    ws.rotation.x = -0.28;
    this.boat.add(ws);
    [new THREE.BoxGeometry(2.1, 0.06, 0.42), new THREE.BoxGeometry(0.42, 0.06, 2.1)].forEach((geo, i) => {
      const m = new THREE.Mesh(geo, redM);
      m.position.set(0, 3.28 + i * 0.01, -0.4);
      this.boat.add(m);
    });
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 5.5),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    mast.position.set(0, 5.8, -1);
    this.boat.add(mast);
    const siren = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x001144 })
    );
    siren.position.set(0, 8.6, -1);
    this.siren = siren;
    this.boat.add(siren);

    const wMat = new THREE.MeshBasicMaterial({
      color: 0xaaddee, transparent: true, opacity: 0, side: THREE.DoubleSide,
    });
    this.wake = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 17), wMat);
    this.wake.rotation.x = -Math.PI / 2;
    this.wake.position.set(0, 0.07, 7);
    this.boat.add(this.wake);

    this.boat.position.set(0, 0, 104);
    this.boat.rotation.y = Math.PI;
    this.scene.add(this.boat);
  }

  private buildBuoys() {
    [-42, 0, 42].forEach((x, i) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.0, 2.4, 20),
        new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.5, metalness: 0.1 })
      );
      body.position.y = 1.2;
      body.castShadow = true;
      g.add(body);
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(1.63, 1.63, 0.43, 20),
        new THREE.MeshStandardMaterial({ color: 0xff2d55 })
      );
      stripe.position.y = 1.5;
      g.add(stripe);
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 5),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
      );
      mast.position.y = 4.7;
      g.add(mast);
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x00e5ff })
      );
      light.position.y = 7.4;
      g.add(light);
      this.buoyLights.push(light);
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(30, 24, 32, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x00e5ff, transparent: true, opacity: 0.06,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      beam.position.y = 5;
      beam.rotation.x = Math.PI;
      g.add(beam);
      this.buoyBeams.push(beam);
      const line = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 4),
        new THREE.MeshStandardMaterial({ color: 0x554433 })
      );
      line.position.y = -2;
      g.add(line);
      g.position.set(x, 0, 40);
      this.scene.add(g);
      this.buoys.push(g);
    });
  }

  private buildVictim() {
    this.victim = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.37, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xff2d55, roughness: 0.6 })
    );
    ring.rotation.x = Math.PI / 2;
    this.victim.add(ring);
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.63, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xf4c58a })
    );
    body.position.y = 0.2;
    this.victim.add(body);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2d55 })
    );
    beacon.position.y = 1.28;
    beacon.userData.isBeacon = true;
    this.victim.add(beacon);
    const vl = new THREE.PointLight(0xff2d55, 3, 10);
    vl.position.set(0, 1, 0);
    this.victim.add(vl);
    this.victim.visible = false;
    this.scene.add(this.victim);
  }

  private buildBuoyShelter() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8b6b3f, roughness: 0.9 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x5e3f1a, roughness: 0.95 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.5, metalness: 0.4 });

    // Main deck platform
    const deck = new THREE.Mesh(new THREE.BoxGeometry(22, 0.35, 10), wood);
    deck.position.set(0, 0.5, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    // Deck support pilings
    for (let xi = -2; xi <= 2; xi++) {
      for (let zi = -1; zi <= 1; zi += 2) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 5, 8), darkWood);
        pile.position.set(xi * 5, -2, zi * 3.5);
        pile.castShadow = true;
        g.add(pile);
      }
    }

    // Shelter roof posts (4 corners)
    const postPositions = [[-8, -3.5], [-8, 3.5], [8, -3.5], [8, 3.5]];
    postPositions.forEach(([px, pz]) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 6), metal);
      post.position.set(px, 2.9, pz);
      post.castShadow = true;
      g.add(post);
    });

    // Roof canopy
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.2, 9),
      new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.7 })
    );
    roof.position.set(0, 5.1, 0);
    roof.castShadow = true;
    g.add(roof);

    // Roof trim
    const trimFront = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 0.15), metal);
    trimFront.position.set(0, 4.85, -4.5);
    g.add(trimFront);
    const trimBack = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 0.15), metal);
    trimBack.position.set(0, 4.85, 4.5);
    g.add(trimBack);

    // Side railing
    [[-11, 0], [11, 0]].forEach(([rx]) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 9), darkWood);
      rail.position.set(rx, 1.3, 0);
      g.add(rail);
    });

    // Back railing
    const backRail = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 0.12), darkWood);
    backRail.position.set(0, 1.3, 5);
    g.add(backRail);

    // "BUOY STATION" sign on the back rail
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(6, 1.0, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1a3a5c, roughness: 0.6 })
    );
    sign.position.set(0, 2.2, 5.08);
    g.add(sign);

    // Docked buoys on the deck
    const buoyColors = [0xffb300, 0xff5722, 0x4caf50, 0x2196f3, 0xff9800, 0xe91e63];
    for (let i = 0; i < 6; i++) {
      const bx = -7.5 + i * 3;
      const bg = new THREE.Group();

      // Buoy body
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.6, 1.5, 16),
        new THREE.MeshStandardMaterial({ color: buoyColors[i], roughness: 0.5, metalness: 0.1 })
      );
      body.position.y = 1.45;
      body.castShadow = true;
      bg.add(body);

      // Stripe band
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.93, 0.93, 0.25, 16),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
      );
      stripe.position.y = 1.55;
      bg.add(stripe);

      // Mast
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x333333 })
      );
      mast.position.y = 3.2;
      bg.add(mast);

      // Top light
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x00e5ff })
      );
      light.position.y = 4.35;
      bg.add(light);

      bg.position.set(bx, 0, i % 2 === 0 ? -1.5 : 1.5);
      g.add(bg);
    }

    // Anchor chain coils on deck
    for (let ci = 0; ci < 3; ci++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.45, 0.08, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.6, metalness: 0.5 })
      );
      coil.rotation.x = -Math.PI / 2;
      coil.position.set(-9 + ci * 9, 0.75, -3.5);
      g.add(coil);
    }

    // Position the shelter near the shore, offset from the pier
    g.position.set(-80, 0, 108);
    this.scene.add(g);
  }

  // ── controls ───────────────────────────────────────────────────────────────
  private attachControls(cvs: HTMLCanvasElement) {
    cvs.addEventListener('contextmenu', (e) => e.preventDefault());
    cvs.addEventListener('mousedown', (e) => {
      this.drag = { on: true, btn: e.button, x: e.clientX, y: e.clientY, shift: e.shiftKey };
    });
    window.addEventListener('mouseup', () => { this.drag.on = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag.on) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.btn === 0) {
        // Left-click: rotate (yaw + pitch)
        this.targetYaw -= dx * 0.004;
        this.targetPitch = Math.max(0.02, Math.min(1.45, this.targetPitch - dy * 0.004));
      } else if (this.drag.btn === 2) {
        // Right-click: pan the look-at target
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        this.focusTarget.addScaledVector(right, -dx * 0.08 * (this.radius * 0.02));
        this.focusTarget.y = Math.max(-5, Math.min(80, this.focusTarget.y - dy * 0.08 * (this.radius * 0.02)));
      } else if (this.drag.btn === 1) {
        // Middle-click: adjust height + radius simultaneously
        this.targetHeight = Math.max(2, Math.min(80, this.targetHeight - dy * 0.15));
        this.targetRadius = Math.max(8, Math.min(200, this.targetRadius + dx * 0.15));
      }
    });
    cvs.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
      if (e.shiftKey) {
        // Shift+scroll: adjust camera height
        this.targetHeight = Math.max(2, Math.min(80, this.targetHeight + delta * 0.06));
      } else {
        // Scroll: zoom in/out
        this.targetRadius = Math.max(8, Math.min(200, this.targetRadius + delta * 0.06));
      }
    }, { passive: false });

    // touch
    let td = 0;
    let touchMidX = 0;
    let touchMidY = 0;
    cvs.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        this.drag = { on: true, btn: 0, x: e.touches[0].clientX, y: e.touches[0].clientY, shift: false };
      } else if (e.touches.length === 2) {
        this.drag.on = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        td = Math.sqrt(dx * dx + dy * dy);
        touchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        touchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });
    cvs.addEventListener('touchend', () => { this.drag.on = false; }, { passive: true });
    cvs.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.drag.on) {
        // 1-finger: rotate
        const dx = e.touches[0].clientX - this.drag.x;
        const dy = e.touches[0].clientY - this.drag.y;
        this.drag.x = e.touches[0].clientX;
        this.drag.y = e.touches[0].clientY;
        this.targetYaw -= dx * 0.004;
        this.targetPitch = Math.max(0.02, Math.min(1.45, this.targetPitch - dy * 0.004));
      } else if (e.touches.length === 2) {
        // 2-finger: pinch zoom + pan
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.targetRadius = Math.max(8, Math.min(200, this.targetRadius - (dist - td) * 0.12));
        td = dist;
        // Pan with two-finger drag
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const panDx = midX - touchMidX;
        const panDy = midY - touchMidY;
        touchMidX = midX;
        touchMidY = midY;
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        this.focusTarget.addScaledVector(right, -panDx * 0.06 * (this.radius * 0.02));
        this.focusTarget.y = Math.max(-5, Math.min(80, this.focusTarget.y - panDy * 0.06 * (this.radius * 0.02)));
      }
    }, { passive: false });
  }

  private updateCamera() {
    this.yaw += (this.targetYaw - this.yaw) * 0.08;
    this.pitch += (this.targetPitch - this.pitch) * 0.08;
    this.radius += (this.targetRadius - this.radius) * 0.08;
    this.height += (this.targetHeight - this.height) * 0.08;
    this.camTarget.lerp(this.focusTarget, 0.045);
    const x = Math.sin(this.yaw) * this.radius;
    const z = Math.cos(this.yaw) * this.radius;
    this.camera.position.set(
      this.camTarget.x + x,
      this.height,
      this.camTarget.z + z
    );
    this.camera.lookAt(this.camTarget);
    if (this.oceanMat) {
      (this.oceanMat.uniforms.camPos.value as THREE.Vector3).copy(this.camera.position);
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────
  triggerRescue() {
    if (this.state !== 'IDLE') return;
    const tx = Math.random() * 72 - 36;
    const tz = Math.random() * 55 + 8;
    this.targetPos.set(tx, 0, tz);
    this.victim.position.copy(this.targetPos);
    this.victim.visible = true;
    this.cb.onRadarVictim({ x: tx, z: tz });
    this.state = 'RESCUE';
    this.rescueBusy = false;
    this.boatSpeed = 0;
    this.buoyLights.forEach((l) => (l.material as THREE.MeshBasicMaterial).color.setHex(0xff2d55));
    this.buoyBeams.forEach((b) => {
      (b.material as THREE.MeshBasicMaterial).color.setHex(0xff2d55);
      (b.material as THREE.MeshBasicMaterial).opacity = 0.13;
    });
  }

  private completeRescue() {
    if (this.rescueBusy) return;
    this.rescueBusy = true;
    this.victim.visible = false;
    this.cb.onRadarVictim(null);
    this.state = 'RETURN';
    this.boatSpeed = 0;
    this.cb.onArrive();
  }

  private completeMission() {
    this.state = 'IDLE';
    this.rescueBusy = false;
    this.boatSpeed = 0;
    (this.wake.material as THREE.MeshBasicMaterial).opacity = 0;
    this.boat.rotation.set(0, Math.PI, 0);
    this.buoyLights.forEach((l) => (l.material as THREE.MeshBasicMaterial).color.setHex(0x00e5ff));
    this.buoyBeams.forEach((b) => {
      (b.material as THREE.MeshBasicMaterial).color.setHex(0x00e5ff);
      (b.material as THREE.MeshBasicMaterial).opacity = 0.06;
    });
    this.cb.onReturn();
  }

  start() {
    this.clock.start();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const T = this.clock.elapsedTime;

      this.oceanMat.uniforms.time.value = T;
      this.seaFloorMat.uniforms.time.value = T;

      this.foamStrips.forEach((f) => {
        f.position.z = f.userData.base + Math.sin(T * 0.8 + f.userData.phase) * 1.7;
        (f.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(T * 1.3 + f.userData.phase) * 0.1;
      });

      this.buoys.forEach((b, i) => {
        b.position.y = Math.sin(T * 1.5 + i * 1.2) * 0.52;
        b.rotation.z = Math.sin(T * 0.8 + i) * 0.06;
        b.rotation.x = Math.sin(T * 0.6 + i * 0.5) * 0.04;
        const beam = this.buoyBeams[i];
        (beam.material as THREE.MeshBasicMaterial).opacity =
          this.state === 'IDLE'
            ? 0.05 + Math.sin(T * 2 + i) * 0.016
            : 0.12 + Math.sin(T * 5) * 0.04;
        (this.buoyLights[i].material as THREE.MeshBasicMaterial).opacity = 0.35 + (Math.sin(T * 3 + i) + 1) * 0.32;
      });

      if (this.victim.visible) {
        this.victim.position.y = Math.sin(T * 3) * 0.23;
        this.victim.children.forEach((c) => {
          if ((c as THREE.Mesh).userData?.isBeacon) (c as THREE.Mesh).visible = Math.sin(T * 6) > 0;
        });
      }

      if (this.siren) {
        (this.siren.material as THREE.MeshBasicMaterial).color.setHex(
          this.state !== 'IDLE' && Math.sin(T * 8) > 0 ? 0x0055ff : 0x001144
        );
      }
      if (this.flag) {
        this.flag.rotation.y = Math.sin(T * 2) * 0.3;
      }

      // boat movement
      if (this.state === 'RESCUE') {
        const dir = new THREE.Vector3().subVectors(this.targetPos, this.boat.position);
        const dist = dir.length();
        dir.normalize();
        this.boatSpeed = Math.min(this.boatSpeed + dt * 0.9, 0.55);
        this.boat.lookAt(new THREE.Vector3(this.targetPos.x, this.boat.position.y, this.targetPos.z));
        (this.wake.material as THREE.MeshBasicMaterial).opacity = Math.min((this.wake.material as THREE.MeshBasicMaterial).opacity + dt * 0.7, 0.38);
        if (dist > 3) {
          this.boat.position.addScaledVector(dir, this.boatSpeed * dt * 55);
          this.boat.position.y = Math.sin(T * 5) * 0.26;
        } else {
          this.completeRescue();
        }
      } else if (this.state === 'RETURN') {
        const home = new THREE.Vector3(0, 0, 104);
        const dir = new THREE.Vector3().subVectors(home, this.boat.position);
        const dist = dir.length();
        dir.normalize();
        this.boatSpeed = Math.min(this.boatSpeed + dt * 0.55, 0.4);
        this.boat.lookAt(new THREE.Vector3(home.x, this.boat.position.y, home.z));
        (this.wake.material as THREE.MeshBasicMaterial).opacity = Math.min((this.wake.material as THREE.MeshBasicMaterial).opacity, 0.28);
        if (dist > 2) {
          this.boat.position.addScaledVector(dir, this.boatSpeed * dt * 55);
          this.boat.position.y = Math.sin(T * 4) * 0.22;
        } else {
          this.completeMission();
        }
      } else {
        this.boat.position.y = Math.sin(T * 0.8) * 0.22;
        this.boat.rotation.z += (Math.sin(T * 0.6) * 0.022 - this.boat.rotation.z) * dt * 4;
        this.boat.rotation.x += (Math.sin(T * 0.5) * 0.012 - this.boat.rotation.x) * dt * 4;
      }

      this.cb.onTelemetry({ speed: this.boatSpeed * 12, state: this.state });
      this.updateCamera();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) (m as THREE.Material).dispose();
    });
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
