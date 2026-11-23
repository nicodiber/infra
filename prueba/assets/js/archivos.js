// @ts-check
/**
 * Fotos y archivos de una ficha (IC8, MD11): galería de fotos con ampliación, lista de otros archivos con descarga,
 * y subida (las fotos se achican en el navegador a 1600 px máx. y JPEG 0,85). Todo queda en este navegador (D-042).
 * `pintarArchivos(contenedor, {entidad, entidadId, organizacionId, tipo?})`. Nunca se inserta contenido de archivos como HTML:
 * las imágenes se muestran con `<img src=data:…>` y solo si son raster; un SVG se trata como archivo descargable.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import { toast, abrirModal, cerrarModal } from './marco.js';
import { h, fmtFecha } from './utiles.js';
import { LIMITE_ARCHIVO_BYTES } from './modelos.js';

const LADO_MAX = 1600;

/** @param {number} b */
function tamano(b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

/** @param {string} mime */
function esFotoRaster(mime) { return /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mime); }

/**
 * Achica una imagen con canvas (lado mayor ≤ 1600 px) y la devuelve como JPEG. Si no se puede decodificar, devuelve el original.
 * @param {File} f @returns {Promise<{blob: Blob, nombre: string}>}
 */
async function achicar(f) {
  if (!/^image\/(png|jpe?g|webp|bmp)$/i.test(f.type)) return { blob: f, nombre: f.name };
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d');
    if (!ctx) return { blob: f, nombre: f.name };
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // el JPEG no tiene transparencia
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return { blob: f, nombre: f.name };
    return { blob, nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch { return { blob: f, nombre: f.name }; }
}

/**
 * @param {HTMLElement} contenedor
 * @param {{entidad: string, entidadId: string, organizacionId: string, tipo?: 'plano'|'foto'|'otro'}} o
 */
export async function pintarArchivos(contenedor, o) {
  const u = /** @type {import('./modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = o.organizacionId;
  const modulo = await repositorio.moduloDeEntidad(o.entidad, o.entidadId);
  let error = '';

  const pintar = async () => {
    contenedor.textContent = '';
    if (!puede(u, 'ver', modulo, org)) { contenedor.appendChild(h('div', { class: 'aviso', text: 'Tu rol no tiene acceso a los archivos de esta ficha.' })); return; }
    const modifica = puede(u, 'modificar', modulo, org);
    const todos = await repositorio.archivosDe(o.entidad, o.entidadId, o.tipo);
    const fotos = todos.filter(a => a.archivo_tipo === 'foto' && esFotoRaster(a.archivo_mime));
    const otros = todos.filter(a => !fotos.includes(a));

    const entrada = /** @type {HTMLInputElement} */ (h('input', { type: 'file', multiple: 'multiple', hidden: 'hidden', 'aria-label': 'Elegir archivos para subir' }));
    const msg = h('div', { class: 'msg mal', role: 'alert', text: error, hidden: error ? null : 'hidden' });
    entrada.addEventListener('change', async () => {
      const lista = Array.from(entrada.files || []);
      const fallas = [];
      for (const f of lista) {
        try {
          const esImg = /^image\//i.test(f.type);
          const { blob, nombre } = esImg ? await achicar(f) : { blob: f, nombre: f.name };
          await repositorio.guardarArchivo({ entidad: o.entidad, entidadId: o.entidadId, tipo: esImg && esFotoRaster(blob.type) ? 'foto' : 'otro', archivo: Object.assign(blob, { name: nombre }), nombre, mime: blob.type || f.type, usuarioId: u.id });
        } catch (e) { fallas.push(f.name + ': ' + (e instanceof Error ? e.message : 'no se pudo guardar')); }
      }
      error = fallas.join(' · ');
      if (lista.length && !fallas.length) toast(lista.length === 1 ? 'Archivo guardado' : lista.length + ' archivos guardados');
      await pintar();
    });
    contenedor.appendChild(h('div', { class: 'herr' }, [
      h('span', { class: 'mut', style: 'flex:1', text: 'Fotos y archivos de esta ficha. Quedan solo en este navegador (hasta ' + tamano(LIMITE_ARCHIVO_BYTES) + ' cada uno); las fotos se achican al subirlas.' }),
      modifica ? h('button', { type: 'button', class: 'primario', text: 'Subir', onclick: () => entrada.click() }) : null, entrada]));
    contenedor.appendChild(msg);

    if (!todos.length) {
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Todavía no hay fotos ni archivos.' }),
        modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Usá «Subir» para sumar, por ejemplo, una foto del equipo, del rack o de la conexión.' }) : null]));
      return;
    }

    if (fotos.length) {
      const galeria = h('div', { style: 'display:flex;flex-wrap:wrap;gap:12px;margin:10px 0' });
      for (const a of fotos) {
        const url = await repositorio.contenidoDeArchivo(a.id);
        if (!url) continue;
        const img = h('img', { src: url, alt: a.archivo_nombre, style: 'width:160px;height:120px;object-fit:cover;border-radius:6px;border:1px solid var(--borde);display:block' });
        galeria.appendChild(h('figure', { style: 'margin:0;width:160px' }, [
          h('button', { type: 'button', style: 'padding:0;height:auto;border:0;background:none', 'aria-label': 'Ampliar ' + a.archivo_nombre, onclick: () => ampliar(a.archivo_nombre, url) }, [img]),
          h('figcaption', { class: 'mut', style: 'font-size:12px;overflow-wrap:anywhere', text: a.archivo_nombre + ' · ' + tamano(a.archivo_bytes) }),
          h('div', { class: 'herr', style: 'margin:4px 0' }, [descarga(a, url), modifica ? botonQuitar(a) : null])]));
      }
      contenedor.appendChild(h('h3', { text: 'Fotos (' + fotos.length + ')' }));
      contenedor.appendChild(galeria);
    }
    if (otros.length) {
      const cuerpo = h('tbody');
      for (const a of otros) {
        const url = await repositorio.contenidoDeArchivo(a.id);
        cuerpo.appendChild(h('tr', null, [h('td', { text: a.archivo_nombre }), h('td', { text: tamano(a.archivo_bytes) }), h('td', { text: fmtFecha(a.creado_en) }),
          h('td', null, [h('span', { class: 'herr', style: 'margin:0' }, [url ? descarga(a, url) : null, modifica ? botonQuitar(a) : null])])]));
      }
      contenedor.appendChild(h('h3', { text: 'Otros archivos (' + otros.length + ')' }));
      contenedor.appendChild(h('table', { class: 'tabla' }, [h('thead', null, [h('tr', null, [h('th', { text: 'Nombre' }), h('th', { text: 'Tamaño' }), h('th', { text: 'Fecha' }), h('th', { text: '' })])]), cuerpo]));
    }
  };

  /** @param {any} a @param {string} url */
  function descarga(a, url) {
    return h('a', { href: url, download: a.archivo_nombre, class: 'chico', style: 'text-decoration:underline', text: 'Descargar', 'aria-label': 'Descargar ' + a.archivo_nombre });
  }
  /** @param {any} a */
  function botonQuitar(a) {
    return h('button', { type: 'button', class: 'chico', text: 'Quitar', 'aria-label': 'Quitar ' + a.archivo_nombre, onclick: async () => {
      try { await repositorio.quitarArchivo(a.id, u.id); toast('Archivo quitado'); error = ''; await pintar(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar.'); }
    } });
  }
  /** @param {string} nombre @param {string} url */
  function ampliar(nombre, url) {
    abrirModal(h('div', { style: 'padding:12px;text-align:center', role: 'dialog', 'aria-label': nombre }, [
      h('img', { src: url, alt: nombre, style: 'max-width:88vw;max-height:76vh;display:block;margin:0 auto' }),
      h('div', { class: 'mut', style: 'margin:6px 0', text: nombre }),
      h('button', { type: 'button', text: 'Cerrar', onclick: () => cerrarModal() })]));
  }

  await pintar();
}
