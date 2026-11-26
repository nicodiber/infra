// @ts-check
/**
 * Validaciones al salir de cada campo (QC78-A) compartidas por los formularios de alta (`assets/js/altas/*.js`) y por la edición
 * en las fichas. Cada `validar*` es una función pura de datos (lee el repositorio, no toca el DOM) que devuelve `null` (nada para
 * decir) o un `Resultado`: `mal` (con una corrección propuesta cuando se puede) u `ok` (confirmación útil: «Libre: U18 a U22»).
 * `enlazarValidacion` conecta una de esas funciones con un campo del formulario: borde y texto de error bajo el campo (`.ayuda.mal`),
 * en verde la confirmación (`.ayuda.ok`) y, si hay corrección, el botón «Usar …».
 *
 * Son AYUDAS en pantalla: las validaciones de `repositorio.js` siguen siendo la última palabra al guardar.
 */

import * as repositorio from './repositorio.js';
import { h, normalizar } from './utiles.js';
import { ipValida, validarLugarEnRack, primeraUnidadLibre } from './racks.js';
import { ipANumero, numeroAIp, calcularIpsDeVlan } from './red.js';

/**
 * @typedef {Object} Resultado
 * @property {'mal'|'ok'} nivel
 * @property {string} mensaje
 * @property {{texto: string, valor: string}} [sugerencia] Corrección propuesta: `texto` va en el botón, `valor` es lo que se escribe en el campo.
 */

// ---------------------------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------------------------

/**
 * Primer nombre libre parecido a `nombre`: si termina en número, el siguiente que no exista (`SW-PLA-03` → `SW-PLA-04`);
 * si no, le agrega « 2», « 3»…
 * @param {string} nombre @param {string[]} existentes
 */
export function siguienteNombreLibre(nombre, existentes) {
  const usados = new Set(existentes.map(normalizar));
  const m = /^(.*?)(\d+)$/.exec(nombre.trim());
  if (m) {
    let n = parseInt(m[2], 10);
    let candidato = '';
    do { n++; candidato = m[1] + String(n).padStart(m[2].length, '0'); } while (usados.has(normalizar(candidato)));
    return candidato;
  }
  let k = 2;
  while (usados.has(normalizar(nombre.trim() + ' ' + k))) k++;
  return nombre.trim() + ' ' + k;
}

/**
 * Nombre repetido dentro de la organización (sin mayúsculas ni acentos).
 * @param {{coleccion: string, campo: string, org: string, valor: string, exceptoId?: string|null, articulo: string}} o
 *   `articulo`: «un equipo», «un rack»… para el mensaje.
 * @returns {Promise<Resultado|null>}
 */
export async function validarNombreUnico(o) {
  const valor = (o.valor || '').trim();
  if (!valor) return null;
  const otros = await repositorio.listar(o.coleccion, (/** @type {any} */ r) => r.organizacion_id === o.org && r.id !== o.exceptoId);
  const nombres = otros.map((/** @type {any} */ r) => String(r[o.campo] || ''));
  if (!nombres.some(n => normalizar(n) === normalizar(valor))) return null;
  const sug = siguienteNombreLibre(valor, nombres);
  return { nivel: 'mal', mensaje: 'Ya hay ' + o.articulo + ' llamado «' + valor + '» en esta organización.', sugerencia: { texto: 'Usar ' + sug, valor: sug } };
}

// ---------------------------------------------------------------------------------------------
// IP
// ---------------------------------------------------------------------------------------------

/** Campos de un equipo que guardan una IP propia. @type {Array<[string, string, boolean]>} [clave, rótulo, dentro de equipo_campos] */
const ORIGENES_IP = [['equipo_ip_gestion', 'IP de gestión', false], ['router_ip_lan', 'IP en la LAN', true], ['firewall_ip_lan', 'IP interna', true], ['servidor_ip_ilo_idrac', 'iLO / iDRAC', true]];

/**
 * IP en uso por los equipos vigentes (no de baja) → quién la usa.
 * @param {any[]} equipos @param {string|null|undefined} exceptoId
 * @returns {Map<number, {equipo: any, origen: string}>}
 */
export function ipsEnUso(equipos, exceptoId) {
  /** @type {Map<number, {equipo: any, origen: string}>} */
  const uso = new Map();
  for (const e of equipos) {
    if (e.id === exceptoId || e.equipo_estado === 'baja') continue;
    for (const [k, rotulo, enCampos] of ORIGENES_IP) {
      const n = ipANumero(enCampos ? (e.equipo_campos || {})[k] : e[k]);
      if (n != null && !uso.has(n)) uso.set(n, { equipo: e, origen: rotulo });
    }
  }
  return uso;
}

/**
 * La IP libre más cercana a `n` dentro de [min, max] (primero la de arriba, después la de abajo).
 * @param {number} n @param {number} min @param {number} max @param {(x: number) => boolean} ocupada
 * @returns {number|null}
 */
export function ipLibreMasCercana(n, min, max, ocupada) {
  for (let d = 1; d <= max - min; d++) {
    for (const c of [n + d, n - d]) if (c >= min && c <= max && !ocupada(c)) return c;
  }
  return null;
}

/** @param {any} v */
function vlanDeIp(v, /** @type {number} */ n) {
  const r = leerCidr(v.vlan_red_cidr || '');
  return r && n >= r.base && n < r.base + r.tam ? r : null;
}

/**
 * Valida una IP: formato, repetida (con propuesta de la libre más cercana, dentro de la VLAN si se la conoce o de su /24) y, si se
 * pasa una VLAN elegida, que caiga dentro de su red.
 * @param {{ip: string, org: string, exceptoId?: string|null, vlan?: any|null}} o
 * @returns {Promise<Resultado|null>}
 */
export async function validarIp(o) {
  const ip = (o.ip || '').trim();
  if (!ip) return null;
  if (!ipValida(ip)) return { nivel: 'mal', mensaje: 'La IP no es válida (por ejemplo 10.10.20.21).' };
  const n = /** @type {number} */ (ipANumero(ip));
  const [equipos, vlans] = await Promise.all([repositorio.listar('equipos', { organizacion_id: o.org }), repositorio.listar('vlans', { organizacion_id: o.org })]);
  const uso = ipsEnUso(equipos, o.exceptoId);
  const propia = o.vlan ? vlanDeIp(o.vlan, n) : null;
  const vlan = o.vlan || vlans.find((/** @type {any} */ v) => vlanDeIp(v, n));
  /** Rango donde buscar una IP libre y qué direcciones no se ofrecen (gateway y rango DHCP de la VLAN). */
  const rangoDe = (/** @type {any} */ v) => {
    const c = v ? calcularIpsDeVlan(v, equipos.filter((/** @type {any} */ e) => e.id !== o.exceptoId)) : null;
    if (c && c.valida) return { min: c.primero, max: c.ultimo, reservada: (/** @type {number} */ x) => x === c.gw || c.esDhcp(x) };
    const base = Math.floor(n / 256) * 256;
    return { min: base + 1, max: base + 254, reservada: () => false };
  };
  if (o.vlan && !propia) {
    const c = rangoDe(o.vlan);
    const libre = ipLibreMasCercana(c.min - 1, c.min, c.max, x => uso.has(x) || c.reservada(x));
    return { nivel: 'mal', mensaje: 'Está fuera de la red ' + o.vlan.vlan_red_cidr + ' de la VLAN ' + o.vlan.vlan_numero + '.',
      sugerencia: libre == null ? undefined : { texto: 'Usar ' + numeroAIp(libre), valor: numeroAIp(libre) } };
  }
  const usada = uso.get(n);
  if (usada) {
    const c = rangoDe(vlan);
    const libre = ipLibreMasCercana(n, c.min, c.max, x => uso.has(x) || c.reservada(x));
    return { nivel: 'mal', mensaje: 'Ya la usa ' + usada.equipo.equipo_nombre + ' (' + usada.origen + ').' + (libre == null ? ' No quedan IP libres cerca.' : ' Libre más cercana: ' + numeroAIp(libre) + '.'),
      sugerencia: libre == null ? undefined : { texto: 'Usar ' + numeroAIp(libre), valor: numeroAIp(libre) } };
  }
  return { nivel: 'ok', mensaje: 'Libre' + (vlan ? ' · VLAN ' + vlan.vlan_numero + ' (' + vlan.vlan_nombre + ')' : '') + '.' };
}

// ---------------------------------------------------------------------------------------------
// Rack
// ---------------------------------------------------------------------------------------------

/**
 * Posición en el rack: entra, no pisa a otro equipo (propone el primer hueco libre) y confirma «Libre: U18 a U22».
 * @param {{rackId: string|null, inicio: number, alto: number, exceptoId?: string|null}} o
 * @returns {Promise<Resultado|null>}
 */
export async function validarPosicion(o) {
  if (!o.rackId || !Number.isInteger(o.inicio) || o.inicio < 1) return null;
  const alto = Number.isInteger(o.alto) && o.alto >= 1 ? o.alto : 1;
  const problema = await validarLugarEnRack(o.rackId, o.inicio, alto, o.exceptoId || null);
  const rack = await repositorio.obtener('racks', o.rackId);
  if (!problema) return { nivel: 'ok', mensaje: 'Libre: U' + o.inicio + (alto > 1 ? ' a U' + (o.inicio + alto - 1) : '') + '.' };
  if (!rack) return { nivel: 'mal', mensaje: problema };
  const montados = await repositorio.listar('equipos', (/** @type {any} */ e) => e.rack_id === o.rackId);
  const libre = primeraUnidadLibre(rack.rack_unidades_total, montados, alto, o.exceptoId);
  return { nivel: 'mal', mensaje: problema + (libre == null ? ' No hay un hueco libre de ' + alto + ' U en este rack.' : ' Primer hueco libre: U' + libre + '.'),
    sugerencia: libre == null ? undefined : { texto: 'Usar U' + libre, valor: String(libre) } };
}

// ---------------------------------------------------------------------------------------------
// VLAN
// ---------------------------------------------------------------------------------------------

/**
 * Red en CIDR → {base, tam} (base ya alineada a la red) o null si no es válida.
 * @param {string} cidr @returns {{base: number, tam: number}|null}
 */
export function leerCidr(cidr) {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})\s*$/.exec(cidr || '');
  const ip = m ? ipANumero(m[1]) : null;
  if (!m || ip == null || Number(m[2]) > 32) return null;
  const tam = Math.pow(2, 32 - Number(m[2]));
  return { base: Math.floor(ip / tam) * tam, tam };
}

/**
 * Número de VLAN: de 1 a 4094 y único en la organización (propone el siguiente libre).
 * @param {{numero: string, org: string, exceptoId?: string|null}} o
 * @returns {Promise<Resultado|null>}
 */
export async function validarNumeroVlan(o) {
  if (!String(o.numero).trim()) return null;
  const n = Number(o.numero);
  if (!Number.isInteger(n) || n < 1 || n > 4094) return { nivel: 'mal', mensaje: 'El número de VLAN va de 1 a 4094.' };
  const otras = await repositorio.listar('vlans', (/** @type {any} */ v) => v.organizacion_id === o.org && v.id !== o.exceptoId);
  const igual = otras.find((/** @type {any} */ v) => v.vlan_numero === n);
  if (!igual) return null;
  const usados = new Set(otras.map((/** @type {any} */ v) => v.vlan_numero));
  let libre = n + 1;
  while (usados.has(libre) && libre < 4094) libre++;
  return { nivel: 'mal', mensaje: 'Ya existe la VLAN ' + n + ' («' + igual.vlan_nombre + '»). Siguiente número libre: ' + libre + '.', sugerencia: { texto: 'Usar ' + libre, valor: String(libre) } };
}

/** @param {string} valor @returns {Resultado|null} */
export function validarCidr(valor) {
  if (!valor.trim()) return null;
  const r = leerCidr(valor);
  if (!r) return { nivel: 'mal', mensaje: 'La red tiene que estar en formato CIDR, por ejemplo 10.10.20.0/24.' };
  return { nivel: 'ok', mensaje: 'Red válida: ' + numeroAIp(r.base) + ' a ' + numeroAIp(r.base + r.tam - 1) + '.' };
}

/** @param {string} gateway @param {string} cidr @returns {Resultado|null} */
export function validarGateway(gateway, cidr) {
  if (!gateway.trim()) return null;
  const g = ipANumero(gateway);
  if (g == null) return { nivel: 'mal', mensaje: 'El gateway no es una IP válida (por ejemplo 10.10.20.1).' };
  const red = leerCidr(cidr);
  if (red && (g < red.base || g >= red.base + red.tam)) {
    const primera = numeroAIp(red.base + 1);
    return { nivel: 'mal', mensaje: 'El gateway ' + gateway.trim() + ' no está dentro de la red ' + cidr.trim() + '.', sugerencia: { texto: 'Usar ' + primera, valor: primera } };
  }
  return null;
}

/** @param {string} rango @param {string} cidr @returns {Resultado|null} */
export function validarRangoDhcp(rango, cidr) {
  if (!rango.trim()) return null;
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*[-–]\s*(\d{1,3}(?:\.\d{1,3}){3})\s*$/.exec(rango);
  const a = m ? ipANumero(m[1]) : null, b = m ? ipANumero(m[2]) : null;
  if (a == null || b == null) return { nivel: 'mal', mensaje: 'El rango tiene que ser «IP inicial - IP final», por ejemplo 10.10.20.100 - 10.10.20.200.' };
  if (a > b) return { nivel: 'mal', mensaje: 'El rango empieza después de donde termina.' };
  const red = leerCidr(cidr);
  if (red && (a < red.base || b >= red.base + red.tam)) return { nivel: 'mal', mensaje: 'El rango no está dentro de la red ' + cidr.trim() + '.' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// NVR de cámaras
// ---------------------------------------------------------------------------------------------

/**
 * Canal de un NVR: entero desde 1 y no usado por otra cámara del mismo NVR (propone el primero libre).
 * @param {{nvrId: string|null, canal: string, org: string, exceptoId?: string|null}} o
 * @returns {Promise<Resultado|null>}
 */
export async function validarCanalNvr(o) {
  if (!o.nvrId || !String(o.canal).trim()) return null;
  const n = Number(o.canal);
  if (!Number.isInteger(n) || n < 1) return { nivel: 'mal', mensaje: 'El canal es un número entero desde 1.' };
  const camaras = (await repositorio.listar('equipos', { organizacion_id: o.org }))
    .filter((/** @type {any} */ x) => x.equipo_tipo === 'camara' && x.id !== o.exceptoId && x.equipo_campos && x.equipo_campos.camara_nvr_id === o.nvrId);
  const choque = camaras.find((/** @type {any} */ x) => x.equipo_campos.camara_canal === n);
  if (!choque) return { nivel: 'ok', mensaje: 'Canal libre en ese NVR.' };
  const usados = new Set(camaras.map((/** @type {any} */ x) => x.equipo_campos.camara_canal));
  let libre = 1;
  while (usados.has(libre)) libre++;
  return { nivel: 'mal', mensaje: 'El canal ' + n + ' ya lo usa ' + choque.equipo_nombre + '. Primer canal libre: ' + libre + '.', sugerencia: { texto: 'Usar ' + libre, valor: String(libre) } };
}

// ---------------------------------------------------------------------------------------------
// Conexión con el formulario
// ---------------------------------------------------------------------------------------------

/**
 * Conecta una validación con un campo de formulario (`.campo` con su `.ayuda`).
 *  - Valida al SALIR del campo (`blur` en un cuadro de texto, `change` en un selector) y cada vez que cambia alguno de `tambien`.
 *  - Mientras el campo tiene un error, también revalida al escribir (para que el error se vaya apenas se corrige).
 *  - Muestra el resultado: `.campo.mal` / `.campo.ok`, el texto en `.ayuda` y, si hay corrección, el botón «Usar …» que escribe el valor.
 *  - Deja el estado en `campo.dataset.estado` (`mal`, `ok` o vacío) y avisa con el evento `infradoc:estado` (el pie del alta cuenta los `mal`).
 *  - `campo.validar()` (la devuelve esta función) valida ahora y espera el resultado: el alta la usa antes de guardar.
 * @param {HTMLElement} campo El `.campo` (de `campoDeAlta` o de `formulario`); si no tiene `.ayuda`, se crea.
 * @param {() => Promise<Resultado|null>|Resultado|null} validar Lee los valores actuales de los controles.
 * @param {{controles?: HTMLElement[], tambien?: HTMLElement[], aplicar?: (valor: string) => void}} [o]
 *   `controles`: los que validan al salir (por defecto, el primer control del campo). `tambien`: otros controles que, al cambiar, revalidan.
 *   `aplicar`: qué hacer al tocar «Usar …» (por defecto, escribir el valor en el primer control).
 * @returns {() => Promise<Resultado|null>}
 */
export function enlazarValidacion(campo, validar, o) {
  const opciones = o || {};
  const primero = /** @type {HTMLInputElement|null} */ (campo.querySelector('input:not([type=checkbox]), select, textarea'));
  let ayuda = /** @type {HTMLElement|null} */ (campo.querySelector('.ayuda'));
  if (!ayuda) { ayuda = h('div', { class: 'ayuda', hidden: 'hidden' }); campo.appendChild(ayuda); }
  const zonaAyuda = ayuda;
  if (zonaAyuda.dataset.base === undefined) zonaAyuda.dataset.base = zonaAyuda.textContent || '';
  zonaAyuda.setAttribute('aria-live', 'polite');
  let turno = 0;

  /** @param {Resultado|null} r */
  const mostrar = r => {
    campo.classList.toggle('mal', !!r && r.nivel === 'mal');
    campo.classList.toggle('ok', !!r && r.nivel === 'ok');
    campo.dataset.estado = r ? r.nivel : '';
    if (primero) { if (r && r.nivel === 'mal') primero.setAttribute('aria-invalid', 'true'); else primero.removeAttribute('aria-invalid'); }
    zonaAyuda.textContent = '';
    if (r) {
      zonaAyuda.className = 'ayuda ' + r.nivel;
      zonaAyuda.hidden = false;
      zonaAyuda.appendChild(document.createTextNode(r.mensaje));
      const s = r.sugerencia;
      if (s) {
        zonaAyuda.appendChild(document.createTextNode(' '));
        zonaAyuda.appendChild(h('button', { type: 'button', class: 'chico sug-usar', text: s.texto, onclick: () => {
          if (opciones.aplicar) opciones.aplicar(s.valor);
          else if (primero) { primero.value = s.valor; primero.dispatchEvent(new Event('input', { bubbles: true })); primero.dispatchEvent(new Event('change', { bubbles: true })); }
          ejecutar();
          if (primero) primero.focus();
        } }));
      }
      // Un error dentro de «Más datos» no se puede quedar escondido.
      if (r.nivel === 'mal') { const d = campo.closest('details'); if (d) d.open = true; }
    } else {
      zonaAyuda.className = 'ayuda';
      zonaAyuda.textContent = zonaAyuda.dataset.base || '';
      zonaAyuda.hidden = !zonaAyuda.dataset.base;
    }
    campo.dispatchEvent(new CustomEvent('infradoc:estado', { bubbles: true }));
  };

  /** @returns {Promise<Resultado|null>} */
  const ejecutar = async () => {
    const mio = ++turno;
    let r = null;
    try { r = await validar(); } catch (e) { console.error(e); }
    if (mio === turno) mostrar(r); // una respuesta vieja no pisa a una más nueva
    return r;
  };

  for (const c of opciones.controles || (primero ? [primero] : [])) {
    c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'blur', () => { ejecutar(); });
    c.addEventListener('input', () => { if (campo.dataset.estado === 'mal') ejecutar(); });
  }
  for (const c of opciones.tambien || []) c.addEventListener('change', () => { ejecutar(); });
  /** @type {any} */ (campo).validar = ejecutar;
  return ejecutar;
}
