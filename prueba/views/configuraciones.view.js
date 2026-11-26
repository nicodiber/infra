// @ts-check
/**
 * P05 · Listado de configuraciones (VPN, reenvío de puertos, reglas de firewall, etc.), con la pestaña «Mapeos de discos»
 * (`#/configuraciones/mapeos`): letras de unidad de red, a quién se aplican y cómo.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, indicadorVerificacion, estadoVerificacion, normalizar, icono } from '../assets/js/utiles.js';
import { ROTULO_CONFIGURACION_TIPO } from '../assets/js/modelos.js';
import { sinPermiso, chips, pestanas, enlaceEquipo } from '../assets/js/credenciales.js';
import { ROTULO_MAPEO_METODO, ROTULO_MAPEO_APLICA_A } from '../assets/js/modelos.js';
import { aQuien } from './mapeo.view.js';
import { crearYAbrir } from '../assets/js/altas/comunes.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = /** @type {string} */ (sesion.organizacionActiva());
  const tab = location.hash.replace(/^#\/?/, '').split('/')[1] === 'mapeos' ? 'mapeos' : 'config';
  const migas = await migasRaiz();
  if (tab === 'mapeos') migas.push(['Configuraciones', '#/configuraciones'], ['Mapeos de discos']); else migas.push(['Configuraciones']);
  pantalla(contenedor, { codigo: 'P05', nombre: tab === 'mapeos' ? 'Listado de Mapeos de discos' : 'Listado de Configuraciones', migas });
  if (!puede(u, 'ver', 'configuraciones', orgId)) { sinPermiso(contenedor, u, 'Configuraciones'); return; }
  if (tab === 'mapeos') { await listadoMapeos(contenedor, u, orgId); return; }

  const [lista, equipos, umbrales] = await Promise.all([
    repositorio.listar('configuraciones', { organizacion_id: orgId }), repositorio.listar('equipos', { organizacion_id: orgId }), repositorio.umbralesVerificacion()]);
  const nombreEq = new Map(equipos.map(e => [e.id, e.equipo_nombre]));
  const rotulo = (/** @type {string} */ t) => ROTULO_CONFIGURACION_TIPO[t] || t;
  lista.sort((a, b) => rotulo(a.configuracion_tipo).localeCompare(rotulo(b.configuracion_tipo), 'es') || a.configuracion_titulo.localeCompare(b.configuracion_titulo, 'es', { numeric: true }));

  const est = { texto: '', tipo: '', nivel: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');
  const pintar = () => {
    zonaChips.textContent = '';
    zonaTabla.textContent = '';
    const palabras = normalizar(est.texto).split(/\s+/).filter(Boolean);
    const base = lista.filter(c => {
      if (est.tipo && c.configuracion_tipo !== est.tipo) return false;
      const t = normalizar([c.configuracion_titulo, rotulo(c.configuracion_tipo), nombreEq.get(c.equipo_id) || ''].join(' '));
      return palabras.every(p => t.includes(p));
    });
    const nivel = (/** @type {any} */ c) => estadoVerificacion(c.verificado_en, umbrales).nivel;
    zonaChips.appendChild(chips([['todos', 'Todas', base.length], ['vigente', 'Verificadas', base.filter(c => nivel(c) === 'vigente').length],
      ['revisar', 'A revisar', base.filter(c => nivel(c) === 'revisar').length], ['viejo', 'Desactualizadas', base.filter(c => nivel(c) === 'viejo').length]], est.nivel, k => { est.nivel = k; pintar(); }));
    const filas = base.filter(c => est.nivel === 'todos' || nivel(c) === est.nivel);
    if (!lista.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [icono('configuracion'), h('h2', { text: 'Todavía no hay configuraciones cargadas' }),
        h('p', { text: 'Acá se documentan las VPN, el reenvío de puertos, las reglas de firewall y cualquier configuración que haya que poder reconstruir: con su equipo, su fecha y su contenido.' }),
        puede(u, 'modificar', 'configuraciones', orgId) ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nueva configuración', onclick: () => crearYAbrir('configuraciones', r => '#/config/' + r.id, { aviso: 'Configuración creada' }) })])
          : h('p', { class: 'mut', text: 'Tu rol no puede cargar configuraciones: pedíselo a un técnico o gerente.' })]));
      return;
    }
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ninguna configuración coincide con el filtro.' })); return; }
    zonaTabla.appendChild(tabla(['Título', 'Tipo', 'Equipo', 'Fecha', 'Verificado'], filas.map(c => [
      c.configuracion_titulo, rotulo(c.configuracion_tipo), c.equipo_id ? nombreEq.get(c.equipo_id) || '—' : '—',
      fmtFecha(c.configuracion_version_fecha), indicadorVerificacion(c.verificado_en, umbrales, true)]),
    { tipo: 'configuracion', onFila: (_f, i) => ir('#/config/' + filas[i].id) }));
  };

  const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar…', 'aria-label': 'Filtrar configuraciones', style: 'width:260px' }));
  inp.addEventListener('input', () => { est.texto = inp.value; pintar(); });
  const tipos = Array.from(new Set(lista.map(c => c.configuracion_tipo))).sort((a, b) => rotulo(a).localeCompare(rotulo(b), 'es'));
  const sel = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo' }, [h('option', { value: '', text: 'Todos los tipos' })].concat(tipos.map(t => h('option', { value: t, text: rotulo(t) })))));
  sel.addEventListener('change', () => { est.tipo = sel.value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Configuraciones' }));
  contenedor.appendChild(pestanasConfig('config'));
  contenedor.appendChild(h('div', { class: 'herr' }, [inp, sel, h('span', { style: 'flex:1' }),
    puede(u, 'modificar', 'configuraciones', orgId) ? h('button', { type: 'button', class: 'primario', text: 'Nueva configuración', onclick: () => crearYAbrir('configuraciones', r => '#/config/' + r.id, { aviso: 'Configuración creada' }) }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  pintar();
}

/** Pestañas de la sección. @param {string} actual */
function pestanasConfig(actual) {
  return pestanas([['config', 'Configuraciones'], ['mapeos', 'Mapeos de discos']], actual, k => ir(k === 'config' ? '#/configuraciones' : '#/configuraciones/mapeos'));
}

/** Pestaña «Mapeos de discos». @param {HTMLElement} contenedor @param {import('../assets/js/modelos.js').UsuarioSesion} u @param {string} orgId */
async function listadoMapeos(contenedor, u, orgId) {
  const [lista, equipos, personas, umbrales] = await Promise.all([
    repositorio.listar('mapeos_disco', { organizacion_id: orgId }), repositorio.listar('equipos', { organizacion_id: orgId }),
    puede(u, 'ver', 'personas', orgId) ? repositorio.listar('personas', { organizacion_id: orgId }) : Promise.resolve([]), repositorio.umbralesVerificacion()]);
  const verPersonas = puede(u, 'ver', 'personas', orgId);
  const equipoPorId = new Map(equipos.map(e => [e.id, e]));
  const personaPorId = new Map(personas.map(p => [p.id, p]));
  lista.sort((a, b) => a.mapeo_letra.localeCompare(b.mapeo_letra, 'es') || a.mapeo_ruta.localeCompare(b.mapeo_ruta, 'es'));
  const puedeCrear = puede(u, 'modificar', 'configuraciones', orgId);
  const est = { texto: '', aplica: '', metodo: '', nivel: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');
  const pintar = () => {
    zonaChips.textContent = '';
    zonaTabla.textContent = '';
    const palabras = normalizar(est.texto).split(/\s+/).filter(Boolean);
    const base = lista.filter(m => {
      if (est.aplica && m.mapeo_aplica_a !== est.aplica) return false;
      if (est.metodo && m.mapeo_metodo !== est.metodo) return false;
      const eq = m.equipo_id ? equipoPorId.get(m.equipo_id) : null;
      const per = verPersonas && m.persona_id ? personaPorId.get(m.persona_id) : null;
      const t = normalizar([m.mapeo_letra, m.mapeo_ruta, eq ? eq.equipo_nombre : '', m.mapeo_grupo || '', per ? per.persona_nombre : ''].join(' '));
      return palabras.every(p => t.includes(p));
    });
    const nivel = (/** @type {any} */ m) => estadoVerificacion(m.verificado_en, umbrales).nivel;
    zonaChips.appendChild(chips([['todos', 'Todos', base.length], ['vigente', 'Verificados', base.filter(m => nivel(m) === 'vigente').length],
      ['revisar', 'A revisar', base.filter(m => nivel(m) === 'revisar').length], ['viejo', 'Desactualizados', base.filter(m => nivel(m) === 'viejo').length]], est.nivel, k => { est.nivel = k; pintar(); }));
    const filas = base.filter(m => est.nivel === 'todos' || nivel(m) === est.nivel);
    if (!lista.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [icono('configuracion'), h('h2', { text: 'Todavía no hay mapeos de discos' }),
        h('p', { text: 'Un mapeo dice qué carpeta de red se ve como una letra (por ejemplo P:), en qué servidor está, a quién se le arma y si es por directiva de grupo, script o a mano.' }),
        puedeCrear ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nuevo mapeo', onclick: () => crearYAbrir('mapeos_disco', r => '#/mapeo/' + r.id, { aviso: 'Mapeo creado' }) })]) : null]));
      return;
    }
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ningún mapeo coincide con el filtro.' })); return; }
    zonaTabla.appendChild(tabla(['Unidad', 'Ruta', 'Servidor', 'Se aplica a', 'Método', 'Verificado'], filas.map(m => [
      m.mapeo_letra, m.mapeo_ruta, enlaceEquipo(u, orgId, m.equipo_id ? equipoPorId.get(m.equipo_id) : null), aQuien(m, personaPorId, verPersonas),
      ROTULO_MAPEO_METODO[m.mapeo_metodo] || m.mapeo_metodo, indicadorVerificacion(m.verificado_en, umbrales, true)]),
    { tipo: 'configuracion', onFila: (_f, i) => ir('#/mapeo/' + filas[i].id) }));
  };
  const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar…', 'aria-label': 'Filtrar mapeos', style: 'width:260px' }));
  inp.addEventListener('input', () => { est.texto = inp.value; pintar(); });
  const selA = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Se aplica a' }, [h('option', { value: '', text: 'A todos los destinos' })].concat(Object.keys(ROTULO_MAPEO_APLICA_A).map(k => h('option', { value: k, text: ROTULO_MAPEO_APLICA_A[k] })))));
  selA.addEventListener('change', () => { est.aplica = selA.value; pintar(); });
  const selM = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Método' }, [h('option', { value: '', text: 'Todos los métodos' })].concat(Object.keys(ROTULO_MAPEO_METODO).map(k => h('option', { value: k, text: ROTULO_MAPEO_METODO[k] })))));
  selM.addEventListener('change', () => { est.metodo = selM.value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Configuraciones' }));
  contenedor.appendChild(pestanasConfig('mapeos'));
  contenedor.appendChild(h('div', { class: 'herr' }, [inp, selA, selM, h('span', { style: 'flex:1' }),
    puedeCrear ? h('button', { type: 'button', class: 'primario', text: 'Nuevo mapeo', onclick: () => crearYAbrir('mapeos_disco', r => '#/mapeo/' + r.id, { aviso: 'Mapeo creado' }) }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  pintar();
}
