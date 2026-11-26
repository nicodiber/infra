// @ts-check
/**
 * P30 · Fibra óptica (`#/fibra`): esquema generado de los datos (D-043, D-058) con las ubicaciones como cajas y los tramos como líneas
 * etiquetadas (pelos usados/total · tipo · longitud), y debajo la tabla de tramos con filtros. Los tramos con atenuación alta se resaltan
 * con color y con trazo discontinuo. SVG propio, sin librerías. Datos solo con `repositorio`.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, toast } from '../assets/js/marco.js';
import { abrirAlta } from '../assets/js/altas.js';
import { h, tabla, indicadorVerificacion, normalizar } from '../assets/js/utiles.js';
import { ROTULO_FIBRA_TIPO, ATENUACION_ALTA_DB } from '../assets/js/modelos.js';
import { cargarContexto, encabezado, pestanas, chipsEstado, avisoVista } from '../assets/js/red.js';

const NS = 'http://www.w3.org/2000/svg';

let filtroTexto = '';
let filtroTipo = '';
let filtroChip = '';

/**
 * Última medición de cada pelo (la de fecha más reciente).
 * @param {any} t @returns {Map<number, any>}
 */
export function ultimasMediciones(t) {
  /** @type {Map<number, any>} */
  const m = new Map();
  for (const x of t.tramo_mediciones || []) {
    const a = m.get(x.pelo);
    if (!a || String(x.fecha) >= String(a.fecha)) m.set(x.pelo, x);
  }
  return m;
}

/** Pelos cuya última medición supera el umbral. @param {any} t @returns {number[]} */
export function pelosConAtenuacionAlta(t) {
  return Array.from(ultimasMediciones(t).values()).filter(x => x.atenuacion_db >= ATENUACION_ALTA_DB).map(x => x.pelo).sort((a, b) => a - b);
}

/** @param {number} n */
export const textoDb = n => String(n).replace('.', ',') + ' dB';


/** @param {string} tag @param {Object<string, string|number>} [attrs] @param {string} [texto] */
function sv(tag, attrs, texto) {
  const e = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs || {})) e.setAttribute(k, String(/** @type {any} */ (attrs)[k]));
  if (texto != null) e.textContent = texto;
  return e;
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const ctx = await cargarContexto();
  await encabezado(contenedor, 'P30', 'Fibra óptica', [['Red', '#/red/equipos'], ['Fibra']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso al módulo Red.'); return; }
  contenedor.appendChild(h('h1', { text: 'Red' }));
  contenedor.appendChild(pestanas([['equipos', 'Equipos de red', 'equipo'], ['vlan', 'VLAN', 'vlan'], ['wifi', 'Redes Wi-Fi', 'wifi'], ['isp', 'Enlaces ISP', 'equipo'], ['puestos', 'Puestos de trabajo', 'puesto'], ['fibra', 'Fibra', 'vlan'], ['topologia', 'Topología', 'vlan']],
    'fibra', k => (k === 'fibra' ? '#/fibra' : k === 'topologia' ? '#/topologia' : '#/red/' + k)));

  const [tramos, ubicaciones] = await Promise.all([
    repositorio.listar('tramos_fibra', { organizacion_id: ctx.org }, { ordenarPor: 'tramo_nombre' }),
    repositorio.listar('ubicaciones', { organizacion_id: ctx.org })]);
  const ub = new Map(ubicaciones.map(x => [x.id, x]));
  const nom = (/** @type {string} */ id) => (ub.get(id) ? ub.get(id).ubicacion_nombre : '(sede o sala dada de baja)');

  const barra = h('div', { class: 'herr' }, [h('span', { style: 'flex:1' }),
    ctx.modifica ? h('button', { type: 'button', class: 'primario', text: 'Nuevo tramo', onclick: async () => {
      const t = await abrirAlta('tramos_fibra', { organizacion_id: ctx.org, rotulo: null });
      if (t) { toast('Tramo «' + t.tramo_nombre + '» creado.'); ir('#/tramo/' + t.id); }
    } }) : null]);
  contenedor.appendChild(barra);

  if (!tramos.length) {
    contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Todavía no hay tramos de fibra cargados en esta organización.' }),
      ctx.modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Usá «Nuevo tramo» para cargar el primero: el esquema se arma solo con los datos.' }) : null]));
    return;
  }

  contenedor.appendChild(h('div', { class: 'bloque t-vlan' }, [h('h3', { text: 'Esquema de tramos entre ubicaciones' }), esquema(tramos, nom),
    h('div', { class: 'fb-leyenda' }, [
      h('span', null, [leyendaLinea(false), ' Tramo sin alertas']),
      h('span', null, [leyendaLinea(true), ' Atenuación alta (desde ' + textoDb(ATENUACION_ALTA_DB) + ')']),
      h('span', { text: 'Etiqueta: pelos usados/total · tipo · longitud. Tocá un tramo para abrir su ficha.' })])]));

  // ---- tabla
  const raiz = h('div', { style: 'margin-top:10px' });
  const chipsCont = h('div'), tb = h('div'), cuenta = h('div', { class: 'mut', style: 'margin-top:6px', role: 'status' });
  const libres = (/** @type {any} */ t) => t.tramo_pelos - (t.tramo_pelos_usados || []).length;
  const CHIPS = /** @type {Array<[string, string]>} */ ([['alta', 'Con atenuación alta'], ['sin_med', 'Sin mediciones'], ['libres', 'Pelos libres']]);
  /** @type {Object<string, (t: any) => boolean>} */
  const cond = { alta: t => pelosConAtenuacionAlta(t).length > 0, sin_med: t => !(t.tramo_mediciones || []).length, libres: t => libres(t) > 0 };
  const pintar = () => {
    tb.textContent = ''; chipsCont.textContent = '';
    const q = normalizar(filtroTexto);
    const base = tramos.filter(t => (!filtroTipo || t.tramo_tipo === filtroTipo) && (!q || normalizar([t.tramo_nombre, nom(t.tramo_origen_ubicacion_id), nom(t.tramo_destino_ubicacion_id)].join(' ')).includes(q)));
    chipsCont.appendChild(chipsEstado(CHIPS, c => base.filter(cond[c]).length, base.length, filtroChip, v => { filtroChip = v; pintar(); }));
    const f = base.filter(t => !filtroChip || cond[filtroChip](t));
    if (f.length) {
      tb.appendChild(tabla(['Tramo', 'Origen → destino', 'Pelos usados / libres', 'Tipo y conector', 'Longitud', 'Atenuación', 'Verificado'], f.map(t => {
        const alta = pelosConAtenuacionAlta(t);
        return [t.tramo_nombre, nom(t.tramo_origen_ubicacion_id) + ' → ' + nom(t.tramo_destino_ubicacion_id),
          (t.tramo_pelos_usados || []).length + ' / ' + libres(t) + ' (de ' + t.tramo_pelos + ')',
          ROTULO_FIBRA_TIPO[t.tramo_tipo] + ' · ' + t.tramo_conector, t.tramo_longitud_m != null ? String(t.tramo_longitud_m).replace('.', ',') + ' m' : '—',
          alta.length ? h('span', { class: 'fb-tag', text: 'Alta · pelo' + (alta.length > 1 ? 's ' : ' ') + alta.join(', ') }) : (t.tramo_mediciones || []).length ? 'Normal' : 'Sin mediciones',
          indicadorVerificacion(t.verificado_en, ctx.umbrales, true)];
      }), { tipo: 'vlan', onFila: (_, i) => ir('#/tramo/' + f[i].id) }));
    } else tb.appendChild(h('div', { class: 'aviso', text: 'Ningún tramo coincide con el filtro.' }));
    cuenta.textContent = f.length + ' de ' + tramos.length + ' tramos. Tocá uno para abrir su ficha.';
  };
  const inp = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Filtrar por nombre, sede o sala…', 'aria-label': 'Filtrar', value: filtroTexto, style: 'width:260px' }));
  inp.addEventListener('input', () => { filtroTexto = inp.value; pintar(); });
  const selT = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo de fibra' }, [h('option', { value: '', text: 'Todos los tipos' })].concat(Object.keys(ROTULO_FIBRA_TIPO).map(k => h('option', { value: k, text: ROTULO_FIBRA_TIPO[k] })))));
  selT.value = filtroTipo;
  selT.addEventListener('change', () => { filtroTipo = selT.value; pintar(); });
  raiz.appendChild(h('div', { class: 'herr' }, [inp, selT]));
  raiz.appendChild(chipsCont); raiz.appendChild(tb); raiz.appendChild(cuenta);
  contenedor.appendChild(raiz);
  pintar();
}

/** @param {boolean} alta */
function leyendaLinea(alta) {
  const s = sv('svg', { width: 34, height: 10, 'aria-hidden': 'true' });
  const l = sv('line', { x1: 1, y1: 5, x2: 33, y2: 5, stroke: alta ? 'var(--bad-fg)' : 'var(--c-vlan)', 'stroke-width': alta ? 4 : 3 });
  if (alta) l.setAttribute('stroke-dasharray', '9 5');
  s.appendChild(l);
  return s;
}

/**
 * Esquema: ubicaciones con tramos en círculo (o en fila si son pocas), tramos entre las mismas dos ubicaciones separados en curvas.
 * @param {any[]} tramos @param {(id: string) => string} nom
 */
function esquema(tramos, nom) {
  const ids = Array.from(new Set(tramos.flatMap(t => [t.tramo_origen_ubicacion_id, t.tramo_destino_ubicacion_id]))).sort((a, b) => nom(a).localeCompare(nom(b), 'es'));
  const W = 900, H = ids.length <= 3 ? 260 : 420, cx = W / 2, cy = H / 2;
  const rx = ids.length <= 3 ? 320 : 330, ry = ids.length <= 3 ? 0 : 140;
  /** @type {Map<string, {x: number, y: number}>} */
  const pos = new Map();
  ids.forEach((id, i) => {
    if (ids.length <= 3) pos.set(id, { x: ids.length === 1 ? cx : cx - rx + (2 * rx * i) / (ids.length - 1), y: cy });
    else { const a = -Math.PI / 2 + (2 * Math.PI * i) / ids.length; pos.set(id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }); }
  });
  const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fb-esquema', role: 'img', 'aria-label': 'Esquema de ' + tramos.length + ' tramos de fibra entre ' + ids.length + ' ubicaciones. La tabla de abajo tiene los mismos datos.' });
  /** @type {Map<string, number>} */
  const porPar = new Map();
  for (const t of tramos) {
    const a = pos.get(t.tramo_origen_ubicacion_id), b = pos.get(t.tramo_destino_ubicacion_id);
    if (!a || !b) continue;
    const clave = [t.tramo_origen_ubicacion_id, t.tramo_destino_ubicacion_id].sort().join('|');
    const k = porPar.get(clave) || 0; porPar.set(clave, k + 1);
    const alta = pelosConAtenuacionAlta(t).length > 0;
    const g = sv('g', { class: 'fb-tramo' + (alta ? ' alta' : ''), tabindex: 0, role: 'link', 'aria-label': t.tramo_nombre + ': ' + (t.tramo_pelos_usados || []).length + ' de ' + t.tramo_pelos + ' pelos usados' + (alta ? ', atenuación alta' : '') });
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 46;
    const nx = -dy / len, ny = dx / len;
    const qx = mx + nx * off * 2, qy = my + ny * off * 2;
    if (k === 0) g.appendChild(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y })); else g.appendChild(sv('path', { d: 'M' + a.x + ',' + a.y + ' Q' + qx + ',' + qy + ' ' + b.x + ',' + b.y }));
    const lx = k === 0 ? mx : (a.x + 2 * qx + b.x) / 4, ly = k === 0 ? my : (a.y + 2 * qy + b.y) / 4;
    const txt = (t.tramo_pelos_usados || []).length + '/' + t.tramo_pelos + ' · ' + ROTULO_FIBRA_TIPO[t.tramo_tipo] + (t.tramo_longitud_m != null ? ' · ' + t.tramo_longitud_m + ' m' : '') + (alta ? ' · ALTA' : '');
    const w = txt.length * 6.2 + 14;
    const et = sv('g', { class: 'fb-et' });
    et.appendChild(sv('rect', { x: lx - w / 2, y: ly - 10, width: w, height: 20, rx: 4 }));
    et.appendChild(sv('text', { x: lx, y: ly + 4, 'text-anchor': 'middle' }, txt));
    g.appendChild(et);
    g.appendChild(sv('title', {}, t.tramo_nombre));
    g.addEventListener('click', () => ir('#/tramo/' + t.id));
    g.addEventListener('keydown', e => { if (/** @type {KeyboardEvent} */ (e).key === 'Enter') ir('#/tramo/' + t.id); });
    svg.appendChild(g);
  }
  for (const id of ids) {
    const p = /** @type {{x: number, y: number}} */ (pos.get(id));
    const n = tramos.filter(t => t.tramo_origen_ubicacion_id === id || t.tramo_destino_ubicacion_id === id).length;
    const nombre = nom(id).length > 24 ? nom(id).slice(0, 23) + '…' : nom(id);
    const g = sv('g', { class: 'fb-caja' });
    g.appendChild(sv('rect', { x: p.x - 80, y: p.y - 24, width: 160, height: 48, rx: 8 }));
    g.appendChild(sv('text', { x: p.x, y: p.y - 3, 'text-anchor': 'middle' }, nombre));
    g.appendChild(sv('text', { x: p.x, y: p.y + 13, 'text-anchor': 'middle', class: 'sub' }, n + (n === 1 ? ' tramo' : ' tramos')));
    svg.appendChild(g);
  }
  return svg;
}
