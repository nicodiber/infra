// @ts-check
/**
 * «Cargar varios» (idea 5, QC77-B): una grilla en una ventana que funciona como una planilla para cargar muchas filas de un
 * mismo tipo de una vez (equipos de red, servidores, equipos de escritorio, puestos, personas y VLAN).
 *
 *  - Se escribe como en una planilla: Tab avanza, Enter baja, Ctrl+D copia la celda de arriba, las flechas se mueven, siempre
 *    queda una fila vacía al final y se puede pegar desde Excel (con o sin fila de encabezados).
 *  - Cada fila se valida al salir de una celda (obligatorios, nombres e IP repetidos, rack y U, etc.). Si una fila nombra algo
 *    que no existe (un puesto, una persona, un rack, una sala, el host de una VM) se muestra en ámbar «X no existe: se crea» y,
 *    al crear, se crea con los datos mínimos (mismo criterio que la planilla de importación, QC58-A / D-083).
 *  - «Crear N …» crea solo las filas listas (y lo que falte) con `repositorio.guardar`; las filas con error quedan para corregir.
 *
 * No decide permisos: el botón «Cargar varios» aparece donde hoy aparece «Nuevo …» (`botonCargarVarios`).
 * Las métricas se emiten con el evento `infradoc:metrica` (`grilla_abierta`, `grilla_crear`).
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { h, normalizar } from './utiles.js';
import { abrirModal, cerrarModal, toast, ir } from './marco.js';
import { camposIniciales } from './red.js';
import { ipValida, primeraUnidadLibre } from './racks.js';

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Col Columna de la grilla.
 * @property {string} k Clave interna.
 * @property {string} r Encabezado.
 * @property {boolean} [req] Obligatoria.
 * @property {number} w Ancho (px).
 * @property {string} [lista] Lista de sugerencias (`datalist`).
 * @property {string[]} [alias] Otros nombres con los que se reconoce al pegar con encabezados.
 * @property {string} [ayuda] Se ve al pasar el mouse por el encabezado.
 */

/** @typedef {Object<string, string>} Vals Valores de una fila: clave de columna → texto. */

/**
 * @typedef {Object} Mundo Lo que ya existe en la organización.
 * @property {string} org @property {any[]} equipos @property {any[]} racks @property {any[]} ubicaciones
 * @property {any[]} puestos @property {any[]} personas @property {any[]} vlans
 */

/**
 * @typedef {Object} Auto Algo que se crea porque una fila lo menciona y no existe.
 * @property {string} key @property {string} tipo Qué es (sede, sala, rack, puesto, persona, servidor). @property {string} nombre
 * @property {number} orden Orden de creación (las sedes antes que las salas, etc.). @property {string[]} deps Otras creaciones de las que depende.
 * @property {(ref: (r: string|null) => string|null) => {col: string, rec: any}} fabricar
 */

/**
 * @typedef {Object} Res Resultado de validar una fila.
 * @property {boolean} vacia @property {Array<{k: string|null, m: string}>} errores @property {string[]} avisos
 * @property {string[]} autos Claves de lo que se crea por esta fila. @property {string} extra Dato calculado que se muestra en «Lista» (por ejemplo la U elegida).
 * @property {number} prioridad Orden de creación entre filas (los hosts antes que sus VM).
 * @property {null|((ref: (r: string|null) => string|null) => {col: string, rec: any, despues?: (creado: any, usuarioId: string, ref: (r: string|null) => string|null) => Promise<void>})} crear
 */

/** @typedef {{res: Res[], autos: Map<string, Auto>}} Analisis */

/**
 * @typedef {Object} TipoGrilla
 * @property {string} coleccion @property {string} titulo @property {string} bajada @property {[string, string]} unidad Singular y plural.
 * @property {Col[]} cols @property {(filas: Vals[], m: Mundo) => Analisis} analizar
 */

const NOTA_AUTO = 'Creado automáticamente desde «Cargar varios» porque una fila lo mencionaba y no existía. Completá sus datos y revisalo.';
const NOTA_SIN_SEDE = 'PARA REVISAR. Sede provisoria creada desde «Cargar varios»: agrupa las salas, racks y puestos que no decían a qué sede pertenecen. Pasá cada uno a su sede real y después dala de baja.';
/** Los motivos son los que muestra el historial; el de lo creado solo empieza igual que el de la planilla para aparecer en «creados automáticamente». */
const MOTIVO = 'Cargado desde «Cargar varios»';
const MOTIVO_AUTO = 'Creado automáticamente al importar desde «Cargar varios» (lo mencionaba una fila y no existía)';
const A_COMPLETAR = 'A completar';
const ALTO_RACK = 42;

/** Minúsculas, sin tildes y con los espacios juntos: para comparar nombres. @param {any} s */
const nrm = s => normalizar(String(s == null ? '' : s).trim()).replace(/\s+/g, ' ');

/** @param {Vals} v */
const filaVacia = v => Object.values(v).every(x => !String(x || '').trim());

// ---------------------------------------------------------------------------------------------
// Validación: piezas comunes
// ---------------------------------------------------------------------------------------------

/** @returns {Res} */
function nuevoRes() { return { vacia: false, errores: [], avisos: [], autos: [], extra: '', prioridad: 0, crear: null }; }

/** @param {Mundo} m @returns {Map<string, string>} IP → nombre del equipo que la usa. */
function ipsDeLaBase(m) {
  /** @type {Map<string, string>} */
  const r = new Map();
  for (const e of m.equipos) {
    const c = e.equipo_campos || {};
    for (const ip of [e.equipo_ip_gestion, c.router_ip_lan, c.firewall_ip_lan, c.servidor_ip_ilo_idrac]) if (ip) r.set(String(ip).trim(), e.equipo_nombre);
  }
  return r;
}

/**
 * Contexto de una validación: arma lo que hay que crear («autos») y resuelve referencias por nombre. Una instancia por pasada.
 * @param {Mundo} m
 */
function nuevoCtx(m) {
  /** @type {Map<string, Auto>} */
  const autos = new Map();
  /** @type {Map<string, any>} */
  const meta = new Map();
  /** @type {Res|null} */
  let cur = null;
  const usa = (/** @type {string} */ k) => { if (cur && !cur.autos.includes(k)) cur.autos.push(k); };
  const depDe = (/** @type {string|null} */ ref) => (ref && ref.startsWith('@') ? [ref.slice(1)] : []);
  const ubPorId = new Map(m.ubicaciones.map(u => [u.id, u]));

  /** @param {string} key @param {string} tipo @param {string} nombre @param {number} orden @param {string[]} deps @param {Auto['fabricar']} fabricar */
  function auto(key, tipo, nombre, orden, deps, fabricar) {
    if (!autos.has(key)) autos.set(key, { key, tipo, nombre, orden, deps, fabricar });
    usa(key);
    return '@' + key;
  }

  /** @param {string} id */
  function rutaDe(id) {
    const u = ubPorId.get(id);
    if (!u) return '?';
    const p = u.ubicacion_padre_id ? ubPorId.get(u.ubicacion_padre_id) : null;
    return p ? p.ubicacion_nombre + ' / ' + u.ubicacion_nombre : u.ubicacion_nombre;
  }

  /** @param {string} nombre */
  function sede(nombre) {
    const sin = nrm(nombre) === 'sin sede';
    return auto('sede|' + nrm(nombre), 'sede', sin ? 'Sin sede' : nombre, 1, [], () => ({ col: 'ubicaciones', rec: {
      organizacion_id: m.org, ubicacion_nombre: sin ? 'Sin sede' : nombre, ubicacion_tipo: 'sede', ubicacion_direccion: null, ubicacion_padre_id: null, ubicacion_notas: sin ? NOTA_SIN_SEDE : NOTA_AUTO } }));
  }
  /** La sede «Sin sede» (D-083): la que ya hay o la que se va a crear. @returns {string} */
  function sinSede() {
    const ex = m.ubicaciones.find(u => u.ubicacion_tipo === 'sede' && nrm(u.ubicacion_nombre) === 'sin sede');
    return ex ? ex.id : sede('Sin sede');
  }
  /** @param {string} nombre @param {string} sedeRef */
  function sala(nombre, sedeRef) {
    return auto('sala|' + sedeRef + '|' + nrm(nombre), 'sala', nombre, 2, depDe(sedeRef), ref => {
      const padre = ref(sedeRef);
      if (!padre) throw new Error('No se pudo crear la sede de «' + nombre + '».');
      return { col: 'ubicaciones', rec: { organizacion_id: m.org, ubicacion_nombre: nombre, ubicacion_tipo: 'sala', ubicacion_direccion: null, ubicacion_padre_id: padre, ubicacion_notas: NOTA_AUTO } };
    });
  }

  /**
   * Una sede o sala escrita: «Sala», «Sede» o «Sede / Sala». Lo que no existe se crea: un nombre suelto es una sala de «Sin sede»
   * (QC68-A); «Sede / Sala» crea la sede (si falta) y su sala.
   * @param {string} texto @returns {{ref?: string|null, aviso?: string, error?: string}}
   */
  function ubicacion(texto) {
    const partes = texto.split('/').map(s => s.trim()).filter(Boolean);
    if (!partes.length) return { ref: null };
    if (partes.length > 2) return { error: '«' + texto + '» tiene más de dos niveles: una sede y su sala se escriben «Sede / Sala».' };
    if (partes.length === 1) {
      const n = nrm(partes[0]);
      const ex = m.ubicaciones.filter(u => nrm(u.ubicacion_nombre) === n);
      if (ex.length === 1) return { ref: ex[0].id };
      if (ex.length > 1) return { error: 'Hay más de una sede o sala llamada «' + partes[0] + '»: escribila «Sede / Sala».' };
      if (n === 'sin sede') { const r = sinSede(); return { ref: r, aviso: r.startsWith('@') ? 'Sin sede no existe: se crea' : undefined }; }
      return { ref: sala(partes[0], sinSede()), aviso: partes[0] + ' no existe: se crea' };
    }
    const ns = nrm(partes[0]), nl = nrm(partes[1]);
    const sedes = m.ubicaciones.filter(u => u.ubicacion_tipo === 'sede' && nrm(u.ubicacion_nombre) === ns);
    if (sedes.length > 1) return { error: 'Hay más de una sede llamada «' + partes[0] + '».' };
    const sedeRef = sedes.length ? sedes[0].id : sede(partes[0]);
    const salaEx = sedes.length ? m.ubicaciones.find(u => u.ubicacion_tipo === 'sala' && u.ubicacion_padre_id === sedes[0].id && nrm(u.ubicacion_nombre) === nl) : null;
    if (salaEx) return { ref: salaEx.id };
    return { ref: sala(partes[1], sedeRef), aviso: partes[0] + ' / ' + partes[1] + ' no existe: se crea' };
  }

  /** @param {string} texto @param {string|null} ubicRef Donde crearlo si no existe. */
  function rack(texto, ubicRef) {
    const n = nrm(texto);
    const ex = m.racks.find(r => nrm(r.rack_nombre) === n);
    if (ex) return { ref: /** @type {string} */ (ex.id), total: /** @type {number} */ (ex.rack_unidades_total), ubic: /** @type {string} */ (ex.ubicacion_id), existente: true, aviso: undefined };
    const key = 'rack|' + n;
    const aviso = texto + ' no existe: se crea (' + ALTO_RACK + ' U)';
    if (autos.has(key)) { usa(key); return { ...meta.get(key), existente: false, aviso }; }
    const ub = ubicRef || sinSede();
    const ref = auto(key, 'rack', texto, 3, depDe(ub), r => {
      const u = r(ub);
      if (!u) throw new Error('No se pudo crear el lugar del rack «' + texto + '».');
      return { col: 'racks', rec: { organizacion_id: m.org, ubicacion_id: u, rack_nombre: texto, rack_unidades_total: ALTO_RACK, rack_profundidad: null, rack_notas: NOTA_AUTO } };
    });
    meta.set(key, { ref, total: ALTO_RACK, ubic: ub });
    return { ref, total: ALTO_RACK, ubic: ub, existente: false, aviso };
  }

  /** @param {string} texto */
  function puesto(texto) {
    const n = nrm(texto);
    const ex = m.puestos.find(p => nrm(p.puesto_nombre) === n);
    if (ex) return { ref: /** @type {string} */ (ex.id), ubic: /** @type {string} */ (ex.ubicacion_id), aviso: undefined };
    const key = 'puesto|' + n;
    const aviso = texto + ' no existe: se crea';
    if (autos.has(key)) { usa(key); return { ...meta.get(key), aviso }; }
    const ub = sinSede();
    const ref = auto(key, 'puesto', texto, 4, depDe(ub), r => {
      const u = r(ub);
      if (!u) throw new Error('No se pudo crear el lugar del puesto «' + texto + '».');
      return { col: 'puestos', rec: { organizacion_id: m.org, ubicacion_id: u, puesto_nombre: texto, puesto_boca_pared: null, puesto_notas: NOTA_AUTO } };
    });
    meta.set(key, { ref, ubic: ub });
    return { ref, ubic: ub, aviso };
  }

  /** @param {string} texto */
  function persona(texto) {
    const n = nrm(texto);
    const ex = m.personas.find(p => nrm(p.persona_nombre) === n);
    if (ex) return { ref: /** @type {string} */ (ex.id), baja: ex.persona_estado === 'baja', aviso: undefined };
    const key = 'persona|' + n;
    const aviso = texto + ' no existe: se crea';
    if (autos.has(key)) { usa(key); return { ref: '@' + key, baja: false, aviso }; }
    const ref = auto(key, 'persona', texto, 5, [], () => ({ col: 'personas', rec: {
      organizacion_id: m.org, persona_nombre: texto, persona_sector: null, puesto_id: null, persona_estado: 'activa', persona_notas: NOTA_AUTO } }));
    return { ref, baja: false, aviso };
  }

  /** @type {Map<string, Array<{id: string, rack_u_inicio: number|null, rack_u_alto: number|null}>>} */
  const ocup = new Map();
  for (const e of m.equipos) if (e.rack_id) { if (!ocup.has(e.rack_id)) ocup.set(e.rack_id, []); /** @type {any[]} */ (ocup.get(e.rack_id)).push({ id: e.id, rack_u_inicio: e.rack_u_inicio, rack_u_alto: e.rack_u_alto, nombre: e.equipo_nombre }); }
  const ocupDe = (/** @type {string} */ ref) => { if (!ocup.has(ref)) ocup.set(ref, []); return /** @type {any[]} */ (ocup.get(ref)); };

  return { autos, fila: (/** @type {Res} */ r) => { cur = r; }, ubicacion, rack, puesto, persona, sinSede, ocupDe, rutaDe, auto, usa, depDe };
}

/** @typedef {ReturnType<typeof nuevoCtx>} Ctx */

/** @param {Res} r @param {string|null} k @param {string} msg */
const err = (r, k, msg) => { r.errores.push({ k, m: msg }); };

/**
 * Marca y modelo en una sola celda: la primera palabra es la marca y el resto el modelo.
 * @param {string} t @returns {{marca: string|null, modelo: string|null}}
 */
function marcaYModelo(t) {
  const s = t.trim();
  if (!s) return { marca: null, modelo: null };
  const i = s.indexOf(' ');
  return i < 0 ? { marca: s, modelo: null } : { marca: s.slice(0, i), modelo: s.slice(i + 1).trim() || null };
}

/**
 * Nombre (obligatorio, único en la base y en la grilla) e IP (válida y única) de un equipo.
 * @param {Vals} v @param {Res} r @param {number} i @param {{nombresBase: Map<string, string>, vistoNombre: Map<string, number>, ipsBase: Map<string, string>, vistoIp: Map<string, number>}} d
 */
function nombreEIp(v, r, i, d) {
  const nombre = (v.nombre || '').trim();
  const ip = (v.ip || '').trim();
  if (!nombre) err(r, 'nombre', 'Falta el nombre');
  else {
    const n = nrm(nombre);
    if (d.nombresBase.has(n)) err(r, 'nombre', 'Ya hay un equipo llamado «' + d.nombresBase.get(n) + '»');
    else if (d.vistoNombre.has(n)) err(r, 'nombre', 'Nombre repetido (fila ' + d.vistoNombre.get(n) + ')');
    if (!d.vistoNombre.has(n)) d.vistoNombre.set(n, i + 1);
  }
  if (ip) {
    if (!ipValida(ip)) err(r, 'ip', 'La IP no es válida (ej. 10.20.0.68)');
    else if (d.ipsBase.has(ip)) err(r, 'ip', 'IP repetida: la usa ' + d.ipsBase.get(ip));
    else if (d.vistoIp.has(ip)) err(r, 'ip', 'IP repetida (fila ' + d.vistoIp.get(ip) + ')');
    if (ip && ipValida(ip) && !d.vistoIp.has(ip)) d.vistoIp.set(ip, i + 1);
  }
  return { nombre, ip: ip || null };
}

/** @param {Mundo} m */
function datosDeEquipos(m) {
  return { nombresBase: new Map(m.equipos.map(e => [nrm(e.equipo_nombre), e.equipo_nombre])), vistoNombre: /** @type {Map<string, number>} */ (new Map()),
    ipsBase: ipsDeLaBase(m), vistoIp: /** @type {Map<string, number>} */ (new Map()) };
}

/**
 * Rack y posición (U) de un equipo. «U» es un número («5») o un rango («5-6», el alto en U); vacía = la primera libre.
 * El lugar queda reservado para las filas siguientes. Devuelve lo necesario para armar el registro.
 * @param {Ctx} C @param {Vals} v @param {Res} r
 * @param {Array<() => void>} pendientes Asignaciones de U que se hacen al final, cuando las explícitas ya están reservadas.
 * @param {{ubicOk: boolean}} o `ubicOk`: la fila tiene columna «Sede / sala».
 * @returns {{ubic: string|null, rack: string|null, pos: {ini: number|null, alto: number|null}}}
 */
function lugarEnRack(C, v, r, pendientes, o) {
  const tr = (v.rack || '').trim(), tu = (v.u || '').trim(), ts = o.ubicOk ? (v.ubic || '').trim() : '';
  /** @type {string|null} */
  let ubic = null;
  if (ts) {
    const u = C.ubicacion(ts);
    if (u.error) err(r, 'ubic', u.error);
    else { ubic = u.ref || null; if (u.aviso) r.avisos.push(u.aviso); }
  }
  const pos = { ini: /** @type {number|null} */ (null), alto: /** @type {number|null} */ (null) };
  if (!tr) {
    if (tu) err(r, 'u', 'La posición (U) necesita un rack');
    return { ubic, rack: null, pos };
  }
  const rk = C.rack(tr, ubic);
  if (rk.aviso) r.avisos.push(rk.aviso);
  if (ubic && rk.existente && !ubic.startsWith('@') && ubic !== rk.ubic) err(r, 'ubic', 'El rack ' + tr + ' está en «' + C.rutaDe(rk.ubic) + '», no en «' + ts + '»');
  const lugar = C.ocupDe(rk.ref);
  let alto = 1;
  if (tu) {
    const x = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(tu);
    if (!x) err(r, 'u', 'La U es un número («5») o un rango («5-6»)');
    else {
      const ini = Number(x[1]), fin = x[2] ? Number(x[2]) : ini;
      alto = fin - ini + 1;
      if (ini < 1 || fin < ini) err(r, 'u', 'La U tiene que ser desde 1 y el rango de menor a mayor');
      else if (fin > rk.total) err(r, 'u', 'No entra: el rack ' + tr + ' tiene ' + rk.total + ' U');
      else {
        const pisa = lugar.find(e => e.rack_u_inicio != null && ini <= e.rack_u_inicio + (e.rack_u_alto || 1) - 1 && fin >= e.rack_u_inicio);
        if (pisa) err(r, 'u', 'Esas U ya las ocupa ' + (pisa.nombre || 'otro equipo') + ' (U' + pisa.rack_u_inicio + ')');
        else { pos.ini = ini; pos.alto = alto; lugar.push({ id: 'fila', rack_u_inicio: ini, rack_u_alto: alto, nombre: (v.nombre || '').trim() || 'otra fila' }); }
      }
    }
  } else {
    pos.alto = 1;
    pendientes.push(() => {
      if (r.errores.some(e => e.k === 'u')) return;
      const libre = primeraUnidadLibre(rk.total, lugar, 1);
      if (libre == null) { err(r, 'u', 'No hay U libre en el rack ' + tr); return; }
      pos.ini = libre;
      lugar.push({ id: 'fila', rack_u_inicio: libre, rack_u_alto: 1, nombre: (v.nombre || '').trim() || 'otra fila' });
      r.extra = 'U' + libre;
    });
  }
  return { ubic: rk.ubic, rack: rk.ref, pos };
}

/** @param {string} tipo @param {string} equipoId */
function puertoNuevo(tipo, equipoId, n) {
  return { equipo_id: equipoId, puerto_numero: n, puerto_nombre: null, puerto_tipo: 'rj45', puerto_velocidad: null, puerto_modo: tipo === 'switch' ? 'acceso' : null,
    vlan_nativa_id: null, vlans_etiquetadas: [], conectado_a_equipo_id: null, conectado_a_puerto_id: null, conectado_a_descripcion: null, enlace_isp_id: null, puesto_id: null,
    puerto_estado: 'libre', puerto_notas: null };
}

// ---------------------------------------------------------------------------------------------
// Tipo 1 · equipos de red
// ---------------------------------------------------------------------------------------------

/** Tipos que se cargan en la grilla de red: lo que se escribe → tipo. @type {Array<[string, string]>} */
const TIPOS_DE_RED = [['router', 'router'], ['firewall', 'firewall'], ['switch', 'switch'], ['access point', 'access_point'], ['access_point', 'access_point'], ['ap', 'access_point'],
  ['punto de acceso', 'access_point'], ['patchera', 'patchera'], ['ups', 'ups']];
/** Campo de `equipo_campos` donde va la cantidad de puertos, por tipo. @type {Object<string, string>} */
const CAMPO_DE_PUERTOS = { switch: 'switch_puertos_total', router: 'router_puertos_lan', firewall: 'firewall_interfaces_total', patchera: 'patchera_cantidad_bocas' };

/** @param {Vals[]} filas @param {Mundo} m @returns {Analisis} */
function analizarRed(filas, m) {
  const C = nuevoCtx(m);
  const d = datosDeEquipos(m);
  /** @type {Res[]} */
  const res = filas.map(() => nuevoRes());
  /** @type {Array<() => void>} */
  const pendientes = [];
  filas.forEach((v, i) => {
    const r = res[i];
    r.vacia = filaVacia(v);
    if (r.vacia) return;
    C.fila(r);
    const { nombre, ip } = nombreEIp(v, r, i, d);
    const tt = nrm(v.tipo);
    const par = TIPOS_DE_RED.find(x => x[0] === tt);
    if (!tt) err(r, 'tipo', 'Falta el tipo');
    else if (!par) err(r, 'tipo', 'Tipo «' + v.tipo.trim() + '» no válido (router, firewall, switch, access point, patchera, UPS)');
    const tipo = par ? par[1] : '';
    const { marca, modelo } = marcaYModelo(v.mm || '');
    let puertos = 0;
    if ((v.puertos || '').trim()) {
      if (!/^\d+$/.test(v.puertos.trim()) || Number(v.puertos) < 1 || Number(v.puertos) > 128) err(r, 'puertos', 'Los puertos son un número de 1 a 128');
      else puertos = Number(v.puertos);
    }
    const lugar = lugarEnRack(C, v, r, pendientes, { ubicOk: true });
    r.crear = ref => {
      const campos = { ...camposIniciales(tipo) };
      if (puertos && CAMPO_DE_PUERTOS[tipo]) campos[CAMPO_DE_PUERTOS[tipo]] = puertos;
      const rec = { organizacion_id: m.org, equipo_tipo: tipo, equipo_nombre: nombre, equipo_marca: marca, equipo_modelo: modelo, equipo_numero_serie: null, equipo_mac: null,
        equipo_ip_gestion: ip, ubicacion_id: ref(lugar.ubic), rack_id: ref(lugar.rack), rack_u_inicio: lugar.rack ? lugar.pos.ini : null, rack_u_alto: lugar.rack ? lugar.pos.alto : null,
        puesto_id: null, equipo_estado: 'en_uso', equipo_notas: null, equipo_campos: campos };
      if (lugar.rack && (!rec.rack_id || !rec.ubicacion_id)) throw new Error('No se pudo crear el rack «' + (v.rack || '').trim() + '».');
      if (!lugar.rack && (v.ubic || '').trim() && !rec.ubicacion_id) throw new Error('No se pudo crear la sede o sala «' + (v.ubic || '').trim() + '».');
      return { col: 'equipos', rec, despues: puertos ? async (creado, uid) => {
        for (let n = 1; n <= puertos; n++) await repositorio.guardar('puertos', puertoNuevo(tipo, creado.id, n), uid, { motivo: MOTIVO });
      } : undefined };
    };
  });
  for (const p of pendientes) p();
  return { res, autos: C.autos };
}

// ---------------------------------------------------------------------------------------------
// Tipo 2 · servidores
// ---------------------------------------------------------------------------------------------

/** @param {string} t @returns {boolean|null} true: VM; false: físico; null: no se entiende. */
function esVm(t) {
  const n = nrm(t);
  if (!n || ['fisico', 'servidor', 'fisica', 'f'].includes(n)) return false;
  if (['vm', 'virtual', 'maquina virtual', 'v'].includes(n)) return true;
  return null;
}

/** @param {Vals[]} filas @param {Mundo} m @returns {Analisis} */
function analizarServidores(filas, m) {
  const C = nuevoCtx(m);
  const d = datosDeEquipos(m);
  /** @type {Res[]} */
  const res = filas.map(() => nuevoRes());
  /** @type {Array<() => void>} */
  const pendientes = [];
  /** Host de cada máquina virtual que es otra fila de la grilla: fila → fila del host. @type {Map<number, number>} */
  const hostsEnGrilla = new Map();
  const vmBase = (/** @type {any} */ e) => !!(e.equipo_campos && e.equipo_campos.host_id);
  const hostsBase = new Map(m.equipos.filter(e => e.equipo_tipo === 'servidor' && !vmBase(e)).map(e => [nrm(e.equipo_nombre), e]));
  const vmsBase = new Set(m.equipos.filter(e => e.equipo_tipo === 'servidor' && vmBase(e)).map(e => nrm(e.equipo_nombre)));
  /** Servidores físicos y VM de la propia grilla (nombre → índice de fila). @type {Map<string, number>} */
  const fisicosGrilla = new Map();
  /** @type {Set<string>} */
  const vmsGrilla = new Set();
  filas.forEach((v, i) => {
    if (filaVacia(v) || !(v.nombre || '').trim()) return;
    const n = nrm(v.nombre);
    if (esVm(v.que || '')) vmsGrilla.add(n);
    else if (!fisicosGrilla.has(n)) fisicosGrilla.set(n, i);
  });
  filas.forEach((v, i) => {
    const r = res[i];
    r.vacia = filaVacia(v);
    if (r.vacia) return;
    C.fila(r);
    const { nombre, ip } = nombreEIp(v, r, i, d);
    const vm = esVm(v.que || '');
    if (vm === null) err(r, 'que', 'Escribí Físico o VM');
    const rol = (v.rol || '').trim(), so = (v.so || '').trim();
    if (!rol) err(r, 'rol', 'Falta el rol');
    if (!so) err(r, 'so', 'Falta el sistema operativo');
    const { marca, modelo } = marcaYModelo(v.mm || '');
    /** @type {string|null} */
    let hostRef = null;
    let lugar = { ubic: /** @type {string|null} */ (null), rack: /** @type {string|null} */ (null), pos: { ini: /** @type {number|null} */ (null), alto: /** @type {number|null} */ (null) } };
    if (vm) {
      r.prioridad = 1;
      const th = (v.host || '').trim();
      if ((v.rack || '').trim() || (v.u || '').trim()) err(r, 'rack', 'Una máquina virtual no va en un rack');
      if (!th) err(r, 'host', 'Falta el host de la máquina virtual');
      else {
        const n = nrm(th);
        if (hostsBase.has(n)) hostRef = hostsBase.get(n).id;
        else if (fisicosGrilla.has(n) && fisicosGrilla.get(n) !== i) { hostRef = '#' + fisicosGrilla.get(n); hostsEnGrilla.set(i, /** @type {number} */ (fisicosGrilla.get(n))); }
        else if (vmsBase.has(n) || vmsGrilla.has(n)) err(r, 'host', th + ' es una máquina virtual: el host tiene que ser un servidor físico');
        else {
          hostRef = C.auto('host|' + n, 'servidor', th, 6, [], () => ({ col: 'equipos', rec: {
            organizacion_id: m.org, equipo_tipo: 'servidor', equipo_nombre: th, equipo_marca: null, equipo_modelo: null, equipo_numero_serie: null, equipo_mac: null, equipo_ip_gestion: null,
            ubicacion_id: null, rack_id: null, rack_u_inicio: null, rack_u_alto: null, puesto_id: null, equipo_estado: 'en_uso', equipo_notas: NOTA_AUTO,
            equipo_campos: { servidor_rol: A_COMPLETAR, servidor_sistema_operativo: A_COMPLETAR, servidor_cpu: null, servidor_ram_gb: null, servidor_almacenamiento: null,
              servidor_virtualizacion: 'ninguna', servidor_ip_ilo_idrac: null, servidor_garantia_vence_en: null, host_id: null } } }));
          r.avisos.push(th + ' no existe: se crea');
        }
      }
    } else if (vm === false) lugar = lugarEnRack(C, v, r, pendientes, { ubicOk: false });
    r.crear = ref => {
      let hostId = null;
      if (vm) { hostId = ref(hostRef); if (!hostId) throw new Error('No se pudo crear el host «' + (v.host || '').trim() + '».'); }
      const rec = { organizacion_id: m.org, equipo_tipo: 'servidor', equipo_nombre: nombre, equipo_marca: marca, equipo_modelo: modelo, equipo_numero_serie: null, equipo_mac: null,
        equipo_ip_gestion: ip, ubicacion_id: ref(lugar.ubic), rack_id: ref(lugar.rack), rack_u_inicio: lugar.rack ? lugar.pos.ini : null, rack_u_alto: lugar.rack ? lugar.pos.alto : null,
        puesto_id: null, equipo_estado: 'en_uso', equipo_notas: null,
        equipo_campos: { servidor_rol: rol, servidor_sistema_operativo: so, servidor_cpu: null, servidor_ram_gb: null, servidor_almacenamiento: null, servidor_virtualizacion: 'ninguna',
          servidor_ip_ilo_idrac: null, servidor_garantia_vence_en: null, host_id: hostId } };
      if (lugar.rack && (!rec.rack_id || !rec.ubicacion_id)) throw new Error('No se pudo crear el rack «' + (v.rack || '').trim() + '».');
      return { col: 'equipos', rec };
    };
  });
  for (const p of pendientes) p();
  for (const [i, h2] of hostsEnGrilla) if (res[h2].errores.length) err(res[i], 'host', 'El host está en la fila ' + (h2 + 1) + ' y esa fila tiene un error');
  return { res, autos: C.autos };
}

// ---------------------------------------------------------------------------------------------
// Tipo 3 · equipos de escritorio
// ---------------------------------------------------------------------------------------------

/** @param {string} t @returns {string|null} */
function categoriaDeEscritorio(t) {
  const n = nrm(t);
  if (['pc de escritorio', 'pc', 'escritorio', 'desktop', 'computadora'].includes(n)) return 'PC de escritorio';
  if (['notebook', 'note', 'laptop', 'portatil'].includes(n)) return 'Notebook';
  return null;
}

/** @param {Vals[]} filas @param {Mundo} m @returns {Analisis} */
function analizarEscritorio(filas, m) {
  const C = nuevoCtx(m);
  const d = datosDeEquipos(m);
  /** @type {Res[]} */
  const res = filas.map(() => nuevoRes());
  filas.forEach((v, i) => {
    const r = res[i];
    r.vacia = filaVacia(v);
    if (r.vacia) return;
    C.fila(r);
    const { nombre, ip } = nombreEIp(v, r, i, d);
    const cat = categoriaDeEscritorio(v.cat || '');
    if (!(v.cat || '').trim()) err(r, 'cat', 'Falta la categoría');
    else if (!cat) err(r, 'cat', 'Categoría «' + v.cat.trim() + '» no válida (PC de escritorio o Notebook)');
    const { marca, modelo } = marcaYModelo(v.mm || '');
    const serie = (v.serie || '').trim() || null;
    /** @type {string|null} */ let puestoRef = null, puestoUbic = null, personaRef = null;
    const tp = (v.puesto || '').trim();
    if (tp) { const p = C.puesto(tp); puestoRef = p.ref; puestoUbic = p.ubic; if (p.aviso) r.avisos.push(p.aviso); }
    const ta = (v.asignado || '').trim();
    if (ta) {
      const p = C.persona(ta);
      if (p.baja) err(r, 'asignado', ta + ' está dada de baja: no se le puede asignar un equipo');
      else { personaRef = p.ref; if (p.aviso) r.avisos.push(p.aviso); }
    }
    r.crear = ref => {
      const puestoId = ref(puestoRef);
      if (tp && !puestoId) throw new Error('No se pudo crear el puesto «' + tp + '».');
      const personaId = ref(personaRef);
      if (ta && !personaId) throw new Error('No se pudo crear la persona «' + ta + '».');
      const rec = { organizacion_id: m.org, equipo_tipo: 'otro', equipo_nombre: nombre, equipo_marca: marca, equipo_modelo: modelo, equipo_numero_serie: serie, equipo_mac: null,
        equipo_ip_gestion: ip, ubicacion_id: puestoId ? ref(puestoUbic) : null, rack_id: null, rack_u_inicio: null, rack_u_alto: null, puesto_id: puestoId,
        equipo_estado: 'en_uso', equipo_notas: null, equipo_campos: { ...camposIniciales('otro'), otro_categoria: cat } };
      return { col: 'equipos', rec, despues: personaId ? async (creado, uid) => {
        await repositorio.asignarEquipo({ equipoId: creado.id, personaId, usuarioId: uid, motivo: MOTIVO });
      } : undefined };
    };
  });
  return { res, autos: C.autos };
}

// ---------------------------------------------------------------------------------------------
// Tipo 4 · puestos
// ---------------------------------------------------------------------------------------------

/** @param {Vals[]} filas @param {Mundo} m @returns {Analisis} */
function analizarPuestos(filas, m) {
  const C = nuevoCtx(m);
  const base = new Map(m.puestos.map(p => [nrm(p.puesto_nombre), p.puesto_nombre]));
  /** @type {Map<string, number>} */
  const visto = new Map();
  /** @type {Res[]} */
  const res = filas.map(() => nuevoRes());
  filas.forEach((v, i) => {
    const r = res[i];
    r.vacia = filaVacia(v);
    if (r.vacia) return;
    C.fila(r);
    const nombre = (v.nombre || '').trim();
    if (!nombre) err(r, 'nombre', 'Falta el nombre');
    else {
      const n = nrm(nombre);
      if (base.has(n)) err(r, 'nombre', 'Ya hay un puesto llamado «' + base.get(n) + '»');
      else if (visto.has(n)) err(r, 'nombre', 'Nombre repetido (fila ' + visto.get(n) + ')');
      if (!visto.has(n)) visto.set(n, i + 1);
    }
    /** @type {string|null} */ let ubic = null;
    const tu = (v.ubic || '').trim();
    if (!tu) err(r, 'ubic', 'Falta la sede o sala');
    else { const u = C.ubicacion(tu); if (u.error) err(r, 'ubic', u.error); else { ubic = u.ref || null; if (u.aviso) r.avisos.push(u.aviso); } }
    r.crear = ref => {
      const ub = ref(ubic);
      if (!ub) throw new Error('No se pudo crear la sede o sala «' + tu + '».');
      return { col: 'puestos', rec: { organizacion_id: m.org, ubicacion_id: ub, puesto_nombre: nombre, puesto_boca_pared: (v.boca || '').trim() || null, puesto_notas: (v.notas || '').trim() || null } };
    };
  });
  return { res, autos: C.autos };
}

// ---------------------------------------------------------------------------------------------
// Tipo 5 · personas
// ---------------------------------------------------------------------------------------------

/** @param {Vals[]} filas @param {Mundo} m @returns {Analisis} */
function analizarPersonas(filas, m) {
  const C = nuevoCtx(m);
  const base = new Map(m.personas.map(p => [nrm(p.persona_nombre), p.persona_nombre]));
  /** @type {Map<string, number>} */
  const visto = new Map();
  /** @type {Res[]} */
  const res = filas.map(() => nuevoRes());
  filas.forEach((v, i) => {
    const r = res[i];
    r.vacia = filaVacia(v);
    if (r.vacia) return;
    C.fila(r);
    const nom = (v.nombre || '').trim(), ape = (v.apellido || '').trim();
    const completo = (nom + ' ' + ape).trim();
    if (!nom) err(r, 'nombre', 'Falta el nombre');
    else {
      const n = nrm(completo);
      if (base.has(n)) err(r, 'nombre', 'Ya hay una persona llamada «' + base.get(n) + '»');
      else if (visto.has(n)) err(r, 'nombre', 'Persona repetida (fila ' + visto.get(n) + ')');
      if (!visto.has(n)) visto.set(n, i + 1);
    }
    const email = (v.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(r, 'email', 'El email no es válido');
    const te = nrm(v.estado || '');
    /** @type {'activa'|'baja'} */
    let estado = 'activa';
    if (['baja', 'en baja', 'inactiva', 'inactivo'].includes(te)) estado = 'baja';
    else if (te && !['activa', 'activo', 'alta', 'en actividad'].includes(te)) err(r, 'estado', 'Estado: Activa o En baja');
    /** @type {string|null} */ let puestoRef = null;
    const tp = (v.puesto || '').trim();
    if (tp) { const p = C.puesto(tp); puestoRef = p.ref; if (p.aviso) r.avisos.push(p.aviso); }
    r.crear = ref => {
      const pu = ref(puestoRef);
      if (tp && !pu) throw new Error('No se pudo crear el puesto «' + tp + '».');
      // El modelo no tiene un campo de email para las personas: queda en las notas hasta que se decida agregarlo.
      return { col: 'personas', rec: { organizacion_id: m.org, persona_nombre: completo, persona_sector: (v.sector || '').trim() || null, puesto_id: pu, persona_estado: estado,
        persona_notas: email ? 'Email: ' + email : null } };
    };
  });
  return { res, autos: C.autos };
}

// ---------------------------------------------------------------------------------------------
// Tipo 6 · VLAN
// ---------------------------------------------------------------------------------------------

/** @param {string} ip @returns {number|null} */
function ipANumero(ip) {
  if (!ipValida(ip)) return null;
  return ip.split('.').reduce((a, x) => a * 256 + Number(x), 0);
}
/** @param {string} t @returns {{base: number, tam: number}|null} */
function leerCidr(t) {
  const x = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(t.trim());
  if (!x || !ipValida(x[1]) || Number(x[2]) > 32) return null;
  const tam = Math.pow(2, 32 - Number(x[2]));
  return { base: Math.floor(/** @type {number} */ (ipANumero(x[1])) / tam) * tam, tam };
}

/** @param {Vals[]} filas @param {Mundo} m @returns {Analisis} */
function analizarVlan(filas, m) {
  const base = new Map(m.vlans.map(x => [x.vlan_numero, x.vlan_nombre]));
  /** @type {Map<number, number>} */
  const visto = new Map();
  /** @type {Res[]} */
  const res = filas.map(() => nuevoRes());
  filas.forEach((v, i) => {
    const r = res[i];
    r.vacia = filaVacia(v);
    if (r.vacia) return;
    const tn = (v.numero || '').trim();
    /** @type {number|null} */ let numero = null;
    if (!tn) err(r, 'numero', 'Falta el número de VLAN');
    else if (!/^\d+$/.test(tn) || Number(tn) < 1 || Number(tn) > 4094) err(r, 'numero', 'El número de VLAN va de 1 a 4094');
    else {
      numero = Number(tn);
      if (base.has(numero)) err(r, 'numero', 'Ya existe la VLAN ' + numero + ' («' + base.get(numero) + '»)');
      else if (visto.has(numero)) err(r, 'numero', 'VLAN repetida (fila ' + visto.get(numero) + ')');
      if (!visto.has(numero)) visto.set(numero, i + 1);
    }
    const nombre = (v.nombre || '').trim();
    if (!nombre) err(r, 'nombre', 'Falta el nombre');
    const cidr = (v.red || '').trim(), gw = (v.gateway || '').trim(), rango = (v.rango || '').trim();
    const red = cidr ? leerCidr(cidr) : null;
    if (cidr && !red) err(r, 'red', 'La red va en formato CIDR (10.10.20.0/24)');
    if (gw) {
      const g = ipANumero(gw);
      if (g == null) err(r, 'gateway', 'El gateway no es una IP válida');
      else if (red && (g < red.base || g >= red.base + red.tam)) err(r, 'gateway', 'El gateway no está dentro de la red ' + cidr);
    }
    const td = nrm(v.dhcp || '');
    let dhcp = !!rango;
    if (['si', 'activo', 'true'].includes(td)) dhcp = true;
    else if (td && !['no', 'inactivo', 'false'].includes(td)) err(r, 'dhcp', 'DHCP: Sí o No');
    else if (td === 'no' && rango) err(r, 'rango', 'Con DHCP en No no va rango');
    if (dhcp && !rango) err(r, 'rango', 'Con DHCP activo falta el rango (10.10.20.100 - 10.10.20.200)');
    if (rango) {
      const x = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*[-–]\s*(\d{1,3}(?:\.\d{1,3}){3})\s*$/.exec(rango);
      const a = x ? ipANumero(x[1]) : null, b = x ? ipANumero(x[2]) : null;
      if (a == null || b == null) err(r, 'rango', 'El rango es «IP inicial - IP final»');
      else if (a > b) err(r, 'rango', 'El rango empieza después de donde termina');
      else if (red && (a < red.base || b >= red.base + red.tam)) err(r, 'rango', 'El rango no está dentro de la red ' + cidr);
    }
    r.crear = () => ({ col: 'vlans', rec: { organizacion_id: m.org, vlan_numero: numero, vlan_nombre: nombre, vlan_red_cidr: cidr || null, vlan_gateway: gw || null,
      vlan_dhcp_activo: dhcp, vlan_dhcp_rango: dhcp ? rango || null : null, vlan_descripcion: null } });
  });
  return { res, autos: new Map() };
}

// ---------------------------------------------------------------------------------------------
// Definición de cada tipo de carga
// ---------------------------------------------------------------------------------------------

const AY_U = 'Posición en el rack: «5» o un rango «5-6» (alto en U). Vacía: se elige la primera U libre.';
const COL_NOMBRE = (/** @type {number} */ w) => ({ k: 'nombre', r: 'Nombre', req: true, w, alias: ['equipo', 'hostname', 'nombre del equipo', 'nombre y apellido'] });
const COL_MM = (/** @type {number} */ w) => ({ k: 'mm', r: 'Marca y modelo', w, alias: ['marca', 'modelo', 'marca/modelo', 'marca modelo'] });
const COL_RACK = (/** @type {number} */ w) => ({ k: 'rack', r: 'Rack', w, lista: 'racks' });
const COL_U = (/** @type {number} */ w) => ({ k: 'u', r: 'U', w, ayuda: AY_U, alias: ['posicion', 'posicion (u)', 'u inicial'] });
const COL_IP = (/** @type {number} */ w) => ({ k: 'ip', r: 'IP', w, alias: ['ip de gestion', 'direccion ip', 'ip gestion'] });

/** @type {Object<string, TipoGrilla>} */
const TIPOS = {
  equipos_red: {
    coleccion: 'equipos', titulo: 'Cargar varios equipos de red', unidad: ['equipo', 'equipos'], analizar: analizarRed,
    bajada: 'Router, firewall, switch, access point, patchera o UPS. Si ponés una cantidad de puertos, se crean los puertos del equipo.',
    cols: [COL_NOMBRE(140), { k: 'tipo', r: 'Tipo', req: true, w: 100, lista: 'tipos_red', alias: ['tipo de equipo'] }, COL_MM(140),
      { k: 'ubic', r: 'Sede / sala', w: 120, lista: 'ubicaciones', alias: ['sede', 'sala', 'ubicacion', 'sede/sala', 'lugar'] }, COL_RACK(85), COL_U(46), COL_IP(97),
      { k: 'puertos', r: 'Puertos', w: 66, alias: ['cantidad de puertos', 'bocas'], ayuda: 'Cantidad de puertos RJ45: se crean al cargar el equipo.' }]
  },
  servidores: {
    coleccion: 'equipos', titulo: 'Cargar varios servidores', unidad: ['servidor', 'servidores'], analizar: analizarServidores,
    bajada: 'Servidores físicos y máquinas virtuales. Una VM necesita su host (si todavía no está cargado, se crea).',
    cols: [COL_NOMBRE(115), { k: 'que', r: 'Físico / VM', w: 70, lista: 'que', alias: ['tipo', 'que es', 'fisico/vm'], ayuda: 'Vacía = servidor físico.' }, { k: 'host', r: 'Host', w: 100, lista: 'hosts', alias: ['host de la vm', 'hipervisor'], ayuda: 'Solo para máquinas virtuales.' },
      COL_MM(115), COL_RACK(75), COL_U(40), COL_IP(95),
      { k: 'so', r: 'Sistema operativo', req: true, w: 95, alias: ['so', 'sistema operativo', 'os'] }, { k: 'rol', r: 'Rol', req: true, w: 90, alias: ['funcion'] }]
  },
  escritorio: {
    coleccion: 'equipos', titulo: 'Cargar varios equipos de escritorio', unidad: ['equipo', 'equipos'], analizar: analizarEscritorio,
    bajada: 'PC de escritorio y notebooks. Si el puesto o la persona no existen, se crean.',
    cols: [COL_NOMBRE(120), { k: 'cat', r: 'Categoría', req: true, w: 105, lista: 'categorias', alias: ['categoria', 'tipo'] }, COL_MM(135),
      { k: 'serie', r: 'Serie', w: 95, alias: ['numero de serie', 'n/s', 'nro de serie', 'n de serie'] }, { k: 'puesto', r: 'Puesto', w: 95, lista: 'puestos', alias: ['puesto de trabajo'] },
      { k: 'asignado', r: 'Asignado a', w: 125, lista: 'personas', alias: ['persona', 'usuario', 'asignado'] }, COL_IP(100)]
  },
  puestos: {
    coleccion: 'puestos', titulo: 'Cargar varios puestos de trabajo', unidad: ['puesto', 'puestos'], analizar: analizarPuestos,
    bajada: 'Un puesto es el lugar donde llega una boca de pared. La VLAN de un puesto sale de a qué puerto de switch llega, no se carga acá.',
    cols: [{ k: 'nombre', r: 'Nombre', req: true, w: 200, alias: ['puesto', 'nombre del puesto'] }, { k: 'boca', r: 'Boca de pared', w: 130, alias: ['boca', 'boca de pared', 'toma'] },
      { k: 'ubic', r: 'Sede / sala', req: true, w: 220, lista: 'ubicaciones', alias: ['sede', 'sala', 'ubicacion', 'sede/sala', 'lugar'] }, { k: 'notas', r: 'Notas', w: 240 }]
  },
  personas: {
    coleccion: 'personas', titulo: 'Cargar varias personas', unidad: ['persona', 'personas'], analizar: analizarPersonas,
    bajada: 'Quienes trabajan en la organización. El email queda anotado en las notas de la persona.',
    cols: [{ k: 'nombre', r: 'Nombre', req: true, w: 130 }, { k: 'apellido', r: 'Apellido', w: 130 }, { k: 'sector', r: 'Sector', w: 130, lista: 'sectores', alias: ['area'] },
      { k: 'puesto', r: 'Puesto', w: 120, lista: 'puestos', alias: ['puesto habitual', 'puesto de trabajo'] }, { k: 'email', r: 'Email', w: 190, alias: ['correo', 'mail', 'e-mail', 'correo electronico'] },
      { k: 'estado', r: 'Estado', w: 90, lista: 'estado_persona' }]
  },
  vlans: {
    coleccion: 'vlans', titulo: 'Cargar varias VLAN', unidad: ['VLAN', 'VLAN'], analizar: analizarVlan,
    bajada: 'Número y nombre alcanzan; la red, el gateway y el DHCP se pueden completar después.',
    cols: [{ k: 'numero', r: 'Número', req: true, w: 70, alias: ['n', 'vlan', 'id', 'numero de vlan', 'vlan id'] }, { k: 'nombre', r: 'Nombre', req: true, w: 170 },
      { k: 'red', r: 'Red (CIDR)', w: 160, alias: ['red', 'cidr', 'subred', 'red cidr'], ayuda: 'Ej.: 10.10.20.0/24' }, { k: 'gateway', r: 'Gateway', w: 130, alias: ['puerta de enlace', 'gw'] },
      { k: 'dhcp', r: 'DHCP', w: 80, lista: 'dhcp' }, { k: 'rango', r: 'Rango DHCP', w: 190, alias: ['rango', 'rango dhcp'], ayuda: 'Ej.: 10.10.20.100 - 10.10.20.200' }]
  }
};

// ---------------------------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------------------------

/** Nombres que se ofrecen en las listas de sugerencias (se pueden escribir otros: lo que no existe se crea). @param {Mundo} m @returns {Object<string, string[]>} */
function listasDe(m) {
  const ord = (/** @type {string[]} */ a) => a.filter(Boolean).sort((x, y) => x.localeCompare(y, 'es', { numeric: true }));
  const cuenta = new Map();
  for (const u of m.ubicaciones) cuenta.set(nrm(u.ubicacion_nombre), (cuenta.get(nrm(u.ubicacion_nombre)) || 0) + 1);
  const porId = new Map(m.ubicaciones.map(u => [u.id, u]));
  const ubic = m.ubicaciones.map(u => {
    const p = u.ubicacion_padre_id ? porId.get(u.ubicacion_padre_id) : null;
    return p && cuenta.get(nrm(u.ubicacion_nombre)) > 1 ? p.ubicacion_nombre + ' / ' + u.ubicacion_nombre : u.ubicacion_nombre;
  });
  return {
    tipos_red: ['Router', 'Firewall', 'Switch', 'Access point', 'Patchera', 'UPS'], categorias: ['PC de escritorio', 'Notebook'], que: ['Físico', 'VM'], dhcp: ['No', 'Sí'], estado_persona: ['Activa', 'En baja'],
    ubicaciones: ord(ubic), racks: ord(m.racks.map(r => r.rack_nombre)), puestos: ord(m.puestos.map(p => p.puesto_nombre)), personas: ord(m.personas.filter(p => p.persona_estado !== 'baja').map(p => p.persona_nombre)),
    hosts: ord(m.equipos.filter(e => e.equipo_tipo === 'servidor' && !(e.equipo_campos && e.equipo_campos.host_id)).map(e => e.equipo_nombre)),
    sectores: ord(Array.from(new Set(m.personas.map(p => p.persona_sector).filter(Boolean))))
  };
}

/** @param {string} tipo @param {Object<string, any>} detalle */
function metrica(tipo, detalle) { window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo, detalle } })); }

/** @param {Mundo} m @returns {Promise<Mundo>} */
async function cargarMundo(m) {
  const org = m.org;
  const [equipos, racks, ubicaciones, puestos, personas, vlans] = await Promise.all(['equipos', 'racks', 'ubicaciones', 'puestos', 'personas', 'vlans'].map(c => repositorio.listar(c, { organizacion_id: org })));
  return { org, equipos, racks, ubicaciones, puestos, personas, vlans };
}

let contador = 0;

/**
 * Abre la grilla «Cargar varios» de un tipo. Resuelve con la cantidad de filas creadas cuando se cierra.
 * @param {'equipos_red'|'servidores'|'escritorio'|'puestos'|'personas'|'vlans'} tipo
 * @param {{organizacion_id: string, alTerminar?: (creados: number) => void}} o
 * @returns {Promise<number>}
 */
export async function abrirGrilla(tipo, o) {
  const cfg = TIPOS[tipo];
  const usuario = sesion.usuarioActual();
  if (!cfg || !usuario) return 0;
  const uid = usuario.id;
  const pref = 'gr' + (++contador) + '-';
  /** @type {Mundo} */
  let m = await cargarMundo({ org: o.organizacion_id, equipos: [], racks: [], ubicaciones: [], puestos: [], personas: [], vlans: [] });
  const cols = cfg.cols;

  /**
   * @typedef {Object} Fila
   * @property {Vals} vals @property {Set<string>} copia @property {Object<string, HTMLInputElement>} inputs @property {Object<string, HTMLElement>} celdas
   * @property {HTMLElement} tr @property {HTMLElement} num @property {HTMLElement} estado @property {string|null} falla
   */
  /** @type {Fila[]} */
  const filas = [];
  /** @type {Analisis} */
  let ultimo = { res: [], autos: new Map() };
  let creando = false, creadosTotal = 0, escUna = false;

  const tbody = h('tbody');
  const datalists = h('div', { hidden: 'hidden' });
  const pintarListas = () => {
    datalists.textContent = '';
    const l = listasDe(m);
    for (const k of Object.keys(l)) datalists.appendChild(h('datalist', { id: pref + k }, l[k].map(x => h('option', { value: x }))));
  };
  const aviso = h('div', { class: 'gr-aviso', role: 'status', hidden: 'hidden' });
  const mostrarAviso = (/** @type {string} */ t, /** @type {'ok'|'warn'|'bad'} */ c) => { aviso.textContent = t; aviso.className = 'gr-aviso ' + c; aviso.hidden = false; };
  const textoPie = h('span', { class: 'estado', role: 'status' });
  const btnCrear = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'primario', text: 'Crear' }));
  const btnCancelar = h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() });
  const hayDatos = () => filas.some(f => !filaVacia(f.vals));

  // ---- filas
  /** @param {Vals} [vals] */
  function agregarFila(vals) {
    /** @type {Fila} */
    const f = { vals: {}, copia: new Set(), inputs: {}, celdas: {}, tr: h('tr'), num: h('div', { text: '' }), estado: h('div', { class: 'gr-estado' }), falla: null };
    for (const c of cols) f.vals[c.k] = vals && vals[c.k] ? vals[c.k] : '';
    const tdN = h('td', { class: 'gr-n' }, [f.num]);
    f.tr.appendChild(tdN);
    for (const c of cols) {
      const inp = /** @type {HTMLInputElement} */ (h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'data-k': c.k, list: c.lista ? pref + c.lista : null }));
      inp.value = f.vals[c.k];
      f.inputs[c.k] = inp;
      const td = h('td', null, [inp]);
      f.celdas[c.k] = td;
      f.tr.appendChild(td);
    }
    f.tr.appendChild(h('td', { class: 'gr-td-estado' }, [f.estado]));
    f.tr.appendChild(h('td', { class: 'gr-td-x' }, [h('button', { type: 'button', class: 'gr-x', tabindex: '-1', title: 'Quitar esta fila', 'aria-label': 'Quitar fila', text: '×', onclick: () => quitarFila(f) })]));
    filas.push(f);
    tbody.appendChild(f.tr);
    renumerar();
    return f;
  }
  function renumerar() {
    filas.forEach((f, i) => {
      f.num.textContent = String(i + 1);
      for (const c of cols) f.inputs[c.k].setAttribute('aria-label', c.r + ', fila ' + (i + 1));
    });
  }
  function asegurarFilaVacia() {
    if (!filas.length || !filaVacia(filas[filas.length - 1].vals)) agregarFila();
  }
  /** @param {Fila} f */
  function quitarFila(f) {
    if (creando) return;
    const i = filas.indexOf(f);
    if (i < 0) return;
    filas.splice(i, 1);
    f.tr.remove();
    asegurarFilaVacia();
    renumerar();
    revalidar();
  }

  // ---- validación y pie
  function revalidar() {
    ultimo = cfg.analizar(filas.map(f => f.vals), m);
    filas.forEach((f, i) => {
      const r = ultimo.res[i];
      if (f.falla && !r.vacia) r.errores.push({ k: null, m: f.falla });
      pintarEstado(f, r);
    });
    pintarPie();
  }
  /** @param {Fila} f @param {Res} r */
  function pintarEstado(f, r) {
    const claves = new Set(r.errores.map(e => e.k));
    for (const c of cols) f.celdas[c.k].classList.toggle('err', claves.has(c.k));
    f.estado.className = 'gr-estado';
    f.estado.removeAttribute('title');
    if (r.vacia) { f.estado.textContent = ''; return; }
    if (r.errores.length) {
      f.estado.textContent = r.errores[0].m + (r.errores.length > 1 ? ' (+' + (r.errores.length - 1) + ')' : '');
      f.estado.title = r.errores.map(e => e.m).join('\n');
      f.estado.classList.add('bad');
    } else if (r.avisos.length) {
      f.estado.textContent = r.avisos.join('; ');
      f.estado.title = r.avisos.join('\n') + (r.extra ? '\n' + r.extra : '');
      f.estado.classList.add('warn');
    } else {
      f.estado.textContent = '✓ Lista' + (r.extra ? ' · ' + r.extra : '');
      f.estado.classList.add('ok');
    }
  }
  /** Claves de lo que hay que crear para las filas listas, con lo que necesita cada cosa. */
  function autosNecesarios() {
    /** @type {Set<string>} */
    const s = new Set();
    const agregar = (/** @type {string} */ k) => { if (s.has(k)) return; const a = ultimo.autos.get(k); if (!a) return; s.add(k); a.deps.forEach(agregar); };
    ultimo.res.forEach(r => { if (!r.vacia && !r.errores.length) r.autos.forEach(agregar); });
    return s;
  }
  function resumenFilas() {
    const llenas = ultimo.res.filter(r => !r.vacia);
    const conError = llenas.filter(r => r.errores.length).length;
    return { n: llenas.length, conError, listas: llenas.length - conError };
  }
  function pintarPie() {
    const { n, conError, listas } = resumenFilas();
    const necesarios = Array.from(autosNecesarios()).map(k => /** @type {Auto} */ (ultimo.autos.get(k)));
    /** @type {Map<string, number>} */
    const porTipo = new Map();
    for (const a of necesarios) porTipo.set(a.tipo, (porTipo.get(a.tipo) || 0) + 1);
    const detalle = Array.from(porTipo).map(([t, c]) => c + ' ' + (c === 1 ? t : t === 'sede' ? 'sedes' : t === 'sala' ? 'salas' : t + 's')).join(', ');
    textoPie.textContent = n + (n === 1 ? ' fila' : ' filas') + ' · ' + conError + ' con error · ' + necesarios.length + ' para crear' + (detalle ? ' (' + detalle + ')' : '');
    btnCrear.textContent = creando ? 'Creando…' : listas ? 'Crear ' + listas + ' ' + cfg.unidad[listas === 1 ? 0 : 1] : 'Crear';
    btnCrear.disabled = creando || listas === 0;
    btnCancelar.textContent = creadosTotal > 0 && n === 0 ? 'Cerrar' : 'Cancelar';
  }

  // ---- movimiento y teclado
  /** @param {number} i @param {string} k */
  function irA(i, k) {
    if (i < 0) return;
    while (i >= filas.length) agregarFila();
    const inp = filas[i].inputs[k];
    inp.focus();
    inp.select();
  }
  /** @param {EventTarget|null} t */
  function ubicar(t) {
    if (!(t instanceof HTMLInputElement) || !t.dataset.k) return null;
    const tr = t.closest('tr');
    const i = filas.findIndex(f => f.tr === tr);
    return i < 0 ? null : { i, k: t.dataset.k, inp: t, f: filas[i] };
  }
  tbody.addEventListener('keydown', ev => {
    const u = ubicar(ev.target);
    if (!u) return;
    const ci = cols.findIndex(c => c.k === u.k);
    if (ev.key === 'Enter') { ev.preventDefault(); irA(u.i + 1, u.k); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); irA(u.i + 1, u.k); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); irA(u.i - 1, u.k); }
    else if (ev.key === 'ArrowLeft' && u.inp.selectionStart === 0 && u.inp.selectionEnd === 0 && ci > 0) { ev.preventDefault(); irA(u.i, cols[ci - 1].k); }
    else if (ev.key === 'ArrowRight' && u.inp.selectionStart === u.inp.value.length && u.inp.selectionEnd === u.inp.value.length && ci < cols.length - 1) { ev.preventDefault(); irA(u.i, cols[ci + 1].k); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      if (u.i === 0) return;
      const arriba = filas[u.i - 1].vals[u.k];
      u.inp.value = arriba; u.f.vals[u.k] = arriba; u.f.falla = null;
      u.f.copia.add(u.k); u.f.celdas[u.k].classList.add('copia');
      asegurarFilaVacia(); revalidar();
    }
  });
  tbody.addEventListener('input', ev => {
    const u = ubicar(ev.target);
    if (!u) return;
    u.f.vals[u.k] = u.inp.value;
    u.f.falla = null;
    if (u.f.copia.delete(u.k)) u.f.celdas[u.k].classList.remove('copia');
    asegurarFilaVacia();
  });
  tbody.addEventListener('focusout', () => { revalidar(); });
  tbody.addEventListener('focusin', ev => { const u = ubicar(ev.target); if (u) u.inp.select(); });

  // ---- pegar desde Excel
  /** @param {string} t */
  const desc = t => { const s = t.replace(/\r$/, ''); return s.length > 1 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s; };
  /** @param {string} t @returns {string|null} */
  const colPorNombre = t => {
    const n = nrm(t.replace(/\*/g, ''));
    if (!n) return null;
    const c = cols.find(x => nrm(x.r) === n || (x.alias || []).some(a => nrm(a) === n));
    return c ? c.k : null;
  };
  tbody.addEventListener('paste', ev => {
    const u = ubicar(ev.target);
    if (!u) return;
    const texto = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
    const limpio = texto.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!/[\t\n]/.test(limpio)) return; // un solo valor: pega como siempre
    ev.preventDefault();
    const matriz = limpio.split('\n').map(l => l.split('\t').map(desc));
    const claves = matriz[0].map(colPorNombre);
    const aciertos = claves.filter(Boolean).length;
    const conEncabezado = aciertos >= 1 && aciertos >= Math.ceil(matriz[0].length / 2) && (aciertos >= 2 || matriz[0].length === 1);
    const datos = conEncabezado ? matriz.slice(1) : matriz;
    const ci = cols.findIndex(c => c.k === u.k);
    datos.forEach((celdas, t) => {
      const f = filas[u.i + t] || agregarFila();
      celdas.forEach((valor, j) => {
        const k = conEncabezado ? claves[j] : (cols[ci + j] || { k: null }).k;
        if (!k) return;
        f.vals[k] = valor.trim(); f.inputs[k].value = valor.trim(); f.falla = null;
        if (f.copia.delete(k)) f.celdas[k].classList.remove('copia');
      });
    });
    asegurarFilaVacia();
    revalidar();
    toast('Pegaste ' + datos.length + (datos.length === 1 ? ' fila' : ' filas') + (conEncabezado ? ' (columnas por nombre)' : '') + '.');
  });

  // ---- crear
  async function crear() {
    if (creando) return;
    revalidar();
    const { n, listas } = resumenFilas();
    if (!listas) return;
    creando = true;
    aviso.hidden = true;
    btnCrear.disabled = true;
    pintarPie();
    const { res, autos } = ultimo;
    const necesarios = autosNecesarios();
    /** @type {Map<string, string>} */
    const idsAuto = new Map();
    /** @type {Map<string, string>} */
    const idsFila = new Map();
    const ref = (/** @type {string|null} */ r) => (r == null ? null : r.startsWith('@') ? idsAuto.get(r.slice(1)) || null : r.startsWith('#') ? idsFila.get(r.slice(1)) || null : r);
    /** @type {Set<string>} */
    const autosFallidos = new Set();
    let autosCreados = 0, filasCreadas = 0;
    /** @type {string[]} */
    const avisosFinales = [];
    for (const a of Array.from(necesarios).map(k => /** @type {Auto} */ (autos.get(k))).sort((x, y) => x.orden - y.orden)) {
      try {
        if (a.deps.some(dp => autosFallidos.has(dp))) throw new Error('Falta algo de lo que depende.');
        const { col, rec } = a.fabricar(ref);
        const c = await repositorio.guardar(col, rec, uid, { motivo: MOTIVO_AUTO });
        idsAuto.set(a.key, c.id);
        autosCreados++;
      } catch (e) {
        autosFallidos.add(a.key);
        avisosFinales.push('No se pudo crear ' + a.tipo + ' «' + a.nombre + '»: ' + (e instanceof Error ? e.message : 'error'));
      }
    }
    const orden = res.map((r, i) => ({ r, i })).filter(x => !x.r.vacia && !x.r.errores.length).sort((a, b) => a.r.prioridad - b.r.prioridad || a.i - b.i);
    /** @type {Set<Fila>} */
    const creadas = new Set();
    for (const { r, i } of orden) {
      const f = filas[i];
      try {
        const falto = r.autos.find(k => autosFallidos.has(k));
        if (falto) throw new Error('No se pudo crear «' + (autos.get(falto) || { nombre: falto }).nombre + '».');
        if (!r.crear) continue;
        const { col, rec, despues } = r.crear(ref);
        const c = await repositorio.guardar(col, rec, uid, { motivo: MOTIVO });
        idsFila.set(String(i), c.id);
        creadas.add(f);
        filasCreadas++;
        if (despues) {
          try { await despues(c, uid, ref); }
          catch (e) { avisosFinales.push('«' + (f.vals.nombre || '') + '» se creó pero falló un paso: ' + (e instanceof Error ? e.message : 'error')); }
        }
      } catch (e) {
        f.falla = 'No se pudo crear: ' + (e instanceof Error ? e.message : 'error');
      }
    }
    creadosTotal += filasCreadas;
    for (const f of creadas) { const i = filas.indexOf(f); if (i >= 0) filas.splice(i, 1); f.tr.remove(); }
    asegurarFilaVacia();
    renumerar();
    m = await cargarMundo(m);
    pintarListas();
    creando = false;
    revalidar();
    const quedan = resumenFilas();
    mostrarAviso('Se crearon ' + filasCreadas + ' ' + cfg.unidad[filasCreadas === 1 ? 0 : 1] + (autosCreados ? ' y ' + autosCreados + (autosCreados === 1 ? ' cosa más que no existía' : ' cosas más que no existían') : '') + '.'
      + (quedan.n ? ' Quedaron ' + quedan.n + (quedan.n === 1 ? ' fila' : ' filas') + ' con error para corregir.' : '') + (avisosFinales.length ? ' ' + avisosFinales.join(' ') : ''),
      quedan.n || avisosFinales.length ? 'warn' : 'ok');
    toast(filasCreadas + ' ' + cfg.unidad[filasCreadas === 1 ? 0 : 1] + (filasCreadas === 1 ? ' creado.' : ' creados.'));
    metrica('grilla_crear', { coleccion: cfg.coleccion, filas: n, creados: filasCreadas, conError: n - filasCreadas, creadosAutomaticamente: autosCreados });
    const primera = filas.find(f => !filaVacia(f.vals)) || filas[filas.length - 1];
    primera.inputs[cols[0].k].focus();
  }
  btnCrear.addEventListener('click', crear);

  // ---- armado de la ventana
  const encabezados = h('tr', null, [h('th', { class: 'gr-n', text: '#' }), ...cols.map(c => h('th', { text: c.r + (c.req ? ' *' : ''), title: c.ayuda || null })), h('th', { text: 'Estado' }), h('th', { class: 'gr-td-x' })]);
  const tabla = h('table', { class: 'gr-tabla' }, [
    h('colgroup', null, [h('col', { style: 'width:34px' }), ...cols.map(c => h('col', { style: 'width:' + c.w + 'px' })), h('col', { style: 'width:200px' }), h('col', { style: 'width:28px' })]),
    h('thead', null, [encabezados]), tbody]);
  const caja = h('div', { class: 'gr-modal', role: 'dialog', 'aria-label': cfg.titulo }, [
    h('div', { class: 'gr-cab' }, [h('h2', { text: cfg.titulo }), h('p', { text: 'Escribí como en una planilla: Tab avanza, Enter baja, Ctrl+D copia la celda de arriba. Podés pegar filas desde Excel. ' + cfg.bajada })]),
    h('div', { class: 'gr-cuerpo' }, [aviso, tabla, datalists]),
    h('div', { class: 'gr-pie' }, [textoPie, h('span', { class: 'esp' }), btnCancelar, btnCrear])]);

  // Esc o un clic en el fondo no tiran lo escrito sin avisar.
  caja.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') { escUna = false; return; }
    if (!hayDatos() || escUna) return;
    ev.stopPropagation(); ev.preventDefault();
    escUna = true;
    mostrarAviso('Hay filas sin crear. Tocá Esc otra vez para descartarlas, o seguí cargando.', 'warn');
  });
  const velo = document.getElementById('velo');
  /** @param {Event} ev */
  const vetarFondo = ev => {
    if (ev.target !== velo || !hayDatos() || nivelSuperior()) return;
    ev.stopImmediatePropagation();
    mostrarAviso('Hay filas sin crear. Usá «Cancelar» si querés descartarlas.', 'warn');
  };
  /** Otro diálogo encima (no pasa hoy desde la grilla): no se veta nada. */
  const nivelSuperior = () => !!document.querySelector('.velo-apilado');
  if (velo) velo.addEventListener('click', vetarFondo, true);

  pintarListas();
  agregarFila(); agregarFila(); agregarFila();
  revalidar();
  metrica('grilla_abierta', { coleccion: cfg.coleccion, tipo });

  return new Promise(resolver => {
    abrirModal(caja, () => {
      if (velo) velo.removeEventListener('click', vetarFondo, true);
      if (creadosTotal > 0 && o.alTerminar) o.alTerminar(creadosTotal);
      resolver(creadosTotal);
    });
    filas[0].inputs[cols[0].k].focus();
  });
}

/**
 * Botón «Cargar varios» para poner al lado de «Nuevo …»: abre la grilla y, si se creó algo, vuelve a dibujar la pantalla.
 * @param {'equipos_red'|'servidores'|'escritorio'|'puestos'|'personas'|'vlans'} tipo @param {string} org
 */
export function botonCargarVarios(tipo, org) {
  return h('button', { type: 'button', text: 'Cargar varios', title: 'Cargar muchas filas a la vez, como en una planilla', onclick: () => { abrirGrilla(tipo, { organizacion_id: org, alTerminar: () => ir(location.hash) }); } });
}
