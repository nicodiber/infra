// @ts-check
/**
 * P05 · Listado de Servidores (`#/servidores`): servidores físicos y máquinas virtuales con su host,
 * chips por estado (MJ25), filtro, columna «Verificado» y «Nuevo servidor».
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, abrirModal, cerrarModal, toast } from '../assets/js/marco.js';
import { h, tabla, indicadorVerificacion, normalizar } from '../assets/js/utiles.js';
import {
  bloqueSinPermiso, estadoVacio, estadoPill, chipsEstado, porId, rangoU, rutaEquipo,
  CAMPOS_SERVIDOR, crearCampo, validarServidor, aplicarServidor, validarLugarEnRack
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
      zonaTabla.appendChild(estadoVacio('Todavía no hay servidores cargados', 'Cargá el primero con «Nuevo servidor»: nombre, rol y sistema operativo alcanzan para empezar.', 'servidor'));
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
    puedeModificar ? h('button', { type: 'button', class: 'primario', text: 'Nuevo servidor', onclick: () => abrirNuevo(u, org, servidores, racks) }) : null]));
  contenedor.appendChild(zonaChips);
  contenedor.appendChild(zonaTabla);
  pintar();
}

/**
 * Formulario «Nuevo servidor» en una ventana superpuesta.
 * @param {import('../assets/js/modelos.js').UsuarioSesion} u @param {string} org @param {any[]} servidores @param {any[]} racks
 */
function abrirNuevo(u, org, servidores, racks) {
  const hosts = servidores.filter(s => !(s.equipo_campos && s.equipo_campos.host_id));
  const selTipo = /** @type {HTMLSelectElement} */ (h('select', { id: 'nuevo-tipo' }, [h('option', { value: 'fisico', text: 'Servidor físico' }), h('option', { value: 'vm', text: 'Máquina virtual' })]));
  const selHost = /** @type {HTMLSelectElement} */ (h('select', { id: 'nuevo-host' }, hosts.map(s => h('option', { value: s.id, text: s.equipo_nombre }))));
  /** @type {Object<string, {caja: HTMLElement, leer: () => string}>} */
  const campos = {};
  const inicial = { servidor_virtualizacion: 'ninguna', equipo_estado: 'en_uso' };
  for (const f of CAMPOS_SERVIDOR) campos[f.k] = crearCampo(f, /** @type {any} */ (inicial)[f.k], 'nuevo');
  const selRack = /** @type {HTMLSelectElement} */ (h('select', { id: 'nuevo-rack' }, [h('option', { value: '', text: 'Sin rack' })].concat(racks.map(r => h('option', { value: r.id, text: r.rack_nombre + ' (' + r.rack_unidades_total + ' U)' })))));
  const uIni = /** @type {HTMLInputElement} */ (h('input', { id: 'nuevo-uini', type: 'number', min: '1' }));
  const uAlto = /** @type {HTMLInputElement} */ (h('input', { id: 'nuevo-ualto', type: 'number', min: '1', value: '1' }));
  const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
  const bloqueFisico = h('div', null, [
    h('div', { class: 'rk-dos' }, [campos.servidor_ip_ilo_idrac.caja, campos.servidor_garantia_vence_en.caja]),
    h('div', { class: 'rk-tres' }, [
      h('div', { class: 'campo' }, [h('label', { for: 'nuevo-rack', text: 'Rack (opcional)' }), selRack]),
      h('div', { class: 'campo' }, [h('label', { for: 'nuevo-uini', text: 'U de inicio (1 = abajo)' }), uIni]),
      h('div', { class: 'campo' }, [h('label', { for: 'nuevo-ualto', text: 'Alto en U' }), uAlto])])]);
  const bloqueHost = h('div', { class: 'campo', hidden: 'hidden' }, [h('label', { for: 'nuevo-host', text: 'Host que la aloja *' }), selHost]);
  const alCambiarTipo = () => {
    const vm = selTipo.value === 'vm';
    bloqueFisico.hidden = vm; bloqueHost.hidden = !vm;
  };
  selTipo.addEventListener('change', alCambiarTipo);

  const guardar = async () => {
    error.hidden = true;
    const vm = selTipo.value === 'vm';
    /** @type {Object<string, string>} */
    const vals = {};
    for (const f of CAMPOS_SERVIDOR) { if (!(f.soloFisico && vm)) vals[f.k] = campos[f.k].leer(); }
    const falla = (/** @type {string} */ m) => { error.textContent = m; error.hidden = false; };
    if (vm && !selHost.value) return falla('Elegí el host que aloja la máquina virtual (si no hay ninguno, cargá primero el servidor físico).');
    let problema = await validarServidor(vals, { orgId: org, idActual: null, esVM: vm });
    if (problema) return falla(problema);
    const conRack = !vm && selRack.value;
    if (conRack) {
      problema = await validarLugarEnRack(selRack.value, parseInt(uIni.value, 10), parseInt(uAlto.value, 10), null);
      if (problema) return falla(problema);
    }
    /** @type {any} */
    const base = {
      organizacion_id: org, equipo_tipo: 'servidor', equipo_nombre: '', equipo_marca: null, equipo_modelo: null, equipo_numero_serie: null, equipo_mac: null,
      equipo_ip_gestion: null, ubicacion_id: null, rack_id: null, rack_u_inicio: null, rack_u_alto: null, puesto_id: null, equipo_estado: 'en_uso', equipo_notas: null,
      equipo_campos: { servidor_rol: '', servidor_sistema_operativo: '', servidor_cpu: null, servidor_ram_gb: null, servidor_almacenamiento: null, servidor_virtualizacion: 'ninguna',
        host_id: vm ? selHost.value : null, servidor_ip_ilo_idrac: null, servidor_garantia_vence_en: null }
    };
    const nuevo = aplicarServidor(base, vals, vm);
    if (vm) {
      const host = servidores.find(s => s.id === selHost.value);
      nuevo.equipo_notas = 'Máquina virtual alojada en ' + (host ? host.equipo_nombre : 'su host') + '.';
    } else if (conRack) {
      const rack = racks.find(r => r.id === selRack.value);
      Object.assign(nuevo, { rack_id: rack.id, ubicacion_id: rack.ubicacion_id, rack_u_inicio: parseInt(uIni.value, 10), rack_u_alto: parseInt(uAlto.value, 10) });
    }
    try {
      const creado = await repositorio.guardar('equipos', nuevo, u.id);
      cerrarModal();
      toast('Servidor «' + creado.equipo_nombre + '» creado');
      ir('#/servidor/' + creado.id);
    } catch (e) { falla(e instanceof Error ? e.message : 'No se pudo guardar.'); }
  };

  const form = h('div', { class: 'bloque rk-modal rk-form', role: 'dialog', 'aria-label': 'Nuevo servidor' }, [
    h('h2', { text: 'Nuevo servidor' }),
    h('div', { class: 'mut', text: 'Los campos con * son obligatorios. Después podés completar el resto desde la ficha.' }),
    h('div', { class: 'rk-dos' }, [h('div', { class: 'campo' }, [h('label', { for: 'nuevo-tipo', text: 'Qué es' }), selTipo]), campos.equipo_nombre.caja]),
    bloqueHost,
    h('div', { class: 'rk-dos' }, [campos.servidor_rol.caja, campos.servidor_sistema_operativo.caja]),
    h('div', { class: 'rk-dos' }, [campos.servidor_virtualizacion.caja, campos.equipo_ip_gestion.caja]),
    h('div', { class: 'rk-dos' }, [campos.equipo_marca.caja, campos.equipo_modelo.caja]),
    h('div', { class: 'rk-dos' }, [campos.servidor_cpu.caja, campos.servidor_ram_gb.caja]),
    campos.servidor_almacenamiento.caja,
    bloqueFisico,
    error,
    h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Crear servidor', onclick: guardar }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() })])]);
  abrirModal(form);
  const foco = /** @type {HTMLInputElement|null} */ (form.querySelector('#nuevo-equipo_nombre'));
  if (foco) foco.focus();
}
