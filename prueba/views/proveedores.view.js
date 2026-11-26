// @ts-check
/**
 * Proveedores de la organización (`#/proveedores`, QC75): quién da cada servicio y cómo contactarlo.
 * Tabla con rubro, teléfono de soporte (enlace `tel:`), mail de soporte y número de cliente. Chips por rubro y filtro de texto.
 * Módulo de permisos: `configuraciones` (igual que Dominios y servicios).
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla, normalizar, icono } from '../assets/js/utiles.js';
import { sinPermiso, chips } from '../assets/js/credenciales.js';
import { crearYAbrir } from '../assets/js/altas/comunes.js';

/**
 * Enlace `tel:` para un teléfono (o «—» si no hay). El texto se muestra tal cual se cargó.
 * @param {string|null|undefined} t @returns {HTMLElement|string}
 */
export function enlaceTel(t) {
  if (!t) return '—';
  const marcable = t.replace(/[^\d+]/g, '');
  return h('a', { href: 'tel:' + marcable, text: t, onclick: (/** @type {Event} */ e) => e.stopPropagation() });
}

/** @param {string|null|undefined} m @returns {HTMLElement|string} */
export function enlaceMail(m) {
  if (!m) return '—';
  return h('a', { href: 'mailto:' + m, text: m, onclick: (/** @type {Event} */ e) => e.stopPropagation() });
}

/** Enlace externo al portal: solo http(s). @param {string|null|undefined} u @returns {HTMLElement|string} */
export function enlaceWeb(u) {
  if (!u) return '—';
  if (!/^https?:\/\//i.test(u)) return u;
  return h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: u, onclick: (/** @type {Event} */ e) => e.stopPropagation() });
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = /** @type {string} */ (sesion.organizacionActiva());
  const migas = await migasRaiz();
  migas.push(['Proveedores']);
  pantalla(contenedor, { codigo: 'P52', nombre: 'Proveedores', migas });
  if (!puede(u, 'ver', 'configuraciones', orgId)) { sinPermiso(contenedor, u, 'Proveedores'); return; }

  const lista = await repositorio.listar('proveedores', { organizacion_id: orgId });
  lista.sort((a, b) => a.proveedor_nombre.localeCompare(b.proveedor_nombre, 'es', { numeric: true }));
  const puedeCrear = puede(u, 'modificar', 'configuraciones', orgId);
  const nuevo = () => crearYAbrir('proveedores', r => '#/proveedor/' + r.id, { aviso: 'Proveedor creado' });

  const est = { texto: '', rubro: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');
  const pintar = () => {
    zonaChips.textContent = '';
    zonaTabla.textContent = '';
    const palabras = normalizar(est.texto).split(/\s+/).filter(Boolean);
    const porTexto = lista.filter(p => {
      const t = normalizar([p.proveedor_nombre, p.proveedor_rubro || '', p.proveedor_soporte_telefono || '', p.proveedor_soporte_mail || '', p.proveedor_numero_cliente || '',
        p.proveedor_numero_contrato || '', p.proveedor_comercial_nombre || ''].join(' '));
      return palabras.every(w => t.includes(w));
    });
    const rubros = Array.from(new Set(lista.map(p => p.proveedor_rubro).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'));
    const items = /** @type {Array<[string, string, number]>} */ ([['todos', 'Todos', porTexto.length]]);
    for (const r of rubros) items.push([r, r, porTexto.filter(p => p.proveedor_rubro === r).length]);
    if (rubros.length) zonaChips.appendChild(h('div', { class: 'srv-chips' }, [chips(items, est.rubro, k => { est.rubro = k; pintar(); })]));
    const filas = porTexto.filter(p => est.rubro === 'todos' || p.proveedor_rubro === est.rubro);
    if (!lista.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [icono('configuracion'), h('h2', { text: 'Todavía no hay proveedores cargados' }),
        h('p', { text: 'Acá se anota quién da el Internet, la telefonía, el mantenimiento o el software: teléfono y mail de soporte, número de cliente o de contrato y el acceso a su portal.' }),
        puedeCrear ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nuevo proveedor', onclick: nuevo })]) : null]));
      return;
    }
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ningún proveedor coincide con el filtro.' })); return; }
    zonaTabla.appendChild(tabla(['Nombre', 'Rubro', 'Teléfono de soporte', 'Mail de soporte', 'N.º de cliente'], filas.map(p => [
      h('a', { href: '#/proveedor/' + p.id, text: p.proveedor_nombre, onclick: (/** @type {Event} */ e) => e.stopPropagation() }),
      p.proveedor_rubro || '—', enlaceTel(p.proveedor_soporte_telefono), enlaceMail(p.proveedor_soporte_mail), p.proveedor_numero_cliente || '—']),
    { tipo: 'configuracion', onFila: (_f, i) => ir('#/proveedor/' + filas[i].id) }));
  };

  const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar…', 'aria-label': 'Filtrar proveedores', style: 'width:260px' }));
  inp.addEventListener('input', () => { est.texto = inp.value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Proveedores' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [inp, h('span', { style: 'flex:1' }),
    puedeCrear ? h('button', { type: 'button', class: 'primario', text: 'Nuevo proveedor', onclick: nuevo }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'La contraseña del portal de cada proveedor nunca se muestra acá: está en una credencial vinculada, que se abre desde la ficha.' }));
  pintar();
}
