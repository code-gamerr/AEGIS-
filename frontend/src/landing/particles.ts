type Opts = { word: string; reduced: boolean };

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const VIOLET = hexRgb("#6c5cff");
const CYAN = hexRgb("#2de2e6");

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

async function waitFonts() {
  try {
    await Promise.race([
      document.fonts.load('600 64px "Clash Display"'),
      new Promise((r) => setTimeout(r, 800)),
    ]);
  } catch {
    /* still draw with fallback */
  }
}

function sampleTargets(word: string, w: number, h: number) {
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const g = off.getContext("2d");
  if (!g) return { x: new Float32Array(0), y: new Float32Array(0), mix: new Float32Array(0) };
  const size = Math.min(w * 0.28, h * 0.42);
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#fff";
  g.font = `600 ${size}px "Clash Display", "IBM Plex Sans", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(word, w / 2, h * 0.42);
  const img = g.getImageData(0, 0, w, h).data;
  const gap = w < 768 ? 7 : 5;
  const cap = w < 768 ? 1100 : 2600;
  const xs: number[] = [];
  const ys: number[] = [];
  const ms: number[] = [];
  for (let y = 0; y < h; y += gap) {
    for (let x = 0; x < w; x += gap) {
      if (img[(y * w + x) * 4 + 3] > 128) {
        xs.push(x);
        ys.push(y);
        ms.push(x / w);
      }
    }
  }
  const stride = Math.max(1, Math.ceil(xs.length / cap));
  const n = Math.ceil(xs.length / stride);
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  const mix = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < xs.length; i += stride) {
    tx[j] = xs[i];
    ty[j] = ys[i];
    mix[j] = ms[i];
    j += 1;
  }
  return { x: tx, y: ty, mix };
}

export function startParticles(canvas: HTMLCanvasElement, o: Opts): () => void {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => {};

  const parent = canvas.parentElement ?? canvas;
  let raf = 0;
  let running = true;
  let visible = true;
  let dpr = 1;
  let w = 0;
  let h = 0;
  let n = 0;
  let x = new Float32Array(0);
  let y = new Float32Array(0);
  let vx = new Float32Array(0);
  let vy = new Float32Array(0);
  let tx = new Float32Array(0);
  let ty = new Float32Array(0);
  let mix = new Float32Array(0);
  let px = -9999;
  let py = -9999;
  let rebuildT = 0;

  const draw = (settle: boolean) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      if (!settle) {
        vx[i] += (tx[i] - x[i]) * 0.012;
        vy[i] += (ty[i] - y[i]) * 0.012;
        const dx = x[i] - px;
        const dy = y[i] - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < 110 * 110 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d / 110) * 2.4;
          vx[i] += (dx / d) * f;
          vy[i] += (dy / d) * f;
        }
        vx[i] = vx[i] * 0.86 + (Math.random() - 0.5) * 0.15;
        vy[i] = vy[i] * 0.86 + (Math.random() - 0.5) * 0.15;
        x[i] += vx[i];
        y[i] += vy[i];
      }
      const t = mix[i];
      const hot = i % 12 === 0;
      ctx.fillStyle = `rgba(${lerp(VIOLET[0], CYAN[0], t) | 0},${lerp(VIOLET[1], CYAN[1], t) | 0},${lerp(VIOLET[2], CYAN[2], t) | 0},${hot ? 1 : 0.82})`;
      const s = (hot ? 2.8 : 1.8) * dpr;
      ctx.fillRect(x[i], y[i], s, s);
    }
    ctx.globalCompositeOperation = "source-over";
  };

  const loop = () => {
    if (!running) return;
    if (visible && !document.hidden) draw(false);
    raf = requestAnimationFrame(loop);
  };

  const build = () => {
    const rect = parent.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const t = sampleTargets(o.word, w, h);
    n = t.x.length;
    tx = t.x;
    ty = t.y;
    mix = t.mix;
    x = new Float32Array(n);
    y = new Float32Array(n);
    vx = new Float32Array(n);
    vy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (o.reduced) {
        x[i] = tx[i];
        y[i] = ty[i];
      } else {
        x[i] = Math.random() * w;
        y[i] = Math.random() * h;
      }
    }
    draw(true);
  };

  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    px = e.clientX - r.left;
    py = e.clientY - r.top;
  };
  const onLeave = () => {
    px = -9999;
    py = -9999;
  };

  const ro = new ResizeObserver(() => {
    clearTimeout(rebuildT);
    rebuildT = window.setTimeout(build, 150);
  });
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((en) => en.isIntersecting);
  });

  let hero: HTMLElement | null = canvas.closest("#hero");
  const ready = async () => {
    await waitFonts();
    if (!running) return;
    build();
    ro.observe(parent);
    io.observe(parent);
    if (!o.reduced) {
      (hero ?? parent).addEventListener("pointermove", onPointer);
      (hero ?? parent).addEventListener("pointerleave", onLeave);
      raf = requestAnimationFrame(loop);
    }
  };
  void ready();

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    clearTimeout(rebuildT);
    ro.disconnect();
    io.disconnect();
    (hero ?? parent).removeEventListener("pointermove", onPointer);
    (hero ?? parent).removeEventListener("pointerleave", onLeave);
  };
}
