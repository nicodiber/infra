// @ts-check
/**
 * Piezas chicas que comparten las altas de gestión (credenciales, configuraciones, personas, cuentas, asignaciones, licencias,
 * instalaciones, mapeos, servicios, notas y organizaciones): controles de texto, opciones de selectores y «Duplicar» (MJ48).
 * No registra ningún alta ni toca datos que no sean de lectura (`repositorio.listar`).
 */

import * as repositorio from '../repositorio.js';
import { h, normalizar } from '../utiles.js';
import { ir, toast } from '../marco.js';
import { abrirAlta } from '../altas.js';
import { ROTULO_EQUIPO_TIPO } from '../modelos.js';

/**
 * Campo de una línea.
 * @param {string} id @param {string|null|undefined} valor @param {Object<string, string>} [extra] atributos (`maxlength`, `placeholder`, `type`…)
 * @returns {HTMLInputElement}
 */
export function entrada(id, valor, extra) {
  const i = /** @type {HTMLInputElement} */ (h('input', { id, type: 'text', ...(extra || {}) }));
  i.value = valor == null ? '' : String(valor);
  return i;
}

/** @param {string} id @param {string|null|undefined} valor @param {number} [filas] @param {Object<string, string>} [extra] @returns {HTMLTextAreaElement} */
export function areaTexto(id, valor, filas, extra) {
  const t = /** @type {HTMLTextAreaElement} */ (h('textarea', { id, rows: String(filas || 2), style: 'width:100%', ...(extra || {}) }));
  t.value = valor == null ? '' : String(valor);
  return t;
}

/**
 * `<select>` con un rótulo por clave.
 * @param {string} id @param {Object<string, string>} rotulos @param {string|null|undefined} valor @returns {HTMLSelectElement}
 */
export function selectorDeRotulos(id, rotulos, valor) {
  const s = /** @type {HTMLSelectElement} */ (h('select', { id }, Object.keys(rotulos).map(k => h('option', { value: k, text: rotulos[k] }))));
  if (valor && rotulos[valor]) s.value = valor;
  return s;
}

/**
 * Opciones de personas para un selector: nombre y sector, con «(en baja)» para las que ya no trabajan.
 * @param {string} org @param {{soloActivas?: boolean}} [o]
 * @returns {Promise<Array<{valor: string, texto: string}>>}
 */
export async function opcionesPersonas(org, o) {
  const l = await repositorio.listar('personas', { organizacion_id: org });
  return l.filter(p => !(o && o.soloActivas) || p.persona_estado !== 'baja')
    .map(p => ({ valor: p.id, texto: p.persona_nombre + (p.persona_sector ? ' · ' + p.persona_sector : '') + (p.persona_estado === 'baja' ? ' (en baja)' : '') }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es', { numeric: true }));
}

/**
 * Opciones de equipos para un selector: nombre y tipo (los dados de baja de servicio no se ofrecen salvo `incluirBaja`).
 * @param {string} org @param {{filtro?: (e: any) => boolean, incluirBaja?: boolean}} [o]
 * @returns {Promise<Array<{valor: string, texto: string}>>}
 */
export async function opcionesEquipos(org, o) {
  const l = await repositorio.listar('equipos', { organizacion_id: org });
  return l.filter(e => (o && o.incluirBaja) || e.equipo_estado !== 'baja').filter(e => !o || !o.filtro || o.filtro(e))
    .map(e => ({ valor: e.id, texto: e.equipo_nombre + ' · ' + (e.equipo_tipo === 'otro' && e.equipo_campos && e.equipo_campos.otro_categoria ? String(e.equipo_campos.otro_categoria) : ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo) }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es', { numeric: true }));
}

/**
 * Opciones de cuentas de dominio: «DOMINIO\usuario» y su persona.
 * @param {string} org @returns {Promise<Array<{valor: string, texto: string}>>}
 */
export async function opcionesCuentas(org) {
  const [cuentas, personas] = await Promise.all([repositorio.listar('cuentas_dominio', { organizacion_id: org }), repositorio.listar('personas', { organizacion_id: org })]);
  const pn = new Map(personas.map(p => [p.id, p.persona_nombre]));
  return cuentas.map(c => ({ valor: c.id, texto: c.cuenta_dominio + '\\' + c.cuenta_usuario + (c.persona_id && pn.get(c.persona_id) ? ' · ' + pn.get(c.persona_id) : ' · cuenta de servicio') }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es', { numeric: true }));
}

/**
 * Nombre «copia»: «X (copia)», y «X (copia 2)» si ya existe. @param {string} nombre @param {string[]} existentes
 */
export function nombreDeCopia(nombre, existentes) {
  const base = nombre.replace(/ \(copia( \d+)?\)$/, '');
  const usados = new Set(existentes.map(normalizar));
  let n = base + ' (copia)';
  for (let k = 2; usados.has(normalizar(n)); k++) n = base + ' (copia ' + k + ')';
  return n;
}

/**
 * «Duplicar» (MJ48): abre el alta de la colección con los valores copiados de la ficha. Emite `infradoc:metrica` (`duplicar`).
 * Si se guarda, avisa y abre la ficha nueva; si se cancela, no pasa nada. Nunca se usa con credenciales (no se copian contraseñas).
 * @param {string} coleccion @param {{id: string, organizacion_id: string}} origen
 * @param {Object<string, any>} valores Valores iniciales del alta (ya con el nombre « (copia)»).
 * @param {(registro: any) => string} hashDeFicha
 * @param {string} [rotulo] Para el aviso («Configuración duplicada»).
 */
export async function duplicar(coleccion, origen, valores, hashDeFicha, rotulo) {
  window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo: 'duplicar', detalle: { coleccion, origen_id: origen.id } } }));
  const creado = await abrirAlta(coleccion, { organizacion_id: origen.organizacion_id, valores });
  if (!creado) return null;
  toast((rotulo || 'Registro') + ' duplicado: revisá los datos de la copia');
  ir(hashDeFicha(creado));
  return creado;
}

/**
 * Para los botones «Nuevo …» de las pantallas: abre el alta y, si se guarda, avisa y abre la ficha del registro creado.
 * @param {string} coleccion @param {(registro: any) => string} hashDeFicha @param {{valores?: Object<string, any>, aviso: string, alCrear?: (registro: any) => void}} o
 * @returns {Promise<any|null>}
 */
export async function crearYAbrir(coleccion, hashDeFicha, o) {
  const creado = await abrirAlta(coleccion, { valores: o.valores });
  if (!creado) return null;
  toast(o.aviso);
  if (o.alCrear) o.alCrear(creado); else ir(hashDeFicha(creado));
  return creado;
}

/**
 * Compatibilidad con los enlaces `#/<ficha>/nuevo`: vuelve al listado y abre el alta encima.
 * @param {string} coleccion @param {string} hashListado @param {(registro: any) => string} hashDeFicha @param {string} aviso
 */
export async function altaDesdeRuta(coleccion, hashListado, hashDeFicha, aviso) {
  ir(hashListado);
  await crearYAbrir(coleccion, hashDeFicha, { aviso });
}
