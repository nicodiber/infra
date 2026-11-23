// @ts-check
/**
 * Lógica y piezas compartidas por las pantallas de servidores, racks y recorrido de verificación
 * (P05 Servidores/Racks, P06 ficha de servidor, P08 vista de rack, P19 recorrido).
 * Solo habla con `repositorio`, `permisos` y `utiles`: no toca el almacenamiento directamente.
 */

import * as repositorio from './repositorio.js';
import { h, icono, indicadorVerificacion, fmtFecha, fmtFechaHora, normalizar } from './utiles.js';
import { puede } from './permisos.js';
import { abrirModal, cerrarModal, toast } from './marco.js';
import { ROTULO_ESTADO_EQUIPO } from './modelos.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */
/** @typedef {import('./modelos.js').Equipo} Equipo */
/** @typedef {import('./modelos.js').Rack} Rack */

// ---------------------------------------------------------------------------------------------
// Estilos propios (prefijo rk-): lo que el mockup tiene y estilos.css todavía no
// ---------------------------------------------------------------------------------------------



// ---------------------------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------------------------

/**
 * Partes del hash actual: `#/servidor/<id>/red?x=1` → { segs: ['servidor', '<id>', 'red'], query }.
 * @returns {{segs: string[], query: URLSearchParams}}
 */
export function partesHash() {
  const [ruta, consulta] = location.hash.replace(/^#\/?/, '').split('?');
  return { segs: ruta.split('/').map(decodeURIComponent), query: new URLSearchParams(consulta || '') };
}

// ---------------------------------------------------------------------------------------------
// Piezas de interfaz
// ---------------------------------------------------------------------------------------------

/** @param {string} texto */
export function bloqueSinPermiso(texto) {
  return h('div', { class: 'aviso', role: 'status' }, [h('div', { text: texto }),
    h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/inicio', text: 'Volver al inicio' })])]);
}

/** @param {string} titulo @param {string} texto @param {string} [icon] @param {Node[]} [acciones] */
export function estadoVacio(titulo, texto, icon, acciones) {
  return h('div', { class: 'estado-vacio', role: 'status' }, [icono(icon || 'rack'), h('h2', { text: titulo }), h('p', { text: texto }),
    acciones && acciones.length ? h('div', { class: 'herr' }, acciones) : null]);
}

/** Estado operativo con símbolo propio (no solo color). @param {string} e */
export function estadoPill(e) {
  return h('span', { class: 'estp ' + (e === 'en_deposito' ? 'dep' : e === 'baja' ? 'baja' : ''), text: ROTULO_ESTADO_EQUIPO[e] || e });
}

/**
 * Chips con la cantidad por estado (MJ25).
 * @param {(estado: string) => number} cuenta @param {number} total @param {string} actual «todos» o un estado @param {(estado: string) => void} alElegir
 */
export function chipsEstado(cuenta, total, actual, alElegir) {
  /** @param {string} clave @param {string} rotulo @param {number} n */
  const mk = (clave, rotulo, n) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(actual === clave), title: 'Filtrar por estado: ' + rotulo,
    onclick: () => alElegir(actual === clave ? 'todos' : clave) }, [rotulo, h('span', { class: 'n', text: String(n) })]);
  return h('div', { class: 'chips-estado', role: 'group', 'aria-label': 'Cantidad por estado' },
    [mk('todos', 'Todos', total)].concat(['en_uso', 'en_deposito', 'baja'].map(e => mk(e, ROTULO_ESTADO_EQUIPO[e], cuenta(e)))));
}

/** Clase de color según el tipo de equipo en el rack. @param {string} tipo */
export function claseTipoRack(tipo) {
  return tipo === 'servidor' ? 't-servidor' : tipo === 'ups' ? 't-rack' : 't-equipo';
}

/** Hash de la ficha de un equipo según su tipo. @param {{id: string, equipo_tipo: string}} e */
export function rutaEquipo(e) { return (e.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + e.id; }

/** Módulo de permisos de un equipo. @param {{equipo_tipo: string}} e @returns {'servidores'|'red'} */
export function moduloEquipo(e) { return e.equipo_tipo === 'servidor' ? 'servidores' : 'red'; }

/** «U15–U16» o «U15». @param {{rack_u_inicio: number|null, rack_u_alto: number|null}} e */
export function rangoU(e) {
  if (e.rack_u_inicio == null) return '';
  const alto = e.rack_u_alto || 1;
  return alto > 1 ? 'U' + e.rack_u_inicio + '–U' + (e.rack_u_inicio + alto - 1) : 'U' + e.rack_u_inicio;
}

/**
 * Ubicación completa «Sede › Sala» a partir del mapa de ubicaciones.
 * @param {string|null} id @param {Map<string, any>} mapa
 */
export function rutaUbicacion(id, mapa) {
  /** @type {string[]} */
  const partes = [];
  let actual = id ? mapa.get(id) : null;
  let tope = 0;
  while (actual && tope++ < 10) { partes.unshift(actual.ubicacion_nombre); actual = actual.ubicacion_padre_id ? mapa.get(actual.ubicacion_padre_id) : null; }
  return partes.join(' › ');
}

/** @param {Array<{id: string}>} lista @returns {Map<string, any>} */
export function porId(lista) { return new Map(lista.map(x => [x.id, x])); }

/**
 * Mini rack (MJ27): solo las unidades del equipo, resaltadas. Lleva al rack con el equipo resaltado.
 * @param {Rack} rack @param {Equipo} equipo
 */
export function miniRack(rack, equipo) {
  const total = rack.rack_unidades_total || 42;
  const alto = equipo.rack_u_alto || 1;
  const px = 84 / total;
  const top = (total - ((equipo.rack_u_inicio || 1) + alto - 1)) * px;
  const u = rangoU(equipo);
  const hash = '#/rack/' + rack.id + '?resaltar=' + equipo.id;
  return h('a', { class: 'minirack ' + claseTipoRack(equipo.equipo_tipo), href: hash, title: 'Ver ' + equipo.equipo_nombre + ' en el rack ' + rack.rack_nombre,
    'aria-label': 'Ver ' + equipo.equipo_nombre + ' en el rack ' + rack.rack_nombre + ', ' + u }, [
    h('div', { class: 'mr-cuerpo', 'aria-hidden': 'true' }, [h('div', { class: 'mr-eq', style: 'top:' + top.toFixed(1) + 'px;height:' + Math.max(alto * px, 3).toFixed(1) + 'px' })]),
    h('b', { text: rack.rack_nombre + ' · ' + u }), h('span', { text: 'Ver en rack' })]);
}

// ---------------------------------------------------------------------------------------------
// Ficha: cabecera, datos y pie con verificación
// ---------------------------------------------------------------------------------------------

/**
 * Bloque de ficha (cabecera con botones, datos y, si hay, mini rack).
 * @param {{tipo: string, etiqueta: string, icon?: string, titulo: string, datos: Node, botones: Array<Node|null>, mini?: Node|null, modoEdicion?: boolean, pie?: Node|null}} o
 */
export function fichaBloque(o) {
  const cab = h('div', { class: 'fila', style: 'align-items:center;margin-bottom:10px' }, [
    h('div', { style: 'flex:1;min-width:0' }, [h('div', { class: 'eyebrow' }, [icono(o.icon || o.tipo), o.etiqueta]), h('h1', { text: o.titulo })]),
    o.modoEdicion ? h('span', { class: 'mut', text: 'Modo edición · al guardar, queda verificado hoy' }) : null,
    h('div', { class: 'herr', style: 'margin:0' }, o.botones)]);
  return h('div', { class: 'bloque ficha t-' + o.tipo }, [cab, h('div', { class: 'ficha-cab' }, [h('div', { class: 'ficha-datos' }, [o.datos]), o.mini || null]), o.pie || null]);
}

/**
 * Pie de una ficha: último cambio, verificación (3 niveles) y «Confirmar vigente» (D-041, D-045).
 * @param {{coleccion: string, registro: any, umbrales: import('./utiles.js').Umbrales, nombresUsuario: Map<string, string>, puedeVerificar: boolean, alConfirmar: () => void, error?: (m: string) => void}} o
 */
export function pieVerificacion(o) {
  const r = o.registro;
  const quien = (/** @type {string} */ id) => o.nombresUsuario.get(id) || 'alguien';
  const pie = h('div', { class: 'ficha-pie' });
  pie.appendChild(h('span', { class: 'cambio', text: 'Último cambio: ' + fmtFechaHora(r.actualizado_en) + ' · ' + quien(r.actualizado_por) }));
  pie.appendChild(indicadorVerificacion(r.verificado_en, o.umbrales));
  pie.appendChild(h('span', { class: 'verif-det', text: 'Confirmó ' + quien(r.verificado_por) + ' el ' + fmtFecha(r.verificado_en) }));
  pie.appendChild(h('span', { class: 'esp' }));
  if (o.puedeVerificar) {
    pie.appendChild(h('button', { type: 'button', class: 'chico', text: 'Confirmar vigente', title: 'Confirma que lo documentado sigue siendo real. No abre ningún formulario.', onclick: async () => {
      try { await o.alConfirmar(); } catch (e) { if (o.error) o.error(e instanceof Error ? e.message : 'No se pudo confirmar.'); }
    } }));
  } else pie.appendChild(h('span', { class: 'verif-det', text: 'Tu rol no confirma vigencia en este módulo.' }));
  return pie;
}

/** Mapa id → nombre de todos los usuarios (incluye bajas). */
export async function nombresDeUsuarios() {
  const us = await repositorio.listar('usuarios', null, { incluirBajas: true });
  return new Map(us.map(x => [x.id, x.usuario_nombre]));
}

// ---------------------------------------------------------------------------------------------
// Campos del servidor (modelo-de-datos.md §3.5 y §4.5)
// ---------------------------------------------------------------------------------------------

export const ROTULO_VIRTUALIZACION = { ninguna: 'Ninguna', vmware: 'VMware', hyperv: 'Hyper-V', proxmox: 'Proxmox', kvm: 'KVM', otra: 'Otra' };
const OPC_ESTADO = /** @type {Array<[string, string]>} */ (Object.entries(ROTULO_ESTADO_EQUIPO));

/**
 * @typedef {Object} CampoDef
 * @property {string} k Clave del campo.
 * @property {boolean} [c] Va dentro de `equipo_campos`.
 * @property {string} etq
 * @property {'text'|'number'|'date'|'select'} [tipo]
 * @property {Array<[string, string]>} [opciones]
 * @property {boolean} [req]
 * @property {boolean} [soloFisico]
 */

/** @type {CampoDef[]} */
export const CAMPOS_SERVIDOR = [
  { k: 'equipo_nombre', etq: 'Nombre', req: true },
  { k: 'equipo_marca', etq: 'Marca' },
  { k: 'equipo_modelo', etq: 'Modelo' },
  { k: 'equipo_numero_serie', etq: 'Número de serie' },
  { k: 'equipo_mac', etq: 'MAC' },
  { k: 'servidor_rol', c: true, etq: 'Rol', req: true },
  { k: 'servidor_sistema_operativo', c: true, etq: 'Sistema operativo', req: true },
  { k: 'servidor_cpu', c: true, etq: 'CPU' },
  { k: 'servidor_ram_gb', c: true, etq: 'RAM (GB)', tipo: 'number' },
  { k: 'servidor_almacenamiento', c: true, etq: 'Discos / RAID' },
  { k: 'servidor_virtualizacion', c: true, etq: 'Hipervisor', tipo: 'select', opciones: /** @type {Array<[string, string]>} */ (Object.entries(ROTULO_VIRTUALIZACION)), req: true },
  { k: 'equipo_ip_gestion', etq: 'IP de gestión' },
  { k: 'servidor_ip_ilo_idrac', c: true, etq: 'IP de iLO / iDRAC', soloFisico: true },
  { k: 'servidor_garantia_vence_en', c: true, etq: 'Garantía vence', tipo: 'date', soloFisico: true },
  { k: 'equipo_estado', etq: 'Estado', tipo: 'select', opciones: OPC_ESTADO, req: true }
];

/** Valor actual de un campo de un servidor. @param {any} eq @param {CampoDef} f */
export function valorCampo(eq, f) { return f.c ? (eq.equipo_campos || {})[f.k] : eq[f.k]; }

/** Valor para mostrar (solo lectura). @param {any} eq @param {CampoDef} f */
export function textoCampo(eq, f) {
  const v = valorCampo(eq, f);
  if (v === null || v === undefined || v === '') return '—';
  if (f.tipo === 'date') return fmtFecha(v);
  if (f.tipo === 'select') { const o = (f.opciones || []).find(x => x[0] === v); return o ? o[1] : String(v); }
  if (f.k === 'servidor_ram_gb') return v + ' GB';
  return String(v);
}

/**
 * Entrada de formulario para un campo.
 * @param {CampoDef} f @param {any} valor @param {string} [prefijoId]
 * @returns {{caja: HTMLElement, leer: () => string, entrada: HTMLElement}}
 */
export function crearCampo(f, valor, prefijoId) {
  const id = (prefijoId || 'rk') + '-' + f.k;
  /** @type {HTMLInputElement|HTMLSelectElement} */
  let el;
  if (f.tipo === 'select') {
    el = /** @type {HTMLSelectElement} */ (h('select', { id }, (f.opciones || []).map(o => h('option', { value: o[0], text: o[1], selected: o[0] === valor ? 'selected' : null }))));
  } else {
    el = /** @type {HTMLInputElement} */ (h('input', { id, type: f.tipo === 'number' ? 'number' : f.tipo === 'date' ? 'date' : 'text', min: f.tipo === 'number' ? '0' : null }));
    el.value = valor === null || valor === undefined ? '' : String(valor);
  }
  const caja = h('div', { class: 'campo' }, [h('label', { for: id, text: f.etq + (f.req ? ' *' : '') }), el]);
  return { caja, entrada: el, leer: () => el.value.trim() };
}

/** @param {string} v */
export function ipValida(v) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  return !!m && m.slice(1).every(x => +x <= 255);
}

/** @param {string} v */
export function macValida(v) { return /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(v); }

/**
 * Valida los valores de un servidor. Devuelve el primer problema o null.
 * @param {Object<string, string>} vals Valores leídos (por clave de campo).
 * @param {{orgId: string, idActual?: string|null, esVM: boolean}} o
 * @returns {Promise<string|null>}
 */
export async function validarServidor(vals, o) {
  for (const f of CAMPOS_SERVIDOR) {
    if (f.soloFisico && o.esVM) continue;
    if (f.k in vals && f.req && !vals[f.k]) return 'Falta completar «' + f.etq + '».';
  }
  if (vals.equipo_ip_gestion && !ipValida(vals.equipo_ip_gestion)) return 'La IP de gestión no es válida (por ejemplo 10.10.20.21).';
  if (!o.esVM && vals.servidor_ip_ilo_idrac && !ipValida(vals.servidor_ip_ilo_idrac)) return 'La IP de iLO / iDRAC no es válida (por ejemplo 10.10.10.10).';
  if (vals.equipo_mac && !macValida(vals.equipo_mac)) return 'La MAC no es válida (formato AA:BB:CC:DD:EE:FF).';
  if (vals.servidor_ram_gb && !(/^\d+$/.test(vals.servidor_ram_gb))) return 'La RAM tiene que ser un número entero de GB.';
  const nombre = normalizar(vals.equipo_nombre || '');
  const repetidos = await repositorio.contar('equipos', e => e.organizacion_id === o.orgId && e.id !== o.idActual && normalizar(e.equipo_nombre) === nombre);
  if (repetidos) return 'Ya existe un equipo llamado «' + vals.equipo_nombre + '» en esta organización.';
  return null;
}

/**
 * Aplica los valores leídos a una copia del equipo.
 * @param {any} base @param {Object<string, string>} vals @param {boolean} esVM
 */
export function aplicarServidor(base, vals, esVM) {
  const eq = structuredClone(base);
  eq.equipo_campos = eq.equipo_campos || {};
  for (const f of CAMPOS_SERVIDOR) {
    if (!(f.k in vals)) continue;
    if (f.soloFisico && esVM) continue;
    let v = /** @type {any} */ (vals[f.k]);
    if (v === '' && !f.req) v = null;
    else if (f.k === 'servidor_ram_gb' && v !== null) v = parseInt(v, 10);
    if (f.c) eq.equipo_campos[f.k] = v; else eq[f.k] = v;
  }
  return eq;
}

// ---------------------------------------------------------------------------------------------
// Rack: ocupación y validación de unidades (regla 8 y 9 del modelo)
// ---------------------------------------------------------------------------------------------

/**
 * Valida que un equipo entre en el rack sin pisar a otro. Devuelve el problema o null.
 * @param {string} rackId @param {number} uInicio @param {number} uAlto @param {string|null} equipoId
 * @returns {Promise<string|null>}
 */
export async function validarLugarEnRack(rackId, uInicio, uAlto, equipoId) {
  const rack = await repositorio.obtener('racks', rackId);
  if (!rack) return 'El rack elegido ya no existe.';
  if (!Number.isInteger(uInicio) || !Number.isInteger(uAlto) || uInicio < 1 || uAlto < 1) return 'Indicá la U de inicio y el alto en U (números enteros desde 1).';
  const fin = uInicio + uAlto - 1;
  if (fin > rack.rack_unidades_total) return 'El equipo no entra: el rack ' + rack.rack_nombre + ' tiene ' + rack.rack_unidades_total + ' U y esto llegaría hasta la U' + fin + '.';
  const otros = await repositorio.listar('equipos', e => e.rack_id === rackId && e.id !== equipoId);
  for (const e of otros) {
    const a = e.rack_u_inicio || 0, b = a + (e.rack_u_alto || 1) - 1;
    if (uInicio <= b && fin >= a) return 'Esas unidades ya las ocupa ' + e.equipo_nombre + ' (' + rangoU(e) + ').';
  }
  return null;
}

/**
 * Unidades libres como rangos «1–2, 5, 10–14».
 * @param {number} total @param {Array<{rack_u_inicio: number|null, rack_u_alto: number|null}>} equipos
 */
export function textoUnidadesLibres(total, equipos) {
  const ocup = new Set();
  for (const e of equipos) for (let k = 0; k < (e.rack_u_alto || 1); k++) ocup.add((e.rack_u_inicio || 0) + k);
  /** @type {string[]} */
  const rangos = [];
  let ini = 0;
  for (let u = 1; u <= total + 1; u++) {
    const libre = u <= total && !ocup.has(u);
    if (libre && !ini) ini = u;
    if (!libre && ini) { rangos.push(ini === u - 1 ? String(ini) : ini + '–' + (u - 1)); ini = 0; }
  }
  return rangos.length ? 'U' + rangos.join(', ') : 'ninguna';
}

/**
 * Primera U inicial donde entra un equipo de `alto` U sin pisar a otros, o null si no hay lugar.
 * @param {number} total @param {Array<{id: string, rack_u_inicio: number|null, rack_u_alto: number|null}>} equipos @param {number} alto @param {string|null} [excluirId]
 * @returns {number|null}
 */
export function primeraUnidadLibre(total, equipos, alto, excluirId) {
  const ocup = new Set();
  for (const e of equipos) if (e.id !== excluirId && e.rack_u_inicio != null) for (let k = 0; k < (e.rack_u_alto || 1); k++) ocup.add(e.rack_u_inicio + k);
  for (let ini = 1; ini + alto - 1 <= total; ini++) {
    let libre = true;
    for (let k = 0; k < alto; k++) if (ocup.has(ini + k)) { libre = false; break; }
    if (libre) return ini;
  }
  return null;
}

/** Unidades ocupadas por los equipos. @param {Array<{rack_u_alto: number|null}>} equipos */
export function unidadesOcupadas(equipos) { return equipos.reduce((n, e) => n + (e.rack_u_alto || 1), 0); }

// ---------------------------------------------------------------------------------------------
// Dar de baja (PE1): directa para superadmin y gerente; el técnico la pide y la confirma el superadmin
// ---------------------------------------------------------------------------------------------

/**
 * Botón «Dar de baja» (o aviso de baja pedida). Devuelve null si el rol no puede ni pedirla.
 * @param {{u: UsuarioSesion, org: string, modulo: 'servidores'|'racks', coleccion: string, registro: any, nombre: string, bloqueo: string|null, alTerminar: () => void}} o
 * @returns {Promise<HTMLElement|null>}
 */
export async function botonBaja(o) {
  const directa = puede(o.u, 'baja', o.modulo, o.org);
  if (!directa && !puede(o.u, 'pedir_baja', o.modulo, o.org)) return null;
  if (!directa) {
    const pendiente = await repositorio.contar('solicitudes', s => s.solicitud_tipo === 'baja_registro' && s.solicitud_estado === 'pendiente' && s.solicitud_entidad_id === o.registro.id);
    if (pendiente) return h('span', { class: 'msg', text: 'Baja pedida, la confirma el superadmin' });
  }
  return h('button', { type: 'button', text: directa ? 'Dar de baja' : 'Pedir baja', onclick: () => {
    const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    const motivo = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'baja-motivo', placeholder: 'Motivo (opcional)' }));
    const confirmar = async () => {
      try {
        if (directa) await repositorio.darDeBaja(o.coleccion, o.registro.id, { usuarioId: o.u.id, motivo: motivo.value.trim() || undefined });
        else await repositorio.crearSolicitudBaja({ coleccion: o.coleccion, id: o.registro.id, usuarioId: o.u.id, motivo: motivo.value.trim() });
        cerrarModal();
        toast(directa ? '«' + o.nombre + '» dado de baja' : 'Baja pedida, la confirma el superadmin');
        o.alTerminar();
      } catch (e) { error.textContent = e instanceof Error ? e.message : 'No se pudo completar.'; error.hidden = false; }
    };
    abrirModal(h('div', { class: 'bloque rk-modal rk-form', role: 'dialog', 'aria-label': 'Dar de baja' }, o.bloqueo ? [
      h('h2', { text: 'No se puede dar de baja «' + o.nombre + '»' }), h('p', { text: o.bloqueo }),
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Entendido', onclick: () => cerrarModal() })])] : [
      h('h2', { text: (directa ? 'Dar de baja «' : 'Pedir la baja de «') + o.nombre + '»' }),
      h('p', { text: directa ? 'Deja de aparecer en listados y búsquedas, pero queda en el historial y se puede restaurar.' : 'Queda pendiente hasta que la confirme el superadmin; mientras tanto el registro sigue igual.' }),
      h('label', { for: 'baja-motivo', text: 'Motivo' }), motivo, error,
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: directa ? 'Sí, dar de baja' : 'Pedir baja', onclick: confirmar }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() })])]));
  } });
}
