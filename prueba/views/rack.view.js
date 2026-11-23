// @ts-check
/**
 * P08 · Vista de rack (`#/rack/<id>[?resaltar=<equipoId>]`): rack dibujado por U a partir de los datos,
 * equipo resaltado, clic a la ficha, tabla alternativa, datos del rack con edición en el lugar,
 * verificación y acceso al «Recorrido de verificación».
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast, abrirModal, cerrarModal } from '../assets/js/marco.js';
import { h, tabla, normalizar } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import { confirmarConPasos } from '../assets/js/verificacion.js';
import {
  aplicarEstilos, botonBaja, bloqueSinPermiso, estadoVacio, fichaBloque, pieVerificacion, nombresDeUsuarios, partesHash, rangoU, rutaEquipo, moduloEquipo,
  claseTipoRack, porId, rutaUbicacion, textoUnidadesLibres, unidadesOcupadas, primeraUnidadLibre, validarLugarEnRack
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
  /** Equipo elegido en el dibujo, equipo en edición de U, panel «Agregar» y mensaje de la barra de equipo. @type {string|null} */
  let seleccion = null;
  /** @type {string|null} */
  let editandoEq = null;
  let agregando = false;
  let msgEq = '';

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
    /** ¿Puede cambiar el lugar de este equipo en el rack? Modifica racks o el módulo del equipo. @param {any} e */
    const puedeEdU = e => puede(u, 'modificar', 'racks', org) || puede(u, 'modificar', moduloEquipo(e), org);
    const hayEdU = puedeModificar || equipos.some(puedeEdU);
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
      const b = h('button', { type: 'button', class: 'eq ' + claseTipoRack(e.equipo_tipo) + (e.id === resaltar || e.id === seleccion ? ' resalt' : ''),
        style: 'top:' + ((total - (e.rack_u_inicio + alto - 1)) * ALTO_U) + 'px;height:' + (alto * ALTO_U - 1) + 'px', title: e.equipo_nombre,
        'aria-label': e.equipo_nombre + ', ' + rotulo + ', unidad ' + rangoU(e) + (e.id === resaltar ? ', resaltado' : '') + (e.id === seleccion ? ', seleccionado' : ''), onclick: () => { if (puedeEdU(e)) { seleccion = seleccion === e.id ? null : e.id; msgEq = ''; pintar(); } else abrir(e); },
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
    const invertidos = equipos.slice().reverse();
    // ---- cambiar el lugar de un equipo (unidad inicial y alto), con validación
    /** @param {any} e @param {number} ini @param {number} alto @returns {Promise<boolean>} */
    const cambiarLugar = async (e, ini, alto) => {
      const falla = await validarLugarEnRack(id, ini, alto, e.id);
      if (falla) { msgEq = falla; return false; }
      try { await repositorio.guardar('equipos', { ...e, rack_u_inicio: ini, rack_u_alto: alto }, u.id); }
      catch (err) { msgEq = err instanceof Error ? err.message : 'No se pudo guardar.'; return false; }
      msgEq = ''; toast(e.equipo_nombre + ' ahora ocupa ' + rangoU({ rack_u_inicio: ini, rack_u_alto: alto }) + ' · verificado hoy');
      return true;
    };
    const quitarDelRack = (/** @type {any} */ e) => {
      abrirModal(h('div', { class: 'bloque rk-modal rk-form', role: 'dialog', 'aria-label': 'Quitar del rack' }, [
        h('h2', { text: 'Quitar «' + e.equipo_nombre + '» del rack' }),
        h('p', { text: 'El equipo no se borra: queda sin rack ni unidades y lo podés volver a montar con «Agregar equipo al rack». El cambio queda en el historial.' }),
        h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Sí, quitar del rack', onclick: async () => {
          try { await repositorio.guardar('equipos', { ...e, rack_id: null, rack_u_inicio: null, rack_u_alto: null }, u.id); }
          catch (err) { msgEq = err instanceof Error ? err.message : 'No se pudo guardar.'; }
          cerrarModal(); if (!msgEq) toast(e.equipo_nombre + ' quitado del rack'); seleccion = null; editandoEq = null; await pintar();
        } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() })])]));
    };
    const msgCaja = () => h('div', { class: 'msg mal', role: 'alert', text: msgEq, hidden: msgEq ? null : 'hidden' });

    // barra del equipo seleccionado en el dibujo
    const eSel = seleccion ? equipos.find(x => x.id === seleccion) : null;
    /** @type {HTMLElement|null} */
    let barraSel = null;
    if (eSel && puedeEdU(eSel)) {
      const ini = /** @type {number} */ (eSel.rack_u_inicio), alto = eSel.rack_u_alto || 1;
      /** @param {number} d */
      const mover = async d => { if (await cambiarLugar(eSel, ini + d, alto)) { await pintar(); } else { await pintar(); } };
      barraSel = h('div', { class: 'rk-sel', role: 'group', 'aria-label': 'Equipo seleccionado' }, [
        h('div', null, [h('b', { text: eSel.equipo_nombre }), ' · ' + (ROTULO_EQUIPO_TIPO[eSel.equipo_tipo] || eSel.equipo_tipo) + ' · ' + rangoU(eSel)]),
        h('div', { class: 'herr' }, [
          h('button', { type: 'button', text: 'Subir 1 U', onclick: () => mover(1) }), h('button', { type: 'button', text: 'Bajar 1 U', onclick: () => mover(-1) }),
          h('button', { type: 'button', text: 'Editar unidades', onclick: () => { editandoEq = eSel.id; msgEq = ''; pintar(); } }),
          h('button', { type: 'button', text: 'Quitar del rack', onclick: () => quitarDelRack(eSel) }),
          h('button', { type: 'button', text: 'Abrir ficha', onclick: () => abrir(eSel) }),
          h('button', { type: 'button', text: 'Cerrar', onclick: () => { seleccion = null; msgEq = ''; pintar(); } })]),
        msgCaja()]);
    } else if (hayEdU && equipos.length) {
      barraSel = h('div', { class: 'mut', style: 'margin:8px 0;font-size:13px', text: 'Tocá un equipo del dibujo para subirlo, bajarlo o quitarlo del rack. Su ficha se abre desde la tabla.' });
    }

    // tabla de equipos del rack (con edición de U en el lugar)
    /** @param {any} e @returns {Node} */
    const celdaUnidades = e => {
      if (editandoEq !== e.id) return rangoU(e);
      const inIni = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '1', max: String(total), id: 'eq-ini', 'aria-label': 'Unidad inicial de ' + e.equipo_nombre })); inIni.value = String(e.rack_u_inicio);
      const inAlto2 = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '1', max: String(total), id: 'eq-alto', 'aria-label': 'Alto en U de ' + e.equipo_nombre })); inAlto2.value = String(e.rack_u_alto || 1);
      const guardarU = async () => {
        const ok = await cambiarLugar(e, parseInt(inIni.value, 10), parseInt(inAlto2.value, 10));
        if (ok) editandoEq = null;
        await pintar();
      };
      const detener = (/** @type {Event} */ ev) => ev.stopPropagation(); // que clics y Enter de la edición no abran la ficha de la fila
      for (const i of [inIni, inAlto2]) i.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') guardarU(); });
      return h('div', { onclick: detener, onkeydown: detener }, [h('div', { class: 'rk-ed' }, [h('label', { for: 'eq-ini', text: 'U inicial' }), inIni, h('label', { for: 'eq-alto', text: 'Alto en U' }), inAlto2,
        h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardarU }), h('button', { type: 'button', text: 'Cancelar', onclick: () => { editandoEq = null; msgEq = ''; pintar(); } })]), msgCaja()]);
    };
    /** @type {HTMLElement} */
    let cuerpoEquipos;
    if (!equipos.length) cuerpoEquipos = h('div', { class: 'aviso', text: 'Este rack está vacío. ' + (hayEdU ? 'Usá «Agregar equipo al rack» para montar uno.' : 'Para montar un equipo, pedile a quien administre este rack que lo agregue.') });
    else {
      const cab = ['Equipo', 'Tipo', 'Unidades'].concat(hayEdU ? ['Acciones'] : []);
      cuerpoEquipos = tabla(cab, invertidos.map(e => {
        const fila = [e.equipo_nombre, ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo, celdaUnidades(e)];
        if (hayEdU) fila.push(puedeEdU(e) && editandoEq !== e.id ? h('button', { type: 'button', text: 'Editar unidades', 'aria-label': 'Editar unidades de ' + e.equipo_nombre,
          onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); editandoEq = e.id; seleccion = e.id; msgEq = ''; pintar(); } }) : '');
        return fila;
      }), { tipo: 'equipo', onFila: (f, i) => { if (editandoEq !== invertidos[i].id) abrir(invertidos[i]); } });
    }

    // «Agregar equipo al rack»
    /** @type {HTMLElement|null} */
    let panelAgregar = null;
    if (agregando && puedeModificar) {
      const libres = (await repositorio.listar('equipos', x => x.organizacion_id === org && !x.rack_id && !x.puesto_id && x.equipo_estado !== 'baja', { ordenarPor: 'equipo_nombre' }))
        .filter(x => puedeEdU(x));
      const busca = /** @type {HTMLInputElement} */ (h('input', { type: 'search', id: 'ag-busca', placeholder: 'Buscar por nombre, código o tipo…', 'aria-label': 'Buscar equipo sin rack' }));
      const lista = /** @type {HTMLSelectElement} */ (h('select', { id: 'ag-equipo', size: '6', 'aria-label': 'Equipos de la organización sin rack' }));
      const inAlto3 = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '1', id: 'ag-alto' })); inAlto3.value = '1';
      const inIni3 = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '1', max: String(total), id: 'ag-ini' }));
      const err = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
      const sugerir = () => {
        const a = parseInt(inAlto3.value, 10) || 1; const sug = primeraUnidadLibre(total, equipos, a);
        inIni3.value = sug == null ? '' : String(sug);
        sugerencia.textContent = sug == null ? 'No hay ' + a + ' U libres seguidas en este rack.' : 'Sugerida: primera U libre donde entra (U' + sug + ').';
      };
      const sugerencia = h('div', { class: 'mut', style: 'font-size:13px' });
      const rotuloEq = (/** @type {any} */ x) => x.equipo_nombre + ' · ' + (ROTULO_EQUIPO_TIPO[x.equipo_tipo] || x.equipo_tipo) + (x.equipo_codigo ? ' · ' + x.equipo_codigo : '');
      const llenar = () => {
        const q = normalizar(busca.value); lista.textContent = '';
        const vis = libres.filter(x => normalizar(rotuloEq(x)).includes(q));
        for (const x of vis) lista.appendChild(h('option', { value: x.id, text: rotuloEq(x) }));
        if (!vis.length) lista.appendChild(h('option', { value: '', disabled: 'disabled', text: libres.length ? 'Ningún equipo coincide.' : 'No hay equipos sin rack en esta organización.' }));
      };
      busca.addEventListener('input', llenar);
      lista.addEventListener('change', () => { const x = libres.find(y => y.id === lista.value); if (x) { inAlto3.value = String(x.rack_u_alto || 1); sugerir(); } });
      inAlto3.addEventListener('input', sugerir);
      llenar(); sugerir();
      const agregar = async () => {
        const x = libres.find(y => y.id === lista.value);
        const falla = (/** @type {string} */ m) => { err.textContent = m; err.hidden = false; };
        if (!x) return falla('Elegí un equipo de la lista.');
        const ini = parseInt(inIni3.value, 10), alto = parseInt(inAlto3.value, 10);
        const m = await validarLugarEnRack(id, ini, alto, x.id);
        if (m) return falla(m);
        try { await repositorio.guardar('equipos', { ...x, rack_id: id, rack_u_inicio: ini, rack_u_alto: alto, ubicacion_id: rack.ubicacion_id }, u.id); }
        catch (e2) { return falla(e2 instanceof Error ? e2.message : 'No se pudo guardar.'); }
        agregando = false; seleccion = x.id; msgEq = ''; toast(x.equipo_nombre + ' montado en ' + rangoU({ rack_u_inicio: ini, rack_u_alto: alto }) + ' · verificado hoy'); await pintar();
      };
      panelAgregar = h('div', { class: 'rk-agregar rk-form', role: 'group', 'aria-label': 'Agregar equipo al rack' }, [
        h('label', { for: 'ag-busca', text: 'Equipo de la organización sin rack' }), busca, lista,
        h('div', { class: 'rk-campos', style: 'margin-top:8px' }, [h('div', null, [h('label', { for: 'ag-alto', text: 'Alto en U' }), inAlto3]), h('div', null, [h('label', { for: 'ag-ini', text: 'U inicial' }), inIni3])]),
        sugerencia, err,
        h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Agregar al rack', onclick: agregar }), h('button', { type: 'button', text: 'Cancelar', onclick: () => { agregando = false; pintar(); } })])]);
    }
    const alternativa = h('div', { class: 'bloque', style: 'margin-top:10px' }, [
      h('div', { class: 'herr', style: 'justify-content:space-between' }, [h('h3', { text: 'Equipos montados (alternativa en tabla)' }),
        puedeModificar && !agregando ? h('button', { type: 'button', text: 'Agregar equipo al rack', onclick: () => { agregando = true; pintar(); } }) : null]),
      panelAgregar, cuerpoEquipos]);

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
    contenedor.appendChild(h('div', { class: 'rk-fila-rack' }, [dibujo, h('div', { class: 'rk-der' }, [cabecera, barra, barraSel, leyenda, alternativa])]));
    if (elResaltado) { const el = elResaltado; setTimeout(() => { if (el.isConnected) el.scrollIntoView({ block: 'center' }); }, 60); }
  };
  await pintar();
}
