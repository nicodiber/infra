// @ts-check
/**
 * Lógica y componentes compartidos por las pantallas de Personas (listado, ficha de persona, ficha de cuenta de dominio)
 * y por el bloque «Asignado a» de la ficha de equipo (D-057, D-066): contexto con los permisos del módulo `personas`,
 * ventanas para asignar y devolver equipos, y estilos propios (clases con prefijo `pe-`).
 * Datos solo con `repositorio`; permisos solo con `permisos`.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import { ir, toast, abrirModal, cerrarModal } from './marco.js';
import { h, tabla, fmtFecha, normalizar } from './utiles.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_PERSONA_ESTADO, ROTULO_CUENTA_ESTADO } from './modelos.js';
import { seguro, CATEGORIAS_PUESTO } from './red.js';
import { abrirAlta } from './altas.js';

/** @typedef {import('./red.js').Contexto} Contexto */
/** @typedef {import('./modelos.js').Equipo} Equipo */
/** @typedef {import('./modelos.js').Persona} Persona */
/** @typedef {import('./modelos.js').CuentaDominio} CuentaDominio */
/** @typedef {import('./modelos.js').Asignacion} Asignacion */

/** Categorías de «otro» que son equipos de escritorio (PC y notebooks). */
const CATEGORIAS_ESCRITORIO = ['PC de escritorio', 'Notebook'];


/** Usuario, organización activa, umbrales y permisos del módulo Personas (misma forma que el contexto de Red). @returns {Promise<Contexto>} */
export async function cargarContextoPersonas() {
  const u = /** @type {import('./modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = /** @type {string} */ (sesion.organizacionActiva());
  const [umbrales, usuarios] = await Promise.all([repositorio.umbralesVerificacion(), repositorio.listar('usuarios')]);
  return {
    u, org, umbrales, nombresUsuario: new Map(usuarios.map(x => [x.id, x.usuario_nombre])),
    modifica: puede(u, 'modificar', 'personas', org), verifica: puede(u, 'verificar', 'personas', org),
    historial: puede(u, 'ver_historial', 'personas', org), baja: puede(u, 'baja', 'personas', org), pideBaja: puede(u, 'pedir_baja', 'personas', org)
  };
}

/** Aviso de falta de permiso o de registro inexistente. @param {HTMLElement} cont @param {string} texto @param {string} [hash] */
export function avisoPersonas(cont, texto, hash) {
  cont.appendChild(h('div', { class: 'aviso' }, [h('div', { text: texto }), h('div', { style: 'margin-top:8px' }, [h('a', { href: hash || '#/inicio', text: hash ? 'Volver a Personas' : 'Volver al inicio' })])]));
}

/** Enlace para usar dentro de una fila clicable: navega sin disparar el clic de la fila. @param {string} texto @param {string} hash */
export function enlaceFila(texto, hash) {
  return h('a', { href: hash, text: texto, onclick: (/** @type {Event} */ e) => { e.preventDefault(); e.stopPropagation(); ir(hash); } });
}

/** `DOMINIO\usuario` de una cuenta. @param {CuentaDominio} c */
export function nombreCuenta(c) { return c.cuenta_dominio + '\\' + c.cuenta_usuario; }

/** ¿Es una PC de escritorio o una notebook? @param {Equipo} e */
export function esEquipoDeEscritorio(e) {
  return e.equipo_tipo === 'otro' && !!e.equipo_campos && CATEGORIAS_ESCRITORIO.includes(String(e.equipo_campos.otro_categoria));
}

/** Tipo legible de un equipo. @param {Equipo} e */
export function tipoEquipo(e) {
  const cat = e.equipo_tipo === 'otro' && e.equipo_campos && e.equipo_campos.otro_categoria ? String(e.equipo_campos.otro_categoria) : '';
  return cat || ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo;
}

/** Hash de la ficha de un equipo. @param {{id: string, equipo_tipo: string}} e */
export function hashDeEquipo(e) { return (e.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + e.id; }

/** Estado de una persona con símbolo propio (no solo color). @param {string} estado */
export function pillPersona(estado) {
  return h('span', { class: 'pe-estado' + (estado === 'baja' ? ' off' : ''), text: /** @type {any} */ (ROTULO_PERSONA_ESTADO)[estado] || estado });
}

/** Estado de una cuenta con símbolo propio (no solo color). @param {string} estado */
export function pillCuenta(estado) {
  return h('span', { class: 'pe-estado' + (estado === 'deshabilitada' ? ' off' : ''), text: /** @type {any} */ (ROTULO_CUENTA_ESTADO)[estado] || estado });
}

/** Aviso a la vista para una cuenta habilitada de una persona que ya no trabaja ahí. */
export function alertaCuentaDeBaja() {
  return h('span', { class: 'pe-alerta', title: 'La persona está en baja pero la cuenta sigue habilitada en el dominio: conviene revisarla.', text: 'Persona en baja' });
}

/**
 * Asignar un equipo a una persona: abre el alta registrada de `asignaciones` (`assets/js/altas/asignaciones.js`) con la persona o el
 * equipo ya elegidos. Ahí se puede crear la persona o el equipo que falte y se decide si reemplaza o comparte (D-072).
 * @param {Object} o
 * @param {Contexto} o.ctx
 * @param {Equipo} [o.equipo] @param {Persona} [o.persona]
 * @param {() => (void|Promise<void>)} o.alTerminar
 */
export async function modalAsignar(o) {
  const creada = await abrirAlta('asignaciones', { organizacion_id: o.ctx.org, valores: { equipo_id: o.equipo ? o.equipo.id : null, persona_id: o.persona ? o.persona.id : null } });
  if (!creada) return;
  toast('Equipo asignado · queda en el historial de asignaciones');
  await o.alTerminar();
}

/**
 * Ventana para registrar la devolución de un equipo por una persona (cierra su asignación vigente desde hoy). Si el equipo está
 * compartido, las demás personas lo siguen teniendo.
 * @param {Contexto} ctx @param {{id: string, equipo_nombre: string}} equipo @param {string} quien Nombre de la persona.
 * @param {() => (void|Promise<void>)} alTerminar @param {string|null} [personaId] Id de la persona que devuelve (si falta, se devuelve a todas).
 */
export function modalDevolver(ctx, equipo, quien, alTerminar, personaId) {
  const obs = /** @type {HTMLInputElement} */ (h('input', { type: 'text', placeholder: 'Por ejemplo: devuelto con cargador, sin la funda (opcional)', 'aria-label': 'Observaciones' }));
  abrirModal(h('div', { class: 'pe-modal', role: 'dialog', 'aria-label': 'Devolver equipo' }, [
    h('h2', { text: 'Devolver «' + equipo.equipo_nombre + '»' }),
    h('p', { text: personaId ? quien + ' devuelve el equipo. Su asignación se cierra hoy; si el equipo lo comparten otras personas, lo siguen teniendo. El historial se conserva.' : 'Se cierra hoy la asignación del equipo y queda sin asignar; el historial se conserva.' }),
    h('div', { class: 'campo' }, [h('label', { text: 'Observaciones' }), obs]),
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      h('button', { type: 'button', class: 'primario', text: 'Registrar devolución', onclick: async () => {
        const r = await seguro(() => repositorio.devolverEquipo({ equipoId: equipo.id, personaId: personaId || null, usuarioId: ctx.u.id, observaciones: obs.value }));
        if (!r) return;
        cerrarModal(); toast('Devolución registrada'); await alTerminar();
      } })])]));
  obs.focus();
}

/**
 * Tabla con todas las asignaciones de un equipo (la más reciente primero), en una ventana.
 * @param {Contexto} ctx @param {Equipo} equipo
 */
export async function modalHistorialAsignaciones(ctx, equipo) {
  const [asigs, personas] = await Promise.all([repositorio.listar('asignaciones', { equipo_id: equipo.id }, { ordenarPor: 'asignacion_desde', descendente: true }), repositorio.listar('personas', { organizacion_id: ctx.org })]);
  const mp = new Map(personas.map(p => [p.id, p]));
  const verPersonas = puede(ctx.u, 'ver', 'personas', ctx.org);
  abrirModal(h('div', { class: 'pe-modal', style: 'width:760px', role: 'dialog', 'aria-label': 'Historial de asignaciones' }, [
    h('h2', { text: 'Asignaciones de «' + equipo.equipo_nombre + '»' }),
    !asigs.length ? h('div', { class: 'aviso', text: 'Este equipo nunca se asignó a nadie.' })
      : tabla(['Persona', 'Desde', 'Hasta', 'Motivo', 'Observaciones'], asigs.map(a => {
        const p = mp.get(a.persona_id);
        return [p && verPersonas ? enlaceFila(p.persona_nombre, '#/persona/' + p.id + '/equipos') : p ? p.persona_nombre : '—', fmtFecha(a.asignacion_desde), a.asignacion_hasta ? fmtFecha(a.asignacion_hasta) : 'Hoy', a.asignacion_motivo || '—', a.asignacion_observaciones || '—'];
      })),
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cerrar', onclick: () => cerrarModal() })])]));
}

/**
 * Bloque «Asignado a» de la ficha de equipo: todas las personas que lo tienen hoy (puede ser compartido, D-072), con «Devolver» por
 * persona, «Asignar» (reemplazar o compartir) e historial.
 * Devuelve null si el equipo no es de escritorio ni tiene asignaciones, o si el rol no ve el módulo Personas.
 * @param {Contexto} ctx @param {Equipo} e @param {() => (void|Promise<void>)} rearmar
 * @returns {Promise<HTMLElement|null>}
 */
export async function bloqueAsignacion(ctx, e, rearmar) {
  if (!puede(ctx.u, 'ver', 'personas', ctx.org)) return null;
  const asigs = await repositorio.listar('asignaciones', { equipo_id: e.id });
  if (!esEquipoDeEscritorio(e) && !asigs.length) return null;
  const vigentes = asigs.filter(a => !a.asignacion_hasta).sort((a, b) => (a.asignacion_desde < b.asignacion_desde ? 1 : a.asignacion_desde > b.asignacion_desde ? -1 : 0));
  const filas = (await Promise.all(vigentes.map(async a => ({ a, p: await repositorio.obtener('personas', a.persona_id) })))).filter(x => x.p);
  const modifica = puede(ctx.u, 'modificar', 'personas', ctx.org);
  const botones = /** @type {Node[]} */ ([]);
  if (modifica) botones.push(h('button', { type: 'button', class: 'chico', text: filas.length ? 'Asignar a otra persona' : 'Asignar', title: filas.length ? 'Reemplazar a la persona actual o compartir el equipo' : '', onclick: () => modalAsignar({ ctx, equipo: e, alTerminar: rearmar }) }));
  botones.push(h('button', { type: 'button', class: 'chico', text: 'Historial de asignaciones (' + asigs.length + ')', onclick: () => modalHistorialAsignaciones(ctx, e) }));
  /** @type {Node[]} */
  const cuerpo = filas.length
    ? filas.map(({ a, p }) => {
      const per = /** @type {Persona} */ (p);
      return h('div', { class: 'pe-asig', style: 'margin-bottom:6px' }, [
        h('div', null, [h('a', { class: 'quien', href: '#/persona/' + per.id + '/equipos', text: per.persona_nombre, onclick: (/** @type {Event} */ ev) => { ev.preventDefault(); ir('#/persona/' + per.id + '/equipos'); } }),
          h('div', { class: 'mut', text: 'Desde el ' + fmtFecha(a.asignacion_desde) + (a.asignacion_motivo ? ' · ' + a.asignacion_motivo : '') })]),
        h('span', { style: 'flex:1' }),
        modifica ? h('button', { type: 'button', class: 'chico', text: 'Devolver', 'aria-label': 'Devolver el equipo (' + per.persona_nombre + ')', onclick: () => modalDevolver(ctx, e, per.persona_nombre, rearmar, per.id) }) : null]);
    })
    : [h('div', null, [h('span', { class: 'quien', text: 'Sin asignar' }), h('div', { class: 'mut', text: modifica ? 'Nadie tiene este equipo hoy. Tocá «Asignar» para entregarlo.' : 'Nadie tiene este equipo hoy.' })])];
  return h('div', { class: 'bloque', style: 'margin-top:10px' }, [
    h('div', { class: 'herr', style: 'margin:0 0 6px' }, [h('h3', { text: filas.length > 1 ? 'Asignado a (compartido por ' + filas.length + ' personas)' : 'Asignado a', style: 'margin:0' }), h('span', { style: 'flex:1' }), ...botones]),
    ...cuerpo]);
}

/**
 * Mudanza de una persona a otro puesto (D-067, MJ45). Si el repositorio ofrece `mudarPersona` lo usa; si no, la compone con
 * `moverEquipoAPuesto`, `asignarEquipo`, `devolverEquipo` y `guardar`. Reemplazable por la del repositorio sin cambiar quien la llama.
 * @param {{personaId: string, puestoId: string, conEquipo: boolean, usuarioId: string}} datos
 * @returns {Promise<{equiposMovidos: string[], equiposDevueltos: string[], equiposAsignados: string[], sinEquipoLibre: boolean, vlanAnterior: any, vlanNueva: any, cambiaVlan: boolean}>}
 */
export async function mudarPersona(datos) {
  const repo = /** @type {any} */ (repositorio);
  if (typeof repo.mudarPersona === 'function') return repo.mudarPersona(datos);
  const p = await repositorio.obtener('personas', datos.personaId);
  if (!p) throw new Error('La persona no existe.');
  const plan = await planMudanza(p, datos.puestoId);
  /** @type {any} */
  const r = { equiposMovidos: [], equiposDevueltos: [], equiposAsignados: [], sinEquipoLibre: false, vlanAnterior: null, vlanNueva: null, cambiaVlan: false };
  if (datos.conEquipo) {
    for (const e of plan.suyos) {
      const m = await repositorio.moverEquipoAPuesto({ equipoId: e.id, puestoId: datos.puestoId, usuarioId: datos.usuarioId });
      r.equiposMovidos.push(e.equipo_nombre);
      if (!r.vlanAnterior) r.vlanAnterior = m.vlanAnterior;
      r.vlanNueva = m.vlanNueva; r.cambiaVlan = r.cambiaVlan || m.cambiaVlan;
    }
  } else {
    for (const e of plan.suyos) { await repositorio.devolverEquipo({ equipoId: e.id, personaId: p.id, usuarioId: datos.usuarioId, observaciones: 'Mudanza a otro puesto.' }); r.equiposDevueltos.push(e.equipo_nombre); }
    for (const e of plan.libresDestino) { await repositorio.asignarEquipo({ equipoId: e.id, personaId: p.id, motivo: 'Mudanza al puesto ' + plan.puesto.puesto_nombre + '.', usuarioId: datos.usuarioId }); r.equiposAsignados.push(e.equipo_nombre); }
    r.sinEquipoLibre = !plan.libresDestino.length;
  }
  await repositorio.guardar('personas', { ...p, puesto_id: datos.puestoId }, datos.usuarioId, { motivo: 'Mudanza al puesto ' + plan.puesto.puesto_nombre + '.' });
  return r;
}

/**
 * Qué pasaría con una mudanza: equipos asignados hoy a la persona (sin los de rack), equipos libres del puesto nuevo y VLAN de ambos.
 * @param {Persona} p @param {string} puestoId
 */
async function planMudanza(p, puestoId) {
  const [puesto, equipos, asigs] = await Promise.all([repositorio.obtener('puestos', puestoId), repositorio.listar('equipos', { organizacion_id: p.organizacion_id }), repositorio.listar('asignaciones', { organizacion_id: p.organizacion_id })]);
  if (!puesto) throw new Error('El puesto no existe.');
  const vigentes = asigs.filter(a => !a.asignacion_hasta);
  const ocupados = new Set(vigentes.map(a => a.equipo_id));
  const suyosIds = new Set(vigentes.filter(a => a.persona_id === p.id).map(a => a.equipo_id));
  const suyos = equipos.filter(e => suyosIds.has(e.id) && !e.rack_id);
  const libresDestino = equipos.filter(e => e.puesto_id === puestoId && e.equipo_estado !== 'baja' && !ocupados.has(e.id) && !e.rack_id
    && e.equipo_tipo === 'otro' && CATEGORIAS_PUESTO.includes(String(e.equipo_campos && e.equipo_campos.otro_categoria)));
  const [vlanAnterior, vlanNueva] = await Promise.all([repositorio.vlanDePuesto(p.puesto_id), repositorio.vlanDePuesto(puestoId)]);
  return { puesto, suyos, libresDestino, vlanAnterior, vlanNueva, cambiaVlan: !!(vlanAnterior && vlanNueva && vlanAnterior.id !== vlanNueva.id) };
}

/**
 * Asistente «Mudar a otro puesto» en un modal de 3 pasos: puesto destino, ¿se lleva su equipo? y resumen/confirmación.
 * @param {{ctx: Contexto, persona: Persona, alTerminar: () => (void|Promise<void>)}} o
 */
export async function modalMudar(o) {
  const { ctx, persona: p } = o;
  const [puestos, ubicaciones, personas, equipos, asigs] = await Promise.all([
    repositorio.listar('puestos', { organizacion_id: ctx.org }, { ordenarPor: 'puesto_nombre' }), repositorio.listar('ubicaciones', { organizacion_id: ctx.org }),
    repositorio.listar('personas', { organizacion_id: ctx.org }), repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('asignaciones', { organizacion_id: ctx.org })]);
  const mu = new Map(ubicaciones.map(u => [u.id, u.ubicacion_nombre]));
  const vlans = new Map(await Promise.all(puestos.map(async x => /** @type {[string, any]} */ ([x.id, await repositorio.vlanDePuesto(x.id)]))));
  const rotuloVlan = (/** @type {any} */ v) => v ? 'VLAN ' + (v.vlan_numero != null ? v.vlan_numero + ' · ' : '') + (v.vlan_nombre || '') : 'sin VLAN conocida';
  /** @param {any} x */
  const info = x => {
    const ocup = personas.filter(q => q.puesto_id === x.id && q.persona_estado !== 'baja' && q.id !== p.id).map(q => q.persona_nombre);
    const eq = equipos.filter(e => e.puesto_id === x.id && e.equipo_estado !== 'baja').length;
    return { ocup, eq, texto: x.puesto_nombre + (x.puesto_boca_pared && x.puesto_boca_pared !== x.puesto_nombre ? ' (boca ' + x.puesto_boca_pared + ')' : '') + ' · ' + (mu.get(x.ubicacion_id) || '—') + ' · ' + (ocup.length ? 'ocupado por ' + ocup.join(', ') : 'vacío') + ' · ' + rotuloVlan(vlans.get(x.id)) };
  };
  const items = puestos.filter(x => x.id !== p.puesto_id).map(x => ({ x, i: info(x), busca: normalizar(x.puesto_nombre + ' ' + (x.puesto_boca_pared || '') + ' ' + (mu.get(x.ubicacion_id) || '') + ' ' + info(x).ocup.join(' ')) }));
  /** @type {{paso: number, puestoId: string, conEquipo: boolean|null}} */
  const st = { paso: 1, puestoId: '', conEquipo: null };
  const cuerpo = h('div');
  const error = h('div', { class: 'rd-err', role: 'alert' });
  const pintar = async () => {
    cuerpo.textContent = ''; error.textContent = '';
    const nav = (/** @type {Node|null} */ sig, /** @type {boolean} */ atras) => h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      atras ? h('button', { type: 'button', text: 'Atrás', onclick: () => { st.paso--; pintar(); } }) : null, sig]);
    cuerpo.appendChild(h('div', { class: 'mut', text: 'Paso ' + st.paso + ' de 3' }));
    if (st.paso === 1) {
      const buscador = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Buscar por boca, sede o sala o persona…', 'aria-label': 'Buscar puesto' }));
      const lista = /** @type {HTMLSelectElement} */ (h('select', { size: '8', 'aria-label': 'Puestos', style: 'height:190px' }));
      const llenar = () => {
        const pal = normalizar(buscador.value).split(/\s+/).filter(Boolean); lista.textContent = '';
        const vis = items.filter(t => pal.every(w => t.busca.includes(w)));
        for (const t of vis) { const op = h('option', { value: t.x.id, text: t.i.texto }); if (t.x.id === st.puestoId) /** @type {HTMLOptionElement} */ (op).selected = true; lista.appendChild(op); }
        if (!vis.length) lista.appendChild(h('option', { value: '', disabled: 'disabled', text: 'Nada coincide con la búsqueda.' }));
      };
      buscador.addEventListener('input', llenar); lista.addEventListener('change', () => { st.puestoId = lista.value; });
      cuerpo.appendChild(h('h3', { text: '¿A qué puesto se muda?', style: 'margin:8px 0 0' }));
      cuerpo.appendChild(h('div', { class: 'mut', text: 'Hoy: ' + (p.puesto_id && puestos.find(x => x.id === p.puesto_id) ? /** @type {any} */ (puestos.find(x => x.id === p.puesto_id)).puesto_nombre : 'sin puesto fijo') + '.' }));
      cuerpo.appendChild(buscador); cuerpo.appendChild(lista); llenar();
      cuerpo.appendChild(error);
      cuerpo.appendChild(nav(h('button', { type: 'button', class: 'primario', text: 'Siguiente', onclick: () => { if (!st.puestoId) { error.textContent = 'Elegí el puesto de destino.'; return; } st.paso = 2; pintar(); } }), false));
      buscador.focus();
    } else if (st.paso === 2) {
      const plan = await planMudanza(p, st.puestoId);
      const opcion = (/** @type {boolean} */ v, /** @type {string} */ tit, /** @type {string} */ expl, /** @type {string|null} */ aviso) => {
        const r = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'llevaEquipo', id: 'mud' + (v ? 'si' : 'no') }));
        r.checked = st.conEquipo === v; r.addEventListener('change', () => { st.conEquipo = v; });
        return h('label', { class: 'bloque', style: 'display:block;margin-top:8px;cursor:pointer' }, [h('div', null, [r, h('strong', { text: ' ' + tit })]), h('div', { class: 'mut', text: expl }), aviso ? h('div', { class: 'msg mal', role: 'status', text: aviso }) : null]);
      };
      cuerpo.appendChild(h('h3', { text: '¿Se lleva su equipo?', style: 'margin:8px 0 0' }));
      cuerpo.appendChild(opcion(true, 'Sí, se lleva su equipo', plan.suyos.length ? 'Se mueven al puesto nuevo: ' + plan.suyos.map(e => e.equipo_nombre).join(', ') + '.' : 'No tiene equipos asignados hoy: solo cambia de puesto.',
        plan.suyos.length && plan.cambiaVlan ? 'Atención: la VLAN del puerto del puesto nuevo es distinta (' + rotuloVlan(plan.vlanAnterior) + ' → ' + rotuloVlan(plan.vlanNueva) + '). El equipo puede necesitar otra IP o repatchear.' : null));
      cuerpo.appendChild(opcion(false, 'No, usa el equipo del puesto nuevo', 'Se devuelven sus equipos' + (plan.suyos.length ? ' (' + plan.suyos.map(e => e.equipo_nombre).join(', ') + ')' : '') + ' y se le asignan los que están libres en el puesto nuevo' + (plan.libresDestino.length ? ': ' + plan.libresDestino.map(e => e.equipo_nombre).join(', ') + '.' : '.'),
        plan.libresDestino.length ? null : 'El puesto nuevo no tiene equipo libre: la persona se muda sin equipo y habrá que asignarle uno.'));
      cuerpo.appendChild(error);
      cuerpo.appendChild(nav(h('button', { type: 'button', class: 'primario', text: 'Siguiente', onclick: () => { if (st.conEquipo === null) { error.textContent = 'Elegí una de las dos opciones.'; return; } st.paso = 3; pintar(); } }), true));
    } else {
      const plan = await planMudanza(p, st.puestoId);
      const lineas = ['Se muda a ' + p.persona_nombre + ' al puesto «' + plan.puesto.puesto_nombre + '» (' + (mu.get(plan.puesto.ubicacion_id) || '—') + ').'];
      if (st.conEquipo) lineas.push(plan.suyos.length ? 'Sus equipos pasan al puesto nuevo: ' + plan.suyos.map(e => e.equipo_nombre).join(', ') + '.' : 'No tiene equipos asignados que mover.');
      else {
        lineas.push(plan.suyos.length ? 'Devuelve: ' + plan.suyos.map(e => e.equipo_nombre).join(', ') + '.' : 'No tiene equipos asignados que devolver.');
        lineas.push(plan.libresDestino.length ? 'Se le asignan: ' + plan.libresDestino.map(e => e.equipo_nombre).join(', ') + '.' : 'El puesto nuevo no tiene equipo libre: queda sin equipo.');
      }
      cuerpo.appendChild(h('h3', { text: 'Resumen', style: 'margin:8px 0' }));
      for (const l of lineas) cuerpo.appendChild(h('p', { style: 'margin:4px 0', text: l }));
      if (st.conEquipo && plan.suyos.length && plan.cambiaVlan) cuerpo.appendChild(h('div', { class: 'msg mal', role: 'status', text: 'La VLAN cambia (' + rotuloVlan(plan.vlanAnterior) + ' → ' + rotuloVlan(plan.vlanNueva) + '): puede necesitar otra IP o repatchear.' }));
      cuerpo.appendChild(error);
      cuerpo.appendChild(nav(h('button', { type: 'button', class: 'primario', text: 'Confirmar', onclick: async () => {
        const r = await seguro(() => mudarPersona({ personaId: p.id, puestoId: st.puestoId, conEquipo: !!st.conEquipo, usuarioId: ctx.u.id }));
        if (!r) return;
        cuerpo.textContent = '';
        const hecho = ['Listo: ' + p.persona_nombre + ' ahora está en «' + plan.puesto.puesto_nombre + '».'];
        if (r.equiposMovidos.length) hecho.push('Equipos movidos: ' + r.equiposMovidos.join(', ') + '.');
        if (r.equiposDevueltos.length) hecho.push('Equipos devueltos: ' + r.equiposDevueltos.join(', ') + '.');
        if (r.equiposAsignados.length) hecho.push('Equipos asignados: ' + r.equiposAsignados.join(', ') + '.');
        if (r.sinEquipoLibre) hecho.push('El puesto nuevo no tenía equipo libre: falta asignarle uno.');
        cuerpo.appendChild(h('h3', { text: 'Mudanza hecha', style: 'margin:8px 0' }));
        for (const l of hecho) cuerpo.appendChild(h('p', { style: 'margin:4px 0', text: l }));
        if (r.cambiaVlan) cuerpo.appendChild(h('div', { class: 'msg mal', role: 'status', text: 'La VLAN cambió (' + rotuloVlan(r.vlanAnterior) + ' → ' + rotuloVlan(r.vlanNueva) + '): revisá la IP del equipo o repatcheá.' }));
        cuerpo.appendChild(h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', class: 'primario', text: 'Cerrar', onclick: async () => { cerrarModal(); await o.alTerminar(); } })]));
      } }), true));
    }
  };
  abrirModal(h('div', { class: 'pe-modal', role: 'dialog', 'aria-label': 'Mudar a otro puesto' }, [h('h2', { text: 'Mudar a ' + p.persona_nombre + ' a otro puesto' }), cuerpo]), () => { void o.alTerminar; });
  await pintar();
}
