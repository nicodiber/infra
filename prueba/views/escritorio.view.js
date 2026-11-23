// @ts-check
/**
 * P21 · Equipos de escritorio (QC42-C, D-067): PC y notebooks, a quién están asignadas, en qué puesto y con qué IP.
 * Ruta: `#/escritorio`. «Mover a otro puesto» (MJ43) para quien modifica `red`.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir } from '../assets/js/marco.js';
import { h, tabla, indicadorVerificacion, normalizar } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import { CATEGORIAS_PUESTO, inyectarEstilos, cargarContexto, encabezado, estadoPill, chipsEstado, avisoVista, hashEquipo, enlaceFila, cargarPersonas, abrirMoverEquipo } from '../assets/js/red.js';

const ESTADOS = /** @type {Array<[string, string]>} */ ([['en_uso', 'En uso'], ['en_deposito', 'En depósito'], ['baja', 'Baja']]);
let fTexto = '', fUbic = '', fChip = '';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  inyectarEstilos();
  const ctx = await cargarContexto();
  await encabezado(contenedor, 'P21', 'Equipos de escritorio', [['Equipos de escritorio']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso a los equipos de escritorio.'); return; }
  contenedor.appendChild(h('h1', { text: 'Equipos de escritorio' }));
  const raiz = h('div');
  contenedor.appendChild(raiz);
  const dibujar = async () => {
    const [equipos, puestos, ubicaciones, pers] = await Promise.all([repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('puestos', { organizacion_id: ctx.org }),
      repositorio.listar('ubicaciones', { organizacion_id: ctx.org }), cargarPersonas(ctx)]);
    const mapaPu = new Map(puestos.map(p => [p.id, p]));
    const mapaUb = new Map(ubicaciones.map(x => [x.id, x]));
    const categoria = (/** @type {any} */ e) => (e.equipo_campos && e.equipo_campos.otro_categoria) || ROTULO_EQUIPO_TIPO[e.equipo_tipo] || 'Equipo';
    const todos = equipos.filter(e => e.equipo_tipo === 'otro' && CATEGORIAS_PUESTO.includes(String(e.equipo_campos && e.equipo_campos.otro_categoria)))
      .sort((a, b) => a.equipo_codigo.localeCompare(b.equipo_codigo, 'es', { numeric: true }));
    const ubDe = (/** @type {any} */ e) => { const pu = e.puesto_id ? mapaPu.get(e.puesto_id) : null; return (pu && pu.ubicacion_id) || e.ubicacion_id || ''; };
    raiz.textContent = '';
    const chipsCont = h('div'), tb = h('div'), cuenta = h('div', { class: 'mut', style: 'margin-top:6px', role: 'status' });
    const pintar = () => {
      tb.textContent = ''; chipsCont.textContent = '';
      const q = normalizar(fTexto);
      const base = todos.filter(e => (!fUbic || ubDe(e) === fUbic) && (!q || normalizar([e.equipo_codigo, e.equipo_nombre, categoria(e), e.equipo_marca, e.equipo_modelo, e.equipo_ip_gestion,
        e.puesto_id && mapaPu.get(e.puesto_id) ? mapaPu.get(e.puesto_id).puesto_nombre : '', (pers.asignadasA.get(e.id) || []).map(x => x.persona_nombre).join(' ')].join(' ')).includes(q)));
      /** @type {Object<string, (e: any) => boolean>} */
      const pred = { en_uso: e => e.equipo_estado === 'en_uso', en_deposito: e => e.equipo_estado === 'en_deposito', baja: e => e.equipo_estado === 'baja', sinasig: e => !pers.asignadoA.has(e.id), sinpuesto: e => !e.puesto_id };
      const chips = ESTADOS.concat(/** @type {Array<[string, string]>} */ ([['sinasig', 'Sin asignar'], ['sinpuesto', 'Sin puesto']]).filter(c => c[0] !== 'sinasig' || pers.ver));
      chipsCont.appendChild(chipsEstado(chips, c => base.filter(pred[c]).length, base.length, fChip, v => { fChip = v; pintar(); }));
      const f = base.filter(e => !fChip || pred[fChip](e));
      if (f.length) {
        const cab = ['Código', 'Equipo', 'Categoría', 'Marca / modelo', 'Asignado a', 'Puesto', 'IP', 'Estado', 'Verificado'];
        if (ctx.modifica) cab.push('');
        tb.appendChild(tabla(cab, f.map(e => {
          const pes = pers.asignadasA.get(e.id) || [], pu = e.puesto_id ? mapaPu.get(e.puesto_id) : null;
          /** @type {Array<Node|string>} */
          const fila = [e.equipo_codigo, enlaceFila(hashEquipo(e), e.equipo_nombre), categoria(e), [e.equipo_marca, e.equipo_modelo].filter(Boolean).join(' ') || '—',
            !pers.ver ? '—' : pes.length ? h('div', null, pes.map(pe => h('div', null, [enlaceFila('#/persona/' + pe.id, pe.persona_nombre)]))) : h('span', { class: 'mut', text: 'Sin asignar' }),
            pu ? enlaceFila('#/puesto/' + pu.id, pu.puesto_nombre) : h('span', { class: 'mut', text: 'Sin puesto' }), e.equipo_ip_gestion || '—', estadoPill(e.equipo_estado), indicadorVerificacion(e.verificado_en, ctx.umbrales, true)];
          if (ctx.modifica) fila.push(e.rack_id ? '' : h('button', { type: 'button', text: 'Mover a otro puesto', onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); abrirMoverEquipo(ctx, e, () => dibujar()); } }));
          return fila;
        }), { tipo: 'equipo', onFila: (_, i) => ir(hashEquipo(f[i])) }));
      } else {
        tb.appendChild(h('div', { class: 'aviso' }, [todos.length ? 'Ningún equipo coincide con el filtro.' : 'Todavía no hay PC de escritorio ni notebooks cargadas en esta organización. Se cargan desde «Nuevo equipo» en Red, con la categoría «PC de escritorio» o «Notebook».']));
      }
      cuenta.textContent = f.length + ' de ' + todos.length + ' equipos de escritorio. Tocá uno para abrir su ficha.' + (pers.ver ? '' : ' Tu rol no ve las personas, por eso no se muestra a quién está asignado cada equipo.');
    };
    const inp = h('input', { placeholder: 'Filtrar por código, nombre, persona, puesto, IP…', 'aria-label': 'Filtrar equipos de escritorio', value: fTexto, style: 'width:320px' });
    inp.addEventListener('input', () => { fTexto = /** @type {HTMLInputElement} */ (inp).value; pintar(); });
    const sel = h('select', { 'aria-label': 'Ubicación' }, [h('option', { value: '', text: 'Todas las ubicaciones' })].concat(ubicaciones.slice().sort((a, b) => a.ubicacion_nombre.localeCompare(b.ubicacion_nombre, 'es', { numeric: true })).map(u => h('option', { value: u.id, text: u.ubicacion_nombre }))));
    /** @type {HTMLSelectElement} */ (sel).value = fUbic;
    sel.addEventListener('change', () => { fUbic = /** @type {HTMLSelectElement} */ (sel).value; pintar(); });
    raiz.appendChild(h('div', { class: 'herr' }, [inp, sel]));
    raiz.appendChild(chipsCont); raiz.appendChild(tb); raiz.appendChild(cuenta);
    pintar();
  };
  await dibujar();
}
