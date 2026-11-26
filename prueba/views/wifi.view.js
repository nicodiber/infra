// @ts-check
/**
 * P11 · Ficha de red Wi-Fi. Ruta: `#/wifi/<id>`.
 * SSID, VLAN, seguridad, credencial de la clave (enlace) y access points que la emiten.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, toast } from '../assets/js/marco.js';
import { duplicar, selectorConCrear, multiConCrear, opcionesDe } from '../assets/js/altas.js';
import { h, tabla, ahoraISO, fmtFecha } from '../assets/js/utiles.js';
import { ROTULO_CREDENCIAL_TIPO } from '../assets/js/modelos.js';
import { cargarContexto, leerRuta, encabezado, campo, avisoVista, fichaCab, textoUltimoCambio, seguro, enlace, estadoPill, ROTULO_SEGURIDAD, textoUbicacion } from '../assets/js/red.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const ctx = await cargarContexto();
  const id = leerRuta().partes[0];
  const wifi = id ? await repositorio.obtener('redes_wifi', id) : null;
  await encabezado(contenedor, 'P11', 'Ficha de red Wi-Fi', [['Red', '#/red/equipos'], ['Redes Wi-Fi', '#/red/wifi'], [wifi ? wifi.wifi_ssid : 'Wi-Fi']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso al módulo Red.'); return; }
  if (!wifi || wifi.organizacion_id !== ctx.org) { avisoVista(contenedor, 'No encontramos esa red Wi-Fi en esta organización.'); return; }
  let editando = false;
  const armar = async () => {
    while (contenedor.children.length > 2) contenedor.removeChild(/** @type {Node} */ (contenedor.lastChild));
    const w = await repositorio.obtener('redes_wifi', id);
    if (w) await dibujar(contenedor, ctx, w, editando, async x => { editando = x; await armar(); });
  };
  await dibujar(contenedor, ctx, wifi, editando, async x => { editando = x; await armar(); });
}

/** @param {HTMLElement} cont @param {import('../assets/js/red.js').Contexto} ctx @param {any} w @param {boolean} editando @param {(x: boolean) => Promise<void>} cambiar */
async function dibujar(cont, ctx, w, editando, cambiar) {
  const puedeCred = puede(ctx.u, 'ver', 'credenciales', ctx.org);
  const [vlans, aps, racks, ubic, creds] = await Promise.all([repositorio.listar('vlans', { organizacion_id: ctx.org }), repositorio.listar('equipos', { organizacion_id: ctx.org, equipo_tipo: 'access_point' }),
    repositorio.listar('racks', { organizacion_id: ctx.org }), repositorio.listar('ubicaciones', { organizacion_id: ctx.org }),
    puedeCred ? repositorio.listar('credenciales', { organizacion_id: ctx.org }) : Promise.resolve([])]);
  vlans.sort((a, b) => a.vlan_numero - b.vlan_numero);
  const vlan = vlans.find(x => x.id === w.vlan_id);
  const cred = creds.find(x => x.id === w.credencial_id);
  const emiten = aps.filter(a => (w.access_point_ids || []).includes(a.id));

  /** @type {HTMLElement} */
  let datos;
  /** @type {(() => string[])|null} */
  let guardarFn = null;
  const err = h('div', { class: 'rd-err', role: 'alert' });
  /** @type {Object<string, any>} */
  const ctl = {};
  if (editando) {
    const ssid = h('input', { type: 'text', 'aria-label': 'SSID' }); /** @type {HTMLInputElement} */ (ssid).value = w.wifi_ssid;
    const sv = selectorConCrear({ desde: 'redes_wifi', campo: 'vlan_id', organizacion_id: ctx.org, valor: w.vlan_id || null, etiqueta: 'VLAN', rotuloOrigen: 'Editar red Wi-Fi' });
    const ss = h('select', { 'aria-label': 'Seguridad' }, Object.keys(ROTULO_SEGURIDAD).map(k => h('option', { value: k, text: ROTULO_SEGURIDAD[k] }))); /** @type {HTMLSelectElement} */ (ss).value = w.wifi_seguridad;
    const so = h('select', { 'aria-label': 'SSID oculto' }, [h('option', { value: 'false', text: 'No' }), h('option', { value: 'true', text: 'Sí' })]); /** @type {HTMLSelectElement} */ (so).value = String(!!w.wifi_oculta);
    const sc = puedeCred ? selectorConCrear({ desde: 'redes_wifi', campo: 'credencial_id', organizacion_id: ctx.org, valor: w.credencial_id || null, etiqueta: 'Credencial de la clave', rotuloOrigen: 'Editar red Wi-Fi',
      cargarOpciones: () => opcionesDe('credenciales', ctx.org, { filtro: c => c.credencial_tipo === 'wifi' || c.id === w.credencial_id }), valoresAlta: { credencial_tipo: 'wifi' } }) : null;
    const apsSel = multiConCrear({ desde: 'redes_wifi', campo: 'access_point_ids', organizacion_id: ctx.org, valores: w.access_point_ids || [], etiqueta: 'Access points que la emiten', rotuloOrigen: 'Editar red Wi-Fi',
      vacio: 'Todavía no hay access points cargados.', valoresAlta: { equipo_tipo: 'access_point', tipos: ['access_point'] }, cargarOpciones: () => opcionesDe('equipos', ctx.org, { filtro: e => e.equipo_tipo === 'access_point' }) });
    const cm = (/** @type {string} */ t, /** @type {Node} */ c) => h('div', { class: 'campo' }, [h('label', { text: t }), c]);
    datos = h('div', { class: 'rd-edicion' }, [h('div', { class: 'datos' }, [cm('SSID *', ssid), cm('VLAN', sv), cm('Seguridad *', ss), cm('SSID oculto', so), sc ? cm('Credencial de la clave', sc) : null]),
      h('div', { class: 'campo', style: 'margin-top:8px' }, [h('label', { text: 'Access points que la emiten' }), apsSel.nodo]), err]);
    Object.assign(ctl, { ssid, sv, ss, so, sc, apsSel });
    guardarFn = () => {
      /** @type {string[]} */
      const e = [];
      if (!/** @type {HTMLInputElement} */ (ssid).value.trim()) e.push('El SSID es obligatorio.');
      return e;
    };
  } else {
    datos = h('div', { class: 'datos' }, [campo('SSID', w.wifi_ssid + (w.wifi_oculta ? ' (oculta)' : '')), campo('VLAN', vlan ? enlace(vlan.vlan_numero + ' · ' + vlan.vlan_nombre, '#/vlan/' + vlan.id) : null),
      campo('Seguridad', ROTULO_SEGURIDAD[w.wifi_seguridad] || w.wifi_seguridad),
      campo('Credencial de la clave', w.wifi_seguridad === 'abierta' ? 'No lleva clave' : cred ? enlace(cred.credencial_nombre + ' (' + (ROTULO_CREDENCIAL_TIPO[cred.credencial_tipo] || cred.credencial_tipo) + ')', '#/credencial/' + cred.id) : w.credencial_id ? (puedeCred ? '—' : 'Tu rol no ve el módulo Credenciales') : null)]);
  }
  const botones = /** @type {Node[]} */ ([]);
  if (editando) {
    botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
      const errores = /** @type {() => string[]} */ (guardarFn)();
      if (errores.length) { err.textContent = errores.join(' '); return; }
      const seg = /** @type {HTMLSelectElement} */ (ctl.ss).value;
      const reg = { ...w, wifi_ssid: ctl.ssid.value.trim(), vlan_id: ctl.sv.value || null, wifi_seguridad: seg, wifi_oculta: ctl.so.value === 'true',
        credencial_id: seg === 'abierta' ? null : ctl.sc ? ctl.sc.value || null : w.credencial_id, access_point_ids: ctl.apsSel.valores() };
      if (!(await seguro(() => repositorio.guardar('redes_wifi', reg, ctx.u.id)))) return;
      toast('Cambios guardados · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); await cambiar(false);
    } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cambiar(false) }));
  } else if (ctx.modifica) {
    botones.push(h('button', { type: 'button', text: 'Editar', onclick: () => cambiar(true) }));
    botones.push(h('button', { type: 'button', text: 'Duplicar', title: 'Crear otra red Wi-Fi con estos datos (el SSID tiene que ser distinto)', onclick: async () => {
      const c = await duplicar('redes_wifi', w, { wifi_ssid: w.wifi_ssid + ' (copia)', wifi_seguridad: w.wifi_seguridad, wifi_oculta: w.wifi_oculta, vlan_id: w.vlan_id, access_point_ids: w.access_point_ids || [] }, w.wifi_ssid);
      if (c) { toast('Red Wi-Fi «' + c.wifi_ssid + '» creada a partir de la copia.'); ir('#/wifi/' + c.id); }
    } }));
  }
  cont.appendChild(fichaCab({ ctx, tipo: 'wifi', etiqueta: 'red wi-fi', titulo: 'Wi-Fi ' + w.wifi_ssid, icono: 'wifi', datos, botones, editando, registro: w, coleccion: 'redes_wifi',
    ultimoCambio: await textoUltimoCambio(ctx, 'RedWifi', w), alConfirmar: () => cambiar(editando) }));
  if (editando) return;
  const mr = new Map(racks.map(r => [r.id, r])), mu = new Map(ubic.map(x => [x.id, x]));
  const b = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('h3', { text: 'Access points que la emiten' })]);
  if (!emiten.length) b.appendChild(h('div', { class: 'mut', text: 'Ningún access point tiene cargada esta red.' + (ctx.modifica ? ' Se indican con «Editar».' : '') }));
  else b.appendChild(tabla(['Access point', 'IP de gestión', 'Sede / sala · rack', 'Estado'], emiten.map(a => [a.equipo_nombre, a.equipo_ip_gestion || '—', textoUbicacion(a, mr, mu), estadoPill(a.equipo_estado)]), { tipo: 'equipo', onFila: (_, i) => ir('#/equipo/' + emiten[i].id) }));
  cont.appendChild(b);
}
