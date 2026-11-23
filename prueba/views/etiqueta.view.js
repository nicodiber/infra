// @ts-check
/**
 * P27 · Etiquetas con QR (D-056, D-062).
 *  - `#/etiqueta/<coleccion>/<id>`: una etiqueta de 100 × 50 mm (equipos y racks), vista previa a tamaño real, imprimir y descargar SVG.
 *  - `#/etiquetas`: varias a la vez (racks, equipos de red, PC y notebooks, servidores), una por página.
 * La etiqueta es siempre blanco y negro (también en tema oscuro). Nunca lleva claves: de la licencia solo va el producto.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla, normalizar } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import { bloqueSinPermiso, estadoVacio, partesHash, rangoU, rutaUbicacion, porId, moduloEquipo } from '../assets/js/racks.js';
import { qrSvg } from '../assets/js/qr.js';

const NS = 'http://www.w3.org/2000/svg';
const CATEGORIAS_PC = ['PC de escritorio', 'Notebook'];

/** Solo el CSS de impresión; el de pantalla está en assets/css/estilos.css (el @page y el @media print se quedan acá para no cambiar la impresión). */
const CSS = `
@media print{
  @page{size:100mm 50mm;margin:0}
  html,body{margin:0 !important;padding:0 !important;background:#fff !important;height:auto !important;overflow:visible !important}
  body>*:not(#et-impresion){display:none !important}
  #et-impresion{display:block !important}
  #et-impresion .et-hoja{width:100mm;height:50mm;overflow:hidden;page-break-after:always;break-after:page;background:#fff;line-height:0}
  #et-impresion .et-hoja:last-child{page-break-after:auto;break-after:auto}
  #et-impresion svg{display:block}
}
`;

function estilos() {
  if (document.getElementById('estilos-etiquetas')) return;
  const s = document.createElement('style');
  s.id = 'estilos-etiquetas';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------------------------
// Datos de cada etiqueta
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} DatosEtiqueta
 * @property {string} clase 'rack' | 'equipo' | 'pc'
 * @property {string} codigo Texto grande.
 * @property {string} nombre
 * @property {Array<[string, string]>} lineas Pares rótulo / valor.
 * @property {string} url Lo que codifica el QR.
 * @property {string} pie
 */

/** @param {string} hashRuta «#/equipo/<id>» → URL completa de la ficha. */
const urlFicha = hashRuta => location.origin + location.pathname + hashRuta;

/** @param {any} e */
const esPC = e => e.equipo_tipo === 'otro' && CATEGORIAS_PC.includes(String((e.equipo_campos && e.equipo_campos.otro_categoria) || ''));

/**
 * Datos comunes de una organización para armar etiquetas (una sola lectura).
 * @param {string} orgId
 */
async function cargarContexto(orgId) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const [ubicaciones, racks, org] = await Promise.all([
    repositorio.listar('ubicaciones', { organizacion_id: orgId }), repositorio.listar('racks', { organizacion_id: orgId }), repositorio.obtener('organizaciones', orgId)]);
  /** @type {Map<string, string>} */
  const licenciaDe = new Map();
  const veLicencias = puede(u, 'ver', 'licencias', orgId);
  if (veLicencias) {
    const [lics, inst] = await Promise.all([repositorio.listar('licencias', { organizacion_id: orgId }), repositorio.listar('instalaciones_licencia', { organizacion_id: orgId })]);
    const prod = new Map(lics.map(l => [l.id, String(l.licencia_producto || '')]));
    /** @type {Map<string, string[]>} */
    const porEquipo = new Map();
    for (const i of inst) {
      if (i.instalacion_hasta || !prod.get(i.licencia_id)) continue; // solo vigentes
      (porEquipo.get(i.equipo_id) || porEquipo.set(i.equipo_id, []).get(i.equipo_id) || []).push(/** @type {string} */ (prod.get(i.licencia_id)));
    }
    for (const [eq, lista] of porEquipo) licenciaDe.set(eq, lista.find(p => /windows|macos|linux|ubuntu|sistema/i.test(p)) || lista[0]);
  }
  return { u, orgId, orgNombre: org ? String(org.organizacion_nombre) : '', ubicaciones, mapaUb: porId(ubicaciones), racks, mapaRack: porId(racks), licenciaDe, veLicencias };
}

/** @typedef {Awaited<ReturnType<typeof cargarContexto>>} Contexto */

/** @param {Contexto} c @param {any} e */
function ubicacionDeEquipo(c, e) {
  const rack = e.rack_id ? c.mapaRack.get(e.rack_id) : null;
  return e.ubicacion_id || (rack && rack.ubicacion_id) || null;
}

/** @param {Contexto} c @param {any} r */
function datosRack(c, r) {
  return /** @type {DatosEtiqueta} */ ({
    clase: 'rack', codigo: r.rack_nombre, nombre: 'Rack',
    lineas: [['Ubicación', rutaUbicacion(r.ubicacion_id, c.mapaUb) || '—'], ['Tamaño', r.rack_unidades_total + ' U']],
    url: urlFicha('#/rack/' + r.id), pie: c.orgNombre
  });
}

/** @param {Contexto} c @param {any} e */
function datosEquipo(c, e) {
  const ruta = (e.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + e.id;
  if (esPC(e)) {
    const lic = c.veLicencias ? (c.licenciaDe.get(e.id) || 'sin registrar') : '—';
    return /** @type {DatosEtiqueta} */ ({
      clase: 'pc', codigo: e.equipo_codigo, nombre: e.equipo_nombre,
      lineas: [['Licencia', lic], ['Alta', String(e.creado_en || '').slice(0, 7) || '—']],
      url: urlFicha(ruta), pie: c.orgNombre
    });
  }
  const rack = e.rack_id ? c.mapaRack.get(e.rack_id) : null;
  /** @type {Array<[string, string]>} */
  const lineas = [[ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo, [e.equipo_marca, e.equipo_modelo].filter(Boolean).join(' ') || '—']];
  if (rack) lineas.push(['Rack', rack.rack_nombre + (e.rack_u_inicio != null ? ' · ' + rangoU(e) : '')]);
  else lineas.push(['Ubicación', rutaUbicacion(ubicacionDeEquipo(c, e), c.mapaUb) || '—']);
  return /** @type {DatosEtiqueta} */ ({ clase: 'equipo', codigo: e.equipo_codigo, nombre: e.equipo_nombre, lineas, url: urlFicha(ruta), pie: c.orgNombre });
}

// ---------------------------------------------------------------------------------------------
// Dibujo de la etiqueta (SVG de 100 × 50 mm, blanco y negro)
// ---------------------------------------------------------------------------------------------

/**
 * Ajusta un texto a un ancho (mm): baja el tamaño hasta el mínimo y, si aún no entra, lo corta con «…».
 * @param {string} texto @param {number} ancho @param {number} tamano @param {number} minimo @param {number} factor Ancho medio de un carácter / tamaño.
 */
function ajustar(texto, ancho, tamano, minimo, factor) {
  let t = tamano;
  while (t > minimo && texto.length * t * factor > ancho) t = Math.round((t - 0.1) * 10) / 10;
  let s = texto;
  const max = Math.floor(ancho / (t * factor));
  if (s.length > max) s = s.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
  return { texto: s, tamano: t };
}

/**
 * @param {string} texto @param {number} x @param {number} y @param {number} tamano
 * @param {{negrita?: boolean, mono?: boolean}} [o]
 */
function textoSvg(texto, x, y, tamano, o) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', String(x)); t.setAttribute('y', String(y)); t.setAttribute('font-size', String(tamano));
  t.setAttribute('fill', '#000');
  t.setAttribute('font-family', o && o.mono ? "'Courier New', Courier, monospace" : 'Arial, Helvetica, sans-serif');
  if (o && o.negrita) t.setAttribute('font-weight', '700');
  t.textContent = texto;
  return t;
}

/**
 * Etiqueta completa como SVG.
 * @param {DatosEtiqueta} d
 * @returns {SVGSVGElement}
 */
function etiquetaSvg(d) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('width', '100mm'); svg.setAttribute('height', '50mm'); svg.setAttribute('viewBox', '0 0 100 50');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Etiqueta ' + d.codigo + ' · ' + d.nombre);
  const fondo = document.createElementNS(NS, 'rect');
  fondo.setAttribute('width', '100'); fondo.setAttribute('height', '50'); fondo.setAttribute('fill', '#fff');
  svg.appendChild(fondo);
  const qr = qrSvg(d.url, { margen: 2 });
  qr.setAttribute('x', '3'); qr.setAttribute('y', '5'); qr.setAttribute('width', '40'); qr.setAttribute('height', '40');
  svg.appendChild(qr);
  const X = 46, ANCHO = 51;
  const cod = ajustar(d.codigo, ANCHO, 9, 5, 0.64);
  svg.appendChild(textoSvg(cod.texto, X, 14, cod.tamano, { negrita: true }));
  const nom = ajustar(d.nombre, ANCHO, 4.4, 2.8, 0.56);
  svg.appendChild(textoSvg(nom.texto, X, 21.5, nom.tamano, { negrita: true }));
  const linea = document.createElementNS(NS, 'line');
  linea.setAttribute('x1', String(X)); linea.setAttribute('x2', '97'); linea.setAttribute('y1', '24'); linea.setAttribute('y2', '24');
  linea.setAttribute('stroke', '#000'); linea.setAttribute('stroke-width', '0.3');
  svg.appendChild(linea);
  // Cada dato va en una línea; si no entra ni achicando un poco, sigue en una segunda línea.
  let y = 30;
  for (const l of d.lineas.slice(0, 3)) {
    if (y > 43) break;
    const rot = l[0] + ': ';
    const rotAncho = rot.length * 1.8;
    const completo = rot + l[1];
    const t = textoSvg('', X, y, 3.2);
    const b = document.createElementNS(NS, 'tspan'); b.setAttribute('font-weight', '700'); b.textContent = rot;
    t.appendChild(b);
    if (completo.length * 3.0 * 0.55 <= ANCHO) {
      const v = ajustar(l[1], ANCHO - rotAncho, 3.2, 2.9, 0.54);
      t.setAttribute('font-size', String(v.tamano)); t.appendChild(document.createTextNode(v.texto));
      svg.appendChild(t); y += 5.4;
    } else {
      // corta en un espacio cerca de lo que entra en la primera línea
      const cabe = Math.floor((ANCHO - rotAncho) / (3.0 * 0.55));
      let corte = l[1].lastIndexOf(' ', cabe);
      if (corte < cabe * 0.4) corte = cabe;
      t.setAttribute('font-size', '3'); t.appendChild(document.createTextNode(l[1].slice(0, corte).trimEnd()));
      svg.appendChild(t);
      const resto = ajustar(l[1].slice(corte).trimStart(), ANCHO, 3, 2.5, 0.54);
      svg.appendChild(textoSvg(resto.texto, X, y + 3.9, resto.tamano));
      y += 9.3;
    }
  }
  const pie = ajustar(('Infradoc' + (d.pie ? ' · ' + d.pie : '')), ANCHO, 2.4, 2, 0.55);
  svg.appendChild(textoSvg(pie.texto, X, 47, pie.tamano));
  return svg;
}

// ---------------------------------------------------------------------------------------------
// Impresión y descarga
// ---------------------------------------------------------------------------------------------

/** Contenedor de impresión: solo es visible en `@media print`. */
function contenedorImpresion() {
  let c = document.getElementById('et-impresion');
  if (!c) { c = document.createElement('div'); c.id = 'et-impresion'; document.body.appendChild(c); }
  return c;
}

/** Quita lo que quedó para imprimir cuando se sale de la pantalla. */
function limpiarImpresion() { const c = document.getElementById('et-impresion'); if (c) c.textContent = ''; }

/** @param {SVGSVGElement[]} svgs Una por página. */
function imprimir(svgs) {
  const c = contenedorImpresion();
  c.textContent = '';
  for (const s of svgs) c.appendChild(h('div', { class: 'et-hoja' }, [/** @type {Node} */ (s.cloneNode(true))]));
  window.addEventListener('afterprint', limpiarImpresion, { once: true });
  window.print();
}

/** @param {SVGSVGElement} svg @param {string} nombre */
function descargarSvg(svg, nombre) {
  const texto = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([texto], { type: 'image/svg+xml' }));
  const a = h('a', { href: url, download: 'etiqueta-' + nombre.replace(/[^A-Za-z0-9_-]+/g, '-') + '.svg' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Nota que explica el alcance del QR en el prototipo (no se imprime). */
function notaQr() {
  return h('div', { class: 'et-nota', role: 'note' }, [
    h('b', { text: 'Sobre el QR en el prototipo. ' }),
    'El QR abre la ficha solo en un navegador que ya tenga estos datos (los datos del prototipo viven en cada navegador). ',
    'La página pública de solo lectura para el cliente y el acceso desde cualquier celular llegan con la versión real, con servidor (D-062).'
  ]);
}

// ---------------------------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------------------------

/**
 * @param {HTMLElement} contenedor
 * @param {any} [_info]
 */
export async function renderVista(contenedor, _info) {
  estilos();
  limpiarImpresion();
  const { segs } = partesHash();
  if (segs[0] === 'etiquetas') return renderLote(contenedor);
  return renderUna(contenedor, segs[1] || '', segs[2] || '');
}

/** @param {HTMLElement} contenedor @param {string} coleccion @param {string} id */
async function renderUna(contenedor, coleccion, id) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const raiz = await migasRaiz();
  const esRack = /^racks?$/.test(coleccion);
  const esEq = /^(equipos?|servidores?)$/.test(coleccion);
  const reg = esRack ? await repositorio.obtener('racks', id) : esEq ? await repositorio.obtener('equipos', id) : null;
  if (!reg) {
    pantalla(contenedor, { codigo: 'P27', nombre: 'Etiqueta', migas: raiz.concat([['Etiquetas', '#/etiquetas'], ['No encontrada']]) });
    contenedor.appendChild(estadoVacio('No encontramos ese elemento', 'Puede que se haya dado de baja o que el enlace sea viejo. Podés generar etiquetas desde «Etiquetas».', 'equipo', [h('a', { href: '#/etiquetas', text: 'Ir a Etiquetas' })]));
    return;
  }
  const modulo = esRack ? 'racks' : moduloEquipo(reg);
  if (!puede(u, 'ver', modulo, reg.organizacion_id)) {
    pantalla(contenedor, { codigo: 'P27', nombre: 'Etiqueta', migas: raiz.concat([['Etiquetas']]) });
    contenedor.appendChild(bloqueSinPermiso('Tu rol no tiene acceso al módulo ' + (modulo === 'racks' ? 'Racks' : modulo === 'servidores' ? 'Servidores' : 'Red') + ', así que no puede imprimir esta etiqueta.'));
    return;
  }
  const ctx = await cargarContexto(reg.organizacion_id);
  const d = esRack ? datosRack(ctx, reg) : datosEquipo(ctx, reg);
  const svg = etiquetaSvg(d);
  const ficha = esRack ? '#/rack/' + reg.id : (reg.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + reg.id;
  pantalla(contenedor, { codigo: 'P27', nombre: 'Etiqueta', migas: raiz.concat([['Etiquetas', '#/etiquetas'], [d.codigo]]) });
  contenedor.appendChild(h('h1', { text: 'Etiqueta de ' + d.codigo }));
  contenedor.appendChild(h('p', { class: 'mut', text: 'Vista previa a tamaño real (100 × 50 mm). La etiqueta siempre se imprime en blanco y negro.' }));
  contenedor.appendChild(h('div', { class: 'et-vista' }, [
    h('div', { class: 'et-papel' }, [svg]),
    h('div', { class: 'et-lado' }, [
      h('div', { class: 'herr' }, [
        h('button', { type: 'button', class: 'primario', text: 'Imprimir', onclick: () => imprimir([svg]) }),
        h('button', { type: 'button', text: 'Descargar SVG', onclick: () => descargarSvg(svg, d.codigo) }),
        h('a', { href: ficha, text: 'Ver la ficha' }),
        h('a', { href: '#/etiquetas', text: 'Etiquetas en lote' })
      ]),
      h('p', { class: 'mut', text: 'Al imprimir, elegí el tamaño de papel 100 × 50 mm (ya viene sugerido) y desactivá encabezados y márgenes si tu navegador los ofrece.' }),
      h('div', { class: 'mut', text: 'El QR lleva a: ' + d.url, style: 'word-break:break-all;font-size:12px' })
    ])
  ]));
  contenedor.appendChild(notaQr());
}

/** Tipos de la pantalla en lote. */
const TIPOS = /** @type {Array<[string, string, string]>} */ ([['racks', 'Racks', 'racks'], ['red', 'Equipos de red', 'red'], ['pc', 'PC y notebooks', 'red'], ['servidores', 'Servidores', 'servidores']]);
let fTipo = '', fUbic = '', fTexto = '';
/** @type {Set<string>} */
let marcadas = new Set();

/** @param {HTMLElement} contenedor */
async function renderLote(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  const raiz = await migasRaiz();
  pantalla(contenedor, { codigo: 'P27', nombre: 'Etiquetas', migas: raiz.concat([['Etiquetas']]) });
  const tipos = TIPOS.filter(t => org && puede(u, 'ver', /** @type {any} */ (t[2]), org));
  if (!org || !tipos.length) {
    contenedor.appendChild(bloqueSinPermiso(org ? 'Tu rol no tiene acceso a Racks, Red ni Servidores, así que no hay etiquetas para generar.' : 'Elegí una organización para generar etiquetas.'));
    return;
  }
  if (!tipos.some(t => t[0] === fTipo)) { fTipo = tipos[0][0]; marcadas = new Set(); }
  const ctx = await cargarContexto(org);
  const equipos = await repositorio.listar('equipos', { organizacion_id: org });
  const puestos = await repositorio.listar('puestos', { organizacion_id: org });
  const mapaPu = porId(puestos);
  contenedor.appendChild(h('h1', { text: 'Etiquetas' }));
  contenedor.appendChild(h('p', { class: 'mut', text: 'Elegí el tipo, filtrá por ubicación, tildá lo que querés imprimir y se imprime una etiqueta de 100 × 50 mm por página.' }));
  const zona = h('div');
  contenedor.appendChild(zona);
  contenedor.appendChild(notaQr());

  /** Descendientes incluidos: una sede filtra también sus salas. @param {string|null} ubId */
  const dentroDe = ubId => {
    if (!fUbic) return true;
    let a = ubId ? ctx.mapaUb.get(ubId) : null, n = 0;
    while (a && n++ < 10) { if (a.id === fUbic) return true; a = a.ubicacion_padre_id ? ctx.mapaUb.get(a.ubicacion_padre_id) : null; }
    return false;
  };

  /** @returns {Array<{id: string, ruta: string, codigo: string, nombre: string, detalle: string, ubicacion: string, datos: () => DatosEtiqueta}>} */
  const elementos = () => {
    if (fTipo === 'racks') {
      return ctx.racks.filter(r => dentroDe(r.ubicacion_id)).sort((a, b) => a.rack_nombre.localeCompare(b.rack_nombre, 'es', { numeric: true }))
        .map(r => ({ id: r.id, ruta: '#/etiqueta/racks/' + r.id, codigo: r.rack_nombre, nombre: r.rack_nombre, detalle: r.rack_unidades_total + ' U', ubicacion: rutaUbicacion(r.ubicacion_id, ctx.mapaUb), datos: () => datosRack(ctx, r) }));
    }
    const ubEq = (/** @type {any} */ e) => { const pu = e.puesto_id ? mapaPu.get(e.puesto_id) : null; return ubicacionDeEquipo(ctx, e) || (pu && pu.ubicacion_id) || null; };
    const lista = equipos.filter(e => e.equipo_estado !== 'baja' && (fTipo === 'servidores' ? e.equipo_tipo === 'servidor' : fTipo === 'pc' ? esPC(e) : e.equipo_tipo !== 'servidor' && !esPC(e)) && dentroDe(ubEq(e)));
    return lista.sort((a, b) => a.equipo_codigo.localeCompare(b.equipo_codigo, 'es', { numeric: true }))
      .map(e => ({ id: e.id, ruta: '#/etiqueta/equipos/' + e.id, codigo: e.equipo_codigo, nombre: e.equipo_nombre, detalle: (esPC(e) ? String(e.equipo_campos.otro_categoria) : ROTULO_EQUIPO_TIPO[e.equipo_tipo]) || e.equipo_tipo, ubicacion: rutaUbicacion(ubEq(e), ctx.mapaUb), datos: () => datosEquipo(ctx, e) }));
  };

  const dibujar = () => {
    zona.textContent = '';
    const q = normalizar(fTexto);
    const todos = elementos();
    const lista = todos.filter(x => !q || normalizar([x.codigo, x.nombre, x.detalle, x.ubicacion].join(' ')).includes(q));
    const visibles = new Set(lista.map(x => x.id));
    for (const m of [...marcadas]) if (!visibles.has(m)) marcadas.delete(m);

    const selTipo = h('select', { 'aria-label': 'Tipo', onchange: (/** @type {Event} */ ev) => { fTipo = /** @type {HTMLSelectElement} */ (ev.target).value; marcadas = new Set(); dibujar(); } },
      tipos.map(t => h('option', { value: t[0], text: t[1], selected: t[0] === fTipo ? '' : null })));
    const selUb = h('select', { 'aria-label': 'Ubicación', onchange: (/** @type {Event} */ ev) => { fUbic = /** @type {HTMLSelectElement} */ (ev.target).value; dibujar(); } },
      [h('option', { value: '', text: 'Todas las ubicaciones' })].concat(ctx.ubicaciones.map(x => ({ id: x.id, t: rutaUbicacion(x.id, ctx.mapaUb) })).sort((a, b) => a.t.localeCompare(b.t, 'es'))
        .map(x => h('option', { value: x.id, text: x.t, selected: x.id === fUbic ? '' : null }))));
    const buscar = h('input', { type: 'search', placeholder: 'Código o nombre', value: fTexto, 'aria-label': 'Buscar', oninput: (/** @type {Event} */ ev) => { fTexto = /** @type {HTMLInputElement} */ (ev.target).value; dibujarLista(); } });
    const cuenta = h('span', { class: 'mut', role: 'status' });
    const btnImp = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'primario', onclick: () => {
      const elegidas = lista.filter(x => marcadas.has(x.id));
      if (elegidas.length) imprimir(elegidas.map(x => etiquetaSvg(x.datos())));
    } }));
    const marcarTodas = h('button', { type: 'button', text: 'Marcar todas las visibles', onclick: () => { for (const x of lista) marcadas.add(x.id); dibujarLista(); } });
    const desmarcar = h('button', { type: 'button', text: 'Desmarcar', onclick: () => { marcadas = new Set(); dibujarLista(); } });
    zona.appendChild(h('div', { class: 'et-barra' }, [
      h('div', null, [h('label', { text: 'Tipo' }), selTipo]), h('div', null, [h('label', { text: 'Ubicación' }), selUb]), h('div', null, [h('label', { text: 'Buscar' }), buscar]),
      h('div', { class: 'herr', style: 'margin:0' }, [marcarTodas, desmarcar, btnImp, cuenta])
    ]));
    const cajaLista = h('div', { class: 'et-lista' });
    zona.appendChild(cajaLista);

    function dibujarLista() {
      const q2 = normalizar(fTexto);
      const act = todos.filter(x => !q2 || normalizar([x.codigo, x.nombre, x.detalle, x.ubicacion].join(' ')).includes(q2));
      lista.length = 0; lista.push(...act);
      cajaLista.textContent = '';
      if (!act.length) {
        cajaLista.appendChild(h('div', { class: 'aviso', style: 'margin:10px' }, [todos.length ? 'Nada coincide con el filtro.' : 'No hay elementos de este tipo' + (fUbic ? ' en esa ubicación' : '') + ' para etiquetar.']));
      } else {
        const cab = [h('input', { type: 'checkbox', 'aria-label': 'Marcar todas', checked: act.every(x => marcadas.has(x.id)) ? '' : null, onchange: (/** @type {Event} */ ev) => {
          const on = /** @type {HTMLInputElement} */ (ev.target).checked; for (const x of act) on ? marcadas.add(x.id) : marcadas.delete(x.id); dibujarLista();
        } })];
        const t = tabla(['', 'Código', 'Nombre', 'Tipo / tamaño', 'Ubicación', ''], act.map(x => [
          h('input', { type: 'checkbox', 'aria-label': 'Marcar ' + x.codigo, checked: marcadas.has(x.id) ? '' : null, onclick: (/** @type {Event} */ ev) => ev.stopPropagation(), onchange: (/** @type {Event} */ ev) => {
            if (/** @type {HTMLInputElement} */ (ev.target).checked) marcadas.add(x.id); else marcadas.delete(x.id); actualizar();
          } }),
          x.codigo, x.nombre, x.detalle, x.ubicacion || '—', h('a', { href: x.ruta, text: 'Ver etiqueta', onclick: (/** @type {Event} */ ev) => ev.stopPropagation() })
        ]));
        const th0 = t.querySelector('th');
        if (th0) th0.appendChild(cab[0]);
        cajaLista.appendChild(t);
      }
      actualizar();
    }
    function actualizar() {
      const n = lista.filter(x => marcadas.has(x.id)).length;
      btnImp.textContent = n ? 'Imprimir ' + n + (n === 1 ? ' etiqueta' : ' etiquetas') : 'Imprimir etiquetas';
      btnImp.disabled = !n;
      cuenta.textContent = lista.length + (lista.length === 1 ? ' elemento' : ' elementos') + ' · ' + n + ' marcad' + (n === 1 ? 'o' : 'os');
    }
    dibujarLista();
  };
  dibujar();
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/etiqueta')) limpiarImpresion(); }, { once: true });
}

