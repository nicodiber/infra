// @ts-check
/** P02 · Organizaciones (CU02, H03): tarjeta por organización con sus cantidades; solo el superadmin. */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla } from '../assets/js/marco.js';
import { h, normalizar } from '../assets/js/utiles.js';

/** @param {HTMLElement} contenedor */
export async function renderVistaOrganizaciones(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const migas = /** @type {Array<[string, string?]>} */ ([['Organizaciones']]);
  if (!puede(u, 'ver_organizaciones')) {
    pantalla(contenedor, { codigo: 'P02', nombre: 'Organizaciones', migas });
    contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Tu rol no tiene acceso al listado de organizaciones: cada rol trabaja sobre la suya.' }),
      h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/inicio', text: 'Ir al inicio de mi organización' })])]));
    return;
  }
  pantalla(contenedor, { codigo: 'P02', nombre: 'Organizaciones', migas });

  const orgs = await repositorio.listar('organizaciones', null, { ordenarPor: 'organizacion_nombre' });
  /** @type {any[]} */
  const datos = [];
  for (const o of orgs) {
    const porOrg = { organizacion_id: o.id };
    const [equipos, servidores, vlans, racks, credenciales, pendientes] = await Promise.all([
      repositorio.contar('equipos', r => r.organizacion_id === o.id && r.equipo_tipo !== 'servidor'),
      repositorio.contar('equipos', r => r.organizacion_id === o.id && r.equipo_tipo === 'servidor'),
      repositorio.contar('vlans', porOrg), repositorio.contar('racks', porOrg), repositorio.contar('credenciales', porOrg),
      repositorio.contar('solicitudes', s => s.organizacion_id === o.id && s.solicitud_estado === 'pendiente')]);
    datos.push({ o, nums: [['Equipos', equipos], ['Servidores', servidores], ['VLAN', vlans], ['Racks', racks], ['Credenciales', credenciales]], pendientes });
  }

  const lista = h('div', { class: 'fila', style: 'flex-wrap:wrap' });
  const pintar = (/** @type {string} */ filtro) => {
    lista.textContent = '';
    const f = normalizar(filtro);
    const vis = datos.filter(d => normalizar(d.o.organizacion_nombre).includes(f));
    if (!vis.length) lista.appendChild(h('div', { class: 'mut', text: 'Ninguna organización coincide con «' + filtro + '».' }));
    for (const d of vis) {
      lista.appendChild(h('button', { type: 'button', class: 'tarjeta tarjeta-org', 'aria-label': 'Entrar a ' + d.o.organizacion_nombre, onclick: () => { sesion.fijarOrganizacionActiva(d.o.id); ir('#/inicio'); } }, [
        h('h2', { text: d.o.organizacion_nombre }),
        h('div', { class: 'nums' }, d.nums.map(/** @param {any} n */ n => h('div', null, [h('b', { text: String(n[1]) }), h('small', { text: String(n[0]) })]))),
        h('div', { class: 'mut', style: 'margin-top:6px;font-size:13px', text: 'Tocá para entrar →' })]));
    }
  };
  const filtro = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar por nombre…', style: 'width:280px', 'aria-label': 'Filtrar organizaciones' }));
  filtro.addEventListener('input', () => pintar(filtro.value));
  pintar('');
  contenedor.appendChild(h('h1', { text: 'Organizaciones' }));
  contenedor.appendChild(h('p', { class: 'mut', text: 'Elegí una organización para ver su información. Para buscar un dato sin elegir antes la organización, usá «Buscar» (Ctrl K) en la cabecera.' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [filtro, h('span', { style: 'flex:1' }),
    h('button', { type: 'button', disabled: 'disabled', title: 'Llega en la próxima entrega del prototipo', text: 'Nueva organización' })]));
  contenedor.appendChild(lista);
}

