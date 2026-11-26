// @ts-check
/**
 * Alta de sedes y salas (colección `ubicaciones`, QC60). Registrada con `registrarAlta`; se abre con `abrirAlta('ubicaciones', …)`.
 *
 * Valores iniciales que entiende (`ctx.valores`):
 *  - `ubicacion_tipo`: 'sede' | 'sala'. Si viene, el tipo queda fijo (título «Nueva sede» / «Nueva sala»); si no, el formulario
 *    pregunta «Tipo» (el caso de «+ Crear nueva sede o sala…» desde otro formulario).
 *  - `ubicacion_padre_id`: sede preelegida de una sala.
 *  - `ubicacion_nombre`, `ubicacion_direccion`, `ubicacion_notas`.
 * Una sala pide su sede con `selectorConCrear`, así que desde una sala nueva se puede crear su sede (QC56-A).
 */

import * as repositorio from '../repositorio.js';
import { h } from '../utiles.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear, rotuloDeRegistro } from '../altas.js';

/**
 * Opciones de sedes de una organización (solo sedes).
 * @param {string} org @returns {Promise<Array<{valor: string, texto: string}>>}
 */
export async function opcionesDeSedes(org) {
  const sedes = await repositorio.listar('ubicaciones', r => r.organizacion_id === org && r.ubicacion_tipo === 'sede');
  return sedes.map(s => ({ valor: s.id, texto: s.ubicacion_nombre })).sort((a, b) => a.texto.localeCompare(b.texto, 'es', { numeric: true }));
}

registrarAlta('ubicaciones', async ctx => {
  const ID_AL_UB_DIR = idUnico('al-ub-dir');
  const ID_AL_UB_NOMBRE = idUnico('al-ub-nombre');
  const ID_AL_UB_NOTAS = idUnico('al-ub-notas');
  const ID_AL_UB_SEDE = idUnico('al-ub-sede');
  const ID_AL_UB_TIPO = idUnico('al-ub-tipo');
  const v = ctx.valores;
  const fijo = v.ubicacion_tipo === 'sede' || v.ubicacion_tipo === 'sala' ? /** @type {'sede'|'sala'} */ (v.ubicacion_tipo) : null;
  const hayUnaSede = (await opcionesDeSedes(ctx.organizacion_id)).length > 0;
  let tipo = fijo || (hayUnaSede ? 'sala' : 'sede');

  const nombre = /** @type {HTMLInputElement} */ (h('input', { id: ID_AL_UB_NOMBRE, type: 'text', maxlength: '120' }));
  nombre.value = v.ubicacion_nombre || '';
  const direccion = /** @type {HTMLInputElement} */ (h('input', { id: ID_AL_UB_DIR, type: 'text', maxlength: '200' }));
  direccion.value = v.ubicacion_direccion || '';
  const notas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: ID_AL_UB_NOTAS, rows: '2' }));
  notas.value = v.ubicacion_notas || '';
  const selTipo = /** @type {HTMLSelectElement} */ (h('select', { id: ID_AL_UB_TIPO }, [h('option', { value: 'sede', text: 'Sede (un lugar físico de la organización)' }), h('option', { value: 'sala', text: 'Sala (dentro de una sede)' })]));
  selTipo.value = tipo;
  const sede = selectorConCrear({ desde: 'ubicaciones', campo: 'ubicacion_padre_id', organizacion_id: ctx.organizacion_id, valor: v.ubicacion_padre_id || null,
    cargarOpciones: () => opcionesDeSedes(ctx.organizacion_id), valoresAlta: { ubicacion_tipo: 'sede' }, obligatorio: true, id: ID_AL_UB_SEDE, rotuloOrigen: 'Nueva sala' });

  const cSede = campoDeAlta(ID_AL_UB_SEDE, 'Sede *', sede);
  const cDir = campoDeAlta(ID_AL_UB_DIR, 'Dirección', direccion, 'Calle y número o una referencia.');
  const actualizar = () => { tipo = /** @type {'sede'|'sala'} */ (selTipo.value); cSede.hidden = tipo !== 'sala'; cDir.hidden = tipo !== 'sede'; };
  selTipo.addEventListener('change', actualizar);
  actualizar();
  const titulo = fijo === 'sede' ? 'Nueva sede' : fijo === 'sala' ? 'Nueva sala' : 'Nueva sede o sala';

  return abrirFormularioDeAlta({
    titulo, rotulo: ctx.rotulo, textoGuardar: fijo === 'sede' ? 'Crear sede' : fijo === 'sala' ? 'Crear sala' : 'Crear',
    cuerpo: [fijo ? null : campoDeAlta(ID_AL_UB_TIPO, 'Tipo *', selTipo), campoDeAlta(ID_AL_UB_NOMBRE, 'Nombre *', nombre), cSede, cDir, campoDeAlta(ID_AL_UB_NOTAS, 'Notas', notas)],
    enfocar: nombre,
    alGuardar: async () => {
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Falta el nombre.');
      if (tipo === 'sala' && !sede.value) throw new Error('Elegí la sede de la sala (o creala con «+ Crear nueva sede o sala…»).');
      return repositorio.guardar('ubicaciones', {
        organizacion_id: ctx.organizacion_id, ubicacion_nombre: nom, ubicacion_tipo: tipo,
        ubicacion_direccion: tipo === 'sede' ? (direccion.value.trim() || null) : null,
        ubicacion_padre_id: tipo === 'sala' ? sede.value : null, ubicacion_notas: notas.value.trim() || null
      }, ctx.usuario.id);
    }
  });
});

export { rotuloDeRegistro };
