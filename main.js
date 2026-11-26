// Mind — landing pixelada.
// 1) Cérebro desenhado em scanlines num canvas (procedural, sem imagem), flutuando.
// 2) As mãos da Criação de Adão (Michelangelo, domínio público), pontilhadas, nos cantos.
// 3) Botão em matriz LED: Ready? → Download.
// 4) Popup retrô de download (Windows baixa o instalador; celular abre o app).
//
// Movimento: o <head> põe a classe "motion" no <html> quando o sistema não pede menos
// movimento (ou quando a URL tem ?motion, para ver tudo mesmo com as animações do Windows
// desligadas). Sem ela, a página fica parada, só com transições de opacidade e o cursor.
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  // Anima sempre, mesmo com "reduzir movimento" ligado no sistema (escolha do autor do site).
  const FORCE_MOTION = true;
  const reduced = () => !root.classList.contains('motion');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const APP_URL = 'https://oforas.github.io/mind/app/';
  const RELEASES_URL = 'https://github.com/oForas/mind/releases/latest';
  const API_URL = 'https://api.github.com/repos/oForas/mind/releases/latest';
  // Id do Mind na Microsoft Store (ex.: '9NXXXXXXXXXX'). Preenchido, o botão no Windows abre a
  // loja (app assinado pela Microsoft, sem o aviso "O Windows protegeu o computador");
  // vazio, baixa o instalador .exe do GitHub.
  const STORE_ID = '9NMQVWF6TWW7';
  const STORE_URL = STORE_ID ? `https://apps.microsoft.com/detail/${STORE_ID}?hl=pt-BR&gl=BR` : '';
  // ?dry na URL: o popup roda inteiro, mas só registra o link no console (para testes).
  const DRY = new URLSearchParams(location.search).has('dry');

  const ua = navigator.userAgent;
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWindows = !isMobile && /Windows/i.test(ua);

  /* =====================================================================
     Ruído (Perlin 2D com semente) para os giros do cérebro
     ===================================================================== */

  function mulberry32(a) {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(seed) {
    const rnd = mulberry32(seed);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const grad = (h, x, y) => {
      switch (h & 7) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        case 3: return -x - y;
        case 4: return x;
        case 5: return -x;
        case 6: return y;
        default: return -y;
      }
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    return (x, y) => {
      const xf = Math.floor(x);
      const yf = Math.floor(y);
      const X = xf & 255;
      const Y = yf & 255;
      x -= xf;
      y -= yf;
      const u = fade(x);
      const v = fade(y);
      const a = p[X] + Y;
      const b = p[X + 1] + Y;
      return lerp(
        lerp(grad(p[a], x, y), grad(p[b], x - 1, y), u),
        lerp(grad(p[a + 1], x, y - 1), grad(p[b + 1], x - 1, y - 1), u),
        v,
      );
    };
  }

  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function distToPolyline(x, y, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const dx = bx - ax;
      const dy = by - ay;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best) best = d;
    }
    return best;
  }

  /* =====================================================================
     Cérebro em scanlines
     ===================================================================== */

  const Brain = (() => {
    const canvas = $('#brain');
    const wrap = $('#visual');
    if (!canvas || !wrap || !canvas.getContext) return null;
    const ctx = canvas.getContext('2d');
    // A sombra do chão vai num canvas próprio, atrás das mãos: a mão de baixo passa por cima dela.
    const shadowCv = document.createElement('canvas');
    shadowCv.className = 'brain-shadow';
    shadowCv.setAttribute('aria-hidden', 'true');
    ($('#hands') || wrap).prepend(shadowCv);
    const sctx = shadowCv.getContext('2d');

    // Espaço de desenho: 200 × 172 (vista lateral, a testa olhando para o texto).
    const DW = 200;
    const DH = 172;
    const SHAPES = [
      // 1 · cérebro (lobos frontal, parietal, occipital e temporal)
      new Path2D(
        'M50 86 C36 88 20 86 13 76 C4 62 8 40 26 26 C48 8 92 2 128 8 C160 13 186 32 193 58 ' +
          'C198 74 192 90 178 98 C168 103 158 104 150 104 C130 112 100 117 76 114 ' +
          'C60 112 46 108 44 100 C43 94 46 89 50 86 Z',
      ),
      // 2 · cerebelo
      new Path2D('M128 106 C132 94 160 92 182 97 C197 101 198 118 186 126 C172 134 146 133 134 123 C129 118 127 112 128 106 Z'),
      // 3 · tronco cerebral
      new Path2D('M112 108 C115 120 117 130 118 142 L136 142 C134 130 134 118 140 106 Z'),
    ];
    // Sulcos principais: fissura lateral, sulco central, sulco temporal superior e parieto-occipital.
    const FISSURES = [
      { w: 1.6, pts: [[47, 87], [64, 82], [84, 77], [104, 73], [120, 68], [132, 61], [138, 55]] },
      { w: 1.3, pts: [[107, 5], [104, 18], [100, 30], [97, 42], [94, 54], [91, 66]] },
      { w: 1.0, pts: [[60, 100], [86, 95], [112, 91], [134, 87], [152, 81]] },
      { w: 1.0, pts: [[166, 21], [162, 36], [167, 52]] },
    ];
    const SHADOW = { x: 104, y: 158, rx: 60, ry: 6.5 };

    const noise = makeNoise(1729);
    const RELIEF = 4.5; // força do relevo de cada giro
    const gyrus = (x, y) => {
      const fx = x / 16;
      const fy = y / 16;
      const wx = noise(fx * 0.55 + 13.1, fy * 0.55 + 7.7);
      const wy = noise(fx * 0.55 + 3.3, fy * 0.55 + 19.9);
      return Math.abs(noise(fx + wx * 1.15, fy + wy * 1.15));
    };
    const gyrusH = (x, y) => smooth(0, 0.3, gyrus(x, y));
    const probe = document.createElement('canvas').getContext('2d');
    const L = (() => {
      const v = [-0.5, -0.78, 0.8];
      const n = Math.hypot(...v);
      return v.map((c) => c / n);
    })();

    const cache = new Map();

    function chamfer(mask, cols, rows) {
      // Distância (em células) de cada célula até a borda da própria peça.
      const INF = 1e9;
      const d = new Float32Array(cols * rows);
      for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
      const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : d[r * cols + c]);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (!d[i]) continue;
          d[i] = Math.min(d[i], at(c - 1, r) + 1, at(c, r - 1) + 1, at(c - 1, r - 1) + 1.414, at(c + 1, r - 1) + 1.414);
        }
      for (let r = rows - 1; r >= 0; r--)
        for (let c = cols - 1; c >= 0; c--) {
          const i = r * cols + c;
          if (!d[i]) continue;
          d[i] = Math.min(d[i], at(c + 1, r) + 1, at(c, r + 1) + 1, at(c + 1, r + 1) + 1.414, at(c - 1, r + 1) + 1.414);
        }
      return d;
    }

    function buildModel(cols) {
      if (cache.has(cols)) return cache.get(cols);
      const cs = DW / cols;
      const rows = Math.ceil(DH / cs);
      const N = cols * rows;
      const part = new Uint8Array(N);
      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * cs;
        for (let c = 0; c < cols; c++) {
          const x = (c + 0.5) * cs;
          for (let k = 0; k < SHAPES.length; k++) {
            if (probe.isPointInPath(SHAPES[k], x, y)) {
              part[r * cols + c] = k + 1;
              break;
            }
          }
        }
      }

      // Altura em "domo" de cada peça, para a luz.
      const RADIUS = [0, 30, 13, 7];
      const h = new Float32Array(N);
      for (let k = 1; k <= 3; k++) {
        const mask = new Uint8Array(N);
        for (let i = 0; i < N; i++) mask[i] = part[i] === k ? 1 : 0;
        const d = chamfer(mask, cols, rows);
        for (let i = 0; i < N; i++) {
          if (part[i] !== k) continue;
          const t = Math.min((d[i] * cs) / RADIUS[k], 1);
          h[i] = 1 - (1 - t) * (1 - t);
        }
      }

      const level = new Int8Array(N).fill(-1); // -1 fora; 0..4 escuridão da linha
      const body = new Uint8Array(N); // 1 = célula com "corpo" branco
      const hAt = (c, r, k) => {
        if (c < 0 || r < 0 || c >= cols || r >= rows) return 0;
        const i = r * cols + c;
        return part[i] === k ? h[i] : 0;
      };
      const partAt = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : part[r * cols + c]);
      const reach = Math.max(2, Math.round(5 / cs)); // alcance da sombra de contato

      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * cs;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const k = part[i];
          const x = (c + 0.5) * cs;

          if (!k) continue; // a sombra no chão é desenhada à parte, porque não flutua

          body[i] = 1;
          const R = RADIUS[k];
          const gx = (hAt(c + 1, r, k) - hAt(c - 1, r, k)) / 2;
          const gy = (hAt(c, r + 1, k) - hAt(c, r - 1, k)) / 2;
          const nx = (-gx / cs) * R * 0.55;
          const ny = (-gy / cs) * R * 0.55;
          const nn = Math.hypot(nx, ny, 1);
          const lam = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / nn);
          const shade = clamp(0.42 + 0.8 * lam, 0, 1);
          let b;

          if (k === 1) {
            // Giros: cada um ganha relevo próprio (luz em cima/esquerda, sombra embaixo/direita),
            // somado ao domo do cérebro inteiro. Perto de zero do ruído fica o sulco escuro.
            const s = gyrus(x, y);
            const e = 0.7;
            const gxg = (gyrusH(x + e, y) - gyrusH(x - e, y)) / (2 * e);
            const gyg = (gyrusH(x, y + e) - gyrusH(x, y - e)) / (2 * e);
            const nx2 = nx * 0.45 - gxg * RELIEF;
            const ny2 = ny * 0.45 - gyg * RELIEF;
            const lam2 = Math.max(0, (nx2 * L[0] + ny2 * L[1] + L[2]) / Math.hypot(nx2, ny2, 1));
            b = clamp(0.3 + 0.9 * lam2, 0, 1) * (0.74 + 0.26 * shade) * (0.66 + 0.34 * smooth(0, 0.3, s));
            if (s < 0.05) b *= 0.12;
            for (const f of FISSURES) {
              const fd = distToPolyline(x, y, f.pts);
              if (fd < f.w) b *= 0.1;
              else if (fd < f.w + 2.6) b *= 0.55 + 0.45 * ((fd - f.w) / 2.6);
            }
          } else if (k === 2) {
            // Cerebelo: folhas finas e paralelas, levemente curvas.
            const ang = -0.2;
            const dx = x - 162;
            const dy = y - 113;
            const yr = dx * Math.sin(ang) + dy * Math.cos(ang);
            const xr = dx * Math.cos(ang) - dy * Math.sin(ang);
            const t = (yr + xr * xr * 0.006) / 3.1 + noise(x / 9, y / 9) * 0.45;
            const f = t - Math.floor(t);
            b = shade * 0.9 * (f < 0.36 ? 0.32 : 0.8 + 0.2 * Math.sin(f * Math.PI));
          } else {
            b = shade * 0.72;
          }

          // Sombra de contato embaixo das peças que ficam na frente.
          if (k > 1) {
            for (let s = 1; s <= reach; s++) {
              const above = partAt(c, r - s);
              if (above && above < k) {
                b *= 0.22 + (0.78 * (s - 1)) / reach;
                break;
              }
            }
          }

          // Curva puxa os meios-tons para o branco: giros claros, sulcos bem pretos.
          const dark = clamp(1 - b, 0, 1) ** 1.35;
          let lv = clamp(Math.round(dark * 4), 0, 4);
          // Contorno de 1 célula para a silhueta não sumir nas partes iluminadas.
          if (!partAt(c - 1, r) || !partAt(c + 1, r) || !partAt(c, r - 1) || !partAt(c, r + 1)) lv = Math.max(lv, 2);
          level[i] = lv;
        }
      }

      // Centro de massa do cérebro (unidades de desenho): é para lá que as mãos apontam.
      let mx = 0;
      let my = 0;
      let mn = 0;
      for (let i = 0; i < N; i++) {
        if (!part[i]) continue;
        mx += (i % cols) + 0.5;
        my += Math.floor(i / cols) + 0.5;
        mn++;
      }
      const center = mn ? [(mx / mn) * cs, (my / mn) * cs] : [DW / 2, DH / 2];

      const model = { cols, rows, cs, part, level, body, center };
      cache.set(cols, model);
      return model;
    }

    // ---- Layout e desenho ----

    const INK = '#0d0d0d';
    const BODY = '#fbfbf9';
    let model = null;
    let dpr = 1;
    let cell = 6; // tamanho da célula em pixels do aparelho
    let gap = 1;
    let ox = 0;
    let oy = 0;
    let W = 0;
    let H = 0;
    let base = null; // cérebro já desenhado (estático)
    let streaks = [];
    const glitch = new Map(); // linha → deslocamento horizontal

    const barH = (lv) => (lv <= 0 ? 0 : Math.max(1, Math.round((lv / 4) * (cell - gap))));

    function drawRow(g, r, shift, delta, dy = 0) {
      const { cols, level, body } = model;
      const y = oy + r * cell + dy;
      const row = r * cols;
      // Corpo branco
      g.fillStyle = BODY;
      for (let c = 0; c < cols; ) {
        if (!body[row + c]) {
          c++;
          continue;
        }
        let e = c;
        while (e < cols && body[row + e]) e++;
        g.fillRect(ox + c * cell + shift, y, (e - c) * cell, cell);
        c = e;
      }
      // Linhas pretas, agrupando células vizinhas de mesma espessura
      g.fillStyle = INK;
      for (let c = 0; c < cols; ) {
        const lv0 = level[row + c];
        if (lv0 < 0) {
          c++;
          continue;
        }
        const lv = body[row + c] ? clamp(lv0 + delta, 0, 4) : lv0;
        let e = c + 1;
        while (e < cols) {
          const o = level[row + e];
          if (o < 0) break;
          const ol = body[row + e] ? clamp(o + delta, 0, 4) : o;
          if (ol !== lv) break;
          e++;
        }
        const bh = barH(lv);
        if (bh) g.fillRect(ox + c * cell + shift, y + Math.floor((cell - bh) / 2), (e - c) * cell, bh);
        c = e;
      }
    }

    // Sombra pixelada no "chão": fica no lugar e encolhe/clareia quando o cérebro sobe.
    function drawShadow(g, lift) {
      const { cols, cs } = model;
      const rx = SHADOW.rx * (1 - 0.16 * lift);
      const ry = SHADOW.ry * (1 - 0.12 * lift);
      const strength = 2.7 - 1.1 * lift;
      const r0 = Math.floor((SHADOW.y - ry) / cs);
      const r1 = Math.ceil((SHADOW.y + ry) / cs);
      g.fillStyle = INK;
      for (let r = r0; r <= r1; r++) {
        const y = (r + 0.5) * cs;
        let start = 0;
        let runLv = 0;
        for (let c = 0; c <= cols; c++) {
          let lv = 0;
          if (c < cols) {
            const x = (c + 0.5) * cs;
            const q = ((x - SHADOW.x) / rx) ** 2 + ((y - SHADOW.y) / ry) ** 2;
            if (q < 1) lv = Math.round((1 - q) * strength);
          }
          if (lv !== runLv) {
            if (runLv > 0) {
              const bh = barH(runLv);
              g.fillRect(ox + start * cell, oy + r * cell + Math.floor((cell - bh) / 2), (c - start) * cell, bh);
            }
            start = c;
            runLv = lv;
          }
        }
      }
    }

    function buildStreaks() {
      // Rastros horizontais saindo da parte de cima/de trás até a borda direita (como na referência).
      const rnd = mulberry32(42);
      const { cols, rows, part } = model;
      let top = rows;
      for (let i = 0; i < part.length; i++)
        if (part[i] === 1) {
          top = Math.floor(i / cols);
          break;
        }
      const first = Math.max(0, top - Math.round(rows * 0.12));
      const last = Math.min(rows - 1, Math.round(rows * 0.42));
      const brainRight = ox + cols * cell;
      const out = [];
      for (let r = first; r <= last; r++) {
        if (rnd() < 0.3) continue;
        let right = -1;
        for (let c = cols - 1; c >= 0; c--)
          if (part[r * cols + c] === 1) {
            right = c;
            break;
          }
        let x0;
        if (right >= 0) {
          x0 = ox + (right + 1) * cell - cell * Math.round(rnd() * 6);
        } else {
          // Acima do cérebro: quanto mais alto, mais à direita começa.
          const t = (top - r) / Math.max(1, top - first);
          x0 = ox + cols * cell * (0.6 + 0.38 * t + rnd() * 0.06);
        }
        const reachEdge = rnd() < 0.72;
        const x1 = reachEdge ? W : brainRight + (W - brainRight) * (0.2 + rnd() * 0.6);
        if (x1 - x0 < cell * 4) continue;
        // Quebra em 1 a 3 pedaços
        const segs = [];
        let a = x0;
        const pieces = 1 + Math.floor(rnd() * 3);
        for (let s = 0; s < pieces; s++) {
          const remaining = x1 - a;
          const len = s === pieces - 1 ? remaining : remaining * (0.3 + rnd() * 0.45);
          segs.push([a, a + len]);
          a += len + cell * (2 + Math.floor(rnd() * 5));
          if (a >= x1) break;
        }
        out.push({
          r,
          x0,
          x1,
          segs,
          lv: 1 + Math.floor(rnd() * rnd() * 3.5),
          speed: (50 + rnd() * 120) * dpr,
          plen: cell * (3 + Math.floor(rnd() * 8)),
          phase: rnd() * 4000,
        });
      }
      streaks = out;
    }

    function drawStreaks(g, t, grow, animate, dy = 0) {
      g.fillStyle = INK;
      for (const s of streaks) {
        const y = oy + s.r * cell + dy;
        const limit = s.x0 + (s.x1 - s.x0) * grow;
        const bh = barH(s.lv);
        const yy = y + Math.floor((cell - bh) / 2);
        for (const [a, b] of s.segs) {
          if (a >= limit) break;
          g.fillRect(Math.round(a), yy, Math.round(Math.min(b, limit) - a), bh);
        }
        if (animate && grow >= 1) {
          // Um "pacote" mais grosso correndo para a direita: pensamentos saindo.
          const span = s.x1 - s.x0 + s.plen;
          const px = s.x0 - s.plen + ((t * s.speed) / 1000 + s.phase) % span;
          const a = Math.max(px, s.x0);
          const b = Math.min(px + s.plen, s.x1);
          if (b > a) {
            const ph = barH(Math.min(4, s.lv + 2));
            g.fillRect(Math.round(a), y + Math.floor((cell - ph) / 2), Math.round(b - a), ph);
          }
        }
      }
    }

    function layout() {
      const rect = wrap.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const bleed = Math.max(0, vw - rect.right);
      const cssW = Math.max(1, Math.round(rect.width + bleed));
      const cssH = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      const host = shadowCv.parentElement.getBoundingClientRect();
      shadowCv.style.left = rect.left - host.left + 'px';
      shadowCv.style.top = rect.top - host.top + 'px';
      shadowCv.style.width = cssW + 'px';
      shadowCv.style.height = cssH + 'px';
      W = canvas.width = Math.round(cssW * dpr);
      H = canvas.height = Math.round(cssH * dpr);
      shadowCv.width = W;
      shadowCv.height = H;

      // Tamanho do cérebro dentro da coluna; células inteiras em pixels do aparelho (nítido).
      // Empilhado (celular/tablet): o cérebro usa a largura toda e sobe um pouco, perto do texto.
      const stacked = getComputedStyle(wrap.parentElement).flexDirection === 'column';
      // Empilhado: sobra espaço acima do cérebro para a mão de cima e abaixo para a de baixo.
      // O cérebro fica entre as duas mãos, no mesmo eixo: menor, para sobrar espaço para elas.
      const fit = stacked ? (rect.width < 600 ? 0.66 : 0.56) : 0.62;
      const bw = Math.min(rect.width * fit, rect.height * (stacked ? 0.62 : 0.66) * (DW / DH));
      const cellCss = clamp(bw / 108, 3.2, 7);
      cell = Math.max(3, Math.round(cellCss * dpr));
      gap = Math.max(1, Math.round(cell * 0.2));
      const cols = Math.max(40, Math.floor((bw * dpr) / cell));
      model = buildModel(cols);
      // No desktop o cérebro fica um pouco à esquerda da coluna: a mão de baixo precisa de espaço
      // até a borda direita da tela.
      ox = Math.round((rect.width * dpr - cols * cell) * (stacked ? 0.5 : 0.3));
      oy = Math.round((H - model.rows * cell) * 0.5);

      base = document.createElement('canvas');
      base.width = W;
      base.height = H;
      const bg = base.getContext('2d');
      for (let r = 0; r < model.rows; r++) drawRow(bg, r, 0, 0);
      buildStreaks();
      stackedNow = stacked;
      for (const fn of listeners) fn();
    }

    // ---- Animação ----

    const REVEAL = 1200;
    const START_DELAY = 350; // espera o menu e o título começarem a aparecer
    const FLOAT_PERIOD = 6800;
    let t0 = performance.now() + START_DELAY;
    let raf = 0;
    let visible = true;
    let nextGlitch = 5200;
    let fy = 0; // deslocamento vertical atual da flutuação (pixels do aparelho)
    let stackedNow = false;
    const listeners = [];

    function render(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, W, H);
      fy = 0;
      if (reduced()) {
        ctx.drawImage(base, 0, 0);
        sctx.clearRect(0, 0, W, H);
        drawShadow(sctx, 0);
        drawStreaks(ctx, 0, 1, false);
        return;
      }
      if (t < 0) return;
      if (t < REVEAL) {
        // Entrada: as linhas aparecem de cima para baixo, como se carregassem.
        const p = 1 - (1 - t / REVEAL) ** 3;
        const cut = oy + Math.floor(p * model.rows) * cell;
        if (cut > 0) ctx.drawImage(base, 0, 0, W, cut, 0, 0, W, cut);
        ctx.fillStyle = INK;
        ctx.fillRect(ox - cell * 4, cut, model.cols * cell + cell * 8, Math.max(1, gap));
        sctx.clearRect(0, 0, W, H);
        sctx.save();
        sctx.beginPath();
        sctx.rect(0, 0, W, cut);
        sctx.clip();
        drawShadow(sctx, 0);
        sctx.restore();
        drawStreaks(ctx, t, smooth(0.55, 1, t / REVEAL) * 0.35, false);
        return;
      }
      const since = t - REVEAL;

      // Flutuação suave: seno lento, que começa do zero para não dar tranco depois da entrada.
      const amp = Math.max(2, Math.round(model.rows * cell * 0.022));
      const wave = Math.sin((since / FLOAT_PERIOD) * Math.PI * 2);
      fy = Math.round(-wave * amp * smooth(0, 1, since / 1400));
      const lift = clamp(-fy / amp, -1, 1) * 0.5 + 0.5;

      ctx.drawImage(base, 0, fy);

      // Faixa de "atualização de tela" descendo devagar.
      const band = ((since / 5200) % 1) * (model.rows + 20) - 10;
      const special = new Map();
      for (let r = Math.floor(band - 1); r <= Math.ceil(band + 1); r++)
        if (r >= 0 && r < model.rows) special.set(r, { shift: 0, delta: 1 });

      // Glitch espontâneo, raro e curto.
      if (since > nextGlitch) {
        const r0 = Math.floor(model.rows * (0.15 + Math.random() * 0.6));
        const n = 2 + Math.floor(Math.random() * 3);
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let k = 0; k < n; k++) glitch.set(r0 + k, dir * cell * (1.5 + Math.random() * 3));
        nextGlitch = since + 4800 + Math.random() * 5200;
      }
      for (const [r, off] of glitch) {
        if (r < 0 || r >= model.rows) continue;
        const cur = special.get(r);
        special.set(r, { shift: Math.round(off), delta: cur ? cur.delta : 0 });
      }
      for (const [r, s] of special) {
        ctx.clearRect(0, oy + r * cell + fy, W, cell);
        drawRow(ctx, r, s.shift, s.delta, fy);
      }
      for (const [r, off] of glitch) {
        const n = off * 0.88;
        if (Math.abs(n) < 1) glitch.delete(r);
        else glitch.set(r, n);
      }

      sctx.clearRect(0, 0, W, H);
      drawShadow(sctx, lift);
      const grow = smooth(0, 1, since / 900) * 0.65 + 0.35;
      drawStreaks(ctx, since, grow, true, fy);
    }

    function loop(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      render(now);
      if (!reduced()) raf = requestAnimationFrame(loop);
    }

    function kick() {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
    }

    function onPointer(e) {
      if (reduced() || !model || performance.now() - t0 < REVEAL) return;
      const rect = canvas.getBoundingClientRect();
      const y = (e.clientY - rect.top) * dpr;
      const x = (e.clientX - rect.left) * dpr;
      if (x < ox - cell * 6 || x > ox + model.cols * cell + cell * 6) return;
      const r = Math.floor((y - oy - fy) / cell);
      if (r < 0 || r >= model.rows) return;
      const dir = (e.movementX || 1) > 0 ? 1 : -1;
      for (let k = -1; k <= 1; k++) {
        const want = dir * cell * (2.2 - Math.abs(k) * 0.9);
        const cur = glitch.get(r + k) || 0;
        if (Math.abs(want) > Math.abs(cur)) glitch.set(r + k, want);
      }
    }

    let resizeTimer = 0;
    function relayout() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        layout();
        render(performance.now());
        kick();
      }, 80);
    }

    layout();
    render(t0);
    kick();

    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(wrap);
    else addEventListener('resize', relayout);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        kick();
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', kick);
    addEventListener('pointermove', onPointer, { passive: true });
    reduceMQ.addEventListener?.('change', () => {
      if (!FORCE_MOTION) root.classList.toggle('motion', !reduceMQ.matches);
      render(performance.now());
      kick();
    });

    return {
      replay: () => ((t0 = performance.now()), kick()),
      // Caixa do cérebro (posição de repouso) em pixels CSS, nas coordenadas da página.
      box() {
        if (!model) return null;
        const r = canvas.getBoundingClientRect();
        return {
          x: r.left + scrollX + ox / dpr,
          y: r.top + scrollY + oy / dpr,
          w: (model.cols * cell) / dpr,
          h: (model.rows * cell) / dpr,
          stacked: stackedNow,
          center: model.center, // unidades de desenho (200 de largura)
          // Distância (unidades de desenho) do centro até a borda do cérebro na direção (dx, dy).
          reach(dx, dy) {
            const { cols, rows, cs, part, center } = model;
            let last = 0;
            for (let t = 0; t < 260; t += cs * 0.5) {
              const c = Math.floor((center[0] + dx * t) / cs);
              const r = Math.floor((center[1] + dy * t) / cs);
              if (c < 0 || r < 0 || c >= cols || r >= rows) break;
              if (part[r * cols + c]) last = t;
            }
            return last;
          },
        };
      },
      onLayout(fn) {
        listeners.push(fn);
        if (model) fn();
      },
    };
  })();

  /* =====================================================================
     Mãos da Criação de Adão (Michelangelo, domínio público), pontilhadas
     ===================================================================== */

  const Hands = (() => {
    const layer = $('#hands');
    if (!layer || !Brain) return null;
    const cvL = layer.querySelector('.hand--l');
    const cvR = layer.querySelector('.hand--r');
    const page = $('.page');

    // Recortes do afresco em tons de cinza com transparência (pasta assets/).
    // tip = ponta do indicador; wrist = x do punho (dá a escala); end = lado onde o braço se desfaz.
    const ADAM = { src: './assets/hand-adam.png', w: 668, h: 370, tip: [657, 192], wrist: 270, end: 'left' };
    const GOD = { src: './assets/hand-god.png', w: 684, h: 396, tip: [11, 205], wrist: 410, end: 'right' };

    // Matriz de Bayer 8×8: o pontilhado ordenado da referência.
    const BAYER = [
      0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
      3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
    ].map((v) => (v + 0.5) / 64);
    const INK = '#141414';
    const BODY = '#f6f6f4';
    const hash = (c, r) => {
      const n = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    const load = (H) =>
      new Promise((res) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = H.src;
      });
    let imgs = null;
    const ready = Promise.all([load(ADAM), load(GOD)]).then((list) => (imgs = list));

    // P: x, y = onde fica a ponta do indicador (pixels CSS da página); rot = giro; k = escala.
    function render(cv, img, H, P, dot, dpr) {
      const { k, rot } = P;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const [tx, ty] = H.tip;
      const toPage = (ix, iy) => {
        const x = (ix - tx) * k;
        const y = (iy - ty) * k;
        return [P.x + x * cos - y * sin, P.y + x * sin + y * cos];
      };
      const pts = [[0, 0], [H.w, 0], [H.w, H.h], [0, H.h]].map(([a, b]) => toPage(a, b));
      const pad = 28;
      const x0 = Math.floor(Math.max(-pad, Math.min(...pts.map((p) => p[0]))));
      const y0 = Math.floor(Math.max(-pad, Math.min(...pts.map((p) => p[1]))));
      const x1 = Math.ceil(Math.min(page.clientWidth + pad, Math.max(...pts.map((p) => p[0]))));
      const y1 = Math.ceil(Math.min(page.clientHeight + pad, Math.max(...pts.map((p) => p[1]))));
      if (x1 - x0 < 8 || y1 - y0 < 8) {
        cv.width = cv.height = 0;
        return;
      }

      const cell = Math.max(2, Math.round(dot * dpr)); // pixels do aparelho
      const step = cell / dpr; // pixels CSS
      const cols = Math.ceil((x1 - x0) / step);
      const rows = Math.ceil((y1 - y0) / step);
      cv.width = cols * cell;
      cv.height = rows * cell;
      cv.style.width = cols * step + 'px';
      cv.style.height = rows * step + 'px';
      cv.style.left = x0 + 'px';
      cv.style.top = y0 + 'px';

      // 1) Reduz a imagem com boa qualidade e depois gira numa grade de um pixel por ponto.
      const scale = k / step;
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(H.w * scale));
      small.height = Math.max(1, Math.round(H.h * scale));
      const smg = small.getContext('2d');
      smg.imageSmoothingQuality = 'high';
      smg.drawImage(img, 0, 0, small.width, small.height);
      const grid = document.createElement('canvas');
      grid.width = cols;
      grid.height = rows;
      const gg = grid.getContext('2d', { willReadFrequently: true });
      gg.setTransform(cos, sin, -sin, cos, (P.x - x0) / step, (P.y - y0) / step);
      gg.drawImage(small, -tx * scale, -ty * scale);
      const px = gg.getImageData(0, 0, cols, rows).data;

      // 2) Tom de cada ponto: sombra da pintura = mais pontos; o braço se desfaz no fim.
      const D = new Float32Array(cols * rows).fill(-1);
      const F = new Float32Array(cols * rows);
      const alphaAt = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : px[(r * cols + c) * 4 + 3]);
      const fadeLen = H.w * 0.22;
      for (let r = 0; r < rows; r++) {
        const gy = y0 + (r + 0.5) * step - P.y;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const a = px[i * 4 + 3];
          if (a < 110) continue;
          const gx = x0 + (c + 0.5) * step - P.x;
          const ix = tx + (gx * cos + gy * sin) / k;
          const fade = H.end === 'left' ? smooth(0, fadeLen, ix) : smooth(H.w, H.w - fadeLen, ix);
          let d = 0.04 + 0.96 * (1 - px[i * 4] / 255) ** 1.05;
          const edge = alphaAt(c - 1, r) < 110 || alphaAt(c + 1, r) < 110 || alphaAt(c, r - 1) < 110 || alphaAt(c, r + 1) < 110;
          if (edge) d = Math.max(d, 0.42); // contorno pontilhado, para a silhueta não sumir na luz
          D[i] = d * fade;
          F[i] = fade;
        }
      }

      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      // Corpo claro por baixo dos pontos (como o do cérebro), sumindo junto com o braço.
      g.fillStyle = BODY;
      const solid = (i) => D[i] >= 0 && F[i] > 0.5;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; ) {
          if (!solid(r * cols + c)) {
            c++;
            continue;
          }
          let e = c;
          while (e < cols && solid(r * cols + e)) e++;
          g.fillRect(c * cell, r * cell, (e - c) * cell, cell);
          c = e;
        }
      }
      g.fillStyle = INK;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (D[i] < 0) continue;
          // Perto do fim do braço o padrão fica irregular, como poeira se desfazendo.
          const t = BAYER[(r & 7) * 8 + (c & 7)] * F[i] + hash(c, r) * (1 - F[i]);
          if (D[i] > t) g.fillRect(c * cell, r * cell, cell, cell);
        }
      }
    }

    // Áreas que as mãos não podem cobrir (em pixels CSS da página).
    function keepClear() {
      const sel = ['.logo__px', '.title__px', '.sub span', '.btn', '.links a', '.foot a'];
      return sel
        .map((q) => $(q))
        .filter(Boolean)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left + scrollX - 10, y: r.top + scrollY - 10, w: r.width + 20, h: r.height + 20 };
        });
    }

    // Algum ponto da mão cai dentro dessas áreas?
    function touches(cv, rects) {
      if (!cv.width) return false;
      const cx = parseFloat(cv.style.left);
      const cy = parseFloat(cv.style.top);
      const sx = cv.width / parseFloat(cv.style.width);
      const g = cv.getContext('2d', { willReadFrequently: true });
      for (const r of rects) {
        const x0 = Math.max(0, Math.floor((r.x - cx) * sx));
        const y0 = Math.max(0, Math.floor((r.y - cy) * sx));
        const x1 = Math.min(cv.width, Math.ceil((r.x + r.w - cx) * sx));
        const y1 = Math.min(cv.height, Math.ceil((r.y + r.h - cy) * sx));
        if (x1 <= x0 || y1 <= y0) continue;
        const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let ink = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && ++ink > 6) return true;
      }
      return false;
    }

    function place() {
      if (!imgs) {
        ready.then(place);
        return;
      }
      const [imgA, imgG] = imgs;
      const b = Brain.box();
      if (!b || !imgA || !imgG) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rad = (d) => (d * Math.PI) / 180;
      const ppu = b.w / 200; // pixels CSS por unidade de desenho do cérebro
      const C = [b.x + b.center[0] * ppu, b.y + b.center[1] * ppu];
      // Direção do punho à ponta do indicador em cada recorte (Adão aponta para a direita e um
      // pouco para baixo; Deus, para a esquerda). Usada para girar as mãos sobre o eixo.
      const AIM_ADAM = 24;
      const AIM_GOD = 173;

      // As duas mãos ficam num mesmo eixo que passa pelo centro do cérebro, apontando uma
      // para a outra; o cérebro fica entre as pontas dos dedos.
      let theta = b.stacked ? 54 : 34; // graus, de cima/esquerda para baixo/direita
      let size = 1;
      const dot = (P) => (P.len < 140 ? 2 : 3);
      let L;
      let R;
      for (let tries = 0; tries < 20; tries++) {
        const ux = Math.cos(rad(theta));
        const uy = Math.sin(rad(theta));
        const gap = b.w * 0.05 + 6;
        const back = b.reach(-ux, -uy) * ppu + gap;
        const front = b.reach(ux, uy) * ppu + gap;
        const len = b.w * (b.stacked ? 0.66 : 0.6) * size;
        const kA = len / Math.abs(ADAM.tip[0] - ADAM.wrist);
        const kG = len / Math.abs(GOD.tip[0] - GOD.wrist);
        L = { x: C[0] - ux * back, y: C[1] - uy * back, rot: rad(theta - AIM_ADAM), k: kA, len, dir: rad(theta) };
        R = { x: C[0] + ux * front, y: C[1] + uy * front, rot: rad(theta + 180 - AIM_GOD), k: kG, len, dir: rad(theta) };
        render(cvL, imgA, ADAM, L, dot(L), dpr);
        render(cvR, imgG, GOD, R, dot(R), dpr);
        const clear = keepClear();
        if (!touches(cvL, clear) && !touches(cvR, clear)) break;
        // Encostou no texto: no desktop o eixo fica mais inclinado (Adão sobe, longe do título);
        // empilhado, fica mais deitado (Adão vai para a lateral, longe do botão). Depois, diminui.
        if (!b.stacked && theta < 48) theta += 3;
        else if (b.stacked && size > 0.74) size *= 0.92;
        else if (b.stacked && theta > 30) theta -= 3;
        else size *= 0.9;
      }

      // Entrada (vêm de fora, pelo eixo) e "respiração" (aproximam-se do cérebro e voltam).
      const set = (cv, P, sign) => {
        const dx = Math.cos(P.dir) * sign;
        const dy = Math.sin(P.dir) * sign;
        cv.style.setProperty('--fx', `${(-dx * 70).toFixed(1)}px`);
        cv.style.setProperty('--fy', `${(-dy * 70).toFixed(1)}px`);
        cv.style.setProperty('--dx', `${(dx * 7).toFixed(1)}px`);
        cv.style.setProperty('--dy', `${(dy * 7).toFixed(1)}px`);
        cv.classList.add('is-ready');
      };
      set(cvL, L, 1);
      set(cvR, R, -1);
    }

    Brain.onLayout(place);
    return { place };
  })();

  /* =====================================================================
     Botão em matriz LED: Ready? → Download
     ===================================================================== */

  const FONT = {
    R: ['1111.', '1...1', '1...1', '1111.', '1.1..', '1..1.', '1...1', '.....'],
    e: ['.....', '.....', '.111.', '1...1', '11111', '1....', '.111.', '.....'],
    a: ['.....', '.....', '.111.', '....1', '.1111', '1...1', '.1111', '.....'],
    d: ['....1', '....1', '.11.1', '1..11', '1...1', '1...1', '.1111', '.....'],
    y: ['.....', '.....', '1...1', '1...1', '1...1', '.1111', '....1', '.111.'],
    '?': ['.111.', '1...1', '....1', '...1.', '..1..', '.....', '..1..', '.....'],
    D: ['1111.', '1...1', '1...1', '1...1', '1...1', '1...1', '1111.', '.....'],
    o: ['.....', '.....', '.111.', '1...1', '1...1', '1...1', '.111.', '.....'],
    w: ['.....', '.....', '1...1', '1...1', '1.1.1', '1.1.1', '.1.1.', '.....'],
    n: ['.....', '.....', '1.11.', '11..1', '1...1', '1...1', '1...1', '.....'],
    l: ['.11..', '..1..', '..1..', '..1..', '..1..', '..1..', '.111.', '.....'],
  };
  const CURSOR = ['11111', '11111', '11111', '11111', '11111', '11111', '11111', '.....'];
  const ARROW = ['..111..', '..111..', '1111111', '.11111.', '..111..', '...1...', '.......', '1111111'];

  const btn = $('#cta');
  const led = $('#led');
  let ledState = { text: 'Ready?', tail: 'blink' };
  let btnState = 'ready';

  function dotSize() {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dot'));
    return v > 0 ? v : 3;
  }

  function ledSvg(text, tail) {
    const parts = [];
    for (const ch of text) if (FONT[ch]) parts.push({ g: FONT[ch], gap: 1, cls: '' });
    if (tail === 'blink' || tail === 'solid') parts.push({ g: CURSOR, gap: 1, cls: tail === 'blink' ? 'cur' : 'cur-solid' });
    if (tail === 'arrow') parts.push({ g: ARROW, gap: 2, cls: 'arr' });
    let cols = 0;
    parts.forEach((p, i) => {
      if (i) cols += p.gap;
      p.x = cols;
      cols += p.g[0].length;
    });
    cols = Math.max(cols, 1);
    const used = new Uint8Array(cols * 8);
    const g = 1 / dotSize(); // 1 pixel de folga entre os pontos
    const s = (1 - g).toFixed(3);
    const rect = (x, y) => `<rect x="${x}" y="${y}" width="${s}" height="${s}"/>`;
    const groups = { '': '', cur: '', 'cur-solid': '', arr: '' };
    for (const p of parts)
      p.g.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== '1') continue;
          used[y * cols + p.x + x] = 1;
          groups[p.cls] += rect(p.x + x, y);
        }
      });
    // Só os pontos acesos, sem a matriz apagada nem brilho por cima da palavra.
    return (
      `<svg viewBox="0 0 ${cols} 8" style="width:calc(${cols} * var(--dot))" shape-rendering="crispEdges" focusable="false">` +
      `<g class="on">${groups['']}${groups['cur-solid']}` +
      `<g class="cur">${groups.cur}</g><g class="arr">${groups.arr}</g></g></svg>`
    );
  }

  function renderLED(text, tail) {
    ledState = { text, tail };
    led.innerHTML = ledSvg(text, tail);
  }

  async function morph() {
    btnState = 'typing';
    btn.setAttribute('aria-label', 'Download');
    btn.setAttribute('aria-busy', 'true');
    // Apaga e digita como num terminal (troca de texto, não é movimento: roda sempre).
    const from = 'Ready?';
    for (let i = from.length; i >= 0; i--) {
      renderLED(from.slice(0, i), 'solid');
      await wait(48);
    }
    await wait(160);
    const word = 'Download';
    for (let i = 1; i <= word.length; i++) {
      renderLED(word.slice(0, i), 'solid');
      await wait(72);
    }
    await wait(140);
    renderLED('Download', 'arrow');
    btn.removeAttribute('aria-busy');
    btnState = 'download';
  }

  if (btn && led) {
    renderLED('Ready?', 'blink');
    btn.classList.add('has-led');
    btn.addEventListener('click', () => {
      if (btnState === 'ready') morph();
      else if (btnState === 'download') openDl();
    });
    // Recalcula a folga dos pontos quando o breakpoint muda o tamanho do ponto.
    let lastDot = dotSize();
    addEventListener('resize', () => {
      const d = dotSize();
      if (d !== lastDot) {
        lastDot = d;
        renderLED(ledState.text, ledState.tail);
      }
    });
  }

  /* =====================================================================
     Versão publicada e link do instalador
     ===================================================================== */

  const release = { url: RELEASES_URL, version: '' };

  function loadRelease() {
    try {
      const c = JSON.parse(sessionStorage.getItem('mind-release') || 'null');
      if (c && c.t > Date.now() - 3600e3) {
        release.url = c.url;
        release.version = c.version;
        return;
      }
    } catch {
      /* sem armazenamento: busca de novo */
    }
    fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        const exe = (j.assets || []).find((a) => /\.exe$/i.test(a.name));
        release.version = String(j.tag_name || j.name || '').replace(/^v/i, '');
        if (exe) release.url = exe.browser_download_url;
        try {
          sessionStorage.setItem('mind-release', JSON.stringify({ ...release, t: Date.now() }));
        } catch {
          /* ignora */
        }
      })
      .catch(() => {});
  }

  loadRelease();

  /* =====================================================================
     Popup de download
     ===================================================================== */

  const dl = $('#dl');
  const meter = $('#dl-meter');
  const pctEl = $('#dl-pct');
  const wordEl = $('#dl-word');
  const note = $('#dl-note');
  const closeBtn = dl ? dl.querySelector('.dl__x') : null;
  const SEGS = 20;
  const segs = [];
  let runToken = null;
  let lastFocus = null;

  if (meter) {
    for (let i = 0; i < SEGS; i++) segs.push(meter.appendChild(document.createElement('i')));
  }

  function setProgress(v) {
    const per = 100 / SEGS;
    segs.forEach((s, i) => {
      const f = clamp(v / per - i, 0, 1);
      s.style.transform = `scaleX(${f})`;
    });
    pctEl.textContent = `${v}%`;
    meter.setAttribute('aria-valuenow', String(v));
  }

  function target() {
    return isWindows ? release.url : APP_URL;
  }

  function go() {
    const url = target();
    if (DRY) {
      console.info('[mind] download →', url);
      return;
    }
    window.location.href = url;
  }

  function finish() {
    dl.classList.add('is-done');
    wordEl.textContent = 'Pronto!';
    const url = target();
    note.textContent = '';
    const msg = document.createElement('span');
    const link = document.createElement('a');
    link.href = url;
    if (isWindows) {
      msg.textContent = 'O instalador está sendo baixado. ';
      link.textContent = 'Não começou? Baixar de novo';
      // Sem assinatura digital, o Windows avisa na primeira vez: explica o que fazer.
      const help = document.createElement('span');
      help.className = 'dl__help';
      help.innerHTML =
        'Se o Windows avisar, clique em <b>Mais informações</b> → <b>Executar assim mesmo</b>. ' +
        'O Mind não tem anúncios e não coleta nada além da sua conta.';
      note.append(msg, link, help);
      // Opcional: pela Microsoft Store o Windows não mostra esse aviso.
      if (STORE_URL) {
        const store = document.createElement('a');
        store.href = STORE_URL;
        store.className = 'dl__store';
        store.textContent = 'Prefere sem aviso? Instale pela Microsoft Store';
        note.append(store);
      }
      setTimeout(go, 260);
      return;
    } else {
      msg.textContent = isMobile
        ? 'Abrindo o Mind para celular. Na próxima tela, veja como instalar de graça e usar como app. '
        : 'Abrindo a versão web. ';
      link.textContent = 'Abrir agora';
    }
    note.append(msg, link);
    setTimeout(go, 260);
  }

  function runProgress() {
    // Ritmo irregular de propósito, parando em 99% um instante (como na referência).
    const steps = [[0, 0], [240, 8], [520, 23], [700, 31], [1040, 47], [1260, 52], [1600, 74], [1880, 88], [2120, 96], [2280, 99], [3200, 99], [3340, 100]];
    const total = steps[steps.length - 1][0];
    const token = (runToken = {});
    const start = performance.now();
    let shown = -1;
    const frame = (now) => {
      if (token !== runToken) return;
      const t = now - start;
      let v = 100;
      for (let i = 1; i < steps.length; i++) {
        if (t < steps[i][0]) {
          const [ta, va] = steps[i - 1];
          const [tb, vb] = steps[i];
          v = va + ((vb - va) * (t - ta)) / (tb - ta);
          break;
        }
      }
      v = Math.floor(v);
      if (v !== shown) setProgress((shown = v));
      if (t < total) requestAnimationFrame(frame);
      else finish();
    };
    requestAnimationFrame(frame);
  }

  function openDl() {
    if (!dl) return;
    lastFocus = document.activeElement;
    dl.hidden = false;
    dl.classList.remove('is-done');
    wordEl.textContent = 'Downloading';
    note.textContent = '';
    setProgress(0);
    requestAnimationFrame(() => requestAnimationFrame(() => dl.classList.add('is-open')));
    closeBtn.focus({ preventScroll: true });
    runProgress();
  }

  function closeDl() {
    if (!dl || dl.hidden) return;
    runToken = null;
    dl.classList.remove('is-open');
    setTimeout(() => {
      if (!dl.classList.contains('is-open')) dl.hidden = true;
    }, reduced() ? 0 : 240);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  if (dl) {
    dl.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeDl();
    });
    dl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDl();
        return;
      }
      if (e.key !== 'Tab') return;
      // Mantém o foco dentro da janela.
      const items = [...dl.querySelectorAll('button, a[href]')].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // Exposto só para testes no console.
  window.__mind = { brain: Brain, hands: Hands, open: openDl, close: closeDl };
})();
