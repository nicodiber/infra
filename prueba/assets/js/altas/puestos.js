// @ts-check
/**
 * Alta de puestos de trabajo (colección `puestos`). Se abre con `abrirAlta('puestos', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `ubicacion_id`, `puesto_nombre`, `puesto_boca_pared`.
 * La «Sede / sala» se elige con `selectorConCrear`.
 */

import * as repositorio from '../repositorio.js';
import { h, normalizar } from '../utiles.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';

registrarAlta('puestos', async ctx => {
  const ID_NP_BOCA = idUnico('np-boca');
  const ID_NP_NOMBRE = idUnico('np-nombre');
  const ID_NP_NOTAS = idUnico('np-notas');
  const ID_NP_UBIC = idUnico('np-ubic');
  const v = ctx.valores;
  const nombre = /** @type {HTMLInputElement} */ (h('input', { id: ID_NP_NOMBRE, type: 'text', placeholder: 'Ej.: Puesto 15 · Administración' }));
  nombre.value = v.puesto_nombre || '';
  const boca = /** @type {HTMLInputElement} */ (h('input', { id: ID_NP_BOCA, type: 'text', placeholder: 'Ej.: B-015 (opcional)' }));
  boca.value = v.puesto_boca_pared || '';
  const notas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: ID_NP_NOTAS, rows: '2' }));
  const lugar = selectorConCrear({ desde: 'puestos', campo: 'ubicacion_id', organizacion_id: ctx.organizacion_id, valor: v.ubicacion_id || null, obligatorio: true, id: ID_NP_UBIC, rotuloOrigen: 'Nuevo puesto' });
  return abrirFormularioDeAlta({
    titulo: 'Nuevo puesto de trabajo', rotulo: ctx.rotulo && ctx.rotulo !== 'Nuevo puesto' ? ctx.rotulo : null, textoGuardar: 'Crear puesto', enfocar: nombre,
    intro: 'Un puesto es el lugar donde llega una boca de pared. La sede o sala es obligatoria; el resto se completa en la ficha.',
    cuerpo: [campoDeAlta(ID_NP_NOMBRE, 'Nombre *', nombre), campoDeAlta(ID_NP_UBIC, 'Sede / sala *', lugar), campoDeAlta(ID_NP_BOCA, 'Boca de pared', boca), campoDeAlta(ID_NP_NOTAS, 'Notas', notas)],
    alGuardar: async () => {
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Escribí el nombre del puesto.');
      if (!lugar.value) throw new Error('Elegí la sede o sala del puesto (si no existe, usá «+ Crear nueva sede o sala…»).');
      const existentes = await repositorio.listar('puestos', { organizacion_id: ctx.organizacion_id });
      if (existentes.some(x => normalizar(x.puesto_nombre) === normalizar(nom))) throw new Error('Ya hay un puesto llamado «' + nom + '» en esta organización.');
      return repositorio.guardar('puestos', { organizacion_id: ctx.organizacion_id, ubicacion_id: lugar.value, puesto_nombre: nom,
        puesto_boca_pared: boca.value.trim() || null, puesto_notas: notas.value.trim() || null }, ctx.usuario.id);
    }
  });
});
