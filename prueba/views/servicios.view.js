// @ts-check
/**
 * Dominios y servicios (`#/servicios`): dominio, DNS, hosting, certificado o correo de la organización (D-070, QA43).
 * Tabla con tipo, proveedor, titular, delegación del DNS, vencimiento (vencido / ≤30 días) y verificación.
 * Chips por tipo y por estado de vencimiento, filtro de texto. Módulo de permisos: `configuraciones`.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, diasHasta, textoVence, indicadorVerificacion, normalizar, icono } from '../assets/js/utiles.js';
import { ROTULO_SERVICIO_TIPO } from '../assets/js/modelos.js';
import { sinPermiso, chips } from '../assets/js/credenciales.js';

const CSS = `
.srv-venc{font-size:12.5px}
.srv-venc b{display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;border:1px solid currentColor;font-size:11px}
.srv-venc.pasado{color:var(--bad-fg)} .srv-venc.pronto{color:var(--warn-fg)}
.srv-chips{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
`;

/** Agrega los estilos propios una sola vez. */
export function aplicarEstilosServicios() {
  if (document.getElementById('estilos-servicios')) return;
  const s = document.createElement('style');
  s.id = 'estilos-servicios';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * @param {{servicio_vence_en: string|null}} s
 * @returns {'vencido'|'por_vencer'|'vigente'|'sin_fecha'}
 */
export function estadoServicio(s) {
  if (!s.servicio_vence_en) return 'sin_fecha';
  const d = diasHasta(s.servicio_vence_en);
  return d < 0 ? 'vencido' : d <= 30 ? 'por_vencer' : 'vigente';
}

/** Vencimiento legible, con etiqueta de texto además del color. @param {{servicio_vence_en: string|null}} s */
export function textoVencimientoServicio(s) {
  const e = estadoServicio(s);
  if (e === 'sin_fecha') return h('span', { class: 'srv-venc mut', text: 'No vence' });
  const f = /** @type {string} */ (s.servicio_vence_en);
  return h('span', { class: 'srv-venc ' + (e === 'vencido' ? 'pasado' : e === 'por_vencer' ? 'pronto' : '') }, [
    e === 'vencido' ? h('b', { text: 'Vencido' }) : e === 'por_vencer' ? h('b', { text: 'Por vencer' }) : null, fmtFecha(f) + ' · ' + textoVence(f)]);
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  aplicarEstilosServicios();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = /** @type {string} */ (sesion.organizacionActiva());
  const migas = await migasRaiz();
  migas.push(['Dominios y servicios']);
  pantalla(contenedor, { codigo: 'P50', nombre: 'Dominios y servicios', migas });
  if (!puede(u, 'ver', 'configuraciones', orgId)) { sinPermiso(contenedor, u, 'Dominios y servicios'); return; }

  const [lista, umbrales] = await Promise.all([repositorio.listar('servicios', { organizacion_id: orgId }), repositorio.umbralesVerificacion()]);
  lista.sort((a, b) => a.servicio_nombre.localeCompare(b.servicio_nombre, 'es', { numeric: true }));
  const puedeCrear = puede(u, 'modificar', 'configuraciones', orgId);

  const est = { texto: '', tipo: 'todos', venc: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');
  const pintar = () => {
    zonaChips.textContent = '';
    zonaTabla.textContent = '';
    const palabras = normalizar(est.texto).split(/\s+/).filter(Boolean);
    const porTexto = lista.filter(s => {
      const t = normalizar([s.servicio_nombre, ROTULO_SERVICIO_TIPO[s.servicio_tipo], s.servicio_proveedor || '', s.servicio_titular || '', s.servicio_delegacion_dns || ''].join(' '));
      return palabras.every(p => t.includes(p));
    });
    const base = porTexto.filter(s => est.tipo === 'todos' || s.servicio_tipo === est.tipo);
    const cuentaTipo = (/** @type {string} */ t) => porTexto.filter(s => s.servicio_tipo === t).length;
    const itemsTipo = /** @type {Array<[string, string, number]>} */ ([['todos', 'Todos', porTexto.length]]);
    for (const t of Object.keys(ROTULO_SERVICIO_TIPO)) itemsTipo.push([t, ROTULO_SERVICIO_TIPO[t], cuentaTipo(t)]);
    const baseV = porTexto.filter(s => est.tipo === 'todos' || s.servicio_tipo === est.tipo);
    zonaChips.appendChild(h('div', { class: 'srv-chips' }, [
      chips(itemsTipo, est.tipo, k => { est.tipo = k; pintar(); }),
      chips([['vencidos', 'Vencidos', baseV.filter(s => estadoServicio(s) === 'vencido').length], ['por_vencer', 'Por vencer (30 días)', baseV.filter(s => estadoServicio(s) === 'por_vencer').length]],
        est.venc, k => { est.venc = k; pintar(); })]));
    const filas = base.filter(s => est.venc === 'todos' || (est.venc === 'vencidos' ? estadoServicio(s) === 'vencido' : estadoServicio(s) === 'por_vencer'));
    if (!lista.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [icono('configuracion'), h('h2', { text: 'Todavía no hay dominios ni servicios cargados' }),
        h('p', { text: 'Acá se documentan los dominios, el DNS, el hosting, los certificados SSL y el correo: a nombre de quién están, cuándo vencen, dónde está delegado el DNS y sus registros.' }),
        puedeCrear ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nuevo servicio', onclick: () => ir('#/servicio/nuevo') })]) : null]));
      return;
    }
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ningún servicio coincide con el filtro.' })); return; }
    zonaTabla.appendChild(tabla(['Nombre', 'Tipo', 'Proveedor', 'Titular', 'DNS delegado en', 'Vence', 'Verificado'], filas.map(s => [
      h('a', { href: '#/servicio/' + s.id, text: s.servicio_nombre, onclick: (/** @type {Event} */ e) => e.stopPropagation() }),
      ROTULO_SERVICIO_TIPO[s.servicio_tipo] || s.servicio_tipo, s.servicio_proveedor || '—', s.servicio_titular || '—', s.servicio_delegacion_dns || '—',
      textoVencimientoServicio(s), indicadorVerificacion(s.verificado_en, umbrales, true)]),
    { tipo: 'configuracion', onFila: (_f, i) => ir('#/servicio/' + filas[i].id) }));
  };

  const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar…', 'aria-label': 'Filtrar servicios', style: 'width:260px' }));
  inp.addEventListener('input', () => { est.texto = inp.value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Dominios y servicios' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [inp, h('span', { style: 'flex:1' }),
    puedeCrear ? h('button', { type: 'button', class: 'primario', text: 'Nuevo servicio', onclick: () => ir('#/servicio/nuevo') }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Las contraseñas de los paneles nunca se muestran acá: están en una credencial vinculada, que se abre desde la ficha del servicio.' }));
  pintar();
}
