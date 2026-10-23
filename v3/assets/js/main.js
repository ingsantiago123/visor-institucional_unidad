/*!
 * U.INCCA · Visor de unidad v3 (3.0.1) — JavaScript propio, sin dependencias.
 * ---------------------------------------------------------------------
 * Mismo contrato que v2 (todo llega como UN objeto JSON en window.name,
 * lo imprime local_visorincca en el atributo name del iframe):
 *
 *   unidad, titulo, descripcion, duracion_estimada, volver_url, origen_padre,
 *   fondos (opcional, igual que el visor de curso),
 *   recursos[{id, tipo, titulo, visible, orden, ...}] con tipo:
 *     texto{parrafos[], items[{titulo,descripcion}]}
 *     video-grid{items[{titulo,url,portada}]} · video{url,portada}
 *     documento{documento_titulo,iframe_url,enlace_url,adjunto{titulo,url,icono}}
 *     enlaces{items[{titulo,url,fuente}]}
 *     lecturas{variante:"apoyo"|"complementarias",descripcion,items[{titulo,url,embebido,audio_url,fuente}]}
 *     multimedia{videos[{titulo,url,portada}], lecturas[{titulo,url,fuente}]}   <- nuevo en v3 (plantilla nueva)
 *     actividades{items[{nombre,link,tipo,descripcion,descripcion_html}]}
 *     personalizado{iframe|html}
 *
 * Diseno: el del visor de curso (recurso v4), segun el sistema de diseno
 * INCCA: UN escenario para todo el mazo (foto + velo + red de particulas en
 * un Worker), diapositivas transparentes encima con tono oscuro o claro,
 * titulos con subrayado degradado, paneles azules, play de vidrio, botones
 * pildora y entradas escalonadas. Cada recurso es una diapositiva; la
 * primera es el inicio de la unidad con el mismo emblema que el estudiante
 * ve en las unidades del curso.
 *
 * Puente con Moodle (protocolo 2, sin cambios frente a v2): "visor-listo"
 * (tipo "unidad"), "visor-error" y "volver-unidades" / "unidades-cerrado".
 * ------------------------------------------------------------------- */
(function () {
  "use strict";

  const VERSION = "3.0.1";
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const reducido = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ---------------------------------------------------------------------
   * 0. Texto seguro: TODO texto del JSON entra escapado (decodificar()
   *    deshace las entidades de format_string y esc() vuelve a escapar).
   *    Solo personalizado.html y descripcion_html se insertan tal cual
   *    (HTML de confianza armado por el plugin).
   * ------------------------------------------------------------------- */
  const decodificador = document.createElement("textarea");
  function decodificar(s) {
    const str = String(s == null ? "" : s);
    if (str.indexOf("&") === -1) return str;
    decodificador.innerHTML = str; // textarea: no interpreta HTML ni ejecuta nada
    return decodificador.value;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function texto(s) { return esc(decodificar(s)); }
  function tieneTexto(s) { return /[\p{L}\p{N}]/u.test(decodificar(s)); }
  function urlSegura(u) {
    const s = decodificar(u).trim();
    if (!s) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) return "#";
    return s;
  }
  function attrUrl(u) { return esc(urlSegura(u)); }
  function icono(nombre, defecto) {
    const n = String(nombre || "").trim();
    return /^fa-[a-z0-9-]+$/i.test(n) ? n : defecto;
  }
  const dos = (n) => String(n).padStart(2, "0");

  /* ---------------------------------------------------------------------
   * 0b. Puente con la pagina que embebe el visor -- protocolo 2.
   *     postMessage solo a window.parent (ese curso, esa seccion); solo se
   *     aceptan mensajes de esa ventana; nada en localStorage.
   * ------------------------------------------------------------------- */
  const PROTOCOLO = 2;
  const puente = { estado: "desconocido", capacidades: [], origen: "" };
  let origenPadre = "";
  const embebido = window.parent && window.parent !== window;

  function enviarAlPadre(msg) {
    if (!embebido) return;
    try {
      window.parent.postMessage(Object.assign({ source: "visorincca", v: PROTOCOLO }, msg),
        puente.origen || origenPadre || "*");
    } catch (e) { /* origen distinto al esperado: el navegador lo descarta */ }
  }
  function mensajeDelPadre(ev) {
    if (!embebido || ev.source !== window.parent) return null;
    if (origenPadre && ev.origin !== origenPadre) return null;
    const d = ev.data;
    return (d && typeof d === "object" && d.source === "visorincca") ? d : null;
  }
  function puenteTiene(capacidad) {
    return puente.estado === "presente" && puente.capacidades.indexOf(capacidad) !== -1;
  }
  function iniciarSaludo(tipo) {
    if (!embebido) return;
    window.addEventListener("message", (ev) => {
      const d = mensajeDelPadre(ev);
      if (!d || d.type !== "puente-listo") return;
      puente.estado = "presente";
      puente.capacidades = Array.isArray(d.capacidades) ? d.capacidades.map(String) : [];
      puente.origen = ev.origin;
    });
    [0, 500, 1500, 3000].forEach((ms) => setTimeout(() => {
      if (puente.estado === "desconocido") enviarAlPadre({ type: "visor-listo", tipo });
    }, ms));
  }
  let erroresReportados = 0;
  const AVISO_BENIGNO = /ResizeObserver loop|Script error\.?$/i;
  function reportarError(etapa, err) {
    const mensaje = String((err && err.message) || err || "").slice(0, 200);
    if (etapa === "global" && AVISO_BENIGNO.test(mensaje)) return;
    if (window.console) console.warn("[visorincca] fallo en " + etapa + ": " + mensaje);
    if (++erroresReportados <= 5) enviarAlPadre({ type: "visor-error", etapa: String(etapa).slice(0, 60), mensaje });
  }
  // Cada paso del arranque va aislado: si uno falla, los demas siguen.
  function paso(etapa, fn) {
    try { return fn(); } catch (e) { reportarError(etapa, e); return undefined; }
  }
  function marcarEquipoModesto() {
    const hilos = navigator.hardwareConcurrency || 8;
    const memoria = navigator.deviceMemory || 8;
    const modesto = hilos <= 4 || memoria <= 4;
    if (modesto) document.documentElement.classList.add("equipo-modesto");
    return modesto;
  }
  window.addEventListener("error", (ev) => reportarError("global", ev.error || ev.message));

  /* ---------------------------------------------------------------------
   * 1. Contrato de datos (igual que v2 + "multimedia")
   * ------------------------------------------------------------------- */
  const SIN_DATOS = {
    unidad: "Nombre de la unidad",
    descripcion: "Aquí aparecerá la descripción de esta unidad."
  };
  const TIPOS_VALIDOS = ["texto", "video-grid", "video", "documento", "enlaces", "lecturas", "multimedia", "actividades", "personalizado"];
  const TITULO_DEFECTO = {
    texto: "Lectura", "video-grid": "Videos", video: "Video", documento: "Documento", enlaces: "Enlaces complementarios",
    lecturas: "Lecturas", multimedia: "Multimedia complementaria", actividades: "Actividades", personalizado: "Recurso"
  };
  // Por tipo: icono de la barra, etiqueta de la diapositiva y escena del escenario.
  const META = {
    texto: { icon: "fa-book-open", etiqueta: "Lectura", escena: "lectura" },
    "video-grid": { icon: "fa-clapperboard", etiqueta: "Videos", escena: "videos" },
    video: { icon: "fa-circle-play", etiqueta: "Video destacado", escena: "destacado" },
    documento: { icon: "fa-file-lines", etiqueta: "Documento", escena: "documento" },
    enlaces: { icon: "fa-link", etiqueta: "Referencias", escena: "enlaces" },
    lecturas: { icon: "fa-book-open-reader", etiqueta: "Lecturas de apoyo", escena: "lecturas" },
    complementarias: { icon: "fa-book-bookmark", etiqueta: "Lecturas complementarias", escena: "enlaces" },
    multimedia: { icon: "fa-photo-film", etiqueta: "Videos y lecturas", escena: "multimedia" },
    actividades: { icon: "fa-list-check", etiqueta: "Actividades", escena: "actividades" },
    personalizado: { icon: "fa-puzzle-piece", etiqueta: "Recurso", escena: "documento" }
  };

  const ACT_TYPES = ["quiz", "tarea", "foro", "taller", "entrega", "examen"];
  const ACT_TYPE_META = {
    quiz: { label: "Quiz", icon: "fa-circle-question" },
    tarea: { label: "Tarea", icon: "fa-file-pen" },
    foro: { label: "Foro", icon: "fa-comments" },
    taller: { label: "Taller", icon: "fa-screwdriver-wrench" },
    entrega: { label: "Entrega", icon: "fa-cloud-arrow-up" },
    examen: { label: "Examen", icon: "fa-file-circle-check" }
  };
  function inferActType(tipo, link) {
    if (ACT_TYPES.indexOf(tipo) !== -1) return tipo;
    const l = String(link || "").toLowerCase();
    if (l.indexOf("mod/quiz/") !== -1) return "quiz";
    if (l.indexOf("mod/forum/") !== -1) return "foro";
    if (l.indexOf("mod/workshop/") !== -1) return "taller";
    return "tarea";
  }

  function leerDatos() {
    if ("__visorDatos" in window) return window.__visorDatos;
    try {
      const d = window.name ? JSON.parse(window.name) : null;
      return d && typeof d === "object" && !Array.isArray(d) ? d : null;
    } catch (e) { return null; }
  }

  // Fondos propios (opcionales): solo URL absolutas http(s).
  const RANURAS = ["general", "hero"];
  const urlFondo = (u) => ((typeof u === "string" && /^https?:\/\//i.test(u.trim())) ? u.trim() : "");
  function normalizarFondos(f) {
    const out = {};
    if (!f || typeof f !== "object" || Array.isArray(f)) return out;
    RANURAS.forEach((k) => {
      const v = f[k];
      if (typeof v === "string") {
        if (urlFondo(v)) out[k] = { original: urlFondo(v) };
      } else if (v && typeof v === "object") {
        const o = {};
        ["original", "oscuro", "claro"].forEach((t) => { if (urlFondo(v[t])) o[t] = urlFondo(v[t]); });
        if (Object.keys(o).length) out[k] = o;
      }
    });
    return out;
  }

  const lista = (arr, fn) => (Array.isArray(arr) ? arr : []).filter(Boolean).map(fn);

  // Cada recurso se completa campo a campo; "video" queda como un solo item destacado.
  function mergeRecurso(raw, idx) {
    const r = (raw && typeof raw === "object") ? raw : {};
    const tipo = TIPOS_VALIDOS.indexOf(r.tipo) !== -1 ? r.tipo : null;
    if (!tipo) return null; // tipo desconocido: se omite, no rompe el resto
    const base = {
      id: (r.id && String(r.id)) || `recurso-${idx + 1}`,
      tipo,
      titulo: tieneTexto(r.titulo) ? r.titulo : TITULO_DEFECTO[tipo],
      visible: r.visible !== false,
      orden: Number.isFinite(r.orden) ? r.orden : idx
    };
    const video = (it) => ({ titulo: it.titulo || "", url: it.url || "", portada: it.portada || "" });
    const enlace = (it) => ({ titulo: it.titulo || "", url: it.url || "#", fuente: it.fuente || "" });
    switch (tipo) {
      case "texto":
        return Object.assign(base, {
          parrafos: (Array.isArray(r.parrafos) ? r.parrafos : []).filter(tieneTexto),
          items: lista(r.items, (it) => ({ titulo: it.titulo || "", descripcion: it.descripcion || "" }))
        });
      case "video-grid":
        return Object.assign(base, { items: lista(r.items, video) });
      case "video":
        return Object.assign(base, { items: [video({ titulo: r.titulo, url: r.url, portada: r.portada })] });
      case "documento":
        return Object.assign(base, {
          documento_titulo: r.documento_titulo || "",
          iframe_url: r.iframe_url || "",
          enlace_url: r.enlace_url || "",
          adjunto: (r.adjunto && typeof r.adjunto === "object" && r.adjunto.url)
            ? { titulo: r.adjunto.titulo || "Adjunto", url: r.adjunto.url, icono: r.adjunto.icono || "fa-paperclip" } : null
        });
      case "enlaces":
        return Object.assign(base, { items: lista(r.items, enlace) });
      case "lecturas":
        return Object.assign(base, {
          variante: r.variante === "complementarias" ? "complementarias" : "apoyo",
          descripcion: r.descripcion || "",
          items: lista(r.items, (it) => ({
            titulo: it.titulo || "", url: it.url || "#", embebido: !!it.embebido,
            audio_url: it.audio_url || "", fuente: it.fuente || ""
          }))
        });
      case "multimedia":
        return Object.assign(base, { items: lista(r.videos, video), lecturas: lista(r.lecturas, enlace) });
      case "actividades":
        return Object.assign(base, {
          items: lista(r.items, (it) => ({
            nombre: it.nombre || "", link: it.link || "", descripcion: it.descripcion || "",
            descripcionHtml: !!it.descripcion_html, tipoActividad: inferActType(it.tipo, it.link)
          }))
        });
      case "personalizado":
        return Object.assign(base, { iframe: r.iframe || "", html: r.html || "" });
    }
    return null;
  }

  function metaDe(r) {
    if (r.tipo === "lecturas" && r.variante === "complementarias") return META.complementarias;
    return META[r.tipo] || META.personalizado;
  }

  function obtenerDatos() {
    const recibidos = leerDatos() || {};
    // Los textos de relleno son SOLO para la vista suelta (sin window.name):
    // con datos de Moodle, un campo vacio queda vacio y se oculta.
    const sinNingunDato = Object.keys(recibidos).length === 0;
    const cadena = (v, campo) => (typeof v === "string" && tieneTexto(v)) ? v : (sinNingunDato ? (SIN_DATOS[campo] || "") : "");
    return {
      ejemplo: sinNingunDato,
      origen_padre: typeof recibidos.origen_padre === "string" ? recibidos.origen_padre : "",
      unidad: cadena(recibidos.unidad, "unidad"),
      titulo: cadena(recibidos.titulo, "titulo"),
      descripcion: cadena(recibidos.descripcion, "descripcion"),
      duracion_estimada: cadena(recibidos.duracion_estimada, "duracion_estimada"),
      volver_url: typeof recibidos.volver_url === "string" ? recibidos.volver_url : "",
      fondos: normalizarFondos(recibidos.fondos),
      recursos: (Array.isArray(recibidos.recursos) ? recibidos.recursos : [])
        .map(mergeRecurso).filter(Boolean).filter((r) => r.visible)
        .sort((a, b) => a.orden - b.orden)
    };
  }

  /* ---------------------------------------------------------------------
   * 2. URLs de video (mismas reglas que utils::normalizar_url_embebible)
   * ------------------------------------------------------------------- */
  function toEmbedUrl(url) {
    url = urlSegura(url);
    if (!url || url === "#") return "";
    let m = url.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed|shorts|live|v)\/)([\w-]{11})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = url.match(/youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{11})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    m = url.match(/drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([\w-]+)/) || url.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/);
    if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
    m = url.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/(?:u\/\d+\/)?d\/([\w-]+)/);
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/preview`;
    return url;
  }
  function miniaturaVideo(embed) {
    let m = embed.match(/youtube\.com\/embed\/([\w-]{11})/);
    if (m) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
    m = embed.match(/drive\.google\.com\/file\/d\/([\w-]+)\/preview/);
    if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w960`;
    return "";
  }
  function conAutoplay(embed) {
    if (!/youtube\.com\/embed\/|player\.vimeo\.com\/video\//.test(embed)) return embed;
    return embed + (embed.indexOf("?") === -1 ? "?" : "&") + "autoplay=1";
  }
  function origenVideo(embed) {
    if (/youtube(?:-nocookie)?\.com\/embed\//.test(embed)) return "youtube";
    if (/player\.vimeo\.com\//.test(embed)) return "vimeo";
    if (/drive\.google\.com\/file\/d\//.test(embed)) return "drive";
    if (/docs\.google\.com\//.test(embed)) return "docs";
    return "otro";
  }
  function enlaceExterno(embed) {
    let m = embed.match(/drive\.google\.com\/file\/d\/([\w-]+)\/preview/);
    if (m) return `https://drive.google.com/file/d/${m[1]}/view`;
    m = embed.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)\/preview/);
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/view`;
    return "";
  }

  /* ---------------------------------------------------------------------
   * 3. Medios bajo demanda, lectura y dialogos (los del visor de curso)
   * ------------------------------------------------------------------- */
  function cargarImagenes(raiz) {
    if (!raiz) return;
    $$("img[data-src]", raiz).forEach((img) => {
      const url = img.dataset.src;
      delete img.dataset.src;
      // Una miniatura que no carga (Drive privado, YouTube borrado) deja el degradado de la tarjeta.
      img.addEventListener("error", () => img.remove(), { once: true });
      img.src = url;
    });
  }
  function activarMedios(slideEl) {
    if (!slideEl) return;
    cargarImagenes(slideEl);
    $$("iframe[data-diferido]", slideEl).forEach((f) => {
      if (f.getAttribute("src") !== f.dataset.diferido) {
        f.setAttribute("src", f.dataset.diferido);
        delete f.dataset.vigilado;
      }
    });
    paso("bloqueador", () => vigilarEmbeds(slideEl));
  }
  function desactivarMedios(slideEl) {
    if (!slideEl) return;
    $$("iframe[data-diferido]", slideEl).forEach((f) => {
      if (f.hasAttribute("src")) { f.src = "about:blank"; f.removeAttribute("src"); }
    });
  }

  function medirLectura(el) {
    if (!el || !el.isConnected) return;
    const desborda = el.scrollHeight > el.clientHeight + 4;
    el.classList.toggle("desborda", desborda);
    if (!desborda) { el.removeAttribute("tabindex"); return; }
    el.tabIndex = 0; // region con desplazamiento: alcanzable con el teclado
  }
  const vigiaLectura = window.ResizeObserver ? new ResizeObserver((e) => e.forEach((x) => medirLectura(x.target))) : null;
  function initLecturas() {
    $$(".lectura").forEach((el) => {
      el.addEventListener("scroll", () => medirLectura(el), { passive: true });
      if (vigiaLectura) vigiaLectura.observe(el);
      medirLectura(el);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => $$(".lectura").forEach(medirLectura));
  }

  let disparadorDialogo = null;
  function abrirDialogo(d, disparador) {
    disparadorDialogo = disparador || document.activeElement;
    if (escenario.motor) escenario.motor.pausar();
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  function cerrarDialogo(d) {
    if (typeof d.close === "function") d.close(); else { d.removeAttribute("open"); d.dispatchEvent(new Event("close")); }
  }
  function alCerrarDialogo() {
    if (!document.querySelector("dialog[open]") && escenario.motor) escenario.motor.reanudar();
    if (disparadorDialogo && disparadorDialogo.isConnected && typeof disparadorDialogo.focus === "function") {
      disparadorDialogo.focus({ preventScroll: true });
    }
    disparadorDialogo = null;
  }

  function abrirVideo(url, titulo, disparador) {
    const embed = toEmbedUrl(url);
    if (!embed) return;
    const d = $("#dialogoVideo");
    const origen = origenVideo(embed);
    const nombre = decodificar(titulo) || "Video";
    $("#dialogoVideoTitulo").textContent = nombre;
    const externo = enlaceExterno(embed);
    const enlace = $("#dialogoVideoExterno");
    enlace.hidden = !externo;
    if (externo) {
      enlace.href = externo;
      $("span", enlace).textContent = origen === "docs" ? "Abrir en Google Docs" : "Abrir en Google Drive";
    }
    $("#dialogoVideoNota").hidden = origen !== "drive";
    const pantalla = $("#dialogoVideoPantalla");
    pantalla.dataset.origen = origen;
    const f = document.createElement("iframe");
    f.title = nombre;
    f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    f.setAttribute("allowfullscreen", "");
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.src = conAutoplay(embed);
    pantalla.replaceChildren(f);
    abrirDialogo(d, disparador);
  }

  // op: { titulo, bajada, html (de confianza o ya escapado), iframe, medio, acciones:[{href, texto, icono, principal}] }
  function abrirContenido(op, disparador) {
    const d = $("#dialogoContenido");
    $("#dialogoContenidoTitulo").textContent = decodificar(op.titulo || "");
    const bajada = $("#dialogoContenidoBajada");
    bajada.textContent = decodificar(op.bajada || "");
    bajada.hidden = !op.bajada;
    const cuerpo = $("#dialogoContenidoCuerpo");
    cuerpo.className = "dialogo-cuerpo";
    d.classList.toggle("es-medio", !!op.medio);
    if (op.iframe) {
      const f = document.createElement("iframe");
      f.title = decodificar(op.titulo || "Recurso");
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.setAttribute("allowfullscreen", "");
      f.referrerPolicy = "strict-origin-when-cross-origin";
      f.src = op.iframe;
      cuerpo.replaceChildren(f);
      paso("bloqueador", () => vigilarEmbed(f));
    } else {
      if (op.medio) cuerpo.classList.add("es-html");
      cuerpo.innerHTML = op.html || "";
    }
    const pie = $("#dialogoContenidoPie");
    pie.innerHTML = (op.acciones || []).filter((a) => a && urlSegura(a.href) && urlSegura(a.href) !== "#").map((a) =>
      `<a class="boton ${a.principal ? "boton--marea" : "boton--fantasma"}" href="${attrUrl(a.href)}" target="_blank" rel="noopener">
        <i class="fa-solid ${icono(a.icono, "fa-arrow-up-right-from-square")}" aria-hidden="true"></i> ${texto(a.texto || "Abrir")}</a>`).join("");
    pie.hidden = !pie.innerHTML;
    abrirDialogo(d, disparador);
  }

  function initDialogos() {
    [$("#dialogoVideo"), $("#dialogoContenido")].forEach((d) => {
      $$("[data-cerrar]", d).forEach((b) => b.addEventListener("click", () => cerrarDialogo(d)));
      d.addEventListener("click", (e) => {
        if (e.target !== d) return;
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cerrarDialogo(d);
      });
      d.addEventListener("close", () => {
        // Se destruye lo que tenga dentro: el video deja de sonar.
        if (d.id === "dialogoVideo") $("#dialogoVideoPantalla").replaceChildren();
        else { $("#dialogoContenidoCuerpo").replaceChildren(); $("#dialogoContenidoPie").replaceChildren(); }
        alCerrarDialogo();
      });
    });
  }

  /* ---------------------------------------------------------------------
   * 4. Escenario: el mismo motor del visor de curso. Cada escena dice que
   *    color base, que velo, que foto (y con que opacidad) y si lleva red.
   * ------------------------------------------------------------------- */
  const DEFECTO = {
    oscuro: { src: "./assets/img/fondo-oscuro-1686.webp", srcset: "./assets/img/fondo-oscuro-960.webp 960w, ./assets/img/fondo-oscuro-1686.webp 1686w" },
    claro: { src: "./assets/img/fondo-claro-1686.webp", srcset: "./assets/img/fondo-claro-960.webp 960w, ./assets/img/fondo-claro-1686.webp 1686w" }
  };
  const ESCENAS = {
    inicio: { base: "noche", tono: "oscuro", velo: "inicio", ranura: "hero", red: true },
    lectura: { base: "gris", tono: "claro", velo: "claro-izq", ranura: "general", red: true },
    lecturas: { base: "gris", tono: "claro", velo: "claro-izq", ranura: "general", red: true },
    videos: { base: "noche", tono: "oscuro", velo: "media", ranura: "general", red: true, opacidad: 0.55 },
    destacado: { base: "noche", tono: "oscuro", velo: "presentacion", ranura: "general", red: true },
    documento: { base: "noche", tono: "oscuro", velo: "media", ranura: "general", red: true, opacidad: 0.45 },
    enlaces: { base: "noche", tono: "oscuro", velo: "unidades", ranura: "general", red: true, opacidad: 0.4 },
    multimedia: { base: "noche", tono: "oscuro", velo: "actividades", ranura: "general", red: true, opacidad: 0.6 },
    actividades: { base: "noche", tono: "oscuro", velo: "actividades", ranura: "general", red: true, opacidad: 0.6 }
  };

  const escenario = {
    el: null, fotos: [], velos: [], fotoVisible: 0, veloVisible: 0, veloActual: "inicio",
    fondos: {}, fallidas: new Set(), precargadas: new Set(), token: 0, motor: null, actual: "",

    iniciar(fondos, modesto) {
      this.el = $("#escenario");
      this.fotos = [$("#fondoFotoA"), $("#fondoFotoB")];
      this.velos = [$("#fondoVeloA"), $("#fondoVeloB")];
      this.fondos = fondos || {};
      // La foto A ya la pidio el script del <head>; si no carga, la del visor.
      const a = this.fotos[0];
      const fallo = () => {
        const clave = a.dataset.clave || "";
        if (clave.charAt(0) === "d") return;
        this.fallidas.add(clave.replace(/^[gr]:/, "").replace(/#(oscuro|claro)$/, ""));
        a.dataset.clave = "";
        this.mostrar(this.actual || "inicio");
      };
      if (a.complete && a.getAttribute("src") && !a.naturalWidth) fallo();
      else a.addEventListener("error", fallo, { once: true });
      if (window.FondoIncca) {
        this.motor = window.FondoIncca.iniciar({
          red: $("#fondoRed"), ondas: $("#fondoOndas"), anfitrion: this.el, modesto,
          escena: { red: true, ondas: false, tema: "oscuro" },
          urlTrabajador: "./assets/js/fondo.js?v=" + VERSION
        });
      }
    },
    resolver(nombre) { return ESCENAS[nombre] || ESCENAS.inicio; },
    foto(e) {
      const propia = this.fondos[e.ranura] || this.fondos.general;
      if (propia) {
        const graduada = propia[e.tono];
        if (graduada && !this.fallidas.has(graduada)) return { clave: "g:" + graduada, src: graduada };
        if (propia.original && !this.fallidas.has(propia.original)) {
          return { clave: "r:" + propia.original + "#" + e.tono, src: propia.original, cruda: true, tono: e.tono };
        }
      }
      return { clave: "d:" + e.tono, src: DEFECTO[e.tono].src, srcset: DEFECTO[e.tono].srcset };
    },
    mostrar(nombre) {
      this.actual = nombre;
      const e = this.resolver(nombre);
      const el = this.el;
      el.dataset.base = e.base;
      el.dataset.tono = e.tono;
      el.toggleAttribute("data-red", !!e.red);
      el.toggleAttribute("data-ondas", false);
      el.toggleAttribute("data-vineta", false);
      $("#deck").dataset.tema = e.tono;

      if (e.velo !== this.veloActual) {
        const sig = this.velos[1 - this.veloVisible];
        sig.className = "escenario-velo velo--" + e.velo + " is-visible";
        this.velos[this.veloVisible].classList.remove("is-visible");
        this.veloVisible = 1 - this.veloVisible;
        this.veloActual = e.velo;
      }

      const f = this.foto(e);
      const tok = ++this.token;
      const visible = this.fotos[this.fotoVisible];
      const opacidad = String(e.opacidad || 1);
      if (visible.dataset.clave === f.clave) {
        visible.style.setProperty("--foto-opacidad", opacidad);
        if (visible.complete && visible.naturalWidth) visible.classList.add("is-visible");
        else {
          (visible.decode ? visible.decode() : Promise.resolve())
            .then(() => { if (tok === this.token) visible.classList.add("is-visible"); }, () => {});
        }
      } else {
        const idx = 1 - this.fotoVisible;
        const img = this.fotos[idx];
        this.cargar(img, f).then((ok) => {
          if (tok !== this.token) return; // el estudiante ya paso a otra diapositiva
          if (!ok) {
            this.fallidas.add(f.src);
            img.dataset.clave = "";
            if (f.clave.charAt(0) !== "d") this.mostrar(nombre);
            return;
          }
          img.style.setProperty("--foto-opacidad", opacidad);
          img.classList.add("is-visible");
          this.fotos[this.fotoVisible].classList.remove("is-visible");
          this.fotoVisible = idx;
        });
      }
      if (this.motor) this.motor.escena({ red: !!e.red, ondas: false, tema: e.tono });
    },
    cargar(img, f) {
      img.classList.toggle("is-propia", !!f.cruda);
      img.classList.toggle("tono-oscuro", !!f.cruda && f.tono === "oscuro");
      img.classList.toggle("tono-claro", !!f.cruda && f.tono === "claro");
      img.dataset.clave = f.clave;
      if (f.srcset) { img.sizes = "100vw"; img.srcset = f.srcset; } else { img.removeAttribute("srcset"); img.removeAttribute("sizes"); }
      img.src = f.src;
      const espera = img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      return espera.then(() => true, () => false);
    },
    precargar(nombre) {
      const f = this.foto(this.resolver(nombre));
      if (!f || this.precargadas.has(f.clave)) return;
      this.precargadas.add(f.clave);
      const i = new Image();
      i.decoding = "async";
      if (f.srcset) { i.sizes = "100vw"; i.srcset = f.srcset; }
      i.src = f.src;
      if (i.decode) i.decode().catch(() => {});
    }
  };

  /* ---------------------------------------------------------------------
   * 5. Mazo y navegacion (barra flotante, flechas, teclado y gesto)
   * ------------------------------------------------------------------- */
  let SLIDES = [];

  const deck = {
    el: null, slides: [], actual: 0, total: 0,

    init() {
      this.el = $("#deck");
      this.slides = SLIDES.map((s) => document.getElementById(s.id));
      this.total = this.slides.length;
      this.slides.forEach((el, i) => {
        const activa = i === 0;
        el.classList.toggle("is-active", activa);
        el.classList.toggle("is-dormida", !activa);
        el.setAttribute("aria-hidden", activa ? "false" : "true");
        el.inert = !activa;
      });
      activarMedios(this.slides[0]);
      if (this.total > 1) cargarImagenes(this.slides[1]);
      escenario.mostrar(SLIDES[0].escena);
      if (this.total > 1) escenario.precargar(SLIDES[1].escena);
      this.chrome();
      this.extras(0);
    },

    goTo(index) {
      const total = this.total;
      if (total < 2) return;
      const idx = ((index % total) + total) % total;
      if (idx === this.actual) return;
      const dir = this.direccion(idx);
      const oldEl = this.slides[this.actual];
      const newEl = this.slides[idx];

      newEl.classList.remove("is-dormida");
      newEl.inert = false;
      newEl.classList.add(dir > 0 ? "is-enter-right" : "is-enter-left");
      void newEl.offsetWidth; // reflow: la entrada parte del lado correcto
      oldEl.classList.remove("is-active");
      oldEl.classList.add(dir > 0 ? "is-exit-left" : "is-exit-right");
      newEl.classList.remove(dir > 0 ? "is-enter-right" : "is-enter-left");
      newEl.classList.add("is-active");
      oldEl.setAttribute("aria-hidden", "true");
      newEl.setAttribute("aria-hidden", "false");
      oldEl.inert = true;

      setTimeout(() => {
        ["is-exit-left", "is-exit-right", "is-enter-left", "is-enter-right"].forEach((c) => { oldEl.classList.remove(c); newEl.classList.remove(c); });
        if (!oldEl.classList.contains("is-active")) oldEl.classList.add("is-dormida");
      }, 600);

      desactivarMedios(oldEl);
      activarMedios(newEl);
      cargarImagenes(this.slides[(idx + 1) % total]);

      this.actual = idx;
      escenario.mostrar(SLIDES[idx].escena);
      escenario.precargar(SLIDES[(idx + 1) % total].escena);
      escenario.precargar(SLIDES[(idx - 1 + total) % total].escena);
      this.chrome();
      this.anunciar();
      $$(".lectura", newEl).forEach(medirLectura);
      const cuerpo = $(".slide-cuerpo", newEl);
      if (cuerpo) cuerpo.scrollTop = 0;
      this.extras(idx);
    },
    direccion(idx) {
      const adelante = (idx - this.actual + this.total) % this.total;
      const atras = (this.actual - idx + this.total) % this.total;
      return adelante <= atras ? 1 : -1;
    },
    next() { this.goTo(this.actual + 1); },
    prev() { this.goTo(this.actual - 1); },

    chrome() {
      const nav = $("#deckNav");
      $$(".nav-item", nav).forEach((item, i) => {
        const activo = i === this.actual;
        item.classList.toggle("is-active", activo);
        if (activo) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
        if (activo && nav.scrollWidth > nav.clientWidth) {
          const destino = item.offsetLeft - nav.clientWidth / 2 + item.offsetWidth / 2;
          nav.scrollTo({ left: Math.max(0, destino), behavior: reducido() ? "auto" : "smooth" });
        }
      });
      $("#deckProgreso").style.setProperty("--p", ((this.actual + 1) / this.total).toFixed(4));
      this.el.dataset.slide = SLIDES[this.actual].id;
      // En la ultima diapositiva la flecha "siguiente" no da la vuelta: queda oculta.
      $("#deckNext").classList.toggle("is-fin", this.actual === this.total - 1);
      $("#deckPrev").classList.toggle("is-fin", this.actual === 0);
    },
    anunciar() {
      $("#deckAnuncio").textContent = `Diapositiva ${this.actual + 1} de ${this.total}: ${decodificar(SLIDES[this.actual].label)}`;
    },
    extras(idx) {
      if (idx === 0) animarContadores($("#hero"));
    }
  };

  function renderNavegacion() {
    const nav = $("#deckNav");
    nav.innerHTML = SLIDES.map((s, i) => `
      <button class="nav-item" type="button" data-ir="${i}" aria-label="Ir a ${texto(s.label)}" title="${texto(s.label)}">
        <i class="fa-solid ${icono(s.icon, "fa-circle")}" aria-hidden="true"></i>
        <span class="nav-item-texto">${texto(s.label)}</span>
      </button>`).join("");
    $$("[data-ir]", nav).forEach((b) => b.addEventListener("click", () => deck.goTo(Number(b.dataset.ir))));
    $("#deckPrev").addEventListener("click", () => { if (deck.actual > 0) deck.prev(); });
    $("#deckNext").addEventListener("click", () => { if (deck.actual < deck.total - 1) deck.next(); });
    const unaSola = SLIDES.length < 2;
    $("#deckPrev").hidden = unaSola;
    $("#deckNext").hidden = unaSola;
    nav.hidden = unaSola;
  }

  function initTeclado() {
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector("dialog[open]")) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const enLectura = t && t.closest && t.closest(".lectura");
      const ultima = deck.total - 1;
      if (e.key === "ArrowRight" || (e.key === "PageDown" && !enLectura)) { e.preventDefault(); if (deck.actual < ultima) deck.next(); }
      else if (e.key === "ArrowLeft" || (e.key === "PageUp" && !enLectura)) { e.preventDefault(); if (deck.actual > 0) deck.prev(); }
      else if (e.key === "Home" && !enLectura) { e.preventDefault(); deck.goTo(0); }
      else if (e.key === "End" && !enLectura) { e.preventDefault(); deck.goTo(ultima); }
    });
  }

  function initGesto() {
    const el = $("#slides");
    let sx = 0, sy = 0, siguiendo = false;
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { siguiendo = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; siguiendo = true;
    }, { passive: true });
    el.addEventListener("touchend", (e) => {
      if (!siguiendo) return;
      siguiendo = false;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        if (dx < 0 && deck.actual < deck.total - 1) deck.next();
        else if (dx > 0 && deck.actual > 0) deck.prev();
      }
    }, { passive: true });
  }

  /* ---------------------------------------------------------------------
   * 6. INICIO DE LA UNIDAD
   * ------------------------------------------------------------------- */
  // Mismo emblema que las franjas de "Unidades" del visor de curso: el
  // estudiante reconoce la unidad que acaba de abrir.
  function emblemaUnidad(nombre) {
    const n = decodificar(nombre || "").toLowerCase();
    const num = n.match(/(\d+)/);
    const tipo = n.includes("conecta") ? "conecta" : n.includes("apoyo") ? "apoyo" : (n.includes("semana") && num) ? "semana" : "unidad";
    const etiqueta = { semana: "Semana", conecta: "Conecta", apoyo: "Apoyo", unidad: "Unidad" }[tipo];
    const numero = num && (tipo === "semana" || tipo === "unidad") ? num[1] : "";
    const centro = numero
      ? `<span class="emblema-num">${esc(dos(numero))}</span>`
      : `<i class="fa-solid ${tipo === "conecta" ? "fa-comments" : tipo === "apoyo" ? "fa-handshake" : "fa-layer-group"}"></i>`;
    return `<div class="emblema-unidad" data-tipo="${tipo}" aria-hidden="true">
      <span class="emblema-anillo emblema-anillo--1"></span>
      <span class="emblema-anillo emblema-anillo--2"><span class="emblema-satelite"></span></span>
      <span class="emblema-disco"><span class="emblema-etiqueta">${etiqueta}</span>${centro}</span>
    </div>`;
  }

  function renderInicio(datos) {
    const nombre = decodificar(datos.unidad).trim();
    if (nombre) document.title = `${nombre} — U.INCCA`;
    const titulo = $("#heroTitulo");
    titulo.textContent = nombre;
    const mayus = nombre.length > 3 && nombre === nombre.toUpperCase() && /\p{Lu}/u.test(nombre);
    const largo = nombre.length * (mayus ? 1.22 : 1);
    if (largo > 54) titulo.dataset.largo = "largo"; else if (largo > 28) titulo.dataset.largo = "medio";
    if (mayus) titulo.dataset.mayusculas = "";

    const sub = $("#heroSubtitulo");
    sub.textContent = decodificar(datos.titulo).trim();
    sub.hidden = !tieneTexto(datos.titulo);

    const resumen = decodificar(datos.descripcion).trim();
    const r = $("#heroResumen");
    r.textContent = resumen;
    $("#heroResumenCaja").hidden = !resumen;
    if (resumen.length > 380) r.dataset.largo = "largo"; else if (resumen.length > 230) r.dataset.largo = "medio";

    $("#heroEmblema").innerHTML = emblemaUnidad(nombre);
    renderFicha(datos);
    initVolver(datos);

    const comenzar = $("#heroComenzar");
    comenzar.hidden = datos.recursos.length === 0;
    comenzar.addEventListener("click", () => deck.goTo(1));

    const actos = datos.recursos.filter((x) => x.tipo === "actividades");
    const total = actos.reduce((n, x) => n + x.items.length, 0);
    const cue = $("#heroIrActividades");
    cue.hidden = !actos.length;
    if (actos.length) {
      const contador = $(".pildora-contador", cue);
      contador.textContent = total > 9 ? "9+" : String(total);
      contador.hidden = total === 0;
      cue.addEventListener("click", () => deck.goTo(SLIDES.findIndex((s) => s.id === actos[0].id)));
    }
  }

  // Ficha de la unidad: solo cifras mayores que 0 (una ficha en 0 no informa nada).
  function renderFicha(datos) {
    const rs = datos.recursos;
    const sumar = (fn) => rs.reduce((n, x) => n + fn(x), 0);
    const fichas = [
      { icono: "fa-book-open", valor: sumar((x) => (x.tipo === "texto" ? 1 : x.tipo === "lecturas" ? x.items.length : 0)), texto: "Lecturas" },
      { icono: "fa-clapperboard", valor: sumar((x) => (["video-grid", "video", "multimedia"].indexOf(x.tipo) !== -1 ? x.items.length : 0)), texto: "Videos" },
      { icono: "fa-file-lines", valor: sumar((x) => (x.tipo === "documento" ? 1 : 0)), texto: "Documentos" },
      { icono: "fa-link", valor: sumar((x) => (x.tipo === "enlaces" ? x.items.length : x.tipo === "multimedia" ? x.lecturas.length : 0)), texto: "Referencias" },
      { icono: "fa-list-check", valor: sumar((x) => (x.tipo === "actividades" ? x.items.length : 0)), texto: "Actividades", oro: true }
    ].filter((f) => Number(f.valor) > 0);
    // Cifras en pares; una impar al final ocupa el ancho (igual que la ficha del curso).
    const cifras = fichas.length;
    fichas.forEach((f, i) => { f.ancha = cifras % 2 === 1 && i === cifras - 1; });
    if (tieneTexto(datos.duracion_estimada)) fichas.unshift({ icono: "fa-clock", texto: decodificar(datos.duracion_estimada), duracion: true });
    const caja = $("#heroFicha");
    caja.innerHTML = fichas.map((f, i) => {
      if (f.duracion) {
        return `<div class="ficha ficha--oro unidad-ficha-duracion" role="listitem" style="--i:${i}">
          <span class="ficha-icono" aria-hidden="true"><i class="fa-solid fa-clock"></i></span>
          <span class="ficha-texto">Duración estimada</span><span class="ficha-valor">${esc(f.texto)}</span></div>`;
      }
      const valor = Math.round(Number(f.valor));
      return `
      <div class="ficha${f.oro ? " ficha--oro" : ""}${f.ancha ? " ficha--ancha" : ""}" role="listitem" style="--i:${i}" aria-label="${valor} ${esc(f.texto)}">
        <span class="ficha-icono" aria-hidden="true"><i class="fa-solid ${f.icono}"></i></span>
        <span class="ficha-num" aria-hidden="true" data-contador="${valor}">${valor}</span>
        <span class="ficha-texto" aria-hidden="true">${esc(f.texto)}</span>
      </div>`;
    }).join("");
    caja.hidden = !fichas.length;
  }

  function animarContadores(raiz) {
    $$("[data-contador]", raiz).forEach((el) => {
      const meta = Number(el.dataset.contador) || 0;
      if (reducido() || meta <= 1) { el.textContent = String(meta); return; }
      const duracion = 1100;
      let inicio = null;
      el.textContent = "0";
      const tic = (ts) => {
        if (inicio === null) inicio = ts;
        const p = Math.min(1, (ts - inicio) / duracion);
        el.textContent = String(Math.round((1 - Math.pow(1 - p, 3)) * meta));
        if (p < 1) requestAnimationFrame(tic);
      };
      setTimeout(() => requestAnimationFrame(tic), 450);
    });
  }

  // "Volver a las unidades": con el puente se le pide a Moodle que cierre el
  // mosaico; si no contesta, se navega la ventana completa (como en v2).
  function initVolver(datos) {
    const back = $("#heroVolver");
    const url = urlSegura(datos.volver_url);
    back.hidden = !url || url === "#";
    if (back.hidden) return;
    back.href = url;
    if (!embebido) return;
    back.target = "_top";
    back.addEventListener("click", (event) => {
      if (puente.estado === "presente" && !puenteTiene("volver-unidades")) return; // enlace nativo a _top
      event.preventDefault();
      let resuelto = false;
      const onMensaje = (ev) => {
        const d = mensajeDelPadre(ev);
        if (!d || d.type !== "unidades-cerrado") return;
        resuelto = true;
        window.removeEventListener("message", onMensaje);
      };
      window.addEventListener("message", onMensaje);
      enviarAlPadre({ type: "volver-unidades" });
      setTimeout(() => {
        if (resuelto) return;
        window.removeEventListener("message", onMensaje);
        window.open(url, "_top");
      }, puente.estado === "presente" ? 2000 : 400);
    });
  }

  /* ---------------------------------------------------------------------
   * 7. Una diapositiva por recurso
   * ------------------------------------------------------------------- */
  const PLAY_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 6.2v11.6c0 .9 1 1.45 1.76.97l9.1-5.8a1.15 1.15 0 0 0 0-1.94l-9.1-5.8C9.6 4.75 8.6 5.3 8.6 6.2z"/></svg>`;
  const vacio = (icon, frase) => `<div class="vacio rv" style="--d:.2s"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${frase}</div>`;

  function cabeza(r, num, total, claro, bajada) {
    const m = metaDe(r);
    return `
      <div class="unidad-cabeza">
        <div class="etiqueta rv"><i class="fa-solid ${m.icon}" aria-hidden="true"></i> ${m.etiqueta}<span class="unidad-paso">${dos(num)} / ${dos(total)}</span></div>
        <h2 class="titulo subrayado${claro ? " subrayado--claro" : ""} rv rv--titulo" style="--d:.1s">${texto(r.titulo)}</h2>
        ${bajada || ""}
      </div>`;
  }

  // Tarjeta de video (miniatura diferida + play de vidrio); el reproductor abre en el dialogo.
  function videoHtml(r, it, i, grande) {
    const embed = toEmbedUrl(it.url);
    const portada = urlSegura(it.portada) || (embed ? miniaturaVideo(embed) : "");
    const nombre = texto(it.titulo || r.titulo);
    return `
      <figure class="unidad-video${grande ? " unidad-video--grande" : ""}" style="--i:${i}">
        <button class="video-tarjeta" type="button" data-video="${esc(r.id)}" data-item="${i}" aria-label="Reproducir: ${nombre}"${embed ? "" : " disabled"}>
          ${portada && portada !== "#" ? `<img data-src="${esc(portada)}" alt="" decoding="async">` : ""}
          <span class="boton-play" aria-hidden="true">${PLAY_SVG}</span>
          <span class="video-tarjeta-texto">${grande ? "Video destacado" : "Ver video"}</span>
        </button>
        ${tieneTexto(it.titulo) ? `<figcaption class="unidad-video-titulo">${texto(it.titulo)}</figcaption>` : ""}
      </figure>`;
  }

  function enlacesHtml(items, conIndice) {
    return `<ol class="unidad-enlaces" role="list">${items.map((it, i) => `
      <li class="unidad-enlace" style="--i:${i}">
        <a href="${attrUrl(it.url) || "#"}" target="_blank" rel="noopener">
          ${conIndice ? `<span class="unidad-enlace-num" aria-hidden="true">${dos(i + 1)}</span>` : ""}
          <span class="unidad-enlace-texto">
            <span class="unidad-enlace-titulo">${texto(it.titulo || it.url)}</span>
            ${it.fuente ? `<span class="unidad-enlace-fuente">${texto(it.fuente)}</span>` : ""}
          </span>
          <i class="fa-solid fa-arrow-up-right-from-square unidad-enlace-ir" aria-hidden="true"></i>
        </a>
      </li>`).join("")}</ol>`;
  }

  const CUERPOS = {
    texto(r, p, t) {
      const parrafos = r.parrafos.map((x, i) => `<p class="rv" style="--d:${(0.22 + Math.min(i, 6) * 0.08).toFixed(2)}s">${texto(x)}</p>`).join("");
      const lecciones = r.items.length ? `
        <aside class="panel panel--acento unidad-lecciones rv rv--derecha" style="--d:.28s">
          <div class="etiqueta"><i class="fa-solid fa-route" aria-hidden="true"></i> Lecciones</div>
          <ol class="unidad-ruta" role="list">${r.items.map((it, i) => `
            <li class="unidad-leccion" style="--i:${i}">
              <details${it.descripcion ? "" : " class=\"sin-detalle\""}>
                <summary${it.descripcion ? "" : " tabindex=\"-1\""}><span class="unidad-leccion-nodo" aria-hidden="true">${dos(i + 1)}</span>
                  <span class="unidad-leccion-titulo">${texto(it.titulo)}</span>
                  ${it.descripcion ? `<i class="fa-solid fa-chevron-down unidad-leccion-abrir" aria-hidden="true"></i>` : ""}</summary>
                ${it.descripcion ? `<p class="unidad-leccion-texto">${texto(it.descripcion)}</p>` : ""}
              </details>
            </li>`).join("")}</ol>
        </aside>` : "";
      return `
        <div class="unidad-texto-grid${lecciones ? "" : " unidad-texto-grid--solo"}">
          <div class="unidad-texto-lado">
            ${cabeza(r, p, t, true)}
            ${parrafos ? `<div class="unidad-parrafos lectura">${parrafos}</div>` : (lecciones ? "" : vacio("fa-book-open", "Esta lectura todavía no tiene texto."))}
          </div>
          ${lecciones}
        </div>`;
    },

    "video-grid"(r, p, t) {
      if (r.tipo === "video" || (r.items.length === 1)) {
        const it = r.items[0];
        return `
          <div class="unidad-destacado">
            <div class="unidad-destacado-texto">
              ${cabeza(r, p, t, false, it && tieneTexto(it.titulo) && it.titulo !== r.titulo ? `<p class="bajada rv" style="--d:.22s">${texto(it.titulo)}</p>` : "")}
              <p class="unidad-nota rv" style="--d:.32s"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> El video se abre en una ventana; puedes verlo a pantalla completa.</p>
            </div>
            ${it && it.url ? `<div class="rv rv--escala" style="--d:.24s">${videoHtml(r, Object.assign({}, it, { titulo: "" }), 0, true)}</div>` : vacio("fa-circle-play", "Este video todavía no está disponible.")}
          </div>`;
      }
      return `
        ${cabeza(r, p, t, false)}
        ${r.items.length ? `<div class="unidad-videos rv" style="--d:.22s">${r.items.map((it, i) => videoHtml(r, it, i, false)).join("")}</div>`
          : vacio("fa-clapperboard", "Todavía no hay videos en este recurso.")}`;
    },

    documento(r, p, t) {
      const embed = toEmbedUrl(r.iframe_url);
      const bajada = tieneTexto(r.documento_titulo) && r.documento_titulo !== r.titulo
        ? `<p class="bajada rv" style="--d:.2s">${texto(r.documento_titulo)}</p>` : "";
      const acciones = [];
      if (embed) acciones.push(`<button class="boton boton--marea" type="button" data-documento="${esc(r.id)}"><i class="fa-solid fa-expand" aria-hidden="true"></i> Ver en pantalla completa</button>`);
      if (urlSegura(r.enlace_url) && urlSegura(r.enlace_url) !== "#") acciones.push(`<a class="boton boton--fantasma" href="${attrUrl(r.enlace_url)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Abrir en pestaña nueva</a>`);
      if (r.adjunto) acciones.push(`<a class="pildora pildora--oro" href="${attrUrl(r.adjunto.url)}" target="_blank" rel="noopener"><span class="pildora-icono"><i class="fa-solid ${icono(r.adjunto.icono, "fa-paperclip")}" aria-hidden="true"></i></span> ${texto(r.adjunto.titulo)}</a>`);
      return `
        <div class="unidad-documento">
          ${cabeza(r, p, t, false, bajada)}
          ${embed ? `<div class="medio-marco rv rv--escala" style="--d:.24s">
              <iframe data-diferido="${esc(embed)}" title="${texto(r.documento_titulo || r.titulo)}" allow="autoplay; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
              <button class="medio-expandir" type="button" data-documento="${esc(r.id)}" aria-label="Abrir en pantalla completa"><i class="fa-solid fa-expand" aria-hidden="true"></i></button>
            </div>` : vacio("fa-file-circle-question", "Este documento todavía no está disponible.")}
          ${acciones.length ? `<div class="unidad-acciones rv" style="--d:.34s">${acciones.join("")}</div>` : ""}
        </div>`;
    },

    enlaces(r, p, t) {
      return `
        <div class="unidad-columna-unica">
          ${cabeza(r, p, t, false)}
          ${r.items.length ? `<div class="panel unidad-enlaces-panel rv rv--escala" style="--d:.22s"><div class="lectura unidad-enlaces-lectura">${enlacesHtml(r.items, true)}</div></div>`
            : vacio("fa-link", "Todavía no hay enlaces en este recurso.")}
        </div>`;
    },

    lecturas(r, p, t) {
      const claro = r.variante !== "complementarias";
      const intro = tieneTexto(r.descripcion) ? `<p class="bajada rv" style="--d:.2s">${texto(r.descripcion)}</p>` : "";
      if (!r.items.length) return `${cabeza(r, p, t, claro, intro)}${vacio("fa-book-open-reader", "Todavía no hay lecturas en este recurso.")}`;
      if (!claro) {
        // Complementarias: lista compacta (pensada para muchas referencias).
        return `<div class="unidad-columna-unica">${cabeza(r, p, t, false, intro)}
          <div class="panel unidad-enlaces-panel rv rv--escala" style="--d:.22s"><div class="lectura unidad-enlaces-lectura">
            <ol class="unidad-enlaces" role="list">${r.items.map((it, i) => `
              <li class="unidad-enlace" style="--i:${i}">${lecturaAbrir(r, it, i, `
                <span class="unidad-enlace-num" aria-hidden="true">${dos(i + 1)}</span>
                <span class="unidad-enlace-texto"><span class="unidad-enlace-titulo">${texto(it.titulo)}</span>
                ${it.fuente ? `<span class="unidad-enlace-fuente">${texto(it.fuente)}</span>` : ""}</span>
                <i class="fa-solid ${it.embebido ? "fa-expand" : "fa-arrow-up-right-from-square"} unidad-enlace-ir" aria-hidden="true"></i>`)}
                ${audioHtml(it, true)}
              </li>`).join("")}</ol></div></div></div>`;
      }
      // Apoyo: tarjetas (panel azul sobre la escena clara), con el audiolibro a la vista.
      return `
        ${cabeza(r, p, t, true, intro)}
        <div class="unidad-lecturas" role="list">${r.items.map((it, i) => `
          <article class="panel unidad-lectura" role="listitem" style="--i:${i}">
            <span class="unidad-lectura-icono" aria-hidden="true"><i class="fa-solid fa-book-open-reader"></i><span>PDF</span></span>
            <h3 class="unidad-lectura-titulo">${texto(it.titulo)}</h3>
            ${it.fuente ? `<span class="unidad-enlace-fuente">${texto(it.fuente)}</span>` : ""}
            <div class="unidad-lectura-acciones">
              ${lecturaAbrir(r, it, i, `${it.embebido ? "Leer aquí" : "Abrir la lectura"} <i class="fa-solid ${it.embebido ? "fa-arrow-right" : "fa-arrow-up-right-from-square"}" aria-hidden="true"></i>`, "enlace-mas")}
              ${audioHtml(it, false)}
            </div>
          </article>`).join("")}
        </div>`;
    },

    multimedia(r, p, t) {
      const videos = r.items.length ? `
        <section class="panel unidad-columna unidad-columna--videos rv rv--escala" style="--d:.22s" aria-label="Videos">
          <h3 class="unidad-columna-titulo"><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> Videos <span class="unidad-cuenta">${r.items.length}</span></h3>
          <div class="lectura unidad-columna-lectura">${r.items.map((it, i) => videoHtml(r, it, i, false)).join("")}</div>
        </section>` : "";
      const lecturas = r.lecturas.length ? `
        <section class="panel unidad-columna unidad-columna--lecturas rv rv--derecha" style="--d:.3s" aria-label="Lecturas">
          <h3 class="unidad-columna-titulo"><i class="fa-solid fa-book-bookmark" aria-hidden="true"></i> Lecturas <span class="unidad-cuenta">${r.lecturas.length}</span></h3>
          <div class="lectura unidad-columna-lectura">${enlacesHtml(r.lecturas, true)}</div>
        </section>` : "";
      return `
        ${cabeza(r, p, t, false)}
        ${videos || lecturas ? `<div class="unidad-multimedia${videos && lecturas ? "" : " unidad-multimedia--una"}">${videos}${lecturas}</div>`
          : vacio("fa-photo-film", "Todavía no hay contenido en este recurso.")}`;
    },

    actividades(r, p, t) {
      const una = r.items.length === 1;
      const cuerpo = r.items.length
        ? `<div class="ruta${una ? " ruta--una" : ""}" role="list">
            ${una ? "" : `<span class="ruta-linea" aria-hidden="true"></span>`}
            ${r.items.map((it, i) => actividadHtml(r, it, i, una)).join("")}
          </div>`
        : vacio("fa-list-check", "Esta unidad todavía no tiene actividades.");
      return `
        <div class="unidad-actividades">
          ${cabeza(r, p, t, false, `<p class="bajada rv" style="--d:.2s">Pon en práctica lo aprendido en esta unidad.</p>`)}
          ${cuerpo}
        </div>`;
    },

    personalizado(r, p, t) {
      const url = r.iframe ? toEmbedUrl(r.iframe) : "";
      const marco = url
        ? `<iframe data-diferido="${esc(url)}" title="${texto(r.titulo)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        : (r.html || "");
      return `
        <div class="unidad-documento">
          ${cabeza(r, p, t, false)}
          ${marco ? `<div class="medio-marco${url ? "" : " medio-marco--html"} rv rv--escala" style="--d:.24s">${marco}
              <button class="medio-expandir" type="button" data-personalizado="${esc(r.id)}" aria-label="Abrir en pantalla completa"><i class="fa-solid fa-expand" aria-hidden="true"></i></button>
            </div>` : vacio("fa-inbox", "Este recurso todavía no tiene contenido.")}
        </div>`;
    }
  };
  CUERPOS.video = CUERPOS["video-grid"];

  // Lectura embebida -> boton que abre el dialogo; si no, enlace a pestana nueva.
  function lecturaAbrir(r, it, i, contenido, clase) {
    const c = clase || "unidad-enlace-abrir";
    return it.embebido
      ? `<button class="${c}" type="button" data-lectura="${esc(r.id)}" data-item="${i}">${contenido}</button>`
      : `<a class="${c}" href="${attrUrl(it.url) || "#"}" target="_blank" rel="noopener">${contenido}</a>`;
  }
  function audioHtml(it, compacto) {
    const url = urlSegura(it.audio_url);
    if (!url || url === "#") return "";
    return compacto
      ? `<a class="unidad-audio unidad-audio--icono" href="${attrUrl(url)}" target="_blank" rel="noopener" title="Escuchar el audiolibro" aria-label="Escuchar el audiolibro: ${texto(it.titulo)}"><i class="fa-solid fa-headphones" aria-hidden="true"></i></a>`
      : `<a class="pildora unidad-audio" href="${attrUrl(url)}" target="_blank" rel="noopener"><span class="pildora-icono"><i class="fa-solid fa-headphones" aria-hidden="true"></i></span> Audiolibro</a>`;
  }

  function actividadHtml(r, it, i, una) {
    const tieneDescripcion = !!it.descripcion;
    const meta = ACT_TYPE_META[it.tipoActividad] || ACT_TYPE_META.tarea;
    const datosAttr = `data-recurso="${esc(r.id)}" data-item="${i}"`;
    const nombre = texto(it.nombre);
    const link = attrUrl(it.link);
    const tipo = `<span class="act-tipo"><i class="fa-solid ${meta.icon}" aria-hidden="true"></i> ${meta.label}</span>`;
    const bloque = (!una && tieneDescripcion)
      ? `<button class="act-abrir" type="button" ${datosAttr} aria-label="Ver el detalle de: ${nombre}">
          ${tipo}
          <span class="act-titular"><span class="act-nombre">${nombre}</span><span class="act-ver">Ver detalle <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></span>
        </button>`
      : `<div class="act-estatico">${tipo}<span class="act-nombre">${nombre}</span></div>`;
    const ir = link
      ? `<a class="act-ir" href="${link}" target="_blank" rel="noopener" title="Ir a la actividad" aria-label="Ir a la actividad: ${nombre}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`
      : "";
    const acciones = una
      ? `<div class="act-acciones">
          ${tieneDescripcion ? `<button class="act-ver-grande" type="button" ${datosAttr}><i class="fa-solid fa-file-lines" aria-hidden="true"></i> Ver la actividad</button>` : ""}
          ${ir ? `<a class="act-cta" href="${link}" target="_blank" rel="noopener">Ir a la actividad <span class="act-cta-flecha" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span></a>` : ""}
        </div>`
      : "";
    return `
      <div class="act" data-type="${it.tipoActividad}" style="--i:${i}" role="listitem">
        <span class="act-nodo" aria-hidden="true">${una ? `<i class="fa-solid ${meta.icon}"></i>` : dos(i + 1)}</span>
        <div class="act-tarjeta">
          <div class="act-fila">${bloque}${una ? "" : ir}</div>
          ${acciones}
        </div>
      </div>`;
  }

  let recursosPorId = {};

  function renderRecursos(datos) {
    const contenedor = $("#slides");
    const total = datos.recursos.length;
    recursosPorId = {};
    datos.recursos.forEach((r, i) => {
      recursosPorId[r.id] = r;
      const m = metaDe(r);
      const escena = (r.tipo === "video-grid" && r.items.length === 1) ? "destacado" : m.escena;
      const claro = ESCENAS[escena] && ESCENAS[escena].tono === "claro";
      const s = document.createElement("section");
      s.id = r.id;
      s.className = `slide unidad-slide unidad-slide--${r.tipo}`;
      if (claro) s.dataset.tono = "claro";
      s.setAttribute("role", "group");
      s.setAttribute("aria-roledescription", "diapositiva");
      s.setAttribute("aria-label", decodificar(r.titulo));
      s.innerHTML = `<div class="slide-cuerpo"><div class="slide-contenido">${(CUERPOS[r.tipo] || CUERPOS.personalizado)(r, i + 1, total)}</div></div>`;
      contenedor.appendChild(s);
      SLIDES.push({ id: r.id, label: decodificar(r.titulo), icon: m.icon, escena });
    });
  }

  function initInteracciones() {
    const slides = $("#slides");
    slides.addEventListener("click", (e) => {
      const b = e.target.closest("[data-video], [data-documento], [data-lectura], [data-personalizado], .act-abrir, .act-ver-grande");
      if (!b || !slides.contains(b)) return;
      if (b.dataset.video) {
        const r = recursosPorId[b.dataset.video];
        const it = r && r.items[Number(b.dataset.item)];
        if (it) abrirVideo(it.url, it.titulo || r.titulo, b);
      } else if (b.dataset.documento) {
        const r = recursosPorId[b.dataset.documento];
        if (r) abrirContenido({
          titulo: r.documento_titulo || r.titulo, medio: true, iframe: toEmbedUrl(r.iframe_url),
          acciones: [{ href: r.enlace_url, texto: "Abrir en pestaña nueva" }]
        }, b);
      } else if (b.dataset.lectura) {
        const r = recursosPorId[b.dataset.lectura];
        const it = r && r.items[Number(b.dataset.item)];
        if (it) abrirContenido({
          titulo: it.titulo || r.titulo, bajada: it.fuente, medio: true, iframe: toEmbedUrl(it.url),
          acciones: [{ href: it.audio_url, texto: "Escuchar el audiolibro", icono: "fa-headphones", principal: true },
            { href: it.url, texto: "Abrir en pestaña nueva" }]
        }, b);
      } else if (b.dataset.personalizado) {
        const r = recursosPorId[b.dataset.personalizado];
        if (r) abrirContenido({ titulo: r.titulo, medio: true, iframe: r.iframe ? toEmbedUrl(r.iframe) : "", html: r.iframe ? "" : r.html }, b);
      } else {
        const r = recursosPorId[b.dataset.recurso];
        const it = r && r.items[Number(b.dataset.item)];
        if (!it || !it.descripcion) return;
        const html = it.descripcionHtml
          ? it.descripcion // HTML de confianza armado por el plugin
          : texto(it.descripcion).split(/\n{2,}/).map((x) => `<p>${x}</p>`).join("");
        abrirContenido({
          titulo: it.nombre || r.titulo,
          bajada: (ACT_TYPE_META[it.tipoActividad] || ACT_TYPE_META.tarea).label,
          html,
          acciones: it.link ? [{ href: it.link, texto: "Ir a la actividad", principal: true }] : []
        }, b);
      }
    });
  }

  /* ---------------------------------------------------------------------
   * 8. Bloqueadores de anuncios: un embed (Drive, YouTube...) que un
   *    bloqueador corta queda en blanco sin explicacion. Se comprueba desde
   *    afuera (sondeo "no-cors" al origen + marco colapsado) y se avisa con
   *    una salida ("Abrir en pestana nueva", "Ocultar aviso"). Un timeout no
   *    cuenta como bloqueo. Igual que v2, con el diseno del sistema.
   * ------------------------------------------------------------------- */
  const sondeos = new Map();
  function sondearOrigen(url) {
    let origen;
    try { origen = new URL(url, location.href).origin; } catch (e) { return Promise.resolve(false); }
    if (!/^https?:/.test(origen) || origen === location.origin) return Promise.resolve(false);
    if (!sondeos.has(origen)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      sondeos.set(origen, fetch(url, { mode: "no-cors", credentials: "omit", signal: ctrl.signal })
        .then(() => false, (e) => e.name !== "AbortError" && navigator.onLine !== false)
        .finally(() => { clearTimeout(timer); ctrl.abort(); }));
    }
    return sondeos.get(origen);
  }
  let vigilancias = 0;
  function vigilarEmbed(iframe) {
    const src = iframe.getAttribute("src");
    if (!src || src === "about:blank" || iframe.dataset.vigilado) return;
    const turno = (iframe.dataset.vigilado = String(++vigilancias));
    let bloqueado = false;
    const revisar = () => {
      if (!iframe.isConnected || iframe.dataset.vigilado !== turno || iframe.dataset.avisoOculto) return;
      if (bloqueado || getComputedStyle(iframe).display === "none") mostrarAvisoBloqueo(iframe);
    };
    sondearOrigen(src).then((b) => { bloqueado = b; revisar(); });
    iframe.addEventListener("load", revisar, { once: true });
    setTimeout(revisar, 3000);
  }
  function vigilarEmbeds(scope) { $$("iframe", scope).forEach(vigilarEmbed); }
  function mostrarAvisoBloqueo(iframe) {
    const host = iframe.parentElement;
    if (!host || host.querySelector(".unidad-bloqueo")) return;
    const src = iframe.getAttribute("src");
    let dominio = "";
    try { dominio = new URL(src, location.href).hostname; } catch (e) { /* sin dominio que mostrar */ }
    const aviso = document.createElement("div");
    aviso.className = "unidad-bloqueo";
    aviso.setAttribute("role", "alert");
    aviso.innerHTML = `
      <span class="unidad-bloqueo-icono" aria-hidden="true"><i class="fa-solid fa-shield-halved"></i></span>
      <h4>Desactiva el bloqueador de anuncios para ver este contenido</h4>
      <p>Un bloqueador está impidiendo que cargue el contenido de <strong></strong>. Desactívalo para este sitio y vuelve a intentarlo.</p>
      <div class="unidad-bloqueo-acciones">
        <button class="boton boton--luz" type="button" data-reintentar><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Ya lo desactivé, reintentar</button>
        <a class="boton boton--fantasma" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Abrir en pestaña nueva</a>
      </div>
      <button class="enlace-mas" type="button" data-ocultar>Ocultar aviso</button>`;
    $("strong", aviso).textContent = dominio || "este sitio";
    $("a", aviso).href = src;
    $("[data-reintentar]", aviso).addEventListener("click", () => {
      aviso.remove();
      sondeos.clear();
      delete iframe.dataset.vigilado;
      iframe.src = src;
      vigilarEmbed(iframe);
    });
    $("[data-ocultar]", aviso).addEventListener("click", () => { iframe.dataset.avisoOculto = "1"; aviso.remove(); });
    host.appendChild(aviso);
  }

  /* ---------------------------------------------------------------------
   * Arranque: cada paso aislado
   * ------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    const datos = paso("datos", obtenerDatos);
    if (!datos) return;
    origenPadre = datos.origen_padre;
    iniciarSaludo("unidad");
    const modesto = paso("equipo", marcarEquipoModesto);
    paso("escenario", () => escenario.iniciar(datos.fondos, modesto));

    SLIDES = [{ id: "hero", label: "Inicio", icon: "fa-house", escena: "inicio" }];
    paso("recursos", () => renderRecursos(datos));
    paso("inicio", () => renderInicio(datos));
    paso("interacciones", initInteracciones);
    paso("navegacion", renderNavegacion);
    paso("dialogos", initDialogos);
    paso("lecturas", initLecturas);
    paso("teclado", initTeclado);
    paso("gesto", initGesto);
    paso("mazo", () => deck.init());
  });
})();
