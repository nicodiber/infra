// @ts-check
/**
 * P03 · Inicio de la organización (tablero) y AV · aviso al ingresar (H03).
 * Indicadores reales, solicitudes pendientes, próximos vencimientos, pendientes de verificar y últimos cambios
 * con casilla «leído» por usuario (D-048). Todo se calcula con los datos cargados.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import * as solicitudes from '../assets/js/solicitudes.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, repintarMarco, toast } from '../assets/js/marco.js';
import {
  h, icono, tabla, ahoraISO, fmtFecha, fmtFechaHora, diasHasta, textoVence, indicadorVerificacion, estadoVerificacion, diasDesde
} from '../assets/js/utiles.js';
import {
  COLECCION_DE_ENTIDAD, ROTULO_CREDENCIAL_TIPO, ROTULO_SERVICIO_TIPO, ROTULO_EQUIPO_TIPO, ROTULO_PERFIL, moduloDeEntidad
} from '../assets/js/modelos.js';
import { CATEGORIAS_PUESTO } from '../assets/js/red.js';
import { confirmarConPasos } from '../assets/js/verificacion.js';

/** @typedef {import('../assets/js/modelos.js').UsuarioSesion} UsuarioSesion */
/** @typedef {import('../assets/js/modelos.js').Modulo} Modulo */

/** Colecciones cuyos elementos se verifican (D-041) y a qué módulo pertenecen (los equipos, según su tipo). */
const VERIFICABLES = ['equipos', 'credenciales', 'puestos', 'racks', 'configuraciones', 'vlans', 'redes_wifi', 'enlaces_isp'];
const TAMANO_PAGINA = 10;

/**
 * @param {string} coleccion
 * @param {any} r
 * @returns {Modulo}
 */
function moduloDe(coleccion, r) {
  switch (coleccion) {
    case 'equipos': return moduloDeEntidad('Equipo', r);
    case 'credenciales': return 'credenciales';
    case 'racks': return 'racks';
    case 'configuraciones': return 'configuraciones';
    default: return 'red';
  }
}

/** Nombre legible de un registro y la ruta a su ficha (todavía sin pantalla: ver router). @param {string} coleccion @param {any} r */
function describir(coleccion, r) {
  switch (coleccion) {
    case 'equipos': return { nombre: r.equipo_nombre, tipo: r.equipo_tipo === 'servidor' ? 'Servidor' : ROTULO_EQUIPO_TIPO[r.equipo_tipo] || 'Equipo', hash: (r.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + r.id };
    case 'credenciales': return { nombre: r.credencial_nombre, tipo: 'Credencial · ' + (ROTULO_CREDENCIAL_TIPO[r.credencial_tipo] || r.credencial_tipo), hash: '#/credencial/' + r.id };
    case 'puestos': return { nombre: r.puesto_nombre, tipo: 'Puesto', hash: '#/puesto/' + r.id };
    case 'racks': return { nombre: r.rack_nombre, tipo: 'Rack', hash: '#/rack/' + r.id };
    case 'configuraciones': return { nombre: r.configuracion_titulo, tipo: 'Configuración', hash: '#/config/' + r.id };
    case 'vlans': return { nombre: 'VLAN ' + r.vlan_numero + ' · ' + r.vlan_nombre, tipo: 'VLAN', hash: '#/vlan/' + r.id };
    case 'redes_wifi': return { nombre: 'Wi-Fi ' + r.wifi_ssid, tipo: 'Red Wi-Fi', hash: '#/wifi/' + r.id };
    case 'enlaces_isp': return { nombre: 'Enlace ' + r.enlace_proveedor, tipo: 'Enlace ISP', hash: '#/red/isp' };
    case 'ubicaciones': return { nombre: r.ubicacion_nombre, tipo: 'Ubicación', hash: '#/inicio' };
    case 'usuarios': return { nombre: r.usuario_nombre, tipo: 'Usuario', hash: '#/usuario/' + r.id };
    case 'organizaciones': return { nombre: r.organizacion_nombre, tipo: 'Organización', hash: '#/inicio' };
    default: return { nombre: r.id, tipo: coleccion, hash: '#/inicio' };
  }
}

// ---------------------------------------------------------------------------------------------
// AV · aviso al ingresar
// ---------------------------------------------------------------------------------------------

/**
 * Solicitudes propias resueltas desde el último ingreso (QA17-A) y, al superadmin, lo que pasó a «viejo» (QA30-C).
 * @param {UsuarioSesion} u
 * @param {() => void} alCerrar
 */
async function bloqueAviso(u, alCerrar) {
  if (sesion.avisoVisto()) return null;
  /** @type {Array<Node|string>} */
  const lineas = [];
  const previoISO = sesion.ingresoPrevio();
  const desde = previoISO ? new Date(previoISO) : new Date(Date.now() - 14 * 864e5);
  const resueltas = await repositorio.listar('solicitudes', s => s.solicitado_por === u.id && (s.solicitud_estado === 'aprobada' || s.solicitud_estado === 'rechazada') && !!s.resuelto_en && new Date(s.resuelto_en) > desde);
  let hayResueltas = false;
  if (resueltas.length) {
    hayResueltas = true;
    const det = await solicitudes.detallar(resueltas);
    const quienes = await repositorio.listar('usuarios', null, { incluirBajas: true });
    for (const d of det) {
      const s = d.solicitud;
      const resolvio = quienes.find(x => x.id === s.resuelto_por);
      const que = d.credencial ? 'ver «' + d.credencial.credencial_nombre + '»' : 'dar de baja un registro';
      lineas.push(h('div', null, ['Tu solicitud para ' + que + ' fue ', h('b', { text: s.solicitud_estado === 'aprobada' ? 'aprobada' : 'rechazada' }),
        ' por ' + (resolvio ? resolvio.usuario_nombre : 'un superior') + ' el ' + fmtFecha(s.resuelto_en) +
        (s.solicitud_alcance === 'tipo_credencial' ? ' (vale para todas las credenciales de ese tipo)' : '') + '.']));
    }
  }
  let hayViejos = false;
  /** @type {string|null} */
  let orgConMas = null;
  if (u.usuario_perfil === 'superadmin') {
    const umbrales = await repositorio.umbralesVerificacion();
    const orgs = await repositorio.listar('organizaciones', null, { ordenarPor: 'organizacion_nombre' });
    const porOrg = [];
    let total = 0;
    for (const o of orgs) {
      let n = 0;
      for (const c of VERIFICABLES) n += await repositorio.contar(c, r => r.organizacion_id === o.id && diasDesde(r.verificado_en) > umbrales.viejo);
      // los puertos no llevan organización: se cuentan por su equipo
      const equiposOrg = new Set((await repositorio.listar('equipos', { organizacion_id: o.id })).map(e => e.id));
      n += await repositorio.contar('puertos', r => equiposOrg.has(r.equipo_id) && diasDesde(r.verificado_en) > umbrales.viejo);
      porOrg.push([o, n]);
      total += n;
    }
    if (total) {
      hayViejos = true;
      porOrg.sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]));
      orgConMas = /** @type {any} */ (porOrg[0][0]).id;
      lineas.push(h('div', null, [h('b', { text: String(total) }), ' elementos pasaron a «viejo» sin verificar (más de ' + umbrales.viejo + ' días): ' +
        porOrg.filter(x => x[1]).map(x => /** @type {any} */ (x[0]).organizacion_nombre + ' (' + x[1] + ')').join(', ') + '.']));
    }
  }
  if (!lineas.length) return null;
  const botones = [h('button', { type: 'button', class: 'primario', text: 'Entendido', onclick: () => { sesion.marcarAvisoVisto(); alCerrar(); } })];
  if (hayResueltas) botones.push(h('button', { type: 'button', text: 'Ir a Solicitudes', onclick: () => { sesion.marcarAvisoVisto(); ir('#/solicitudes'); } }));
  if (hayViejos && orgConMas) {
    const idOrg = orgConMas;
    botones.push(h('button', { type: 'button', text: 'Ver pendientes de verificar', onclick: () => { sesion.marcarAvisoVisto(); sesion.fijarOrganizacionActiva(idOrg); ir('#/inicio'); } }));
  }
  return h('div', { class: 'aviso-flujo', role: 'region', 'aria-label': 'Aviso al ingresar' }, [
    h('div', null, [h('span', { class: 'tag', text: 'AV · Aviso al ingresar' })]),
    h('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:4px' }, lineas),
    h('div', { class: 'herr', style: 'margin:8px 0 0' }, botones)]);
}

// ---------------------------------------------------------------------------------------------
// Solicitudes pendientes
// ---------------------------------------------------------------------------------------------

/**
 * @param {UsuarioSesion} u
 * @param {string} orgId
 * @param {() => void} alCambiar
 */
async function bloqueSolicitudes(u, orgId, alCambiar) {
  const caja = h('div', { class: 'bloque g1', id: 'bloqueSolicitudes' });
  if (u.usuario_perfil === 'operario') {
    const mias = (await solicitudes.mias(u)).filter(d => d.solicitud.solicitud_estado === 'pendiente');
    caja.appendChild(h('h2', { text: 'Mis solicitudes pendientes (' + mias.length + ')' }));
    if (!mias.length) caja.appendChild(h('div', { class: 'mut', text: 'No tenés solicitudes pendientes.' }));
    for (const d of mias) caja.appendChild(h('div', { class: 'sol-card', text: 'Pediste ver «' + (d.credencial ? d.credencial.credencial_nombre : 'una credencial') + '» · ' + fmtFecha(d.solicitud.solicitado_en) }));
    caja.appendChild(h('div', { class: 'herr' }, [h('a', { href: '#/solicitudes', text: 'Ir a Solicitudes' })]));
    return caja;
  }
  const pend = await solicitudes.paraAprobar(u, orgId);
  caja.appendChild(h('h2', { text: 'Solicitudes pendientes (' + pend.length + ')' }));
  if (!pend.length) caja.appendChild(h('div', { class: 'mut', text: 'No hay solicitudes para resolver. Cuando alguien pida ver una contraseña, aparece acá.' }));
  for (const d of pend) {
    const s = d.solicitud;
    const sol = d.solicitante;
    const tarjeta = h('div', { class: 'sol-card' });
    const esBaja = s.solicitud_tipo === 'baja_registro';
    let que = '';
    if (esBaja) {
      const e = await repositorio.obtener('equipos', s.solicitud_entidad_id, { incluirBajas: true });
      que = 'dar de baja ' + (e ? 'el equipo «' + e.equipo_nombre + '»' : 'un registro');
    } else que = 'ver «' + (d.credencial ? d.credencial.credencial_nombre : 'una credencial') + '»';
    tarjeta.appendChild(h('div', null, [h('span', { class: 'quien', text: sol ? sol.usuario_nombre : 'Alguien' }), ' (' + (sol ? ROTULO_PERFIL[sol.usuario_perfil] : '?') + ') pide ' + que]));
    tarjeta.appendChild(h('div', { class: 'mut', text: (s.solicitud_motivo ? 'Motivo: ' + s.solicitud_motivo + ' · ' : 'Sin motivo indicado · ') + fmtFecha(s.solicitado_en) }));
    const zona = h('div', { class: 'opciones' });
    tarjeta.appendChild(zona);
    const confirmarResolucion = async (/** @type {'aprobada'|'rechazada'} */ r, /** @type {'credencial'|'tipo_credencial'|null} */ alcance) => {
      try {
        await repositorio.resolverSolicitud(s.id, r, u.id, alcance);
        if (esBaja && r === 'aprobada') {
          const e = await repositorio.obtener('equipos', s.solicitud_entidad_id);
          if (e) await repositorio.guardar('equipos', { ...e, eliminado_en: ahoraISO() }, u.id, { motivo: 'Baja aprobada por solicitud.' });
        }
        toast(r === 'aprobada' ? 'Solicitud aprobada' : 'Solicitud rechazada');
        await repintarMarco();
        alCambiar();
      } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo resolver la solicitud.'); }
    };
    const botones = () => {
      zona.textContent = '';
      zona.appendChild(h('button', { type: 'button', class: 'chico primario', text: 'Aprobar', onclick: () => (esBaja ? confirmarResolucion('aprobada', null) : alcance()) }));
      zona.appendChild(h('button', { type: 'button', class: 'chico', text: 'Rechazar', onclick: () => confirmarResolucion('rechazada', null) }));
    };
    const alcance = () => {
      zona.textContent = '';
      const nombreGrupo = 'alc' + s.id;
      const r1 = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: nombreGrupo, checked: 'checked' }));
      const r2 = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: nombreGrupo }));
      const tipo = d.credencial ? (ROTULO_CREDENCIAL_TIPO[d.credencial.credencial_tipo] || d.credencial.credencial_tipo) : 'del mismo tipo';
      zona.appendChild(h('label', null, [r1, 'Solo esta credencial']));
      zona.appendChild(h('label', null, [r2, 'Todas las de tipo ' + tipo]));
      zona.appendChild(h('button', { type: 'button', class: 'chico primario', text: 'Confirmar', onclick: () => confirmarResolucion('aprobada', r2.checked ? 'tipo_credencial' : 'credencial') }));
      zona.appendChild(h('button', { type: 'button', class: 'chico', text: 'Cancelar', onclick: botones }));
    };
    botones();
    caja.appendChild(tarjeta);
  }
  caja.appendChild(h('div', { class: 'herr' }, [h('a', { href: '#/solicitudes', text: 'Ir a Solicitudes' })]));
  return caja;
}

// ---------------------------------------------------------------------------------------------
// Próximos vencimientos
// ---------------------------------------------------------------------------------------------

/**
 * @param {UsuarioSesion} u
 * @param {string} orgId
 */
async function bloqueVencimientos(u, orgId) {
  /** @type {Array<{fecha: string, que: string, hash: string}>} */
  const filas = [];
  if (puede(u, 'ver', 'credenciales', orgId)) {
    for (const c of await repositorio.listar('credenciales', { organizacion_id: orgId })) {
      if (c.credencial_vence_en) filas.push({ fecha: c.credencial_vence_en, que: c.credencial_nombre + ' (' + (ROTULO_CREDENCIAL_TIPO[c.credencial_tipo] || c.credencial_tipo) + ')', hash: '#/credencial/' + c.id });
    }
  }
  const verRed = puede(u, 'ver', 'red', orgId), verSrv = puede(u, 'ver', 'servidores', orgId);
  if (verRed || verSrv) {
    for (const e of await repositorio.listar('equipos', { organizacion_id: orgId })) {
      const c = e.equipo_campos || {};
      if (e.equipo_tipo === 'firewall' && verRed && c.firewall_licencia_vence_en) filas.push({ fecha: c.firewall_licencia_vence_en, que: 'Licencia de ' + e.equipo_nombre, hash: '#/equipo/' + e.id });
      if (e.equipo_tipo === 'servidor' && verSrv && c.servidor_garantia_vence_en) filas.push({ fecha: c.servidor_garantia_vence_en, que: 'Garantía de ' + e.equipo_nombre, hash: '#/servidor/' + e.id });
    }
  }
  if (puede(u, 'ver', 'configuraciones', orgId)) {
    for (const sv of await repositorio.listar('servicios', { organizacion_id: orgId })) {
      if (sv.servicio_vence_en) filas.push({ fecha: sv.servicio_vence_en, que: sv.servicio_nombre + ' (' + (ROTULO_SERVICIO_TIPO[sv.servicio_tipo] || sv.servicio_tipo) + ')', hash: '#/servicio/' + sv.id });
    }
  }
  // Lo vencido hace poco y lo que vence en los próximos 4 meses.
  const visibles = filas.filter(f => diasHasta(f.fecha) >= -45 && diasHasta(f.fecha) <= 120).sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).slice(0, 10);
  const caja = h('div', { class: 'bloque g1' }, [h('h2', { text: 'Próximos vencimientos' })]);
  if (!visibles.length) {
    caja.appendChild(h('div', { class: 'mut', text: verRed || verSrv || puede(u, 'ver', 'credenciales', orgId) ? 'No hay nada que venza en los próximos 4 meses.' : 'Tu rol no ve vencimientos.' }));
    return caja;
  }
  caja.appendChild(tabla(['Vence', 'Qué'], visibles.map(f => {
    const d = diasHasta(f.fecha);
    return [h('span', { class: 'vence-tag ' + (d < 0 ? 'pasado' : d <= 30 ? 'pronto' : '') }, [fmtFecha(f.fecha) + ' · ' + textoVence(f.fecha)]), h('a', { href: f.hash, text: f.que })];
  })));
  caja.appendChild(h('div', { class: 'mut', style: 'margin-top:6px;font-size:12.5px', text: 'Tocá un elemento para abrir su ficha y actualizar la fecha.' }));
  return caja;
}

// ---------------------------------------------------------------------------------------------
// Para revisar (MJ46): avisos con cantidad y enlace a la pantalla filtrada
// ---------------------------------------------------------------------------------------------

/**
 * Solo muestra los avisos de módulos que el rol ve y con cantidad mayor a 0.
 * @param {UsuarioSesion} u
 * @param {string} orgId
 */
async function bloqueParaRevisar(u, orgId) {
  /** @type {Array<{n: number, texto: string, hash: string}>} */
  const avisos = [];
  if (puede(u, 'ver', 'licencias', orgId)) {
    let vencidas = 0, porVencer = 0, excedidas = 0;
    for (const l of await repositorio.listar('licencias', { organizacion_id: orgId })) {
      if (l.licencia_vence_en) {
        const d = diasHasta(l.licencia_vence_en);
        if (d < 0) vencidas++;
        else if (d <= 30) porVencer++;
      }
      if ((await repositorio.licenciasEnUso(l.id)).excedida) excedidas++;
    }
    avisos.push({ n: vencidas, texto: 'licencias vencidas', hash: '#/licencias' });
    avisos.push({ n: porVencer, texto: 'licencias que vencen en 30 días o menos', hash: '#/licencias' });
    avisos.push({ n: excedidas, texto: 'licencias con más instalaciones que compras', hash: '#/licencias' });
  }
  if (puede(u, 'ver', 'personas', orgId)) {
    const bajas = new Set((await repositorio.listar('personas', { organizacion_id: orgId, persona_estado: 'baja' })).map(p => p.id));
    const n = await repositorio.contar('cuentas_dominio', c => c.organizacion_id === orgId && c.cuenta_estado === 'habilitada' && !!c.persona_id && bajas.has(c.persona_id));
    avisos.push({ n, texto: 'cuentas de dominio habilitadas de personas en baja', hash: '#/personas/cuentas' });
  }
  if (puede(u, 'ver', 'red', orgId)) {
    const equiposOrg = await repositorio.listar('equipos', { organizacion_id: orgId });
    const switches = new Set(equiposOrg.filter(e => e.equipo_tipo === 'switch').map(e => e.id));
    // un puesto está conectado si alguna de sus bocas de patchera llega a un switch
    const conSwitch = new Set((await repositorio.listar('puertos', p => !!p.puesto_id && !!p.conectado_a_equipo_id && switches.has(p.conectado_a_equipo_id))).map(p => p.puesto_id));
    const puestos = await repositorio.listar('puestos', { organizacion_id: orgId });
    avisos.push({ n: puestos.filter(p => !conSwitch.has(p.id)).length, texto: 'puestos sin conexión a switch', hash: '#/red/puestos' });
    // equipos de escritorio (PC y notebooks) sin asignación vigente
    const asignados = new Set((await repositorio.listar('asignaciones', a => a.organizacion_id === orgId && !a.asignacion_hasta)).map(a => a.equipo_id));
    const sinAsignar = equiposOrg.filter(e => e.equipo_estado !== 'baja' && e.equipo_tipo === 'otro' && CATEGORIAS_PUESTO.includes(String((e.equipo_campos || {}).otro_categoria)) && !asignados.has(e.id));
    avisos.push({ n: sinAsignar.length, texto: 'equipos de escritorio sin asignar', hash: '#/escritorio' });
  }
  const conAviso = avisos.filter(a => a.n > 0);
  const caja = h('div', { class: 'bloque', id: 'bloqueRevisar', style: 'margin-bottom:10px' });
  caja.appendChild(h('h2', { text: 'Para revisar' }));
  if (!conAviso.length) {
    caja.appendChild(h('div', { class: 'mut', text: 'Nada para revisar' }));
    return caja;
  }
  caja.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px 14px' }, conAviso.map(a =>
    h('a', { href: a.hash }, [h('b', { text: String(a.n) }), ' ' + a.texto]))));
  return caja;
}

// ---------------------------------------------------------------------------------------------
// Pendientes de verificar (D-046)
// ---------------------------------------------------------------------------------------------

/**
 * @param {UsuarioSesion} u
 * @param {string} orgId
 * @param {import('../assets/js/utiles.js').Umbrales} umbrales
 * @param {{pagina: number}} estado
 * @param {() => void} rerender
 */
async function bloquePendientesVerificar(u, orgId, umbrales, estado, rerender) {
  /** @type {Array<{coleccion: string, r: any, modulo: Modulo}>} */
  const todos = [];
  for (const c of VERIFICABLES) {
    for (const r of await repositorio.listar(c, { organizacion_id: orgId })) {
      const m = moduloDe(c, r);
      if (!puede(u, 'ver', m, orgId)) continue;
      if (diasDesde(r.verificado_en) >= umbrales.aRevisar) todos.push({ coleccion: c, r, modulo: m });
    }
  }
  const equiposOrg = new Set((await repositorio.listar('equipos', { organizacion_id: orgId })).map(e => e.id));
  const puertosPend = puede(u, 'ver', 'red', orgId) ? await repositorio.contar('puertos', r => equiposOrg.has(r.equipo_id) && diasDesde(r.verificado_en) >= umbrales.aRevisar) : 0;
  const viejos = todos.filter(x => estadoVerificacion(x.r.verificado_en, umbrales).nivel === 'viejo').length;
  todos.sort((a, b) => (a.r.verificado_en < b.r.verificado_en ? -1 : 1));
  const caja = h('div', { class: 'bloque', style: 'margin-top:10px', id: 'bloquePendientes' });
  caja.appendChild(h('h2', { text: 'Pendientes de verificar' }));
  caja.appendChild(h('div', { class: 'mut', style: 'margin-bottom:8px', text: 'Elementos cuya documentación no se confirma en el lugar hace más de ' + umbrales.aRevisar + ' días («a revisar») o más de ' + umbrales.viejo + ' («viejo»). Si lo viste y sigue igual, tocá «Confirmar vigente».' }));
  if (!todos.length && !puertosPend) {
    caja.appendChild(h('div', { class: 'msg ok', text: 'Todo lo que ves está verificado hace menos de ' + umbrales.aRevisar + ' días.' }));
    return caja;
  }
  caja.appendChild(h('div', { style: 'margin-bottom:8px' }, [
    h('b', { text: String(todos.length - viejos) }), ' a revisar · ', h('b', { text: String(viejos) }), ' viejos' + (puertosPend ? ' · además ' : ''),
    puertosPend ? h('b', { text: String(puertosPend) }) : null, puertosPend ? ' puertos (se confirman por switch, en una próxima entrega)' : null]));
  const pagina = todos.slice(0, (estado.pagina + 1) * TAMANO_PAGINA);
  caja.appendChild(tabla(['Qué', 'Tipo', 'Verificación', ''], pagina.map(x => {
    const d = describir(x.coleccion, x.r);
    const puedeConfirmar = puede(u, 'verificar', x.modulo, orgId);
    return [h('a', { href: d.hash, text: d.nombre }), d.tipo, indicadorVerificacion(x.r.verificado_en, umbrales, true),
      puedeConfirmar ? h('button', { type: 'button', class: 'chico', text: 'Confirmar vigente', title: 'Confirma que lo documentado sigue siendo real. No abre ningún formulario.', 'aria-label': 'Confirmar vigente: ' + d.nombre, onclick: async () => {
        try { if (!(await confirmarConPasos(x.coleccion, x.r.id, u))) return; toast('Confirmado como vigente: ' + d.nombre + ' · verificado hoy por ' + u.usuario_nombre); rerender(); }
        catch (err) { toast(err instanceof Error ? err.message : 'No se pudo confirmar.'); }
      } }) : h('span', { class: 'mut', text: 'Sin permiso para confirmar' })];
  })));
  if (todos.length > pagina.length) {
    caja.appendChild(h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'chico', text: 'Ver más (' + (todos.length - pagina.length) + ' restantes)', onclick: () => { estado.pagina++; rerender(); } })]));
  }
  return caja;
}

// ---------------------------------------------------------------------------------------------
// Últimos cambios con «leído» (D-048)
// ---------------------------------------------------------------------------------------------

/** @type {Object<string, string>} */
const ARTICULO_ENTIDAD = {
  Equipo: 'el equipo', Puerto: 'el puerto', Vlan: 'la VLAN', Credencial: 'la credencial', Configuracion: 'la configuración', Rack: 'el rack',
  Ubicacion: 'la ubicación', Usuario: 'al usuario', Organizacion: 'la organización', EnlaceIsp: 'el enlace de Internet', RedWifi: 'la red Wi-Fi', Puesto: 'el puesto'
};

/** @type {Object<string, string>} */
const ETIQUETA_CAMPO = {
  firmware_version: 'la versión de firmware', ip_gestion: 'la IP de gestión', ip_lan: 'la IP de la LAN', estado: 'el estado', notas: 'las notas', nombre: 'el nombre',
  secreto: 'la contraseña', vence_en: 'el vencimiento', conectado_a_descripcion: 'a qué está conectado', puesto_id: 'el puesto', vlans_etiquetadas: 'las VLAN etiquetadas',
  vlan_nativa_id: 'la VLAN nativa', ram_gb: 'la memoria', baterias_cambio_en: 'la fecha de cambio de baterías', modo: 'el modo', velocidad: 'la velocidad'
};

/** @param {string} campo «equipo_ip_gestion» → «la IP de gestión» */
function etiquetaCampo(campo) {
  const sinPrefijo = campo.replace(/^[a-z]+_/, '');
  const clave = Object.keys(ETIQUETA_CAMPO).find(k => campo === k || campo.endsWith('_' + k));
  return clave ? ETIQUETA_CAMPO[clave] : sinPrefijo.replace(/_/g, ' ');
}

/** @param {string|null} json Valor guardado como JSON en texto, recortado para una línea. */
function valorCorto(json) {
  if (json === null || json === undefined) return '∅';
  let v;
  try { v = JSON.parse(json); } catch { v = json; }
  if (v === null) return '∅';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 48 ? t.slice(0, 45) + '…' : t;
}

/**
 * @param {UsuarioSesion} u
 * @param {string} orgId
 * @param {{cantidad: number, ocultarLeidos: boolean}} estado
 * @param {() => void} rerender
 */
async function bloqueCambios(u, orgId, estado, rerender) {
  const caja = h('div', { class: 'bloque', style: 'margin-top:10px', id: 'bloqueCambios' });
  caja.appendChild(h('h2', { text: 'Últimos cambios' }));
  const [cambios, leidos, usuarios] = await Promise.all([
    repositorio.listar('cambios', c => c.organizacion_id === orgId && c.cambio_entidad !== 'Solicitud' && c.cambio_entidad !== 'PermisoModulo', { ordenarPor: 'cambio_fecha', descendente: true }),
    repositorio.cambiosLeidos(u.id), repositorio.listar('usuarios', null, { incluirBajas: true })]);
  const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
  const puedeMarcar = puede(u, 'marcar_leidos', null, orgId);

  /** @type {Array<{c: any, texto: string}>} */
  const filas = [];
  const cache = new Map();
  /** @param {string} col @param {string} id */
  const reg = async (col, id) => { const k = col + id; if (!cache.has(k)) cache.set(k, await repositorio.obtener(col, id, { incluirBajas: true })); return cache.get(k); };
  let sinLeer = 0;
  for (const c of cambios) {
    if (filas.length >= estado.cantidad) break;
    const col = COLECCION_DE_ENTIDAD[c.cambio_entidad];
    const r = col ? await reg(col, c.entidad_id) : null;
    if (!r) continue;
    const modulo = moduloDeEntidad(c.cambio_entidad, r);
    if (!puede(u, 'ver_cambios', modulo, orgId)) continue;
    if (estado.ocultarLeidos && leidos.has(c.id)) continue;
    let nombre = '';
    if (c.cambio_entidad === 'Puerto') { const eq = await reg('equipos', r.equipo_id); nombre = (r.puerto_nombre || 'N.º ' + r.puerto_numero) + ' de ' + (eq ? eq.equipo_nombre : '?'); }
    else nombre = describir(col, r).nombre;
    if (c.cambio_entidad === 'Usuario') nombre = r.usuario_nombre;
    const quien = nombreUsuario.get(c.usuario_id) || 'Alguien';
    let texto;
    if (c.cambio_operacion === 'alta') texto = c.cambio_entidad === 'Usuario' ? quien + ' creó al usuario ' + nombre + ' con rol ' + (ROTULO_PERFIL[r.usuario_perfil] || r.usuario_perfil).toLowerCase() : quien + ' creó ' + (ARTICULO_ENTIDAD[c.cambio_entidad] || 'el registro') + ' ' + nombre;
    else if (c.cambio_operacion === 'baja') texto = quien + ' dio de baja ' + (ARTICULO_ENTIDAD[c.cambio_entidad] || 'el registro') + ' ' + nombre;
    else if (c.cambio_operacion === 'restauracion') texto = quien + ' restauró ' + (ARTICULO_ENTIDAD[c.cambio_entidad] || 'el registro') + ' ' + nombre;
    else {
      texto = quien + ' modificó ' + etiquetaCampo(c.cambio_campo || '') + ' de ' + (ARTICULO_ENTIDAD[c.cambio_entidad] || 'el registro').replace(/^al /, 'el ') + ' ' + nombre;
      texto += c.cambio_valor_oculto ? ' (el valor está oculto)' : ': «' + valorCorto(c.cambio_valor_anterior) + '» → «' + valorCorto(c.cambio_valor_nuevo) + '»';
    }
    filas.push({ c, texto });
    if (!leidos.has(c.id)) sinLeer++;
  }

  caja.appendChild(h('div', { class: 'herr', style: 'margin-top:0' }, [
    h('span', { class: 'mut', text: puedeMarcar ? 'Tildá «leído» los que ya viste: se tachan, y los nuevos se distinguen.' : '' }), h('span', { style: 'flex:1' }),
    h('label', null, [h('input', { type: 'checkbox', id: 'ocultarLeidos', checked: estado.ocultarLeidos ? 'checked' : null, onchange: (/** @type {Event} */ e) => { estado.ocultarLeidos = /** @type {HTMLInputElement} */ (e.target).checked; estado.cantidad = 12; rerender(); } }), ' Ocultar los leídos'])]));
  if (!filas.length) { caja.appendChild(h('div', { class: 'mut', text: 'No hay cambios para mostrar.' })); return caja; }
  const lista = h('ul', { class: 'cambios-lista' });
  for (const f of filas) {
    const leido = leidos.has(f.c.id);
    const chk = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: leido ? 'checked' : null, disabled: puedeMarcar ? null : 'disabled', 'aria-label': 'Marcar como leído', id: 'leido-' + f.c.id }));
    chk.addEventListener('change', async () => {
      await repositorio.marcarLeido(u.id, f.c.id, chk.checked);
      rerender();
    });
    lista.appendChild(h('li', { class: leido ? 'leido' : 'nuevo' }, [
      chk, h('span', { class: 'cuando', text: fmtFechaHora(f.c.cambio_fecha) }),
      h('label', { class: 'cambio-texto', for: 'leido-' + f.c.id }, [leido ? null : h('span', { class: 'nuevo-tag', text: 'NUEVO' }), f.texto])]));
  }
  caja.appendChild(lista);
  caja.appendChild(h('div', { class: 'herr' }, [
    h('button', { type: 'button', class: 'chico', text: 'Ver más cambios', onclick: () => { estado.cantidad += 12; rerender(); } }),
    h('span', { class: 'mut', text: sinLeer + ' sin leer entre los ' + filas.length + ' que se ven' })]));
  return caja;
}

// ---------------------------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------------------------

/** @param {HTMLElement} contenedor */
export async function renderVistaTablero(contenedor) {
  const u = /** @type {UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = /** @type {string} */ (sesion.organizacionActiva());
  const org = await repositorio.obtener('organizaciones', orgId);
  if (!org) { ir('#/organizaciones'); return; }
  const migas = await migasRaiz();
  migas[migas.length - 1] = [migas[migas.length - 1][0]];
  pantalla(contenedor, { codigo: 'P03', nombre: 'Inicio de la organización', migas });

  const umbrales = await repositorio.umbralesVerificacion();
  const estadoPend = { pagina: 0 };
  const estadoCamb = { cantidad: 12, ocultarLeidos: false };

  const zonaAviso = h('div');
  const zonaCuerpo = h('div');
  contenedor.appendChild(zonaAviso);
  contenedor.appendChild(h('div', { class: 'fila', style: 'margin-bottom:10px;align-items:center;justify-content:space-between' }, [h('h1', { text: org.organizacion_nombre + (org.organizacion_rubro ? ' · ' + org.organizacion_rubro : '') }),
    puede(u, 'ver_organizaciones') ? h('button', { type: 'button', text: 'Editar organización', onclick: async () => {
      const { abrirFormularioOrganizacion } = await import('./organizaciones.view.js');
      abrirFormularioOrganizacion(org, async () => { await repintarMarco(); contenedor.textContent = ''; await renderVistaTablero(contenedor); });
    } }) : null]));
  contenedor.appendChild(zonaCuerpo);

  const pintarAviso = async () => {
    zonaAviso.textContent = '';
    const a = await bloqueAviso(u, pintarAviso);
    if (a) zonaAviso.appendChild(a);
  };
  await pintarAviso();

  // ---- indicadores por módulo (solo los que el rol ve)
  const IND = /** @type {Array<[string, Modulo, string, string, string, (() => Promise<number>)]>} */ ([
    ['Red', 'red', 'equipo', 'equipos de red y puestos de trabajo', '#/red', () => repositorio.contar('equipos', r => r.organizacion_id === orgId && r.equipo_tipo !== 'servidor')],
    ['Servidores', 'servidores', 'servidor', 'servidores y máquinas virtuales', '#/servidores', () => repositorio.contar('equipos', r => r.organizacion_id === orgId && r.equipo_tipo === 'servidor')],
    ['Racks', 'racks', 'rack', 'racks', '#/racks', () => repositorio.contar('racks', { organizacion_id: orgId })],
    ['Configuraciones', 'configuraciones', 'configuracion', 'configuraciones', '#/configuraciones', () => repositorio.contar('configuraciones', { organizacion_id: orgId })],
    ['Credenciales', 'credenciales', 'credencial', 'credenciales', '#/credenciales', () => repositorio.contar('credenciales', { organizacion_id: orgId })]
  ]);
  let totalDatos = 0;
  const indicadores = h('div', { class: 'fila ind-pend' });
  for (const [nombre, modulo, tipo, unidad, hash, contarFn] of IND) {
    if (!puede(u, 'ver', modulo, orgId)) continue;
    const n = await contarFn(); totalDatos += n;
    indicadores.appendChild(h('button', { type: 'button', class: 'ind g1 t-' + tipo, onclick: () => ir(hash), 'aria-label': nombre + ': ' + n + ' ' + unidad }, [
      h('span', { class: 'ind-cab' }, [icono(tipo), nombre]), h('b', { text: String(n) }), h('small', { text: unidad })]));
  }

  const pintarCuerpo = async () => {
    zonaCuerpo.textContent = '';
    zonaCuerpo.appendChild(indicadores);
    if (!indicadores.childElementCount) {
      zonaCuerpo.removeChild(indicadores);
      zonaCuerpo.appendChild(h('div', { class: 'aviso', text: 'Tu rol solo ve la ficha básica de ' + org.organizacion_nombre + ' (nombre y rubro). Si necesitás ver más, pedile a tu superior que te dé permisos de lectura.' }));
    }
    if (indicadores.childElementCount && !totalDatos) zonaCuerpo.appendChild(h('div', { class: 'estado-vacio', role: 'status', style: 'margin:10px 0' }, [h('h2', { text: 'Esta organización todavía no tiene datos' }),
      h('p', { text: 'Empezá cargando sus ubicaciones y racks, y después los equipos, servidores y credenciales. Los usuarios (gerente, técnico, operario) se asignan desde Usuarios.' })]));
    zonaCuerpo.appendChild(await bloqueParaRevisar(u, orgId));
    const zonaFila = h('div', { class: 'fila', style: 'margin-top:10px;align-items:flex-start' });
    zonaCuerpo.appendChild(zonaFila);
    const zonaPend = h('div');
    const zonaCamb = h('div');
    zonaCuerpo.appendChild(zonaPend);
    zonaCuerpo.appendChild(zonaCamb);

    const rerenderSolicitudes = async () => { const n = await bloqueSolicitudes(u, orgId, rerenderSolicitudes); const viejo = zonaFila.querySelector('#bloqueSolicitudes'); if (viejo) viejo.replaceWith(n); else zonaFila.prepend(n); };
    await rerenderSolicitudes();
    zonaFila.appendChild(await bloqueVencimientos(u, orgId));

    const hayVerificar = ['red', 'servidores', 'racks', 'credenciales', 'configuraciones'].some(m => puede(u, 'verificar', /** @type {Modulo} */ (m), orgId));
    const pintarPend = async () => { zonaPend.textContent = ''; zonaPend.appendChild(await bloquePendientesVerificar(u, orgId, umbrales, estadoPend, pintarPend)); };
    if (hayVerificar) await pintarPend();
    const pintarCamb = async () => { zonaCamb.textContent = ''; zonaCamb.appendChild(await bloqueCambios(u, orgId, estadoCamb, pintarCamb)); };
    if (['red', 'servidores', 'racks', 'credenciales', 'configuraciones'].some(m => puede(u, 'ver_cambios', /** @type {Modulo} */ (m), orgId))) await pintarCamb();
  };
  await pintarCuerpo();
}
