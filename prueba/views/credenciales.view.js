// @ts-check
/**
 * P05 · Listado de credenciales. Ordenado por tipo; nunca muestra contraseñas.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, indicadorVerificacion, estadoVerificacion, normalizar } from '../assets/js/utiles.js';
import { ROTULO_CREDENCIAL_TIPO } from '../assets/js/modelos.js';
import { sinPermiso, textoVencimiento, chips } from '../assets/js/credenciales.js';
import { crearYAbrir } from '../assets/js/altas/comunes.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = /** @type {string} */ (sesion.organizacionActiva());
  const migas = await migasRaiz();
  migas.push(['Credenciales']);
  pantalla(contenedor, { codigo: 'P05', nombre: 'Listado de Credenciales', migas });
  if (!puede(u, 'ver', 'credenciales', orgId)) { sinPermiso(contenedor, u, 'Credenciales'); return; }

  const [lista, equipos, umbrales] = await Promise.all([
    repositorio.listar('credenciales', { organizacion_id: orgId }), repositorio.listar('equipos', { organizacion_id: orgId }), repositorio.umbralesVerificacion()]);
  const nombreEq = new Map(equipos.map(e => [e.id, e.equipo_nombre]));
  const rotulo = (/** @type {string} */ t) => ROTULO_CREDENCIAL_TIPO[t] || t;
  lista.sort((a, b) => rotulo(a.credencial_tipo).localeCompare(rotulo(b.credencial_tipo), 'es') || a.credencial_nombre.localeCompare(b.credencial_nombre, 'es', { numeric: true }));

  const est = { texto: '', tipo: '', nivel: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');
  const pintar = () => {
    zonaChips.textContent = '';
    zonaTabla.textContent = '';
    const palabras = normalizar(est.texto).split(/\s+/).filter(Boolean);
    const base = lista.filter(c => {
      if (est.tipo && c.credencial_tipo !== est.tipo) return false;
      const t = normalizar([c.credencial_nombre, rotulo(c.credencial_tipo), c.credencial_usuario, c.credencial_url_o_host, nombreEq.get(c.equipo_id) || ''].join(' '));
      return palabras.every(p => t.includes(p));
    });
    const nivel = (/** @type {any} */ c) => estadoVerificacion(c.verificado_en, umbrales).nivel;
    zonaChips.appendChild(chips([['todos', 'Todas', base.length], ['vigente', 'Verificadas', base.filter(c => nivel(c) === 'vigente').length],
      ['revisar', 'A revisar', base.filter(c => nivel(c) === 'revisar').length], ['viejo', 'Desactualizadas', base.filter(c => nivel(c) === 'viejo').length]], est.nivel, k => { est.nivel = k; pintar(); }));
    const filas = base.filter(c => est.nivel === 'todos' || nivel(c) === est.nivel);
    if (!lista.length) {
      const puedeCrear = puede(u, 'modificar', 'credenciales', orgId);
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [h('h2', { text: 'Todavía no hay credenciales cargadas' }),
        h('p', { text: 'Acá van las contraseñas de iLO, routers, VPN, Wi-Fi, paneles y claves de licencia. Se cargan con su usuario y host, y la contraseña queda oculta.' }),
        puedeCrear ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nueva credencial', onclick: () => crearYAbrir('credenciales', r => '#/credencial/' + r.id, { aviso: 'Credencial creada' }) })])
          : h('p', { class: 'mut', text: 'Tu rol no puede cargar credenciales: pedíselo a un técnico o gerente.' })]));
      return;
    }
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ninguna credencial coincide con el filtro.' })); return; }
    zonaTabla.appendChild(tabla(['Nombre', 'Tipo', 'Usuario', 'Equipo', 'Vence', 'Último cambio', 'Verificado'], filas.map(c => [
      c.credencial_nombre, rotulo(c.credencial_tipo), c.credencial_usuario || '—', c.equipo_id ? nombreEq.get(c.equipo_id) || '—' : '—',
      textoVencimiento(c.credencial_vence_en), fmtFecha(c.actualizado_en), indicadorVerificacion(c.verificado_en, umbrales, true)]),
    { tipo: 'credencial', onFila: (_f, i) => ir('#/credencial/' + filas[i].id) }));
  };

  const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar…', 'aria-label': 'Filtrar credenciales', style: 'width:260px' }));
  inp.addEventListener('input', () => { est.texto = inp.value; pintar(); });
  const tipos = Array.from(new Set(lista.map(c => c.credencial_tipo))).sort((a, b) => rotulo(a).localeCompare(rotulo(b), 'es'));
  const sel = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo' }, [h('option', { value: '', text: 'Todos los tipos' })].concat(tipos.map(t => h('option', { value: t, text: rotulo(t) })))));
  sel.addEventListener('change', () => { est.tipo = sel.value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Credenciales' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [inp, sel, h('span', { style: 'flex:1' }),
    puede(u, 'modificar', 'credenciales', orgId) ? h('button', { type: 'button', class: 'primario', text: 'Nueva credencial', onclick: () => crearYAbrir('credenciales', r => '#/credencial/' + r.id, { aviso: 'Credencial creada' }) }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Nunca se muestran contraseñas en el listado: se ven en la ficha de cada credencial.' }));
  pintar();
}
