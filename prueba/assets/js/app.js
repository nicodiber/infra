// @ts-check
/**
 * Aplicación: arranque y router por hash de URL (D-006). Arma el marco común y le pasa cada ruta a su vista.
 * No toca datos ni permisos: pregunta a `repositorio`, `sesion` y `permisos`.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import {
  pintarMarco, registrarRefresco, ir, cerrarMenuUsuario, alternarMenuUsuario, cerrarModal, modalAbierto
} from './marco.js';
import { h, icono, pintarIconosEstaticos } from './utiles.js';
import { renderVistaIngreso } from '../../views/ingreso.view.js';
import { renderVistaOrganizaciones } from '../../views/organizaciones.view.js';
import { renderVistaTablero } from '../../views/tablero.view.js';
import { renderVistaDatos } from '../../views/datos.view.js';
import { renderVistaPendiente } from '../../views/pendiente.view.js';
import { abrirBuscador } from '../../views/buscador.view.js';
import { iniciarAsistente } from './asistente.js';

/**
 * Cada ruta: la vista, la sección del menú que resalta y si necesita una organización elegida.
 * Las pantallas que aún no existen (`pendiente`) llevan su código de docs/user-flow.md.
 * @typedef {Object} Ruta
 * @property {(contenedor: HTMLElement, info?: any) => Promise<void>} vista
 * @property {string|null} seccion
 * @property {boolean} [publica]
 * @property {boolean} [requiereOrg]
 * @property {import('../../views/pendiente.view.js').InfoPendiente} [info]
 */

/** @param {string} codigo @param {string} nombre @param {string} seccion @param {Partial<import('../../views/pendiente.view.js').InfoPendiente>} [extra] @returns {Ruta} */
const pendiente = (codigo, nombre, seccion, extra) => ({ vista: cargarVista(String(extra && extra.archivo || '')), seccion, requiereOrg: !['solicitudes', 'ajustes'].includes(seccion), info: { codigo, nombre, seccion, ...extra } });

/**
 * Carga la vista `views/<archivo>.view.js` (que exporta `renderVista(contenedor, info)`) la primera vez que se usa.
 * Si el archivo todavía no existe, muestra el estado «llega en la próxima entrega» (D-050).
 * Convención para las vistas nuevas: leen sus parámetros del hash (`location.hash`), por ejemplo `#/equipo/<id>/puertos/14`.
 * @param {string} archivo
 * @returns {(contenedor: HTMLElement, info?: any) => Promise<void>}
 */
function cargarVista(archivo) {
  return async (contenedor, info) => {
    /** @type {any} */
    let modulo = null;
    if (archivo) {
      try { modulo = await import('../../views/' + archivo + '.view.js'); } catch (e) { modulo = null; }
    }
    if (modulo && typeof modulo.renderVista === 'function') return modulo.renderVista(contenedor, info);
    return renderVistaPendiente(contenedor, info);
  };
}

/** @type {Object<string, Ruta>} */
const RUTAS = {
  ingreso: { vista: renderVistaIngreso, seccion: null, publica: true },
  organizaciones: { vista: renderVistaOrganizaciones, seccion: 'organizaciones' },
  inicio: { vista: renderVistaTablero, seccion: 'inicio', requiereOrg: true },
  datos: { vista: renderVistaDatos, seccion: 'datos' },
  red: pendiente('P05', 'Red', 'red', { archivo: 'red', modulo: 'red', descripcion: 'Acá vas a ver los equipos de red, las VLAN, las redes Wi-Fi y los enlaces a Internet de la organización.', icono: 'red' }),
  servidores: pendiente('P05', 'Servidores', 'servidores', { archivo: 'servidores', modulo: 'servidores', descripcion: 'Acá vas a ver los servidores y las máquinas virtuales.', icono: 'servidor' }),
  racks: pendiente('P05', 'Racks', 'racks', { archivo: 'racks', modulo: 'racks', descripcion: 'Acá vas a ver los racks de cada ubicación.', icono: 'rack' }),
  configuraciones: pendiente('P05', 'Configuraciones', 'configuraciones', { archivo: 'configuraciones', modulo: 'configuraciones', descripcion: 'Acá vas a ver las VPN, el reenvío de puertos, las reglas de firewall y demás configuraciones.', icono: 'configuracion' }),
  credenciales: pendiente('P05', 'Credenciales', 'credenciales', { archivo: 'credenciales', modulo: 'credenciales', descripcion: 'Mientras tanto, podés encontrar cualquier credencial con «Buscar» (Ctrl K) y pedir o usar su contraseña desde ahí.', icono: 'credencial' }),
  usuarios: pendiente('P15', 'Usuarios', 'usuarios', { archivo: 'usuarios', accion: 'ver_usuarios', descripcion: 'Acá vas a ver y crear los usuarios de roles inferiores al tuyo.', icono: 'usuarios' }),
  solicitudes: pendiente('P14', 'Solicitudes', 'solicitudes', { archivo: 'solicitudes', descripcion: 'Acá vas a gestionar los pedidos para ver contraseñas y las aprobaciones vigentes. Mientras tanto, las solicitudes pendientes se resuelven desde el Inicio de la organización.', icono: 'solicitudes' }),
  accesos: pendiente('P17', 'Registro de accesos', 'accesos', { archivo: 'accesos', accion: 'ver_registro_accesos', descripcion: 'Acá vas a ver quién mostró o copió qué contraseña y cuándo.', icono: 'accesos' }),
  ajustes: pendiente('P20', 'Ajustes del sistema', 'inicio', { archivo: 'ajustes', accion: 'ajustes_sistema', descripcion: 'Acá el superadmin va a poder cambiar los umbrales de verificación («a revisar» y «viejo»).', icono: 'reloj' }),
  equipo: pendiente('P06', 'Ficha de equipo', 'red', { archivo: 'equipo', modulo: 'red', descripcion: 'Acá vas a ver los datos del equipo, sus puertos, sus credenciales y su historial.', icono: 'equipo' }),
  servidor: pendiente('P06', 'Ficha de servidor', 'servidores', { archivo: 'servidor', modulo: 'servidores', descripcion: 'Acá vas a ver los datos del servidor, su red, sus credenciales y sus máquinas virtuales.', icono: 'servidor' }),
  credencial: pendiente('P09', 'Ficha de credencial', 'credenciales', { archivo: 'credencial', modulo: 'credenciales', descripcion: 'Acá vas a ver el detalle de la credencial, quién tiene permiso para ver su contraseña y su historial. Mientras tanto, usá «Buscar» (Ctrl K).', icono: 'credencial' }),
  config: pendiente('P10', 'Ficha de configuración', 'configuraciones', { archivo: 'config', modulo: 'configuraciones', icono: 'configuracion' }),
  vlan: pendiente('P11', 'Ficha de VLAN', 'red', { archivo: 'vlan', modulo: 'red', icono: 'vlan' }),
  wifi: pendiente('P11', 'Ficha de red Wi-Fi', 'red', { archivo: 'wifi', modulo: 'red', icono: 'wifi' }),
  enlace: pendiente('P05', 'Ficha de enlace a Internet', 'red', { archivo: 'enlace', modulo: 'red', icono: 'red' }),
  rack: pendiente('P08', 'Vista de rack', 'racks', { archivo: 'rack', modulo: 'racks', descripcion: 'Acá vas a ver el rack dibujado por unidades, con cada equipo en su lugar.', icono: 'rack' }),
  puesto: pendiente('P06', 'Ficha de puesto de trabajo', 'red', { archivo: 'puesto', modulo: 'red', descripcion: 'Acá vas a ver el recorrido switch → boca de patchera → puesto y qué equipos hay en él.', icono: 'puesto' }),
  recorrido: pendiente('P19', 'Recorrido de verificación', 'racks', { archivo: 'recorrido', modulo: 'racks', icono: 'rack' }),
  escritorio: pendiente('P21', 'Equipos de escritorio', 'escritorio', { archivo: 'escritorio', modulo: 'red', descripcion: 'Acá vas a ver las PC de escritorio y notebooks, su puesto y a quién están asignadas.', icono: 'escritorio' }),
  personas: pendiente('P22', 'Personas', 'personas', { archivo: 'personas', modulo: 'personas', descripcion: 'Acá vas a ver las personas de la organización, sus cuentas de dominio y sus equipos.', icono: 'persona' }),
  persona: pendiente('P23', 'Ficha de persona', 'personas', { archivo: 'persona', modulo: 'personas', icono: 'persona' }),
  cuenta: pendiente('P23', 'Ficha de cuenta de dominio', 'personas', { archivo: 'cuenta', modulo: 'personas', icono: 'persona' }),
  licencias: pendiente('P24', 'Licencias', 'licencias', { archivo: 'licencias', modulo: 'licencias', descripcion: 'Acá vas a ver las licencias de software, cuántas están en uso y cuándo vencen.', icono: 'licencia' }),
  licencia: pendiente('P25', 'Ficha de licencia', 'licencias', { archivo: 'licencia', modulo: 'licencias', icono: 'licencia' }),
  mapeo: pendiente('P10', 'Ficha de mapeo de disco', 'configuraciones', { archivo: 'mapeo', modulo: 'configuraciones', icono: 'configuracion' }),
  notas: pendiente('P26', 'Notas', 'notas', { archivo: 'notas', descripcion: 'Acá vas a ver las notas libres de la organización y las de cada ficha.', icono: 'nota' }),
  etiqueta: pendiente('P27', 'Etiqueta', 'inicio', { archivo: 'etiqueta', icono: 'equipo' }),
  etiquetas: pendiente('P27', 'Etiquetas', 'etiquetas', { archivo: 'etiqueta', icono: 'equipo' }),
  informe: pendiente('P28', 'Documentación de la organización', 'informe', { archivo: 'informe', icono: 'datos' }),
  servicios: pendiente('P29', 'Dominios y servicios', 'servicios', { archivo: 'servicios', modulo: 'configuraciones', icono: 'red' }),
  servicio: pendiente('P29', 'Ficha de servicio', 'servicios', { archivo: 'servicio', modulo: 'configuraciones', icono: 'red' }),
  fibra: pendiente('P30', 'Fibra óptica', 'red', { archivo: 'fibra', modulo: 'red', icono: 'red' }),
  tramo: pendiente('P30', 'Ficha de tramo de fibra', 'red', { archivo: 'tramo', modulo: 'red', icono: 'red' }),
  topologia: pendiente('P31', 'Topología de red', 'red', { archivo: 'topologia', modulo: 'red', icono: 'red' }),
  plano: pendiente('P32', 'Plano de la sede', 'racks', { archivo: 'plano', modulo: 'racks', icono: 'rack' }),
  usuario: pendiente('P16', 'Ficha de usuario', 'usuarios', { archivo: 'usuario', accion: 'ver_usuarios', icono: 'usuarios' })
};

const principal = () => /** @type {HTMLElement} */ (document.getElementById('principal'));
let rutaId = 0;
let ultimoHash = '';

/** Dibuja la pantalla que corresponde al hash actual. Si el usuario navega mientras carga, gana la última. */
async function ruta() {
  const id = ++rutaId;
  try {
    const hash = location.hash || '#/ingreso';
    const p0 = hash.replace(/^#\/?/, '').split('/')[0] || 'ingreso';
    const mismaPantalla = hash === ultimoHash;
    ultimoHash = hash;
    if (p0 === 'ingreso' && sesion.usuarioActual()) sesion.salir();
    // QC50-A: si se dio de baja la organización de quien tiene la sesión abierta, vuelve al ingreso con el aviso.
    if (p0 !== 'ingreso' && await sesion.cerrarSiOrganizacionDeBaja()) { if (id === rutaId) location.replace('#/ingreso'); return; }
    const u = sesion.usuarioActual();
    if (!u && p0 !== 'ingreso') { location.replace('#/ingreso'); return; }
    const def = RUTAS[p0] || RUTAS.inicio;
    if (u && def.requiereOrg && !sesion.organizacionActiva()) {
      if (puede(u, 'ver_organizaciones')) { location.replace('#/organizaciones'); return; }
    }
    const destino = h('div', { class: 'pantalla' });
    await pintarMarco(def.seccion);
    if (id !== rutaId) return;
    // El permiso de ver el módulo de la ruta se comprueba acá, antes de cargar la vista (D-006): sin acceso, solo el aviso.
    if (u && def.info && def.info.modulo && !puede(u, 'ver', def.info.modulo, sesion.organizacionActiva())) await renderVistaPendiente(destino, def.info);
    else await def.vista(destino, def.info);
    if (id !== rutaId) return;
    const cont = principal();
    const scroll = mismaPantalla ? cont.scrollTop : 0;
    cont.textContent = '';
    cont.appendChild(destino);
    cont.scrollTop = scroll;
    document.title = 'SINET: Infradoc';
  } catch (e) {
    if (id !== rutaId) return;
    console.error(e);
    mostrarError(e);
  }
}

/** @param {unknown} e */
function mostrarError(e) {
  const cont = principal();
  cont.textContent = '';
  cont.appendChild(h('div', { class: 'estado-vacio', role: 'alert' }, [
    icono('alerta'), h('h2', { text: 'Algo salió mal' }),
    h('p', { text: e instanceof Error ? e.message : 'Ocurrió un error inesperado.' }),
    h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Reintentar', onclick: () => location.reload() })])]));
}

function cambiarRol() {
  sesion.salir();
  ir('#/ingreso');
}

/** @param {string} id */
const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));

function conectarMarco() {
  $('btnBuscar').addEventListener('click', () => abrirBuscador());
  $('btnSol').addEventListener('click', () => ir('#/solicitudes'));
  $('btnUsuario').addEventListener('click', e => { e.stopPropagation(); alternarMenuUsuario(cambiarRol); });
  $('selOrg').addEventListener('change', e => {
    const id = /** @type {HTMLSelectElement} */ (e.target).value;
    sesion.fijarOrganizacionActiva(id || null);
    ir(id ? '#/inicio' : '#/organizaciones');
  });
  $('velo').addEventListener('click', e => { if (/** @type {HTMLElement} */ (e.target).id === 'velo') cerrarModal(); });
  document.addEventListener('click', () => cerrarMenuUsuario());
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (sesion.usuarioActual() && !modalAbierto()) abrirBuscador();
    } else if (e.key === 'Escape') { cerrarModal(); cerrarMenuUsuario(); }
  });
  window.addEventListener('hashchange', () => { ruta(); });
}

async function arrancar() {
  pintarIconosEstaticos();
  try {
    await repositorio.iniciar();
    await sesion.restaurar();
  } catch (e) {
    console.error(e);
    mostrarError(e);
    return;
  }
  registrarRefresco(() => { ruta(); });
  conectarMarco();
  iniciarAsistente();
  await ruta();
}

arrancar();
