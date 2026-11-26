// @ts-check
/**
 * Alta de racks (colección `racks`). Se abre con `abrirAlta('racks', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `ubicacion_id` (sede o sala preelegida), `rack_nombre`, `rack_unidades_total`, `rack_profundidad`, `rack_notas`, `duplicado_de`.
 * La «Sede / sala» se elige con `selectorConCrear`: si no existe, se crea en el momento.
 */

import * as repositorio from '../repositorio.js';
import { h, normalizar } from '../utiles.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';

registrarAlta('racks', async ctx => {
  const ID_RK_ALTO = idUnico('rk-alto');
  const ID_RK_DOS = idUnico('rk-dos');
  const ID_RK_NOMBRE = idUnico('rk-nombre');
  const ID_RK_NOTAS = idUnico('rk-notas');
  const ID_RK_PROF = idUnico('rk-prof');
  const ID_RK_UBIC = idUnico('rk-ubic');
  const v = ctx.valores;
  const nombre = /** @type {HTMLInputElement} */ (h('input', { id: ID_RK_NOMBRE, type: 'text' }));
  nombre.value = v.rack_nombre || '';
  const alto = /** @type {HTMLInputElement} */ (h('input', { id: ID_RK_ALTO, type: 'number', min: '1', value: String(v.rack_unidades_total || 42) }));
  const prof = /** @type {HTMLInputElement} */ (h('input', { id: ID_RK_PROF, type: 'number', min: '1' }));
  prof.value = v.rack_profundidad == null ? '' : String(v.rack_profundidad);
  const notas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: ID_RK_NOTAS, rows: '2' }));
  notas.value = v.rack_notas || '';
  const lugar = selectorConCrear({ desde: 'racks', campo: 'ubicacion_id', organizacion_id: ctx.organizacion_id, valor: v.ubicacion_id || null, obligatorio: true, id: ID_RK_UBIC, rotuloOrigen: 'Nuevo rack' });
  const dos = (/** @type {Node[]} */ ...c) => h('div', { class: 'rk-dos' }, c);
  return abrirFormularioDeAlta({
    titulo: 'Nuevo rack', rotulo: ctx.rotulo && ctx.rotulo !== 'Nuevo rack' ? ctx.rotulo : null, textoGuardar: 'Crear rack', enfocar: nombre,
    intro: v.duplicado_de ? 'Copia de «' + v.duplicado_de + '» (sin los equipos): el nombre tiene que ser distinto. Los campos con * son obligatorios.' : undefined,
    cuerpo: [dos(campoDeAlta(ID_RK_NOMBRE, 'Nombre *', nombre), campoDeAlta(ID_RK_UBIC, 'Sede / sala *', lugar)),
      dos(campoDeAlta(ID_RK_ALTO, 'Alto útil en U *', alto), campoDeAlta(ID_RK_PROF, 'Profundidad útil (mm)', prof)), campoDeAlta(ID_RK_NOTAS, 'Notas', notas)],
    alGuardar: async () => {
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Falta el nombre del rack.');
      const otros = await repositorio.listar('racks', r => r.organizacion_id === ctx.organizacion_id);
      if (otros.some(r => normalizar(r.rack_nombre) === normalizar(nom))) throw new Error('Ya existe un rack llamado «' + nom + '» en esta organización.');
      if (!lugar.value) throw new Error('Elegí en qué sede o sala está el rack (si no existe, usá «+ Crear nueva sede o sala…»).');
      const u1 = parseInt(alto.value, 10);
      if (!Number.isInteger(u1) || u1 < 1 || u1 > 60) throw new Error('El alto tiene que ser un número de U entre 1 y 60.');
      return repositorio.guardar('racks', { organizacion_id: ctx.organizacion_id, ubicacion_id: lugar.value, rack_nombre: nom, rack_unidades_total: u1,
        rack_profundidad: prof.value ? parseInt(prof.value, 10) : null, rack_notas: notas.value.trim() || null }, ctx.usuario.id);
    }
  });
});
