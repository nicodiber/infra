// @ts-check
/** P01 · Ingreso (CU01, H01): usuario y contraseña de prueba, más accesos rápidos por rol (D-008, D-021). */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { textoOrganizacionDeBaja } from '../assets/js/sesion.js';
import { ir, pantalla, versionVisible } from '../assets/js/marco.js';
import { leerUltimoPerfil } from '../assets/js/preferencias.js';
import { h, tabla } from '../assets/js/utiles.js';
import { ROTULO_PERFIL } from '../assets/js/modelos.js';

/** Avisa a las métricas (D-080) sin importarlas. @param {string} tipo @param {Object} detalle */
const metrica = (tipo, detalle) => { try { window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo, detalle } })); } catch { /* nada */ } };

/** @param {string} perfil */
const destino = perfil => (perfil === 'superadmin' ? '#/organizaciones' : '#/inicio');

/** @param {HTMLElement} contenedor */
export async function renderVistaIngreso(contenedor) {
  pantalla(contenedor, { codigo: 'P01', nombre: 'Ingreso', migas: [['Ingreso']] });
  const usuarios = await repositorio.usuariosDePrueba();
  const ultimo = leerUltimoPerfil();

  const err = h('div', { role: 'alert', 'aria-live': 'assertive' });
  const usr = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'campoUsuario', autocomplete: 'off', placeholder: 'Por ejemplo: admin@infradoc.example', 'aria-label': 'Usuario' }));
  const avisoPrevio = sesion.tomarAvisoIngreso();
  if (avisoPrevio) err.appendChild(h('div', { class: 'msg mal', text: avisoPrevio }));
  const pwd = /** @type {HTMLInputElement} */ (h('input', { type: 'password', id: 'campoClave', autocomplete: 'off', placeholder: 'Contraseña de prueba', 'aria-label': 'Contraseña' }));

  /** @param {string} usuarioId @param {string} [como] */
  async function entrar(usuarioId, como = 'acceso_rapido') {
    err.textContent = '';
    try {
      const u = await sesion.ingresar(usuarioId);
      metrica('ingreso', { rolElegido: u.usuario_perfil, como });
      ir(destino(u.usuario_perfil));
    } catch (e) { err.appendChild(h('div', { class: 'msg mal', text: e instanceof Error ? e.message : 'No se pudo ingresar.' })); }
  }

  async function ingresar() {
    err.textContent = '';
    const u = await repositorio.autenticar(usr.value, pwd.value);
    if (!u) {
      metrica('ingreso_fallido', {});
      err.appendChild(h('div', { class: 'msg mal', text: 'Usuario o contraseña incorrectos.' }));
      return;
    }
    await entrar(u.id, 'formulario');
  }

  const principales = ['superadmin', 'gerente', 'tecnico', 'operario'].map(perfil => usuarios.find(u => u.perfil === perfil)).filter(Boolean);
  const rapidos = principales.map(u => {
    const usuario = /** @type {NonNullable<typeof u>} */ (u);
    return h('button', { type: 'button', class: 'rol-rapido', 'data-perfil': usuario.perfil, onclick: () => entrar(usuario.id), disabled: usuario.organizacion_baja,
      title: usuario.organizacion_baja ? textoOrganizacionDeBaja(String(usuario.organizacion)) : null,
      'aria-label': 'Ingresar como ' + ROTULO_PERFIL[usuario.perfil] + ': ' + usuario.nombre + (usuario.organizacion_baja ? '. ' + textoOrganizacionDeBaja(String(usuario.organizacion)) : '') }, [
      h('span', { class: 'rol', text: ROTULO_PERFIL[usuario.perfil] + (usuario.perfil === ultimo ? ' · último usado' : '') }),
      h('span', { text: usuario.nombre }),
      h('small', { text: usuario.organizacion_baja ? usuario.organizacion + ' · dada de baja' : usuario.organizacion || 'Todas las organizaciones' })]);
  });

  const orden = ['superadmin', 'gerente', 'tecnico', 'operario'];
  const filas = usuarios.slice().sort((a, b) => (a.organizacion || '').localeCompare(b.organizacion || '') || orden.indexOf(a.perfil) - orden.indexOf(b.perfil))
    .map(u => [ROTULO_PERFIL[u.perfil], u.nombre, h('code', { text: u.email }), h('code', { text: u.clave }), u.organizacion || 'Todas',
      u.organizacion_baja
        ? h('div', null, [h('button', { type: 'button', class: 'chico', text: 'Ingresar', disabled: true, 'aria-label': 'Ingresar como ' + u.nombre + '. ' + textoOrganizacionDeBaja(String(u.organizacion)) }), h('div', { class: 'mut', text: textoOrganizacionDeBaja(String(u.organizacion)) })])
        : h('button', { type: 'button', class: 'chico', text: 'Ingresar', onclick: () => entrar(u.id, 'tabla'), 'aria-label': 'Ingresar como ' + u.nombre })]);

  contenedor.appendChild(h('div', { class: 'login' }, [
    h('div', { class: 'aviso-flujo' }, [h('b', { text: 'Prototipo con datos ficticios. ' }), 'No cargues datos reales: lo que cargues queda solo en este navegador y sin cifrar.']),
    h('form', { class: 'bloque', onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); ingresar(); } }, [
      h('h1', { text: 'SINET: Infradoc', style: 'margin-bottom:4px' }),
      h('div', { class: 'mut', text: 'Ingresá con tu usuario. En esta versión de prueba alcanza con tocar un acceso rápido.' }),
      h('label', { for: 'campoUsuario', text: 'Usuario' }), usr,
      h('label', { for: 'campoClave', text: 'Contraseña' }), pwd, err,
      h('div', { class: 'herr' }, [h('button', { type: 'submit', class: 'primario', text: 'Ingresar' }), h('span', { class: 'version', text: 'Infradoc ' + versionVisible() })])]),
    h('div', { class: 'bloque', style: 'margin-top:10px' }, [
      h('h2', { text: 'Accesos rápidos por rol' }),
      h('div', { class: 'fila', style: 'margin-top:8px' }, rapidos),
      h('div', { class: 'mut', style: 'margin-top:8px', text: 'Cada rol ve y puede hacer cosas distintas. Probá con los cuatro. El superadmin ve todas las organizaciones; los demás, solo la suya.' })]),
    h('details', { class: 'bloque', style: 'margin-top:10px' }, [
      h('summary', { text: 'Todos los usuarios de prueba (' + usuarios.length + ')', style: 'cursor:pointer;font-weight:700' }),
      h('div', { class: 'mut', style: 'margin:6px 0', text: 'Contraseñas ficticias, solo para este prototipo. Hay dos usuarios con permisos reducidos (técnico y operario de Agro Demo Pampa) para ver cómo cambia lo que se ve.' }),
      tabla(['Rol', 'Nombre', 'Usuario', 'Contraseña', 'Organización', ''], filas, { clase: 'usuarios-prueba' })])]));
}
