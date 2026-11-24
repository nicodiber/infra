// @ts-check
/**
 * IA integrada del navegador (Prompt API de Chrome, modelo Gemini Nano). Un solo lugar para:
 *  - saber en qué navegador se está y en qué estado está el modelo,
 *  - descargarlo (una descarga compartida: el progreso se ve igual desde el asistente, Ajustes o el pie),
 *  - pintar el control con el estado y el botón (asistente y Ajustes) y el indicador corto (pie).
 * La IA corre en la PC: no recibe datos de Infradoc ni manda nada afuera (ver asistente.js, opción B).
 */

import { h } from './utiles.js';

/** Opciones con las que se usa el modelo: hay que pedir la disponibilidad con las mismas. */
export const OPC_IA = { expectedInputs: [{ type: 'text', languages: ['es'] }], expectedOutputs: [{ type: 'text', languages: ['es'] }] };

/**
 * activa: el modelo está descargado y listo · descargable: se puede descargar · descargando: Chrome lo está bajando ·
 * otro_navegador: el navegador no es Chrome y no la ofrece · sin_api: Chrome viejo, sin la Prompt API ·
 * no_disponible: Chrome con la API, pero el modelo no se puede usar en esta PC · consultando: todavía no se sabe.
 * @typedef {'activa'|'descargable'|'descargando'|'otro_navegador'|'sin_api'|'no_disponible'|'consultando'} CodigoIA
 */
/** @typedef {{codigo: CodigoIA, navegador: string, progreso: number|null, enganchada: boolean, error: string}} EstadoIA */

/** @type {EstadoIA} */
const estadoActual = { codigo: 'consultando', navegador: navegador(), progreso: null, enganchada: false, error: '' };
/** @type {Set<(e: EstadoIA) => void>} */
const oyentes = new Set();
/** @type {Promise<void>|null} */
let consulta = null;

/** Nombre del navegador. Brave y Edge se presentan como Chromium, así que se miran sus marcas propias. */
export function navegador() {
  const n = /** @type {any} */ (navigator);
  const ua = n.userAgent || '';
  if (n.brave) return 'Brave';
  const marcas = ((n.userAgentData && n.userAgentData.brands) || []).map((/** @type {any} */ b) => String(b.brand));
  if (marcas.includes('Microsoft Edge') || /Edg\//.test(ua)) return 'Edge';
  if (marcas.includes('Opera') || /OPR\//.test(ua)) return 'Opera';
  if (marcas.includes('Google Chrome')) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrom/.test(ua)) return 'Safari';
  return 'este navegador';
}

/** Estado actual (copia). */
export function estado() { return { ...estadoActual }; }

/** ¿Se puede usar la IA ahora? */
export function activa() { return estadoActual.codigo === 'activa'; }

/** @param {(e: EstadoIA) => void} fn @returns {() => void} Para dejar de escuchar. */
export function suscribir(fn) { oyentes.add(fn); return () => { oyentes.delete(fn); }; }

function avisar() { const e = estado(); for (const fn of [...oyentes]) { try { fn(e); } catch (err) { console.warn(err); } } }

/** Pregunta al navegador el estado del modelo (no descarga nada). */
export function actualizarEstado() {
  if (estadoActual.enganchada) return Promise.resolve();
  if (consulta) return consulta;
  consulta = (async () => {
    const LM = /** @type {any} */ (globalThis).LanguageModel;
    /** @type {string} */
    let disp = 'unavailable';
    if (LM && typeof LM.availability === 'function') {
      try { disp = String(await LM.availability(OPC_IA)); } catch (e) {
        try { disp = String(await LM.availability()); } catch (e2) { disp = 'unavailable'; }
      }
    }
    /** @type {CodigoIA} */
    let codigo;
    if (disp === 'available') codigo = 'activa';
    else if (disp === 'downloadable') codigo = 'descargable';
    else if (disp === 'downloading') codigo = 'descargando';
    else if (estadoActual.navegador !== 'Chrome') codigo = 'otro_navegador';
    else if (!LM) codigo = 'sin_api';
    else codigo = 'no_disponible';
    if (!estadoActual.enganchada) { estadoActual.codigo = codigo; avisar(); }
  })().finally(() => { consulta = null; });
  return consulta;
}

/** Texto del motivo de un error de descarga. @param {any} e */
function motivoError(e) {
  const n = e && e.name;
  if (n === 'QuotaExceededError') return 'No hay espacio suficiente en el disco (Chrome pide unos 22 GB libres en la unidad de su perfil).';
  if (n === 'NotAllowedError') return 'Chrome no permitió la descarga. Puede estar bloqueada por una política de la empresa, o hay que volver a tocar el botón.';
  if (n === 'NetworkError') return 'Se cortó la conexión. Volvé a intentarlo: Chrome retoma desde donde quedó.';
  if (n === 'NotSupportedError') return 'Esta PC no cumple los requisitos del modelo (memoria, placa de video o idioma).';
  return 'No se pudo descargar' + (e && e.message ? ': ' + e.message : '.');
}

/** Descarga el modelo, o engancha una descarga en curso para ver el progreso. Necesita un toque del usuario. */
export async function descargar() {
  const LM = /** @type {any} */ (globalThis).LanguageModel;
  if (!LM || estadoActual.enganchada) return;
  Object.assign(estadoActual, { codigo: 'descargando', enganchada: true, progreso: null, error: '' });
  avisar();
  try {
    const s = await LM.create({ ...OPC_IA, monitor(/** @type {any} */ m) {
      m.addEventListener('downloadprogress', (/** @type {any} */ e) => {
        estadoActual.progreso = Math.max(0, Math.min(1, Number(e.loaded) || 0));
        avisar();
      });
    } });
    try { s.destroy(); } catch (e) { /* nada */ }
  } catch (e) {
    console.warn(e);
    estadoActual.error = motivoError(e);
  }
  estadoActual.enganchada = false;
  estadoActual.progreso = null;
  await actualizarEstado();
}

// ---------------------------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------------------------

/** Texto corto para el pie. @param {EstadoIA} e */
export function textoCorto(e) {
  switch (e.codigo) {
    case 'activa': return 'IA: activa';
    case 'descargable': return 'IA: sin descargar';
    case 'descargando': return e.progreso === null ? 'IA: descargando…' : 'IA: descargando ' + Math.round(e.progreso * 100) + ' %';
    case 'otro_navegador': return 'IA: solo en Chrome';
    case 'consultando': return 'IA: …';
    default: return 'IA: no disponible';
  }
}

/** Requisitos para que Chrome ofrezca la IA. */
function requisitos() {
  const det = h('details', { class: 'ia-porque' });
  det.appendChild(h('summary', { text: '¿Cómo la activo?' }));
  const lista = h('ul');
  for (const t of [
    'Usá Chrome de escritorio (Windows 10 u 11, macOS 13 o posterior, o Linux), versión 148 o posterior: Menú › Ayuda › Información de Google Chrome.',
    'Necesita unos 22 GB libres en el disco donde está el perfil de Chrome, y placa de video con más de 4 GB o 16 GB de RAM con 4 núcleos. La primera descarga pide una conexión sin límite de datos.',
    'Para ver el estado del modelo, copiá chrome://on-device-internals en la barra de direcciones.',
    'En una PC de empresa puede estar bloqueada por política: consultalo con quien administra Chrome.'
  ]) lista.appendChild(h('li', { text: t }));
  det.appendChild(lista);
  return det;
}

/**
 * Control completo: estado, navegador y, según el caso, botón para descargar, progreso, motivo del error o requisitos.
 * Se repinta solo cuando cambia el estado y deja de escuchar cuando sale de la página.
 * @param {{clase?: string}} [opciones]
 * @returns {HTMLElement}
 */
export function control(opciones) {
  const caja = h('div', { class: 'ia-control' + (opciones && opciones.clase ? ' ' + opciones.clase : ''), 'aria-live': 'polite' });
  let confirmando = false;
  let montada = false;

  const pintar = () => {
    const e = estadoActual;
    caja.textContent = '';
    const nav = e.navegador;
    if (e.codigo === 'consultando') { caja.appendChild(h('span', { text: 'Consultando la IA del navegador…' })); return; }
    if (e.codigo === 'activa') {
      caja.appendChild(h('span', { class: 'ia-ok', text: '✓ IA del navegador descargada y activa en ' + nav + '.' }));
      caja.appendChild(h('span', { text: 'Entiende más formas de preguntar; los datos salen siempre de Infradoc.' }));
      return;
    }
    if (e.codigo === 'descargando' && e.enganchada) {
      const pct = e.progreso === null ? null : Math.round(e.progreso * 100);
      caja.appendChild(h('span', { text: pct === null ? 'Descargando la IA de Chrome…' : 'Descargando la IA de Chrome: ' + pct + ' %' }));
      const barra = h('progress', { class: 'ia-progreso', max: '100', 'aria-label': 'Progreso de la descarga' });
      if (pct !== null) barra.setAttribute('value', String(pct));
      caja.appendChild(barra);
      caja.appendChild(h('span', { class: 'ia-nota', text: 'Podés seguir usando Infradoc; la descarga sigue mientras Chrome esté abierto.' }));
      return;
    }
    if (e.codigo === 'otro_navegador') {
      caja.appendChild(h('span', { text: 'La IA del asistente solo funciona en Google Chrome, y estás en ' + nav + '. Para usarla, abrí Infradoc en Chrome. Acá el asistente responde las preguntas previstas.' }));
      return;
    }
    const titulo = e.codigo === 'descargable' ? 'IA del navegador sin descargar en ' + nav + ': el asistente responde las preguntas previstas.'
      : e.codigo === 'descargando' ? nav + ' está descargando su IA. Mientras tanto, el asistente responde las preguntas previstas.'
      : 'IA del navegador no disponible en ' + nav + ': el asistente responde las preguntas previstas.';
    caja.appendChild(h('span', { text: titulo }));
    if (e.error) caja.appendChild(h('span', { class: 'ia-error', role: 'alert', text: e.error }));
    if (e.codigo === 'descargable' && confirmando) {
      caja.appendChild(h('span', { text: 'Chrome va a descargar su modelo de IA (Gemini Nano, de varios GB; pide unos 22 GB libres en el disco). Se descarga una sola vez y corre en tu PC: tus datos no salen.' }));
      caja.appendChild(h('button', { type: 'button', class: 'primario', text: 'Descargar ahora', onclick: () => { confirmando = false; descargar(); } }));
      caja.appendChild(h('button', { type: 'button', text: 'Cancelar', onclick: () => { confirmando = false; pintar(); } }));
    } else if (e.codigo === 'descargable') {
      caja.appendChild(h('button', { type: 'button', text: e.error ? 'Reintentar la descarga' : 'Descargar la IA del navegador', onclick: () => { confirmando = true; pintar(); } }));
    } else if (e.codigo === 'descargando') {
      caja.appendChild(h('button', { type: 'button', text: 'Ver el progreso', onclick: () => descargar() }));
    } else if (e.codigo === 'sin_api') {
      caja.appendChild(h('span', { text: 'Tu Chrome no trae la IA integrada: actualizalo a la versión 148 o posterior.' }));
    } else {
      caja.appendChild(requisitos());
    }
  };

  const dejar = suscribir(() => {
    if (caja.isConnected) montada = true;
    else if (montada) { dejar(); return; }
    pintar();
  });
  pintar();
  actualizarEstado();
  return caja;
}

/**
 * Indicador corto para el pie. Al tocarlo ejecuta `alTocar` (abre el asistente, donde está el control completo).
 * @param {() => void} alTocar
 * @returns {HTMLElement}
 */
export function indicador(alTocar) {
  const b = h('button', { type: 'button', class: 'ia-indicador', title: 'IA del navegador: ver estado y descarga' });
  const pintar = () => {
    const e = estadoActual;
    b.textContent = textoCorto(e);
    b.className = 'ia-indicador ia-' + e.codigo;
  };
  b.addEventListener('click', alTocar);
  suscribir(pintar);
  pintar();
  actualizarEstado();
  return b;
}
