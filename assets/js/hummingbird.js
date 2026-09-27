/* =========================================================================
   Bazar Colibrí — Colibrí 3D
   El colibrí se arma con la ilustración del propio logo, separada en capas
   (ala, cuerpo, cola, aura de acuarela) y montada en 3D con Three.js:
   - Ala cercana que aletea sobre su articulación real, con estela de movimiento.
   - Ala lejana en tono más oscuro que da profundidad.
   - Cola con espirales que ondula; aura de acuarela que respira.
   - Capas a distinta profundidad: al girar se desplazan (paralaje 3D).
   Movimiento:
   - Intro: aparece en el centro sobre el fondo luminiscente.
   - Scroll: vuela entre "posadas" (data-bird en cada sección), gira hacia
     donde va, se inclina con la velocidad y deja una estela de polen.
   - Reposo: aletea en el lugar y hace pequeños "dardos" como uno real.
   - Hover en tarjetas: se acerca a "libar" la tarjeta.
   Las capas se generan con tools/split_logo.py a partir del logo.
   ========================================================================= */
// Three.js se carga DESPUÉS de pintar la página, para que el sitio aparezca rápido
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const LAYERS_URL = 'assets/img/bird/';
let THREE;

const PALETTE = {
  magenta: 0xff1ed2,
  blue: 0x1e1edb,
  violet: 0xba20d9,
  cyan: 0x19e6ff,
  yellow: 0xffe14d,
  lime: 0x39ff88,
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
  const boot = async () => {
    try {
      THREE = await import(THREE_URL);
      const meta = await fetch(LAYERS_URL + 'bird.json').then((r) => r.json());
      const loader = new THREE.TextureLoader();
      const names = ['aura', 'tail', 'body', 'wing'];
      const tex = await Promise.all(names.map((n) => loader.loadAsync(LAYERS_URL + n + '.webp')));
      const textures = Object.fromEntries(names.map((n, i) => [n, tex[i]]));
      init(meta, textures);
    } catch (e) {
      document.documentElement.classList.add('no-webgl');
    }
  };
  const later = () => ('requestIdleCallback' in window ? requestIdleCallback(boot, { timeout: 1200 }) : setTimeout(boot, 200));
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}

function init(meta, textures) {
  /* ---------- Renderer / escena / cámara ---------- */
  const small = window.innerWidth < 760;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !small, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 2));
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

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

  /* ---------- Colibrí: capas del logo en 3D ---------- */
  // 1 unidad de mundo ≈ 190 px del logo; origen en el centro del ave
  const PX = 1 / 190;
  const [CX, CY] = meta.center;
  const toWorld = (x, y) => new THREE.Vector2((x - CX) * PX, -(y - CY) * PX);

  const bird = new THREE.Group();       // posición/escala en pantalla
  const heading = new THREE.Group();    // giro hacia la dirección de vuelo
  const model = new THREE.Group();      // actitud (cabeceo, balanceo)
  bird.add(heading);
  heading.add(model);
  scene.add(bird);

  Object.values(textures).forEach((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
  });

  let order = 0;
  // Crea el plano de una capa. Si se pasa un pivote (en px del logo), la capa
  // queda colgando de ese punto para poder rotarla sobre él.
  function layer(name, z, { pivot, tint, opacity = 1, blending } = {}) {
    const L = meta.layers[name];
    const mat = new THREE.MeshBasicMaterial({
      map: textures[name],
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      color: tint ?? 0xffffff,
      blending: blending ?? THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L.w * PX, L.h * PX), mat);
    const c = toWorld(L.x + L.w / 2, L.y + L.h / 2);
    const group = new THREE.Group();
    if (pivot) {
      const p = toWorld(pivot[0], pivot[1]);
      group.position.set(p.x, p.y, z);
      mesh.position.set(c.x - p.x, c.y - p.y, 0);
    } else {
      group.position.set(0, 0, z);
      mesh.position.set(c.x, c.y, 0);
    }
    mesh.renderOrder = order++;
    group.add(mesh);
    model.add(group);
    return group;
  }

  // Halo luminoso detrás del ave
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: PALETTE.magenta, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  halo.scale.set(5.2, 5.2, 1);
  halo.position.set(-0.4, 0.3, -0.8);
  halo.renderOrder = order++;
  heading.add(halo);
  const halo2 = new THREE.Sprite(halo.material.clone());
  halo2.material.color.set(PALETTE.cyan);
  halo2.scale.set(3.4, 3.4, 1);
  halo2.position.set(1.0, 0.1, -0.7);
  halo2.renderOrder = order++;
  heading.add(halo2);

  // Orden de atrás hacia adelante
  const aura = layer('aura', -0.5, { opacity: 0.7 });
  const wingFar = layer('wing', -0.18, { pivot: meta.wingHinge, tint: 0x8c7ad6, opacity: 0.9 });
  const tail = layer('tail', -0.08, { pivot: meta.tailRoot });
  layer('body', 0);
  const wingGhost = layer('wing', 0.06, { pivot: meta.wingHinge, opacity: 0.22, blending: THREE.AdditiveBlending });
  const wingNear = layer('wing', 0.1, { pivot: meta.wingHinge });

  // Ala lejana: un poco más atrás y abierta hacia el lomo, como en 3/4
  wingFar.children[0].position.x += 0.12;
  wingFar.scale.setScalar(0.9);
  wingFar.rotation.z = -0.22;

  // Eje de aleteo: la línea de la raíz del ala (en el plano de la imagen)
  const axis = new THREE.Vector3(meta.wingAxis[0], -meta.wingAxis[1], 0).normalize();
  const qFlap = new THREE.Quaternion();
  const qSweep = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  function setWing(group, lift, sweep, baseZ = 0) {
    qFlap.setFromAxisAngle(axis, lift);
    qSweep.setFromAxisAngle(Z, baseZ + sweep);
    group.quaternion.copy(qSweep).multiply(qFlap);
  }

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
  trail.renderOrder = -1;
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
      // mantiene la pose en la primera parte y vuela en la segunda
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
    // se posa junto a la esquina superior exterior, mirando hacia la tarjeta
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
  let face = 1;      // 1 = mira a la derecha, -1 = izquierda (se anima al girar)
  const dart = new THREE.Vector2();
  const dartTarget = new THREE.Vector2();
  let nextDart = 0;
  let intro = 0;     // 0→1 animación de aparición
  const bornAt = performance.now();
  let lastScroll = window.scrollY;
  let scrollVel = 0;

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  const tailWorld = new THREE.Vector3();
  const tailLocal = toWorld(430, 760);
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

    // Hacia dónde mira: dirección de vuelo si se mueve rápido; si no, la pose.
    // El giro se hace volteando en X con una rotación 3D intermedia, así las
    // capas conservan su orden (el ala cercana sigue adelante).
    const speed = vel.length() / Math.max(viewH, 0.001);
    let wantFace = target.face;
    if (Math.abs(vel.x) / viewW > 0.25) wantFace = Math.sign(vel.x);
    face = SNAP ? wantFace : THREE.MathUtils.lerp(face, wantFace, 1 - Math.exp(-dt * 5));
    const sgn = face >= 0 ? 1 : -1;
    heading.scale.x = sgn * Math.max(Math.abs(face), 0.08);
    heading.rotation.y = (1 - Math.abs(face)) * 0.9 * sgn;

    // Actitud: cabeceo con velocidad, balanceo, mirada al cursor en la intro
    const inHero = sy < window.innerHeight * 0.5 && !visit;
    const lookX = inHero ? mouse.x * 0.22 : 0;
    const lookY = inHero ? mouse.y * 0.15 : 0;
    const pitch = THREE.MathUtils.clamp(-vel.y / viewH * 0.5, -0.4, 0.4);
    const forward = THREE.MathUtils.clamp(speed * 0.3, 0, 0.35);
    model.rotation.x = Math.sin(t * 1.3) * 0.06 - lookY;
    model.rotation.y = lookX * sgn + Math.sin(t * 0.7) * (inHero ? 0.2 : 0.1);
    model.rotation.z = pitch - forward + Math.sin(t * 1.9) * 0.03;

    // Aleteo: rápido, con más energía al viajar. El ala gira sobre la línea de
    // su raíz (se escorza en perspectiva) y barre un poco hacia atrás.
    const flapHz = reduceMotion ? 1.5 : 7 + Math.min(speed * 4, 5) + target.travel * 4;
    const phase = t * flapHz * Math.PI * 2;
    const s = Math.sin(phase);
    const lift = -0.15 + s * 0.85;
    const sweep = Math.cos(phase) * 0.12;
    setWing(wingNear, lift, sweep);
    setWing(wingGhost, -0.15 + Math.sin(phase - 0.9) * 0.85, Math.cos(phase - 0.9) * 0.12);
    setWing(wingFar, -lift * 0.8, -sweep, -0.22);
    wingGhost.children[0].material.opacity = 0.12 + Math.abs(Math.cos(phase)) * 0.18;

    // Cola y aura
    tail.rotation.z = Math.sin(t * 2.2) * 0.07 + pitch * 0.3;
    tail.rotation.y = Math.sin(t * 1.6) * 0.18;
    aura.scale.setScalar(1 + Math.sin(t * 1.1) * 0.03);
    aura.children[0].material.opacity = (0.6 + Math.sin(t * 1.7) * 0.1) * introEase;

    // Halos respiran
    halo.material.opacity = (0.36 + Math.sin(t * 1.7) * 0.1) * introEase * (inHero ? 1 : 0.7);
    halo2.material.opacity = (0.24 + Math.sin(t * 2.3 + 1) * 0.08) * introEase;

    // Estela: más polen mientras vuela
    tailWorld.set(tailLocal.x, tailLocal.y, 0);
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
