// @ts-check
/**
 * P31 · Topología de red (`#/topologia`, D-058): diagrama generado de los equipos de red y servidores de la organización y de
 * las conexiones entre sus puertos. Layout determinístico por niveles (Internet → router → firewall → core → acceso → servidores → AP).
 * Siempre con alternativa en tabla (D-039).
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla } from '../assets/js/utiles.js';
import { estadoVacio, porId, rutaUbicacion, rutaEquipo } from '../assets/js/racks.js';

const NS = 'http://www.w3.org/2000/svg';
const ALTO = 46, SEP = 14, GAP_FILA = 104, MAX_ANCHO = 1140;
/** @type {Object<string, {rotulo: string, color: string}>} */
const TIPO = {
  internet: { rotulo: 'Internet', color: 'var(--c-puerto)' },
  router: { rotulo: 'Router', color: 'var(--c-vlan)' },
  firewall: { rotulo: 'Firewall', color: 'var(--c-credencial)' },
  switch: { rotulo: 'Switch', color: 'var(--c-equipo)' },
  servidor: { rotulo: 'Servidor', color: 'var(--c-servidor)' },
  access_point: { rotulo: 'Access point', color: 'var(--c-wifi)' }
};

const CSS = `
.tp-svg{width:100%;height:auto;display:block;background:var(--surf);border:1px solid var(--borde-fuerte);border-radius:8px}
.tp-svg text{font-family:var(--sans);fill:var(--texto)}
.tp-nodo{cursor:pointer}
.tp-nodo .f{fill:var(--surf2);stroke:var(--tc);stroke-width:2.2}
.tp-nodo .t{fill:var(--tc);opacity:.18}
.tp-nodo:hover .f,.tp-nodo:focus-visible .f{stroke-width:3.6}
.tp-nodo:focus{outline:none}
.tp-nodo .n1{font-size:12px;font-weight:700}
.tp-nodo .n2{font-size:10px;fill:var(--muted)}
.tp-lin{fill:none;stroke:var(--ctl);stroke-width:1.6}
.tp-lin.isp{stroke:var(--c-puerto);stroke-width:2.6}
.tp-lin.resp{stroke-dasharray:7 5}
.tp-golpe{fill:none;stroke:transparent;stroke-width:12;cursor:pointer}
.tp-g:hover .tp-lin,.tp-g:focus-visible .tp-lin{stroke:var(--acc);stroke-width:3}
.tp-g:focus{outline:none}
.tp-et{font-size:9.5px;paint-order:stroke;stroke:var(--surf);stroke-width:3.5px;stroke-linejoin:round}
.tp-et.isp{font-size:10.5px;font-weight:600}
.tp-leyenda{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0;font-size:13px}
.tp-leyenda span{display:inline-flex;align-items:center;gap:6px}
.tp-leyenda svg{width:30px;height:22px;overflow:visible}
.tp-leyenda .f{fill:var(--surf2);stroke:var(--tc);stroke-width:2.2}
.tp-leyenda .t{fill:var(--tc);opacity:.18}
`;

/** @param {string} nombre @param {Object<string,string|number>} [attrs] @param {Node[]} [hijos] */
function s(nombre, attrs, hijos) {
  const e = document.createElementNS(NS, nombre);
  for (const k of Object.keys(attrs || {})) e.setAttribute(k, String((/** @type {any} */ (attrs))[k]));
  for (const c of hijos || []) e.appendChild(c);
  return e;
}
/** @param {string} t @param {Object<string,string|number>} a */
function texto(t, a) { const e = s('text', a); e.textContent = t; return e; }
/** @param {string} t @param {number} n */
const corto = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** Forma del nodo, distinta por tipo (además del color). @param {string} tipo @param {number} w */
function forma(tipo, w) {
  const c = { class: 'f' };
  if (tipo === 'router') return s('polygon', { ...c, points: `14,0 ${w - 14},0 ${w},${ALTO / 2} ${w - 14},${ALTO} 14,${ALTO} 0,${ALTO / 2}` });
  if (tipo === 'access_point' || tipo === 'internet') return s('rect', { ...c, width: w, height: ALTO, rx: ALTO / 2 });
  return s('rect', { ...c, width: w, height: ALTO, rx: tipo === 'servidor' ? 2 : 7 });
}
/** Detalle interior que refuerza el tipo sin depender del color. @param {string} tipo @param {number} w */
function marca(tipo, w) {
  if (tipo === 'firewall') { const g = s('g', { class: 't' }); for (let x = 6; x < w - 6; x += 12) g.appendChild(s('rect', { x, y: 3, width: 6, height: 5 })); return g; }
  if (tipo === 'servidor') return s('g', { class: 't' }, [s('rect', { x: 4, y: 3, width: w - 8, height: 4 }), s('rect', { x: 4, y: ALTO - 7, width: w - 8, height: 4 })]);
  if (tipo === 'switch') return s('g', { class: 't' }, [0, 1, 2, 3, 4, 5].map(i => s('rect', { x: 8 + i * 8, y: ALTO - 8, width: 5, height: 4 })));
  return s('g');
}

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  if (!document.getElementById('estilos-topologia')) { const st = document.createElement('style'); st.id = 'estilos-topologia'; st.textContent = CSS; document.head.appendChild(st); }
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  pantalla(contenedor, { codigo: 'P31', nombre: 'Topología de red', migas: (await migasRaiz()).concat([['Red', '#/red'], ['Topología']]) });
  if (!org || !puede(u, 'ver', 'red', org)) { contenedor.appendChild(h('div', { class: 'aviso', text: 'Tu rol no tiene acceso al módulo Red.' })); return; }
  const verServidores = puede(u, 'ver', 'servidores', org);
  const [equiposTodos, puertos, enlaces, ubicaciones] = await Promise.all([
    repositorio.listar('equipos', { organizacion_id: org }), repositorio.listar('puertos'),
    repositorio.listar('enlaces_isp', { organizacion_id: org }), repositorio.listar('ubicaciones', { organizacion_id: org })]);
  const mapaU = porId(ubicaciones);
  const equipos = equiposTodos.filter(e => e.equipo_estado !== 'baja' && ['router', 'firewall', 'switch', 'access_point', 'servidor'].includes(e.equipo_tipo)
    && !(e.equipo_tipo === 'servidor' && (e.equipo_campos && e.equipo_campos.host_id)) && (e.equipo_tipo !== 'servidor' || verServidores));
  const mapaE = porId(equipos);
  const mapaP = porId(puertos);

  contenedor.appendChild(h('h1', { text: 'Topología de red' }));
  if (!equipos.some(e => e.equipo_tipo !== 'access_point' && e.equipo_tipo !== 'servidor')) {
    contenedor.appendChild(estadoVacio('Todavía no hay equipos de red para dibujar', 'El diagrama se arma solo con los routers, firewalls y switches cargados y las conexiones entre sus puertos. Cargá los equipos en «Red» y conectá sus puertos desde la ficha de cada equipo.', 'red'));
    return;
  }

  let ubicFiltro = '';
  let verAp = true;
  const selUb = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Filtrar por ubicación' }, [h('option', { value: '', text: 'Toda la organización' })]));
  const conEquipos = new Set(equipos.map(e => e.ubicacion_id).filter(Boolean));
  const relevantes = new Set();
  for (const id of conEquipos) { let a = mapaU.get(id), t = 0; while (a && t++ < 10) { relevantes.add(a.id); a = a.ubicacion_padre_id ? mapaU.get(a.ubicacion_padre_id) : null; } }
  ubicaciones.filter(x => relevantes.has(x.id)).sort((a, b) => rutaUbicacion(a.id, mapaU).localeCompare(rutaUbicacion(b.id, mapaU), 'es'))
    .forEach(x => selUb.appendChild(h('option', { value: x.id, text: rutaUbicacion(x.id, mapaU) })));
  const chkAp = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: 'checked', id: 'tp-ap' }));
  selUb.addEventListener('change', () => { ubicFiltro = selUb.value; pintar(); });
  chkAp.addEventListener('change', () => { verAp = chkAp.checked; pintar(); });
  contenedor.appendChild(h('div', { class: 'herr' }, [h('label', { for: 'tp-ub', text: 'Ubicación:' }), selUb, h('label', { for: 'tp-ap', style: 'display:inline-flex;gap:6px;align-items:center' }, [chkAp, 'Mostrar access points'])]));
  selUb.id = 'tp-ub';
  const ley = h('div', { class: 'tp-leyenda', 'aria-label': 'Leyenda' });
  for (const k of ['router', 'firewall', 'switch', 'servidor', 'access_point']) {
    const sv = s('svg', { viewBox: `0 0 60 ${ALTO}`, 'aria-hidden': 'true', style: `--tc:${TIPO[k].color}` }, [forma(k, 60), marca(k, 60)]);
    ley.appendChild(h('span', null, [/** @type {any} */ (sv), TIPO[k].rotulo]));
  }
  ley.appendChild(h('span', { text: 'Línea gruesa: enlace a Internet (punteada: respaldo)' }));
  contenedor.appendChild(ley);
  const zona = h('div');
  contenedor.appendChild(zona);

  /** Hash de la ficha de un puerto (por el extremo de red). */
  const hashPuerto = (/** @type {any} */ p) => { const e = mapaE.get(p.equipo_id); return '#/equipo/' + p.equipo_id + '/puertos/' + p.puerto_numero + (e ? '' : ''); };
  const etqPuerto = (/** @type {any} */ p) => (p.puerto_nombre ? String(p.puerto_nombre) : 'P' + p.puerto_numero);

  function pintar() {
    zona.textContent = '';
    let sub = null;
    if (ubicFiltro) { sub = new Set([ubicFiltro]); for (let c = true; c;) { c = false; for (const x of ubicaciones) if (x.ubicacion_padre_id && sub.has(x.ubicacion_padre_id) && !sub.has(x.id)) { sub.add(x.id); c = true; } } }
    const vis = equipos.filter(e => (!sub || (e.ubicacion_id && sub.has(e.ubicacion_id))) && (verAp || e.equipo_tipo !== 'access_point'));
    const ids = new Set(vis.map(e => e.id));
    // Conexiones únicas entre equipos visibles
    /** @type {Array<{a: any, b: any}>} */
    const cons = [];
    for (const p of puertos) {
      if (!p.conectado_a_puerto_id || !ids.has(p.equipo_id)) continue;
      const q = mapaP.get(p.conectado_a_puerto_id);
      if (!q || !ids.has(q.equipo_id) || p.id > q.id) continue;
      cons.push({ a: p, b: q });
    }
    // Servidores sin conexión visible: se omiten
    const conectados = new Set(); cons.forEach(c => { conectados.add(c.a.equipo_id); conectados.add(c.b.equipo_id); });
    const nodosEq = vis.filter(e => e.equipo_tipo !== 'servidor' && (e.equipo_tipo !== 'access_point' || true) ? true : conectados.has(e.id)).filter(e => e.equipo_tipo !== 'servidor' || conectados.has(e.id));
    const idsN = new Set(nodosEq.map(e => e.id));
    const enl = enlaces.filter(l => l.equipo_id && idsN.has(l.equipo_id));

    // Niveles
    /** @type {Map<string, number>} */
    const nivel = new Map();
    const ady = new Map(nodosEq.map(e => [e.id, /** @type {Set<string>} */ (new Set())]));
    cons.forEach(c => { /** @type {Set<string>} */ (ady.get(c.a.equipo_id)).add(c.b.equipo_id); /** @type {Set<string>} */ (ady.get(c.b.equipo_id)).add(c.a.equipo_id); });
    const tipoDe = (/** @type {string} */ id) => mapaE.get(id).equipo_tipo;
    // distancia de switches a firewall/router
    const dist = new Map(); /** @type {string[]} */ let cola = [];
    const fuentes = nodosEq.filter(e => e.equipo_tipo === 'firewall').length ? 'firewall' : 'router';
    for (const e of nodosEq) if (e.equipo_tipo === 'switch' && [.../** @type {Set<string>} */ (ady.get(e.id))].some(v => tipoDe(v) === fuentes || tipoDe(v) === 'router' || tipoDe(v) === 'firewall')) { dist.set(e.id, 1); cola.push(e.id); }
    if (!cola.length) { const sw = nodosEq.filter(e => e.equipo_tipo === 'switch').sort((a, b) => /** @type {Set<string>} */ (ady.get(b.id)).size - /** @type {Set<string>} */ (ady.get(a.id)).size)[0]; if (sw) { dist.set(sw.id, 1); cola.push(sw.id); } }
    while (cola.length) { const x = /** @type {string} */ (cola.shift()); for (const v of /** @type {Set<string>} */ (ady.get(x))) if (tipoDe(v) === 'switch' && !dist.has(v)) { dist.set(v, dist.get(x) + 1); cola.push(v); } }
    const maxD = Math.max(1, ...dist.values());
    for (const e of nodosEq) {
      const t = e.equipo_tipo;
      nivel.set(e.id, t === 'router' ? 1 : t === 'firewall' ? 2 : t === 'switch' ? 2 + (dist.get(e.id) || maxD + (dist.size ? 1 : 0)) : t === 'servidor' ? 100 : 101);
    }
    // Compactar niveles vacíos
    const usados = [...new Set([...nivel.values()])];
    if (enl.length) usados.push(0);
    usados.sort((a, b) => a - b);
    const fila = (/** @type {number} */ n) => usados.indexOf(n);

    // Nodos
    /** @type {Array<{id: string, tipo: string, nom: string, sub: string, w: number, x: number, y: number, ficha: string|null, nivel: number, arriba: any[], abajo: any[]}>} */
    const nodos = [];
    /** @type {Map<string, any>} */
    const porNodo = new Map();
    const crear = (/** @type {string} */ id, /** @type {string} */ tipo, /** @type {string} */ nom, /** @type {string} */ sub, /** @type {string|null} */ ficha, /** @type {number} */ niv) => {
      const n = { id, tipo, nom, sub, w: 116, x: 0, y: 0, ficha, nivel: niv, arriba: [], abajo: [] };
      nodos.push(n); porNodo.set(id, n); return n;
    };
    if (enl.length) crear('internet', 'internet', 'Internet', enl.length + (enl.length === 1 ? ' enlace' : ' enlaces'), '#/red/isp', 0);
    for (const e of nodosEq) crear(e.id, e.equipo_tipo, e.equipo_nombre, e.equipo_ip_gestion || TIPO[e.equipo_tipo].rotulo, rutaEquipo(e), /** @type {number} */ (nivel.get(e.id)));
    if (nodos.length < 2) { zona.appendChild(estadoVacio('No hay equipos para dibujar con este filtro', 'Elegí otra ubicación o «Toda la organización».', 'red')); return; }

    // Aristas
    /** @type {Array<{a: any, b: any, pa: any[], pb: any[], isp?: any}>} */
    const aristas = [];
    /** @type {Map<string, any>} */
    const idx = new Map();
    for (const c of cons) {
      const k = [c.a.equipo_id, c.b.equipo_id].sort().join('|');
      let ar = idx.get(k);
      if (!ar) { ar = { a: porNodo.get(c.a.equipo_id), b: porNodo.get(c.b.equipo_id), pa: [], pb: [] }; idx.set(k, ar); aristas.push(ar); }
      if (ar.a.id === c.a.equipo_id) { ar.pa.push(c.a); ar.pb.push(c.b); } else { ar.pa.push(c.b); ar.pb.push(c.a); }
    }
    for (const l of enl) aristas.push({ a: porNodo.get('internet'), b: porNodo.get(l.equipo_id), pa: [], pb: [], isp: l });
    for (const ar of aristas) { if (ar.a.nivel > ar.b.nivel) { const t = ar.a; ar.a = ar.b; ar.b = t; const tp = ar.pa; ar.pa = ar.pb; ar.pb = tp; } }

    // Ancho por cantidad de conexiones (para repartir los puntos de salida)
    for (const n of nodos) { const k = aristas.filter(a => a.a === n || a.b === n).length; n.w = Math.max(116, 20 * k); }

    // Filas: orden por baricentro, con ajuste de línea
    /** @type {Map<number, any[]>} */
    const porNivel = new Map();
    for (const n of nodos) { if (!porNivel.has(n.nivel)) porNivel.set(n.nivel, []); /** @type {any[]} */ (porNivel.get(n.nivel)).push(n); }
    let yAct = 40, anchoMax = 900;
    /** @type {any[][]} */
    const filasVis = [];
    for (const niv of usados) {
      const lista = /** @type {any[]} */ (porNivel.get(niv) || []);
      const bari = (/** @type {any} */ n) => {
        const xs = aristas.filter(a => (a.a === n && a.b.placed) || (a.b === n && a.a.placed)).map(a => (a.a === n ? a.b : a.a).x + (a.a === n ? a.b : a.a).w / 2);
        return xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : Infinity;
      };
      lista.sort((p, q) => { const d = bari(p) - bari(q); return d === 0 || Number.isNaN(d) ? p.nom.localeCompare(q.nom, 'es', { numeric: true }) : d; });
      // partir en líneas
      /** @type {any[][]} */
      const lineas = [[]]; let ancho = 0;
      for (const n of lista) { if (ancho + n.w + SEP > MAX_ANCHO && lineas[lineas.length - 1].length) { lineas.push([]); ancho = 0; } lineas[lineas.length - 1].push(n); ancho += n.w + SEP; }
      for (const l of lineas) {
        const total = l.reduce((p, n) => p + n.w + SEP, -SEP);
        anchoMax = Math.max(anchoMax, total + 40);
        l.forEach(n => { n.y = yAct; });
        filasVis.push(l);
        yAct += lineas.length > 1 ? ALTO + 62 : GAP_FILA;
      }
      yAct += lineas.length > 1 ? 24 : 0;
      // x provisorio (centrado en 0) para el baricentro de la fila siguiente
      for (const l of lineas) { let x = 0; for (const n of l) { n.x = x; x += n.w + SEP; } const tot = x - SEP; for (const n of l) { n.x += (anchoMax - tot) / 2; n.placed = true; } }
    }
    // Centrar definitivamente con el ancho final
    for (const l of filasVis) { const tot = l.reduce((p, n) => p + n.w + SEP, -SEP); let x = (anchoMax - tot) / 2; for (const n of l) { n.x = x; x += n.w + SEP; } }
    const altoTotal = yAct - GAP_FILA + ALTO + 50;

    // Puntos de anclaje
    for (const ar of aristas) {
      if (ar.a.y === ar.b.y) { ar.a.arriba.push(ar); ar.b.arriba.push(ar); } else { ar.a.abajo.push(ar); ar.b.arriba.push(ar); }
    }
    /** @param {any} n @param {any} ar */
    const ancla = (n, ar) => {
      const lado = n.arriba.includes(ar) ? 'arriba' : 'abajo';
      const lista = n[lado].slice().sort((p, q) => { const o = (/** @type {any} */ z) => (z.a === n ? z.b : z.a); return (o(p).x + o(p).w / 2) - (o(q).x + o(q).w / 2); });
      const i = lista.indexOf(ar);
      return { x: n.x + n.w * (i + 1) / (lista.length + 1), y: lado === 'arriba' ? n.y : n.y + ALTO, i, total: lista.length, lado };
    };

    const svg = s('svg', { class: 'tp-svg', viewBox: `0 0 ${anchoMax} ${altoTotal}`, role: 'img', 'aria-label': 'Diagrama de topología de red. Debajo hay una tabla con las mismas conexiones.' });
    const gLin = s('g'), gNod = s('g');
    svg.appendChild(gLin); svg.appendChild(gNod);
    for (const ar of aristas) {
      const A = ancla(ar.a, ar), B = ancla(ar.b, ar);
      const mismaFila = ar.a.y === ar.b.y;
      let d;
      if (mismaFila) { const alt = 30; d = `M${A.x},${A.y} C${A.x},${A.y - alt} ${B.x},${B.y - alt} ${B.x},${B.y}`; }
      else { const ym = (A.y + B.y) / 2; d = `M${A.x},${A.y} C${A.x},${ym} ${B.x},${ym} ${B.x},${B.y}`; }
      const esp = ar.isp ? ar.isp : null;
      const g = s('g', { class: 'tp-g', tabindex: 0, role: 'link' });
      let destino, desc;
      if (esp) { destino = '#/red/isp'; desc = 'Enlace a Internet: ' + esp.enlace_proveedor + ' · ' + esp.enlace_tipo + (esp.enlace_velocidad_bajada_mbps ? ' · ' + esp.enlace_velocidad_bajada_mbps + '/' + (esp.enlace_velocidad_subida_mbps || '?') + ' Mbps' : '') + (esp.enlace_es_principal ? ' (principal)' : ' (respaldo)'); }
      else {
        const pref = ar.pa[0] && mapaE.get(ar.pa[0].equipo_id).equipo_tipo !== 'servidor' ? ar.pa[0] : ar.pb[0];
        destino = hashPuerto(pref);
        desc = ar.a.nom + ' ↔ ' + ar.b.nom + ': ' + ar.pa.map((p, i) => etqPuerto(p) + ' ↔ ' + etqPuerto(ar.pb[i])).join(', ');
      }
      g.setAttribute('aria-label', desc);
      g.appendChild(s('title', {}, [document.createTextNode(desc)]));
      g.appendChild(s('path', { d, class: 'tp-golpe' }));
      g.appendChild(s('path', { d, class: 'tp-lin' + (esp ? ' isp' : '') + (esp && !esp.enlace_es_principal ? ' resp' : '') }));
      const abrir = () => ir(destino);
      g.addEventListener('click', abrir); g.addEventListener('keydown', ev => { if (ev.key === 'Enter') abrir(); });
      if (esp) {
        { const cx = ar.a.x + ar.a.w / 2, izq = B.x < cx - 4;
          g.appendChild(texto(corto(esp.enlace_proveedor + (esp.enlace_velocidad_bajada_mbps ? ' · ' + esp.enlace_velocidad_bajada_mbps + ' Mbps' : ''), 34), { x: B.x + (izq ? -8 : 8), y: B.y - 26, 'text-anchor': izq ? 'end' : 'start', class: 'tp-et isp' })); }
      } else {
        const etq = (/** @type {any[]} */ ps, /** @type {any} */ P) => (ps.length > 1 && P.total > 5 ? etqPuerto(ps[0]) + ' ×' + ps.length : corto(ps.map(etqPuerto).join(','), 14));
        const esc = (/** @type {any} */ P) => (P.i % 4) * 9;
        g.appendChild(texto(etq(ar.pa, A), { x: A.x, y: A.lado === 'abajo' ? A.y + 12 + esc(A) : A.y - 5 - esc(A), 'text-anchor': 'middle', class: 'tp-et' }));
        g.appendChild(texto(etq(ar.pb, B), { x: B.x, y: B.lado === 'abajo' ? B.y + 12 + esc(B) : B.y - 5 - esc(B), 'text-anchor': 'middle', class: 'tp-et' }));
      }
      gLin.appendChild(g);
    }
    for (const n of nodos) {
      const g = s('g', { class: 'tp-nodo', transform: `translate(${n.x},${n.y})`, style: `--tc:${TIPO[n.tipo].color}`, tabindex: 0, role: 'link', 'aria-label': TIPO[n.tipo].rotulo + ' ' + n.nom });
      g.appendChild(s('title', {}, [document.createTextNode(TIPO[n.tipo].rotulo + ' · ' + n.nom + ' · ' + n.sub)]));
      g.appendChild(forma(n.tipo, n.w)); g.appendChild(marca(n.tipo, n.w));
      g.appendChild(texto(corto(n.nom, Math.floor(n.w / 7.2)), { x: n.w / 2, y: 20, 'text-anchor': 'middle', class: 'n1' }));
      g.appendChild(texto(corto(n.sub, Math.floor(n.w / 6)), { x: n.w / 2, y: 33, 'text-anchor': 'middle', class: 'n2' }));
      const go = () => { if (n.ficha) ir(n.ficha); };
      g.addEventListener('click', go); g.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
      gNod.appendChild(g);
    }
    zona.appendChild(/** @type {any} */ (svg));
    zona.appendChild(h('p', { class: 'mut', text: 'Tocá un equipo para abrir su ficha o una línea para ver el puerto. El dibujo se arma solo con los datos de los equipos y de las conexiones entre puertos.' }));

    // Tabla alternativa (D-039)
    const filas = [];
    for (const l of enl) { const e = mapaE.get(l.equipo_id); filas.push(['Internet · ' + l.enlace_proveedor, l.enlace_tipo + (l.enlace_es_principal ? ' (principal)' : ' (respaldo)'), e.equipo_nombre, '—', '#/red/isp']); }
    for (const c of cons) {
      const ea = mapaE.get(c.a.equipo_id), eb = mapaE.get(c.b.equipo_id);
      filas.push([ea.equipo_nombre, etqPuerto(c.a), eb.equipo_nombre, etqPuerto(c.b), hashPuerto(ea.equipo_tipo !== 'servidor' ? c.a : c.b)]);
    }
    filas.sort((x, y) => String(x[0]).localeCompare(String(y[0]), 'es', { numeric: true }));
    const det = h('details', { open: 'open', style: 'margin-top:12px' }, [h('summary', { text: 'Conexiones como tabla (' + filas.length + ')' }),
      tabla(['Desde', 'Puerto', 'Hacia', 'Puerto', ], filas.map(f => [f[0], f[1], f[2], f[3]]), { tipo: 'puerto', onFila: (_f, i) => ir(filas[i][4]) })]);
    zona.appendChild(det);
  }
  pintar();
}
