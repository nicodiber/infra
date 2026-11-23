// @ts-check
/** P14 · Solicitudes: Para aprobar, Mis solicitudes y Permisos vigentes para ver contraseñas (D-029, PE10, PE12, PE13). */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import * as solicitudes from '../assets/js/solicitudes.js';
import { puedeQuitarAprobacion } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, icono, tabla, ahoraISO, fmtFecha, fmtFechaHora } from '../assets/js/utiles.js';
import { COLECCION_DE_ENTIDAD, ROTULO_PERFIL, ROTULO_CREDENCIAL_TIPO } from '../assets/js/modelos.js';

/** @typedef {import('../assets/js/solicitudes.js').SolicitudDetallada} SolicitudDetallada */

/** Crea una sola vez los estilos propios de esta pantalla. */
function estilos() {
  if (document.getElementById('estilos-solicitudes')) return;
  const s = document.createElement('style');
  s.id = 'estilos-solicitudes';
  s.textContent = '.sol-pill{display:inline-flex;align-items:center;gap:5px;padding:1px 9px 1px 6px;border-radius:12px;border:1px solid var(--borde-fuerte);font-size:12.5px;font-weight:600;white-space:nowrap}'
    + '.sol-pill .ico{width:14px;height:14px}.sol-ok{background:var(--ok-bg);color:var(--ok-fg);border-color:var(--ok)}.sol-pend{background:var(--warn-bg);color:var(--warn-fg);border-color:var(--warn-borde)}'
    + '.sol-mal{background:var(--bad-bg);color:var(--bad-fg);border-color:var(--bad-borde)}.sol-nada{background:var(--nunca-bg);color:var(--nunca-fg);border-style:dashed}'
    + '.sol-tarjeta{border-top:1px solid var(--borde);padding:8px 0;display:flex;align-items:center;gap:6px 16px;flex-wrap:wrap}.sol-tarjeta:first-child{border-top:0}'
    + '.sol-info{flex:1;min-width:260px}.sol-acc{display:flex;gap:8px;align-items:center;flex-wrap:wrap}';
  document.head.appendChild(s);
}

/** @param {string} coleccion @param {any} r */
function nombreRegistro(coleccion, r) {
  if (!r) return 'un registro';
  switch (coleccion) {
    case 'equipos': return r.equipo_nombre;
    case 'credenciales': return r.credencial_nombre;
    case 'puestos': return r.puesto_nombre;
    case 'racks': return r.rack_nombre;
    case 'configuraciones': return r.configuracion_titulo;
    case 'vlans': return 'VLAN ' + r.vlan_numero + ' · ' + r.vlan_nombre;
    case 'redes_wifi': return 'Wi-Fi ' + r.wifi_ssid;
    case 'enlaces_isp': return 'Enlace ' + r.enlace_proveedor;
    case 'ubicaciones': return r.ubicacion_nombre;
    default: return r.id;
  }
}

/** @param {string} coleccion @param {any} r */
function enlaceRegistro(coleccion, r) {
  if (!r) return null;
  switch (coleccion) {
    case 'equipos': return (r.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + r.id;
    case 'credenciales': return '#/credencial/' + r.id;
    case 'puestos': return '#/puesto/' + r.id;
    case 'racks': return '#/rack/' + r.id;
    case 'configuraciones': return '#/config/' + r.id;
    case 'vlans': return '#/vlan/' + r.id;
    case 'redes_wifi': return '#/wifi/' + r.id;
    default: return null;
  }
}

/** @param {string} texto @param {string} clase @param {string} ic */
const pill = (texto, clase, ic) => h('span', { class: 'sol-pill ' + clase }, [icono(ic), texto]);

/**
 * Qué se pidió, con enlace a la ficha. Para una baja usa el registro (que puede estar ya en baja).
 * @param {SolicitudDetallada} d
 */
async function describirPedido(d) {
  const s = d.solicitud;
  if (s.solicitud_tipo === 'ver_secreto') {
    const c = d.credencial;
    return { texto: 'ver la contraseña de «' + (c ? c.credencial_nombre : 'una credencial') + '»' + (c ? ' (' + (ROTULO_CREDENCIAL_TIPO[c.credencial_tipo] || c.credencial_tipo) + ')' : ''), hash: c ? '#/credencial/' + c.id : null, registro: null };
  }
  const col = COLECCION_DE_ENTIDAD[s.solicitud_entidad];
  const r = col ? await repositorio.obtener(col, s.solicitud_entidad_id, { incluirBajas: true }) : null;
  return { texto: 'dar de baja ' + s.solicitud_entidad.toLowerCase() + ' «' + nombreRegistro(col, r) + '»', hash: enlaceRegistro(col, r), registro: r ? { col, r } : null };
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  estilos();
  const u = sesion.usuarioActual();
  const base = await migasRaiz();
  if (!u) return;
  const esSA = u.usuario_perfil === 'superadmin';
  const [usuarios, orgs] = await Promise.all([repositorio.listar('usuarios', null, { incluirBajas: true }), repositorio.listar('organizaciones')]);
  const nombre = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
  const rol = new Map(usuarios.map(x => [x.id, x.usuario_perfil]));

  const pend = await solicitudes.paraAprobar(u, null);
  const mias = esSA ? [] : await solicitudes.mias(u);
  const vigentes = await vigentesQuitables(u, usuarios);

  /** @type {Array<[string, string, string]>} clave, hash, texto */
  const tabs = [];
  if (u.usuario_perfil !== 'operario') tabs.push(['para-aprobar', 'para-aprobar', 'Para aprobar (' + pend.length + ')']);
  if (!esSA) tabs.push(['mias', 'mias', 'Mis solicitudes (' + mias.length + ')']);
  tabs.push(['vigentes', 'vigentes', 'Permisos vigentes (' + vigentes.length + ')']);
  const pedida = location.hash.replace(/^#\/?/, '').split('/')[1];
  const tab = (tabs.find(t => t[0] === pedida) || tabs[0])[0];

  pantalla(contenedor, { codigo: 'P14', nombre: 'Solicitudes', migas: base.concat([['Solicitudes', '#/solicitudes'], [tabs.find(t => t[0] === tab)?.[2].replace(/ \(\d+\)/, '') || 'Solicitudes']]) });
  contenedor.appendChild(h('h1', { text: 'Solicitudes' }));
  contenedor.appendChild(h('div', { class: 'pestanas', role: 'tablist' }, tabs.map(t => h('button', { type: 'button', role: 'tab', class: t[0] === tab ? 'sel' : '', 'aria-selected': t[0] === tab ? 'true' : 'false', text: t[2], onclick: () => ir('#/solicitudes/' + t[1]) }))));
  const recargar = () => ir(location.hash);

  if (tab === 'para-aprobar') {
    const caja = h('div', { class: 'bloque' });
    if (!pend.length) caja.appendChild(h('div', { class: 'mut', text: 'No hay solicitudes para aprobar. Cuando alguien pida ver una contraseña o dar de baja un registro, aparece acá.' }));
    for (const d of pend) caja.appendChild(await tarjeta(d, u, nombre, rol, esSA, recargar));
    contenedor.appendChild(caja);
  } else if (tab === 'mias') {
    if (!mias.length) { contenedor.appendChild(h('div', { class: 'aviso', text: 'Todavía no hiciste ninguna solicitud. Para ver una contraseña, pedila desde la ficha de la credencial.' })); return; }
    const filas = [];
    for (const d of mias) {
      const p = await describirPedido(d);
      const s = d.solicitud;
      filas.push([fmtFecha(s.solicitado_en), h('span', null, [p.hash ? h('a', { href: p.hash, text: p.texto }) : p.texto]), s.solicitud_motivo || '—', estado(s), resolvio(s, nombre)]);
    }
    contenedor.appendChild(tabla(['Fecha', 'Qué pediste', 'Motivo', 'Estado', 'Resolvió'], filas));
  } else {
    if (!vigentes.length) { contenedor.appendChild(h('div', { class: 'aviso', text: 'No hay permisos vigentes para ver contraseñas.' })); return; }
    const filas = vigentes.map(v => {
      const s = v.solicitud, c = v.credencial;
      const alcance = s.solicitud_alcance === 'tipo_credencial' && c ? 'Todas las ' + (ROTULO_CREDENCIAL_TIPO[c.credencial_tipo] || c.credencial_tipo) : 'Solo «' + (c ? c.credencial_nombre : '') + '»';
      const orgN = (orgs.find(o => o.id === s.organizacion_id) || { organizacion_nombre: '' }).organizacion_nombre;
      return [(nombre.get(s.solicitado_por) || '—') + ' (' + ROTULO_PERFIL[rol.get(s.solicitado_por) || 'operario'] + ')'].concat(esSA ? [orgN] : [], [alcance, nombre.get(s.resuelto_por || '') || '—', fmtFecha(s.resuelto_en),
        v.quitable ? h('button', { class: 'chico', text: 'Quitar', 'aria-label': 'Quitar el permiso de ' + (nombre.get(s.solicitado_por) || ''), onclick: async () => {
          try { await repositorio.quitarAprobacion(s.id, u.id); toast('Permiso quitado'); recargar(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar'); } } }) : 'Es tuyo']);
    });
    contenedor.appendChild(tabla(['Usuario'].concat(esSA ? ['Organización'] : [], ['Alcance', 'Aprobó', 'Desde', '']), filas));
    contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Un permiso vale hasta que lo quita un usuario de rol superior al que lo tiene.' }));
  }
}

/**
 * Aprobaciones activas que el usuario puede quitar (más las propias, solo informativas).
 * @param {import('../assets/js/modelos.js').UsuarioSesion} u @param {any[]} usuarios
 */
async function vigentesQuitables(u, usuarios) {
  const lista = await repositorio.listar('solicitudes', s => s.solicitud_tipo === 'ver_secreto' && s.solicitud_estado === 'aprobada' && !s.solicitud_revocada_en);
  const det = await solicitudes.detallar(lista);
  const salida = [];
  for (const d of det) {
    const titular = usuarios.find(x => x.id === d.solicitud.solicitado_por);
    if (!titular) continue;
    const quitable = titular.id !== u.id && puedeQuitarAprobacion(u, titular);
    if (quitable || titular.id === u.id) salida.push({ solicitud: d.solicitud, credencial: d.credencial, quitable });
  }
  return salida.sort((a, b) => ((a.solicitud.resuelto_en || '') < (b.solicitud.resuelto_en || '') ? 1 : -1));
}

/** @param {import('../assets/js/modelos.js').Solicitud} s */
function estado(s) {
  if (s.solicitud_estado === 'pendiente') return pill('Pendiente', 'sol-pend', 'reloj');
  if (s.solicitud_estado === 'rechazada') return pill('Rechazada', 'sol-mal', 'alerta');
  if (s.solicitud_estado === 'vencida') return pill('Vencida', 'sol-nada', 'reloj');
  if (s.solicitud_revocada_en) return pill('Aprobada · permiso quitado', 'sol-nada', 'check');
  const alc = s.solicitud_tipo === 'ver_secreto' ? (s.solicitud_alcance === 'tipo_credencial' ? ' · todas las del tipo' : ' · solo esa credencial') : '';
  return pill('Aprobada' + alc, 'sol-ok', 'check');
}

/** @param {import('../assets/js/modelos.js').Solicitud} s @param {Map<string, string>} nombre */
function resolvio(s, nombre) {
  if (!s.resuelto_por) return '—';
  let t = (nombre.get(s.resuelto_por) || '—') + ' · ' + fmtFechaHora(s.resuelto_en);
  if (s.solicitud_revocada_en) t += ' · quitado el ' + fmtFecha(s.solicitud_revocada_en) + ' por ' + (nombre.get(s.solicitud_revocada_por || '') || '—');
  return t;
}

/**
 * Tarjeta de una solicitud pendiente, con Aprobar (eligiendo alcance o confirmando la baja) y Rechazar.
 * @param {SolicitudDetallada} d @param {import('../assets/js/modelos.js').UsuarioSesion} u @param {Map<string, string>} nombre
 * @param {Map<string, string>} rol @param {boolean} esSA @param {() => void} recargar
 */
async function tarjeta(d, u, nombre, rol, esSA, recargar) {
  const s = d.solicitud;
  const p = await describirPedido(d);
  const esBaja = s.solicitud_tipo === 'baja_registro';
  const quien = (nombre.get(s.solicitado_por) || '—') + ' (' + ROTULO_PERFIL[rol.get(s.solicitado_por) || 'operario'] + ')';
  const zona = h('div', { class: 'sol-acc' });
  const info = h('div', { class: 'sol-info' }, [
    h('div', null, [quien + ' pide ', p.hash ? h('a', { href: p.hash, text: p.texto }) : p.texto, esSA && d.organizacion_nombre ? ' · ' + d.organizacion_nombre : '']),
    h('div', { class: 'mut', style: 'font-size:.9em', text: 'Motivo: ' + (s.solicitud_motivo || '—') + ' · ' + fmtFechaHora(s.solicitado_en) })]);
  /** @param {() => Promise<void>} fn @param {string} ok */
  const ejecutar = async (fn, ok) => { try { await fn(); toast(ok); recargar(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo resolver'); } };
  const rechazar = h('button', { class: 'chico', text: 'Rechazar', 'aria-label': 'Rechazar el pedido de ' + (nombre.get(s.solicitado_por) || ''), onclick: () => ejecutar(async () => { await repositorio.resolverSolicitud(s.id, 'rechazada', u.id); }, 'Solicitud rechazada') });
  const botones = () => {
    zona.textContent = '';
    zona.appendChild(h('button', { class: 'chico primario', text: 'Aprobar', 'aria-label': 'Aprobar el pedido de ' + (nombre.get(s.solicitado_por) || ''), onclick: elegir }));
    zona.appendChild(rechazar);
  };
  const elegir = () => {
    zona.textContent = '';
    if (esBaja) {
      zona.appendChild(h('span', { text: 'Se da de baja el registro (queda en el historial).' }));
      zona.appendChild(h('button', { class: 'chico primario', text: 'Confirmar baja', onclick: () => ejecutar(async () => {
        await repositorio.resolverSolicitud(s.id, 'aprobada', u.id, null);
      }, 'Baja aprobada y aplicada') }));
    } else {
      const tipoR = d.credencial ? (ROTULO_CREDENCIAL_TIPO[d.credencial.credencial_tipo] || d.credencial.credencial_tipo) : 'del mismo tipo';
      const r1 = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'alc' + s.id, checked: 'checked' }));
      const r2 = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'alc' + s.id }));
      zona.appendChild(h('label', null, [r1, ' Solo esta credencial']));
      zona.appendChild(h('label', null, [r2, ' Todas las ' + tipoR]));
      zona.appendChild(h('button', { class: 'chico primario', text: 'Confirmar', onclick: () => ejecutar(async () => { await repositorio.resolverSolicitud(s.id, 'aprobada', u.id, r2.checked ? 'tipo_credencial' : 'credencial'); }, 'Solicitud aprobada') }));
    }
    zona.appendChild(h('button', { class: 'chico', text: 'Cancelar', onclick: botones }));
  };
  botones();
  return h('div', { class: 'sol-tarjeta' }, [info, zona]);
}
