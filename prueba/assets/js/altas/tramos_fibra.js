// @ts-check
/**
 * Alta de tramos de fibra (colección `tramos_fibra`, D-083). Se abre con `abrirAlta('tramos_fibra', {organizacion_id, valores, rotulo})`.
 *
 * Valores iniciales: `tramo_nombre`, `tramo_origen_ubicacion_id`, `tramo_destino_ubicacion_id`, `tramo_origen_equipo_id`,
 * `tramo_destino_equipo_id`, `tramo_pelos`, `tramo_tipo`, `tramo_conector`, `tramo_longitud_m`.
 * Origen y destino (sede o sala) y las patcheras se eligen con «+ Crear …».
 */

import * as repositorio from '../repositorio.js';
import { h, normalizar } from '../utiles.js';
import { ROTULO_FIBRA_TIPO, CONECTORES_FIBRA } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear, opcionesDe } from '../altas.js';
import { enlazarValidacion, validarNombreUnico } from '../validaciones.js';

registrarAlta('tramos_fibra', async ctx => {
  const v = ctx.valores;
  const org = ctx.organizacion_id;
  const ID = { nom: idUnico('tf-nom'), ori: idUnico('tf-ori'), des: idUnico('tf-des'), oeq: idUnico('tf-oeq'), deq: idUnico('tf-deq'), pel: idUnico('tf-pel'), tip: idUnico('tf-tip'), con: idUnico('tf-con'), lon: idUnico('tf-lon') };
  const nombre = /** @type {HTMLInputElement} */ (h('input', { id: ID.nom, type: 'text', maxlength: '120', placeholder: 'Ej.: Fibra Administración ↔ Silos' }));
  nombre.value = v.tramo_nombre || '';
  const sedeSala = (/** @type {string} */ campo, /** @type {string} */ id) => selectorConCrear({ desde: 'tramos_fibra', campo, organizacion_id: org, valor: v[campo] || null, obligatorio: true, id, rotuloOrigen: 'Nuevo tramo de fibra' });
  const origen = sedeSala('tramo_origen_ubicacion_id', ID.ori), destino = sedeSala('tramo_destino_ubicacion_id', ID.des);
  const patchera = (/** @type {string} */ campo, /** @type {string} */ id) => selectorConCrear({ desde: 'tramos_fibra', campo, organizacion_id: org, valor: v[campo] || null, id, rotuloOrigen: 'Nuevo tramo de fibra',
    cargarOpciones: () => opcionesDe('equipos', org, { filtro: e => e.equipo_tipo === 'patchera' }), valoresAlta: { equipo_tipo: 'patchera', tipos: ['patchera'] } });
  const oeq = patchera('tramo_origen_equipo_id', ID.oeq), deq = patchera('tramo_destino_equipo_id', ID.deq);
  const pelos = /** @type {HTMLInputElement} */ (h('input', { id: ID.pel, type: 'number', min: '1', step: '1' }));
  pelos.value = String(v.tramo_pelos || 12);
  const tipo = /** @type {HTMLSelectElement} */ (h('select', { id: ID.tip }, Object.keys(ROTULO_FIBRA_TIPO).map(k => h('option', { value: k, text: ROTULO_FIBRA_TIPO[k] }))));
  tipo.value = v.tramo_tipo || 'monomodo';
  const conector = /** @type {HTMLSelectElement} */ (h('select', { id: ID.con }, CONECTORES_FIBRA.map(c => h('option', { value: c, text: c }))));
  conector.value = v.tramo_conector || 'LC';
  const lon = /** @type {HTMLInputElement} */ (h('input', { id: ID.lon, type: 'number', min: '0', step: 'any' }));
  lon.value = v.tramo_longitud_m == null ? '' : String(v.tramo_longitud_m);
  const cNombre = campoDeAlta(ID.nom, 'Nombre *', nombre);
  enlazarValidacion(cNombre, () => validarNombreUnico({ coleccion: 'tramos_fibra', campo: 'tramo_nombre', org, valor: nombre.value, articulo: 'un tramo' }));
  return abrirFormularioDeAlta({
    titulo: 'Nuevo tramo de fibra', rotulo: ctx.rotulo && ctx.rotulo !== 'Nuevo tramo de fibra' ? ctx.rotulo : null, textoGuardar: 'Crear tramo', enfocar: nombre,
    secciones: [{ titulo: 'Identificación', cuerpo: [cNombre] },
      { titulo: 'Extremos', cuerpo: [campoDeAlta(ID.ori, 'Origen (sede / sala) *', origen), campoDeAlta(ID.des, 'Destino (sede / sala) *', destino), campoDeAlta(ID.oeq, 'Patchera de origen', oeq), campoDeAlta(ID.deq, 'Patchera de destino', deq)] },
      { titulo: 'Fibra', cuerpo: [campoDeAlta(ID.pel, 'Cantidad de pelos *', pelos), campoDeAlta(ID.tip, 'Tipo de fibra *', tipo), campoDeAlta(ID.con, 'Conector *', conector), campoDeAlta(ID.lon, 'Longitud (m)', lon)] }],
    alGuardar: async () => {
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Falta el nombre del tramo.');
      const otros = await repositorio.listar('tramos_fibra', { organizacion_id: org });
      if (otros.some(t => normalizar(t.tramo_nombre) === normalizar(nom))) throw new Error('Ya existe un tramo llamado «' + nom + '» en esta organización.');
      if (!origen.value || !destino.value) throw new Error('Elegí el origen y el destino (si no existen, usá «+ Crear nueva sede o sala…»).');
      const n = Number(pelos.value);
      if (!Number.isInteger(n) || n < 1) throw new Error('La cantidad de pelos tiene que ser un entero de 1 o más.');
      const l = lon.value.trim() === '' ? null : Number(lon.value);
      if (l != null && !(l >= 0)) throw new Error('La longitud tiene que ser un número positivo.');
      return repositorio.guardar('tramos_fibra', { organizacion_id: org, tramo_nombre: nom, tramo_origen_ubicacion_id: origen.value, tramo_destino_ubicacion_id: destino.value,
        tramo_origen_equipo_id: oeq.value || null, tramo_destino_equipo_id: deq.value || null, tramo_pelos: n, tramo_tipo: tipo.value, tramo_conector: conector.value,
        tramo_longitud_m: l, tramo_pelos_usados: [], tramo_mediciones: [] }, ctx.usuario.id);
    }
  });
});
