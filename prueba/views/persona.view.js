// @ts-check
/**
 * P23 · Ficha de persona (`#/persona/<id>[/<pestaña>]`) y alta (`#/persona/nueva`).
 * Datos con edición en el lugar (D-037), verificación, baja, y pestañas: Equipos (asignación vigente, devolver, asignar e
 * historial de asignaciones, D-057), Cuentas de dominio, Licencias (solo lectura), Notas (si existe `notas.js`) e Historial.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, toast, abrirModal, cerrarModal } from '../assets/js/marco.js';
import { h, tabla, ahoraISO, fmtFecha, fmtFechaHora, indicadorVerificacion } from '../assets/js/utiles.js';
import { ROTULO_PERSONA_ESTADO } from '../assets/js/modelos.js';
import { encabezado, leerRuta, pestanas, campo, enlace, formulario, fichaCab, textoUltimoCambio, pedirBaja, seguro, valorHistorial } from '../assets/js/red.js';
import {
  inyectarEstilosPersonas, cargarContextoPersonas, avisoPersonas, enlaceFila, nombreCuenta, hashDeEquipo, tipoEquipo, pillCuenta, alertaCuentaDeBaja, modalAsignar, modalDevolver, modalMudar
} from '../assets/js/personas.js';

/** @typedef {import('../assets/js/red.js').Contexto} Contexto */
/** @typedef {import('../assets/js/modelos.js').Persona} Persona */

/** @type {import('../assets/js/red.js').Campo[]} */
const CAMPOS = [
  { k: 'persona_nombre', r: 'Nombre y apellido', t: 'texto', req: true }, { k: 'persona_sector', r: 'Sector', t: 'texto' }, { k: 'persona_notas', r: 'Notas', t: 'largo' }
];

/**
 * Carga la pestaña de notas si `assets/js/notas.js` existe; si no, devuelve null y la pestaña no aparece.
 * @returns {Promise<null|((cont: HTMLElement, o: {entidad: string, entidadId: string, organizacionId: string}) => any)>}
 */
async function cargarNotas() {
  try {
    // @ts-ignore: el módulo lo escribe otro agente y puede no existir todavía.
    const m = await import('../assets/js/notas.js');
    return typeof m.pintarNotas === 'function' ? m.pintarNotas : null;
  } catch (e) { return null; }
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  inyectarEstilosPersonas();
  const ctx = await cargarContextoPersonas();
  const partes = leerRuta().partes;
  const id = partes[0];
  const nueva = id === 'nueva';
  const persona = id && !nueva ? await repositorio.obtener('personas', id) : null;
  await encabezado(contenedor, 'P23', nueva ? 'Nueva persona' : 'Ficha de persona', [['Personas', '#/personas'], [nueva ? 'Nueva persona' : persona ? persona.persona_nombre : 'Persona']]);
  if (!puede(ctx.u, 'ver', 'personas', ctx.org)) { avisoPersonas(contenedor, 'Tu rol no tiene acceso al módulo Personas.'); return; }
  if (nueva) {
    if (!ctx.modifica) { avisoPersonas(contenedor, 'Tu rol no puede cargar personas.', '#/personas'); return; }
    await dibujarAlta(contenedor, ctx);
    return;
  }
  if (!persona || persona.organizacion_id !== ctx.org) { avisoPersonas(contenedor, 'No encontramos esa persona en esta organización (puede haberse eliminado).', '#/personas'); return; }
  const notas = await cargarNotas();
  let editando = false;
  const armar = async () => {
    const scroller = contenedor.parentElement;
    const y = scroller ? scroller.scrollTop : 0;
    while (contenedor.children.length > 2) contenedor.removeChild(/** @type {Node} */ (contenedor.lastChild));
    const p = await repositorio.obtener('personas', id);
    if (!p) { avisoPersonas(contenedor, 'La persona ya no existe.', '#/personas'); return; }
    await dibujar(contenedor, ctx, p, partes, editando, notas, async v => { editando = v; await armar(); }, armar);
    if (scroller) scroller.scrollTop = y;
  };
  await dibujar(contenedor, ctx, persona, partes, editando, notas, async v => { editando = v; await armar(); }, armar);
}

/** Selector de puesto con los de la organización. @param {any[]} puestos @param {string|null} actual */
function selectorPuesto(puestos, actual) {
  const sel = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Puesto habitual' }, [h('option', { value: '', text: 'Sin puesto fijo' })].concat(puestos.map(x => h('option', { value: x.id, text: x.puesto_nombre })))));
  sel.value = actual || '';
  return sel;
}

/** @param {HTMLElement} cont @param {Contexto} ctx */
async function dibujarAlta(cont, ctx) {
  const [puestos, existentes] = await Promise.all([repositorio.listar('puestos', { organizacion_id: ctx.org }, { ordenarPor: 'puesto_nombre' }), repositorio.listar('personas', { organizacion_id: ctx.org })]);
  const f = formulario(CAMPOS, {});
  const sel = selectorPuesto(puestos, null);
  const err = h('div', { class: 'rd-err', role: 'alert' });
  cont.appendChild(h('h1', { text: 'Nueva persona' }));
  cont.appendChild(h('div', { class: 'bloque' }, [
    h('div', { class: 'mut', style: 'margin-bottom:8px', text: 'Es alguien de la organización (no un usuario del sistema). Los campos con * son obligatorios; después podés asignarle equipos y cuentas desde su ficha.' }),
    h('div', { class: 'rd-edicion' }, [f.nodo, h('div', { class: 'campo', style: 'margin-top:8px;max-width:320px' }, [h('label', { text: 'Puesto habitual' }), sel]), err]),
    h('div', { class: 'herr' }, [
      h('button', { type: 'button', class: 'primario', text: 'Crear persona', onclick: async () => {
        const r = f.leer();
        const errores = r.errores.slice();
        const nombre = String(r.valores.persona_nombre || '').trim().toLowerCase();
        if (nombre && existentes.some(x => x.persona_nombre.trim().toLowerCase() === nombre)) errores.push('Ya hay una persona con ese nombre en esta organización: si es otra, agregale algo que las distinga.');
        if (errores.length) { err.textContent = errores.join(' '); return; }
        const creada = await seguro(() => repositorio.guardar('personas', { organizacion_id: ctx.org, ...r.valores, puesto_id: sel.value || null, persona_estado: 'activa' }, ctx.u.id));
        if (!creada) return;
        toast('Persona «' + creada.persona_nombre + '» creada');
        ir('#/persona/' + creada.id);
      } }),
      h('button', { type: 'button', text: 'Cancelar', onclick: () => ir('#/personas') })])]));
}

/**
 * @param {HTMLElement} cont @param {Contexto} ctx @param {Persona} p @param {string[]} partes @param {boolean} editando
 * @param {null|((cont: HTMLElement, o: any) => any)} notas @param {(v: boolean) => Promise<void>} cambiar @param {() => Promise<void>} rearmar
 */
async function dibujar(cont, ctx, p, partes, editando, notas, cambiar, rearmar) {
  const verLic = puede(ctx.u, 'ver', 'licencias', ctx.org), verRed = puede(ctx.u, 'ver', 'red', ctx.org);
  const [puestos, asigs, equipos, cuentas] = await Promise.all([
    repositorio.listar('puestos', { organizacion_id: ctx.org }, { ordenarPor: 'puesto_nombre' }),
    repositorio.listar('asignaciones', { persona_id: p.id }, { ordenarPor: 'asignacion_desde', descendente: true }),
    repositorio.listar('equipos', { organizacion_id: ctx.org }, { incluirBajas: true }),
    repositorio.listar('cuentas_dominio', { persona_id: p.id }, { ordenarPor: 'cuenta_usuario' })]);
  const me = new Map(equipos.map(e => [e.id, e]));
  const vigentes = asigs.filter(a => !a.asignacion_hasta);
  const pu = p.puesto_id ? puestos.find(x => x.id === p.puesto_id) : null;

  // ---- datos
  /** @type {HTMLElement} */
  let datos;
  /** @type {null|(() => {valores: Object<string, any>, errores: string[]})} */
  let leer = null;
  /** @type {HTMLSelectElement|null} */
  let selPuesto = null;
  const err = h('div', { class: 'rd-err', role: 'alert' });
  if (editando) {
    const f = formulario(CAMPOS, p);
    selPuesto = selectorPuesto(puestos, p.puesto_id);
    datos = h('div', { class: 'rd-edicion' }, [f.nodo, h('div', { class: 'campo', style: 'margin-top:8px;max-width:320px' }, [h('label', { text: 'Puesto habitual' }), selPuesto]),
      h('div', { class: 'mut', style: 'margin-top:6px', text: 'El estado (activa o en baja) se cambia con los botones de la ficha.' }), err]);
    leer = f.leer;
  } else {
    datos = h('div', { class: 'datos' }, [campo('Nombre y apellido', p.persona_nombre), campo('Sector', p.persona_sector),
      campo('Puesto habitual', pu ? (verRed ? enlace(pu.puesto_nombre, '#/puesto/' + pu.id) : pu.puesto_nombre) : null),
      campo('Estado', ROTULO_PERSONA_ESTADO[p.persona_estado]), campo('Equipos hoy', String(vigentes.length)), campo('Cuentas de dominio', String(cuentas.length)), campo('Notas', p.persona_notas)]);
  }
  const botones = /** @type {Node[]} */ ([]);
  if (editando) {
    botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
      const r = /** @type {Function} */ (leer)();
      if (r.errores.length) { err.textContent = r.errores.join(' '); return; }
      const otros = await repositorio.listar('personas', x => x.organizacion_id === ctx.org && x.id !== p.id);
      if (otros.some(x => x.persona_nombre.trim().toLowerCase() === String(r.valores.persona_nombre).trim().toLowerCase())) { err.textContent = 'Ya hay otra persona con ese nombre en esta organización.'; return; }
      if (!(await seguro(() => repositorio.guardar('personas', { ...p, ...r.valores, puesto_id: /** @type {HTMLSelectElement} */ (selPuesto).value || null }, ctx.u.id)))) return;
      toast('Cambios guardados · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); await cambiar(false);
    } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cambiar(false) }));
  } else {
    if (ctx.modifica) botones.push(h('button', { type: 'button', text: 'Editar', onclick: () => cambiar(true) }));
    if (ctx.modifica && verRed && puede(ctx.u, 'modificar', 'red', ctx.org) && p.persona_estado === 'activa') botones.push(h('button', { type: 'button', text: 'Mudar a otro puesto', title: 'Cambia su puesto y decide qué pasa con su equipo', onclick: () => modalMudar({ ctx, persona: p, alTerminar: rearmar }) }));
    if (ctx.modifica && p.persona_estado === 'activa') botones.push(h('button', { type: 'button', text: 'Pasar a baja', title: 'Ya no trabaja en la organización: se conserva por el historial', onclick: () => confirmarPasarABaja(ctx, p, vigentes, cuentas, equipos, rearmar) }));
    if (ctx.modifica && p.persona_estado === 'baja') botones.push(h('button', { type: 'button', text: 'Reactivar', onclick: async () => { if (await seguro(() => repositorio.guardar('personas', { ...p, persona_estado: 'activa' }, ctx.u.id, { motivo: 'Reactivación.' }))) { toast('Persona reactivada'); await rearmar(); } } }));
    const eliminable = () => {
      if (vigentes.length) { toast('Antes de eliminar la ficha, registrá la devolución de sus equipos.'); return false; }
      if (cuentas.length) { toast('Antes de eliminar la ficha, desvinculá o eliminá sus cuentas de dominio.'); return false; }
      return true;
    };
    if (ctx.baja) botones.push(h('button', { type: 'button', text: 'Eliminar ficha', title: 'Se oculta de listados y búsquedas; el historial se conserva', onclick: () => { if (eliminable()) confirmarEliminar(ctx, p); } }));
    else if (ctx.pideBaja) botones.push(h('button', { type: 'button', text: 'Pedir eliminar la ficha', title: 'Lo confirma el superadmin', onclick: () => { if (eliminable()) pedirBaja(ctx, 'personas', p.id); } }));
  }
  cont.appendChild(fichaCab({ ctx, tipo: 'persona', etiqueta: 'persona', titulo: p.persona_nombre, icono: 'persona', datos, botones, editando, registro: p, coleccion: 'personas',
    ultimoCambio: await textoUltimoCambio(ctx, 'Persona', p), alConfirmar: rearmar }));
  if (editando) return;
  if (p.persona_estado === 'baja') {
    const habil = cuentas.filter(c => c.cuenta_estado === 'habilitada');
    cont.appendChild(h('div', { class: 'msg mal', role: 'status', style: 'margin-top:8px', text: 'Esta persona está en baja.' + (vigentes.length ? ' Todavía figura con ' + vigentes.length + (vigentes.length === 1 ? ' equipo' : ' equipos') + ' asignado' + (vigentes.length === 1 ? '' : 's') + ': registrá la devolución.' : '')
      + (habil.length ? ' Tiene ' + habil.length + (habil.length === 1 ? ' cuenta habilitada' : ' cuentas habilitadas') + ' en el dominio: revisala.' : '') }));
  }

  // ---- pestañas
  const lic = verLic ? await licenciasDe(ctx, p, cuentas) : [];
  /** @type {Array<[string, string, string?]>} */
  const tabs = [['equipos', 'Equipos (' + vigentes.length + ')'], ['cuentas', 'Cuentas de dominio (' + cuentas.length + ')']];
  if (verLic) tabs.push(['licencias', 'Licencias (' + lic.length + ')']);
  if (notas) tabs.push(['notas', 'Notas']);
  tabs.push(['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']);
  if (ctx.historial) tabs.push(['historial', 'Historial']);
  const tab = tabs.some(t => t[0] === partes[1]) ? partes[1] : 'equipos';
  const barra = pestanas(tabs, tab, k => '#/persona/' + p.id + '/' + k);
  barra.style.margin = '8px 0 8px';
  cont.appendChild(barra);

  if (tab === 'equipos') cont.appendChild(await cuerpoEquipos(ctx, p, asigs, me, rearmar));
  else if (tab === 'cuentas') cont.appendChild(cuerpoCuentas(ctx, p, cuentas));
  else if (tab === 'licencias') cont.appendChild(cuerpoLicencias(lic));
  else if (tab === 'notas' && notas) {
    const zona = h('div');
    cont.appendChild(zona);
    try { await notas(zona, { entidad: 'Persona', entidadId: p.id, organizacionId: ctx.org }); } catch (e) { console.error(e); zona.appendChild(h('div', { class: 'aviso', text: 'No se pudieron mostrar las notas.' })); }
  } else if (tab === 'relaciones' || tab === 'archivos') {
    const zona = h('div'); cont.appendChild(zona);
    try {
      if (tab === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'Persona', entidadId: p.id, organizacionId: ctx.org });
      else await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'Persona', entidadId: p.id, organizacionId: ctx.org });
    } catch (e) { console.error(e); zona.appendChild(h('div', { class: 'aviso', text: 'No se pudo mostrar esta pestaña.' })); }
  } else cont.appendChild(await cuerpoHistorial(ctx, p, puestos));
}

/**
 * @param {Contexto} ctx @param {Persona} p @param {import('../assets/js/modelos.js').Asignacion[]} asigs @param {Map<string, any>} me @param {() => Promise<void>} rearmar
 */
async function cuerpoEquipos(ctx, p, asigs, me, rearmar) {
  const vigentes = asigs.filter(a => !a.asignacion_hasta);
  // Otras personas que tienen el mismo equipo hoy (equipo compartido, D-072).
  /** @type {Map<string, any[]>} */
  const comparte = new Map();
  for (const a of vigentes) {
    const otras = (await repositorio.asignacionesVigentes(a.equipo_id)).filter(x => x.persona_id !== p.id);
    comparte.set(a.equipo_id, (await Promise.all(otras.map(x => repositorio.obtener('personas', x.persona_id)))).filter(Boolean));
  }
  const cuerpo = h('div');
  const barra = h('div', { class: 'herr' }, [h('h3', { text: 'Asignación vigente', style: 'margin:0' }), h('span', { style: 'flex:1' }),
    ctx.modifica && p.persona_estado === 'activa' ? h('button', { type: 'button', class: 'primario', text: 'Asignar equipo', onclick: () => modalAsignar({ ctx, persona: p, alTerminar: rearmar }) }) : null]);
  cuerpo.appendChild(barra);
  if (!vigentes.length) {
    cuerpo.appendChild(h('div', { class: 'aviso', text: p.persona_estado === 'baja' ? 'No tiene equipos asignados hoy.' : 'No tiene equipos asignados hoy.' + (ctx.modifica ? ' Usá «Asignar equipo» para entregarle uno.' : '') }));
  } else {
    cuerpo.appendChild(tabla(['Equipo', 'Tipo', 'IP', 'Compartido con', 'Desde', 'Motivo', ''], vigentes.map(a => {
      const e = me.get(a.equipo_id);
      const otras = comparte.get(a.equipo_id) || [];
      return [e ? enlaceFila(e.equipo_nombre, hashDeEquipo(e)) : '—', e ? tipoEquipo(e) : '—', e && e.equipo_ip_gestion ? e.equipo_ip_gestion : '—',
        otras.length ? h('span', null, otras.map((x, i) => h('span', null, [i ? ', ' : '', enlaceFila(x.persona_nombre, '#/persona/' + x.id + '/equipos')]))) : '—', fmtFecha(a.asignacion_desde), a.asignacion_motivo || '—',
        ctx.modifica && e ? h('button', { type: 'button', class: 'chico', text: 'Devolver', onclick: () => modalDevolver(ctx, e, p.persona_nombre, rearmar, p.id) }) : ''];
    })));
  }
  cuerpo.appendChild(h('h3', { text: 'Historial completo de asignaciones', style: 'margin:16px 0 6px' }));
  if (!asigs.length) cuerpo.appendChild(h('div', { class: 'aviso', text: 'Esta persona todavía no tuvo equipos asignados.' }));
  else {
    cuerpo.appendChild(tabla(['Equipo', 'Desde', 'Hasta', 'Motivo', 'Observaciones'], asigs.map(a => {
      const e = me.get(a.equipo_id);
      return [e ? enlaceFila(e.equipo_nombre + (e.eliminado_en ? ' (dado de baja)' : ''), hashDeEquipo(e)) : '—', fmtFecha(a.asignacion_desde), a.asignacion_hasta ? fmtFecha(a.asignacion_hasta) : 'Hoy', a.asignacion_motivo || '—', a.asignacion_observaciones || '—'];
    })));
    cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: asigs.length + (asigs.length === 1 ? ' asignación' : ' asignaciones') + ' en total.' }));
  }
  return cuerpo;
}

/** @param {Contexto} ctx @param {Persona} p @param {import('../assets/js/modelos.js').CuentaDominio[]} cuentas */
function cuerpoCuentas(ctx, p, cuentas) {
  const cuerpo = h('div');
  cuerpo.appendChild(h('div', { class: 'herr' }, [h('span', { style: 'flex:1' }),
    ctx.modifica ? h('button', { type: 'button', class: 'primario', text: 'Nueva cuenta', onclick: () => ir('#/cuenta/nueva?persona=' + p.id) }) : null]));
  if (!cuentas.length) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'Esta persona no tiene cuentas de dominio.' + (ctx.modifica ? ' Usá «Nueva cuenta» para cargar la suya.' : '') })); return cuerpo; }
  cuerpo.appendChild(tabla(['Cuenta', 'Unidad organizativa', 'Grupos', 'Estado', 'Verificado'], cuentas.map(c => [enlaceFila(nombreCuenta(c), '#/cuenta/' + c.id), c.cuenta_unidad_organizativa || '—', (c.cuenta_grupos || []).join(', ') || '—',
    h('span', null, [pillCuenta(c.cuenta_estado), p.persona_estado === 'baja' && c.cuenta_estado === 'habilitada' ? alertaCuentaDeBaja() : null]), indicadorVerificacion(c.verificado_en, ctx.umbrales, true)]),
  { tipo: 'persona', onFila: (_f, i) => ir('#/cuenta/' + cuentas[i].id) }));
  return cuerpo;
}

/**
 * Instalaciones de licencias donde figura la persona o alguna de sus cuentas.
 * @param {Contexto} ctx @param {Persona} p @param {import('../assets/js/modelos.js').CuentaDominio[]} cuentas
 */
async function licenciasDe(ctx, p, cuentas) {
  const ids = new Set(cuentas.map(c => c.id));
  const [insts, licencias, equipos] = await Promise.all([
    repositorio.listar('instalaciones_licencia', i => i.organizacion_id === ctx.org && (i.persona_id === p.id || (!!i.cuenta_id && ids.has(i.cuenta_id)))),
    repositorio.listar('licencias', { organizacion_id: ctx.org }), repositorio.listar('equipos', { organizacion_id: ctx.org }, { incluirBajas: true })]);
  const ml = new Map(licencias.map(l => [l.id, l])), me = new Map(equipos.map(e => [e.id, e])), mc = new Map(cuentas.map(c => [c.id, c]));
  return insts.sort((a, b) => Number(!!a.instalacion_hasta) - Number(!!b.instalacion_hasta) || (a.instalacion_desde < b.instalacion_desde ? 1 : -1)).map(i => ({ i, l: ml.get(i.licencia_id), e: me.get(i.equipo_id), c: i.cuenta_id ? mc.get(i.cuenta_id) : null }));
}

/** @param {Array<{i: any, l: any, e: any, c: any}>} lic */
function cuerpoLicencias(lic) {
  if (!lic.length) return h('div', { class: 'aviso', text: 'No figura en ninguna instalación de licencia, ni con su nombre ni con sus cuentas.' });
  return h('div', null, [tabla(['Licencia', 'Equipo', 'Usada con', 'Desde', 'Hasta'], lic.map(x => [x.l ? enlaceFila(x.l.licencia_producto, '#/licencia/' + x.l.id) : '—', x.e ? enlaceFila(x.e.equipo_nombre, hashDeEquipo(x.e)) : '—',
    x.c ? nombreCuenta(x.c) : 'La persona', fmtFecha(x.i.instalacion_desde), x.i.instalacion_hasta ? fmtFecha(x.i.instalacion_hasta) : 'Sigue instalada'])),
  h('div', { class: 'mut', style: 'margin-top:6px', text: 'Solo lectura. Las instalaciones se administran desde la ficha de la licencia.' })]);
}

/** @param {Contexto} ctx @param {Persona} p @param {any[]} puestos */
async function cuerpoHistorial(ctx, p, puestos) {
  const cs = await repositorio.listar('cambios', c => c.cambio_entidad === 'Persona' && c.entidad_id === p.id, { ordenarPor: 'cambio_fecha', descendente: true });
  if (!cs.length) return h('div', { class: 'aviso', text: 'Esta persona todavía no tiene cambios registrados.' });
  /** @type {Object<string, string>} */
  const rot = { persona_nombre: 'Nombre', persona_sector: 'Sector', puesto_id: 'Puesto', persona_estado: 'Estado', persona_notas: 'Notas' };
  const pn = new Map(puestos.map(x => [x.id, x.puesto_nombre]));
  /** @param {string|null} v */
  const val = v => { const t = valorHistorial(v); return pn.get(t) || /** @type {any} */ (ROTULO_PERSONA_ESTADO)[t] || t; };
  const nombreOp = /** @type {Object<string, string>} */ ({ alta: 'Alta', baja: 'Eliminación', restauracion: 'Restauración', modificacion: 'Cambio' });
  return tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cs.map(c => [fmtFechaHora(c.cambio_fecha), ctx.nombresUsuario.get(c.usuario_id) || '—',
    c.cambio_campo ? (rot[c.cambio_campo] || c.cambio_campo) : nombreOp[c.cambio_operacion], c.cambio_campo ? val(c.cambio_valor_anterior) : '—', c.cambio_campo ? val(c.cambio_valor_nuevo) : '—']));
}

/**
 * Pasar a baja: devuelve los equipos vigentes y marca a la persona en baja. Avisa de las cuentas habilitadas.
 * @param {Contexto} ctx @param {Persona} p @param {import('../assets/js/modelos.js').Asignacion[]} vigentes @param {import('../assets/js/modelos.js').CuentaDominio[]} cuentas @param {any[]} equipos @param {() => Promise<void>} rearmar
 */
function confirmarPasarABaja(ctx, p, vigentes, cuentas, equipos, rearmar) {
  const me = new Map(equipos.map(e => [e.id, e]));
  const habil = cuentas.filter(c => c.cuenta_estado === 'habilitada');
  abrirModal(h('div', { class: 'pe-modal', role: 'alertdialog', 'aria-label': 'Pasar a baja' }, [
    h('h2', { text: 'Pasar a baja a ' + p.persona_nombre }),
    h('p', { text: 'La persona deja de trabajar en la organización. Se conserva su ficha y su historial.' }),
    vigentes.length ? h('p', { text: 'Se registra hoy la devolución de: ' + vigentes.map(a => (me.get(a.equipo_id) || { equipo_nombre: '—' }).equipo_nombre).join(', ') + '.' }) : h('p', { class: 'mut', text: 'No tiene equipos asignados.' }),
    habil.length ? h('p', { class: 'msg mal', text: 'Tiene cuentas habilitadas en el dominio (' + habil.map(nombreCuenta).join(', ') + '). No se tocan desde acá: deshabilitalas en el dominio y después en su ficha.' }) : null,
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      h('button', { type: 'button', class: 'primario', text: 'Sí, pasar a baja', onclick: async () => {
        const ok = await seguro(async () => {
          for (const a of vigentes) await repositorio.devolverEquipo({ equipoId: a.equipo_id, personaId: p.id, usuarioId: ctx.u.id, observaciones: 'Baja de la persona.' });
          return repositorio.guardar('personas', { ...p, persona_estado: 'baja' }, ctx.u.id, { motivo: 'La persona dejó la organización.' });
        });
        cerrarModal();
        if (ok) { toast('«' + p.persona_nombre + '» pasó a baja'); await rearmar(); }
      } })])]));
}

/** @param {Contexto} ctx @param {Persona} p */
function confirmarEliminar(ctx, p) {
  abrirModal(h('div', { class: 'pe-modal', role: 'alertdialog', 'aria-label': 'Eliminar ficha' }, [
    h('h2', { text: 'Eliminar la ficha de ' + p.persona_nombre }),
    h('p', { text: 'La ficha deja de aparecer en listados y búsquedas. El historial se conserva y se puede revertir desde el historial de cambios.' }),
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      h('button', { type: 'button', class: 'primario', text: 'Sí, eliminar', onclick: async () => {
        const ok = await seguro(() => repositorio.guardar('personas', { ...p, eliminado_en: ahoraISO() }, ctx.u.id));
        cerrarModal();
        if (ok) { toast('Ficha eliminada'); ir('#/personas'); }
      } })])]));
}
