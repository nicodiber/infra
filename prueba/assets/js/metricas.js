// @ts-check
/**
 * Métricas de uso del prototipo (D-080). Registra qué hace quien valida el prototipo publicado (pantallas, clics,
 * campos, ventanas, búsquedas, errores) y lo manda a una planilla de Google mediante un Google Apps Script
 * (`docs/metricas/doPost.gs`). Ver `docs/metricas/README.md`.
 *
 * - Autocontenido: el resto de la app no lo importa. Otros módulos pueden emitir con
 *   `window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo, detalle } }))` o con `registrarEvento`.
 * - Solo envía desde el sitio publicado, o en cualquier lado con `localStorage.infradoc_metricas_forzar = '1'` (para probar).
 * - Nunca debe romper la app: todo va en try/catch.
 * - Se registran acciones y valores escritos, EXCEPTO contraseñas y secretos: esos viajan como «[oculto]».
 * - Sin IP (la columna queda vacía) y sin llamadas a ningún otro servicio que no sea la URL del script.
 */

import { CAMPOS_SECRETOS } from './modelos.js';

/** URL de la aplicación web del Apps Script (termina en /exec). Vacía: no envía nada, solo hace `console.debug`. */
const URL_METRICAS = 'https://script.google.com/macros/s/AKfycbxwwplxZMFLRBGiuXQxYUyzyBPXXHNWQoM1Z2d08Fzdk61NO5mOo-1XomKOAVTviQMf/exec';

const HOST_PUBLICADO = 'nicodiber.github.io';
const CLAVE_FORZAR = 'infradoc_metricas_forzar';
/** Navegador marcado como uso interno (MJ54): sus eventos salen con «Empresa» = «Infradoc (interno)». */
const CLAVE_INTERNO = 'infradoc_metricas_interno';

/** ¿Es uso interno (pruebas del desarrollo) y no del sysadmin? Se marca abriendo el sitio con `?interno=1` (y se desmarca con `?interno=0`); los navegadores automáticos de la IA se marcan solos. */
function esInterno() {
  try {
    const p = new URLSearchParams(location.search).get('interno');
    if (p === '1') localStorage.setItem(CLAVE_INTERNO, '1');
    if (p === '0') localStorage.removeItem(CLAVE_INTERNO);
    if (/Claude-Agent|HeadlessChrome/i.test(navigator.userAgent)) return true;
    return localStorage.getItem(CLAVE_INTERNO) === '1';
  } catch { return false; }
}
const INTERNO = esInterno();
const CLAVE_ANONIMO = 'infradoc_navegador_anonimo';
const INTERVALO_MS = 10000;
const EVENTOS_PARA_ENVIAR = 20;
const TOPE_COLA = 500;
const MAX_LOTE = 40;
const MAX_BYTES_LOTE = 45000; // los envíos con keepalive/beacon admiten ~64 KB
const MAX_TEXTO = 80;
const MAX_VALOR = 500;
const MAX_ERRORES_JS = 20;
const OCULTO = '[oculto]';

/** Rótulos o nombres que delatan un secreto (se comparan sin tildes ni mayúsculas). */
const RE_SECRETO = /clave|contrasena|secreto|password|passwd|\bpin\b|token/;
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SELECTOR_CLIC = 'button, a, [role=tab], summary, [role=button], input[type=checkbox], input[type=radio]';
const SELECTOR_ERROR = '.msg.mal, [role=alert]';

/**
 * @typedef {Object} EventoMetrica
 * @property {string} fecha
 * @property {string} empresa
 * @property {string} version
 * @property {string} tipoEvento
 * @property {Object} detalle
 * @property {string} ip
 * @property {string} userAgent
 * @property {string} sesion
 * @property {string} navegadorAnonimo
 * @property {string} rol
 * @property {string} pantalla
 * @property {number|null} duracionMs
 */

/** @type {EventoMetrica[]} */
let cola = [];
let enviando = false;
let pantallaActual = '';
let entradaPantalla = 0;
let ocultoDesde = 0;
let ocultoTotal = 0;
let salidaEmitida = false;
let erroresJs = 0;
let ultimoRol = '';
/** @type {() => any} */
let leerUsuario = () => null;
/** @type {string} */
let idAnonimo = '';
const idSesion = nuevoId();

/** @typedef {{etiqueta: string, inicio: number, ultimoBoton: string, campos: Set<string>, modal: boolean}} EstadoModal */
/** @type {Map<Element, EstadoModal>} */
const modales = new Map();
/** Último mensaje registrado por elemento (un mismo mensaje se repite si vuelve a aparecer después de un rato). @type {WeakMap<Element, {texto: string, t: number}>} */
const erroresVistos = new WeakMap();

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

function nuevoId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch { /* sigue */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/** ¿Está habilitado el envío en este sitio? */
function habilitado() {
  try {
    return location.hostname === HOST_PUBLICADO || localStorage.getItem(CLAVE_FORZAR) === '1';
  } catch { return location.hostname === HOST_PUBLICADO; }
}

function anonimo() {
  if (idAnonimo) return idAnonimo;
  try {
    let v = localStorage.getItem(CLAVE_ANONIMO);
    if (!v) { v = nuevoId(); localStorage.setItem(CLAVE_ANONIMO, v); }
    idAnonimo = v;
  } catch { idAnonimo = nuevoId(); }
  return idAnonimo;
}

function version() {
  const v = document.getElementById('version');
  return v && v.textContent ? v.textContent.trim() : '';
}

function rol() {
  try {
    const u = leerUsuario();
    if (u && u.usuario_perfil) ultimoRol = String(u.usuario_perfil);
    else ultimoRol = '';
  } catch { ultimoRol = ''; }
  return ultimoRol;
}

/** @param {string} s @param {number} [max] */
function recortar(s, max = MAX_TEXTO) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Reemplaza los ids (UUID) por «:id». @param {string} s */
function sinIds(s) { return String(s || '').replace(RE_UUID, ':id'); }

/** Hash de la pantalla sin ids ni parámetros: «#/equipo/:id/puertos». @param {string} hash */
function normalizarHash(hash) {
  const base = (hash || '#/ingreso').split('?')[0];
  return base.split('/').map((seg, i) => {
    if (i === 0) return seg;
    if (/^\d+$/.test(seg)) return ':n';
    return sinIds(seg);
  }).join('/');
}

/** @param {string} s */
function sinTildes(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

/** Copia segura para JSON: recorta textos, limita la profundidad y nunca falla. @param {any} v @param {number} [prof] @returns {any} */
function limpiar(v, prof = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > MAX_VALOR ? v.slice(0, MAX_VALOR - 1) + '…' : v;
  if (prof > 3) return String(v).slice(0, 100);
  if (Array.isArray(v)) return v.slice(0, 30).map(x => limpiar(x, prof + 1));
  if (typeof v === 'object') {
    /** @type {Record<string, any>} */
    const o = {};
    for (const k of Object.keys(v).slice(0, 40)) o[k] = limpiar(v[k], prof + 1);
    return o;
  }
  return String(v).slice(0, 100);
}

// ---------------------------------------------------------------------------------------------
// Cola y envío
// ---------------------------------------------------------------------------------------------

/**
 * Registra un evento de uso. No hace nada si el envío no está habilitado. Nunca lanza.
 * @param {string} tipo Tipo de evento (por ejemplo «busqueda_abierta»).
 * @param {Object} [detalle] Datos propios del evento (van como JSON en la columna «Detalle»).
 */
export function registrarEvento(tipo, detalle) {
  try { encolar(armar(tipo, detalle, {})); } catch { /* las métricas nunca rompen la app */ }
}

/** @param {string} tipo @param {any} detalle @param {{pantalla?: string, duracionMs?: number|null}} extra @returns {EventoMetrica|null} */
function armar(tipo, detalle, extra) {
  if (!habilitado()) return null;
  return {
    fecha: new Date().toISOString(), empresa: INTERNO ? 'Infradoc (interno)' : 'Infradoc', version: version(), tipoEvento: String(tipo || ''),
    detalle: limpiar(detalle || {}), ip: '', userAgent: navigator.userAgent, sesion: idSesion, navegadorAnonimo: anonimo(),
    rol: rol(), pantalla: extra.pantalla !== undefined ? extra.pantalla : pantallaActual,
    duracionMs: extra.duracionMs == null ? null : Math.round(extra.duracionMs)
  };
}

/** @param {EventoMetrica|null} ev */
function encolar(ev) {
  if (!ev) return;
  if (!URL_METRICAS) { console.debug('[métricas]', ev.tipoEvento, ev); return; }
  cola.push(ev);
  if (cola.length > TOPE_COLA) cola.splice(0, cola.length - TOPE_COLA);
  if (cola.length >= EVENTOS_PARA_ENVIAR) vaciar(false);
}

/** Saca de la cola un lote que entre en el tope de bytes. */
function tomarLote() {
  /** @type {EventoMetrica[]} */
  const lote = [];
  let bytes = 0;
  while (cola.length && lote.length < MAX_LOTE) {
    const largo = JSON.stringify(cola[0]).length;
    if (lote.length && bytes + largo > MAX_BYTES_LOTE) break;
    bytes += largo;
    lote.push(/** @type {EventoMetrica} */ (cola.shift()));
  }
  return lote;
}

/** Devuelve al principio de la cola lo que no se pudo enviar. @param {EventoMetrica[]} lote */
function reponer(lote) {
  cola = lote.concat(cola);
  if (cola.length > TOPE_COLA) cola.splice(0, cola.length - TOPE_COLA);
}

/** @param {boolean} alSalir En true usa `sendBeacon` (la página se está yendo). */
function vaciar(alSalir) {
  try {
    if (!URL_METRICAS || !cola.length) return;
    if (alSalir) {
      while (cola.length) {
        const lote = tomarLote();
        const cuerpo = JSON.stringify({ eventos: lote });
        let ok = false;
        try { ok = navigator.sendBeacon(URL_METRICAS, new Blob([cuerpo], { type: 'text/plain;charset=utf-8' })); } catch { ok = false; }
        if (!ok) { reponer(lote); break; }
      }
      return;
    }
    if (enviando) return;
    const lote = tomarLote();
    if (!lote.length) return;
    enviando = true;
    fetch(URL_METRICAS, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ eventos: lote }) })
      .catch(() => reponer(lote))
      .finally(() => { enviando = false; if (cola.length >= EVENTOS_PARA_ENVIAR) vaciar(false); });
  } catch { enviando = false; }
}

// ---------------------------------------------------------------------------------------------
// Pantallas y sesión
// ---------------------------------------------------------------------------------------------

/** Tiempo en la pantalla actual sin contar el que la pestaña estuvo oculta. */
function duracionPantalla() {
  const ahora = performance.now();
  const oculto = ocultoTotal + (ocultoDesde ? ahora - ocultoDesde : 0);
  return Math.max(0, ahora - entradaPantalla - oculto);
}

function alCambiarHash() {
  try {
    const nueva = normalizarHash(location.hash);
    const anterior = pantallaActual;
    const dur = duracionPantalla();
    const rolAntes = rol();
    encolar(armar('pantalla_vista', { estado: 'salida', hacia: nueva }, { pantalla: anterior, duracionMs: dur }));
    if (nueva === '#/ingreso' && rolAntes) encolar(armar('salida_sesion', { rolAnterior: rolAntes }, { pantalla: anterior }));
    pantallaActual = nueva;
    entradaPantalla = performance.now();
    ocultoTotal = 0;
    ocultoDesde = document.visibilityState === 'hidden' ? entradaPantalla : 0;
    encolar(armar('pantalla_vista', { estado: 'entrada', desde: anterior }, {}));
  } catch { /* nada */ }
}

function alCambiarVisibilidad() {
  try {
    if (document.visibilityState === 'hidden') {
      if (!salidaEmitida) {
        salidaEmitida = true;
        encolar(armar('pantalla_salida', {}, { duracionMs: duracionPantalla() }));
      }
      ocultoDesde = performance.now();
      vaciar(true);
    } else {
      if (ocultoDesde) { ocultoTotal += performance.now() - ocultoDesde; ocultoDesde = 0; }
      salidaEmitida = false;
    }
  } catch { /* nada */ }
}

// ---------------------------------------------------------------------------------------------
// Clics y campos
// ---------------------------------------------------------------------------------------------

/** @param {Element} el @returns {Element|null} */
function dialogoDe(el) { return el.closest('[role=dialog]'); }

/** @param {Element|null} d */
function etiquetaModal(d) {
  if (!d) return '';
  const a = d.getAttribute('aria-label');
  if (a) return recortar(a);
  const t = d.querySelector('h1, h2, h3');
  return t ? recortar(t.textContent || '') : 'sin título';
}

/** @param {Element} el */
function nombreModalDe(el) { return etiquetaModal(dialogoDe(el)); }

/** Rótulo de un campo: aria-label, label asociado o el que lo precede, placeholder, name o id. @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} c */
function rotuloCampo(c) {
  const aria = c.getAttribute('aria-label');
  if (aria) return recortar(aria);
  const labels = /** @type {any} */ (c).labels;
  if (labels && labels.length) return recortar(labels[0].textContent || '');
  const previo = c.previousElementSibling;
  if (previo && previo.tagName === 'LABEL') return recortar(previo.textContent || '');
  return recortar(c.getAttribute('placeholder') || c.getAttribute('name') || c.id || '');
}

/** ¿Es un campo de contraseña o secreto? Su valor nunca se envía. @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} c @param {string} rotulo */
function esSecreto(c, rotulo) {
  const tipo = (c.getAttribute('type') || '').toLowerCase();
  if (tipo === 'password') return true;
  const auto = (c.getAttribute('autocomplete') || '').toLowerCase();
  if (auto.includes('password')) return true;
  const nombre = c.getAttribute('name') || '';
  const dato = c.getAttribute('data-campo') || '';
  if (CAMPOS_SECRETOS.includes(nombre) || CAMPOS_SECRETOS.includes(c.id) || CAMPOS_SECRETOS.includes(dato)) return true;
  const pistas = [nombre, c.id, c.getAttribute('aria-label') || '', rotulo, c.getAttribute('placeholder') || '', c.getAttribute('title') || '', dato];
  // «Notas (sin secretos)» o «sin contraseñas» avisan que NO hay secretos: no cuentan como pista.
  return pistas.some(p => RE_SECRETO.test(sinTildes(p).toLowerCase().replace(/sin (secretos?|contrasenas?|claves?)/g, '')));
}

/** @param {Event} e */
function alHacerClic(e) {
  try {
    const objetivo = /** @type {Element|null} */ (e.target instanceof Element ? e.target : null);
    if (!objetivo || !e.isTrusted) return;
    if (objetivo.id === 'velo') { const m = ultimoModal(); if (m) m.ultimoBoton = 'Clic afuera'; }
    const el = /** @type {HTMLElement|null} */ (objetivo.closest(SELECTOR_CLIC));
    if (!el || /** @type {any} */ (el).disabled) return;
    const tag = el.tagName.toLowerCase();
    const esCasilla = tag === 'input';
    const texto = esCasilla ? '' : recortar(el.textContent || '');
    const aria = el.getAttribute('aria-label') || '';
    /** @type {Record<string, any>} */
    const detalle = { elemento: esCasilla ? 'input:' + /** @type {HTMLInputElement} */ (el).type : (el.getAttribute('role') || tag), texto };
    if (aria) detalle.ariaLabel = recortar(aria);
    if (tag === 'a') { const href = el.getAttribute('href'); if (href) detalle.href = sinIds(href.split('?')[0]); }
    if (el.id) detalle.id = el.id;
    const clases = Array.from(el.classList).slice(0, 5).join(' ');
    if (clases) detalle.clases = clases;
    if (esCasilla) {
      const c = /** @type {HTMLInputElement} */ (el);
      detalle.rotulo = rotuloCampo(c);
      detalle.marcado = c.checked;
    }
    const d = dialogoDe(el);
    if (d) {
      detalle.modal = etiquetaModal(d);
      const m = modales.get(d);
      if (m && (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button')) m.ultimoBoton = texto || recortar(aria) || el.id;
    }
    encolar(armar('clic', detalle, {}));
  } catch { /* nada */ }
}

/** @param {Event} e */
function alCambiarCampo(e) {
  try {
    const c = /** @type {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null} */ (e.target instanceof Element ? e.target : null);
    if (!c || !/^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName)) return;
    // El buscador se registra aparte (busqueda_texto).
    if (c.getAttribute('role') === 'combobox') return;
    const tipo = c.tagName === 'INPUT' ? (/** @type {HTMLInputElement} */ (c).type || 'text') : c.tagName.toLowerCase();
    const rotulo = rotuloCampo(c);
    const d = dialogoDe(c);
    const modal = etiquetaModal(d);
    /** @type {any} */
    let valor;
    if (tipo === 'checkbox' || tipo === 'radio') valor = /** @type {HTMLInputElement} */ (c).checked;
    else if (esSecreto(c, rotulo)) valor = OCULTO;
    else if (tipo === 'file') valor = Array.from(/** @type {HTMLInputElement} */ (c).files || []).map(f => f.name);
    else if (c.tagName === 'SELECT') valor = Array.from(/** @type {HTMLSelectElement} */ (c).selectedOptions).map(o => recortar(o.textContent || '', MAX_VALOR)).join(', ');
    else valor = c.value;
    const m = d ? modales.get(d) : null;
    if (m) m.campos.add(rotulo + '|' + (c.getAttribute('name') || c.id));
    encolar(armar('campo_cambiado', { rotulo, tipo, valor, modal }, {}));
  } catch { /* nada */ }
}

// ---------------------------------------------------------------------------------------------
// Ventanas (role=dialog) y mensajes de error
// ---------------------------------------------------------------------------------------------

/** Última ventana modal abierta (las que no son modales, como el panel del asistente, no cuentan para Esc ni para clic afuera). */
function ultimoModal() {
  let ult = null;
  for (const m of modales.values()) if (m.modal) ult = m;
  return ult;
}

/** @param {Element} d */
function dialogoAbierto(d) {
  if (modales.has(d) || !d.isConnected || /** @type {HTMLElement} */ (d).hidden) return;
  const m = { etiqueta: etiquetaModal(d), inicio: performance.now(), ultimoBoton: '', campos: new Set(), modal: d.getAttribute('aria-modal') !== 'false' };
  modales.set(d, m);
  encolar(armar('modal_abierto', { modal: m.etiqueta, esModal: m.modal, apilados: modales.size }, {}));
}

/** @param {string} boton */
function inferirResultado(boton) {
  const b = sinTildes(boton).trim();
  if (!b) return 'otro';
  if (/\b(cancelar|cerrar|volver|esc|no)\b|clic afuera|^[✕×x]$/.test(b)) return 'cancelado';
  if (/\b(guardar|crear|aceptar|confirmar|agregar|anadir)\b|^si\b/.test(b)) return 'guardado';
  return 'otro';
}

function revisarDialogosCerrados() {
  for (const [d, m] of Array.from(modales)) {
    if (d.isConnected && !/** @type {HTMLElement} */ (d).hidden) continue;
    modales.delete(d);
    encolar(armar('modal_cerrado', { modal: m.etiqueta, ultimoBoton: m.ultimoBoton, resultado: inferirResultado(m.ultimoBoton), camposCambiados: m.campos.size },
      { duracionMs: performance.now() - m.inicio }));
  }
}

/** Mensajes de error que aparecen en formularios (`.msg.mal` sin botones, o `role=alert`). @param {Element} nodo */
function revisarError(nodo) {
  /** @type {Element[]} */
  const candidatos = [];
  if (nodo.matches(SELECTOR_ERROR)) candidatos.push(nodo);
  candidatos.push(...Array.from(nodo.querySelectorAll(SELECTOR_ERROR)));
  for (const c of candidatos) {
    const el = /** @type {HTMLElement} */ (c);
    // Las cajas con botones son confirmaciones («¿Restablecer…?»), no errores; los estados vacíos de error de pantalla tampoco.
    if (el.querySelector('button') || el.getAttribute('role') === 'status' || el.closest('.estado-vacio')) continue;
    const texto = recortar(el.textContent || '', 300);
    if (!texto || el.offsetParent === null) continue;
    const previo = erroresVistos.get(el);
    const ahora = performance.now();
    if (previo && previo.texto === texto && ahora - previo.t < 500) continue;
    erroresVistos.set(el, { texto, t: ahora });
    encolar(armar('error_validacion', { texto, modal: nombreModalDe(el), clases: Array.from(el.classList).join(' ') }, {}));
  }
}

/** @param {MutationRecord[]} registros */
function alMutar(registros) {
  try {
    for (const r of registros) {
      if (r.type === 'attributes') {
        if (r.target instanceof Element) { if (r.target.matches('[role=dialog]')) dialogoAbierto(r.target); revisarError(r.target); }
        continue;
      }
      // Un mensaje de error que ya estaba en la página y cambia de texto (o se destapa).
      if (r.target instanceof Element && r.target.closest(SELECTOR_ERROR)) revisarError(/** @type {Element} */ (r.target.closest(SELECTOR_ERROR)));
      r.addedNodes.forEach(n => {
        if (!(n instanceof Element)) return;
        if (n.matches('[role=dialog]')) dialogoAbierto(n);
        n.querySelectorAll('[role=dialog]').forEach(dialogoAbierto);
        revisarError(n);
      });
    }
    if (modales.size) revisarDialogosCerrados();
  } catch { /* nada */ }
}

// ---------------------------------------------------------------------------------------------
// Errores de JavaScript
// ---------------------------------------------------------------------------------------------

/** @param {ErrorEvent} e */
function alErrorJs(e) {
  try {
    if (erroresJs >= MAX_ERRORES_JS) return;
    if (!e.message && !e.error) return; // error de carga de un recurso: no es de JavaScript
    erroresJs++;
    encolar(armar('error_js', {
      mensaje: recortar(e.message || String(e.error), 300), archivo: sinIds(String(e.filename || '').replace(location.origin, '')),
      linea: e.lineno || null, columna: e.colno || null, pila: e.error && e.error.stack ? String(e.error.stack).slice(0, 1000) : ''
    }, {}));
  } catch { /* nada */ }
}

/** @param {PromiseRejectionEvent} e */
function alRechazo(e) {
  try {
    if (erroresJs >= MAX_ERRORES_JS) return;
    erroresJs++;
    const r = e.reason;
    encolar(armar('error_js', {
      mensaje: recortar(r && r.message ? r.message : String(r), 300), archivo: '', linea: null, columna: null,
      pila: r && r.stack ? String(r.stack).slice(0, 1000) : '', promesa: true
    }, {}));
  } catch { /* nada */ }
}

// ---------------------------------------------------------------------------------------------
// Arranque (una sola vez)
// ---------------------------------------------------------------------------------------------

function iniciar() {
  const w = /** @type {any} */ (window);
  if (w.__infradocMetricas) return;
  w.__infradocMetricas = true;
  if (!habilitado()) return;

  import('./sesion.js').then(m => { leerUsuario = m.usuarioActual; }).catch(() => { /* sin rol */ });

  pantallaActual = normalizarHash(location.hash);
  entradaPantalla = performance.now();

  window.addEventListener('infradoc:metrica', ev => {
    const d = /** @type {CustomEvent} */ (ev).detail;
    if (d && d.tipo) registrarEvento(String(d.tipo), d.detalle);
  });
  window.addEventListener('hashchange', alCambiarHash);
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('pagehide', () => { try { if (!salidaEmitida) { salidaEmitida = true; encolar(armar('pantalla_salida', {}, { duracionMs: duracionPantalla() })); } vaciar(true); } catch { /* nada */ } });
  document.addEventListener('click', alHacerClic, true);
  document.addEventListener('change', alCambiarCampo, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const m = ultimoModal(); if (m) m.ultimoBoton = 'Esc'; } }, true);
  window.addEventListener('error', alErrorJs);
  window.addEventListener('unhandledrejection', alRechazo);
  setInterval(() => vaciar(false), INTERVALO_MS);

  const observador = new MutationObserver(alMutar);
  observador.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  document.querySelectorAll('[role=dialog]').forEach(dialogoAbierto);

  encolar(armar('sesion_inicio', {
    resolucion: screen.width + 'x' + screen.height, ventana: window.innerWidth + 'x' + window.innerHeight,
    tema: document.documentElement.dataset.theme || '', idioma: navigator.language
  }, {}));
  encolar(armar('pantalla_vista', { estado: 'entrada', desde: '' }, {}));
}

try { iniciar(); } catch { /* las métricas nunca rompen la app */ }
