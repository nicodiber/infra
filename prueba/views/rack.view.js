// @ts-check
/**
 * P08 · Vista de rack (`#/rack/<id>[?resaltar=<equipoId>]`): rack dibujado por U a partir de los datos,
 * equipo resaltado, clic a la ficha, tabla alternativa, datos del rack con edición en el lugar,
 * verificación y acceso al «Recorrido de verificación».
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla, normalizar } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import { confirmarConPasos } from '../assets/js/verificacion.js';
import {
  aplicarEstilos, botonBaja, bloqueSinPermiso, estadoVacio, fichaBloque, pieVerificacion, nombresDeUsuarios, partesHash, rangoU, rutaEquipo, moduloEquipo,
  claseTipoRack, porId, rutaUbicacion, textoUnidadesLibres, unidadesOcupadas
} from '../assets/js/racks.js';

const ALTO_U = 13;

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  aplicarEstilos();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const { segs, query } = partesHash();
  const id = segs[1] || '';
  const tabExtra = ['relaciones', 'archivos'].includes(segs[2]) ? segs[2] : '';
  const resaltar = query.get('resaltar') || (tabExtra ? '' : segs[2]) || '';
  const raiz = await migasRaiz();
  const rack0 = id ? await repositorio.obtener('racks', id) : null;
  if (!rack0) {
    pantalla(contenedor, { codigo: 'P08', nombre: 'Vista de rack', migas: raiz.concat([['Racks', '#/racks'], ['No encontrado']]) });
    contenedor.appendChild(estadoVacio('No encontramos ese rack', 'Puede que se haya dado de baja o que el enlace sea viejo.', 'rack', [h('a', { href: '#/racks', text: 'Ir a Racks' })]));
    return;
  }
  const org = rack0.organizacion_id;
  if (!puede(u, 'ver', 'racks', org)) {
    pantalla(contenedor, { codigo: 'P08', nombre: 'Vista de rack', migas: raiz.concat([['Racks']]) });
    contenedor.appendChild(bloqueSinPermiso('Tu rol no tiene acceso al módulo Racks.'));
    return;
  }
  let editando = false;
  /** @type {string|null} */
  let errorForm = null;

  const pintar = async () => {
    contenedor.textContent = '';
    const rack = await repositorio.obtener('racks', id);
    if (!rack) { ir('#/racks'); return; }
    const [equipos, ubicaciones, umbrales, nombres] = await Promise.all([
      repositorio.listar('equipos', { rack_id: id }, { ordenarPor: 'rack_u_inicio' }),
      repositorio.listar('ubicaciones', { organizacion_id: org }), repositorio.umbralesVerificacion(), nombresDeUsuarios()]);
    const ubic = porId(ubicaciones);
    const total = rack.rack_unidades_total;
    const montados = equipos.filter(e => e.rack_u_inicio != null && e.rack_u_inicio >= 1 && e.rack_u_inicio + (e.rack_u_alto || 1) - 1 <= total);
    const ocupadas = new Set();
    for (const e of montados) for (let k = 0; k < (e.rack_u_alto || 1); k++) ocupadas.add(e.rack_u_inicio + k);
    const puedeModificar = puede(u, 'modificar', 'racks', org);
    const puedeVerificar = puede(u, 'verificar', 'racks', org);
    const enResalt = resaltar && equipos.find(e => e.id === resaltar);

    /** Abre la ficha del equipo si el rol ve su módulo. @param {any} e */
    const abrir = e => {
      if (!puede(u, 'ver', moduloEquipo(e), org)) { toast('Tu rol no ve el módulo ' + (moduloEquipo(e) === 'servidores' ? 'Servidores' : 'Red') + '.'); return; }
      ir(rutaEquipo(e));
    };

    // ---- el rack dibujado
    const dibujo = h('div', { class: 'rack', role: 'group', 'aria-label': 'Rack ' + rack.rack_nombre + ', ' + total + ' unidades', style: 'height:' + (total * ALTO_U + 6) + 'px' });
    for (let n = total; n >= 1; n--) dibujo.appendChild(h('div', { class: 'urow' }, [h('b', { text: String(n) }), ocupadas.has(n) ? h('span', { style: 'background:var(--surf)' }) : h('span', { text: 'libre' })]));
    /** @type {HTMLElement|null} */
    let elResaltado = null;
    for (const e of montados) {
      const alto = e.rack_u_alto || 1;
      const rotulo = ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo;
      const b = h('button', { type: 'button', class: 'eq ' + claseTipoRack(e.equipo_tipo) + (e.id === resaltar ? ' resalt' : ''),
        style: 'top:' + ((total - (e.rack_u_inicio + alto - 1)) * ALTO_U) + 'px;height:' + (alto * ALTO_U - 1) + 'px', title: e.equipo_nombre,
        'aria-label': e.equipo_nombre + ', ' + rotulo + ', unidad ' + rangoU(e) + (e.id === resaltar ? ', resaltado' : ''), onclick: () => abrir(e),
        text: e.equipo_nombre + ' · ' + rotulo + (alto > 1 ? ' · ' + rangoU(e) : '') });
      if (e.id === resaltar) elResaltado = b;
      dibujo.appendChild(b);
    }

    // ---- datos del rack (lectura o edición)
    const datos = h('div', { class: 'datos', style: 'grid-template-columns:repeat(2,1fr)' });
    const lugares = Array.from(ubicaciones).sort((a, b) => rutaUbicacion(a.id, ubic).localeCompare(rutaUbicacion(b.id, ubic), 'es'));
    const inNombre = /** @type {HTMLInputElement} */ (h('input', { id: 'rack-nombre', type: 'text' })); inNombre.value = rack.rack_nombre;
    const selUb = /** @type {HTMLSelectElement} */ (h('select', { id: 'rack-ubic' }, lugares.map(x => h('option', { value: x.id, text: rutaUbicacion(x.id, ubic), selected: x.id === rack.ubicacion_id ? 'selected' : null }))));
    const inAlto = /** @type {HTMLInputElement} */ (h('input', { id: 'rack-alto', type: 'number', min: '1' })); inAlto.value = String(total);
    const inProf = /** @type {HTMLInputElement} */ (h('input', { id: 'rack-prof', type: 'number', min: '1' })); inProf.value = rack.rack_profundidad == null ? '' : String(rack.rack_profundidad);
    const inNotas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'rack-notas', rows: '2', style: 'width:100%' })); inNotas.value = rack.rack_notas || '';
    /** @param {string} etq @param {string} idc @param {HTMLElement} el */
    const campoEd = (etq, idc, el) => h('div', { class: 'campo' }, [h('label', { for: idc, text: etq }), el]);
    const pct = Math.round(unidadesOcupadas(equipos) / total * 100);
    if (editando) {
      datos.appendChild(campoEd('Nombre *', 'rack-nombre', inNombre)); datos.appendChild(campoEd('Ubicación *', 'rack-ubic', selUb));
      datos.appendChild(campoEd('Alto útil en U *', 'rack-alto', inAlto)); datos.appendChild(campoEd('Profundidad útil (mm)', 'rack-prof', inProf));
      datos.appendChild(h('div', { class: 'campo', style: 'grid-column:1/-1' }, [h('label', { for: 'rack-notas', text: 'Notas' }), inNotas]));
    } else {
      const ficha = (/** @type {string} */ etq, /** @type {string} */ v) => h('div', { class: 'campo' }, [h('label', { text: etq }), h('div', { text: v })]);
      datos.appendChild(ficha('Ubicación', rutaUbicacion(rack.ubicacion_id, ubic) || '—')); datos.appendChild(ficha('Alto', total + ' U'));
      datos.appendChild(ficha('Profundidad útil', rack.rack_profundidad ? rack.rack_profundidad + ' mm' : '—'));
      datos.appendChild(ficha('Ocupación', unidadesOcupadas(equipos) + ' / ' + total + ' U (' + pct + ' %)'));
      datos.appendChild(ficha('U libres', textoUnidadesLibres(total, equipos)));
      if (rack.rack_notas) datos.appendChild(ficha('Notas', rack.rack_notas));
    }
    const errorCaja = h('div', { class: 'msg mal', role: 'alert', text: errorForm || '', hidden: errorForm ? null : 'hidden' });

    const guardar = async () => {
      const falla = (/** @type {string} */ m) => { errorCaja.textContent = m; errorCaja.hidden = false; errorForm = m; };
      const nom = inNombre.value.trim();
      if (!nom) return falla('Falta el nombre del rack.');
      const otros = await repositorio.listar('racks', r => r.organizacion_id === org && r.id !== id);
      if (otros.some(r => normalizar(r.rack_nombre) === normalizar(nom))) return falla('Ya existe otro rack llamado «' + nom + '».');
      const nuevoAlto = parseInt(inAlto.value, 10);
      if (!Number.isInteger(nuevoAlto) || nuevoAlto < 1 || nuevoAlto > 60) return falla('El alto tiene que ser un número de U entre 1 y 60.');
      const maxFin = equipos.reduce((m, e) => Math.max(m, (e.rack_u_inicio || 0) + (e.rack_u_alto || 1) - 1), 0);
      if (nuevoAlto < maxFin) return falla('No se puede achicar a ' + nuevoAlto + ' U: hay equipos montados hasta la U' + maxFin + '.');
      try {
        await repositorio.guardar('racks', { ...rack, rack_nombre: nom, ubicacion_id: selUb.value, rack_unidades_total: nuevoAlto,
          rack_profundidad: inProf.value ? parseInt(inProf.value, 10) : null, rack_notas: inNotas.value.trim() || null }, u.id);
        if (selUb.value !== rack.ubicacion_id) for (const e of equipos) await repositorio.guardar('equipos', { ...e, ubicacion_id: selUb.value }, u.id); // regla 9
        editando = false; errorForm = null;
        toast('Cambios guardados · verificado hoy');
        await pintar();
      } catch (e) { falla(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    };

    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }), h('button', { type: 'button', text: 'Cancelar', onclick: () => { editando = false; errorForm = null; pintar(); } })]
      : [h('button', { type: 'button', text: 'Etiqueta', title: 'Imprimir la etiqueta con QR', onclick: () => { location.hash = '#/etiqueta/racks/' + rack.id; } }),
        puedeModificar ? h('button', { type: 'button', text: 'Editar', onclick: () => { editando = true; errorForm = null; pintar(); } }) : null,
        puedeVerificar ? h('button', { type: 'button', class: 'primario', text: 'Recorrido de verificación', title: 'Confirmar en el lugar, uno por uno, los equipos y puertos de este rack',
          onclick: () => ir('#/recorrido/' + rack.id) }) : null];
    if (!editando) {
      const baja = await botonBaja({ u, org, modulo: 'racks', coleccion: 'racks', registro: rack, nombre: rack.rack_nombre, alTerminar: () => ir(puede(u, 'baja', 'racks', org) ? '#/racks' : location.hash),
        bloqueo: equipos.length ? 'Tiene ' + equipos.length + ' equipo(s) montado(s) (' + equipos.slice(0, 4).map(e => e.equipo_nombre).join(', ') + (equipos.length > 4 ? '…' : '') + '). Sacalos del rack o dalos de baja primero, así no quedan equipos apuntando a un rack inexistente.' : null });
      if (baja) botones.push(baja);
    }
    const pie = pieVerificacion({ coleccion: 'racks', registro: rack, umbrales, nombresUsuario: nombres, puedeVerificar: puedeVerificar && !editando,
      alConfirmar: async () => { if (!(await confirmarConPasos('racks', rack.id, u))) return; toast('Rack «' + rack.rack_nombre + '» confirmado como vigente hoy'); await pintar(); }, error: toast });
    const cabecera = fichaBloque({ tipo: 'rack', etiqueta: 'rack', titulo: 'Rack ' + rack.rack_nombre, datos: h('div', null, [datos, errorCaja]), botones, modoEdicion: editando, pie });

    // ---- leyenda y tabla alternativa
    /** @param {string} st @param {string} t */
    const li = (st, t) => h('span', null, [h('i', { style: st }), t]);
    const leyenda = h('div', { class: 'leyenda' }, [li('background:var(--c-equipo)', 'Equipo de red'), li('background:var(--c-servidor)', 'Servidor'), li('background:var(--c-rack)', 'UPS'),
      li('background:var(--acc);outline:2px solid var(--acc)', 'Equipo resaltado'), li('background:repeating-linear-gradient(45deg,var(--surf2) 0 3px,var(--surf) 3px 6px)', 'U libre'),
      h('span', { text: 'U1 abajo, U' + total + ' arriba.' })]);
    const alternativa = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('h3', { text: 'Equipos montados (alternativa en tabla)' }),
      equipos.length ? tabla(['Equipo', 'Tipo', 'Unidades'], equipos.slice().reverse().map(e => [e.equipo_nombre, ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo, rangoU(e)]),
        { tipo: 'equipo', onFila: (_f, i) => abrir(equipos.slice().reverse()[i]) })
        : h('div', { class: 'aviso', text: 'Este rack está vacío. Para montar un equipo, indicá su rack y sus unidades desde la ficha del equipo.' })]);

    const migas = raiz.concat([['Racks', '#/racks'], [rack.rack_nombre, enResalt ? '#/rack/' + rack.id : undefined]]);
    if (enResalt) migas.push([enResalt.equipo_nombre]);
    pantalla(contenedor, { codigo: 'P08', nombre: 'Vista de rack', migas });
    const barra = h('div', { class: 'pestanas', role: 'tablist' }, [['', 'Vista de rack'], ['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']].map(t => h('button', { type: 'button', role: 'tab', class: t[0] === tabExtra ? 'sel' : '',
      'aria-selected': String(t[0] === tabExtra), onclick: () => ir('#/rack/' + rack.id + (t[0] ? '/' + t[0] : '')) }, [t[1]])));
    if (tabExtra) {
      contenedor.appendChild(cabecera); contenedor.appendChild(barra);
      const zona = h('div'); contenedor.appendChild(zona);
      if (tabExtra === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'Rack', entidadId: rack.id, organizacionId: org });
      else await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'Rack', entidadId: rack.id, organizacionId: org });
      return;
    }
    contenedor.appendChild(h('div', { class: 'rk-fila-rack' }, [dibujo, h('div', { class: 'rk-der' }, [cabecera, barra, leyenda, alternativa])]));
    if (elResaltado) { const el = elResaltado; setTimeout(() => { if (el.isConnected) el.scrollIntoView({ block: 'center' }); }, 60); }
  };
  await pintar();
}
