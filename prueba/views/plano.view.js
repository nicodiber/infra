// @ts-check
/**
 * P32 · Plano de la sede (`#/plano/<ubicacionId>`, MJ44, D-058): imagen del plano de la ubicación con marcadores de racks,
 * puestos y access points según `plano_x` / `plano_y` (0–1). Quien modifica puede subir el plano, ubicar, mover y sacar elementos.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h } from '../assets/js/utiles.js';
import { estadoVacio, porId, rutaUbicacion, partesHash } from '../assets/js/racks.js';

const TIPOS = {
  rack: { rotulo: 'Racks', unico: 'Rack', color: 'var(--c-rack)', coleccion: 'racks', modulo: 'racks', forma: 'cuadrado' },
  puesto: { rotulo: 'Puestos', unico: 'Puesto', color: 'var(--c-puesto)', coleccion: 'puestos', modulo: 'red', forma: 'circulo' },
  ap: { rotulo: 'Access points', unico: 'Access point', color: 'var(--c-wifi)', coleccion: 'equipos', modulo: 'red', forma: 'triangulo' }
};


/** @param {string} forma */
function svgForma(forma) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 22 22'); s.setAttribute('aria-hidden', 'true');
  const f = forma === 'cuadrado' ? document.createElementNS(ns, 'rect') : forma === 'circulo' ? document.createElementNS(ns, 'circle') : document.createElementNS(ns, 'polygon');
  if (forma === 'cuadrado') { f.setAttribute('x', '3'); f.setAttribute('y', '3'); f.setAttribute('width', '16'); f.setAttribute('height', '16'); f.setAttribute('rx', '2'); }
  else if (forma === 'circulo') { f.setAttribute('cx', '11'); f.setAttribute('cy', '11'); f.setAttribute('r', '8'); }
  else f.setAttribute('points', '11,2 20,19 2,19');
  f.setAttribute('class', 'f'); s.appendChild(f); return s;
}

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  const ubId = partesHash().segs[1] || '';
  const raiz = await migasRaiz();
  pantalla(contenedor, { codigo: 'P32', nombre: 'Plano de la sede', migas: raiz.concat([['Racks', '#/racks'], ['Plano']]) });
  if (!org || !puede(u, 'ver', 'organizacion', org)) { contenedor.appendChild(h('div', { class: 'aviso', text: 'Tu rol no tiene acceso a los planos de la organización.' })); return; }
  const ubicaciones = await repositorio.listar('ubicaciones', { organizacion_id: org });
  const mapaU = porId(ubicaciones);
  const ub = mapaU.get(ubId);
  if (!ub) {
    contenedor.appendChild(h('h1', { text: 'Planos de la organización' }));
    const conPlano = ubicaciones.filter(x => x.ubicacion_plano_archivo_id);
    if (!conPlano.length) { contenedor.appendChild(estadoVacio('Todavía no hay planos', 'Entrá a una sede o sala desde «Racks» (enlace «Plano») y subí la imagen de su plano.', 'rack')); return; }
    contenedor.appendChild(h('ul', null, conPlano.map(x => h('li', null, [h('a', { href: '#/plano/' + x.id, text: rutaUbicacion(x.id, mapaU) })]))));
    return;
  }
  const puedeSubir = puede(u, 'modificar', 'organizacion', org);

  // Subárbol de ubicaciones
  /** @type {Set<string>} */
  const ids = new Set([ub.id]);
  for (let cambio = true; cambio;) { cambio = false; for (const x of ubicaciones) if (x.ubicacion_padre_id && ids.has(x.ubicacion_padre_id) && !ids.has(x.id)) { ids.add(x.id); cambio = true; } }
  const [racks, puestos, equipos] = await Promise.all([
    repositorio.listar('racks', r => r.organizacion_id === org && ids.has(r.ubicacion_id)),
    repositorio.listar('puestos', r => r.organizacion_id === org && ids.has(r.ubicacion_id)),
    repositorio.listar('equipos', r => r.organizacion_id === org && r.equipo_tipo === 'access_point' && ids.has(r.ubicacion_id))]);
  /** @type {Array<{tipo: 'rack'|'puesto'|'ap', reg: any, nombre: string, ficha: string}>} */
  const elementos = [];
  racks.forEach(r => elementos.push({ tipo: 'rack', reg: r, nombre: r.rack_nombre, ficha: '#/rack/' + r.id }));
  puestos.forEach(r => elementos.push({ tipo: 'puesto', reg: r, nombre: r.puesto_nombre, ficha: '#/puesto/' + r.id }));
  equipos.forEach(r => elementos.push({ tipo: 'ap', reg: r, nombre: r.equipo_nombre, ficha: '#/equipo/' + r.id }));
  const visibleTipo = (/** @type {'rack'|'puesto'|'ap'} */ t) => puede(u, 'ver', TIPOS[t].modulo, org);
  const modificaTipo = (/** @type {'rack'|'puesto'|'ap'} */ t) => puede(u, 'modificar', TIPOS[t].modulo, org);

  let archivoId = ub.ubicacion_plano_archivo_id;
  let src = archivoId ? await repositorio.contenidoDeArchivo(archivoId) : null;
  let mime = '';
  if (archivoId) { const a = (await repositorio.archivosDe('Ubicacion', ub.id, 'plano')).find(x => x.id === archivoId); mime = a ? a.archivo_mime : ''; }
  if (src && !/^data:image\//.test(src)) src = null;

  /** @type {Set<string>} */
  const ocultos = new Set();
  let modoUbicar = false;
  /** @type {any} */
  let seleccionado = null; // elemento elegido (ubicado o por ubicar)

  contenedor.appendChild(h('h1', { text: 'Plano · ' + rutaUbicacion(ub.id, mapaU) }));
  const herr = h('div', { class: 'herr' });
  contenedor.appendChild(herr);
  const zona = h('div');
  contenedor.appendChild(zona);

  const subir = async (/** @type {File|undefined} */ f) => {
    if (!f) return;
    try {
      const esImg = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(f.type);
      if (!esImg && f.type !== 'application/pdf') throw new Error('Subí una imagen (PNG, JPG, SVG) o un PDF.');
      await repositorio.guardarArchivo({ entidad: 'Ubicacion', entidadId: ub.id, tipo: esImg ? 'plano' : 'otro', archivo: f, usuarioId: u.id });
      if (!esImg) { toast('El PDF quedó adjunto a la sede o sala, pero no se usa de fondo: subí una imagen o SVG.'); return; }
      toast('Plano cargado'); contenedor.textContent = ''; await renderVista(contenedor);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo subir el plano.'); }
  };
  const entrada = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/gif,image/webp,application/pdf', hidden: 'hidden', 'aria-label': 'Archivo del plano' }));
  entrada.addEventListener('change', () => subir(entrada.files ? entrada.files[0] : undefined));
  herr.appendChild(entrada);
  if (puedeSubir) herr.appendChild(h('button', { type: 'button', text: src ? 'Reemplazar plano' : 'Subir plano', onclick: () => entrada.click() }));
  const btnUbicar = h('button', { type: 'button', 'aria-pressed': 'false', text: 'Ubicar', title: 'Colocar y mover elementos sobre el plano', onclick: () => { modoUbicar = !modoUbicar; seleccionado = null; pintar(); } });
  if (src && elementos.some(e => visibleTipo(e.tipo) && modificaTipo(e.tipo))) herr.appendChild(btnUbicar);
  herr.appendChild(h('span', { class: 'mut', text: 'Imagen o SVG de hasta 5 MB. Un PDF se adjunta pero no se usa de fondo.' }));

  const pintar = () => {
    zona.textContent = '';
    btnUbicar.setAttribute('aria-pressed', String(modoUbicar));
    btnUbicar.className = modoUbicar ? 'primario' : '';
    btnUbicar.textContent = modoUbicar ? 'Terminar de ubicar' : 'Ubicar';
    if (!src) {
      zona.appendChild(estadoVacio('Esta sede o sala todavía no tiene plano',
        'Subí una imagen o un SVG del plano (hasta 5 MB) con «Subir plano'
        + (puedeSubir ? '' : '» — pedíselo a quien modifica la organización') + '. Después ubicás sobre él los racks, puestos y access points. Un PDF se adjunta pero no se usa de fondo.', 'rack'));
      return;
    }
    const lienzo = h('div', { class: 'pl-lienzo' + (modoUbicar ? ' pl-ubicar' : '') });
    lienzo.appendChild(h('img', { src, alt: 'Plano de ' + ub.ubicacion_nombre + (mime ? ' (' + mime + ')' : '') }));
    const ubicados = elementos.filter(e => visibleTipo(e.tipo) && e.reg.plano_x != null && e.reg.plano_y != null);
    for (const e of ubicados) {
      if (ocultos.has(e.tipo)) continue;
      const t = TIPOS[e.tipo];
      const m = h('button', { type: 'button', class: 'pl-m' + (seleccionado && seleccionado.reg.id === e.reg.id ? ' sel' : ''), style: `left:${e.reg.plano_x * 100}%;top:${e.reg.plano_y * 100}%;--mc:${t.color}`,
        title: t.unico + ': ' + e.nombre, 'aria-label': t.unico + ' ' + e.nombre });
      m.appendChild(svgForma(t.forma));
      if (modoUbicar && modificaTipo(e.tipo)) arrastrable(m, e, lienzo);
      else m.addEventListener('click', ev => { ev.stopPropagation(); if (modoUbicar) { seleccionado = e; pintar(); } else ir(e.ficha); });
      lienzo.appendChild(m);
    }
    lienzo.addEventListener('click', async ev => {
      if (!modoUbicar || !seleccionado || seleccionado.reg.plano_x != null) return;
      const r = lienzo.getBoundingClientRect();
      await colocar(seleccionado, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    });

    const lado = h('div', { class: 'pl-lado' });
    // Leyenda y filtros
    const ley = h('div', { class: 'pl-leyenda', role: 'group', 'aria-label': 'Leyenda y filtros por tipo' });
    for (const k of /** @type {Array<'rack'|'puesto'|'ap'>} */ (['rack', 'puesto', 'ap'])) {
      if (!visibleTipo(k)) continue;
      const n = ubicados.filter(e => e.tipo === k).length;
      const c = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!ocultos.has(k)), style: `--mc:${TIPOS[k].color}`, title: 'Mostrar u ocultar ' + TIPOS[k].rotulo.toLowerCase(),
        onclick: () => { if (ocultos.has(k)) ocultos.delete(k); else ocultos.add(k); pintar(); } }, [svgForma(TIPOS[k].forma), TIPOS[k].rotulo, h('span', { class: 'n', text: String(n) })]);
      ley.appendChild(c);
    }
    lado.appendChild(h('div', { class: 'bloque' }, [h('h3', { text: 'Leyenda' }), ley]));

    if (modoUbicar) {
      const sinUbicar = elementos.filter(e => visibleTipo(e.tipo) && modificaTipo(e.tipo) && e.reg.plano_x == null);
      const sel = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Elemento sin ubicar' }, [h('option', { value: '', text: '— Elegí un elemento sin ubicar (' + sinUbicar.length + ') —' })]));
      for (const k of /** @type {Array<'rack'|'puesto'|'ap'>} */ (['rack', 'puesto', 'ap'])) {
        const g = sinUbicar.filter(e => e.tipo === k).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
        if (g.length) sel.appendChild(h('optgroup', { label: TIPOS[k].rotulo }, g.map(e => h('option', { value: e.reg.id, text: e.nombre, ...(seleccionado && seleccionado.reg.id === e.reg.id ? { selected: 'selected' } : {}) }))));
      }
      sel.addEventListener('change', () => { seleccionado = sinUbicar.find(e => e.reg.id === sel.value) || null; pintar(); });
      const caja = h('div', { class: 'bloque' }, [h('h3', { text: 'Ubicar' }), sel]);
      if (seleccionado && seleccionado.reg.plano_x == null) caja.appendChild(h('p', { class: 'mut', text: 'Hacé clic en el plano donde está «' + seleccionado.nombre + '».' }));
      else if (seleccionado) {
        caja.appendChild(h('p', { text: seleccionado.nombre }));
        caja.appendChild(h('div', { class: 'herr' }, [h('a', { href: seleccionado.ficha, text: 'Abrir ficha' }),
          h('button', { type: 'button', text: 'Sacar del plano', onclick: () => colocar(seleccionado, null, null) })]));
      } else caja.appendChild(h('p', { class: 'mut', text: 'Elegí un elemento de la lista y hacé clic en el plano; o arrastrá un marcador para moverlo. Con un clic en un marcador podés sacarlo del plano.' }));
      lado.appendChild(caja);
    }
    zona.appendChild(h('div', { class: 'pl-layout' }, [lienzo, lado]));

    // Alternativa en tabla (D-039)
    const filas = ubicados.filter(e => !ocultos.has(e.tipo)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    const det = h('details', { style: 'margin-top:12px' }, [h('summary', { text: 'Ver como tabla (' + filas.length + ' elementos en el plano)' })]);
    const t = h('table'); t.appendChild(h('thead', null, [h('tr', null, ['Tipo', 'Nombre', 'Posición'].map(c => h('th', { text: c })))]));
    const tb = h('tbody');
    for (const e of filas) tb.appendChild(h('tr', null, [h('td', { text: TIPOS[e.tipo].unico }), h('td', null, [h('a', { href: e.ficha, text: e.nombre })]),
      h('td', { text: Math.round(e.reg.plano_x * 100) + ' % · ' + Math.round(e.reg.plano_y * 100) + ' %' })]));
    t.appendChild(tb); det.appendChild(t); zona.appendChild(det);
    if (!ubicados.length) zona.appendChild(h('p', { class: 'mut', text: 'Todavía no hay elementos ubicados en este plano.' + (elementos.length ? ' Usá «Ubicar» para colocarlos.' : '') }));
  };

  /** @param {any} e @param {number|null} x @param {number|null} y */
  async function colocar(e, x, y) {
    try {
      const cx = x == null ? null : Math.min(1, Math.max(0, Math.round(x * 10000) / 10000)), cy = y == null ? null : Math.min(1, Math.max(0, Math.round(y * 10000) / 10000));
      const nuevo = await repositorio.colocarEnPlano({ coleccion: /** @type {any} */ (TIPOS[e.tipo].coleccion), id: e.reg.id, x: cx, y: cy, usuarioId: u.id });
      e.reg = nuevo; seleccionado = cx == null ? null : e;
      toast(cx == null ? e.nombre + ' salió del plano' : e.nombre + ' ubicado en el plano');
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo guardar la posición.'); }
    pintar();
  }

  /** @param {HTMLElement} m @param {any} e @param {HTMLElement} lienzo */
  function arrastrable(m, e, lienzo) {
    let mueve = false, x0 = 0, y0 = 0;
    m.addEventListener('pointerdown', ev => { ev.stopPropagation(); m.setPointerCapture(ev.pointerId); mueve = false; x0 = ev.clientX; y0 = ev.clientY; });
    m.addEventListener('pointermove', ev => {
      if (!m.hasPointerCapture(ev.pointerId)) return;
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) mueve = true;
      if (!mueve) return;
      const r = lienzo.getBoundingClientRect();
      m.style.left = Math.min(100, Math.max(0, (ev.clientX - r.left) / r.width * 100)) + '%';
      m.style.top = Math.min(100, Math.max(0, (ev.clientY - r.top) / r.height * 100)) + '%';
    });
    m.addEventListener('pointerup', async ev => {
      if (!m.hasPointerCapture(ev.pointerId)) return;
      m.releasePointerCapture(ev.pointerId);
      if (!mueve) { seleccionado = e; pintar(); return; }
      const r = lienzo.getBoundingClientRect();
      await colocar(e, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    });
    m.addEventListener('keydown', ev => { if (ev.key === 'Enter') { seleccionado = e; pintar(); } });
  }
  pintar();
}
