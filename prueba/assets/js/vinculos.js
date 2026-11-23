// @ts-check
/**
 * Pestaña «Vínculos» de las fichas de equipo y de servidor (D-072): desde un equipo, toda la cadena física hasta la ubicación
 * (boca de pared o puesto → boca de patchera → switch y puerto → VLAN → rack y U → ubicación) y todo lo que se relaciona con él
 * (puertos, personas, licencias, mapeos, credenciales, configuraciones, enlaces a Internet, impresoras, notas y relaciones).
 * Los datos salen de `repositorio.vinculosDeEquipo` (que nunca devuelve secretos); los permisos, de `puede` por módulo de cada ficha.
 * Todo texto de datos va con `textContent`.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import { ir } from './marco.js';
import { h, fmtFecha, fmtFechaHora } from './utiles.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_CREDENCIAL_TIPO, ROTULO_CONFIGURACION_TIPO, ROTULO_LICENCIA_TIPO, ROTULO_MAPEO_APLICA_A, ROTULO_IMPRESORA_CONEXION, esImpresora } from './modelos.js';
import { nodoCadena, hashEquipo, ROTULO_ESTADO_PUERTO, ROTULO_ENLACE_TIPO } from './red.js';

/** @typedef {import('./repositorio.js').VinculosDeEquipo} VinculosDeEquipo */

/** Agrega una sola vez los estilos de la pestaña (clases con prefijo `vn-`). */
function inyectarEstilos() {
  if (document.getElementById('estilos-vinculos')) return;
  const s = document.createElement('style');
  s.id = 'estilos-vinculos';
  s.textContent = `
.vn-pasos{flex-wrap:wrap;row-gap:8px;align-items:stretch}
.vn-pasos .nodo{max-width:190px;padding:6px 7px}
.vn-pasos .tramo{flex-basis:12px}
.vn-pasos .nodo b{overflow-wrap:anywhere}
.vn-sub{font-size:12px;color:var(--muted);margin:2px 0 0}
.vn-grupos{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:10px;margin-top:10px;align-items:start}
.vn-grupo{margin:0;padding:10px 14px;min-width:0}
.vn-grupo h3{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:6px}
.vn-grupo h3 .vn-n{font-weight:600;color:var(--muted);font-size:12.5px}
.vn-lista{list-style:none;margin:0;padding:0}
.vn-lista li{padding:5px 0;border-top:1px solid var(--borde);min-width:0;overflow-wrap:anywhere}
.vn-lista li:first-child{border-top:0}
.vn-lista .mut{display:block;font-size:12.5px}
.vn-lista a{font-weight:600}
.vn-ancho{grid-column:1/-1}
.vn-puertos{width:100%}
.vn-vacio{margin-top:10px}
.vn-nota-txt{white-space:pre-wrap;font-size:12.5px;margin:4px 0 0;color:var(--texto)}
@media (max-width:760px){
  .vn-grupos{grid-template-columns:1fr}
  .vn-pasos{flex-direction:column;align-items:stretch;overflow:visible}
  .vn-pasos .nodo{max-width:none;width:100%}
  .vn-pasos .tramo{flex:0 0 11px;width:2px;height:11px;margin-left:24px;align-self:flex-start}
  .vn-pasos .tramo::after{right:auto;left:-4px;top:auto;bottom:-1px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid var(--muted);border-bottom:0}
}
`;
  document.head.appendChild(s);
}

/** Enlace que navega sin recargar. @param {string} texto @param {string} hash */
function a(texto, hash) { return h('a', { href: hash, text: texto, onclick: (/** @type {Event} */ e) => { e.preventDefault(); ir(hash); } }); }

/**
 * Carga los vínculos de un equipo con los permisos del usuario actual.
 * @param {string} equipoId
 * @returns {Promise<VinculosDeEquipo|null>}
 */
export async function cargarVinculos(equipoId) {
  const u = /** @type {import('./modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  return repositorio.vinculosDeEquipo(equipoId, { permitido: o => puede(u, 'ver', o.modulo, o.organizacion_id) });
}

/**
 * Cantidad de cosas vinculadas (para el contador de la pestaña): pasos de la cadena más elementos de cada grupo.
 * @param {VinculosDeEquipo|null} v
 */
export function contarVinculos(v) {
  if (!v) return 0;
  return v.puertos.filter(x => x.conectadoA || x.enlaceIsp || x.descripcion).length + v.personas.length + v.licencias.length + v.mapeos.length + v.credenciales.length
    + v.configuraciones.length + v.enlacesIsp.length + v.notas.length + v.impresoras.length + (v.pc ? 1 : 0) + v.relaciones.length
    + [v.puesto, v.bocaPatchera, v.switch, v.vlan, v.rack, v.ubicacion].filter(Boolean).length;
}

/**
 * Pinta la pestaña «Vínculos».
 * @param {HTMLElement} zona
 * @param {import('./modelos.js').Equipo} e Equipo (o servidor) de la ficha.
 * @param {VinculosDeEquipo|null} v Resultado de `cargarVinculos`.
 */
export function pintarVinculos(zona, e, v) {
  inyectarEstilos();
  zona.textContent = '';
  if (!v) { zona.appendChild(h('div', { class: 'aviso', text: 'No se pudieron cargar los vínculos de este equipo.' })); return; }
  const u = /** @type {import('./modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = e.organizacion_id;
  const verRed = puede(u, 'ver', 'red', org);

  // ---- cadena física
  zona.appendChild(h('h3', { text: 'Cadena física', style: 'margin:0 0 4px;font-size:14px' }));
  /** @type {HTMLElement[]} */
  const nodos = [];
  nodos.push(nodoCadena(e.equipo_tipo === 'servidor' ? 'servidor' : 'equipo', e.equipo_tipo === 'servidor' ? 'servidor' : 'equipo', esImpresora(e) ? 'Impresora' : ROTULO_EQUIPO_TIPO[e.equipo_tipo] || 'Equipo', e.equipo_nombre, e.equipo_ip_gestion || '', hashEquipo(e)));
  if (v.pc) nodos.push(nodoCadena('equipo', 'escritorio', 'Conectada por USB a', v.pc.equipo_nombre, v.pc.equipo_ip_gestion || '', hashEquipo(v.pc)));
  if (v.puesto) nodos.push(nodoCadena('puesto', 'puesto', 'Puesto', v.puesto.puesto_nombre, v.puesto.puesto_boca_pared ? 'Boca de pared ' + v.puesto.puesto_boca_pared : '', '#/puesto/' + v.puesto.id));
  // En un switch o una patchera la cadena que arma el repositorio pasaría por el propio equipo: solo se muestran los pasos hacia otro equipo.
  const propio = !!((v.switch && v.switch.equipo.id === e.id) || (v.bocaPatchera && v.bocaPatchera.patchera.id === e.id));
  if (!propio && v.bocaPatchera && verRed) nodos.push(nodoCadena('puerto', 'puerto', 'Patchera', v.bocaPatchera.patchera.equipo_nombre + ' · boca ' + v.bocaPatchera.puerto.puerto_numero, v.bocaPatchera.puerto.puerto_nombre || '', '#/equipo/' + v.bocaPatchera.patchera.id + '/puertos/' + v.bocaPatchera.puerto.puerto_numero));
  if (!propio && v.switch && verRed) nodos.push(nodoCadena('equipo', 'equipo', 'Switch', v.switch.equipo.equipo_nombre + ' · puerto ' + v.switch.puerto.puerto_numero, v.switch.puerto.puerto_nombre || '', '#/equipo/' + v.switch.equipo.id + '/puertos/' + v.switch.puerto.puerto_numero));
  if (!propio && v.vlan && verRed) nodos.push(nodoCadena('vlan', 'vlan', 'VLAN', v.vlan.vlan_numero + ' · ' + v.vlan.vlan_nombre, v.vlan.vlan_red_cidr || '', '#/vlan/' + v.vlan.id));
  if (v.rack) {
    const r = v.rack;
    const u0 = r.unidad != null ? (r.alto && r.alto > 1 ? 'U' + r.unidad + '–U' + (r.unidad + r.alto - 1) : 'U' + r.unidad) : '';
    const de = r.de === 'switch' ? 'rack del switch' : r.de === 'patchera' ? 'rack de la patchera' : '';
    nodos.push(nodoCadena('rack', 'rack', 'Rack', r.rack.rack_nombre + (u0 ? ' · ' + u0 : ''), de, '#/rack/' + r.rack.id + (r.de === 'equipo' ? '?resaltar=' + e.id : '')));
  }
  if (v.ubicacion) nodos.push(nodoCadena('neutro', 'edificio', 'Ubicación', v.ubicacion.ubicacion_nombre, '', '#/plano/' + v.ubicacion.id));
  const hijos = /** @type {Node[]} */ ([]);
  nodos.forEach((n, i) => { if (i) hijos.push(h('span', { class: 'tramo', 'aria-hidden': 'true' })); hijos.push(n); });
  zona.appendChild(h('div', { class: 'cadena vn-pasos', role: 'group', 'aria-label': 'Cadena física: ' + nodos.length + ' pasos enlazados' }, hijos));
  if (nodos.length <= 1) zona.appendChild(h('p', { class: 'vn-sub', text: 'Todavía no hay una cadena cargada: ni puesto, ni boca de patchera, ni puerto de switch, ni rack o ubicación.' }));
  else zona.appendChild(h('p', { class: 'vn-sub', text: 'Cada paso abre su ficha. Sale de lo que está cargado en puestos, puertos, racks y ubicaciones.' }));

  // ---- grupos
  /** @type {HTMLElement[]} */
  const grupos = [];
  /** @type {string[]} */
  const vacios = [];
  /** @param {string} titulo @param {number} n @param {Node[]} items @param {string} [clase] */
  const grupo = (titulo, n, items, clase) => grupos.push(h('section', { class: 'bloque vn-grupo' + (clase ? ' ' + clase : '') }, [
    h('h3', null, [titulo, h('span', { class: 'vn-n', text: '(' + n + ')' })]), h('ul', { class: 'vn-lista' }, items.map(x => h('li', null, [x])))]));
  /** @param {string} titulo @param {Node[]} items */
  const lista = (titulo, items) => { if (items.length) grupo(titulo, items.length, items); else vacios.push(titulo.toLowerCase()); };
  /** @param {Node|string} cabeza @param {string} sub */
  const item = (cabeza, sub) => h('span', null, /** @type {Node[]} */ ([typeof cabeza === 'string' ? document.createTextNode(cabeza) : cabeza].concat(sub ? [h('span', { class: 'mut', text: sub })] : [])));

  // Puertos (switches, routers, firewalls, patcheras, servidores…)
  if (v.puertos.length) {
    const filas = v.puertos.filter(x => x.conectadoA || x.enlaceIsp || x.descripcion || x.puerto.puerto_estado === 'activo');
    const libres = v.puertos.length - filas.length;
    /** @param {VinculosDeEquipo['puertos'][number]} x */
    const destino = x => {
      /** @type {Node[]} */
      const partes = [];
      if (x.conectadoA) {
        const c = x.conectadoA;
        partes.push(a(c.equipo.equipo_nombre + ' · ' + (c.equipo.equipo_tipo === 'patchera' ? 'boca ' : 'puerto ') + c.puerto.puerto_numero, '#/equipo/' + c.equipo.id + '/puertos/' + c.puerto.puerto_numero));
        if (c.equipo.equipo_tipo === 'servidor') partes[0] = a(c.equipo.equipo_nombre, hashEquipo(c.equipo));
      }
      if (x.enlaceIsp) {
        const l = x.enlaceIsp;
        if (partes.length) partes.push(document.createTextNode(' · '));
        partes.push(a('Internet: ' + l.enlace_proveedor + (l.enlace_ip_publica ? ' (' + l.enlace_ip_publica + ')' : ''), '#/enlace/' + l.id));
      }
      if (!partes.length) partes.push(document.createTextNode(x.descripcion || (x.puerto.puesto_id ? 'Puesto de trabajo' : '—')));
      return h('span', null, partes);
    };
    const filasT = filas.map(x => h('li', null, [item(a((x.puerto.puerto_nombre ? x.puerto.puerto_nombre + ' · ' : '') + 'Puerto ' + x.puerto.puerto_numero, '#/equipo/' + e.id + '/puertos/' + x.puerto.puerto_numero), [ROTULO_ESTADO_PUERTO[x.puerto.puerto_estado] || '', x.vlan ? 'VLAN ' + x.vlan.vlan_numero : ''].filter(Boolean).join(' · ')), h('span', { class: 'mut' }, [h('span', { text: 'va a: ' }), destino(x)])]));
    const det = h('details', null, [h('summary', { text: filas.length + (filas.length === 1 ? ' puerto con destino' : ' puertos con destino') + (libres ? ' · ' + libres + ' libres o sin cargar' : '') }), h('ul', { class: 'vn-lista', style: 'margin-top:6px' }, filasT)]);
    if (filas.length && filas.length <= 14) det.setAttribute('open', '');
    grupos.push(h('section', { class: 'bloque vn-grupo vn-ancho' }, [h('h3', null, ['Puertos', h('span', { class: 'vn-n', text: '(' + v.puertos.length + ')' })]),
      filas.length ? det : h('div', { class: 'mut', text: 'Ningún puerto tiene destino cargado todavía.' })]));
  }

  if (v.personas.length) {
    lista('Personas asignadas', v.personas.map(p => {
      const as = v.asignaciones.find(x => x.persona_id === p.id);
      return item(a(p.persona_nombre, '#/persona/' + p.id + '/equipos'), (as ? 'desde el ' + fmtFecha(as.asignacion_desde) : '') + (p.persona_sector ? ' · ' + p.persona_sector : ''));
    }));
    if (v.personas.length > 1) grupos[grupos.length - 1].appendChild(h('div', { class: 'vn-sub', text: 'Equipo compartido por ' + v.personas.length + ' personas.' }));
  } else if (!v.asignaciones.length) vacios.push('personas asignadas');

  lista('Licencias instaladas', v.licencias.map(x => item(a(x.licencia.licencia_producto, '#/licencia/' + x.licencia.id), [ROTULO_LICENCIA_TIPO[x.licencia.licencia_tipo] || '', 'desde ' + fmtFecha(x.instalacion.instalacion_desde), x.licencia.licencia_vence_en ? 'vence ' + fmtFecha(x.licencia.licencia_vence_en) : ''].filter(Boolean).join(' · '))));
  lista('Mapeos de disco', v.mapeos.map(m => item(a(m.mapeo_letra + ' → ' + m.mapeo_ruta, '#/mapeo/' + m.id), (ROTULO_MAPEO_APLICA_A[m.mapeo_aplica_a] || '') + (m.mapeo_grupo ? ': ' + m.mapeo_grupo : ''))));
  lista('Credenciales', v.credenciales.map(c => item(a(c.nombre, '#/credencial/' + c.id), ROTULO_CREDENCIAL_TIPO[c.tipo] || c.tipo)));
  lista('Configuraciones', v.configuraciones.map(c => item(a(c.configuracion_titulo, '#/config/' + c.id), [ROTULO_CONFIGURACION_TIPO[c.configuracion_tipo] || c.configuracion_tipo, c.configuracion_version_fecha ? 'versión del ' + fmtFecha(c.configuracion_version_fecha) : ''].filter(Boolean).join(' · '))));
  lista('Enlaces a Internet', v.enlacesIsp.map(l => item(a(l.enlace_proveedor + (l.enlace_es_principal ? ' (principal)' : ' (respaldo)'), '#/enlace/' + l.id),
    [ROTULO_ENLACE_TIPO[l.enlace_tipo] || l.enlace_tipo, l.enlace_ip_publica || ''].filter(Boolean).join(' · '))));
  if (v.impresoras.length) lista('Impresoras conectadas por USB', v.impresoras.map(i => item(a(i.equipo_nombre, hashEquipo(i)), [i.equipo_marca, i.equipo_modelo].filter(Boolean).join(' '))));
  if (v.pc) lista('Computadora de esta impresora', [item(a(v.pc.equipo_nombre, hashEquipo(v.pc)), 'conexión: ' + ROTULO_IMPRESORA_CONEXION.usb)]);
  else if (esImpresora(e)) {
    const c = (e.equipo_campos || {}).impresora_conexion;
    if (c === 'usb') vacios.push('computadora de la impresora');
  }
  lista('Notas', v.notas.map(n => {
    const det = h('details', null, [h('summary', null, [a(n.nota_titulo, '#/notas'), h('span', { class: 'mut', text: ' · ' + fmtFechaHora(n.actualizado_en) })]), h('p', { class: 'vn-nota-txt', text: n.nota_contenido })]);
    return det;
  }));
  lista('Relaciones', v.relaciones.map(r => item(r.ruta ? a(r.titulo, r.ruta) : r.titulo, r.rotulo + (r.descripcion ? ' · ' + r.descripcion : ''))));

  if (grupos.length) zona.appendChild(h('div', { class: 'vn-grupos' }, grupos));
  if (vacios.length) zona.appendChild(h('p', { class: 'vn-sub vn-vacio', text: 'Sin ' + vacios.join(', ') + '.' }));
}
