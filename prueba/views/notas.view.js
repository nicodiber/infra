// @ts-check
/**
 * P26 · Notas. `#/notas`: todas las notas de la organización (las de la organización y las de cada ficha, con enlace a la ficha
 * de origen), solo las que el rol puede ver. `#/notas/<id>` abre una; `#/notas/nueva` crea una nota de la organización.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, fmtFechaHora, indicadorVerificacion, normalizar, hoyISO, icono } from '../assets/js/utiles.js';
import { sinPermiso, chips, campo, fichaCab, botonBaja, pestanas, rotuloCampo, valorHistorial } from '../assets/js/credenciales.js';
import { origenDeNota, resumenNota } from '../assets/js/notas.js';
import { crearYAbrir, altaDesdeRuta } from '../assets/js/altas/comunes.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const idHash = decodeURIComponent(partes[1] || '');
  if (idHash) await ficha(contenedor, idHash, partes[2] || '');
  else await listado(contenedor);
}

/** @param {HTMLElement} contenedor */
async function listado(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = /** @type {string} */ (sesion.organizacionActiva());
  const migas = await migasRaiz();
  migas.push(['Notas']);
  pantalla(contenedor, { codigo: 'P26', nombre: 'Notas', migas });

  const [todas, umbrales] = await Promise.all([repositorio.listar('notas', { organizacion_id: orgId }, { ordenarPor: 'actualizado_en', descendente: true }), repositorio.umbralesVerificacion()]);
  // Solo las notas cuyo módulo puede ver el rol.
  const filas = [];
  for (const n of todas) {
    const mod = await repositorio.moduloDeNota(n);
    if (puede(u, 'ver', mod, orgId)) filas.push({ n, origen: await origenDeNota(n) });
  }
  const puedeCrear = puede(u, 'modificar', 'organizacion', orgId);

  const est = { texto: '', origen: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');
  const pintar = () => {
    zonaChips.textContent = '';
    zonaTabla.textContent = '';
    const palabras = normalizar(est.texto).split(/\s+/).filter(Boolean);
    const base = filas.filter(f => {
      const t = normalizar([f.n.nota_titulo, f.n.nota_contenido, f.origen.nombre, f.origen.etiqueta].join(' '));
      return palabras.every(p => t.includes(p));
    });
    const deOrg = (/** @type {any} */ f) => !f.n.entidad;
    zonaChips.appendChild(chips([['todos', 'Todas', base.length], ['org', 'De la organización', base.filter(deOrg).length], ['fichas', 'De fichas', base.filter(f => !deOrg(f)).length]], est.origen, k => { est.origen = k; pintar(); }));
    const ver = base.filter(f => est.origen === 'todos' || (est.origen === 'org' ? deOrg(f) : !deOrg(f)));
    if (!filas.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [icono('nota'), h('h2', { text: 'Todavía no hay notas' }),
        h('p', { text: 'Las notas son texto libre para documentar lo que no entra en un campo: cómo está armado el dominio, qué hacer al reemplazar un equipo, pendientes del cliente.' }),
        h('p', { text: 'Se escriben desde la ficha (por ejemplo, la pestaña «Notas» de un servidor) o acá, como nota de la organización.' }),
        puedeCrear ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nueva nota', onclick: () => crearYAbrir('notas', r => '#/notas/' + r.id, { aviso: 'Nota creada' }) })]) : null]));
      return;
    }
    if (!ver.length) { zonaTabla.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ninguna nota coincide con el filtro.' })); return; }
    zonaTabla.appendChild(tabla(['Título', 'De', 'Contenido', 'Última edición', 'Verificada'], ver.map(f => [
      f.n.nota_titulo,
      f.origen.hash ? h('span', null, [f.origen.etiqueta + ': ', h('a', { href: f.origen.hash, text: f.origen.nombre, onclick: (/** @type {Event} */ e) => e.stopPropagation() })]) : f.origen.etiqueta + (f.n.entidad ? ': ' + f.origen.nombre : ''),
      resumenNota(f.n.nota_contenido), fmtFecha(f.n.actualizado_en), indicadorVerificacion(f.n.verificado_en, umbrales, true)]),
    { tipo: 'nota', onFila: (_f, i) => ir('#/notas/' + ver[i].n.id) }));
  };

  const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar…', 'aria-label': 'Filtrar notas', style: 'width:260px' }));
  inp.addEventListener('input', () => { est.texto = inp.value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Notas' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [inp, h('span', { style: 'flex:1' }),
    puedeCrear ? h('button', { type: 'button', class: 'primario', text: 'Nueva nota', onclick: () => crearYAbrir('notas', r => '#/notas/' + r.id, { aviso: 'Nota creada' }) }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Solo ves las notas de los módulos a los que tu rol tiene acceso.' }));
  pintar();
}

/** @param {HTMLElement} contenedor @param {string} idHash @param {string} tab */
async function ficha(contenedor, idHash, tab) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const nuevo = idHash === 'nueva' || idHash === 'nuevo';
  const migas = await migasRaiz();
  migas.push(['Notas', '#/notas']);
  if (nuevo) { await altaDesdeRuta('notas', '#/notas', r => '#/notas/' + r.id, 'Nota creada'); return; }
  /** @type {any} */
  let n = null;
  let orgId = /** @type {string} */ (sesion.organizacionActiva());
  {
    n = await repositorio.obtener('notas', idHash);
    if (!n) {
      pantalla(contenedor, { codigo: 'P26', nombre: 'Nota', migas: migas.concat([['No encontrada']]) });
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Esa nota no existe o fue dada de baja.' }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/notas', text: 'Volver al listado de notas' })])]));
      return;
    }
    orgId = n.organizacion_id;
  }
  const modulo = await repositorio.moduloDeNota(n);
  if (!puede(u, 'ver', modulo, orgId)) {
    pantalla(contenedor, { codigo: 'P26', nombre: 'Nota', migas: migas.concat([['Nota']]) });
    sinPermiso(contenedor, u, 'esta nota');
    return;
  }
  const [umbrales, usuarios] = await Promise.all([repositorio.umbralesVerificacion(), repositorio.listar('usuarios', null, { incluirBajas: true })]);
  const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
  const modifica = puede(u, 'modificar', modulo, orgId);
  let editando = tab === 'editar';
  if (editando && !modifica) editando = false;
  const verHist = puede(u, 'ver_historial', modulo, orgId);
  let pestana = tab === 'historial' && verHist ? 'historial' : 'nota';
  /** @type {any} */
  let ed = null;
  let error = '';

  const rerender = async () => { n = (await repositorio.obtener('notas', n.id)) || n; await pintar(); };

  async function pintar() {
    contenedor.textContent = '';
    const origen = await origenDeNota(n);
    pantalla(contenedor, { codigo: 'P26', nombre: 'Nota', migas: migas.concat([[n.nota_titulo]]) });
    const datos = h('div', { class: 'datos' });
    if (editando) {
      if (!ed) ed = { titulo: n ? n.nota_titulo : '', contenido: n ? n.nota_contenido : '' };
      const t = /** @type {HTMLInputElement} */ (h('input', { 'aria-label': 'Título', maxlength: '120' }));
      t.value = ed.titulo; t.addEventListener('input', () => { ed.titulo = t.value; });
      const c = /** @type {HTMLTextAreaElement} */ (h('textarea', { 'aria-label': 'Contenido', rows: '12', style: 'width:100%' }));
      c.value = ed.contenido; c.addEventListener('input', () => { ed.contenido = c.value; });
      datos.appendChild(campo('Título', t));
      datos.appendChild(h('div', { class: 'campo', style: 'grid-column:1/-1' }, [h('label', { text: 'Contenido (sin contraseñas ni claves)' }), c]));
      if (error) datos.appendChild(h('div', { class: 'msg mal', role: 'alert', style: 'grid-column:1/-1', text: error }));
    } else {
      datos.appendChild(campo('De', origen.hash ? h('a', { href: origen.hash, text: origen.etiqueta + ': ' + origen.nombre }) : origen.etiqueta + (n && n.entidad ? ': ' + origen.nombre : '')));
    }
    const guardar = async () => {
      if (!ed.titulo.trim()) { error = 'Escribí un título para la nota.'; await pintar(); return; }
      if (!ed.contenido.trim()) { error = 'Escribí el contenido de la nota.'; await pintar(); return; }
      try {
        await repositorio.guardar('notas', { ...n, nota_titulo: ed.titulo.trim(), nota_contenido: ed.contenido.replace(/\s+$/, '') }, u.id);
        toast('Cambios guardados · verificada hoy (' + hoyISO().split('-').reverse().join('/') + ')');
        editando = false; ed = null; error = ''; await rerender();
      } catch (e) { error = e instanceof Error ? e.message : 'No se pudo guardar.'; await pintar(); }
    };
    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { editando = false; ed = null; error = ''; pintar(); } })]
      : [modifica ? h('button', { type: 'button', text: 'Editar', onclick: () => { ed = null; editando = true; pintar(); } }) : null,
        await botonBaja({ u, coleccion: 'notas', registro: n, modulo, orgId, nombre: n.nota_titulo, volver: '#/notas', rerender })];
    contenedor.appendChild(fichaCab({ tipo: 'nota', etiqueta: 'nota', titulo: n.nota_titulo, datos, botones, modoEdicion: editando, registro: n,
      coleccion: 'notas', modulo, u, orgId, umbrales, usuarios: nombreUsuario, rerender }));

    /** @type {Array<[string, string]>} */
    const tabs = [['nota', 'Nota']];
    if (verHist) tabs.push(['historial', 'Historial']);
    contenedor.appendChild(pestanas(tabs, pestana, k => { pestana = k; history.replaceState(null, '', '#/notas/' + n.id + (k === 'nota' ? '' : '/' + k)); pintar(); }));
    if (pestana === 'historial') {
      const cambios = await repositorio.listar('cambios', x => x.cambio_entidad === 'Nota' && x.entidad_id === n.id, { ordenarPor: 'cambio_fecha', descendente: true });
      if (!cambios.length) { contenedor.appendChild(h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' })); return; }
      contenedor.appendChild(tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(x => {
        const op = x.cambio_operacion;
        if (op !== 'modificacion') return [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', op === 'alta' ? 'Alta' : op === 'baja' ? 'Baja' : 'Restauración', '—', op === 'alta' ? 'Creada' : '—'];
        return [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', x.cambio_campo === 'nota_titulo' ? 'Título' : x.cambio_campo === 'nota_contenido' ? 'Contenido' : rotuloCampo(x.cambio_campo),
          valorHistorial(x.cambio_valor_anterior, x.cambio_campo, false, new Map()), valorHistorial(x.cambio_valor_nuevo, x.cambio_campo, false, new Map())];
      })));
      return;
    }
    contenedor.appendChild(h('div', { class: 'bloque t-nota' }, [h('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere', text: n.nota_contenido })]));
  }
  await pintar();
}
