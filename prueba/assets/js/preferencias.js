// @ts-check
/**
 * Preferencias del navegador (lo único que va en localStorage, AGENTS.md): tema y último perfil de prueba usado.
 * Nunca datos de las organizaciones.
 */

const CLAVE_TEMA = 'infradoc.tema';
const CLAVE_PERFIL = 'infradoc.ultimo_perfil';

/** El tema por defecto es siempre el claro (D-031). @returns {'claro'|'oscuro'} */
export function leerTema() {
  try { return localStorage.getItem(CLAVE_TEMA) === 'oscuro' ? 'oscuro' : 'claro'; } catch { return 'claro'; }
}

/** @param {'claro'|'oscuro'} tema */
export function guardarTema(tema) {
  try { localStorage.setItem(CLAVE_TEMA, tema); } catch { /* sin almacenamiento: el tema vale solo para esta visita */ }
  document.documentElement.dataset.theme = tema;
}

/** Último perfil de prueba con el que se ingresó (para resaltar su acceso rápido). @returns {string|null} */
export function leerUltimoPerfil() {
  try { return localStorage.getItem(CLAVE_PERFIL); } catch { return null; }
}

/** @param {string} perfil */
export function guardarUltimoPerfil(perfil) {
  try { localStorage.setItem(CLAVE_PERFIL, perfil); } catch { /* no es imprescindible */ }
}
