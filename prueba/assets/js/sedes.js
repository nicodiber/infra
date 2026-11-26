// @ts-check
/**
 * Piezas compartidas por «Sedes y salas» (`views/sedes.view.js`) y la ficha de una sede o sala (`views/ubicacion.view.js`):
 * conteos de lo que hay en cada lugar y el formulario de edición en el lugar (D-037).
 */

import * as repositorio from './repositorio.js';
import { h, normalizar } from './utiles.js';
import { selectorConCrear, campoDeAlta } from './altas.js';
import { opcionesDeSedes } from './altas/ubicaciones.js';

/**
 * Cuántos racks, equipos y puestos tiene cada lugar de la organización (solo lo vigente), por id de sede o sala. Los equipos
 * montados en un rack cuentan en el lugar del rack. Una sede NO suma lo de sus salas: usar `totalDeSede`.
 * @param {string} org
 * @returns {Promise<Map<string, {racks: number, equipos: number, puestos: number}>>}
 */
export async function conteosPorLugar(org) {
  const [racks, equipos, puestos] = await Promise.all([
    repositorio.listar('racks', { organizacion_id: org }), repositorio.listar('equipos', { organizacion_id: org }), repositorio.listar('puestos', { organizacion_id: org })]);
  /** @type {Map<string, {racks: number, equipos: number, puestos: number}>} */
  const m = new Map();
  const de = (/** @type {string|null} */ id) => { const k = id || ''; if (!m.has(k)) m.set(k, { racks: 0, equipos: 0, puestos: 0 }); return /** @type {any} */ (m.get(k)); };
  for (const r of racks) de(r.ubicacion_id).racks++;
  for (const e of equipos) if (e.ubicacion_id) de(e.ubicacion_id).equipos++;
  for (const p of puestos) de(p.ubicacion_id).puestos++;
  return m;
}

/**
 * Suma de una sede y de todas sus salas. @param {Map<string, {racks: number, equipos: number, puestos: number}>} conteos
 * @param {string} sedeId @param {any[]} salas Salas de esa sede.
 */
export function totalDeSede(conteos, sedeId, salas) {
  const t = { racks: 0, equipos: 0, puestos: 0 };
  for (const id of [sedeId, ...salas.map(s => s.id)]) { const c = conteos.get(id); if (c) { t.racks += c.racks; t.equipos += c.equipos; t.puestos += c.puestos; } }
  return t;
}

/**
 * Controles de edición de una sede o sala. `leer()` devuelve los valores a guardar o lanza un `Error` con el motivo.
 * La sede de una sala se elige con `selectorConCrear` (se puede crear otra sede al vuelo, QC56-A).
 * @param {any} u Registro actual. @param {string} org
 * @param {string} [prefijo] Para que los `id` no se repitan si hay varios formularios en pantalla.
 */
export function formularioDeEdicion(u, org, prefijo) {
  const px = (prefijo || 'ed') + '-' + u.id.slice(0, 8);
  const esSede = u.ubicacion_tipo === 'sede';
  const nombre = /** @type {HTMLInputElement} */ (h('input', { id: px + '-nombre', type: 'text', maxlength: '120' })); nombre.value = u.ubicacion_nombre || '';
  const dir = /** @type {HTMLInputElement} */ (h('input', { id: px + '-dir', type: 'text', maxlength: '200' })); dir.value = u.ubicacion_direccion || '';
  const notas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: px + '-notas', rows: '2', style: 'width:100%' })); notas.value = u.ubicacion_notas || '';
  const sede = esSede ? null : selectorConCrear({ desde: 'ubicaciones', campo: 'ubicacion_padre_id', organizacion_id: org, valor: u.ubicacion_padre_id, cargarOpciones: () => opcionesDeSedes(org),
    valoresAlta: { ubicacion_tipo: 'sede' }, obligatorio: true, id: px + '-sede', rotuloOrigen: 'Editar sala' });
  const nodo = h('div', { class: 'datos' }, [
    campoDeAlta(px + '-nombre', 'Nombre *', nombre),
    esSede ? campoDeAlta(px + '-dir', 'Dirección', dir) : campoDeAlta(px + '-sede', 'Sede *', /** @type {HTMLElement} */ (sede)),
    h('div', { class: 'campo', style: 'grid-column:1/-1' }, [h('label', { for: px + '-notas', text: 'Notas' }), notas])]);
  return {
    nodo, primero: nombre,
    /** @returns {any} */
    leer() {
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Falta el nombre.');
      if (!esSede && !(/** @type {HTMLSelectElement} */ (sede)).value) throw new Error('Elegí la sede de la sala.');
      return { ...u, ubicacion_nombre: nom, ubicacion_direccion: esSede ? (dir.value.trim() || null) : null,
        ubicacion_padre_id: esSede ? null : /** @type {HTMLSelectElement} */ (sede).value, ubicacion_notas: notas.value.trim() || null };
    }
  };
}

/** Texto «3 racks · 12 equipos · 5 puestos». @param {{racks: number, equipos: number, puestos: number}} c */
export function textoConteo(c) {
  const p = (/** @type {number} */ n, /** @type {string} */ a, /** @type {string} */ b) => n + ' ' + (n === 1 ? a : b);
  return p(c.racks, 'rack', 'racks') + ' · ' + p(c.equipos, 'equipo', 'equipos') + ' · ' + p(c.puestos, 'puesto', 'puestos');
}

export { normalizar };
