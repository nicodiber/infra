// @ts-check
/**
 * Ficha de puesto de trabajo (D-047). Ruta: `#/puesto/<id>`.
 * Nombre, boca de pared, sede o sala, recorrido inverso (puesto ← boca de patchera ← puerto del switch),
 * equipos que hay en el puesto, verificación y edición en el lugar.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, toast } from '../assets/js/marco.js';
import { abrirAlta, selectorConCrear } from '../assets/js/altas.js';
import { h, tabla, ahoraISO, fmtFecha } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import { cargarContexto, leerRuta, encabezado, campo, pestanas, avisoVista, formulario, fichaCab, cadenaDePuerto, textoUltimoCambio, seguro, pedirBaja, estadoPill, hashEquipo, enlaceFila, cargarPersonas, textoVlan, abrirMoverEquipo } from '../assets/js/red.js';

/** @type {import('../assets/js/red.js').Campo[]} */
const CAMPOS = [
  { k: 'puesto_nombre', r: 'Nombre', t: 'texto', req: true }, { k: 'puesto_boca_pared', r: 'Boca de pared', t: 'texto' }, { k: 'puesto_notas', r: 'Notas', t: 'largo' }
];

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const ctx = await cargarContexto();
  const id = leerRuta().partes[0];
  const puesto = id ? await repositorio.obtener('puestos', id) : null;
  await encabezado(contenedor, 'P06', 'Ficha de puesto de trabajo', [['Red', '#/red/equipos'], [puesto ? puesto.puesto_nombre : 'Puesto']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso al módulo Red.'); return; }
  if (!puesto || puesto.organizacion_id !== ctx.org) { avisoVista(contenedor, 'No encontramos ese puesto de trabajo en esta organización.'); return; }
  let editando = false;
  const armar = async () => {
    while (contenedor.children.length > 2) contenedor.removeChild(/** @type {Node} */ (contenedor.lastChild));
    const p = await repositorio.obtener('puestos', id);
    if (p) await dibujar(contenedor, ctx, p, editando, async v => { editando = v; await armar(); });
  };
  await dibujar(contenedor, ctx, puesto, editando, async v => { editando = v; await armar(); });
}

/**
 * @param {HTMLElement} cont @param {import('../assets/js/red.js').Contexto} ctx @param {any} pu @param {boolean} editando @param {(v: boolean) => Promise<void>} cambiar
 */
async function dibujar(cont, ctx, pu, editando, cambiar) {
  const pers = await cargarPersonas(ctx);
  const vlanPuesto = await repositorio.vlanDePuesto(pu.id);
  const [ubicaciones, equiposOrg, puertos, puestos] = await Promise.all([repositorio.listar('ubicaciones', { organizacion_id: ctx.org }), repositorio.listar('equipos', { organizacion_id: ctx.org }),
    repositorio.listar('puertos'), repositorio.listar('puestos', { organizacion_id: ctx.org })]);
  const mapas = { equipos: new Map(equiposOrg.map(x => [x.id, x])), puertos: new Map(puertos.map(x => [x.id, x])), puestos: new Map(puestos.map(x => [x.id, x])) };
  const ub = ubicaciones.find(x => x.id === pu.ubicacion_id);
  const enPuesto = equiposOrg.filter(e => e.puesto_id === pu.id);
  const bocas = puertos.filter(p => p.puesto_id === pu.id && mapas.equipos.has(p.equipo_id));

  /** @type {HTMLElement} */
  let datos;
  /** @type {(() => {valores: Object<string, any>, errores: string[]})|null} */
  let leer = null;
  const err = h('div', { class: 'rd-err', role: 'alert' });
  /** @type {HTMLSelectElement|null} */
  let selUb = null;
  if (editando) {
    const f = formulario(CAMPOS, pu);
    selUb = selectorConCrear({ desde: 'puestos', campo: 'ubicacion_id', organizacion_id: ctx.org, valor: pu.ubicacion_id, obligatorio: true, etiqueta: 'Sede / sala', rotuloOrigen: 'Editar puesto' });
    datos = h('div', { class: 'rd-edicion' }, [f.nodo, h('div', { class: 'campo', style: 'margin-top:8px;max-width:320px' }, [h('label', { text: 'Sede / sala *' }), selUb]), err]);
    leer = f.leer;
  } else {
    datos = h('div', { class: 'datos' }, [campo('Nombre', pu.puesto_nombre), campo('Boca de pared', pu.puesto_boca_pared), campo('Sede / sala', ub ? ub.ubicacion_nombre : null), campo('Equipos en el puesto', String(enPuesto.length)), campo('VLAN del puerto', vlanPuesto ? textoVlan(vlanPuesto) : null), campo('Notas', pu.puesto_notas)]);
  }
  const botones = /** @type {Node[]} */ ([]);
  if (editando) {
    botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
      const r = /** @type {Function} */ (leer)();
      if (r.errores.length) { err.textContent = r.errores.join(' '); return; }
      const nuevaUb = /** @type {HTMLSelectElement} */ (selUb).value;
      if (!(await seguro(async () => {
        await repositorio.guardar('puestos', { ...pu, ...r.valores, ubicacion_id: nuevaUb }, ctx.u.id);
        // Los equipos del puesto están donde está el puesto (como la mudanza, D-067): si el puesto cambia de sede o sala, lo acompañan.
        if (nuevaUb !== pu.ubicacion_id) for (const e of enPuesto) if (!e.rack_id && e.ubicacion_id !== nuevaUb) await repositorio.guardar('equipos', { ...e, ubicacion_id: nuevaUb }, ctx.u.id);
        return true;
      }))) return;
      toast('Cambios guardados · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); await cambiar(false);
    } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cambiar(false) }));
  } else {
    if (ctx.modifica) botones.push(h('button', { type: 'button', text: 'Editar', onclick: () => cambiar(true) }));
    if (ctx.pideBaja) botones.push(h('button', { type: 'button', text: 'Pedir la baja', title: 'Lo confirma el superadmin', onclick: () => pedirBaja(ctx, 'puestos', pu.id) }));
  }
  cont.appendChild(fichaCab({ ctx, tipo: 'puesto', etiqueta: 'puesto de trabajo', titulo: pu.puesto_nombre, icono: 'puesto', datos, botones, editando, registro: pu, coleccion: 'puestos',
    ultimoCambio: await textoUltimoCambio(ctx, 'Puesto', pu), alConfirmar: () => cambiar(editando) }));
  if (editando) return;

  const tabP = ['relaciones', 'archivos'].includes(leerRuta().partes[1]) ? leerRuta().partes[1] : '';
  cont.appendChild(pestanas([['', 'Conexión y equipos'], ['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']], tabP, k => '#/puesto/' + pu.id + (k ? '/' + k : '')));
  if (tabP) {
    const zona = h('div'); cont.appendChild(zona);
    if (tabP === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'Puesto', entidadId: pu.id, organizacionId: ctx.org });
    else await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'Puesto', entidadId: pu.id, organizacionId: ctx.org });
    return;
  }

  const rec = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('h3', { text: 'Recorrido inverso: puesto ← boca de patchera ← puerto del switch' })]);
  if (!bocas.length) rec.appendChild(h('div', { class: 'mut', text: 'Este puesto todavía no tiene una boca de patchera asociada.' + (ctx.modifica ? ' Se vincula desde el puerto de la patchera.' : '') }));
  for (const p of bocas) {
    const e = /** @type {any} */ (mapas.equipos.get(p.equipo_id));
    rec.appendChild(h('div', { style: 'margin-bottom:6px' }, [cadenaDePuerto(p, e, mapas, false, true)]));
  }
  rec.appendChild(h('div', { class: 'mut', text: 'Cada tramo es un enlace a la ficha o al puerto correspondiente.' }));
  cont.appendChild(rec);

  if (pers.ver) {
    const gente = pers.porPuesto.get(pu.id) || [];
    const pb = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('h3', { text: 'Personas del puesto' })]);
    if (!gente.length) pb.appendChild(h('div', { class: 'mut', text: 'No hay personas con este puesto como habitual. Se asigna desde la ficha de la persona.' }));
    else pb.appendChild(h('div', { class: 'rd-lista-etq' }, gente.map(g => enlaceFila('#/persona/' + g.id, g.persona_nombre))));
    cont.appendChild(pb);
  }

  const eq = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('div', { class: 'herr', style: 'justify-content:space-between' }, [h('h3', { text: 'Equipos en el puesto' }),
    ctx.modifica ? h('button', { type: 'button', text: 'Nuevo equipo en este puesto', onclick: async () => {
      const n = await abrirAlta('equipos', { organizacion_id: ctx.org, valores: { equipo_tipo: 'otro', tipos: ['otro'], categorias: ['PC de escritorio', 'Notebook', 'Impresora de red', 'Impresora', 'Reloj de control de personal'], otro_categoria: 'PC de escritorio', puesto_id: pu.id, titulo: 'Nuevo equipo en ' + pu.puesto_nombre }, rotulo: null });
      if (n) { toast('«' + n.equipo_nombre + '» creado en el puesto.'); await cambiar(false); }
    } }) : null])]);
  if (!enPuesto.length) eq.appendChild(h('div', { class: 'mut', text: 'No hay equipos cargados en este puesto.' + (ctx.modifica ? ' Creá uno con «Nuevo equipo en este puesto» o mové uno existente desde «Equipos de escritorio» con «Mover a otro puesto».' : '') }));
  else {
    const cab = ['Nombre', 'Tipo', 'IP', 'Asignado a', 'Estado'];
    if (ctx.modifica) cab.push('');
    eq.appendChild(tabla(cab, enPuesto.map(e => {
      const pes = pers.asignadasA.get(e.id) || [];
      /** @type {Array<Node|string>} */
      const fila = [e.equipo_nombre, ROTULO_EQUIPO_TIPO[e.equipo_tipo] + (e.equipo_campos && e.equipo_campos.otro_categoria ? ' · ' + e.equipo_campos.otro_categoria : ''), e.equipo_ip_gestion || '—',
        !pers.ver ? '—' : pes.length ? h('div', null, pes.map(pe => h('div', null, [enlaceFila('#/persona/' + pe.id, pe.persona_nombre)]))) : h('span', { class: 'mut', text: 'Sin asignar' }), estadoPill(e.equipo_estado)];
      if (ctx.modifica) fila.push(e.rack_id ? '' : h('button', { type: 'button', text: 'Mover…', title: 'Mover a otro puesto', onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); abrirMoverEquipo(ctx, e, () => cambiar(false)); } }));
      return fila;
    }), { tipo: 'equipo', onFila: (_, i) => ir(hashEquipo(enPuesto[i])) }));
  }
  cont.appendChild(eq);
}
