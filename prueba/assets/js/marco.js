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
  ['Sedes y salas', '#/sedes', 'sedes', { modulo: 'organizacion' }, 'edificio', null, 'ORG'],
  ['Racks', '#/racks', 'racks', { modulo: 'racks' }, 'rack', 'rack', 'ORG'],
  ['Configuraciones', '#/configuraciones', 'configuraciones', { modulo: 'configuraciones' }, 'configuracion', 'configuracion', 'ORG'],
  ['Credenciales', '#/credenciales', 'credenciales', { modulo: 'credenciales' }, 'credencial', 'credencial', 'ORG'],
  ['Dominios y servicios', '#/servicios', 'servicios', { modulo: 'configuraciones' }, 'red', null, 'ORG'],
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

/**
 * Un diálogo abierto. El primero vive en `#velo` / `#modal` (index.html); los que se abren encima se crean aparte
 * (`.velo-apilado` > `.modal-apilado`, hijos de `body`) y se sacan del DOM al cerrarse.
 * @typedef {Object} NivelModal
 * @property {HTMLElement} velo Fondo oscuro de este nivel.
 * @property {HTMLElement} caja Contenedor del diálogo (donde está el nodo).
 * @property {(() => void)|null} alCerrar Se llama al cerrarlo, por el motivo que sea (Esc, fondo, `cerrarModal`).
 * @property {Element|null} abridor Elemento que tenía el foco al abrirlo, para devolvérselo al cerrarlo.
 */

/** Pila de diálogos: el último es el de arriba (el único que recibe teclado y clics). @type {NivelModal[]} */
const pila = [];

/**
 * Muestra un nodo en una ventana superpuesta. Si ya hay un diálogo abierto, el nuevo se apila ENCIMA: el de abajo queda en el
 * DOM con su estado intacto (lo escrito en sus campos no se pierde), tapado por el fondo y sin recibir foco ni clics (`inert`).
 * `cerrarModal()` cierra solo el de arriba y deja el de abajo como estaba. El nodo debería llevar `role="dialog"` y `aria-label`.
 * Pensado para «+ Crear nuevo» (QC55-B): ver `assets/js/altas.js` y `docs/desarrollo/guia-altas.md`.
 * @param {HTMLElement} nodo
 * @param {() => void} [alCerrar]
 */
export function abrirModal(nodo, alCerrar) {
  const abridor = document.activeElement;
  /** @type {HTMLElement} */ let velo;
  /** @type {HTMLElement} */ let caja;
  if (!pila.length) {
    velo = el('velo'); caja = el('modal');
    caja.textContent = '';
    velo.classList.add('abierto');
  } else {
    const debajo = pila[pila.length - 1];
    debajo.caja.setAttribute('inert', ''); // sin foco, sin clics y fuera del árbol de accesibilidad mientras no sea el de arriba
    caja = h('div', { class: 'modal-apilado' });
    velo = h('div', { class: 'velo-apilado', style: 'z-index:' + (50 + pila.length) }, [caja]);
    const cerrarSiEsElFondo = (/** @type {Event} */ e) => { if (e.target === velo && pila[pila.length - 1] && pila[pila.length - 1].velo === velo) cerrarModal(); };
    velo.addEventListener('click', cerrarSiEsElFondo);
    document.body.appendChild(velo);
  }
  caja.appendChild(nodo);
  pila.push({ velo, caja, alCerrar: alCerrar || null, abridor });
}

/** ¿Hay algún diálogo abierto (de cualquier nivel)? */
export function modalAbierto() { return pila.length > 0; }

/** Cuántos diálogos hay apilados (0 = ninguno). */
export function nivelesDeModal() { return pila.length; }

/** Cierra SOLO el diálogo de arriba: el de abajo (si hay) queda como estaba y recupera el foco. No hace nada si no hay ninguno. */
export function cerrarModal() {
  const cerrado = pila.pop();
  if (!cerrado) return;
  if (!pila.length) {
    cerrado.velo.classList.remove('abierto');
    cerrado.caja.textContent = '';
  } else {
    cerrado.velo.remove();
    const debajo = pila[pila.length - 1];
    debajo.caja.removeAttribute('inert');
  }
  const profundidad = pila.length;
  if (cerrado.alCerrar) cerrado.alCerrar();
  // Si `alCerrar` abrió otro diálogo, el foco ya es de ese.
  if (pila.length <= profundidad && cerrado.abridor && /** @type {HTMLElement} */ (cerrado.abridor).focus && document.contains(cerrado.abridor)) /** @type {HTMLElement} */ (cerrado.abridor).focus();
}

// ---------------------------------------------------------------------------------------------
// Menú desplegable en el celular (D-072)
// ---------------------------------------------------------------------------------------------

/** Cierra el menú lateral desplegable (solo tiene efecto en pantallas angostas). */
export function cerrarMenuLateral() {
  document.body.classList.remove('menu-abierto');
  const b = document.getElementById('btnMenu');
  if (b) { b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-label', 'Abrir el menú'); }
}

/** Crea el botón de hamburguesa (oculto por CSS en escritorio) y conecta cierre al navegar, con Esc y al tocar afuera. */
function iniciarMenuCelular() {
  const cab = document.getElementById('cabecera');
  if (!cab || document.getElementById('btnMenu')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
  const trazo = document.createElementNS(ns, 'path');
  trazo.setAttribute('d', 'M4 7h16M4 12h16M4 17h16');
  svg.appendChild(trazo);
  const ico = h('span', { class: 'ico', 'aria-hidden': 'true' });
  ico.appendChild(svg);
  const btn = h('button', { type: 'button', id: 'btnMenu', class: 'conSesion', 'aria-label': 'Abrir el menú', 'aria-expanded': 'false', 'aria-controls': 'lateral' }, [ico]);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const abrir = !document.body.classList.contains('menu-abierto');
    document.body.classList.toggle('menu-abierto', abrir);
    btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    btn.setAttribute('aria-label', abrir ? 'Cerrar el menú' : 'Abrir el menú');
  });
  cab.insertBefore(btn, cab.firstChild);
  const lateral = document.getElementById('lateral');
  if (lateral) lateral.addEventListener('click', e => { if (/** @type {HTMLElement} */ (e.target).closest('a')) cerrarMenuLateral(); });
  const cuerpo = document.getElementById('cuerpo');
  if (cuerpo) cuerpo.addEventListener('click', e => { if (e.target === cuerpo) cerrarMenuLateral(); });
  window.addEventListener('hashchange', cerrarMenuLateral);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-abierto')) { cerrarMenuLateral(); btn.focus(); }
  });
  window.matchMedia('(min-width: 761px)').addEventListener('change', cerrarMenuLateral);
}
iniciarMenuCelular();
