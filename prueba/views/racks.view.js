// @ts-check
/**
 * P05 · Listado de Racks (`#/racks`): racks agrupados por sede o sala, con U ocupadas / totales,
 * verificación y «Nuevo rack».
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { abrirAlta } from '../assets/js/altas.js';
import { h, tabla, indicadorVerificacion, normalizar } from '../assets/js/utiles.js';
import { bloqueSinPermiso, estadoVacio, porId, rutaUbicacion, unidadesOcupadas } from '../assets/js/racks.js';

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  pantalla(contenedor, { codigo: 'P05', nombre: 'Listado de Racks', migas: (await migasRaiz()).concat([['Racks']]) });
  if (!org || !puede(u, 'ver', 'racks', org)) { contenedor.appendChild(bloqueSinPermiso('Tu rol no tiene acceso al módulo Racks.')); return; }
  const [racks, ubicaciones, equipos, umbrales] = await Promise.all([
    repositorio.listar('racks', { organizacion_id: org }, { ordenarPor: 'rack_nombre' }),
    repositorio.listar('ubicaciones', { organizacion_id: org }),
    repositorio.listar('equipos', e => e.organizacion_id === org && !!e.rack_id),
    repositorio.umbralesVerificacion()]);
  const ubic = porId(ubicaciones);
  const puedeModificar = puede(u, 'modificar', 'racks', org);
  const puedeVerPlano = puede(u, 'ver', 'organizacion', org), puedeSubirPlano = puede(u, 'modificar', 'organizacion', org);
  /** Enlace «Plano»: al plano de la ubicación (o de la más cercana que lo tenga); si no hay ninguno, solo a quien puede subirlo. @param {string} ubicacionId */
  const enlacePlano = ubicacionId => {
    if (!puedeVerPlano) return null;
    let actual = ubic.get(ubicacionId), tope = 0;
    while (actual && !actual.ubicacion_plano_archivo_id && actual.ubicacion_padre_id && tope++ < 10) actual = ubic.get(actual.ubicacion_padre_id);
    if (actual && actual.ubicacion_plano_archivo_id) return h('a', { href: '#/plano/' + actual.id, class: 'mut', style: 'font-size:13px;font-weight:400;margin-left:8px', text: 'Plano' });
    return puedeSubirPlano ? h('a', { href: '#/plano/' + ubicacionId, class: 'mut', style: 'font-size:13px;font-weight:400;margin-left:8px', title: 'Todavía no tiene plano: podés subirlo', text: 'Plano (subir)' }) : null;
  };
  let texto = '';
  const zona = h('div');

  const pintar = () => {
    zona.textContent = '';
    if (!racks.length) {
      zona.appendChild(estadoVacio('Todavía no hay racks cargados', 'Un rack es el gabinete donde se montan switches y servidores. Cargá el primero con «Nuevo rack» (si todavía no cargaste la sede o sala, la podés crear ahí mismo) y después ubicá los equipos en sus unidades.', 'rack'));
      return;
    }
    const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
    const visibles = racks.filter(r => {
      const t = normalizar(r.rack_nombre + ' ' + rutaUbicacion(r.ubicacion_id, ubic) + ' ' + (r.rack_notas || ''));
      return palabras.every(p => t.includes(p));
    });
    if (!visibles.length) { zona.appendChild(h('div', { class: 'aviso', text: 'Ningún rack coincide con el filtro.' })); return; }
    /** @type {Map<string, any[]>} */
    const grupos = new Map();
    for (const r of visibles) { const k = rutaUbicacion(r.ubicacion_id, ubic) || 'Sin sede / sala'; if (!grupos.has(k)) grupos.set(k, []); /** @type {any[]} */ (grupos.get(k)).push(r); }
    for (const nombre of Array.from(grupos.keys()).sort((a, b) => a.localeCompare(b, 'es'))) {
      const lista = /** @type {any[]} */ (grupos.get(nombre));
      zona.appendChild(h('div', { class: 'rk-grupo' }, [
        h('h3', null, [nombre + ' (' + lista.length + (lista.length === 1 ? ' rack)' : ' racks)'), enlacePlano(lista[0].ubicacion_id)]),
        tabla(['Rack', 'Alto (U)', 'U ocupadas / totales', 'Equipos', 'Profundidad', 'Verificado'], lista.map(r => {
          const montados = equipos.filter(e => e.rack_id === r.id);
          const oc = unidadesOcupadas(montados);
          const pct = Math.min(100, Math.round(oc / r.rack_unidades_total * 100));
          return [r.rack_nombre, String(r.rack_unidades_total),
            h('span', null, [h('span', { class: 'rk-barra', 'aria-hidden': 'true' }, [h('i', { style: 'width:' + pct + '%' })]), oc + ' / ' + r.rack_unidades_total + ' (' + pct + ' %)']),
            String(montados.length), r.rack_profundidad ? r.rack_profundidad + ' mm' : '—', indicadorVerificacion(r.verificado_en, umbrales, true)];
        }), { tipo: 'rack', onFila: (_f, i) => ir('#/rack/' + lista[i].id) })]));
    }
    zona.appendChild(h('div', { class: 'mut', style: 'margin-top:8px', text: 'Tocá un rack para verlo dibujado por unidades.' }));
  };

  const filtro = h('input', { type: 'search', placeholder: 'Filtrar por nombre, sede o sala…', 'aria-label': 'Filtrar racks', style: 'width:300px' });
  filtro.addEventListener('input', () => { texto = /** @type {HTMLInputElement} */ (filtro).value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Racks' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [filtro, h('span', { style: 'flex:1' }),
    puedeModificar ? h('button', { type: 'button', class: 'primario', text: 'Nuevo rack', onclick: async () => {
      const creado = await abrirAlta('racks', { organizacion_id: org, rotulo: 'Nuevo rack' });
      if (creado) { toast('Rack «' + creado.rack_nombre + '» creado'); ir('#/rack/' + creado.id); }
    } }) : null]));
  contenedor.appendChild(zona);
  pintar();
}
