// @ts-check
/**
 * P05 · Listado de Servidores (`#/servidores`): servidores físicos y máquinas virtuales con su host,
 * chips por estado (MJ25), filtro, columna «Verificado» y «Nuevo servidor».
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { abrirAlta } from '../assets/js/altas.js';
import { botonCargarVarios } from '../assets/js/grilla.js';
import { h, tabla, indicadorVerificacion, normalizar } from '../assets/js/utiles.js';
import {
  bloqueSinPermiso, estadoVacio, estadoPill, chipsEstado, porId, rangoU, rutaEquipo
} from '../assets/js/racks.js';

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  const migas = (await migasRaiz()).concat([['Servidores']]);
  pantalla(contenedor, { codigo: 'P05', nombre: 'Listado de Servidores', migas });
  if (!org || !puede(u, 'ver', 'servidores', org)) {
    contenedor.appendChild(bloqueSinPermiso('Tu rol no tiene acceso al módulo Servidores.'));
    return;
  }
  const [servidores, racks, umbrales] = await Promise.all([
    repositorio.listar('equipos', e => e.organizacion_id === org && e.equipo_tipo === 'servidor', { ordenarPor: 'equipo_nombre' }),
    repositorio.listar('racks', { organizacion_id: org }, { ordenarPor: 'rack_nombre' }),
    repositorio.umbralesVerificacion()]);
  const equiposPorId = porId(servidores);
  const racksPorId = porId(racks);
  const ubicaciones = porId(await repositorio.listar('ubicaciones', { organizacion_id: org }));
  const puedeModificar = puede(u, 'modificar', 'servidores', org);

  const estado = { texto: '', tipo: 'todos', estado: 'todos' };
  const zonaChips = h('div');
  const zonaTabla = h('div');

  /** @param {any} s */
  const esVM = s => !!(s.equipo_campos && s.equipo_campos.host_id);
  /** @param {any} s */
  const dondeEsta = s => {
    if (esVM(s)) { const host = equiposPorId.get(s.equipo_campos.host_id); return 'VM en ' + (host ? host.equipo_nombre : 'host desconocido'); }
    const r = s.rack_id ? racksPorId.get(s.rack_id) : null;
    if (r) return r.rack_nombre + ' · ' + rangoU(s);
    const ub = s.ubicacion_id ? ubicaciones.get(s.ubicacion_id) : null;
    return ub ? ub.ubicacion_nombre + ' (sin rack)' : '—';
  };

  const pintar = () => {
    zonaChips.textContent = ''; zonaTabla.textContent = '';
    const palabras = normalizar(estado.texto).split(/\s+/).filter(Boolean);
    const base = servidores.filter(s => {
      if (estado.tipo === 'fisico' && esVM(s)) return false;
      if (estado.tipo === 'vm' && !esVM(s)) return false;
      if (!palabras.length) return true;
      const c = s.equipo_campos || {};
      const texto = normalizar([s.equipo_nombre, s.equipo_marca, s.equipo_modelo, s.equipo_ip_gestion, c.servidor_rol, c.servidor_sistema_operativo, c.servidor_ip_ilo_idrac, dondeEsta(s)].join(' '));
      return palabras.every(p => texto.includes(p));
    });
    zonaChips.appendChild(chipsEstado(e => base.filter(s => s.equipo_estado === e).length, base.length, estado.estado, v => { estado.estado = v; pintar(); }));
    const filas = base.filter(s => estado.estado === 'todos' || s.equipo_estado === estado.estado);
    if (!servidores.length) {
      zonaTabla.appendChild(estadoVacio('Todavía no hay servidores cargados', 'Cargá el primero con «Nuevo servidor» (arriba a la derecha): nombre, rol y sistema operativo alcanzan para empezar. También podés cargar una máquina virtual eligiendo «Qué es».', 'servidor'));
      return;
    }
    if (!filas.length) { zonaTabla.appendChild(h('div', { class: 'aviso', text: 'Ningún servidor coincide con el filtro. Probá con otra palabra o tocá «Todos».' })); return; }
    zonaTabla.appendChild(tabla(
      ['Nombre', 'Tipo', 'Rol', 'Sistema operativo', 'IP de gestión', 'IP de iLO / iDRAC', 'Rack / host', 'Estado', 'Verificado'],
      filas.map(s => {
        const c = s.equipo_campos || {};
        return [s.equipo_nombre, esVM(s) ? 'Máquina virtual' : 'Servidor físico', c.servidor_rol || '—', c.servidor_sistema_operativo || '—', s.equipo_ip_gestion || '—',
          c.servidor_ip_ilo_idrac || '—', dondeEsta(s), estadoPill(s.equipo_estado), indicadorVerificacion(s.verificado_en, umbrales, true)];
      }),
      { tipo: 'servidor', onFila: (_f, i) => ir(rutaEquipo(filas[i])) }));
    zonaTabla.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: filas.length + ' de ' + servidores.length + ' servidores. Tocá una fila para abrir su ficha.' }));
  };

  const filtro = h('input', { type: 'search', placeholder: 'Filtrar por nombre, rol, SO, IP o rack…', 'aria-label': 'Filtrar servidores', style: 'width:320px' });
  filtro.addEventListener('input', () => { estado.texto = /** @type {HTMLInputElement} */ (filtro).value; pintar(); });
  const selTipo = h('select', { 'aria-label': 'Tipo' }, [h('option', { value: 'todos', text: 'Servidores y máquinas virtuales' }), h('option', { value: 'fisico', text: 'Solo servidores físicos' }), h('option', { value: 'vm', text: 'Solo máquinas virtuales' })]);
  selTipo.addEventListener('change', () => { estado.tipo = /** @type {HTMLSelectElement} */ (selTipo).value; pintar(); });

  contenedor.appendChild(h('h1', { text: 'Servidores' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [filtro, selTipo, h('span', { style: 'flex:1' }),
    puedeModificar ? botonCargarVarios('servidores', org) : null,
    puedeModificar ? h('button', { type: 'button', class: 'primario', text: 'Nuevo servidor', onclick: async () => {
      const creado = await abrirAlta('equipos', { organizacion_id: org, valores: { equipo_tipo: 'servidor', tipos: ['servidor'] }, rotulo: null });
      if (creado) { toast('Servidor «' + creado.equipo_nombre + '» creado'); ir('#/servidor/' + creado.id); }
    } }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  pintar();
}
