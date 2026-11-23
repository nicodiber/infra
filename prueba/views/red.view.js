// @ts-check
/**
 * P05 · Red: equipos de red, VLAN, redes Wi-Fi y enlaces ISP (con el esquema gráfico de doble ISP generado de los datos).
 * Ruta: `#/red[/equipos|vlan|wifi|isp|puestos]`.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, abrirModal, cerrarModal, toast } from '../assets/js/marco.js';
import { h, tabla, indicadorVerificacion, normalizar } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import {
  TIPOS_RED, CATEGORIAS_PUESTO, ROTULO_SEGURIDAD, ROTULO_ENLACE_TIPO, inyectarEstilos, cargarContexto, leerRuta, encabezado, pestanas,
  estadoPill, chipsEstado, enlace, avisoVista, textoUbicacion, crearEquipo, hashEquipo, crearPuesto, enlaceFila, cargarPersonas, textoVlan
} from '../assets/js/red.js';

const TABS = /** @type {Array<[string, string, string]>} */ ([['equipos', 'Equipos de red', 'equipo'], ['vlan', 'VLAN', 'vlan'], ['wifi', 'Redes Wi-Fi', 'wifi'], ['isp', 'Enlaces ISP', 'equipo'], ['puestos', 'Puestos de trabajo', 'puesto']]);
const ESTADOS = /** @type {Array<[string, string]>} */ ([['en_uso', 'En uso'], ['en_deposito', 'En depósito'], ['baja', 'Baja']]);

// Filtros que se recuerdan mientras se navega entre pantallas.
let filtroTexto = '';
let filtroTipo = '';
let filtroEstado = '';

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  inyectarEstilos();
  const ctx = await cargarContexto();
  const { partes } = leerRuta();
  const tab = TABS.some(t => t[0] === partes[0]) ? partes[0] : 'equipos';
  await encabezado(contenedor, 'P05', 'Listado de Red', [['Red', '#/red/equipos'], [TABS.find(t => t[0] === tab)?.[1] || '']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso al módulo Red.'); return; }
  contenedor.appendChild(h('h1', { text: 'Red' }));
  contenedor.appendChild(pestanas(TABS, tab, k => '#/red/' + k));
  const org = ctx.org;
  const [racks, ubicaciones] = await Promise.all([repositorio.listar('racks', { organizacion_id: org }), repositorio.listar('ubicaciones', { organizacion_id: org })]);
  const mapaRacks = new Map(racks.map(r => [r.id, r]));
  const mapaUbic = new Map(ubicaciones.map(x => [x.id, x]));

  if (tab === 'equipos') contenedor.appendChild(await tabEquipos(ctx, mapaRacks, mapaUbic));
  else if (tab === 'vlan') contenedor.appendChild(await tabVlan(ctx));
  else if (tab === 'puestos') contenedor.appendChild(await tabPuestos(ctx, ubicaciones));
  else if (tab === 'wifi') contenedor.appendChild(await tabWifi(ctx));
  else contenedor.appendChild(await tabIsp(ctx));
}

/** @param {import('../assets/js/red.js').Contexto} ctx @param {Map<string, any>} racks @param {Map<string, any>} ubic */
async function tabEquipos(ctx, racks, ubic) {
  const todos = (await repositorio.listar('equipos', { organizacion_id: ctx.org }))
    .filter(e => TIPOS_RED.includes(e.equipo_tipo) && !(e.equipo_tipo === 'otro' && CATEGORIAS_PUESTO.includes(String(e.equipo_campos && e.equipo_campos.otro_categoria))))
    .sort((a, b) => TIPOS_RED.indexOf(a.equipo_tipo) - TIPOS_RED.indexOf(b.equipo_tipo) || a.equipo_nombre.localeCompare(b.equipo_nombre, 'es', { numeric: true }));
  const raiz = h('div');
  const chipsCont = h('div'), tb = h('div'), cuenta = h('div', { class: 'mut', style: 'margin-top:6px', role: 'status' });
  const pintar = () => {
    tb.textContent = ''; chipsCont.textContent = '';
    const q = normalizar(filtroTexto);
    const base = todos.filter(e => (!filtroTipo || e.equipo_tipo === filtroTipo)
      && (!q || normalizar([e.equipo_nombre, ROTULO_EQUIPO_TIPO[e.equipo_tipo], e.equipo_marca, e.equipo_modelo, e.equipo_ip_gestion, textoUbicacion(e, racks, ubic)].join(' ')).includes(q)));
    chipsCont.appendChild(chipsEstado(ESTADOS, c => base.filter(e => e.equipo_estado === c).length, base.length, filtroEstado, v => { filtroEstado = v; pintar(); }));
    const f = base.filter(e => !filtroEstado || e.equipo_estado === filtroEstado);
    if (f.length) {
      tb.appendChild(tabla(['Nombre', 'Tipo', 'IP de gestión', 'Ubicación / rack', 'Estado', 'Verificado'],
        f.map(e => [e.equipo_nombre, ROTULO_EQUIPO_TIPO[e.equipo_tipo] + (e.equipo_tipo === 'otro' && e.equipo_campos.otro_categoria ? ' · ' + e.equipo_campos.otro_categoria : ''), e.equipo_ip_gestion || '—',
          textoUbicacion(e, racks, ubic), estadoPill(e.equipo_estado), indicadorVerificacion(e.verificado_en, ctx.umbrales, true)]),
        { tipo: 'equipo', onFila: (_, i) => ir(hashEquipo(f[i])) }));
    } else {
      tb.appendChild(h('div', { class: 'aviso' }, [todos.length ? 'Ningún equipo coincide con el filtro.' : 'Todavía no hay equipos de red cargados en esta organización.' + (ctx.modifica ? ' Usá «Nuevo equipo» para cargar el primero.' : '')]));
    }
    cuenta.textContent = f.length + ' de ' + todos.length + ' equipos. Tocá uno para abrir su ficha.';
    cuenta.appendChild(document.createTextNode(' Las PC y notebooks están en ')); cuenta.appendChild(enlaceFila('#/escritorio', 'Equipos de escritorio')); cuenta.appendChild(document.createTextNode('.'));
  };
  const inp = h('input', { placeholder: 'Filtrar por nombre, tipo, IP…', 'aria-label': 'Filtrar', value: filtroTexto, style: 'width:260px' });
  inp.addEventListener('input', () => { filtroTexto = /** @type {HTMLInputElement} */ (inp).value; pintar(); });
  const selT = h('select', { 'aria-label': 'Tipo de equipo' }, [h('option', { value: '', text: 'Todos los tipos' })].concat(TIPOS_RED.map(t => h('option', { value: t, text: ROTULO_EQUIPO_TIPO[t] }))));
  /** @type {HTMLSelectElement} */ (selT).value = filtroTipo;
  selT.addEventListener('change', () => { filtroTipo = /** @type {HTMLSelectElement} */ (selT).value; pintar(); });
  raiz.appendChild(h('div', { class: 'herr' }, [inp, selT, h('span', { style: 'flex:1' }), ctx.modifica ? h('button', { type: 'button', class: 'primario', text: 'Nuevo equipo', onclick: () => abrirNuevo(ctx) }) : null]));
  raiz.appendChild(chipsCont); raiz.appendChild(tb); raiz.appendChild(cuenta);
  pintar();
  return raiz;
}

/** @param {import('../assets/js/red.js').Contexto} ctx */
function abrirNuevo(ctx) {
  const tipo = h('select', { id: 'nvTipo', 'aria-label': 'Tipo de equipo' }, TIPOS_RED.map(t => h('option', { value: t, text: ROTULO_EQUIPO_TIPO[t] })));
  const nombre = h('input', { id: 'nvNombre', type: 'text', placeholder: 'Ej.: SW-PISO2-01', style: 'width:100%', 'aria-label': 'Nombre del equipo' });
  const err = h('div', { class: 'rd-err', role: 'alert' });
  const crear = async () => {
    const n = /** @type {HTMLInputElement} */ (nombre).value.trim();
    if (!n) { err.textContent = 'Escribí el nombre del equipo.'; return; }
    try {
      const e = await crearEquipo(ctx, /** @type {HTMLSelectElement} */ (tipo).value, n);
      cerrarModal();
      toast('Equipo «' + n + '» creado. Completá sus datos y guardá.');
      ir('#/equipo/' + e.id + '?editar=1');
    } catch (x) { err.textContent = x instanceof Error ? x.message : 'No se pudo crear el equipo.'; }
  };
  nombre.addEventListener('keydown', ev => { if (/** @type {KeyboardEvent} */ (ev).key === 'Enter') crear(); });
  abrirModal(h('div', { style: 'padding:18px 20px;width:420px', role: 'dialog', 'aria-label': 'Nuevo equipo' }, [
    h('h2', { text: 'Nuevo equipo' }),
    h('p', { class: 'mut', text: 'Elegí el tipo (no se puede cambiar después) y el nombre. Los demás datos los completás en la ficha.' }),
    h('label', { for: 'nvTipo', text: 'Tipo', class: 'mut' }), tipo,
    h('label', { for: 'nvNombre', text: 'Nombre', class: 'mut', style: 'display:block;margin-top:8px' }), nombre, err,
    h('div', { class: 'herr', style: 'justify-content:flex-end;margin-top:12px' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }), h('button', { type: 'button', class: 'primario', text: 'Crear y abrir la ficha', onclick: crear })])]));
  nombre.focus();
}

/** @param {import('../assets/js/red.js').Contexto} ctx */
async function tabVlan(ctx) {
  const vlans = (await repositorio.listar('vlans', { organizacion_id: ctx.org })).sort((a, b) => a.vlan_numero - b.vlan_numero);
  if (!vlans.length) return h('div', { class: 'aviso' }, ['Esta organización todavía no tiene VLAN cargadas.']);
  return h('div', null, [tabla(['VLAN', 'Nombre', 'Red', 'Gateway', 'DHCP', 'Verificado'],
    vlans.map(v => [String(v.vlan_numero), v.vlan_nombre, v.vlan_red_cidr || '—', v.vlan_gateway || '—', v.vlan_dhcp_activo ? 'Sí' + (v.vlan_dhcp_rango ? ' · ' + v.vlan_dhcp_rango : '') : 'No', indicadorVerificacion(v.verificado_en, ctx.umbrales, true)]),
    { tipo: 'vlan', onFila: (_, i) => ir('#/vlan/' + vlans[i].id) }),
  h('div', { class: 'mut', style: 'margin-top:6px', text: 'Tocá una VLAN para ver su ficha con los puertos marcados en los switches.' })]);
}

/** @param {import('../assets/js/red.js').Contexto} ctx */
async function tabWifi(ctx) {
  const [wifis, vlans, equipos] = await Promise.all([repositorio.listar('redes_wifi', { organizacion_id: ctx.org }), repositorio.listar('vlans', { organizacion_id: ctx.org }), repositorio.listar('equipos', { organizacion_id: ctx.org, equipo_tipo: 'access_point' })]);
  if (!wifis.length) return h('div', { class: 'aviso' }, ['Esta organización todavía no tiene redes Wi-Fi cargadas.']);
  const mv = new Map(vlans.map(v => [v.id, v])), me = new Map(equipos.map(e => [e.id, e]));
  wifis.sort((a, b) => a.wifi_ssid.localeCompare(b.wifi_ssid));
  return h('div', null, [tabla(['SSID', 'VLAN', 'Seguridad', 'Access points', 'Verificado'],
    wifis.map(w => {
      const v = w.vlan_id ? mv.get(w.vlan_id) : null;
      const aps = w.access_point_ids.map((/** @type {string} */ id) => me.get(id)).filter(Boolean);
      return [w.wifi_ssid + (w.wifi_oculta ? ' (oculta)' : ''), v ? v.vlan_numero + ' · ' + v.vlan_nombre : '—', ROTULO_SEGURIDAD[w.wifi_seguridad] || w.wifi_seguridad,
        aps.length ? aps.length + ': ' + aps.slice(0, 3).map((/** @type {any} */ a) => a.equipo_nombre).join(', ') + (aps.length > 3 ? '…' : '') : '—', indicadorVerificacion(w.verificado_en, ctx.umbrales, true)];
    }), { tipo: 'wifi', onFila: (_, i) => ir('#/wifi/' + wifis[i].id) }),
  h('div', { class: 'mut', style: 'margin-top:6px', text: 'Tocá una red para ver su ficha.' })]);
}

// ---------------------------------------------------------------------------------------------
// Enlaces ISP y esquema de doble ISP
// ---------------------------------------------------------------------------------------------

/** @param {string} t @param {number} n */
const corto = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** @param {import('../assets/js/red.js').Contexto} ctx */
async function tabIsp(ctx) {
  const enlaces = (await repositorio.listar('enlaces_isp', { organizacion_id: ctx.org })).sort((a, b) => Number(b.enlace_es_principal) - Number(a.enlace_es_principal));
  if (!enlaces.length) return h('div', { class: 'aviso' }, ['Esta organización todavía no tiene enlaces a Internet cargados.']);
  const [equipos, puertos] = await Promise.all([repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('puertos')]);
  const me = new Map(equipos.map(e => [e.id, e]));
  const svg = esquemaIsp(enlaces, me, puertos);
  const filas = enlaces.map(e => {
    const eq = e.equipo_id ? me.get(e.equipo_id) : null;
    return [e.enlace_proveedor, e.enlace_es_principal ? 'Principal' : 'Respaldo',
      (ROTULO_ENLACE_TIPO[e.enlace_tipo] || e.enlace_tipo) + ' · ' + (e.enlace_velocidad_bajada_mbps ?? '—') + '/' + (e.enlace_velocidad_subida_mbps ?? '—') + ' Mbps',
      (e.enlace_ip_publica || '—') + (e.enlace_tipo_ip ? ' (' + e.enlace_tipo_ip + ')' : ''),
      eq ? enlace(eq.equipo_nombre, hashEquipo(eq)) : '—',
      [e.enlace_telefono_soporte, e.enlace_numero_cliente ? 'cliente ' + e.enlace_numero_cliente : ''].filter(Boolean).join(' · ') || '—'];
  });
  return h('div', null, [
    h('div', { class: 'bloque rd-isp', style: 'margin-bottom:10px' }, [h('h3', { text: 'Esquema de ISP' }), svg,
      h('div', { class: 'mut', text: 'Línea continua: enlace principal. Línea de trazos: respaldo. Se arma con los enlaces y las conexiones de puertos cargados; el detalle completo está en la tabla.' })]),
    tabla(['Proveedor', 'Rol', 'Servicio', 'IP pública', 'Termina en', 'Soporte'], filas, { tipo: 'equipo' })]);
}

/**
 * Esquema SVG: proveedores → equipo donde terminan → firewall → switches conectados.
 * @param {any[]} enlaces @param {Map<string, any>} me @param {any[]} puertos
 */
function esquemaIsp(enlaces, me, puertos) {
  const NS = 'http://www.w3.org/2000/svg';
  /** Equipos conectados a un equipo (por sus puertos). @param {string} id @param {string} tipo */
  const vecinos = (id, tipo) => {
    const s = new Set();
    for (const p of puertos) {
      if (p.equipo_id === id && p.conectado_a_equipo_id) { const o = me.get(p.conectado_a_equipo_id); if (o && o.equipo_tipo === tipo) s.add(o.id); }
      else if (p.conectado_a_equipo_id === id) { const o = me.get(p.equipo_id); if (o && o.equipo_tipo === tipo) s.add(o.id); }
    }
    return Array.from(s).map(x => me.get(x));
  };
  /** @type {Array<Map<string, any>>} */
  const cols = [new Map(), new Map(), new Map(), new Map()];
  /** @type {Array<[string, string, boolean]>} */
  const aristas = [];
  enlaces.forEach((e, i) => cols[0].set('isp' + i, { titulo: e.enlace_proveedor + (e.enlace_es_principal ? '' : ' (respaldo)'), sub: (ROTULO_ENLACE_TIPO[e.enlace_tipo] || e.enlace_tipo) + ' ' + (e.enlace_velocidad_bajada_mbps ?? '?') + '/' + (e.enlace_velocidad_subida_mbps ?? '?') + (e.enlace_ip_publica ? ' · ' + e.enlace_ip_publica : '') , clase: e.enlace_es_principal ? '' : 'sec' }));
  enlaces.forEach((e, i) => {
    const t = e.equipo_id ? me.get(e.equipo_id) : null;
    if (!t) return;
    const principal = e.enlace_es_principal;
    if (t.equipo_tipo === 'firewall') { cols[2].set(t.id, { titulo: t.equipo_nombre, sub: 'Firewall', clase: 'fw' }); aristas.push(['isp' + i, t.id, principal]); return; }
    cols[1].set(t.id, { titulo: t.equipo_nombre, sub: ROTULO_EQUIPO_TIPO[t.equipo_tipo] + (t.equipo_ip_gestion ? ' · ' + t.equipo_ip_gestion : ''), clase: '' });
    aristas.push(['isp' + i, t.id, principal]);
    for (const f of vecinos(t.id, 'firewall')) { cols[2].set(f.id, { titulo: f.equipo_nombre, sub: 'Firewall', clase: 'fw' }); aristas.push([t.id, f.id, principal]); }
  });
  for (const id of Array.from(cols[2].keys())) for (const sw of vecinos(id, 'switch')) { cols[3].set(sw.id, { titulo: sw.equipo_nombre, sub: 'Switch · red interna', clase: '' }); aristas.push([id, sw.id, true]); }
  const usadas = cols.map((c, i) => [i, c]).filter(x => /** @type {Map<string, any>} */ (x[1]).size).map(x => /** @type {number} */ (x[0]));
  const filasMax = Math.max(...cols.map(c => c.size));
  const ancho = 205, sep = 50, alto = 52, paso = 68;
  const W = usadas.length * ancho + (usadas.length - 1) * sep + 20, H = filasMax * paso + 12;
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', String(W)); s.setAttribute('height', String(H)); s.setAttribute('viewBox', '0 0 ' + W + ' ' + H); s.setAttribute('role', 'img');
  /** @type {Map<string, {x: number, y: number}>} */
  const pos = new Map();
  /** @param {string} tag @param {Object<string, any>} a @param {string|null} t @param {string} [c] */
  const el = (tag, a, t, c) => { const e = document.createElementNS(NS, tag); for (const k of Object.keys(a)) e.setAttribute(k, String(a[k])); if (c) e.setAttribute('class', c); if (t != null) e.textContent = t; s.appendChild(e); return e; };
  usadas.forEach((ci, k) => {
    const x = 10 + k * (ancho + sep), c = cols[ci], ofs = (filasMax - c.size) * paso / 2;
    Array.from(c.entries()).forEach(([id, n], i) => { pos.set(id, { x, y: 6 + ofs + i * paso }); n.x = x; n.y = 6 + ofs + i * paso; });
  });
  for (const [a, b, princ] of aristas) {
    const pa = pos.get(a), pb = pos.get(b);
    if (pa && pb) el('line', { x1: pa.x + ancho, y1: pa.y + alto / 2, x2: pb.x, y2: pb.y + alto / 2 }, null, 'sv-linea' + (princ ? '' : ' resp'));
  }
  for (const c of cols) for (const [id, n] of c) {
    const p = /** @type {{x: number, y: number}} */ (pos.get(id));
    el('rect', { x: p.x, y: p.y, width: ancho, height: alto, rx: 7 }, null, 'sv-caja ' + n.clase);
    el('text', { x: p.x + 10, y: p.y + 22 }, corto(n.titulo, 29), 'sv-t1');
    el('text', { x: p.x + 10, y: p.y + 40 }, corto(n.sub, 34), 'sv-t2');
  }
  const principales = enlaces.filter(e => e.enlace_es_principal).map(e => e.enlace_proveedor).join(', ');
  const resp = enlaces.filter(e => !e.enlace_es_principal).map(e => e.enlace_proveedor).join(', ');
  s.setAttribute('aria-label', 'Esquema de ISP. Principal: ' + (principales || 'ninguno') + '. Respaldo: ' + (resp || 'ninguno') + '. Hay una tabla con el mismo detalle debajo.');
  return s;
}

// ---------------------------------------------------------------------------------------------
// Puestos de trabajo (D-047): puesto → boca de pared → puerto de switch, y equipos de escritorio
// ---------------------------------------------------------------------------------------------

let pTexto = '';
let pUbic = '';
let pChip = '';

/** @param {import('../assets/js/red.js').Contexto} ctx @param {any[]} ubicaciones */
async function tabPuestos(ctx, ubicaciones) {
  const [puestos, equipos, puertos, pers] = await Promise.all([repositorio.listar('puestos', { organizacion_id: ctx.org }), repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('puertos'), cargarPersonas(ctx)]);
  const vlanPu = new Map();
  for (const pu of puestos) vlanPu.set(pu.id, await repositorio.vlanDePuesto(pu.id));
  const mapaEq = new Map(equipos.map(e => [e.id, e]));
  const mapaPt = new Map(puertos.map(p => [p.id, p]));
  const mapaUb = new Map(ubicaciones.map(x => [x.id, x]));
  const mapaPu = new Map(puestos.map(p => [p.id, p]));
  const categoria = (/** @type {any} */ e) => (e.equipo_tipo === 'otro' && e.equipo_campos && e.equipo_campos.otro_categoria) || ROTULO_EQUIPO_TIPO[e.equipo_tipo] || 'Equipo';

  const filas = puestos.map(pu => {
    const eqs = equipos.filter(e => e.puesto_id === pu.id).sort((a, b) => a.equipo_nombre.localeCompare(b.equipo_nombre, 'es', { numeric: true }));
    /** @type {Array<{texto: string, hash: string}>} */
    const sw = [];
    for (const b of puertos.filter(p => p.puesto_id === pu.id)) {
      const f = b.conectado_a_puerto_id ? mapaPt.get(b.conectado_a_puerto_id) : null;
      const s = f ? mapaEq.get(f.equipo_id) : null;
      if (f && s) sw.push({ texto: s.equipo_nombre + ' · ' + f.puerto_numero, hash: '#/equipo/' + s.id + '/puertos/' + f.puerto_numero });
    }
    const ub = mapaUb.get(pu.ubicacion_id);
    return { pu, eqs, sw, ubicacion: ub ? ub.ubicacion_nombre : '—', gente: pers.porPuesto.get(pu.id) || [], vlan: vlanPu.get(pu.id) || null };
  }).sort((a, b) => a.pu.puesto_nombre.localeCompare(b.pu.puesto_nombre, 'es', { numeric: true }));

  const raiz = h('div');
  const cont = h('div');
  raiz.appendChild(cont);

  const nuevo = ctx.modifica ? h('button', { type: 'button', class: 'primario', text: 'Nuevo puesto', onclick: () => abrirNuevoPuesto(ctx, ubicaciones) }) : null;
  function pintar() {
    cont.textContent = '';
    cont.appendChild(vistaPuestos());
  }

  function vistaPuestos() {
    const r = h('div');
    const chipsCont = h('div'), tb = h('div'), cuenta = h('div', { class: 'mut', style: 'margin-top:6px', role: 'status' });
    const pintarTabla = () => {
      tb.textContent = ''; chipsCont.textContent = '';
      const q = normalizar(pTexto);
      const base = filas.filter(f => (!pUbic || f.pu.ubicacion_id === pUbic)
        && (!q || normalizar([f.pu.puesto_nombre, f.pu.puesto_boca_pared, f.eqs.map(e => e.equipo_nombre + ' ' + categoria(e)).join(' '), f.sw.map(s => s.texto).join(' '), f.gente.map((/** @type {any} */ x) => x.persona_nombre).join(' '), f.eqs.map(e => e.equipo_ip_gestion || '').join(' '), f.vlan ? f.vlan.vlan_numero + ' ' + f.vlan.vlan_nombre : ''].join(' ')).includes(q)));
      /** @type {Object<string, (f: any) => boolean>} */
      const pred = { con: f => f.eqs.length > 0, sin: f => f.eqs.length === 0, sinsw: f => f.sw.length === 0 };
      chipsCont.appendChild(chipsEstado([['con', 'Con equipo'], ['sin', 'Sin equipo'], ['sinsw', 'Sin conexión a switch']], c => base.filter(pred[c]).length, base.length, pChip, v => { pChip = v; pintarTabla(); }));
      const f = base.filter(x => !pChip || pred[pChip](x));
      if (f.length) {
        tb.appendChild(tabla(['Puesto', 'Ubicación', 'Persona', 'Equipos (IP)', 'Llega al switch', 'VLAN', 'Verificado'],
          f.map(x => [h('span', null, [enlaceFila('#/puesto/' + x.pu.id, x.pu.puesto_nombre), x.pu.puesto_boca_pared ? h('div', { class: 'mut', text: 'Boca ' + x.pu.puesto_boca_pared }) : null]), x.ubicacion,
            !pers.ver ? h('span', { class: 'mut', text: '—' }) : x.gente.length ? h('span', { class: 'rd-lista-etq' }, x.gente.map(g => enlaceFila('#/persona/' + g.id, g.persona_nombre))) : h('span', { class: 'mut', text: 'Sin persona' }),
            x.eqs.length ? h('div', null, x.eqs.map(e => h('div', null, [enlaceFila(hashEquipo(e), e.equipo_nombre), ' (' + categoria(e) + ')', h('div', { class: 'mut', text: e.equipo_ip_gestion || 'Sin IP' })]))) : h('span', { class: 'mut', text: 'Sin equipo' }),
            x.sw.length ? h('span', { class: 'rd-lista-etq' }, x.sw.map(s => enlaceFila(s.hash, s.texto))) : h('span', { class: 'mut', text: 'Sin conexión' }),
            x.vlan ? h('span', { text: x.vlan.vlan_numero + ' · ' + x.vlan.vlan_nombre }) : h('span', { class: 'mut', text: '—' }),
            indicadorVerificacion(x.pu.verificado_en, ctx.umbrales, true)]),
          { tipo: 'puesto', onFila: (_, i) => ir('#/puesto/' + f[i].pu.id) }));
      } else {
        tb.appendChild(h('div', { class: 'aviso' }, [filas.length ? 'Ningún puesto coincide con el filtro.' : 'Todavía no hay puestos de trabajo cargados en esta organización. Un puesto es el lugar donde llega una boca de pared; ahí se asocian la PC, la impresora o el reloj.' + (ctx.modifica ? ' Usá «Nuevo puesto» para cargar el primero.' : '')]));
      }
      cuenta.textContent = f.length + ' de ' + filas.length + ' puestos. Tocá uno para abrir su ficha.';
      cuenta.appendChild(document.createTextNode(' Las PC y notebooks están en ')); cuenta.appendChild(enlaceFila('#/escritorio', 'Equipos de escritorio')); cuenta.appendChild(document.createTextNode('.'));
    };
    const inp = h('input', { placeholder: 'Filtrar por puesto, boca, equipo o switch…', 'aria-label': 'Filtrar puestos', value: pTexto, style: 'width:300px' });
    inp.addEventListener('input', () => { pTexto = /** @type {HTMLInputElement} */ (inp).value; pintarTabla(); });
    const sel = h('select', { 'aria-label': 'Ubicación' }, [h('option', { value: '', text: 'Todas las ubicaciones' })].concat(ubicaciones.slice().sort((a, b) => a.ubicacion_nombre.localeCompare(b.ubicacion_nombre, 'es', { numeric: true })).map(u => h('option', { value: u.id, text: u.ubicacion_nombre }))));
    /** @type {HTMLSelectElement} */ (sel).value = pUbic;
    sel.addEventListener('change', () => { pUbic = /** @type {HTMLSelectElement} */ (sel).value; pintarTabla(); });
    r.appendChild(h('div', { class: 'herr' }, [inp, sel, h('span', { style: 'flex:1' }), nuevo]));
    r.appendChild(chipsCont); r.appendChild(tb); r.appendChild(cuenta);
    pintarTabla();
    return r;
  }

  pintar();
  return raiz;
}

/** @param {import('../assets/js/red.js').Contexto} ctx @param {any[]} ubicaciones */
function abrirNuevoPuesto(ctx, ubicaciones) {
  const nombre = h('input', { id: 'npNombre', type: 'text', placeholder: 'Ej.: Puesto 15 · Administración', style: 'width:100%', 'aria-label': 'Nombre del puesto' });
  const ub = h('select', { id: 'npUb', 'aria-label': 'Ubicación', style: 'width:100%' }, [h('option', { value: '', text: '— elegir —' })].concat(ubicaciones.slice().sort((a, b) => a.ubicacion_nombre.localeCompare(b.ubicacion_nombre, 'es', { numeric: true })).map(u => h('option', { value: u.id, text: u.ubicacion_nombre }))));
  const boca = h('input', { id: 'npBoca', type: 'text', placeholder: 'Ej.: B-015 (opcional)', style: 'width:100%', 'aria-label': 'Boca de pared' });
  const err = h('div', { class: 'rd-err', role: 'alert' });
  const crear = async () => {
    const n = /** @type {HTMLInputElement} */ (nombre).value.trim();
    const u = /** @type {HTMLSelectElement} */ (ub).value;
    if (!n) { err.textContent = 'Escribí el nombre del puesto.'; return; }
    if (!u) { err.textContent = 'Elegí la ubicación del puesto.'; return; }
    try {
      const p = await crearPuesto(ctx, n, u, /** @type {HTMLInputElement} */ (boca).value.trim());
      cerrarModal();
      toast('Puesto «' + n + '» creado.');
      ir('#/puesto/' + p.id);
    } catch (x) { err.textContent = x instanceof Error ? x.message : 'No se pudo crear el puesto.'; }
  };
  nombre.addEventListener('keydown', ev => { if (/** @type {KeyboardEvent} */ (ev).key === 'Enter') crear(); });
  abrirModal(h('div', { style: 'padding:18px 20px;width:420px', role: 'dialog', 'aria-label': 'Nuevo puesto' }, [
    h('h2', { text: 'Nuevo puesto de trabajo' }),
    h('p', { class: 'mut', text: 'Un puesto es el lugar donde llega una boca de pared. La ubicación es obligatoria; el resto lo completás en la ficha.' }),
    h('label', { for: 'npNombre', text: 'Nombre', class: 'mut' }), nombre,
    h('label', { for: 'npUb', text: 'Ubicación', class: 'mut', style: 'display:block;margin-top:8px' }), ub,
    h('label', { for: 'npBoca', text: 'Boca de pared', class: 'mut', style: 'display:block;margin-top:8px' }), boca, err,
    h('div', { class: 'herr', style: 'justify-content:flex-end;margin-top:12px' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }), h('button', { type: 'button', class: 'primario', text: 'Crear y abrir la ficha', onclick: crear })])]));
  nombre.focus();
}
