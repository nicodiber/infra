// @ts-check
/**
 * Sesión del prototipo (D-008): ingreso simulado con un usuario de prueba. No es seguridad real.
 * El usuario con sesión abierta se recuerda en sessionStorage (se pierde al cerrar la pestaña) y se guarda
 * junto con sus permisos y aprobaciones para que `permisos.js` pueda responder sin ir al almacenamiento.
 */

import * as repositorio from './repositorio.js';
import { guardarUltimoPerfil } from './preferencias.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */

const CLAVE_USUARIO = 'infradoc.sesion.usuario';
const CLAVE_ORG = 'infradoc.sesion.organizacion';
const CLAVE_PREVIO = 'infradoc.sesion.ingreso_previo';
const CLAVE_AVISO = 'infradoc.sesion.aviso_visto';

/** @type {UsuarioSesion|null} */
let actual = null;

/** Usuario con la sesión abierta, o null. */
export function usuarioActual() { return actual; }

/** @param {string} usuarioId @returns {Promise<UsuarioSesion|null>} */
async function cargar(usuarioId) {
  const u = await repositorio.obtener('usuarios', usuarioId);
  if (!u || u.usuario_estado !== 'activo') return null;
  const ctx = await repositorio.contextoUsuario(usuarioId);
  return { ...u, permisos: ctx.permisos, aprobaciones: ctx.aprobaciones };
}

/**
 * Abre la sesión de un usuario ya validado por `repositorio.autenticar`.
 * @param {string} usuarioId
 */
export async function ingresar(usuarioId) {
  const u = await cargar(usuarioId);
  if (!u) throw new Error('El usuario no puede ingresar.');
  const previo = await repositorio.ultimoIngreso(usuarioId);
  await repositorio.registrarIngreso(usuarioId);
  actual = u;
  sessionStorage.setItem(CLAVE_USUARIO, usuarioId);
  sessionStorage.removeItem(CLAVE_AVISO);
  if (previo) sessionStorage.setItem(CLAVE_PREVIO, previo); else sessionStorage.removeItem(CLAVE_PREVIO);
  // El superadmin elige organización en la cabecera; los demás tienen la suya.
  if (u.usuario_perfil === 'superadmin') sessionStorage.removeItem(CLAVE_ORG);
  else sessionStorage.setItem(CLAVE_ORG, String(u.organizacion_id));
  guardarUltimoPerfil(u.usuario_perfil);
  return u;
}

/** Retoma la sesión de esta pestaña (por ejemplo al recargar). Devuelve el usuario o null. */
export async function restaurar() {
  const id = sessionStorage.getItem(CLAVE_USUARIO);
  actual = id ? await cargar(id) : null;
  if (!actual) sessionStorage.removeItem(CLAVE_USUARIO);
  return actual;
}

/** Vuelve a leer permisos y aprobaciones del usuario (después de que cambian). */
export async function refrescar() {
  if (actual) actual = await cargar(actual.id);
  return actual;
}

export function salir() {
  actual = null;
  sessionStorage.removeItem(CLAVE_USUARIO);
  sessionStorage.removeItem(CLAVE_ORG);
  sessionStorage.removeItem(CLAVE_AVISO);
  sessionStorage.removeItem(CLAVE_PREVIO);
}

/** Organización con la que se está trabajando: la propia, o la elegida (superadmin). null = ninguna elegida. */
export function organizacionActiva() {
  if (!actual) return null;
  if (actual.usuario_perfil !== 'superadmin') return actual.organizacion_id;
  return sessionStorage.getItem(CLAVE_ORG);
}

/** @param {string|null} id Solo tiene efecto para el superadmin. */
export function fijarOrganizacionActiva(id) {
  if (!actual || actual.usuario_perfil !== 'superadmin') return;
  if (id) sessionStorage.setItem(CLAVE_ORG, id); else sessionStorage.removeItem(CLAVE_ORG);
}

/** Fecha-hora del ingreso anterior de este usuario en este navegador (o null si es la primera vez). */
export function ingresoPrevio() { return sessionStorage.getItem(CLAVE_PREVIO); }

/** ¿Ya cerró el aviso al ingresar (AV) en esta sesión? */
export function avisoVisto() { return sessionStorage.getItem(CLAVE_AVISO) === '1'; }
export function marcarAvisoVisto() { sessionStorage.setItem(CLAVE_AVISO, '1'); }
