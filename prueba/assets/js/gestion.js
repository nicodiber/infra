// @ts-check
/**
 * Lógica compartida de la gestión de usuarios (P15, P16): qué roles se pueden asignar, quién puede gestionar a quién,
 * plantillas de permisos por rol y guardado de los permisos por módulo. Todo pasa por `repositorio` y `permisos`.
 */

import * as repositorio from './repositorio.js';
import { puede, esSuperior, rangoDe, RANGO } from './permisos.js';
import { MODULOS } from './modelos.js';
import { ahoraISO } from './utiles.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */
/** @typedef {import('./modelos.js').Usuario} Usuario */
/** @typedef {import('./modelos.js').Modulo} Modulo */
/** @typedef {import('./modelos.js').Perfil} Perfil */
/** @typedef {Object<string, {ver: boolean, mod: boolean}>} Matriz */

/** Roles de menor a mayor. @type {Perfil[]} */
export const ROLES_ASCENDENTE = ['operario', 'tecnico', 'gerente', 'superadmin'];

/**
 * Roles que `u` puede asignar al crear o editar: los inferiores al suyo (el superadmin, cualquiera).
 * @param {UsuarioSesion} u @returns {Perfil[]}
 */
export function rolesAsignables(u) {
  return ROLES_ASCENDENTE.filter(r => u.usuario_perfil === 'superadmin' || RANGO[r] < rangoDe(u));
}

/**
 * ¿Puede `u` ver, editar y desactivar a `objetivo`? Solo roles inferiores de su organización (superadmin: todos).
 * @param {UsuarioSesion} u @param {Usuario} objetivo
 */
export function puedeGestionar(u, objetivo) {
  if (!puede(u, 'ver_usuarios', null, objetivo.organizacion_id)) return false;
  if (u.usuario_perfil === 'superadmin') return true;
  return u.organizacion_id === objetivo.organizacion_id && esSuperior(u, objetivo);
}

/** Plantilla de permisos según el rol (permisos.md, regla 8). @param {Perfil} perfil @returns {Matriz} */
export function plantillaPermisos(perfil) {
  /** @type {Matriz} */
  const m = {};
  const total = perfil === 'superadmin' || perfil === 'gerente';
  for (const mod of MODULOS) m[mod] = { ver: true, mod: total };
  if (perfil === 'tecnico') for (const k of ['red', 'servidores', 'racks', 'configuraciones', 'personas', 'licencias']) m[k].mod = true;
  if (perfil === 'operario') m.usuarios.ver = false;
  return m;
}

/**
 * Lo máximo que `u` puede conceder en un módulo (nadie da más permisos de los que tiene, regla 6).
 * @param {UsuarioSesion} u @param {Modulo} modulo @param {string|null} orgId
 */
export function limiteConcesion(u, modulo, orgId) {
  return { ver: puede(u, 'ver', modulo, orgId), mod: puede(u, 'modificar', modulo, orgId) };
}

/** Permisos guardados de un usuario, como matriz. @param {string} usuarioId @returns {Promise<Matriz>} */
export async function permisosDe(usuarioId) {
  const filas = await repositorio.listar('permisos_modulo', { usuario_id: usuarioId });
  /** @type {Matriz} */
  const m = {};
  for (const mod of MODULOS) m[mod] = { ver: false, mod: false };
  for (const f of filas) m[f.modulo] = { ver: !!f.puede_ver, mod: !!f.puede_modificar };
  return m;
}

/**
 * Guarda la matriz de permisos de un usuario técnico u operario (alta, cambio o restauración de cada fila).
 * Para gerente y superadmin quita las filas, porque tienen acceso completo.
 * @param {string} usuarioId @param {Perfil} perfil @param {Matriz} matriz @param {string} actorId
 */
export async function guardarPermisos(usuarioId, perfil, matriz, actorId) {
  const filas = await repositorio.listar('permisos_modulo', { usuario_id: usuarioId }, { incluirBajas: true });
  const total = perfil === 'superadmin' || perfil === 'gerente';
  for (const mod of MODULOS) {
    const previa = filas.find(f => f.modulo === mod);
    if (total) {
      if (previa && !previa.eliminado_en) await repositorio.guardar('permisos_modulo', { ...previa, eliminado_en: ahoraISO() }, actorId);
      continue;
    }
    const ver = !!matriz[mod].ver;
    const modif = perfil === 'operario' ? false : !!matriz[mod].mod;
    if (previa) await repositorio.guardar('permisos_modulo', { ...previa, puede_ver: ver, puede_modificar: modif, eliminado_en: null }, actorId);
    else await repositorio.guardar('permisos_modulo', { usuario_id: usuarioId, modulo: mod, puede_ver: ver, puede_modificar: modif, puede_ver_credenciales: false }, actorId);
  }
}

/** Contraseña temporal ficticia del prototipo (no es seguridad real). */
export function claveTemporal() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'temp-' + Array.from(bytes, b => alfabeto[b % alfabeto.length]).join('');
}

/** @param {string} s */
export function emailValido(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

/** Mapa id → nombre de todos los usuarios (también dados de baja). @returns {Promise<Map<string, string>>} */
export async function nombresDeUsuarios() {
  const todos = await repositorio.listar('usuarios', null, { incluirBajas: true });
  return new Map(todos.map(u => [u.id, u.usuario_nombre]));
}

/**
 * Activa o desactiva un usuario (queda en el historial).
 * @param {Usuario} usuario @param {'activo'|'inactivo'} estado @param {string} actorId
 */
export async function cambiarEstadoUsuario(usuario, estado, actorId) {
  return repositorio.guardar('usuarios', { ...usuario, usuario_estado: estado }, actorId);
}
