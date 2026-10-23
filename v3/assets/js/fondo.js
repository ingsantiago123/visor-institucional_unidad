/*!
 * U.INCCA · Fondo vivo del visor (v3). Motor propio, sin dependencias.
 *
 * Reproduce las dos animaciones de fondo de la propuesta de los disenadores
 * a una fraccion del costo:
 *
 *  - RED de particulas (antes particles.js): particles.js compara TODAS las
 *    particulas entre si en cada cuadro (150 particulas = 11.000 distancias),
 *    traza cada linea por separado y corre a 60 cuadros/s aunque nadie mire.
 *    Aqui: rejilla espacial (solo se comparan vecinas), lineas agrupadas por
 *    opacidad (5 trazos por cuadro en vez de cientos), 30 cuadros/s, pausa
 *    fuera de pantalla / pestana oculta / escena sin red, y la paleta cambia
 *    con transicion suave entre escenas oscuras y claras.
 *  - ONDAS facetadas (antes Three.js + Vanta WAVES, 627 KB): un unico shader
 *    de fragmentos dibuja la misma superficie facetada con luz especular, a
 *    media resolucion y 30 cuadros/s. Sin WebGL queda el degradado del fondo.
 *
 * Y todo corre FUERA del hilo principal: si el navegador lo permite, los dos
 * lienzos se transfieren a un Worker (OffscreenCanvas) que es este mismo
 * archivo. El hilo principal solo avisa tamano, escena, visibilidad y puntero,
 * asi las transiciones y los clics del visor nunca compiten con el fondo.
 * Sin OffscreenCanvas (navegadores viejos) el mismo motor corre en la pagina.
 *
 * Respeta prefers-reduced-motion (un cuadro quieto) y los equipos modestos
 * (menos particulas, menos cuadros por segundo, menos resolucion).
 */
(function (global) {
  "use strict";

  const enTrabajador = typeof document === "undefined";
  const TAU = Math.PI * 2;
  const ahoraMs = () => (global.performance ? global.performance.now() : Date.now());

  function crearLienzo(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  /* =======================================================================
   * 1. RED DE PARTICULAS
   * ======================================================================= */
  // Paletas por tono de escena. Oscuro: inicio, presentacion, tutorias,
  // unidades (#2B8BFA, #18D1E8, #65CBE3, #00FFE7 de la propuesta). Claro:
  // "aprenderas", bienvenida y DEA (#2B8BFA, #65CBE3, #0B349D).
  // Cada nodo lleva un halo del color CONTRARIO al fondo (azul noche en las
  // escenas oscuras, blanco en las claras): se distingue igual sobre la
  // parte lisa del velo que sobre la foto. En las claras los nodos y las
  // lineas son azules oscuros (sobre blanco el cian no se ve).
  const PALETAS = {
    oscuro: {
      puntos: [[43, 139, 250], [24, 209, 232], [101, 203, 227], [0, 255, 231]],
      linea: [24, 209, 232], aLinea: 0.26, aPunto: 1, aRaton: 0.62, pulso: [101, 203, 227],
      halo: [4, 11, 60], aHalo: 0.5
    },
    claro: {
      puntos: [[11, 52, 157], [27, 59, 90], [43, 139, 250], [4, 11, 60]],
      linea: [11, 52, 157], aLinea: 0.34, aPunto: 1.25, aRaton: 0.55, pulso: [43, 139, 250],
      halo: [255, 255, 255], aHalo: 0.75
    }
  };
  const ORO = [203, 181, 78];

  const copiarPaleta = (p) => ({
    puntos: p.puntos.map((c) => c.slice()), linea: p.linea.slice(),
    aLinea: p.aLinea, aPunto: p.aPunto, aRaton: p.aRaton, pulso: p.pulso.slice(),
    halo: p.halo.slice(), aHalo: p.aHalo
  });
  const mezclar = (a, b, t) => a + (b - a) * t;
  const mezclarColor = (a, b, t) => [mezclar(a[0], b[0], t), mezclar(a[1], b[1], t), mezclar(a[2], b[2], t)];
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

  function crearRed(canvas, ctx, op) {
    const modesto = !!op.modesto;
    const NB = 5;   // grupos de opacidad para las lineas
    const NA = 4;   // grupos de opacidad para los puntos

    let W = 0, H = 0, dpr = 1, dist = 145, dist2 = dist * dist;
    const P = [];
    const pulsos = [];
    let raton = null;
    let ultimo = 0, proximoPulso = 0;
    let paleta = copiarPaleta(PALETAS[op.tema] || PALETAS.oscuro);
    let desde = null, hacia = null, tPaleta = 1;

    // Segmentos por grupo de opacidad (los buffers crecen solos).
    const segs = [], nSegs = new Int32Array(NB);
    const segsR = [], nSegsR = new Int32Array(3);
    for (let i = 0; i < NB; i++) segs.push(new Float32Array(2048));
    for (let i = 0; i < 3; i++) segsR.push(new Float32Array(512));
    function empujar(lista, cuentas, g, x1, y1, x2, y2) {
      let buf = lista[g];
      const n = cuentas[g];
      if (n + 4 > buf.length) {
        const mayor = new Float32Array(buf.length * 2);
        mayor.set(buf);
        lista[g] = buf = mayor;
      }
      buf[n] = x1; buf[n + 1] = y1; buf[n + 2] = x2; buf[n + 3] = y2;
      cuentas[g] = n + 4;
    }
    // Puntos agrupados por color (4) x opacidad (NA): un solo relleno por grupo.
    const grupos = [];
    for (let i = 0; i < 4 * NA; i++) grupos.push([]);

    function nueva(x, y) {
      const ang = Math.random() * TAU;
      const vel = 3 + Math.random() * 9; // px por segundo (particles.js: speed .55)
      return {
        x, y, vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel,
        c: (Math.random() * 4) | 0,
        rMax: 0.75 + Math.random() * 1.35,           // radio entre 0,55 y 2,1
        fa: Math.random() * TAU, wa: 0.35 + Math.random() * 1.1,
        fr: Math.random() * TAU, wr: 0.4 + Math.random() * 1.3
      };
    }
    function cantidadObjetivo() {
      // Densidad de la propuesta: ~150 particulas en 1440 x 900.
      const n = Math.round((W * H) / 8640);
      return Math.max(24, Math.min(modesto ? 90 : 150, modesto ? Math.round(n * 0.6) : n));
    }

    const sprites = {};
    function sprite(color) {
      const clave = color.map((v) => v | 0).join(",");
      if (sprites[clave]) return sprites[clave];
      const s = crearLienzo(64, 64);
      const g = s.getContext("2d");
      const rad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rad.addColorStop(0, `rgba(${clave},.95)`);
      rad.addColorStop(0.18, `rgba(${clave},.75)`);
      rad.addColorStop(0.45, `rgba(${clave},.18)`);
      rad.addColorStop(1, `rgba(${clave},0)`);
      g.fillStyle = rad;
      g.fillRect(0, 0, 64, 64);
      return (sprites[clave] = s);
    }

    function actualizar(dt, ahora) {
      if (tPaleta < 1 && hacia) {
        tPaleta = Math.min(1, tPaleta + dt / 0.7);
        const t = 1 - Math.pow(1 - tPaleta, 3);
        paleta = {
          puntos: desde.puntos.map((c, i) => mezclarColor(c, hacia.puntos[i], t)),
          linea: mezclarColor(desde.linea, hacia.linea, t),
          aLinea: mezclar(desde.aLinea, hacia.aLinea, t),
          aPunto: mezclar(desde.aPunto, hacia.aPunto, t),
          aRaton: mezclar(desde.aRaton, hacia.aRaton, t),
          pulso: mezclarColor(desde.pulso, hacia.pulso, t),
          halo: mezclarColor(desde.halo, hacia.halo, t),
          aHalo: mezclar(desde.aHalo, hacia.aHalo, t)
        };
      }
      for (const p of P) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0) { p.x = 0; p.vx = -p.vx; } else if (p.x > W) { p.x = W; p.vx = -p.vx; }
        if (p.y < 0) { p.y = 0; p.vy = -p.vy; } else if (p.y > H) { p.y = H; p.vy = -p.vy; }
        p.fa += p.wa * dt; p.fr += p.wr * dt;
      }
      // Destellos irregulares (7 % dorados), como los pulsos de la propuesta.
      if (ahora >= proximoPulso) {
        proximoPulso = ahora + 700 + Math.random() * 1900;
        if (pulsos.length < 7) {
          pulsos.push({ x: Math.random() * W, y: Math.random() * H, t: 0,
            dur: 1.8 + Math.random() * 2.8, tam: 3 + Math.random() * 4, oro: Math.random() > 0.93 });
        }
      }
      for (let i = pulsos.length - 1; i >= 0; i--) {
        pulsos[i].t += dt;
        if (pulsos[i].t >= pulsos[i].dur) pulsos.splice(i, 1);
      }
    }

    // Rejilla espacial (orden por conteo): vecinas en O(n) en vez de O(n^2).
    let celdaDe = new Int32Array(0), inicio = new Int32Array(0), orden = new Int32Array(0);
    const VECINAS = [[1, 0], [-1, 1], [0, 1], [1, 1]];
    function unir(p, q) {
      const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 >= dist2) return;
      const k = 1 - Math.sqrt(d2) / dist;
      empujar(segs, nSegs, Math.min(NB - 1, (k * NB) | 0), p.x, p.y, q.x, q.y);
    }
    function enlazar() {
      nSegs.fill(0);
      const cols = Math.max(1, Math.ceil(W / dist)), filas = Math.max(1, Math.ceil(H / dist));
      const nc = cols * filas, n = P.length;
      if (inicio.length < nc + 1) inicio = new Int32Array(nc + 1); else inicio.fill(0, 0, nc + 1);
      if (celdaDe.length < n) { celdaDe = new Int32Array(n * 2); orden = new Int32Array(n * 2); }
      for (let i = 0; i < n; i++) {
        const cx = Math.min(cols - 1, (P[i].x / dist) | 0), cy = Math.min(filas - 1, (P[i].y / dist) | 0);
        const c = cy * cols + cx;
        celdaDe[i] = c;
        inicio[c + 1]++;
      }
      for (let c = 0; c < nc; c++) inicio[c + 1] += inicio[c];
      const lleno = inicio.slice(0, nc);
      for (let i = 0; i < n; i++) orden[lleno[celdaDe[i]]++] = i;
      for (let cy = 0; cy < filas; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const c = cy * cols + cx;
          for (let a = inicio[c]; a < inicio[c + 1]; a++) {
            const p = P[orden[a]];
            for (let b = a + 1; b < inicio[c + 1]; b++) unir(p, P[orden[b]]);
            for (const [dx, dy] of VECINAS) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || nx >= cols || ny >= filas) continue;
              const v = ny * cols + nx;
              for (let b = inicio[v]; b < inicio[v + 1]; b++) unir(p, P[orden[b]]);
            }
          }
        }
      }
    }

    function trazar(buf, n) {
      ctx.beginPath();
      for (let i = 0; i < n; i += 4) { ctx.moveTo(buf[i], buf[i + 1]); ctx.lineTo(buf[i + 2], buf[i + 3]); }
      ctx.stroke();
    }

    function dibujar() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      enlazar();
      ctx.lineWidth = 0.8;
      for (let g = 0; g < NB; g++) {
        if (!nSegs[g]) continue;
        ctx.strokeStyle = rgba(paleta.linea, paleta.aLinea * (g + 0.5) / NB);
        trazar(segs[g], nSegs[g]);
      }
      // "grab" de la propuesta: lineas hacia el puntero.
      if (raton) {
        nSegsR.fill(0);
        const RD = 190, RD2 = RD * RD;
        for (const p of P) {
          const dx = p.x - raton.x, dy = p.y - raton.y, d2 = dx * dx + dy * dy;
          if (d2 >= RD2) continue;
          empujar(segsR, nSegsR, Math.min(2, ((1 - Math.sqrt(d2) / RD) * 3) | 0), p.x, p.y, raton.x, raton.y);
        }
        for (let g = 0; g < 3; g++) {
          if (!nSegsR[g]) continue;
          ctx.strokeStyle = rgba(paleta.linea, paleta.aRaton * (g + 0.5) / 3);
          trazar(segsR[g], nSegsR[g]);
        }
      }
      // Puntos: opacidad 0,16-0,58 y radio 0,55-2,1 oscilando, como la propuesta.
      for (const gr of grupos) gr.length = 0;
      for (const p of P) {
        const a = 0.5 + 0.5 * Math.sin(p.fa);
        grupos[p.c * NA + Math.min(NA - 1, (a * NA) | 0)].push(p);
      }
      // Halos de contraste: un solo relleno por nivel de opacidad.
      for (let g = 0; g < NA; g++) {
        ctx.beginPath();
        let hay = false;
        for (let c = 0; c < 4; c++) {
          for (const p of grupos[c * NA + g]) {
            const r = 1.9 + (p.rMax - 0.55) * (0.5 + 0.5 * Math.sin(p.fr));
            ctx.moveTo(p.x + r, p.y);
            ctx.arc(p.x, p.y, r, 0, TAU);
            hay = true;
          }
        }
        if (!hay) continue;
        ctx.fillStyle = rgba(paleta.halo, paleta.aHalo * (0.35 + 0.65 * (g + 0.5) / NA));
        ctx.fill();
      }
      for (let c = 0; c < 4; c++) {
        for (let g = 0; g < NA; g++) {
          const gr = grupos[c * NA + g];
          if (!gr.length) continue;
          ctx.beginPath();
          for (const p of gr) {
            const r = 0.55 + (p.rMax - 0.55) * (0.5 + 0.5 * Math.sin(p.fr));
            ctx.moveTo(p.x + r, p.y);
            ctx.arc(p.x, p.y, r, 0, TAU);
          }
          ctx.fillStyle = rgba(paleta.puntos[c], Math.min(1, (0.2 + 0.5 * (g + 0.5) / NA) * paleta.aPunto));
          ctx.fill();
        }
      }
      for (const s of pulsos) {
        const t = s.t / s.dur;
        const tam = s.tam * (2.2 + 2.6 * (1 - Math.pow(1 - t, 2)));
        ctx.globalAlpha = Math.sin(t * Math.PI) * 0.85;
        ctx.drawImage(sprite(s.oro ? ORO : paleta.pulso), s.x - tam, s.y - tam, tam * 2, tam * 2);
      }
      ctx.globalAlpha = 1;
    }

    return {
      tam(w, h, escala) {
        if (!w || !h) return;
        dpr = Math.min(escala || 1, modesto ? 1 : 1.5);
        const cambio = w !== W || h !== H;
        W = w; H = h;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        if (!cambio && P.length) return;
        dist = W < 600 ? 112 : 145;
        dist2 = dist * dist;
        const objetivo = cantidadObjetivo();
        while (P.length < objetivo) P.push(nueva(Math.random() * W, Math.random() * H));
        if (P.length > objetivo) P.length = objetivo;
        for (const p of P) { p.x = Math.min(p.x, W); p.y = Math.min(p.y, H); }
      },
      tema(nombre, inmediato) {
        const destino = PALETAS[nombre] || PALETAS.oscuro;
        if (inmediato) { paleta = copiarPaleta(destino); tPaleta = 1; hacia = null; return; }
        desde = copiarPaleta(paleta); hacia = destino; tPaleta = 0;
      },
      puntero(p) { raton = p; },
      // paso = milisegundos entre cuadros (lo decide el director segun la
      // actividad). Devuelve true si dibujo.
      cuadro(ahora, paso) {
        if (!W || !H) return false;
        const d = ahora - ultimo;
        if (d < paso - 2) return false;
        ultimo = ahora;
        actualizar(Math.min(d, 100) / 1000, ahora);
        dibujar();
        return true;
      },
      quieto() { if (W && H) { actualizar(0, 0); pulsos.length = 0; dibujar(); } },
      reiniciarReloj() { ultimo = 0; }
    };
  }

  /* =======================================================================
   * 2. ONDAS FACETADAS (WebGL)
   * ======================================================================= */
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";
  const FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec2 u_res;uniform float u_t;uniform vec2 u_m;uniform float u_alfa;uniform float u_brillo;uniform vec3 u_base;",
    // Altura de la superficie: tres ondas cruzadas (el "mar" de Vanta WAVES).
    "float h(vec2 q){return .30*sin(q.x*.85+u_t*.55)+.22*sin(q.y*1.25-u_t*.42+q.x*.35)+.14*sin((q.x+q.y)*1.9+u_t*.75);}",
    "vec3 v(vec2 q){return vec3(q.x,h(q),q.y);}",
    "void main(){",
    "  vec2 uv=gl_FragCoord.xy/u_res;",
    "  float asp=u_res.x/u_res.y;",
    // Plano en perspectiva: abajo cerca, arriba lejos.
    "  float prof=1.0/(1.0-.74*uv.y);",
    "  vec2 w=vec2((uv.x-.5)*asp*prof*2.3+u_m.x*.35,prof*2.5+u_t*.05+u_m.y*.2);",
    // Facetas triangulares con sombreado plano, como la malla de Vanta.
    "  float s=.40;vec2 g=w/s;vec2 i=floor(g);vec2 f=fract(g);",
    "  vec3 a;vec3 b;vec3 c;",
    "  if(f.x+f.y<1.0){a=v(i*s);b=v((i+vec2(1.0,0.0))*s);c=v((i+vec2(0.0,1.0))*s);}",
    "  else{a=v((i+vec2(1.0,1.0))*s);b=v((i+vec2(0.0,1.0))*s);c=v((i+vec2(1.0,0.0))*s);}",
    "  vec3 n=normalize(cross(c-a,b-a));if(n.y<0.0)n=-n;",
    "  vec3 L=normalize(vec3(-.35,.85,.40));vec3 V=normalize(vec3(0.0,.75,-.66));",
    "  float dif=max(dot(n,L),0.0);",
    "  float spe=pow(max(dot(reflect(-L,n),V),0.0),18.0);",
    "  vec3 col=u_base*(.38+.62*dif)+vec3(1.0)*spe*.55;",
    // Gris con brillo .72 y opacidad .3: los valores de la propuesta (filter: grayscale(1) brightness(.72)).
    "  float lum=dot(col,vec3(.299,.587,.114))*u_brillo;",
    "  float niebla=clamp((prof-1.0)/3.0,0.0,1.0);",
    "  float al=u_alfa*(1.0-.55*niebla);",
    "  gl_FragColor=vec4(vec3(lum)*al,al);",
    "}"
  ].join("\n");

  function crearOndas(canvas, op) {
    const modesto = !!op.modesto;
    let gl = null;
    try {
      gl = canvas.getContext("webgl", {
        alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
        stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false
      });
    } catch (e) { gl = null; }
    if (!gl) return null;

    const ESCALA = modesto ? 0.35 : 0.5; // media resolucion: la superficie es suave
    let W = 0, H = 0, ultimo = 0, perdido = false;
    let mx = 0, my = 0, objX = 0, objY = 0;
    const t0 = ahoraMs() - Math.random() * 20000;
    let u = {};

    function compilar(tipo, fuente) {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, fuente);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader");
      return s;
    }
    function preparar() {
      const prog = gl.createProgram();
      gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("programa");
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      u = {};
      ["u_res", "u_t", "u_m", "u_alfa", "u_brillo", "u_base"].forEach((n) => { u[n] = gl.getUniformLocation(prog, n); });
      gl.uniform1f(u.u_alfa, 0.3);
      gl.uniform1f(u.u_brillo, 0.72);
      gl.uniform3f(u.u_base, 0x34 / 255, 0x48 / 255, 0x58 / 255); // #344858 de la propuesta
      gl.uniform2f(u.u_res, canvas.width || 1, canvas.height || 1);
    }
    try { preparar(); } catch (e) { return null; }

    if (canvas.addEventListener) {
      canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); perdido = true; });
      canvas.addEventListener("webglcontextrestored", () => {
        try { preparar(); perdido = false; } catch (er) { perdido = true; }
      });
    }

    function dibujar(ahora) {
      if (perdido || !W) return;
      mx += (objX - mx) * 0.04; my += (objY - my) * 0.04;
      gl.uniform1f(u.u_t, ((ahora - t0) / 1000) % 6283.0);
      gl.uniform2f(u.u_m, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return {
      tam(w, h) {
        if (!w || !h) return;
        W = w; H = h;
        const cw = Math.max(1, Math.round(w * ESCALA)), ch = Math.max(1, Math.round(h * ESCALA));
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
        gl.viewport(0, 0, cw, ch);
        gl.uniform2f(u.u_res, cw, ch);
      },
      puntero(p) {
        if (!p || !W) { objX = 0; objY = 0; return; }
        objX = (p.x / W - 0.5) * 2;
        objY = (p.y / H - 0.5) * 2;
      },
      cuadro(ahora, paso) {
        if (ahora - ultimo < paso - 2) return false;
        ultimo = ahora;
        dibujar(ahora);
        return true;
      },
      quieto() { dibujar(t0 + 4000); }
    };
  }

  /* =======================================================================
   * 3. DIRECTOR: un solo bucle para los dos motores (en el Worker o aqui).
   * ======================================================================= */
  function crearDirector(op) {
    const reducido = !!op.reducido;
    const programar = global.requestAnimationFrame
      ? (cb) => global.requestAnimationFrame(cb)
      : (cb) => setTimeout(() => cb(ahoraMs()), 33);
    const cancelar = global.cancelAnimationFrame ? (id) => global.cancelAnimationFrame(id) : (id) => clearTimeout(id);
    const avisar = op.avisar || (() => {});

    let red = null, ondas = null, ondasIntentadas = false;
    let quiereRed = true, quiereOndas = false, visible = true, pedido = 0;
    let W = 0, H = 0;

    // Cuadros por segundo segun la actividad: con el raton moviendose la red
    // responde a 30 cuadros/s (la deriva es de 3 a 12 px/s, a 20 se ve igual
    // de fluida); en reposo 20; tras 45 s sin actividad, 12. En equipos
    // modestos un escalon menos.
    let ultimaActividad = ahoraMs(), ultimoPuntero = 0;
    const FPS = op.modesto ? [20, 15, 10] : [30, 20, 12];
    function pasoActual(ahora) {
      if (ahora - ultimoPuntero < 2500) return 1000 / FPS[0];
      if (ahora - ultimaActividad < 45000) return 1000 / FPS[1];
      return 1000 / FPS[2];
    }

    if (op.red) {
      let ctx = null;
      try { ctx = op.red.getContext("2d"); } catch (e) { ctx = null; }
      if (ctx) red = crearRed(op.red, ctx, op);
      else avisar({ tipo: "sin-red" });
    }

    // WebGL se crea recien la primera vez que una escena lo pide (docente).
    function asegurarOndas() {
      if (ondas || ondasIntentadas || !op.ondas) return;
      ondasIntentadas = true;
      ondas = crearOndas(op.ondas, op);
      if (!ondas) { avisar({ tipo: "sin-ondas" }); return; }
      if (W) ondas.tam(W, H);
    }

    const activo = () => visible && ((quiereRed && red) || (quiereOndas && ondas));
    function pintarQuieto() {
      if (quiereRed && red) red.quieto();
      if (quiereOndas && ondas) ondas.quieto();
    }
    function cuadro(ahora) {
      pedido = 0;
      if (!activo()) return;
      const paso = pasoActual(ahora);
      if (quiereRed && red) red.cuadro(ahora, paso);
      if (quiereOndas && ondas) ondas.cuadro(ahora, paso);
      pedido = programar(cuadro);
    }
    function arrancar() {
      if (reducido) { pintarQuieto(); return; }
      if (!pedido && activo()) {
        if (red) red.reiniciarReloj();
        pedido = programar(cuadro);
      }
    }
    function detener() { if (pedido) { cancelar(pedido); pedido = 0; } }

    return {
      tam(w, h, escala) {
        W = w; H = h;
        if (red) red.tam(w, h, escala || 1);
        if (ondas) ondas.tam(w, h);
        // Cambiar el tamano borra el lienzo: un cuadro inmediato evita el parpadeo.
        pintarQuieto();
      },
      escena(e) {
        ultimaActividad = ahoraMs();
        quiereRed = !!e.red;
        quiereOndas = !!e.ondas;
        if (quiereOndas) asegurarOndas();
        if (red && e.tema) red.tema(e.tema, reducido);
        if (activo()) arrancar(); else detener();
      },
      visible(si) {
        visible = !!si;
        if (visible) ultimaActividad = ahoraMs();
        if (activo()) arrancar(); else detener();
      },
      puntero(p) {
        if (p) ultimaActividad = ultimoPuntero = ahoraMs();
        if (red) red.puntero(p);
        if (ondas) ondas.puntero(p);
      }
    };
  }

  /* =======================================================================
   * 4a. Dentro del Worker: recibe los lienzos y obedece mensajes.
   * ======================================================================= */
  if (enTrabajador) {
    let director = null;
    global.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.tipo === "iniciar") {
        director = crearDirector({
          red: m.red, ondas: m.ondas, modesto: m.modesto, reducido: m.reducido, tema: m.tema,
          avisar: (msg) => global.postMessage(msg)
        });
        director.tam(m.w, m.h, m.dpr);
        director.escena(m.escena || { red: true, tema: m.tema });
        return;
      }
      if (!director) return;
      if (m.tipo === "tam") director.tam(m.w, m.h, m.dpr);
      else if (m.tipo === "escena") director.escena(m.escena);
      else if (m.tipo === "visible") director.visible(m.si);
      else if (m.tipo === "puntero") director.puntero(m.p);
    };
    return;
  }

  /* =======================================================================
   * 4b. En la pagina: decide Worker u hilo principal y vigila tamano,
   *     visibilidad y puntero.
   * ======================================================================= */
  function equipoModesto() {
    const hilos = navigator.hardwareConcurrency || 8;
    const memoria = navigator.deviceMemory || 8;
    return hilos <= 4 || memoria <= 4;
  }
  function movimientoReducido() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function iniciar(op) {
    const lienzoRed = op.red || null;
    const lienzoOndas = op.ondas || null;
    const modesto = op.modesto != null ? !!op.modesto : equipoModesto();
    const reducido = movimientoReducido();
    const anfitrion = op.anfitrion || (lienzoRed && lienzoRed.parentElement) || document.body;
    const inicial = op.escena || { red: true, ondas: false, tema: "oscuro" };
    let enPantalla = true, ultimaEscena = inicial;
    let worker = null, local = null;

    const medir = () => ({ w: anfitrion.clientWidth, h: anfitrion.clientHeight, dpr: window.devicePixelRatio || 1 });
    function alAviso(msg) {
      if (!msg) return;
      if (msg.tipo === "sin-ondas" && lienzoOndas) lienzoOndas.classList.add("sin-motor");
      if (msg.tipo === "sin-red" && lienzoRed) lienzoRed.classList.add("sin-motor");
      if (typeof op.alAviso === "function") op.alAviso(msg);
    }

    const puedeTransferir = op.urlTrabajador && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
      && lienzoRed && typeof lienzoRed.transferControlToOffscreen === "function";
    if (puedeTransferir) {
      let red = null;
      try {
        worker = new Worker(op.urlTrabajador);
        red = lienzoRed.transferControlToOffscreen();
        const ondas = (lienzoOndas && lienzoOndas.transferControlToOffscreen) ? lienzoOndas.transferControlToOffscreen() : null;
        const t = medir();
        worker.onmessage = (ev) => alAviso(ev.data);
        worker.onerror = () => alAviso({ tipo: "sin-red" });
        worker.postMessage({
          tipo: "iniciar", red, ondas, modesto, reducido, tema: inicial.tema,
          escena: inicial, w: t.w, h: t.h, dpr: t.dpr
        }, ondas ? [red, ondas] : [red]);
      } catch (e) {
        if (worker) worker.terminate();
        worker = null;
        // Si el lienzo ya se habia transferido no se puede reusar: sin red (queda el fondo).
        if (red) alAviso({ tipo: "sin-red" });
        else local = null;
      }
    }
    if (!worker && !(lienzoRed && lienzoRed.classList.contains("sin-motor"))) {
      local = crearDirector({ red: lienzoRed, ondas: lienzoOndas, modesto, reducido, tema: inicial.tema, avisar: alAviso });
      const t = medir();
      local.tam(t.w, t.h, t.dpr);
      local.escena(inicial);
    }
    function enviar(msg) {
      if (worker) { worker.postMessage(msg); return; }
      if (!local) return;
      if (msg.tipo === "tam") local.tam(msg.w, msg.h, msg.dpr);
      else if (msg.tipo === "escena") local.escena(msg.escena);
      else if (msg.tipo === "visible") local.visible(msg.si);
      else if (msg.tipo === "puntero") local.puntero(msg.p);
    }

    // Tamano
    let ultimoTam = "";
    const avisarTam = () => {
      const t = medir();
      const clave = t.w + "x" + t.h + "@" + t.dpr;
      if (clave === ultimoTam || !t.w || !t.h) return;
      ultimoTam = clave;
      enviar({ tipo: "tam", w: t.w, h: t.h, dpr: t.dpr });
    };
    ultimoTam = (() => { const t = medir(); return t.w + "x" + t.h + "@" + t.dpr; })();
    if (window.ResizeObserver) new ResizeObserver(avisarTam).observe(anfitrion);
    else window.addEventListener("resize", avisarTam);

    // Visibilidad: pestana oculta, o el visor fuera de la vista (la pagina de
    // Moodle se desplazo hacia las secciones): el fondo se detiene.
    let pausadoAPedido = false;
    const avisarVisible = () => enviar({ tipo: "visible", si: enPantalla && !pausadoAPedido && !document.hidden });
    document.addEventListener("visibilitychange", avisarVisible);
    if (window.IntersectionObserver) {
      new IntersectionObserver((e) => { enPantalla = e[e.length - 1].isIntersecting; avisarVisible(); }).observe(anfitrion);
    }

    // Puntero: solo raton (en tactil no hay "hover"), un aviso por cuadro como maximo.
    if (!reducido) {
      let pendiente = null, programado = false;
      const despachar = () => { programado = false; enviar({ tipo: "puntero", p: pendiente }); };
      const pedir = () => { if (!programado) { programado = true; requestAnimationFrame(despachar); } };
      window.addEventListener("pointermove", (e) => {
        if (e.pointerType && e.pointerType !== "mouse") return;
        const r = anfitrion.getBoundingClientRect();
        pendiente = { x: e.clientX - r.left, y: e.clientY - r.top };
        pedir();
      }, { passive: true });
      const soltar = () => { pendiente = null; pedir(); };
      document.documentElement.addEventListener("pointerleave", soltar);
      window.addEventListener("blur", soltar);
    }

    return {
      enTrabajador: !!worker,
      escena(e) {
        if (!e) return;
        const n = { red: !!e.red, ondas: !!e.ondas, tema: e.tema || "oscuro" };
        if (ultimaEscena && n.red === !!ultimaEscena.red && n.ondas === !!ultimaEscena.ondas && n.tema === ultimaEscena.tema) return;
        ultimaEscena = n;
        enviar({ tipo: "escena", escena: n });
      },
      pausar() { pausadoAPedido = true; avisarVisible(); },
      reanudar() { pausadoAPedido = false; avisarVisible(); }
    };
  }

  global.FondoIncca = { iniciar, equipoModesto };
})(typeof self !== "undefined" ? self : this);
