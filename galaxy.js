// Cosmic Galaxy — made by @hack.n.code
// Three.js + custom GLSL shaders. Drag = orbit, wheel/pinch = zoom, tap = supernova.
import * as THREE from 'three';

const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has('capture');
const isMobile = matchMedia('(pointer:coarse)').matches || innerWidth < 760;

// ---------- seeded random (same galaxy every load) ----------
let seed = +(Q.get('seed') || 25102026);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
const DPR = Math.min(devicePixelRatio || 1, isMobile ? 1.75 : 2);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

// ---------- galaxy parameters ----------
const P = {
  count: CAPTURE ? 55000 : (isMobile ? 26000 : 70000),
  radius: 10, arms: 4, spin: 1.15, scatter: 0.42,
  inner: new THREE.Color('#ffd9a0'), mid: new THREE.Color('#ff6fae'), outer: new THREE.Color('#5a7dff')
};
document.getElementById('stat').textContent = P.count.toLocaleString('en-US') + ' stars · live';

const MAX_BLASTS = 6;
const blasts = Array.from({ length: MAX_BLASTS }, () => new THREE.Vector4(0, 0, 0, -999));

// shared shader chunk: differential rotation + supernova shockwave
const common = /* glsl */`
  uniform float uTime; uniform float uSize; uniform float uScale;
  uniform vec4 uBlast[${MAX_BLASTS}];
  attribute float aSize; attribute vec3 aColor; attribute float aSeed;
  varying vec3 vColor; varying float vBoost;
  vec3 orbit(vec3 p){
    float r = length(p.xz);
    float w = 0.11 / sqrt(r * 0.35 + 0.25);          // inner stars orbit faster
    float a = uTime * w;
    float c = cos(a), s = sin(a);
    return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  }
  vec3 shock(vec3 p, out float boost){
    boost = 0.0;
    for(int i = 0; i < ${MAX_BLASTS}; i++){
      float age = uTime - uBlast[i].w;
      if(age < 0.0 || age > 4.0) continue;
      vec3 d = p - uBlast[i].xyz;
      float dist = length(d) + 1e-4;
      float waveR = age * 6.5;
      float ring = exp(-pow((dist - waveR) / 0.9, 2.0));
      float fade = exp(-age * 1.1);
      p += d / dist * ring * fade * 1.25;
      boost += ring * fade * 1.6 + exp(-dist * 2.0) * exp(-age * 3.0) * 1.2;
    }
    return p;
  }`;

const starVS = /* glsl */`${common}
  void main(){
    vec3 p = orbit(position);
    float b; p = shock(p, b);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.85 + 0.15 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
    gl_PointSize = clamp(aSize * uSize * tw * (1.0 + b * 0.6) * uScale / -mv.z, 1.0, 64.0);
    vColor = aColor; vBoost = b;
  }`;
const starFS = /* glsl */`
  varying vec3 vColor; varying float vBoost; uniform float uAlpha;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float core = exp(-d * d * 90.0);
    float halo = exp(-d * d * 14.0) * 0.32;
    float a = (core + halo) * uAlpha;
    vec3 col = mix(vColor, vec3(1.0), core * 0.55) + vec3(0.6, 0.75, 1.0) * vBoost * 0.35;
    gl_FragColor = vec4(col * a, a);
  }`;
const nebFS = /* glsl */`
  varying vec3 vColor; varying float vBoost; uniform float uAlpha;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d); a = a * a * uAlpha;
    gl_FragColor = vec4(vColor * a * (1.0 + vBoost * 0.5), a);
  }`;

const uniforms = {
  uTime: { value: 0 }, uSize: { value: 1 }, uScale: { value: innerHeight * DPR * 0.075 },
  uBlast: { value: blasts }, uAlpha: { value: 1 }
};

function makePoints(n, gen, fs, alpha, sizeMul) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), sd = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    gen(i, pos, c, size);
    col.set([c.r, c.g, c.b], i * 3); sd[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlpha: { value: alpha }, uSize: { value: sizeMul } },
    vertexShader: starVS, fragmentShader: fs,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false;
  return pts;
}

// arm stars
function armStar(i, pos, c, size, nebula) {
  const R = P.radius;
  const r = Math.pow(rand(), nebula ? 1.0 : 1.5) * R + 0.15;
  const branch = ((i % P.arms) / P.arms) * Math.PI * 2;
  const spinA = r * P.spin;
  const sc = P.scatter * (nebula ? 0.7 : 1) * (0.35 + r / R);
  const x = Math.cos(branch + spinA) * r + gauss() * sc * 0.9;
  const z = Math.sin(branch + spinA) * r + gauss() * sc * 0.9;
  const y = gauss() * (0.06 + 0.32 * Math.exp(-r * 0.45)) * (nebula ? 0.5 : 1);
  pos.set([x, y, z], i * 3);
  const t = r / R;
  if (t < 0.35) c.copy(P.inner).lerp(P.mid, t / 0.35); else c.copy(P.mid).lerp(P.outer, (t - 0.35) / 0.65);
  if (!nebula && rand() < 0.06) c.set(rand() < 0.5 ? '#ffffff' : '#9fd8ff');
  if (!nebula && rand() < 0.025 && t > 0.25) c.set('#ff4f9a');                // pink star-forming knots
  size[i] = nebula ? 9 + rand() * 14 : (rand() < 0.015 ? 3.2 + rand() * 2.5 : 0.7 + Math.pow(rand(), 3) * 1.8);
}
function coreStar(i, pos, c, size) {
  const r = Math.abs(gauss()) * 0.9;
  const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
  pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.45, r * Math.sin(ph) * Math.sin(th)], i * 3);
  c.set('#ffe2b0').lerp(new THREE.Color('#ffffff'), rand() * 0.5);
  size[i] = 0.6 + rand() * 1.2;
}
const galaxy = new THREE.Group(); scene.add(galaxy);
galaxy.add(makePoints(P.count, (i, p, c, s) => armStar(i, p, c, s, false), starFS, 0.95, 1.0));
galaxy.add(makePoints(Math.round(P.count * 0.06), coreStar, starFS, 0.35, 1.0));
galaxy.add(makePoints(isMobile && !CAPTURE ? 260 : 420, (i, p, c, s) => { armStar(i, p, c, s, true); c.multiplyScalar(0.55); }, nebFS, 0.10, 1.0));
galaxy.rotation.z = 0.12;

// glowing core sprite
function glowTex(stops) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex([[0, 'rgba(255,240,215,1)'], [0.12, 'rgba(255,200,140,.75)'], [0.35, 'rgba(255,110,170,.22)'], [0.7, 'rgba(110,90,255,.06)'], [1, 'rgba(0,0,0,0)']]),
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
coreGlow.scale.set(6, 6, 1); galaxy.add(coreGlow);

// distant background stars
{
  const n = isMobile && !CAPTURE ? 1500 : 3000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), r = 90 + rand() * 60;
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
    const k = 0.5 + rand() * 0.5; col.set([k * 0.8, k * 0.85, k], i * 3); sz[i] = 0.6 + rand() * 1.4; sd[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { ...uniforms, uAlpha: { value: 0.9 }, uSize: { value: 4.0 } },
    vertexShader: starVS.replace('vec3 p = orbit(position);', 'vec3 p = position;'), fragmentShader: starFS,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const bg = new THREE.Points(g, m); bg.frustumCulled = false; scene.add(bg);
}

// ---------- supernova: flash sprite + particle shockwave ----------
const flashTex = glowTex([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(200,225,255,.9)'], [0.4, 'rgba(140,120,255,.35)'], [1, 'rgba(0,0,0,0)']]);
const ringTex = glowTex([[0, 'rgba(0,0,0,0)'], [0.62, 'rgba(0,0,0,0)'], [0.8, 'rgba(255,255,255,.55)'], [0.88, 'rgba(255,255,255,1)'], [0.94, 'rgba(255,255,255,.35)'], [1, 'rgba(0,0,0,0)']]);
const ringGeo = new THREE.PlaneGeometry(1, 1);
const SN_N = isMobile && !CAPTURE ? 1400 : 2600;
const novas = [];
const novaVS = /* glsl */`
  uniform float uAge; uniform float uScale; attribute vec3 aDir; attribute float aSpeed; attribute vec3 aColor;
  varying vec3 vColor; varying float vA;
  void main(){
    float k = 1.0 - exp(-uAge * 2.2);
    vec3 p = position + aDir * aSpeed * k * 5.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = clamp(1.0 - uAge / 3.2, 0.0, 1.0);
    gl_PointSize = clamp((0.9 + 1.6 * vA) * uScale / -mv.z, 1.0, 40.0);
    vColor = aColor;
  }`;
const novaFS = /* glsl */`
  varying vec3 vColor; varying float vA;
  void main(){ float d = length(gl_PointCoord - 0.5); float a = (exp(-d*d*60.0) + exp(-d*d*10.0)*0.25) * vA * vA * 0.55;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.35) * a, a); }`;
function makeNova() {
  const pos = new Float32Array(SN_N * 3), dir = new Float32Array(SN_N * 3), sp = new Float32Array(SN_N), col = new Float32Array(SN_N * 3);
  const palette = ['#ffffff', '#ffd38a', '#ff7ab8', '#8fd3ff', '#a98bff'].map(h => new THREE.Color(h));
  for (let i = 0; i < SN_N; i++) {
    const th = rand() * Math.PI * 2;
    const flat = rand() < 0.8;
    const y = flat ? gauss() * 0.06 : (rand() * 2 - 1) * 0.7;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    dir.set([Math.cos(th) * rr, y, Math.sin(th) * rr], i * 3);
    sp[i] = flat ? 0.88 + rand() * 0.2 : 0.15 + rand() * 0.6;
    const c = palette[(rand() * palette.length) | 0]; col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({ uniforms: { uAge: { value: 99 }, uScale: uniforms.uScale },
    vertexShader: novaVS, fragmentShader: novaFS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.visible = false;
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  fl.visible = false;
  const rings = [0, 1].map(j => {
    const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, color: j ? 0x9fd8ff : 0xffc2e6,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2; r.visible = false; return r; });
  const grp = new THREE.Group(); grp.add(pts, fl, ...rings); galaxy.add(grp);
  return { grp, pts, fl, rings, age: 99 };
}
for (let i = 0; i < 4; i++) novas.push(makeNova());
let novaIdx = 0, blastIdx = 0, shake = 0;

const flashEl = document.getElementById('flash');
let flashA = 0;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmpV = new THREE.Vector3();
function supernova(cx, cy) {
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  galaxy.updateMatrixWorld();
  const inv = galaxy.matrixWorld.clone().invert();
  const o = ray.ray.origin.clone().applyMatrix4(inv), d = ray.ray.direction.clone().transformDirection(inv);
  let hit;
  if (Math.abs(d.y) > 0.02) { const t = -o.y / d.y; hit = o.clone().addScaledVector(d, t); }
  if (!hit || hit.length() > P.radius * 1.3) hit = o.clone().addScaledVector(d, o.length() * 0.9); // fallback
  if (hit.length() > P.radius * 1.3) hit.setLength(P.radius * 0.9);
  // undo differential rotation is unnecessary: blast lives in galaxy space at its tap point
  const nv = novas[novaIdx++ % novas.length];
  nv.grp.position.copy(hit); nv.age = 0; nv.pts.visible = nv.fl.visible = true;
  blasts[blastIdx++ % MAX_BLASTS].set(hit.x, hit.y, hit.z, uniforms.uTime.value);
  shake = 1; flashA = 0.85;
  flashEl.style.setProperty('--x', (cx / innerWidth * 100) + '%'); flashEl.style.setProperty('--y', (cy / innerHeight * 100) + '%');
  boom();
  hideHint();
}

// ---------- sound (muted by default, synthesized live) ----------
let actx = null, soundOn = false;
const sndBtn = document.getElementById('snd');
sndBtn.addEventListener('click', e => {
  e.stopPropagation(); soundOn = !soundOn; sndBtn.textContent = soundOn ? '🔊' : '🔇';
  if (soundOn && !actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx && actx.state === 'suspended') actx.resume();
});
sndBtn.addEventListener('pointerdown', e => e.stopPropagation());
function boom() {
  if (!soundOn || !actx) return;
  const t = actx.currentTime, out = actx.createGain(); out.gain.value = 0.55; out.connect(actx.destination);
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.2);
  g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.6); o.connect(g).connect(out); o.start(t); o.stop(t + 1.7);
  const len = actx.sampleRate * 1.8, buf = actx.createBuffer(1, len, actx.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const n = actx.createBufferSource(), f = actx.createBiquadFilter(), ng = actx.createGain();
  n.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(300, t + 1.5);
  ng.gain.value = 0.6; n.connect(f).connect(ng).connect(out); n.start(t);
}

// ---------- orbit controls (hand-rolled, inertia + pinch) ----------
const AR = innerWidth / innerHeight;
const D0 = AR < 0.5 ? 24 : AR < 0.8 ? 21 : 16;
const view = { theta: 0.6, phi: 0.82, dist: D0, vt: 0, vp: 0, td: D0 };
const ptrs = new Map(); let downAt = 0, moved = 0, pinch0 = 0, lastInteract = -10;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) { downAt = performance.now(); moved = 0; }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); moved = 99; }
  lastInteract = uniforms.uTime.value;
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) {
    moved += Math.abs(dx) + Math.abs(dy);
    view.vt = -dx * 0.0055; view.vp = -dy * 0.0045;
    view.theta += view.vt; view.phi += view.vp;
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0) view.td *= pinch0 / d; pinch0 = d;
  }
  lastInteract = uniforms.uTime.value; hideHint();
});
const up = e => {
  if (ptrs.size === 1 && moved < 8 && performance.now() - downAt < 450) supernova(e.clientX, e.clientY);
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0;
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pinch0 = 0; });
canvas.addEventListener('wheel', e => { e.preventDefault(); view.td *= Math.exp(e.deltaY * 0.0012); lastInteract = uniforms.uTime.value; hideHint(); }, { passive: false });

const hint = document.getElementById('hint');
let hintGone = false; function hideHint() { if (!hintGone) { hintGone = true; setTimeout(() => hint.classList.add('gone'), 1500); } }

// ---------- loop ----------
function step(dt) {
  uniforms.uTime.value += dt;
  const t = uniforms.uTime.value;
  // inertia + gentle auto-orbit when idle
  if (!ptrs.size) { view.theta += view.vt; view.phi += view.vp; view.vt *= Math.pow(0.05, dt); view.vp *= Math.pow(0.05, dt); }
  if (t - lastInteract > 3 && !CAPTURE) view.theta += dt * 0.05;
  view.phi = Math.min(Math.max(view.phi, 0.18), Math.PI - 0.18);
  view.td = Math.min(Math.max(view.td, 4.5), 48);
  view.dist += (view.td - view.dist) * (1 - Math.pow(0.002, dt));
  const s = shake * 0.12; shake *= Math.pow(0.02, dt);
  camera.position.set(
    view.dist * Math.sin(view.phi) * Math.sin(view.theta) + (rand() - .5) * s,
    view.dist * Math.cos(view.phi) + (rand() - .5) * s,
    view.dist * Math.sin(view.phi) * Math.cos(view.theta));
  camera.lookAt(0, 0, 0);
  galaxy.rotation.y = 0;
  coreGlow.material.opacity = 0.7 + 0.12 * Math.sin(t * 1.3);
  for (const nv of novas) {
    if (nv.age > 4) { nv.pts.visible = nv.fl.visible = false; nv.rings.forEach(r => r.visible = false); continue; }
    nv.age += dt; nv.pts.material.uniforms.uAge.value = nv.age;
    const a = nv.age, k = Math.min(1, a / 0.12);
    const sc = (0.4 + 4.5 * k) * Math.exp(-a * 1.1) + 0.15;
    nv.fl.scale.set(sc, sc, 1); nv.fl.material.opacity = Math.max(0, Math.exp(-a * 1.6));
    nv.rings.forEach((r, j) => { r.visible = true; const e = 1 - Math.exp(-a * (j ? 1.6 : 2.4));
      const R = (j ? 15 : 11) * e + 0.1; r.scale.set(R, R, 1); r.material.opacity = Math.max(0, (1 - a / (j ? 2.6 : 1.9))) * (j ? 0.7 : 1); });
  }
  flashA *= Math.pow(0.004, dt); flashEl.style.opacity = flashA.toFixed(3);
  renderer.render(scene, camera);
}
function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false); uniforms.uScale.value = innerHeight * DPR * 0.075;
  camera.fov = innerWidth / innerHeight < 0.75 ? 68 : 58; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

if (CAPTURE) {
  window.__step = (dt, n = 1) => { for (let i = 0; i < n; i++) step(dt); };
  window.__view = view;
  window.__tap = (x, y) => supernova(x, y);
  hint.style.display = 'none';
  window.__ready = true; step(0);
} else {
  let last = performance.now();
  const loop = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  setTimeout(() => hint.classList.remove('gone'), 100);
}
