// @ts-check
/**
 * P24 · Licencias (`#/licencias`): producto, tipo, en uso frente a compradas (barra, con las excedidas resaltadas),
 * vencimiento con su estado, proveedor y verificación. Chips: vencidas, por vencer, excedidas y sin instalaciones.
 * La clave de cada licencia es una credencial vinculada: acá nunca aparece.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, diasHasta, textoVence, indicadorVerificacion, normalizar, icono } from '../assets/js/utiles.js';
import { ROTULO_LICENCIA_TIPO } from '../assets/js/modelos.js';
import { sinPermiso, chips } from '../assets/js/credenciales.js';

const CSS = `
.lic-uso{display:flex;align-items:center;gap:8px;min-width:150px}
.lic-barra{flex:0 0 84px;height:9px;border-radius:5px;background:var(--surf2);border:1px solid var(--borde-fuerte);overflow:hidden}
.lic-barra>i{display:block;height:100%;background:var(--acc)}
.lic-barra.exc{border-color:var(--bad-borde)}
.lic-barra.exc>i{background:repeating-linear-gradient(45deg,var(--bad-fg) 0 4px,var(--bad-bg) 4px 8px)}
.lic-barra.lleno>i{background:repeating-linear-gradient(90deg,var(--acc) 0 6px,var(--acc-borde) 6px 8px)}
.lic-n{font:600 12.5px var(--mono);white-space:nowrap}
.lic-n.exc{color:var(--bad-fg);font-weight:700}
.lic-venc{font-size:12.5px}
.lic-venc b{display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;border:1px solid currentColor;font-size:11px}
.lic-venc.pasado{color:var(--bad-fg)} .lic-venc.pronto{color:var(--warn-fg)}
`;

/** Agrega los estilos propios una sola vez. */
export function aplicarEstilosLicencias() {
  if (document.getElementById('estilos-licencias')) return;
  const s = document.createElement('style');
  s.id = 'estilos-licencias';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * Estado de vencimiento de una licencia.
 * @param {{licencia_tipo: string, licencia_vence_en: string|null}} l
 * @returns {'vencida'|'por_vencer'|'vigente'|'perpetua'|'sin_fecha'}
 */
export function estadoVencimiento(l) {
  if (!l.licencia_vence_en) return l.licencia_tipo === 'perpetua' ? 'perpetua' : 'sin_fecha';
  const d = diasHasta(l.licencia_vence_en);
  return d < 0 ? 'vencida' : d <= 30 ? 'por_vencer' : 'vigente';
}

/** Vencimiento legible, con una etiqueta de texto además del color. @param {{licencia_tipo: string, licencia_vence_en: string|null}} l */
export function textoVencimientoLicencia(l) {
  const e = estadoVencimiento(l);
  if (e === 'perpetua') return h('span', { class: 'lic-venc', text: 'Perpetua · no vence' });
  if (e === 'sin_fecha') return h('span', { class: 'lic-venc', text: 'Sin fecha de vencimiento' });
  const f = /** @type {string} */ (l.licencia_vence_en);
  return h('span', { class: 'lic-venc ' + (e === 'vencida' ? 'pasado' : e === 'por_vencer' ? 'pronto' : '') }, [
    e === 'vencida' ? h('b', { text: 'Vencida' }) : e === 'por_vencer' ? h('b', { text: 'Por vencer' }) : null, fmtFecha(f) + ' · ' + textoVence(f)]);
}

/**
 * Barra «en uso / compradas»; si hay más instalaciones que licencias queda resaltada con patrón y texto.
 * @param {{usadas: number, cantidad: number, excedida: boolean, exceso: number}} uso
 */
export function barraUso(uso) {
  const pct = Math.min(100, uso.cantidad ? Math.round(uso.usadas / uso.cantidad * 100) : 0);
  const lleno = !uso.excedida && uso.usadas === uso.cantidad;
  return h('div', { class: 'lic-uso', title: uso.excedida ? 'Hay ' + uso.exceso + ' instalación(es) más que licencias compradas' : '' }, [
    h('div', { class: 'lic-barra' + (uso.excedida ? ' exc' : lleno ? ' lleno' : ''), role: 'img', 'aria-label': uso.usadas + ' en uso de ' + uso.cantidad + ' compradas' }, [h('i', { style: 'width:' + (uso.excedida ? 100 : pct) + '%' })]),
    h('span', { class: 'lic-n' + (uso.excedida ? ' exc' : '') }, [uso.usadas + ' de ' + uso.cantidad + (uso.excedida ? ' · excedida +' + uso.exceso : '')])]);
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  aplicarEstilosLicencias();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = /** @type {string} */ (sesion.organizacionActiva());
  const migas = await migasRaiz();
  migas.push(['Licencias']);
  pantalla(contenedor, { codigo: 'P24', nombre: 'Listado de Licencias', migas });
  if (!puede(u, 'ver', 'licencias', orgId)) { sinPermiso(contenedor, u, 'Licencias'); return; }

  const [lista, umbrales] = await Promise.all([repositorio.listar('licencias', { organizacion_id: orgId }), repositorio.umbralesVerificacion()]);
  const usos = new Map();
  await Promise.all(lista.map(async l => usos.set(l.id, await repositorio.licenciasEnUso(l.id))));
  lista.sort((a, b) => a.licencia_producto.localeCompare(b.licencia_producto, 'es', { numeric: true }));
  const puedeCrear = puede(u, 'modificar', 'licencias', orgId);

  const est = { texto: '', tipo: '', filtro: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');
  const pintar = () => {
    zonaChips.textContent = '';
    zonaTabla.textContent = '';
    const palabras = normalizar(est.texto).split(/\s+/).filter(Boolean);
    const base = lista.filter(l => {
      if (est.tipo && l.licencia_tipo !== est.tipo) return false;
      const t = normalizar([l.licencia_producto, ROTULO_LICENCIA_TIPO[l.licencia_tipo], l.licencia_proveedor || ''].join(' '));
      return palabras.every(p => t.includes(p));
    });
    /** @type {Object<string, (l: any) => boolean>} */
    const pruebas = {
      vencidas: l => estadoVencimiento(l) === 'vencida', por_vencer: l => estadoVencimiento(l) === 'por_vencer',
      excedidas: l => usos.get(l.id).excedida, sin_instalaciones: l => usos.get(l.id).usadas === 0
    };
    zonaChips.appendChild(chips([['todos', 'Todas', base.length], ['vencidas', 'Vencidas', base.filter(pruebas.vencidas).length], ['por_vencer', 'Por vencer (30 días)', base.filter(pruebas.por_vencer).length],
      ['excedidas', 'Excedidas', base.filter(pruebas.excedidas).length], ['sin_instalaciones', 'Sin instalaciones', base.filter(pruebas.sin_instalaciones).length]], est.filtro, k => { est.filtro = k; pintar(); }));
    const filas = base.filter(l => est.filtro === 'todos' || pruebas[est.filtro](l));
    if (!lista.length) {
      zonaTabla.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [icono('licencia'), h('h2', { text: 'Todavía no hay licencias cargadas' }),
        h('p', { text: 'Acá se documentan las licencias de software: cuántas se compraron, cuántas están instaladas, cuándo vencen y dónde está la clave.' }),
        puedeCrear ? h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Nueva licencia', onclick: () => ir('#/licencia/nueva') })]) : null]));
      return;
    }
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'mut', style: 'padding:8px', text: 'Ninguna licencia coincide con el filtro.' })); return; }
    zonaTabla.appendChild(tabla(['Producto', 'Tipo', 'En uso / compradas', 'Vence', 'Proveedor', 'Verificado'], filas.map(l => [
      h('a', { href: '#/licencia/' + l.id, text: l.licencia_producto, onclick: (/** @type {Event} */ e) => e.stopPropagation() }), ROTULO_LICENCIA_TIPO[l.licencia_tipo] || l.licencia_tipo,
      barraUso(usos.get(l.id)), textoVencimientoLicencia(l), l.licencia_proveedor || '—', indicadorVerificacion(l.verificado_en, umbrales, true)]),
    { tipo: 'licencia', onFila: (_f, i) => ir('#/licencia/' + filas[i].id) }));
  };

  const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar…', 'aria-label': 'Filtrar licencias', style: 'width:260px' }));
  inp.addEventListener('input', () => { est.texto = inp.value; pintar(); });
  const sel = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo' }, [h('option', { value: '', text: 'Todos los tipos' })].concat(Object.keys(ROTULO_LICENCIA_TIPO).map(t => h('option', { value: t, text: ROTULO_LICENCIA_TIPO[t] })))));
  sel.addEventListener('change', () => { est.tipo = sel.value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Licencias' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [inp, sel, h('span', { style: 'flex:1' }),
    puedeCrear ? h('button', { type: 'button', class: 'primario', text: 'Nueva licencia', onclick: () => ir('#/licencia/nueva') }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Las claves nunca se muestran en el listado: están en una credencial vinculada, que se abre desde la ficha de la licencia.' }));
  pintar();
}
