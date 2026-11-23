// @ts-check
/**
 * P11 · Ficha de VLAN. Ruta: `#/vlan/<id>`.
 * Datos de la VLAN y dibujo de los switches de la organización con los puertos que están en ella resaltados
 * (como nativa o etiquetada), con alternativa en tabla.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, toast } from '../assets/js/marco.js';
import { h, tabla, ahoraISO, fmtFecha, normalizar } from '../assets/js/utiles.js';
import { inyectarEstilos, cargarContexto, leerRuta, encabezado, campo, avisoVista, formulario, fichaCab, textoUltimoCambio, seguro, enlace, pestanas, calcularIpsDeVlan, numeroAIp, hashEquipo, ROTULO_SEGURIDAD } from '../assets/js/red.js';

/** @type {import('../assets/js/red.js').Campo[]} */
const CAMPOS = [
  { k: 'vlan_numero', r: 'Número (1 a 4094)', t: 'entero', req: true }, { k: 'vlan_nombre', r: 'Nombre', t: 'texto', req: true }, { k: 'vlan_red_cidr', r: 'Red (CIDR)', t: 'texto' },
  { k: 'vlan_gateway', r: 'Gateway', t: 'texto' }, { k: 'vlan_dhcp_activo', r: 'DHCP activo', t: 'bool', req: true }, { k: 'vlan_dhcp_rango', r: 'Rango DHCP', t: 'texto' }, { k: 'vlan_descripcion', r: 'Uso', t: 'largo' }
];

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  inyectarEstilos();
  const ctx = await cargarContexto();
  const id = leerRuta().partes[0];
  const vlan = id ? await repositorio.obtener('vlans', id) : null;
  await encabezado(contenedor, 'P11', 'Ficha de VLAN', [['Red', '#/red/equipos'], ['VLAN', '#/red/vlan'], [vlan ? 'VLAN ' + vlan.vlan_numero + ' · ' + vlan.vlan_nombre : 'VLAN']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso al módulo Red.'); return; }
  if (!vlan || vlan.organizacion_id !== ctx.org) { avisoVista(contenedor, 'No encontramos esa VLAN en esta organización.'); return; }
  let editando = false;
  const armar = async () => {
    while (contenedor.children.length > 2) contenedor.removeChild(/** @type {Node} */ (contenedor.lastChild));
    const v = await repositorio.obtener('vlans', id);
    if (v) await dibujar(contenedor, ctx, v, editando, async x => { editando = x; await armar(); });
  };
  await dibujar(contenedor, ctx, vlan, editando, async x => { editando = x; await armar(); });
}

/** @param {HTMLElement} cont @param {import('../assets/js/red.js').Contexto} ctx @param {any} v @param {boolean} editando @param {(x: boolean) => Promise<void>} cambiar */
async function dibujar(cont, ctx, v, editando, cambiar) {
  /** @type {HTMLElement} */
  let datos;
  /** @type {(() => {valores: Object<string, any>, errores: string[]})|null} */
  let leer = null;
  const err = h('div', { class: 'rd-err', role: 'alert' });
  if (editando) {
    const f = formulario(CAMPOS, v);
    datos = h('div', { class: 'rd-edicion' }, [f.nodo, err]); leer = f.leer;
  } else {
    datos = h('div', { class: 'datos' }, [campo('VLAN', String(v.vlan_numero)), campo('Nombre', v.vlan_nombre), campo('Red', v.vlan_red_cidr), campo('Gateway', v.vlan_gateway),
      campo('DHCP', v.vlan_dhcp_activo ? 'Sí' + (v.vlan_dhcp_rango ? ' · ' + v.vlan_dhcp_rango : '') : 'No (IP fija)'), campo('Uso', v.vlan_descripcion)]);
  }
  const botones = /** @type {Node[]} */ ([]);
  if (editando) {
    botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
      const r = /** @type {Function} */ (leer)();
      const errores = /** @type {string[]} */ (r.errores);
      const n = r.valores.vlan_numero;
      if (n != null && (n < 1 || n > 4094)) errores.push('El número de VLAN va de 1 a 4094.');
      if (r.valores.vlan_dhcp_activo && !r.valores.vlan_dhcp_rango) errores.push('Si el DHCP está activo, indicá el rango.');
      if (n != null && (await repositorio.listar('vlans', x => x.organizacion_id === ctx.org && x.id !== v.id && x.vlan_numero === n)).length) errores.push('Ya existe la VLAN ' + n + ' en esta organización.');
      if (errores.length) { err.textContent = errores.join(' '); return; }
      if (!(await seguro(() => repositorio.guardar('vlans', { ...v, ...r.valores }, ctx.u.id)))) return;
      toast('Cambios guardados · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); await cambiar(false);
    } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cambiar(false) }));
  } else if (ctx.modifica) botones.push(h('button', { type: 'button', text: 'Editar', onclick: () => cambiar(true) }));
  cont.appendChild(fichaCab({ ctx, tipo: 'vlan', etiqueta: 'vlan', titulo: 'VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre, datos, botones, editando, registro: v, coleccion: 'vlans',
    ultimoCambio: await textoUltimoCambio(ctx, 'Vlan', v), alConfirmar: () => cambiar(editando) }));
  if (editando) return;

  const tab = ['ip', 'relaciones', 'archivos'].includes(leerRuta().partes[1]) ? leerRuta().partes[1] : 'puertos';
  const barra = pestanas([['puertos', 'Puertos y Wi-Fi'], ['ip', 'Direcciones IP'], ['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']], tab, k => '#/vlan/' + v.id + (k === 'puertos' ? '' : '/' + k));
  barra.style.margin = '8px 0 8px';
  cont.appendChild(barra);
  if (tab === 'ip') { cont.appendChild(await cuerpoIp(ctx, v)); return; }
  if (tab === 'relaciones' || tab === 'archivos') {
    const zona = h('div'); cont.appendChild(zona);
    if (tab === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'Vlan', entidadId: v.id, organizacionId: ctx.org });
    else await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'Vlan', entidadId: v.id, organizacionId: ctx.org });
    return;
  }

  // ---- switches con sus puertos en la VLAN
  const [switches, puertos, wifis] = await Promise.all([repositorio.listar('equipos', { organizacion_id: ctx.org, equipo_tipo: 'switch' }), repositorio.listar('puertos'), repositorio.listar('redes_wifi', { organizacion_id: ctx.org, vlan_id: v.id })]);
  const items = switches.map(sw => {
    const ps = puertos.filter(p => p.equipo_id === sw.id);
    const ec = sw.equipo_campos || {};
    const total = Math.max((Number(ec.switch_puertos_total) || 0) + (Number(ec.switch_puertos_sfp) || 0), ...ps.map(p => p.puerto_numero), 0);
    const en = new Set(ps.filter(p => p.vlan_nativa_id === v.id || (p.vlans_etiquetadas || []).includes(v.id)).map(p => p.puerto_numero));
    return { sw, total, en };
  }).filter(x => x.total).sort((a, b) => b.en.size - a.en.size || a.sw.equipo_nombre.localeCompare(b.sw.equipo_nombre, 'es', { numeric: true }));
  const bloque = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('h3', { text: 'Puertos de los switches en esta VLAN' })]);
  if (!items.length) bloque.appendChild(h('div', { class: 'mut', text: 'Esta organización no tiene switches con puertos cargados.' }));
  const filasTabla = /** @type {Array<Array<Node|string>>} */ ([]);
  for (const { sw, total, en } of items) {
    const lista = Array.from(en).sort((a, b) => a - b);
    const desc = sw.equipo_nombre + ': ' + en.size + ' de ' + total + ' puertos en la VLAN';
    bloque.appendChild(h('div', null, [enlace(sw.equipo_nombre, '#/equipo/' + sw.id + '/puertos'), h('span', { class: 'mut', text: '  ·  ' + en.size + ' de ' + total + ' puertos en la VLAN' }),
      h('div', { class: 'minisw', role: 'img', 'aria-label': desc }, Array.from({ length: total }, (_, i) => h('i', { class: en.has(i + 1) ? 'on' : '', title: 'Puerto ' + (i + 1) + (en.has(i + 1) ? ' (en la VLAN)' : '') })))]));
    filasTabla.push([sw.equipo_nombre, String(en.size) + ' de ' + total, rangos(lista)]);
  }
  if (items.length) {
    bloque.appendChild(h('div', { class: 'leyenda' }, [h('span', null, [h('i', { class: 'l-on' }), 'Puerto en la VLAN (nativa o etiquetada)']), h('span', null, [h('i', { style: 'background:var(--surf)' }), 'Otro puerto'])]));
    const det = h('details', { style: 'margin-top:8px' }, [h('summary', { text: 'Ver como tabla' }), tabla(['Switch', 'Puertos en la VLAN', 'Cuáles'], filasTabla, { clase: 'chica', tipo: 'equipo', onFila: (_, i) => ir('#/equipo/' + items[i].sw.id + '/puertos') })]);
    bloque.appendChild(det);
  }
  cont.appendChild(bloque);

  const w = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('h3', { text: 'Redes Wi-Fi en esta VLAN' })]);
  if (!wifis.length) w.appendChild(h('div', { class: 'mut', text: 'Ninguna red Wi-Fi cae en esta VLAN.' }));
  else w.appendChild(tabla(['SSID', 'Seguridad', 'Access points'], wifis.map(x => [x.wifi_ssid, ROTULO_SEGURIDAD[x.wifi_seguridad] || x.wifi_seguridad, String((x.access_point_ids || []).length)]), { tipo: 'wifi', onFila: (_, i) => ir('#/wifi/' + wifis[i].id) }));
  cont.appendChild(w);
  void normalizar;
}

/** «1–8, 10, 49–52». @param {number[]} nums */
function rangos(nums) {
  if (!nums.length) return '—';
  /** @type {string[]} */
  const out = [];
  let ini = nums[0], prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) { prev = n; continue; }
    out.push(ini === prev ? String(ini) : ini + '–' + prev);
    ini = n; prev = n;
  }
  return out.join(', ');
}

/**
 * Pestaña «Direcciones IP» (IC11): total, usadas, libres y duplicadas, grilla de la subred y tabla de usadas.
 * @param {import('../assets/js/red.js').Contexto} ctx @param {any} v
 */
async function cuerpoIp(ctx, v) {
  const equipos = await repositorio.listar('equipos', { organizacion_id: ctx.org });
  const r = calcularIpsDeVlan(v, equipos);
  if (!r.valida) return h('div', { class: 'aviso' }, ['Esta VLAN no tiene una red válida cargada' + (r.cidr ? ' («' + r.cidr + '»)' : '') + '. Editá la VLAN e indicá la red en formato CIDR, por ejemplo 10.10.10.0/24.']);
  const caja = h('div', { class: 'bloque' });
  const nGw = r.gw != null && r.gw >= r.base && r.gw < r.base + Math.pow(2, 32 - r.prefijo) ? 1 : 0;
  const res = (/** @type {string} */ t, /** @type {number|string} */ n, /** @type {string} */ extra) => h('div', null, [h('b', { text: String(n) }), h('div', { class: 'mut', text: t + (extra ? ' · ' + extra : '') })]);
  caja.appendChild(h('div', { class: 'mut', text: 'Rango ' + r.cidr + ' · ' + r.total + ' direcciones utilizables' + (v.vlan_gateway ? ' · gateway ' + v.vlan_gateway : '') + (v.vlan_dhcp_activo && v.vlan_dhcp_rango ? ' · DHCP ' + v.vlan_dhcp_rango : '') }));
  caja.appendChild(h('div', { class: 'rd-ip-res' }, [res('Total', r.total, ''), res('Usadas', r.usadas.length, 'por equipos'), res('Libres', r.libres, r.enDhcp ? 'sin contar ' + r.enDhcp + ' de DHCP' : ''), res('Duplicadas', r.duplicadas.length, r.duplicadas.length ? 'revisar' : 'ninguna')]));
  // Siguiente IP libre
  const msj = h('span', { class: 'mut', role: 'status' });
  const sig = h('button', { type: 'button', class: 'chico', text: 'Siguiente IP libre', disabled: !r.siguienteLibre, onclick: async () => {
    try { await navigator.clipboard.writeText(r.siguienteLibre); msj.textContent = r.siguienteLibre + ' copiada.'; toast(r.siguienteLibre + ' copiada al portapapeles.'); } catch { msj.textContent = 'Siguiente IP libre: ' + r.siguienteLibre + ' (copiala a mano).'; }
    const c = caja.querySelector('[data-ip="' + r.siguienteLibre + '"]'); if (c) { caja.querySelectorAll('.destacada').forEach(x => x.classList.remove('destacada')); c.classList.add('destacada'); }
  } });
  caja.appendChild(h('div', { class: 'herr', style: 'margin:4px 0' }, [sig, r.siguienteLibre ? h('span', { class: 'mut', text: 'Primera libre: ' + r.siguienteLibre }) : h('span', { class: 'mut', text: 'No quedan IP libres.' }), msj]));
  // Grilla (solo hasta /24)
  if (r.prefijo >= 24 && r.total <= 256) {
    const celdas = [];
    for (let n = r.primero; n <= r.ultimo; n++) {
      const us = r.usos.get(n), dup = us && new Set(us.map((/** @type {any} */ x) => x.equipo.id)).size > 1;
      const ip = n % 256;
      const clase = dup ? 'dup' : us ? 'usada' : n === r.gw ? 'gw' : r.esDhcp(n) ? 'dhcp' : 'libre';
      const quien = us ? us.map((/** @type {any} */ x) => x.equipo.equipo_nombre + ' (' + x.origen + ')').join(' y ') : '';
      const texto = numeroAIp(n) + ' · ' + (dup ? 'DUPLICADA: ' + quien : us ? 'usada por ' + quien : n === r.gw ? 'gateway' : clase === 'dhcp' ? 'rango DHCP' : 'libre');
      const tag = us ? 'button' : 'span';
      celdas.push(h(tag, { class: 'rd-ip ' + clase, title: texto, 'aria-label': texto, 'data-ip': numeroAIp(n), ...(us ? { type: 'button', onclick: () => ir(hashEquipo(us[0].equipo)) } : {}) }, [String(ip)]));
    }
    caja.appendChild(h('div', { class: 'rd-ip-grilla', role: 'group', 'aria-label': 'Subred ' + r.cidr + ': una celda por dirección, número = último octeto' }, celdas));
    const li = (/** @type {string} */ c, /** @type {string} */ t) => h('span', null, [h('i', { class: 'rd-ip ' + c, style: 'display:inline-block;width:14px;height:12px;vertical-align:middle;margin-right:4px' }), t]);
    caja.appendChild(h('div', { class: 'leyenda' }, [li('usada', 'Usada (con enlace al equipo)'), li('libre', 'Libre'), li('dup', 'Duplicada (rayada)'), li('gw', 'Gateway (borde grueso)'), li('dhcp', 'Rango DHCP (borde punteado)')]));
  } else caja.appendChild(h('div', { class: 'mut', style: 'margin:6px 0', text: 'La red es más grande que una /24: se muestra solo la tabla de direcciones usadas.' }));
  // Tabla de usadas
  caja.appendChild(h('h3', { text: 'Direcciones usadas', style: 'margin-top:10px' }));
  if (!r.usadas.length) caja.appendChild(h('div', { class: 'mut', text: 'Ningún equipo tiene una IP dentro de ' + r.cidr + '.' }));
  else {
    const filas = [];
    for (const u of r.usadas) for (const x of u.usos) filas.push({ u, x });
    caja.appendChild(tabla(['IP', 'Equipo', 'Cuál IP', 'Estado'], filas.map(f => [f.u.ip, f.x.equipo.equipo_nombre, f.x.origen, r.duplicadas.includes(f.u) ? '⚠ Duplicada' : 'Única']), { clase: 'chica', tipo: 'equipo', onFila: (_, i) => ir(hashEquipo(filas[i].x.equipo)) }));
  }
  return caja;
}

