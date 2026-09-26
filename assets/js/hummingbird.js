/* =========================================================================
   Bazar Colibrí — Colibrí 3D
   Un colibrí construido 100% en código (sin modelos externos) con Three.js.
   - Intro: aparece en el centro sobre el fondo luminiscente.
   - Scroll: vuela entre "posadas" (data-bird en cada sección), gira hacia
     donde va, se inclina con la velocidad y deja una estela de polen.
   - Reposo: aletea en el lugar y hace pequeños "dardos" como uno real.
   - Hover en tarjetas: se acerca a "libar" la tarjeta.
   ========================================================================= */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const PALETTE = {
  magenta: 0xff1ed2,
  blue: 0x1e1edb,
  violet: 0xba20d9,
  cyan: 0x19e6ff,
  yellow: 0xffe14d,
  lime: 0x39ff88,
  orange: 0xff5a36,
  navy: 0x0d0b52,
};

const canvas = document.getElementById('bird-canvas');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// ?snap: coloca el ave directo en su posada (útil para capturas / equipos lentos)
const SNAP = new URLSearchParams(location.search).has('snap');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

if (!canvas || !webglAvailable()) {
  document.documentElement.classList.add('no-webgl');
} else {
  init();
}

function init() {
  /* ---------- Renderer / escena / cámara ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  // Altura visible del plano z=0 (para convertir coordenadas de pantalla a mundo)
  let viewH = 1, viewW = 1;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    viewW = viewH * camera.aspect;
    rebuildAnchors();
  }

  /* ---------- Luces: tempestad de color ---------- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2, 4, 6);
  scene.add(key);
  const rimMagenta = new THREE.PointLight(PALETTE.magenta, 40, 20, 2);
  rimMagenta.position.set(-4, 2, 2);
  scene.add(rimMagenta);
  const rimCyan = new THREE.PointLight(PALETTE.cyan, 35, 20, 2);
  rimCyan.position.set(4, -1, 3);
  scene.add(rimCyan);
  const back = new THREE.PointLight(PALETTE.violet, 30, 20, 2);
  back.position.set(0, 1, -4);
  scene.add(back);

  /* ---------- Utilidades ---------- */
  const tmpColor = new THREE.Color();
  function gradientColors(geometry, stops, axis = 'y', min, max) {
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const idx = { x: 0, y: 1, z: 2 }[axis];
    if (min === undefined || max === undefined) {
      geometry.computeBoundingBox();
      min = geometry.boundingBox.min.getComponent(idx);
      max = geometry.boundingBox.max.getComponent(idx);
    }
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getComponent(i, idx) - min) / (max - min || 1), 0, 1);
      sampleStops(stops, t, tmpColor);
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const cA = new THREE.Color(), cB = new THREE.Color();
  function sampleStops(stops, t, out) {
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t >= t0 && t <= t1) {
        const k = (t - t0) / (t1 - t0 || 1);
        cA.set(c0); cB.set(c1);
        return out.copy(cA).lerp(cB, k);
      }
    }
    return out.set(stops[stops.length - 1][1]);
  }

  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const glowTex = glowTexture();

  /* ---------- Construcción del colibrí ---------- */
  const bird = new THREE.Group();       // posición/escala en pantalla
  const heading = new THREE.Group();    // giro hacia la dirección de vuelo
  const model = new THREE.Group();      // actitud (cabeceo, balanceo)
  bird.add(heading);
  heading.add(model);
  scene.add(bird);

  const iridescent = (opts = {}) => new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.28,
    metalness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
    iridescence: 1,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 600],
    ...opts,
  });

  // Cuerpo: torpedo con torno (Lathe) orientado hacia +X (cabeza)
  const profile = [
    [0.001, -1.05], [0.08, -0.95], [0.2, -0.75], [0.33, -0.45], [0.42, -0.12],
    [0.45, 0.15], [0.41, 0.4], [0.3, 0.62], [0.16, 0.74], [0.001, 0.78],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bodyGeo = new THREE.LatheGeometry(profile, 48);
  bodyGeo.rotateZ(-Math.PI / 2);
  bodyGeo.scale(1, 1, 0.88);
  gradientColors(bodyGeo, [
    [0, PALETTE.lime], [0.35, PALETTE.cyan], [0.62, 0x2d5bff], [1, PALETTE.blue],
  ], 'y', -0.45, 0.45);
  const body = new THREE.Mesh(bodyGeo, iridescent());
  model.add(body);

  // Cabeza
  const headGeo = new THREE.SphereGeometry(0.34, 40, 28);
  gradientColors(headGeo, [[0, PALETTE.cyan], [0.45, 0x2d5bff], [1, PALETTE.blue]], 'y');
  const head = new THREE.Mesh(headGeo, iridescent());
  head.position.set(0.86, 0.16, 0);
  model.add(head);

  // Garganta brillante (gorguera)
  const gorgetGeo = new THREE.SphereGeometry(0.3, 32, 20, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4);
  gradientColors(gorgetGeo, [[0, PALETTE.lime], [1, PALETTE.cyan]], 'y');
  const gorget = new THREE.Mesh(gorgetGeo, iridescent({ emissive: 0x0a5a55, emissiveIntensity: 0.6 }));
  gorget.position.set(0.74, 0.02, 0);
  gorget.rotation.z = 0.5;
  model.add(gorget);

  // Pico largo y fino
  const beakGeo = new THREE.ConeGeometry(0.05, 1.25, 16);
  beakGeo.rotateZ(-Math.PI / 2);
  gradientColors(beakGeo, [[0, 0x2a2acf], [1, PALETTE.navy]], 'x');
  const beak = new THREE.Mesh(beakGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5, clearcoat: 1 }));
  beak.position.set(1.72, 0.1, 0);
  beak.rotation.z = -0.1;
  model.add(beak);

  // Ojos con brillo
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1 });
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeRingMat = new THREE.MeshBasicMaterial({ color: 0xe8f7ff });
  [-1, 1].forEach((s) => {
    const ring = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), eyeRingMat);
    ring.position.set(1.0, 0.24, s * 0.235);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.072, 20, 14), eyeMat);
    eye.position.set(1.005, 0.24, s * 0.255);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), sparkMat);
    spark.position.set(1.03, 0.27, s * 0.315);
    model.add(ring, eye, spark);
  });

  // Plumas: forma de hoja con degradado (verde → amarillo → rojo → magenta)
  function featherGeometry(length, width, stops) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(width * 0.65, length * 0.18, width * 0.6, length * 0.78, 0, length);
    s.bezierCurveTo(-width * 0.5, length * 0.8, -width * 0.55, length * 0.2, 0, 0);
    const g = new THREE.ShapeGeometry(s, 14);
    gradientColors(g, stops, 'y', 0, length);
    return g;
  }
  const featherMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.1,
    iridescence: 0.25,
    iridescenceIOR: 1.3,
    emissive: 0x2a0020,
    emissiveIntensity: 0.3,
  });

  function buildWing(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.18, 0.3, side * 0.2);
    const plane = new THREE.Group();
    // Plano local XY → X = envergadura (±Z mundo), Y = cuerda (X mundo), normal → Y mundo
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, side),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, side, 0),
    );
    plane.quaternion.setFromRotationMatrix(m);
    pivot.add(plane);

    const primaryStops = [
      [0, PALETTE.lime], [0.22, PALETTE.yellow], [0.45, PALETTE.orange], [0.62, PALETTE.magenta], [1, 0xff4fe0],
    ];
    const N = 11;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const len = THREE.MathUtils.lerp(0.62, 1.75, Math.pow(t, 0.8));
      const geo = featherGeometry(len, THREE.MathUtils.lerp(0.2, 0.26, t), primaryStops);
      const f = new THREE.Mesh(geo, featherMat);
      const angle = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-100, -12, t)); // desde la envergadura, hacia atrás
      f.rotation.z = angle - Math.PI / 2;
      f.position.set(0.06 + 0.5 * t, -0.02 * t, i * 0.004);
      plane.add(f);
    }
    // Coberteras: plumas cortas verde/cian sobre la base
    const covertStops = [[0, PALETTE.cyan], [0.6, PALETTE.lime], [1, PALETTE.yellow]];
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const geo = featherGeometry(THREE.MathUtils.lerp(0.35, 0.55, t), 0.2, covertStops);
      const f = new THREE.Mesh(geo, featherMat);
      f.rotation.z = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-105, -40, t)) - Math.PI / 2;
      f.position.set(0.02 + 0.42 * t, 0.02, 0.06 + i * 0.003);
      plane.add(f);
    }
    return pivot;
  }
  const wingR = buildWing(1);
  const wingL = buildWing(-1);
  model.add(wingR, wingL);

  // Cola: plumas en abanico + dos serpentinas con espirales (como el logo)
  const tail = new THREE.Group();
  tail.position.set(-0.95, -0.02, 0);
  model.add(tail);
  const tailStops = [[0, PALETTE.blue], [0.4, PALETTE.violet], [1, PALETTE.magenta]];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const geo = featherGeometry(THREE.MathUtils.lerp(0.8, 1.05, Math.sin(t * Math.PI)), 0.22, tailStops);
    const f = new THREE.Mesh(geo, featherMat);
    f.rotation.set(0, THREE.MathUtils.lerp(-0.5, 0.5, t), Math.PI / 2 + 0.25);
    tail.add(f);
  }

  function curlCurve(len, drop, z, turns, radius) {
    const pts = [];
    pts.push(new THREE.Vector3(0, 0, 0));
    pts.push(new THREE.Vector3(-len * 0.3, -drop * 0.25, z * 0.3));
    pts.push(new THREE.Vector3(-len * 0.65, -drop * 0.8, z * 0.7));
    const cx = -len, cy = -drop + radius;
    // espiral hacia adentro
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 - (i / steps) * Math.PI * 2 * turns;
      const r = radius * (1 - (i / steps) * 0.75);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r * -1, cy + Math.sin(a) * r, z));
    }
    return new THREE.CatmullRomCurve3(pts);
  }
  const streamers = [];
  [
    { len: 2.1, drop: 0.9, z: 0.12, turns: 1.3, r: 0.28, stops: [[0, PALETTE.violet], [0.6, PALETTE.magenta], [1, PALETTE.cyan]] },
    { len: 1.7, drop: 0.45, z: -0.12, turns: 1.15, r: 0.22, stops: [[0, PALETTE.blue], [0.5, PALETTE.violet], [1, PALETTE.yellow]] },
  ].forEach((cfg) => {
    const geo = new THREE.TubeGeometry(curlCurve(cfg.len, cfg.drop, cfg.z, cfg.turns, cfg.r), 160, 0.024, 8, false);
    // degradado a lo largo del tubo (u)
    const uv = geo.attributes.uv;
    const colors = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) {
      sampleStops(cfg.stops, uv.getX(i), tmpColor);
      colors.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.3, emissive: 0x330044, emissiveIntensity: 0.8, clearcoat: 1,
    }));
    tail.add(mesh);
    streamers.push(mesh);
  });

  // Halo luminoso detrás del ave
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: PALETTE.magenta, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(5.5, 5.5, 1);
  halo.position.set(-0.2, 0.2, -0.8);
  heading.add(halo);
  const halo2 = halo.clone();
  halo2.material = halo.material.clone();
  halo2.material.color.set(PALETTE.cyan);
  halo2.material.opacity = 0.35;
  halo2.scale.set(3.5, 3.5, 1);
  halo2.position.set(0.9, -0.2, -0.6);
  heading.add(halo2);

  // Pose base del modelo: vista 3/4 para que se lea como el logo
  model.rotation.set(0.35, -0.35, 0.28);

  /* ---------- Estela de polen / partículas ---------- */
  const TRAIL = 420;
  const trailGeo = new THREE.BufferGeometry();
  const tPos = new Float32Array(TRAIL * 3);
  const tCol = new Float32Array(TRAIL * 3);
  const tVel = new Float32Array(TRAIL * 3);
  const tLife = new Float32Array(TRAIL);
  const tSize = new Float32Array(TRAIL);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  trailGeo.setAttribute('size', new THREE.BufferAttribute(tSize, 1));
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTex }, pixelRatio: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float size; attribute vec3 color; varying vec3 vColor;
      uniform float pixelRatio;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * pixelRatio * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; varying vec3 vColor;
      void main(){
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, 1.0) * t;
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const trail = new THREE.Points(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);
  const trailColors = [PALETTE.magenta, PALETTE.cyan, PALETTE.yellow, PALETTE.violet, PALETTE.lime, 0xffffff].map((c) => new THREE.Color(c));
  let trailHead = 0;
  function emit(pos, spread, speed, count, sizeBase) {
    for (let n = 0; n < count; n++) {
      const i = trailHead;
      trailHead = (trailHead + 1) % TRAIL;
      tPos[i * 3] = pos.x + (Math.random() - 0.5) * spread;
      tPos[i * 3 + 1] = pos.y + (Math.random() - 0.5) * spread;
      tPos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      tVel[i * 3] = Math.cos(a) * speed;
      tVel[i * 3 + 1] = Math.sin(a) * speed - 0.05;
      tVel[i * 3 + 2] = (Math.random() - 0.5) * speed;
      const c = trailColors[(Math.random() * trailColors.length) | 0];
      tCol.set([c.r, c.g, c.b], i * 3);
      tLife[i] = 1;
      tSize[i] = sizeBase * (0.5 + Math.random());
    }
  }

  /* ---------- Posadas (waypoints) desde el DOM ---------- */
  const isMobile = () => window.innerWidth < 760;
  let anchors = [];
  function parsePose(str) {
    const [x, y, s, face] = str.split(',').map(Number);
    return { x, y, s, face: face || 1 };
  }
  function rebuildAnchors() {
    const sections = [...document.querySelectorAll('[data-bird]')];
    anchors = sections.map((el) => {
      const pose = parsePose(isMobile() && el.dataset.birdMobile ? el.dataset.birdMobile : el.dataset.bird);
      const top = el.getBoundingClientRect().top + window.scrollY;
      return { at: Math.max(0, top - window.innerHeight * 0.45), pose };
    });
    anchors.sort((a, b) => a.at - b.at);
  }

  const smooth = (t) => t * t * (3 - 2 * t);
  function targetFromScroll(y) {
    if (!anchors.length) return { x: 0, y: 0, s: 1, face: 1, travel: 0 };
    if (y <= anchors[0].at) return { ...anchors[0].pose, travel: 0 };
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      // mantiene la pose en la primera mitad y vuela en la segunda
      const start = a.at + (b.at - a.at) * 0.35;
      if (y < b.at) {
        if (y < start) return { ...a.pose, travel: 0 };
        const t = smooth((y - start) / (b.at - start));
        const arc = Math.sin(t * Math.PI);
        return {
          x: THREE.MathUtils.lerp(a.pose.x, b.pose.x, t),
          y: THREE.MathUtils.lerp(a.pose.y, b.pose.y, t) + arc * 0.12,
          s: THREE.MathUtils.lerp(a.pose.s, b.pose.s, t) * (1 + arc * 0.15),
          face: t < 0.5 ? a.pose.face : b.pose.face,
          travel: arc,
        };
      }
    }
    return { ...anchors[anchors.length - 1].pose, travel: 0 };
  }

  /* ---------- Visitas a tarjetas (hover) ---------- */
  let visit = null;
  document.querySelectorAll('[data-bird-visit]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      if (isMobile()) return;
      visit = el;
    });
    el.addEventListener('mouseleave', () => {
      if (visit === el) visit = null;
    });
  });
  function visitPose(el) {
    const r = el.getBoundingClientRect();
    const onRight = r.left + r.width / 2 > window.innerWidth / 2;
    // se posa sobre la esquina superior exterior, mirando hacia la tarjeta
    const px = onRight ? r.left - 10 : r.right + 10;
    const py = r.top + 20;
    return {
      x: px / window.innerWidth - 0.5,
      y: 0.5 - py / window.innerHeight,
      s: 0.26,
      face: onRight ? 1 : -1,
      travel: 0,
    };
  }

  /* ---------- Mouse (la mirada sigue al cursor en la intro) ---------- */
  const mouse = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }, { passive: true });

  /* ---------- Estado dinámico ---------- */
  const pos = new THREE.Vector3(0, -viewH, 0); // entra desde abajo
  const vel = new THREE.Vector3();
  let scale = 0.001;
  let yaw = 0;       // 0 = mira a la derecha, PI = izquierda
  let dart = new THREE.Vector2();
  let dartTarget = new THREE.Vector2();
  let nextDart = 0;
  let intro = 0;     // 0→1 animación de aparición
  const bornAt = performance.now();
  let lastScroll = window.scrollY;
  let scrollVel = 0;

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  const tailWorld = new THREE.Vector3();
  let running = true;

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); loop(); }
  });

  window.addEventListener('resize', resize);
  window.addEventListener('load', rebuildAnchors);
  new ResizeObserver(rebuildAnchors).observe(document.body);
  resize();

  // Explosión de partículas al aparecer
  setTimeout(() => {
    for (let i = 0; i < 6; i++) emit(new THREE.Vector3(0, 0, 0), 1.5, 1.6, 40, 0.35);
    document.documentElement.classList.add('bird-ready');
  }, 250);

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // intro por reloj real (no depende de los FPS)
    intro = Math.min(1, (performance.now() - bornAt) / 1600);
    const introEase = 1 - Math.pow(1 - intro, 3);

    // Velocidad de scroll (suavizada)
    const sy = window.scrollY;
    scrollVel = THREE.MathUtils.lerp(scrollVel, (sy - lastScroll) / Math.max(dt, 0.001), 0.15);
    lastScroll = sy;

    // Objetivo
    let target = visit ? visitPose(visit) : targetFromScroll(sy);
    if (reduceMotion) target = { ...target, travel: 0 };

    // Dardos de reposo: pequeños saltos aleatorios como un colibrí real
    if (t > nextDart) {
      const r = target.s > 0.6 ? 0.03 : 0.022;
      dartTarget.set((Math.random() - 0.5) * r * 2, (Math.random() - 0.5) * r * 2);
      nextDart = t + 1.4 + Math.random() * 2.2;
    }
    dart.lerp(dartTarget, 1 - Math.exp(-dt * 6));

    const tx = (target.x + (visit ? 0 : dart.x)) * viewW;
    const ty = (target.y + (visit ? 0 : dart.y)) * viewH + Math.sin(t * 2.4) * 0.04 * viewH * target.s * 0.4;

    // Resorte: el ave "vuela" hacia el objetivo
    const stiffness = visit ? 55 : 28;
    const damping = visit ? 12 : 9;
    tmp.set(tx, ty, 0).sub(pos).multiplyScalar(stiffness);
    tmp.addScaledVector(vel, -damping);
    vel.addScaledVector(tmp, dt);
    pos.addScaledVector(vel, dt);
    if (intro < 1) pos.lerp(new THREE.Vector3(tx, ty, 0), introEase * 0.08);

    // Escala relativa a la altura de la pantalla
    const baseScale = (viewH / 6.3) * target.s * 0.95;
    scale = THREE.MathUtils.lerp(scale, baseScale * introEase, intro < 1 ? 1 : 1 - Math.exp(-dt * 5));
    if (SNAP) { pos.set(tx, ty, 0); vel.set(0, 0, 0); scale = baseScale; }
    bird.position.copy(pos);
    bird.scale.setScalar(Math.max(scale, 0.0001));

    // Hacia dónde mira: dirección de vuelo si se mueve rápido; si no, la pose
    const speed = vel.length() / Math.max(viewH, 0.001);
    let wantFace = target.face;
    if (Math.abs(vel.x) / viewW > 0.25) wantFace = Math.sign(vel.x);
    const wantYaw = wantFace > 0 ? 0 : Math.PI;
    yaw = SNAP ? wantYaw : THREE.MathUtils.lerp(yaw, wantYaw, 1 - Math.exp(-dt * 4));
    heading.rotation.y = yaw;

    // Actitud: cabeceo con velocidad, balanceo, mirada al cursor en la intro
    const inHero = sy < window.innerHeight * 0.5 && !visit;
    const lookX = inHero ? mouse.x * 0.35 : 0;
    const lookY = inHero ? mouse.y * 0.25 : 0;
    const pitch = THREE.MathUtils.clamp(-vel.y / viewH * 0.6, -0.6, 0.6);
    const forward = THREE.MathUtils.clamp(speed * 0.35, 0, 0.5);
    model.rotation.x = 0.35 + Math.sin(t * 1.3) * 0.06 + lookY * 0.3;
    model.rotation.y = -0.35 + lookX * (wantFace > 0 ? 1 : -1) + Math.sin(t * 0.7) * (inHero ? 0.18 : 0.06);
    model.rotation.z = 0.28 + pitch - forward + Math.sin(t * 1.9) * 0.04;

    // Aleteo: rápido, en ocho, con más energía al viajar
    const flapHz = reduceMotion ? 2 : 9 + Math.min(speed * 4, 5) + target.travel * 4;
    const phase = t * flapHz * Math.PI * 2;
    const lift = 0.35 + Math.sin(phase) * 0.95;
    const sweep = Math.cos(phase) * 0.25;
    wingR.rotation.set(-lift, sweep, Math.sin(phase + 0.6) * 0.2);
    wingL.rotation.set(lift, -sweep, -Math.sin(phase + 0.6) * 0.2);

    // Cola y serpentinas ondulan
    tail.rotation.z = Math.sin(t * 2.2) * 0.08 + pitch * 0.4;
    tail.rotation.y = Math.sin(t * 1.6) * 0.1;
    streamers.forEach((m, i) => { m.rotation.x = Math.sin(t * 2 + i) * 0.12; });

    // Halos respiran
    halo.material.opacity = (0.4 + Math.sin(t * 1.7) * 0.12) * introEase * (inHero ? 1 : 0.7);
    halo2.material.opacity = (0.28 + Math.sin(t * 2.3 + 1) * 0.1) * introEase;

    // Luces en tormenta: giran alrededor
    rimMagenta.position.set(pos.x + Math.cos(t * 0.6) * 4, pos.y + 2, 2 + Math.sin(t * 0.6) * 2);
    rimCyan.position.set(pos.x + Math.cos(t * 0.6 + Math.PI) * 4, pos.y - 1, 3);

    // Estela: más polen mientras vuela
    tailWorld.set(-1.2, -0.3, 0);
    model.localToWorld(tailWorld);
    const emitCount = reduceMotion ? 0 : Math.min(6, Math.round(speed * 2.5 + (inHero ? 0.6 : 0.25) + Math.abs(scrollVel) / 900));
    if (emitCount > 0 && Math.random() < 0.9) emit(tailWorld, 0.15 * scale * 3, 0.25, emitCount, 0.12 + scale * 0.12);
    for (let i = 0; i < TRAIL; i++) {
      if (tLife[i] <= 0) continue;
      tLife[i] -= dt * 0.9;
      tPos[i * 3] += tVel[i * 3] * dt;
      tPos[i * 3 + 1] += tVel[i * 3 + 1] * dt;
      tPos[i * 3 + 2] += tVel[i * 3 + 2] * dt;
      tVel[i * 3] *= 0.97; tVel[i * 3 + 1] *= 0.97; tVel[i * 3 + 2] *= 0.97;
      if (tLife[i] <= 0) tSize[i] = 0;
      else tSize[i] *= 0.992;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    trailGeo.attributes.size.needsUpdate = true;

    renderer.render(scene, camera);
  }
  loop();
}
