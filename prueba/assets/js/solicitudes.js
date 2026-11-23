// @ts-check
/**
 * Consultas sobre solicitudes que comparten el marco (contador de la cabecera), el tablero (P03) y el aviso al
 * ingresar (AV). Combinan datos del repositorio con las reglas de permisos.js.
 */

import * as repositorio from './repositorio.js';
import { puedeResolverSolicitud } from './permisos.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */
/** @typedef {import('./modelos.js').Solicitud} Solicitud */
/** @typedef {import('./modelos.js').Usuario} Usuario */

/**
 * @typedef {Object} SolicitudDetallada
 * @property {Solicitud} solicitud
 * @property {Usuario|null} solicitante
 * @property {{id: string, credencial_nombre: string, credencial_tipo: string, organizacion_id: string}|null} credencial
 * @property {string} organizacion_nombre
 */

/**
 * Agrega a cada solicitud quién la pidió, sobre qué credencial y de qué organización.
 * @param {Solicitud[]} lista
 * @returns {Promise<SolicitudDetallada[]>}
 */
export async function detallar(lista) {
  const [usuarios, orgs] = await Promise.all([repositorio.listar('usuarios', null, { incluirBajas: true }), repositorio.listar('organizaciones')]);
  const porUsuario = new Map(usuarios.map(u => [u.id, u]));
  const porOrg = new Map(orgs.map(o => [o.id, o.organizacion_nombre]));
  const salida = [];
  for (const s of lista) {
    let credencial = null;
    if (s.solicitud_entidad === 'Credencial') {
      const c = await repositorio.obtener('credenciales', s.solicitud_entidad_id, { incluirBajas: true });
      if (c) credencial = { id: c.id, credencial_nombre: c.credencial_nombre, credencial_tipo: c.credencial_tipo, organizacion_id: c.organizacion_id };
    }
    salida.push({ solicitud: s, solicitante: porUsuario.get(s.solicitado_por) || null, credencial, organizacion_nombre: porOrg.get(s.organizacion_id) || '' });
  }
  return salida;
}

/**
 * Solicitudes pendientes que este usuario puede aprobar o rechazar. Si se indica una organización, solo las de ella;
 * si no, las de todas las que le toquen (el superadmin: todas).
 * @param {UsuarioSesion} usuario
 * @param {string|null} [organizacionId]
 */
export async function paraAprobar(usuario, organizacionId) {
  if (usuario.usuario_perfil === 'operario') return [];
  const pend = await repositorio.listar('solicitudes', s => s.solicitud_estado === 'pendiente' && (!organizacionId || s.organizacion_id === organizacionId));
  const det = await detallar(pend);
  return det.filter(d => d.solicitante && puedeResolverSolicitud(usuario, d.solicitud, d.solicitante))
    .sort((a, b) => (a.solicitud.solicitado_en < b.solicitud.solicitado_en ? 1 : -1));
}

/** Solicitudes hechas por el usuario (más nuevas primero). @param {UsuarioSesion} usuario */
export async function mias(usuario) {
  const l = await repositorio.listar('solicitudes', { solicitado_por: usuario.id }, { ordenarPor: 'solicitado_en', descendente: true });
  return detallar(l);
}

/**
 * Número que muestra el botón «Solicitudes» de la cabecera: las que puede resolver; o, para un operario,
 * las suyas que siguen pendientes.
 * @param {UsuarioSesion} usuario
 */
export async function contadorCabecera(usuario) {
  if (usuario.usuario_perfil === 'operario') return repositorio.contar('solicitudes', s => s.solicitado_por === usuario.id && s.solicitud_estado === 'pendiente');
  return (await paraAprobar(usuario, null)).length;
}
