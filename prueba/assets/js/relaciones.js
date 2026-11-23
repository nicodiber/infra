// @ts-check
/**
 * «Relacionado con» (IC4, D-061): lista de fichas vinculadas a una ficha y alta/baja de relaciones.
 * Se usa como pestaña de las fichas: `pintarRelaciones(contenedor, {entidad, entidadId, organizacionId})`.
 * Solo muestra el otro lado si el usuario puede verlo; «Relacionar con…» y «Quitar» los ve quien modifica el módulo de la ficha.
 * Todo texto de datos va con `textContent`.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import { toast, abrirModal, cerrarModal, ir } from './marco.js';
import { h } from './utiles.js';
import { ROTULO_ENTIDAD, ENTIDAD_DE_COLECCION } from './modelos.js';

/**
 * @param {HTMLElement} contenedor
 * @param {{entidad: string, entidadId: string, organizacionId: string}} o
 */
export async function pintarRelaciones(contenedor, o) {
  const u = /** @type {import('./modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = o.organizacionId;
  const modulo = await repositorio.moduloDeEntidad(o.entidad, o.entidadId);

  const pintar = async () => {
    contenedor.textContent = '';
    const lista = await repositorio.relacionesDe(o.entidad, o.entidadId, { permitido: r => puede(u, 'ver', r.modulo, r.organizacion_id) });
    const modifica = puede(u, 'modificar', modulo, org);
    contenedor.appendChild(h('div', { class: 'herr' }, [
      h('span', { class: 'mut', style: 'flex:1', text: 'Fichas que tienen que ver con esta: por ejemplo un servidor con su licencia o una credencial con un servicio.' }),
      modifica ? h('button', { type: 'button', class: 'primario', text: 'Relacionar con…', onclick: () => abrirAlta(o, u, pintar) }) : null]));
    if (!lista.length) {
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Esta ficha todavía no está relacionada con otras.' }),
        modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Usá «Relacionar con…» para vincularla, por ejemplo, con la licencia o el servicio que corresponda.' }) : null]));
      return;
    }
    const cuerpo = h('tbody');
    for (const r of lista) {
      cuerpo.appendChild(h('tr', null, [
        h('td', null, [r.ruta ? h('a', { href: r.ruta, text: r.titulo || '(sin nombre)' }) : h('span', { text: r.titulo || '(sin nombre)' }),
          r.subtitulo ? h('div', { class: 'mut', style: 'font-size:12.5px', text: r.subtitulo }) : null]),
        h('td', { text: r.rotulo }),
        h('td', { text: r.descripcion || '—' }),
        modifica ? h('td', null, [h('button', { type: 'button', class: 'chico', text: 'Quitar', 'aria-label': 'Quitar la relación con ' + r.titulo, onclick: async () => {
          try { await repositorio.quitarRelacion(r.relacion.id, u.id); toast('Relación quitada'); await pintar(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar.'); }
        } })]) : null]));
    }
    contenedor.appendChild(h('table', { class: 'tabla' }, [
      h('thead', null, [h('tr', null, [h('th', { text: 'Ficha' }), h('th', { text: 'Tipo' }), h('th', { text: 'Descripción' }), modifica ? h('th', { text: '' }) : null])]), cuerpo]));
  };
  await pintar();
}

/**
 * Ventana para elegir el destino con la búsqueda global.
 * @param {{entidad: string, entidadId: string, organizacionId: string}} o
 * @param {import('./modelos.js').UsuarioSesion} u
 * @param {() => Promise<void>} alTerminar
 */
function abrirAlta(o, u, alTerminar) {
  /** @type {{entidad: string, id: string, titulo: string}|null} */
  let elegido = null;
  const buscador = /** @type {HTMLInputElement} */ (h('input', { type: 'search', 'aria-label': 'Buscar la ficha a relacionar', placeholder: 'Buscá por nombre, IP, número de serie…', style: 'width:100%' }));
  const lista = h('div', { role: 'listbox', 'aria-label': 'Resultados', style: 'max-height:260px;overflow:auto;margin-top:8px' });
  const desc = /** @type {HTMLInputElement} */ (h('input', { type: 'text', 'aria-label': 'Descripción', placeholder: 'Para qué se relacionan (opcional)', style: 'width:100%', maxlength: '200' }));
  const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
  const eleccion = h('div', { class: 'mut', style: 'margin:8px 0', text: 'Todavía no elegiste ninguna ficha.' });
  let tic = 0;

  const buscar = async () => {
    const mio = ++tic;
    lista.textContent = '';
    const texto = buscador.value.trim();
    if (texto.length < 2) { lista.appendChild(h('div', { class: 'mut', text: 'Escribí al menos 2 letras para buscar.' })); return; }
    const res = await repositorio.buscar(texto, { permitido: r => r.organizacion_id === o.organizacionId && puede(u, 'ver', r.modulo, r.organizacion_id) });
    if (mio !== tic) return;
    const items = res.map(r => ({ r, entidad: ENTIDAD_DE_COLECCION[r.coleccion] })).filter(x => x.entidad && ROTULO_ENTIDAD[x.entidad] && !(x.entidad === o.entidad && x.r.id === o.entidadId)).slice(0, 30);
    if (!items.length) { lista.appendChild(h('div', { class: 'mut', text: 'No se encontró ninguna ficha que se pueda relacionar con ese texto.' })); return; }
    for (const { r, entidad } of items) {
      const esServ = entidad === 'Equipo' && r.grupo === 'Servidores';
      lista.appendChild(h('button', { type: 'button', role: 'option', style: 'display:block;width:100%;text-align:left;margin-bottom:4px;height:auto;padding:6px 10px', onclick: () => {
        elegido = { entidad, id: r.id, titulo: r.titulo };
        eleccion.textContent = 'Elegida: ' + r.titulo + ' (' + (esServ ? ROTULO_ENTIDAD.Servidor : ROTULO_ENTIDAD[entidad]) + ')';
      } }, [h('strong', { text: r.titulo }), h('span', { class: 'mut', text: ' · ' + (esServ ? ROTULO_ENTIDAD.Servidor : ROTULO_ENTIDAD[entidad]) + (r.subtitulo ? ' · ' + r.subtitulo : '') })]));
    }
  };
  buscador.addEventListener('input', buscar);

  const confirmar = async () => {
    if (!elegido) { error.textContent = 'Elegí primero la ficha con la que querés relacionar esta.'; error.hidden = false; return; }
    try {
      await repositorio.crearRelacion({ origenEntidad: o.entidad, origenId: o.entidadId, destinoEntidad: elegido.entidad, destinoId: elegido.id, descripcion: desc.value, usuarioId: u.id });
      cerrarModal(); toast('Relación creada'); await alTerminar();
    } catch (e) { error.textContent = e instanceof Error ? e.message : 'No se pudo crear la relación.'; error.hidden = false; }
  };
  abrirModal(h('div', { class: 'pe-modal', style: 'width:560px;padding:16px', role: 'dialog', 'aria-label': 'Relacionar con otra ficha' }, [
    h('h2', { text: 'Relacionar con…' }), buscador, lista, eleccion,
    h('div', { class: 'campo' }, [h('label', { text: 'Descripción' }), desc]), error,
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      h('button', { type: 'button', class: 'primario', text: 'Relacionar', onclick: confirmar })])]));
  buscar();
  buscador.focus();
}
