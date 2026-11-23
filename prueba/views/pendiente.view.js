// @ts-check
/**
 * Pantallas que todavía no existen en el prototipo (fichas, listados, usuarios, solicitudes, etc.).
 * Muestran un estado vacío claro con el código de pantalla de docs/user-flow.md (D-050).
 */

import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { pantalla, estadoVacioProximaEntrega, migasRaiz } from '../assets/js/marco.js';
import { h } from '../assets/js/utiles.js';
import { ROTULO_MODULO, ROTULO_PERFIL } from '../assets/js/modelos.js';

/**
 * @typedef {Object} InfoPendiente
 * @property {string} codigo Código de pantalla (P05, P06…).
 * @property {string} nombre
 * @property {import('../assets/js/modelos.js').Modulo} [modulo] Módulo que hay que poder ver.
 * @property {import('../assets/js/permisos.js').Accion} [accion] Acción que hay que poder hacer.
 * @property {string} [descripcion]
 * @property {string} [icono]
 * @property {string} [seccion]
 * @property {string} [archivo] Nombre del archivo de la vista en `views/` (sin `.view.js`).
 */

/**
 * @param {HTMLElement} contenedor
 * @param {InfoPendiente} info
 */
export async function renderVistaPendiente(contenedor, info) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  const migas = await migasRaiz();
  migas.push([info.nombre]);
  const permitido = info.accion ? puede(u, info.accion, null, org) : info.modulo ? puede(u, 'ver', info.modulo, org) : true;
  if (!permitido) {
    pantalla(contenedor, { codigo: info.codigo, nombre: info.nombre, migas });
    contenedor.appendChild(h('div', { class: 'aviso' }, [
      h('div', { text: 'Tu rol (' + ROTULO_PERFIL[u.usuario_perfil] + ') no tiene acceso a ' + (info.modulo ? ROTULO_MODULO[info.modulo] : info.nombre) + '.' }),
      h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/inicio', text: 'Volver al inicio' })])]));
    return;
  }
  estadoVacioProximaEntrega(contenedor, { codigo: info.codigo, nombre: info.nombre, migas, descripcion: info.descripcion, icono: info.icono });
}
