// @ts-check
/**
 * Pasos de verificación (D-055, MJ38): lista de control para tildar al «Confirmar vigente».
 * Dos orígenes: la plantilla del tipo de elemento (la edita el superadmin en Ajustes del sistema, P20; se guarda
 * en `ajustes_sistema` con la clave `verificacion_plantillas`) y los pasos propios del elemento (`verificacion_pasos`).
 * Todo el texto del usuario se pinta con `textContent`.
 */

import * as repositorio from './repositorio.js';
import { puede } from './permisos.js';
import { abrirModal, cerrarModal } from './marco.js';
import { h, ahoraISO, fmtFechaHora } from './utiles.js';

export const CLAVE_PLANTILLAS = 'verificacion_plantillas';

/** Tipos de elemento con plantilla, en el orden en que se muestran: clave → rótulo. @type {Object<string, string>} */
export const ROTULO_TIPO_VERIFICACION = {
  switch: 'Switch', router: 'Router', firewall: 'Firewall', access_point: 'Access point', servidor: 'Servidor',
  rack: 'Rack', patchera: 'Patchera', ups: 'UPS', camara: 'Cámara', puesto: 'Puesto', pc: 'PC', notebook: 'Notebook', impresora: 'Impresora',
  reloj: 'Reloj de control de personal', credencial: 'Credencial', licencia: 'Licencia', otro: 'Otro equipo'
};

/** Plantillas iniciales (QA39-A). @type {Object<string, string[]>} */
export const PLANTILLAS_INICIALES = {
  switch: ['Revisar los LED de los puertos', 'Comparar las etiquetas de los puertos con la ficha', 'Confirmar el uplink y la VLAN de administración'],
  router: ['Revisar los LED y el estado de los enlaces', 'Confirmar la IP de gestión y el acceso', 'Comparar la IP pública y el enlace con la ficha'],
  firewall: ['Revisar los LED y el estado de los enlaces', 'Confirmar la IP de gestión y el acceso', 'Confirmar la versión de firmware y la licencia vigente'],
  access_point: ['Revisar que esté encendido y con sus LED normales', 'Comparar el SSID con la ficha', 'Confirmar la ubicación física'],
  servidor: ['Revisar los LED de discos y fuentes', 'Confirmar la IP de gestión (iLO / iDRAC) y la del sistema', 'Comparar el rack y la U con la ficha', 'Confirmar que el último respaldo terminó bien'],
  rack: ['Comparar los equipos montados con la ficha del rack', 'Revisar el orden del cableado y las etiquetas', 'Confirmar el estado de la UPS y la ventilación'],
  patchera: ['Comparar las etiquetas de los puertos con la ficha', 'Revisar que los patch cords estén donde dice la ficha'],
  ups: ['Revisar el indicador de batería y de carga', 'Comparar los equipos conectados con la ficha'],
  camara: ['Confirmar qué mira y el canal en el NVR', 'Confirmar la IP y que se vea la imagen en el NVR'],
  puesto: ['Comparar la boca de pared con la ficha', 'Confirmar el equipo y la persona del puesto'],
  pc: ['Comparar el rótulo con la ficha', 'Confirmar la persona asignada', 'Confirmar el nombre de equipo y la IP'],
  notebook: ['Comparar el rótulo con la ficha', 'Confirmar la persona asignada'],
  impresora: ['Confirmar la IP y la ubicación', 'Comparar el modelo con la ficha'],
  reloj: ['Confirmar la IP y que sincronice la hora', 'Comparar el método de fichaje con la ficha'],
  credencial: ['Probar que el acceso siga funcionando', 'Confirmar el usuario y el host o la URL'],
  licencia: ['Comparar la cantidad de instalaciones con la ficha', 'Confirmar el vencimiento', 'Confirmar que la clave siga activa']
};

/**
 * Clave de plantilla de un elemento, o null si su colección no tiene.
 * @param {string} coleccion @param {any} r
 * @returns {string|null}
 */
export function claveTipoVerificacion(coleccion, r) {
  if (!r) return null;
  if (coleccion === 'equipos') {
    if (r.equipo_tipo !== 'otro') return r.equipo_tipo;
    const cat = String((r.equipo_campos || {}).otro_categoria || '').toLowerCase();
    if (cat.startsWith('reloj')) return 'reloj';
    if (cat.startsWith('impresora')) return 'impresora';
    if (cat.startsWith('notebook')) return 'notebook';
    if (cat.startsWith('pc')) return 'pc';
    return 'otro';
  }
  if (coleccion === 'racks') return 'rack';
  if (coleccion === 'puestos') return 'puesto';
  if (coleccion === 'credenciales') return 'credencial';
  if (coleccion === 'licencias') return 'licencia';
  return null;
}

/** @param {any} v @returns {string[]} */
function limpiar(v) { return Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []; }

/** Plantillas vigentes: las guardadas en Ajustes, completadas con las iniciales para los tipos que nunca se tocaron. @returns {Promise<Object<string, string[]>>} */
export async function leerPlantillas() {
  const base = structuredClone(PLANTILLAS_INICIALES);
  const a = (await repositorio.listar('ajustes_sistema', { ajuste_clave: CLAVE_PLANTILLAS }))[0];
  if (!a) return base;
  try {
    const g = JSON.parse(a.ajuste_valor);
    if (g && typeof g === 'object') for (const k of Object.keys(g)) base[k] = limpiar(g[k]);
  } catch { /* valor dañado: quedan las iniciales */ }
  return base;
}

/** Guarda todas las plantillas (solo superadmin; lo comprueba la vista). @param {Object<string, string[]>} plantillas @param {string} usuarioId */
export async function guardarPlantillas(plantillas, usuarioId) {
  const limpio = /** @type {Object<string, string[]>} */ ({});
  for (const k of Object.keys(plantillas)) limpio[k] = limpiar(plantillas[k]);
  const valor = JSON.stringify(limpio);
  const previo = (await repositorio.listar('ajustes_sistema', { ajuste_clave: CLAVE_PLANTILLAS }))[0];
  if (previo) await repositorio.guardar('ajustes_sistema', { ...previo, ajuste_valor: valor }, usuarioId);
  else await repositorio.guardar('ajustes_sistema', { ajuste_clave: CLAVE_PLANTILLAS, ajuste_valor: valor, actualizado_en: ahoraISO(), actualizado_por: usuarioId }, usuarioId);
}

/**
 * Pasos de un elemento: los de su tipo y los propios.
 * @param {string} coleccion @param {any} registro @param {Object<string, string[]>} [plantillas] Si ya se leyeron.
 * @returns {Promise<{tipo: string[], propios: string[], clave: string|null}>}
 */
export async function pasosDe(coleccion, registro, plantillas) {
  const clave = claveTipoVerificacion(coleccion, registro);
  const pl = plantillas || await leerPlantillas();
  return { clave, tipo: clave ? limpiar(pl[clave]) : [], propios: limpiar(registro && registro.verificacion_pasos) };
}

/** @param {string} coleccion @returns {'red'|'servidores'|'racks'|'credenciales'|'licencias'|'configuraciones'} */
function moduloDe(coleccion, registro) {
  if (coleccion === 'racks') return 'racks';
  if (coleccion === 'credenciales') return 'credenciales';
  if (coleccion === 'licencias') return 'licencias';
  if (coleccion === 'configuraciones') return 'configuraciones';
  return coleccion === 'equipos' && registro && registro.equipo_tipo === 'servidor' ? 'servidores' : 'red';
}

/**
 * Deja en el historial qué pasos se tildaron: un cambio del campo `verificacion_control` (queda también verificado hoy).
 * @param {string} coleccion @param {any} registro @param {string} usuarioId @param {string[]} tildados @param {string[]} total @param {string} comentario
 */
async function registrarControl(coleccion, registro, usuarioId, tildados, total, comentario) {
  const sin = total.filter(p => !tildados.includes(p));
  const texto = fmtFechaHora(ahoraISO()) + ' · ' + (tildados.length ? 'Tildó: ' + tildados.join('; ') : 'No tildó ningún paso')
    + (sin.length ? ' · Sin tildar: ' + sin.join('; ') : '') + (comentario ? ' · Comentario: ' + comentario : '');
  await repositorio.guardar(coleccion, { id: registro.id, verificacion_control: texto }, usuarioId, { motivo: sin.length ? 'Confirmado igual, con pasos sin tildar' : 'Verificación con pasos' });
}

/**
 * Reemplaza a `repositorio.confirmarVigente(coleccion, id, usuario.id)`: sin pasos confirma directo; con pasos abre el modal.
 * Devuelve true si quedó confirmado y false si la persona cerró el modal sin confirmar.
 * @param {string} coleccion @param {string} id @param {import('./modelos.js').UsuarioSesion} usuario
 * @returns {Promise<boolean>}
 */
export async function confirmarConPasos(coleccion, id, usuario) {
  const r = await repositorio.obtener(coleccion, id);
  if (!r) throw new Error('No se puede confirmar ese registro.');
  const { tipo, propios } = await pasosDe(coleccion, r);
  if (!tipo.length && !propios.length) { await repositorio.confirmarVigente(coleccion, id, usuario.id); return true; }
  return abrirModalVerificacion(coleccion, r, usuario);
}

/**
 * Modal con la lista para tildar. «Confirmar vigente» se habilita al tildar todo; «Confirmar igual» siempre, con comentario opcional.
 * Quien puede modificar el módulo edita además los pasos propios del elemento.
 * @param {string} coleccion @param {any} r @param {import('./modelos.js').UsuarioSesion} usuario
 * @returns {Promise<boolean>}
 */
function abrirModalVerificacion(coleccion, r, usuario) {
  return new Promise(resolver => {
    let terminado = false;
    const fin = (/** @type {boolean} */ v) => { if (terminado) return; terminado = true; resolver(v); };
    const mod = moduloDe(coleccion, r);
    const puedeEditar = puede(usuario, 'modificar', mod, r.organizacion_id);
    /** @type {string[]} */ let delTipo = [];
    /** @type {string[]} */ let propios = [];
    const cuerpo = h('div', { style: 'min-width:min(520px,92vw)' });
    const error = h('div', { class: 'msg mal', role: 'alert', style: 'display:none;margin-top:8px' });

    async function pintar() {
      const p = await pasosDe(coleccion, r);
      delTipo = p.tipo; propios = p.propios;
      const todos = delTipo.concat(propios);
      cuerpo.textContent = '';
      /** @type {HTMLInputElement[]} */
      const cajas = [];
      const caja = (/** @type {string} */ texto, /** @type {number} */ i) => {
        const c = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: 'vp-' + i }));
        cajas.push(c);
        return h('label', { for: 'vp-' + i, style: 'display:flex;gap:8px;align-items:flex-start;padding:5px 0;cursor:pointer' }, [c, h('span', { text: texto })]);
      };
      cuerpo.appendChild(h('h2', { text: 'Verificar en el lugar' }));
      cuerpo.appendChild(h('div', { class: 'mut', text: 'Tildá cada paso a medida que lo comprobás. «Confirmar vigente» se habilita al tildar todos.' }));
      let i = 0;
      if (delTipo.length) {
        cuerpo.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:10px', text: 'Pasos de ' + (ROTULO_TIPO_VERIFICACION[/** @type {string} */ (p.clave)] || 'este tipo') }));
        for (const t of delTipo) cuerpo.appendChild(caja(t, i++));
      }
      if (propios.length || puedeEditar) cuerpo.appendChild(h('div', { class: 'eyebrow', style: 'margin-top:10px', text: 'Pasos propios de este elemento' }));
      propios.forEach((t, k) => {
        const fila = caja(t, i++);
        if (puedeEditar) fila.appendChild(h('button', { type: 'button', class: 'chico', text: 'Quitar', 'aria-label': 'Quitar el paso: ' + t, onclick: async () => { await guardarPropios(propios.filter((_, j) => j !== k)); } }));
        cuerpo.appendChild(fila);
      });
      if (!propios.length && puedeEditar) cuerpo.appendChild(h('div', { class: 'mut', text: 'Todavía no hay pasos propios.' }));
      if (puedeEditar) {
        const nuevo = /** @type {HTMLInputElement} */ (h('input', { type: 'text', placeholder: 'Agregar un paso propio…', 'aria-label': 'Nuevo paso propio', style: 'flex:1' }));
        const agregar = async () => { const t = nuevo.value.trim(); if (t) await guardarPropios(propios.concat(t)); };
        nuevo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });
        cuerpo.appendChild(h('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [nuevo, h('button', { type: 'button', class: 'chico', text: 'Agregar', onclick: agregar })]));
      }
      const comentario = /** @type {HTMLInputElement} */ (h('input', { type: 'text', placeholder: 'Comentario (opcional, para «Confirmar igual»)', 'aria-label': 'Comentario', style: 'width:100%;margin-top:12px' }));
      cuerpo.appendChild(comentario);
      cuerpo.appendChild(error);
      const ok = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'primario', text: 'Confirmar vigente', disabled: 'disabled' }));
      const igual = h('button', { type: 'button', text: 'Confirmar igual', title: 'Confirma aunque queden pasos sin tildar; queda anotado en el historial.' });
      const cancelar = h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() });
      cuerpo.appendChild(h('div', { class: 'herr', style: 'margin-top:12px' }, [ok, igual, cancelar]));
      const revisar = () => { ok.disabled = !todos.length || cajas.some(c => !c.checked); };
      cajas.forEach(c => c.addEventListener('change', revisar));
      const confirmar = async (/** @type {boolean} */ forzado) => {
        error.style.display = 'none';
        const tildados = todos.filter((_, k) => cajas[k].checked);
        if (!forzado && tildados.length !== todos.length) return;
        ok.disabled = true;
        try {
          await registrarControl(coleccion, r, usuario.id, tildados, todos, comentario.value.trim());
          fin(true); cerrarModal();
        } catch (e) { error.textContent = e instanceof Error ? e.message : 'No se pudo confirmar.'; error.style.display = 'block'; revisar(); }
      };
      ok.addEventListener('click', () => confirmar(false));
      igual.addEventListener('click', () => confirmar(true));
    }

    /** @param {string[]} lista */
    async function guardarPropios(lista) {
      try {
        const nuevo = await repositorio.guardar(coleccion, { id: r.id, verificacion_pasos: lista }, usuario.id);
        r = nuevo || r; r.verificacion_pasos = lista;
        await pintar();
      } catch (e) { error.textContent = e instanceof Error ? e.message : 'No se pudo guardar el paso.'; error.style.display = 'block'; }
    }

    abrirModal(cuerpo, () => fin(false));
    pintar();
  });
}
