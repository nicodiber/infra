// @ts-check
/**
 * Marco común de la aplicación (user-flow.md, sección 1): cabecera «SINET: Infradoc», barra lateral filtrada por
 * permisos, migas de pan, menú del usuario, aviso emergente y ventana superpuesta (la usa el buscador).
 * No conoce las vistas: el router (app.js) lo usa y las vistas lo importan para armar su pantalla.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import { contadorCabecera } from './solicitudes.js';
import { leerTema, guardarTema } from './preferencias.js';
import { h, icono, toast, iniciales, fmtFechaHora } from './utiles.js';
import { ROTULO_PERFIL } from './modelos.js';

export { toast };

/** Versión visible de la aplicación: vive solo en index.html (`#version`), que se toca en cada entrega (AGENTS.md). */
export function versionVisible() {
  const v = document.getElementById('version');
  return v && v.textContent ? v.textContent : '';
}

/** @type {(() => void)|null} */
let alRefrescar = null;
/** @type {string|null} */
let seccionActual = null;

/** El router registra qué hacer cuando se pide ir a la pantalla en la que ya se está. @param {() => void} fn */
export function registrarRefresco(fn) { alRefrescar = fn; }

/** Navega a un hash (`#/inicio`). Si ya está ahí, vuelve a dibujar la pantalla. @param {string} hash */
export function ir(hash) {
  if (location.hash === hash) { if (alRefrescar) alRefrescar(); } else location.hash = hash;
}

/**
 * Entradas de la barra lateral: [texto, hash, sección, regla, ícono, color del tipo, grupo].
 * La regla es el módulo que hay que poder ver, o una acción de `puede`.
 * @type {Array<[string, string, string, {modulo?: import('./modelos.js').Modulo, accion?: import('./permisos.js').Accion}|null, string, string|null, string]>}
 */
const MENU = [
  ['Organizaciones', '#/organizaciones', 'organizaciones', { accion: 'ver_organizaciones' }, 'edificio', null, 'General'],
  ['Inicio', '#/inicio', 'inicio', null, 'inicio', null, 'ORG'],
  ['Red', '#/red', 'red', { modulo: 'red' }, 'red', 'equipo', 'ORG'],
  ['Servidores', '#/servidores', 'servidores', { modulo: 'servidores' }, 'servidor', 'servidor', 'ORG'],
  ['Racks', '#/racks', 'racks', { modulo: 'racks' }, 'rack', 'rack', 'ORG'],
  ['Configuraciones', '#/configuraciones', 'configuraciones', { modulo: 'configuraciones' }, 'configuracion', 'configuracion', 'ORG'],
  ['Credenciales', '#/credenciales', 'credenciales', { modulo: 'credenciales' }, 'credencial', 'credencial', 'ORG'],
  ['Equipos de escritorio', '#/escritorio', 'escritorio', { modulo: 'red' }, 'escritorio', null, 'ORG'],
  ['Personas', '#/personas', 'personas', { modulo: 'personas' }, 'persona', null, 'ORG'],
  ['Licencias', '#/licencias', 'licencias', { modulo: 'licencias' }, 'licencia', null, 'ORG'],
  ['Notas', '#/notas', 'notas', null, 'nota', null, 'ORG'],
  ['Etiquetas', '#/etiquetas', 'etiquetas', null, 'equipo', null, 'ORG'],
  ['Documentación PDF', '#/informe', 'informe', null, 'datos', null, 'ORG'],
  ['Usuarios', '#/usuarios', 'usuarios', { accion: 'ver_usuarios' }, 'usuarios', null, 'Administración'],
  ['Solicitudes', '#/solicitudes', 'solicitudes', null, 'solicitudes', null, 'Administración'],
  ['Registro de accesos', '#/accesos', 'accesos', { accion: 'ver_registro_accesos' }, 'accesos', null, 'Administración'],
  ['Datos del prototipo', '#/datos', 'datos', null, 'datos', null, 'Administración']
];

/** @param {string} id */
function el(id) { return /** @type {HTMLElement} */ (document.getElementById(id)); }

/**
 * ¿Aparece esta entrada del menú para el usuario? Las propias de una organización exigen tener una elegida.
 * @param {typeof MENU[number]} m
 * @param {import('./modelos.js').UsuarioSesion} u
 * @param {string|null} org
 */
function visible(m, u, org) {
  const regla = m[3];
  if (m[6] === 'ORG' && !org) return false;
  if (!regla) return true;
  if (regla.accion) return puede(u, regla.accion, null, org);
  if (regla.modulo) return puede(u, 'ver', regla.modulo, org);
  return true;
}

/** Nombre de la organización con la que se trabaja (o ''). */
async function nombreOrgActiva() {
  const id = sesion.organizacionActiva();
  if (!id) return '';
  const o = await repositorio.obtener('organizaciones', id);
  return o ? o.organizacion_nombre : '';
}

/**
 * Miga inicial: el superadmin parte de «Organizaciones».
 * @returns {Promise<Array<[string, string?]>>}
 */
export async function migasRaiz() {
  const u = sesion.usuarioActual();
  const nombre = await nombreOrgActiva();
  /** @type {Array<[string, string?]>} */
  const m = [];
  if (u && puede(u, 'ver_organizaciones')) m.push(['Organizaciones', '#/organizaciones']);
  if (nombre) m.push([nombre, '#/inicio']);
  return m;
}

/**
 * Pinta la cabecera (selector de organización, contador de solicitudes, usuario) y la barra lateral.
 * @param {string|null} seccion Entrada del menú que se resalta.
 */
export async function pintarMarco(seccion) {
  seccionActual = seccion;
  await pintarUltimaExportacion();
  const u = sesion.usuarioActual();
  document.body.classList.toggle('sinsesion', !u);
  const lateral = el('lateral');
  lateral.textContent = '';
  if (!u) return;
  const org = sesion.organizacionActiva();
  const nombreOrg = await nombreOrgActiva();

  // ---- cabecera
  const sel = /** @type {HTMLSelectElement} */ (el('selOrg'));
  const lbl = el('lblOrg');
  if (puede(u, 'cambiar_organizacion')) {
    const orgs = await repositorio.listar('organizaciones', null, { ordenarPor: 'organizacion_nombre' });
    sel.textContent = '';
    sel.appendChild(h('option', { value: '', text: 'Todas las organizaciones' }));
    for (const o of orgs) sel.appendChild(h('option', { value: o.id, text: o.organizacion_nombre, selected: o.id === org ? 'selected' : null }));
    sel.value = org || '';
    sel.hidden = false; lbl.hidden = true;
  } else {
    sel.hidden = true; lbl.hidden = false;
    lbl.textContent = '';
    lbl.appendChild(icono('edificio'));
    lbl.appendChild(document.createTextNode(nombreOrg));
  }
  const n = await contadorCabecera(u);
  el('insSol').textContent = String(n);
  el('btnSol').setAttribute('aria-label', 'Solicitudes: ' + n + (u.usuario_perfil === 'operario' ? ' pendientes tuyas' : ' para resolver'));
  const bu = el('btnUsuario');
  bu.textContent = '';
  bu.appendChild(h('span', { class: 'avatar', 'aria-hidden': 'true', text: iniciales(u.usuario_nombre) }));
  bu.appendChild(document.createTextNode(u.usuario_nombre + ' · ' + ROTULO_PERFIL[u.usuario_perfil] + ' ▾'));

  // ---- barra lateral
  let grupo = null;
  for (const m of MENU) {
    if (!visible(m, u, org)) continue;
    if (m[6] !== grupo) {
      grupo = m[6];
      lateral.appendChild(h('div', { class: 'lat-tit', text: grupo === 'ORG' ? nombreOrg : grupo }));
    }
    lateral.appendChild(h('a', { class: 'lat-item' + (m[5] ? ' t-' + m[5] : '') + (m[2] === seccion ? ' act' : ''), href: m[1], 'aria-current': m[2] === seccion ? 'page' : null }, [icono(m[4]), m[0]]));
  }
}

/** Pie: «Última exportación: 22/11/2026 23:10» o «Todavía no exportaste los datos» (MJ32, sin recordatorio). */
export async function pintarUltimaExportacion() {
  const caja = document.getElementById('ultima-exportacion');
  if (!caja) return;
  try {
    const f = await repositorio.ultimaExportacion();
    caja.textContent = f ? 'Última exportación: ' + fmtFechaHora(f) : 'Todavía no exportaste los datos';
  } catch { caja.textContent = ''; }
}

/** Vuelve a pintar la cabecera y la barra lateral (por ejemplo cuando cambia el contador de solicitudes). */
export function repintarMarco() { return pintarMarco(seccionActual); }

/**
 * Arma el esqueleto de una pantalla dentro del contenedor: código de pantalla (esquina) y migas de pan.
 * Después la vista agrega su contenido con `appendChild`.
 * @param {HTMLElement} contenedor
 * @param {{codigo: string, nombre: string, migas: Array<[string, string?]>}} datos
 */
export function pantalla(contenedor, datos) {
  contenedor.appendChild(h('div', { class: 'codigo', text: datos.codigo + ' · ' + datos.nombre }));
  const m = h('nav', { class: 'migas', 'aria-label': 'Migas de pan' });
  datos.migas.forEach((x, i) => {
    if (i) m.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true', text: '›' }));
    m.appendChild(x[1] ? h('a', { href: x[1], text: x[0] }) : h('span', { text: x[0], style: 'font-weight:700' }));
  });
  contenedor.appendChild(m);
}

/**
 * Pantalla que todavía no existe: estado vacío claro con su código (D-050).
 * @param {HTMLElement} contenedor
 * @param {{codigo: string, nombre: string, migas: Array<[string, string?]>, descripcion?: string, icono?: string}} datos
 */
export function estadoVacioProximaEntrega(contenedor, datos) {
  pantalla(contenedor, datos);
  contenedor.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [
    icono(datos.icono || 'construccion'),
    h('h2', { text: datos.nombre }),
    h('p', { text: 'Esta pantalla llega en la próxima entrega del prototipo.' }),
    datos.descripcion ? h('p', { text: datos.descripcion }) : null,
    h('p', { class: 'mut', text: 'Código de pantalla: ' + datos.codigo }),
    h('div', { class: 'herr' }, [h('a', { href: '#/inicio' }, ['Volver al inicio'])])
  ]));
}

// ---------------------------------------------------------------------------------------------
// Menú del usuario
// ---------------------------------------------------------------------------------------------

/** Cambia entre tema claro y oscuro y lo recuerda como preferencia. */
export function alternarTema() {
  const nuevo = leerTema() === 'claro' ? 'oscuro' : 'claro';
  guardarTema(nuevo);
  toast(nuevo === 'oscuro' ? 'Tema oscuro activado' : 'Tema claro activado');
}

export function cerrarMenuUsuario() { el('menuUsuario').style.display = 'none'; }

/** @param {() => void} alCambiarRol Qué hacer al elegir «Cambiar de rol» o «Salir». */
export function alternarMenuUsuario(alCambiarRol) {
  const m = el('menuUsuario');
  if (m.style.display === 'block') { cerrarMenuUsuario(); return; }
  const u = sesion.usuarioActual();
  if (!u) return;
  m.textContent = '';
  m.appendChild(h('div', { class: 'mut', style: 'padding:8px 12px;border-bottom:1px solid var(--borde);margin-bottom:4px' }, [
    h('b', { text: u.usuario_nombre, style: 'color:var(--texto)' }), h('div', { text: u.usuario_email }), h('div', { text: ROTULO_PERFIL[u.usuario_perfil] })]));
  const tema = leerTema();
  m.appendChild(h('a', { role: 'menuitem', href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); cerrarMenuUsuario(); alternarTema(); } },
    [icono(tema === 'claro' ? 'luna' : 'sol'), tema === 'claro' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro']));
  if (puede(u, 'ajustes_sistema')) m.appendChild(h('a', { role: 'menuitem', href: '#/ajustes', onclick: () => cerrarMenuUsuario() }, [icono('reloj'), 'Ajustes del sistema']));
  m.appendChild(h('a', { role: 'menuitem', href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); cerrarMenuUsuario(); alCambiarRol(); } }, [icono('usuarios'), 'Cambiar de rol']));
  m.appendChild(h('a', { role: 'menuitem', href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); cerrarMenuUsuario(); alCambiarRol(); } }, [icono('abrir'), 'Salir']));
  const r = el('btnUsuario').getBoundingClientRect();
  m.style.top = (r.bottom + 4) + 'px';
  m.style.right = (window.innerWidth - r.right) + 'px';
  m.style.display = 'block';
}

// ---------------------------------------------------------------------------------------------
// Ventana superpuesta
// ---------------------------------------------------------------------------------------------

/** @type {Element|null} */
let abridor = null;
/** @type {(() => void)|null} */
let alCerrarModal = null;

/**
 * Muestra un nodo en una ventana superpuesta.
 * @param {HTMLElement} nodo
 * @param {() => void} [alCerrar]
 */
export function abrirModal(nodo, alCerrar) {
  abridor = document.activeElement;
  const m = el('modal');
  m.textContent = '';
  m.appendChild(nodo);
  alCerrarModal = alCerrar || null;
  el('velo').classList.add('abierto');
}

export function modalAbierto() { return el('velo').classList.contains('abierto'); }

export function cerrarModal() {
  const v = el('velo');
  const estaba = v.classList.contains('abierto');
  v.classList.remove('abierto');
  el('modal').textContent = '';
  if (estaba && alCerrarModal) alCerrarModal();
  alCerrarModal = null;
  if (estaba && abridor && /** @type {HTMLElement} */ (abridor).focus && document.contains(abridor)) /** @type {HTMLElement} */ (abridor).focus();
  abridor = null;
}
