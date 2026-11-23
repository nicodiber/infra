// @ts-check
/**
 * P23 · Ficha de cuenta de dominio (`#/cuenta/<id>`) y alta (`#/cuenta/nueva[?persona=<id>]`).
 * Datos con edición en el lugar (D-037), persona vinculada (o cuenta de servicio), grupos (lista editable), estado,
 * enlace a la credencial si se guarda (nunca se muestra la contraseña: la credencial tiene su propio flujo), verificación e historial.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, toast, abrirModal, cerrarModal } from '../assets/js/marco.js';
import { h, tabla, ahoraISO, fmtFecha, fmtFechaHora } from '../assets/js/utiles.js';
import { ROTULO_CUENTA_ESTADO } from '../assets/js/modelos.js';
import { encabezado, leerRuta, pestanas, campo, enlace, formulario, fichaCab, textoUltimoCambio, pedirBaja, seguro, valorHistorial } from '../assets/js/red.js';
import { inyectarEstilosPersonas, cargarContextoPersonas, avisoPersonas, nombreCuenta, pillCuenta, alertaCuentaDeBaja } from '../assets/js/personas.js';

/** @typedef {import('../assets/js/red.js').Contexto} Contexto */
/** @typedef {import('../assets/js/modelos.js').CuentaDominio} CuentaDominio */

/** @type {import('../assets/js/red.js').Campo[]} */
const CAMPOS = [
  { k: 'cuenta_dominio', r: 'Dominio', t: 'texto', req: true }, { k: 'cuenta_usuario', r: 'Usuario', t: 'texto', req: true },
  { k: 'cuenta_unidad_organizativa', r: 'Unidad organizativa', t: 'texto' },
  { k: 'cuenta_estado', r: 'Estado', t: 'enum', req: true, op: [['habilitada', 'Habilitada'], ['deshabilitada', 'Deshabilitada']] }
];

/**
 * Lista editable de grupos: chips con «×» y un campo para agregar.
 * @param {string[]} inicial
 * @returns {{nodo: HTMLElement, leer: () => string[]}}
 */
function editorGrupos(inicial) {
  /** @type {string[]} */
  let grupos = inicial.slice();
  const lista = h('div', { class: 'pe-grupos', role: 'list', 'aria-label': 'Grupos' });
  const entrada = /** @type {HTMLInputElement} */ (h('input', { type: 'text', placeholder: 'Nombre del grupo y Enter', 'aria-label': 'Agregar grupo', style: 'max-width:260px' }));
  const pintar = () => {
    lista.textContent = '';
    if (!grupos.length) lista.appendChild(h('span', { class: 'mut', text: 'Sin grupos.' }));
    for (const g of grupos) lista.appendChild(h('span', { class: 'pe-grupo', role: 'listitem' }, [g, h('button', { type: 'button', 'aria-label': 'Quitar el grupo ' + g, title: 'Quitar', text: '×', onclick: () => { grupos = grupos.filter(x => x !== g); pintar(); } })]));
  };
  const agregar = () => {
    const v = entrada.value.trim();
    if (v && !grupos.some(x => x.toLowerCase() === v.toLowerCase())) grupos.push(v);
    entrada.value = ''; pintar();
  };
  entrada.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });
  pintar();
  return { nodo: h('div', null, [lista, h('div', { class: 'herr', style: 'margin:6px 0 0' }, [entrada, h('button', { type: 'button', class: 'chico', text: 'Agregar', onclick: agregar })])]), leer: () => { agregar(); return grupos.slice(); } };
}

/** @param {any[]} personas @param {string|null} actual */
function selectorPersona(personas, actual) {
  const sel = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Persona' }, [h('option', { value: '', text: 'Cuenta de servicio (sin persona)' })].concat(
    personas.map(x => h('option', { value: x.id, text: x.persona_nombre + (x.persona_estado === 'baja' ? ' (en baja)' : '') })))));
  sel.value = actual || '';
  return sel;
}

/**
 * Comprueba que el usuario no esté repetido en el dominio. @param {string} dominio @param {string} usuario @param {string|null} idActual @param {string} org
 */
async function usuarioRepetido(dominio, usuario, idActual, org) {
  const otras = await repositorio.listar('cuentas_dominio', c => c.organizacion_id === org && c.id !== idActual);
  return otras.some(c => c.cuenta_dominio.toLowerCase() === dominio.toLowerCase() && c.cuenta_usuario.toLowerCase() === usuario.toLowerCase());
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  inyectarEstilosPersonas();
  const ctx = await cargarContextoPersonas();
  const { partes, consulta } = leerRuta();
  const id = partes[0];
  const nueva = id === 'nueva';
  const cuenta = id && !nueva ? await repositorio.obtener('cuentas_dominio', id) : null;
  await encabezado(contenedor, 'P23', nueva ? 'Nueva cuenta de dominio' : 'Ficha de cuenta de dominio', [['Personas', '#/personas'], ['Cuentas de dominio', '#/personas/cuentas'], [nueva ? 'Nueva cuenta' : cuenta ? nombreCuenta(cuenta) : 'Cuenta']]);
  if (!puede(ctx.u, 'ver', 'personas', ctx.org)) { avisoPersonas(contenedor, 'Tu rol no tiene acceso al módulo Personas.'); return; }
  if (nueva) {
    if (!ctx.modifica) { avisoPersonas(contenedor, 'Tu rol no puede cargar cuentas de dominio.', '#/personas/cuentas'); return; }
    await dibujarAlta(contenedor, ctx, consulta.get('persona'));
    return;
  }
  if (!cuenta || cuenta.organizacion_id !== ctx.org) { avisoPersonas(contenedor, 'No encontramos esa cuenta de dominio en esta organización (puede haberse eliminado).', '#/personas/cuentas'); return; }
  let editando = false;
  const armar = async () => {
    const scroller = contenedor.parentElement;
    const y = scroller ? scroller.scrollTop : 0;
    while (contenedor.children.length > 2) contenedor.removeChild(/** @type {Node} */ (contenedor.lastChild));
    const c = await repositorio.obtener('cuentas_dominio', id);
    if (!c) { avisoPersonas(contenedor, 'La cuenta ya no existe.', '#/personas/cuentas'); return; }
    await dibujar(contenedor, ctx, c, partes, editando, async v => { editando = v; await armar(); }, armar);
    if (scroller) scroller.scrollTop = y;
  };
  await dibujar(contenedor, ctx, cuenta, partes, editando, async v => { editando = v; await armar(); }, armar);
}

/** @param {HTMLElement} cont @param {Contexto} ctx @param {string|null} personaId */
async function dibujarAlta(cont, ctx, personaId) {
  const [personas, cuentas] = await Promise.all([repositorio.listar('personas', { organizacion_id: ctx.org }, { ordenarPor: 'persona_nombre' }), repositorio.listar('cuentas_dominio', { organizacion_id: ctx.org })]);
  // Dominio sugerido: el más usado de la organización.
  /** @type {Map<string, number>} */
  const cuenta = new Map();
  for (const c of cuentas) cuenta.set(c.cuenta_dominio, (cuenta.get(c.cuenta_dominio) || 0) + 1);
  const dominio = Array.from(cuenta.entries()).sort((a, b) => b[1] - a[1])[0];
  const f = formulario(CAMPOS, { cuenta_dominio: dominio ? dominio[0] : '', cuenta_estado: 'habilitada' });
  const sel = selectorPersona(personas, personas.some(x => x.id === personaId) ? personaId : null);
  const grupos = editorGrupos(['Usuarios del dominio']);
  const err = h('div', { class: 'rd-err', role: 'alert' });
  cont.appendChild(h('h1', { text: 'Nueva cuenta de dominio' }));
  cont.appendChild(h('div', { class: 'bloque' }, [
    h('div', { class: 'mut', style: 'margin-bottom:8px', text: 'Los campos con * son obligatorios. Si la cuenta no es de una persona (impresora, servicio, escáner), dejá «Cuenta de servicio». La contraseña no se carga acá: va como credencial.' }),
    h('div', { class: 'rd-edicion' }, [f.nodo,
      h('div', { class: 'campo', style: 'margin-top:8px;max-width:360px' }, [h('label', { text: 'Persona' }), sel]),
      h('div', { class: 'campo', style: 'margin-top:8px' }, [h('label', { text: 'Grupos' }), grupos.nodo]), err]),
    h('div', { class: 'herr' }, [
      h('button', { type: 'button', class: 'primario', text: 'Crear cuenta', onclick: async () => {
        const r = f.leer();
        const errores = r.errores.slice();
        if (!errores.length && await usuarioRepetido(r.valores.cuenta_dominio, r.valores.cuenta_usuario, null, ctx.org)) errores.push('Ya existe la cuenta ' + r.valores.cuenta_dominio + '\\' + r.valores.cuenta_usuario + ' en esta organización.');
        if (errores.length) { err.textContent = errores.join(' '); return; }
        const creada = await seguro(() => repositorio.guardar('cuentas_dominio', { organizacion_id: ctx.org, ...r.valores, persona_id: sel.value || null, cuenta_grupos: grupos.leer(), credencial_id: null }, ctx.u.id));
        if (!creada) return;
        toast('Cuenta «' + nombreCuenta(creada) + '» creada');
        ir('#/cuenta/' + creada.id);
      } }),
      h('button', { type: 'button', text: 'Cancelar', onclick: () => (personaId ? ir('#/persona/' + personaId + '/cuentas') : ir('#/personas/cuentas')) })])]));
}

/**
 * @param {HTMLElement} cont @param {Contexto} ctx @param {CuentaDominio} c @param {string[]} partes @param {boolean} editando
 * @param {(v: boolean) => Promise<void>} cambiar @param {() => Promise<void>} rearmar
 */
async function dibujar(cont, ctx, c, partes, editando, cambiar, rearmar) {
  const verCred = puede(ctx.u, 'ver', 'credenciales', ctx.org);
  const [personas, cred] = await Promise.all([repositorio.listar('personas', { organizacion_id: ctx.org }, { ordenarPor: 'persona_nombre' }), c.credencial_id && verCred ? repositorio.obtener('credenciales', c.credencial_id) : Promise.resolve(null)]);
  const dueno = c.persona_id ? personas.find(x => x.id === c.persona_id) || null : null;
  const deBaja = !!dueno && dueno.persona_estado === 'baja' && c.cuenta_estado === 'habilitada';

  /** @type {HTMLElement} */
  let datos;
  /** @type {null|(() => {valores: Object<string, any>, errores: string[]})} */
  let leer = null;
  /** @type {HTMLSelectElement|null} */
  let selPersona = null;
  /** @type {null|{nodo: HTMLElement, leer: () => string[]}} */
  let editor = null;
  const err = h('div', { class: 'rd-err', role: 'alert' });
  if (editando) {
    const f = formulario(CAMPOS, c);
    selPersona = selectorPersona(personas, c.persona_id);
    editor = editorGrupos(c.cuenta_grupos || []);
    datos = h('div', { class: 'rd-edicion' }, [f.nodo, h('div', { class: 'campo', style: 'margin-top:8px;max-width:360px' }, [h('label', { text: 'Persona' }), selPersona]),
      h('div', { class: 'campo', style: 'margin-top:8px' }, [h('label', { text: 'Grupos' }), editor.nodo]), err]);
    leer = f.leer;
  } else {
    /** @type {Node|string|null} */
    let credNodo = null;
    if (c.credencial_id) credNodo = cred ? enlace(cred.credencial_nombre, '#/credencial/' + cred.id) : verCred ? 'La credencial ya no existe' : 'Tiene una credencial guardada (tu rol no ve el módulo Credenciales)';
    datos = h('div', { class: 'datos' }, [campo('Cuenta', nombreCuenta(c)), campo('Dominio', c.cuenta_dominio), campo('Usuario', c.cuenta_usuario),
      campo('Persona', dueno ? enlace(dueno.persona_nombre + (dueno.persona_estado === 'baja' ? ' (en baja)' : ''), '#/persona/' + dueno.id + '/cuentas') : 'Cuenta de servicio'),
      campo('Unidad organizativa', c.cuenta_unidad_organizativa), campo('Estado', h('span', null, [pillCuenta(c.cuenta_estado), deBaja ? alertaCuentaDeBaja() : null])),
      campo('Contraseña', credNodo || 'No se guarda como credencial'),
      h('div', { class: 'campo', style: 'grid-column:1/-1' }, [h('label', { text: 'Grupos' }), (c.cuenta_grupos || []).length
        ? h('div', { class: 'pe-grupos' }, c.cuenta_grupos.map(g => h('span', { class: 'pe-grupo', text: g }))) : h('div', { text: '—' })])]);
  }
  const botones = /** @type {Node[]} */ ([]);
  if (editando) {
    botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
      const r = /** @type {Function} */ (leer)();
      const errores = /** @type {string[]} */ (r.errores).slice();
      if (!errores.length && await usuarioRepetido(r.valores.cuenta_dominio, r.valores.cuenta_usuario, c.id, ctx.org)) errores.push('Ya existe la cuenta ' + r.valores.cuenta_dominio + '\\' + r.valores.cuenta_usuario + ' en esta organización.');
      if (errores.length) { err.textContent = errores.join(' '); return; }
      const reg = { ...c, ...r.valores, persona_id: /** @type {HTMLSelectElement} */ (selPersona).value || null, cuenta_grupos: /** @type {any} */ (editor).leer() };
      if (!(await seguro(() => repositorio.guardar('cuentas_dominio', reg, ctx.u.id)))) return;
      toast('Cambios guardados · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); await cambiar(false);
    } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cambiar(false) }));
  } else {
    if (ctx.modifica) botones.push(h('button', { type: 'button', text: 'Editar', onclick: () => cambiar(true) }));
    if (ctx.baja) botones.push(h('button', { type: 'button', text: 'Eliminar cuenta', title: 'Se oculta de listados y búsquedas; el historial se conserva', onclick: () => confirmarEliminar(ctx, c) }));
    else if (ctx.pideBaja) botones.push(h('button', { type: 'button', text: 'Pedir eliminar la cuenta', title: 'Lo confirma el superadmin', onclick: () => pedirBaja(ctx, 'cuentas_dominio', c.id) }));
  }
  cont.appendChild(fichaCab({ ctx, tipo: 'persona', etiqueta: 'cuenta de dominio', titulo: nombreCuenta(c), icono: 'persona', datos, botones, editando, registro: c, coleccion: 'cuentas_dominio',
    ultimoCambio: await textoUltimoCambio(ctx, 'CuentaDominio', c), alConfirmar: rearmar }));
  if (editando) return;
  if (deBaja) cont.appendChild(h('div', { class: 'msg mal', role: 'status', style: 'margin-top:8px', text: dueno.persona_nombre + ' está en baja pero esta cuenta sigue habilitada. Revisala: si ya no se usa, deshabilitala en el dominio y cambiá su estado acá.' }));
  if (!c.persona_id) cont.appendChild(h('div', { class: 'msg', style: 'margin-top:8px', text: 'Es una cuenta de servicio: no pertenece a una persona.' }));
  if (!ctx.historial) return;
  const barra = pestanas([['historial', 'Historial']], 'historial', () => '#/cuenta/' + c.id);
  barra.style.margin = '8px 0 8px';
  cont.appendChild(barra);
  cont.appendChild(await cuerpoHistorial(ctx, c, personas));
  void partes;
}

/** @param {Contexto} ctx @param {CuentaDominio} c @param {any[]} personas */
async function cuerpoHistorial(ctx, c, personas) {
  const cs = await repositorio.listar('cambios', x => x.cambio_entidad === 'CuentaDominio' && x.entidad_id === c.id, { ordenarPor: 'cambio_fecha', descendente: true });
  if (!cs.length) return h('div', { class: 'aviso', text: 'Esta cuenta todavía no tiene cambios registrados.' });
  /** @type {Object<string, string>} */
  const rot = { persona_id: 'Persona', cuenta_usuario: 'Usuario', cuenta_dominio: 'Dominio', cuenta_unidad_organizativa: 'Unidad organizativa', cuenta_grupos: 'Grupos', cuenta_estado: 'Estado', credencial_id: 'Credencial' };
  const pn = new Map(personas.map(x => [x.id, x.persona_nombre]));
  /** @param {string|null} v */
  const val = v => {
    if (v != null) { try { const x = JSON.parse(v); if (Array.isArray(x)) return x.join(', ') || '—'; } catch (e) { /* texto simple */ } }
    const t = valorHistorial(v); return pn.get(t) || /** @type {any} */ (ROTULO_CUENTA_ESTADO)[t] || t;
  };
  const nombreOp = /** @type {Object<string, string>} */ ({ alta: 'Alta', baja: 'Eliminación', restauracion: 'Restauración', modificacion: 'Cambio' });
  return tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cs.map(x => [fmtFechaHora(x.cambio_fecha), ctx.nombresUsuario.get(x.usuario_id) || '—',
    x.cambio_campo ? (rot[x.cambio_campo] || x.cambio_campo) : nombreOp[x.cambio_operacion], x.cambio_campo ? val(x.cambio_valor_anterior) : '—', x.cambio_campo ? val(x.cambio_valor_nuevo) : '—']));
}

/** @param {Contexto} ctx @param {CuentaDominio} c */
function confirmarEliminar(ctx, c) {
  abrirModal(h('div', { class: 'pe-modal', role: 'alertdialog', 'aria-label': 'Eliminar cuenta' }, [
    h('h2', { text: 'Eliminar la cuenta ' + nombreCuenta(c) }),
    h('p', { text: 'La cuenta deja de aparecer en listados y búsquedas. Esto no la borra del dominio. El historial se conserva y se puede revertir desde el historial de cambios.' }),
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      h('button', { type: 'button', class: 'primario', text: 'Sí, eliminar', onclick: async () => {
        const ok = await seguro(() => repositorio.guardar('cuentas_dominio', { ...c, eliminado_en: ahoraISO() }, ctx.u.id));
        cerrarModal();
        if (ok) { toast('Cuenta eliminada'); ir('#/personas/cuentas'); }
      } })])]));
}
