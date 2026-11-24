// @ts-check
/**
 * Asistente de consultas (D-063, D-065). Botón flotante con un panel de preguntas y respuestas cortas.
 *  - Opción A (siempre): intérprete de preguntas en español por patrones. La respuesta sale SIEMPRE del repositorio,
 *    con los mismos permisos del usuario (`puede`), y cada dato enlaza a su ficha.
 *  - Opción B (si el navegador la tiene): `LanguageModel` (IA integrada de Chrome) solo traduce una pregunta libre a una
 *    de las intenciones de A. Nunca redacta datos ni recibe datos: solo la pregunta del usuario y la lista de intenciones.
 * Nunca muestra contraseñas ni claves: para eso enlaza a la ficha de la credencial («Mostrar» / «Pedir acceso»).
 * La conversación vive solo en memoria. Nada sale del navegador.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede, puedeVerSecreto, puedePedirSecreto } from './permisos.js';
import { modalAbierto } from './marco.js';
import { h, icono, normalizar, hoyISO, fmtFecha, diasHasta, diasDesde, textoHace, textoVence } from './utiles.js';

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

/** @typedef {{t: string, href?: string}} Parte */
/** @typedef {{partes: Parte[], detalle?: string, orgId?: string|null}} Item */
/** @typedef {{texto: string, items?: Item[], mas?: number}} Grupo */
/** @typedef {{grupos: Grupo[], nota?: string, enlace?: Parte}} Respuesta */
/** @typedef {'ip'|'conexion'|'vence'|'asignado_a'|'equipos_de'|'licencias'|'sin_verificar'|'contrasena'} Intencion */
/** @typedef {{intencion: Intencion, objeto: string, puesto?: string, dias?: number, ventana?: string, filtro?: string, ilo?: boolean}} Interpretacion */
/**
 * @typedef {Object} Ctx
 * @property {import('./modelos.js').UsuarioSesion} u
 * @property {string|null} org Organización abierta (o la propia); null = todas las que el usuario ve.
 * @property {Map<string, string>} orgs id → nombre
 * @property {(modulo: any, orgId: string|null|undefined) => boolean} veo
 * @property {(coleccion: string) => Promise<any[]>} listar Lectura memoizada por pregunta.
 */

const INTENCIONES = /** @type {Intencion[]} */ (['ip', 'conexion', 'vence', 'asignado_a', 'equipos_de', 'licencias', 'sin_verificar', 'contrasena']);
const AVISO_SIN_IA = 'Respuestas exactas para las preguntas sugeridas; en Chrome con IA integrada entiende más formas de preguntar.';
const TOPE = 10;

// ---------------------------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------------------------

const STOP = new Set(('que cual cuales quien quienes cuanto cuantos cuantas como donde es son esta estan está estas este esto el la los las lo un una unos unas de del al a en con por para y o se me mi su sus ' +
  'tiene tienen tengo hay ver dame decime dime mostra mostrame muestra mostrar buscar busca busco necesito quiero saber dato datos informacion info ' +
  'equipo equipos pc maquina dispositivo ip ips direccion direcciones numero nro n').split(/\s+/));

/** Pregunta normalizada: sin tildes, mayúsculas ni signos de pregunta. @param {string} s */
function limpiar(s) {
  return normalizar(s).replace(/[¿?¡!«»"“”,;:()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Palabras con contenido de una pregunta limpia. @param {string} norm @param {string[]} [extraStop] */
function palabrasDe(norm, extraStop) {
  const extra = new Set(extraStop || []);
  return norm.split(' ').map(p => p.replace(/\.+$/, '')).filter(p => p && !STOP.has(p) && !extra.has(p));
}

/** @param {string} s */
const hay = s => s.length > 0;

// ---------------------------------------------------------------------------------------------
// Enlaces a las fichas y módulos de permisos
// ---------------------------------------------------------------------------------------------

/** Ruta de la ficha. Acepta un registro o un resultado de búsqueda. @param {string} coleccion @param {any} r */
function ruta(coleccion, r) {
  switch (coleccion) {
    case 'equipos': return (r.equipo_tipo === 'servidor' || r.tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + r.id;
    case 'credenciales': return '#/credencial/' + r.id;
    case 'racks': return '#/rack/' + r.id;
    case 'configuraciones': return '#/config/' + r.id;
    case 'vlans': return '#/vlan/' + r.id;
    case 'redes_wifi': return '#/wifi/' + r.id;
    case 'puestos': return '#/puesto/' + r.id;
    case 'puertos': return '#/equipo/' + (r.equipo_id) + '/puertos/' + (r.puerto_numero);
    case 'personas': return '#/persona/' + r.id;
    case 'cuentas_dominio': return '#/cuenta/' + r.id;
    case 'licencias': return '#/licencia/' + r.id;
    case 'mapeos_disco': return '#/mapeo/' + r.id;
    case 'servicios': return '#/servicio/' + r.id;
    case 'tramos': return '#/tramo/' + r.id;
    case 'enlaces_isp': return '#/red/isp';
    default: return '#/inicio';
  }
}

/** Módulo de permisos de un registro. @param {string} coleccion @param {any} r */
function moduloDe(coleccion, r) {
  switch (coleccion) {
    case 'equipos': return r.equipo_tipo === 'servidor' ? 'servidores' : 'red';
    case 'credenciales': return 'credenciales';
    case 'racks': return 'racks';
    case 'configuraciones': case 'mapeos_disco': case 'servicios': return 'configuraciones';
    case 'personas': case 'cuentas_dominio': return 'personas';
    case 'licencias': return 'licencias';
    default: return 'red';
  }
}

/** Título legible de un registro. @param {string} coleccion @param {any} r */
function titulo(coleccion, r) {
  switch (coleccion) {
    case 'equipos': return r.equipo_nombre;
    case 'credenciales': return r.credencial_nombre;
    case 'racks': return r.rack_nombre;
    case 'configuraciones': return r.configuracion_titulo;
    case 'vlans': return 'VLAN ' + r.vlan_numero + ' · ' + r.vlan_nombre;
    case 'redes_wifi': return 'Wi-Fi ' + r.wifi_ssid;
    case 'enlaces_isp': return 'Enlace ' + r.enlace_proveedor;
    case 'puestos': return 'Puesto ' + r.puesto_nombre;
    case 'personas': return r.persona_nombre;
    case 'cuentas_dominio': return r.cuenta_dominio + '\\' + r.cuenta_usuario;
    case 'licencias': return r.licencia_producto;
    case 'mapeos_disco': return r.mapeo_letra + ' ' + r.mapeo_ruta;
    default: {
      const k = Object.keys(r).find(x => /_(nombre|titulo|producto)$/.test(x));
      return k ? r[k] : r.id;
    }
  }
}

/** @param {string} texto @param {string} [href] @param {string} [detalle] @param {string|null} [orgId] @returns {Item} */
const item = (texto, href, detalle, orgId) => ({ partes: [{ t: texto, href }], detalle, orgId });

// ---------------------------------------------------------------------------------------------
// Contexto y búsqueda
// ---------------------------------------------------------------------------------------------

/** @returns {Promise<Ctx|null>} */
async function crearContexto() {
  const u = sesion.usuarioActual();
  if (!u) return null;
  const org = sesion.organizacionActiva();
  const orgs = new Map((await repositorio.listar('organizaciones')).map(o => [o.id, o.organizacion_nombre]));
  /** @type {Map<string, Promise<any[]>>} */
  const memo = new Map();
  return {
    u, org, orgs,
    veo: (modulo, orgId) => puede(u, 'ver', modulo, orgId) && (!org || orgId === org),
    listar: coleccion => {
      let p = memo.get(coleccion);
      if (!p) { p = repositorio.listar(coleccion).catch(() => []); memo.set(coleccion, p); }
      return p;
    }
  };
}

/**
 * Búsqueda global con los permisos del usuario y la organización abierta. Si no hay resultados con todas las palabras,
 * prueba sacando una por vez (las preguntas traen palabras de más).
 * @param {Ctx} ctx @param {string[]} palabras
 * @returns {Promise<import('./repositorio.js').ResultadoBusqueda[]>}
 */
async function buscarFlexible(ctx, palabras) {
  if (!palabras.length) return [];
  const permitido = (/** @type {any} */ d) => ctx.veo(d.modulo, d.organizacion_id);
  /** Si algún título contiene todas las palabras, quedan solo esos (SRV-01 y no las VM que corren en él). @param {any[]} lista */
  const mejores = lista => { if (!palabras.some(p => /\d/.test(p))) return lista; const t = lista.filter(x => palabras.every(p => normalizar(x.titulo).includes(p))); return t.length ? t : lista; };
  let r = mejores(await repositorio.buscar(palabras.join(' '), { permitido }));
  if (r.length || palabras.length < 2) return r;
  const vistos = new Set();
  for (let i = palabras.length - 1; i >= 0; i--) {
    const sub = palabras.filter((_, j) => j !== i);
    for (const x of await repositorio.buscar(sub.join(' '), { permitido })) if (!vistos.has(x.clave)) { vistos.add(x.clave); r.push(x); }
    if (r.length) break;
  }
  return r;
}

/** @param {Item[]} items @param {number} [tope] @returns {Grupo['items']} */
const recortar = (items, tope) => items.slice(0, tope || TOPE);

/** @param {string} texto @param {Item[]} items @param {number} [tope] @returns {Grupo} */
function grupo(texto, items, tope) { return { texto, items: recortar(items, tope), mas: Math.max(0, items.length - (tope || TOPE)) }; }

// ---------------------------------------------------------------------------------------------
// Intérprete A: pregunta → intención
// ---------------------------------------------------------------------------------------------

/**
 * @param {string} pregunta
 * @returns {Interpretacion|null}
 */
function interpretar(pregunta) {
  const n = limpiar(pregunta);
  if (!n) return null;

  // Contraseñas y claves: nunca se muestran.
  if (/\b(contrasena|contrasenas|password|clave|claves|pass|secreto)\b/.test(n) && !/\blicencias?\b.*\b(excedid|vencid)/.test(n)) {
    return { intencion: 'contrasena', objeto: palabrasDe(n, ['contrasena', 'contrasenas', 'password', 'clave', 'claves', 'pass', 'secreto', 'credencial']).join(' ') };
  }
  // Licencias excedidas / vencidas
  if (/\blicencias?\b/.test(n) && /(excedid|sobrepas|de mas|pasad|vencid)/.test(n)) {
    const exc = /(excedid|sobrepas|de mas)/.test(n), ven = /vencid/.test(n);
    return { intencion: 'licencias', objeto: '', filtro: exc && !ven ? 'excedidas' : ven && !exc ? 'vencidas' : 'ambas' };
  }
  // Vencimientos
  if (/\b(vence|vencen|vencimiento|vencimientos|vencer|vencera|vencen|caduc\w*)\b/.test(n)) {
    return { intencion: 'vence', objeto: '', ventana: n };
  }
  // Sin verificar
  if (/verific/.test(n) && /\b(no|sin|nunca|mas de|hace|antiguo|viejo|viejos|desactualizad\w*|pendiente\w*)\b/.test(n)) {
    return { intencion: 'sin_verificar', objeto: '', ventana: n };
  }
  // Asignaciones
  if (/\ba quien\b/.test(n) && /(asignad|pertenece|es de|tiene)/.test(n)) {
    return { intencion: 'asignado_a', objeto: palabrasDe(n, ['asignado', 'asignada', 'pertenece', 'quien']).join(' ') };
  }
  if (/\bequipos?\b.*\b(tiene|tienen|asignad\w*|de)\b/.test(n) && /\b(que|cuales|cuantos)\b/.test(n) || /\bque (pc|equipos?|notebooks?)\b.*\btiene\b/.test(n)) {
    return { intencion: 'equipos_de', objeto: palabrasDe(n, ['asignados', 'asignado', 'asignadas', 'notebook', 'notebooks', 'cuales', 'cuantos']).join(' ') };
  }
  // Conexión: puesto N, puerto, boca, conectado
  const mp = n.match(/\bpuestos?\s+(?:de\s+trabajo\s+)?(?:n\s*)?([a-z0-9][a-z0-9\-_./]*)/);
  if (mp && /(conectad|puerto|boca|patch|switch|va\b|llega|enchufad|donde)/.test(n)) return { intencion: 'conexion', objeto: '', puesto: mp[1].replace(/\.+$/, '') };
  if (/(conectad|\bpuertos?\b|boca de|patchera|donde (esta|va))/.test(n)) {
    return { intencion: 'conexion', objeto: palabrasDe(n, ['conectado', 'conectada', 'conectados', 'puerto', 'puertos', 'va', 'boca', 'patchera', 'donde', 'enchufado', 'enchufada', 'switch']).join(' ') };
  }
  // IP
  if (/\bip\b|\bips\b|direccion/.test(n)) {
    const ilo = /\b(ilo|idrac)\b/.test(n);
    return { intencion: 'ip', objeto: palabrasDe(n, ['ilo', 'idrac', 'gestion', 'publica', 'privada', 'asignada']).join(' '), ilo };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderIp(ctx, q) {
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return { grupos: [{ texto: '¿De qué equipo querés la IP? Por ejemplo: «¿Qué IP tiene el switch del rack principal?».' }] };
  const res = (await buscarFlexible(ctx, palabras)).filter(r => ['equipos', 'enlaces_isp', 'vlans'].includes(r.coleccion));
  /** @type {Item[]} */
  const items = [];
  for (const r of res) {
    let ips = r.previa.filter(([e]) => /^(IP|Red$|Gateway)/.test(e));
    if (q.ilo) {
      const ilo = ips.filter(([e]) => /iLO/i.test(e));
      if (ilo.length) ips = ilo;
    }
    if (!ips.length) continue;
    items.push(item(r.titulo, ruta(r.coleccion, r), ips.map(([e, v]) => e + ': ' + v).join(' · '), r.organizacion_id));
  }
  if (q.ilo) { const conIlo = items.filter(i => /iLO/i.test(i.detalle || '')); items.splice(0, items.length, ...conIlo); }
  if (!items.length) return { grupos: [{ texto: 'No encontré ninguna IP para «' + palabras.join(' ') + '» en lo que podés ver.' }] };
  return { grupos: [grupo(items.length === 1 ? 'Encontré esto:' : 'Encontré ' + items.length + ' coincidencias:', items)] };
}

/** Cadena puesto → boca → patchera → switch · puerto · VLAN. @param {Ctx} ctx @param {any} puesto @returns {Promise<Item>} */
async function cadenaPuesto(ctx, puesto) {
  const [puertos, equipos, vlans] = await Promise.all([ctx.listar('puertos'), ctx.listar('equipos'), ctx.listar('vlans')]);
  const eq = (/** @type {string|null} */ id) => equipos.find(e => e.id === id);
  /** @type {Parte[]} */
  const partes = [{ t: 'Puesto ' + puesto.puesto_nombre, href: ruta('puestos', puesto) }];
  if (puesto.puesto_boca_pared) partes.push({ t: 'boca de pared ' + puesto.puesto_boca_pared });
  const boca = puertos.find(p => p.puesto_id === puesto.id);
  if (!boca) { partes.push({ t: 'sin boca de patchera cargada' }); return { partes, orgId: puesto.organizacion_id }; }
  const patch = eq(boca.equipo_id);
  if (patch) partes.push({ t: patch.equipo_nombre + ' · boca ' + boca.puerto_numero, href: ruta('puertos', boca) });
  const pSw = boca.conectado_a_puerto_id ? puertos.find(p => p.id === boca.conectado_a_puerto_id) : null;
  const sw = pSw ? eq(pSw.equipo_id) : null;
  if (!pSw || !sw) { partes.push({ t: 'sin conexión a un switch cargada' }); return { partes, orgId: puesto.organizacion_id }; }
  partes.push({ t: sw.equipo_nombre + ' · puerto ' + pSw.puerto_numero, href: ruta('puertos', pSw) });
  const vl = pSw.vlan_nativa_id ? vlans.find(v => v.id === pSw.vlan_nativa_id) : null;
  if (vl) partes.push({ t: 'VLAN ' + vl.vlan_numero + ' · ' + vl.vlan_nombre, href: ruta('vlans', vl) });
  return { partes, orgId: puesto.organizacion_id };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderConexion(ctx, q) {
  /** @type {Item[]} */
  const items = [];
  if (q.puesto) {
    const t = normalizar(q.puesto);
    const num = /^\d+$/.test(t);
    const puestos = (await ctx.listar('puestos')).filter(p => ctx.veo('red', p.organizacion_id));
    const hall = puestos.filter(p => {
      const nom = normalizar(p.puesto_nombre);
      if (nom === t) return true;
      if (num) return nom.split(/[^a-z0-9]+/).some(x => /^\d+$/.test(x) && +x === +t);
      return nom.includes(t) || normalizar(p.puesto_boca_pared || '') === t;
    });
    hall.sort((a, b) => Number(normalizar(b.puesto_nombre) === t) - Number(normalizar(a.puesto_nombre) === t) || a.puesto_nombre.localeCompare(b.puesto_nombre, 'es', { numeric: true }));
    if (!hall.length) return { grupos: [{ texto: 'No encontré el puesto «' + q.puesto + '» en lo que podés ver.' }] };
    for (const p of hall.slice(0, TOPE)) items.push(await cadenaPuesto(ctx, p));
    return { grupos: [{ texto: hall.length === 1 ? 'Así llega el puesto:' : 'Hay ' + hall.length + ' puestos que coinciden:', items, mas: Math.max(0, hall.length - TOPE) }] };
  }
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return { grupos: [{ texto: '¿De qué puesto o equipo? Por ejemplo: «¿A qué puerto va el puesto 14?».' }] };
  const res = (await buscarFlexible(ctx, palabras)).filter(r => r.coleccion === 'equipos' || r.coleccion === 'puestos');
  if (!res.length) return { grupos: [{ texto: 'No encontré un equipo o puesto para «' + palabras.join(' ') + '».' }] };
  const [puertos, equipos, vlans, puestos] = await Promise.all([ctx.listar('puertos'), ctx.listar('equipos'), ctx.listar('vlans'), ctx.listar('puestos')]);
  const verRed = (/** @type {string} */ org) => ctx.veo('red', org);
  const vlanTxt = (/** @type {any} */ pt) => { const v = pt.vlan_nativa_id ? vlans.find(x => x.id === pt.vlan_nativa_id) : null; return v ? 'VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre : ''; };
  let sinPermiso = 0;
  for (const r of res.slice(0, 5)) {
    if (r.coleccion === 'puestos') { const p = puestos.find(x => x.id === r.id); if (p) items.push(await cadenaPuesto(ctx, p)); continue; }
    const e = equipos.find(x => x.id === r.id);
    if (!e) continue;
    const enlace = { t: e.equipo_nombre, href: ruta('equipos', e) };
    if (!verRed(e.organizacion_id)) { sinPermiso++; continue; }
    if (e.puesto_id) {
      const p = puestos.find(x => x.id === e.puesto_id);
      if (p) { const c = await cadenaPuesto(ctx, p); items.push({ partes: [enlace, ...c.partes], orgId: e.organizacion_id }); continue; }
    }
    // Equipo de red o servidor: puertos propios con destino y puertos de otros equipos que llegan a él.
    const propios = puertos.filter(p => p.equipo_id === e.id && (p.conectado_a_puerto_id || p.conectado_a_equipo_id));
    const entrantes = puertos.filter(p => p.conectado_a_equipo_id === e.id);
    /** @type {Set<string>} */
    const yaDichos = new Set();
    for (const pt of propios.slice(0, 4)) {
      const dPt = pt.conectado_a_puerto_id ? puertos.find(x => x.id === pt.conectado_a_puerto_id) : null;
      const dEq = equipos.find(x => x.id === (dPt ? dPt.equipo_id : pt.conectado_a_equipo_id));
      if (!dEq) continue;
      /** @type {Parte[]} */
      const partes = [enlace, { t: 'puerto ' + pt.puerto_numero, href: ruta('puertos', pt) }, { t: dEq.equipo_nombre + (dPt ? ' · puerto ' + dPt.puerto_numero : ''), href: dPt ? ruta('puertos', dPt) : ruta('equipos', dEq) }];
      if (dPt) yaDichos.add(dEq.id + ':' + dPt.puerto_numero);
      items.push({ partes, detalle: vlanTxt(pt) || (dPt ? vlanTxt(dPt) : ''), orgId: e.organizacion_id });
    }
    for (const pt of entrantes.slice(0, 4)) {
      const sw = equipos.find(x => x.id === pt.equipo_id);
      if (sw && !yaDichos.has(sw.id + ':' + pt.puerto_numero)) items.push({ partes: [enlace, { t: sw.equipo_nombre + ' · puerto ' + pt.puerto_numero, href: ruta('puertos', pt) }], detalle: vlanTxt(pt), orgId: e.organizacion_id });
    }
    if (!propios.length && !entrantes.length) items.push(item(e.equipo_nombre, ruta('equipos', e), 'No tiene conexiones cargadas.', e.organizacion_id));
  }
  if (!items.length) return { grupos: [{ texto: sinPermiso ? 'No tenés permiso para ver la red de esos equipos.' : 'No encontré conexiones cargadas para «' + palabras.join(' ') + '».' }] };
  return { grupos: [grupo('Conexiones encontradas:', items)] };
}

/** Fecha final de la ventana de vencimientos según el texto. @param {string} n @returns {{hasta: string, texto: string}} */
function ventanaVence(n) {
  const hoy = hoyISO();
  const [a, m, d] = hoy.split('-').map(Number);
  /** @param {Date} f */
  const iso = f => f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  const suma = (/** @type {number} */ dias) => iso(new Date(a, m - 1, d + dias));
  if (/(proximo mes|mes que viene|mes siguiente)/.test(n)) return { hasta: iso(new Date(a, m + 1, 0)), texto: 'hasta fin del mes que viene' };
  if (/(este mes|del mes|mes en curso|esta mes)/.test(n)) return { hasta: iso(new Date(a, m, 0)), texto: 'hasta fin de este mes' };
  if (/esta semana/.test(n)) return { hasta: suma(7), texto: 'en los próximos 7 días' };
  const mm = n.match(/(\d+)\s*(dias?|semanas?|meses|mes)\b/);
  if (mm) {
    const k = +mm[1], u = mm[2];
    const dias = /^dia/.test(u) ? k : /^sem/.test(u) ? k * 7 : k * 30;
    return { hasta: suma(dias), texto: 'en los próximos ' + dias + ' días' };
  }
  return { hasta: suma(30), texto: 'en los próximos 30 días' };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderVence(ctx, q) {
  const { hasta, texto } = ventanaVence(q.ventana || '');
  /** @type {Array<{f: string, it: Item}>} */
  const proximos = [], vencidos = [];
  for (const col of ['credenciales', 'licencias', 'servicios', 'tramos']) {
    for (const r of await ctx.listar(col)) {
      const k = Object.keys(r).find(x => /_vence_en$/.test(x));
      if (!k || !r[k] || !ctx.veo(moduloDe(col, r), r.organizacion_id)) continue;
      const f = String(r[k]).slice(0, 10);
      if (f > hasta) continue;
      const tipo = col === 'credenciales' ? 'Credencial' : col === 'licencias' ? 'Licencia' : col === 'servicios' ? 'Servicio' : 'Fibra';
      const it = item(titulo(col, r), ruta(col, r), tipo + ' · ' + fmtFecha(f) + ' (' + textoVence(f) + ')', r.organizacion_id);
      (f < hoyISO() ? vencidos : proximos).push({ f, it });
    }
  }
  proximos.sort((a, b) => (a.f < b.f ? -1 : 1));
  vencidos.sort((a, b) => (a.f < b.f ? 1 : -1));
  /** @type {Grupo[]} */
  const grupos = [];
  grupos.push(proximos.length ? grupo(proximos.length + (proximos.length === 1 ? ' vence ' : ' vencen ') + texto + ' (' + 'hasta el ' + fmtFecha(hasta) + '):', proximos.map(x => x.it)) : { texto: 'No vence nada ' + texto + '.' });
  if (vencidos.length) grupos.push(grupo('Ya vencid' + (vencidos.length === 1 ? 'o' : 'os') + ' (' + vencidos.length + '):', vencidos.map(x => x.it), 5));
  return { grupos };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderAsignadoA(ctx, q) {
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return { grupos: [{ texto: '¿De qué equipo? Por ejemplo: «¿A quién está asignado AGR-PC-014?».' }] };
  if (!ctx.veo('personas', ctx.org)) {
    return { grupos: [{ texto: 'No tenés permiso para ver las personas, así que no puedo decirte quién tiene cada equipo.' }] };
  }
  const res = (await buscarFlexible(ctx, palabras)).filter(r => r.coleccion === 'equipos');
  if (!res.length) return { grupos: [{ texto: 'No encontré un equipo para «' + palabras.join(' ') + '» en lo que podés ver.' }] };
  const [asigs, personas] = await Promise.all([ctx.listar('asignaciones'), ctx.listar('personas')]);
  /** @type {Item[]} */
  const items = [];
  for (const r of res.slice(0, TOPE)) {
    const a = asigs.find(x => x.equipo_id === r.id && !x.asignacion_hasta);
    const p = a ? personas.find(x => x.id === a.persona_id) : null;
    const pOk = p && ctx.veo('personas', p.organizacion_id);
    /** @type {Parte[]} */
    const partes = [{ t: r.titulo, href: ruta('equipos', r) }];
    if (pOk) partes.push({ t: 'asignado a ' + p.persona_nombre, href: ruta('personas', p) });
    else partes.push({ t: a ? 'asignado a una persona que no podés ver' : 'sin asignar' });
    items.push({ partes, detalle: a && pOk ? 'desde ' + fmtFecha(a.asignacion_desde) : undefined, orgId: r.organizacion_id });
  }
  return { grupos: [grupo(items.length === 1 ? 'Esto encontré:' : 'Encontré ' + res.length + ' equipos:', items)] };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderEquiposDe(ctx, q) {
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return { grupos: [{ texto: '¿De qué persona? Por ejemplo: «¿Qué equipos tiene Fabián Farías?».' }] };
  const res = (await buscarFlexible(ctx, palabras)).filter(r => r.coleccion === 'personas');
  if (!res.length) return { grupos: [{ texto: 'No encontré una persona para «' + palabras.join(' ') + '» en lo que podés ver.' }] };
  const [asigs, equipos] = await Promise.all([ctx.listar('asignaciones'), ctx.listar('equipos')]);
  /** @type {Item[]} */
  const items = [];
  for (const r of res.slice(0, 4)) {
    const mios = asigs.filter(a => a.persona_id === r.id && !a.asignacion_hasta);
    const persona = { t: r.titulo, href: ruta('personas', r) };
    let hallados = 0, ocultos = 0;
    for (const a of mios) {
      const e = equipos.find(x => x.id === a.equipo_id);
      if (!e) continue;
      if (!ctx.veo(moduloDe('equipos', e), e.organizacion_id)) { ocultos++; continue; }
      hallados++;
      items.push({ partes: [persona, { t: 'tiene ' + e.equipo_nombre, href: ruta('equipos', e) }], detalle: 'desde ' + fmtFecha(a.asignacion_desde), orgId: r.organizacion_id });
    }
    if (!hallados) items.push({ partes: [persona, { t: ocultos ? 'tiene equipos que no podés ver' : 'no tiene equipos asignados' }], orgId: r.organizacion_id });
  }
  return { grupos: [grupo(res.length === 1 ? 'Esto encontré:' : 'Encontré ' + res.length + ' personas:', items)] };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderLicencias(ctx, q) {
  if (!ctx.veo('licencias', ctx.org)) return { grupos: [{ texto: 'No tenés permiso para ver las licencias.' }] };
  const lics = (await ctx.listar('licencias')).filter(l => ctx.veo('licencias', l.organizacion_id));
  /** @type {Item[]} */
  const exc = [], ven = [];
  for (const l of lics) {
    const uso = await repositorio.licenciasEnUso(l.id);
    if (uso.excedida) exc.push(item(l.licencia_producto, ruta('licencias', l), uso.usadas + ' en uso de ' + uso.cantidad + ' (' + uso.exceso + ' de más)', l.organizacion_id));
    if (l.licencia_vence_en && l.licencia_vence_en < hoyISO()) ven.push(item(l.licencia_producto, ruta('licencias', l), 'venció el ' + fmtFecha(l.licencia_vence_en) + ' (' + textoVence(l.licencia_vence_en) + ')', l.organizacion_id));
  }
  /** @type {Grupo[]} */
  const grupos = [];
  const f = q.filtro || 'ambas';
  if (f !== 'vencidas') grupos.push(exc.length ? grupo('Licencias excedidas (' + exc.length + '):', exc) : { texto: 'Ninguna licencia está excedida.' });
  if (f !== 'excedidas') grupos.push(ven.length ? grupo('Licencias vencidas (' + ven.length + '):', ven) : { texto: 'Ninguna licencia está vencida.' });
  return { grupos };
}

/** Días que pide la pregunta («más de un año», «6 meses», «90 días»). @param {string} n @param {number} porDefecto */
function diasDePregunta(n, porDefecto) {
  const m = n.match(/(\d+|un|una|dos|tres)\s*(anos?|meses|mes|dias?)\b/);
  if (!m) return porDefecto;
  const k = /^\d+$/.test(m[1]) ? +m[1] : { un: 1, una: 1, dos: 2, tres: 3 }[/** @type {'un'} */ (m[1])] || 1;
  return /^ano/.test(m[2]) ? 365 * k : /^mes/.test(m[2]) ? 30 * k : k;
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderSinVerificar(ctx, q) {
  const umbrales = await repositorio.umbralesVerificacion();
  const dias = q.dias && q.dias > 0 ? q.dias : diasDePregunta(q.ventana || '', umbrales.viejo);
  /** @type {Array<{d: number, it: Item, col: string}>} */
  const viejos = [];
  const COLS = [['equipos', 'equipos'], ['racks', 'racks'], ['configuraciones', 'configuraciones'], ['credenciales', 'credenciales'], ['vlans', 'VLAN'], ['redes_wifi', 'redes Wi-Fi'],
    ['enlaces_isp', 'enlaces'], ['puestos', 'puestos'], ['personas', 'personas'], ['cuentas_dominio', 'cuentas'], ['licencias', 'licencias'], ['mapeos_disco', 'mapeos']];
  /** @type {Object<string, number>} */
  const porTipo = {};
  for (const [col, rot] of COLS) {
    for (const r of await ctx.listar(col)) {
      if (r.equipo_estado === 'baja' || r.persona_estado === 'baja' || !ctx.veo(moduloDe(col, r), r.organizacion_id)) continue;
      const d = r.verificado_en ? diasDesde(r.verificado_en) : 99999;
      if (d <= dias) continue;
      porTipo[rot] = (porTipo[rot] || 0) + 1;
      viejos.push({ d, col: rot, it: item(titulo(col, r), ruta(col, r), r.verificado_en ? 'verificado ' + textoHace(r.verificado_en) : 'nunca verificado', r.organizacion_id) });
    }
  }
  const lapso = dias % 365 === 0 ? (dias === 365 ? 'un año' : dias / 365 + ' años') : dias % 30 === 0 ? dias / 30 + ' meses' : dias + ' días';
  if (!viejos.length) return { grupos: [{ texto: 'Todo lo que podés ver se verificó hace menos de ' + lapso + '.' }] };
  viejos.sort((a, b) => b.d - a.d);
  const desglose = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + ' ' + k).join(', ');
  /** @type {Respuesta} */
  const r = { grupos: [grupo('Hay ' + viejos.length + ' sin verificar hace más de ' + lapso + ' (' + desglose + '). Los más viejos:', viejos.map(x => x.it))] };
  if (puede(ctx.u, 'verificar', 'red', ctx.org)) r.enlace = { t: 'Abrir el recorrido de verificación', href: '#/recorrido' };
  return r;
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderContrasena(ctx, q) {
  const aviso = 'Por seguridad no muestro contraseñas ni claves acá. Abrí la ficha de la credencial: ';
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return { grupos: [{ texto: aviso + 'decime de qué equipo o servicio la necesitás (por ejemplo, «¿cuál es la contraseña de la iLO del servidor?»).' }] };
  const res = (await buscarFlexible(ctx, palabras)).filter(r => r.coleccion === 'credenciales');
  if (!res.length) return { grupos: [{ texto: 'No encontré una credencial para «' + palabras.join(' ') + '» en lo que podés ver. No muestro contraseñas acá: se ven solo desde su ficha.' }] };
  /** @type {Item[]} */
  const items = [];
  for (const r of res.slice(0, TOPE)) {
    const c = await repositorio.obtener('credenciales', r.id);
    const puedeVer = !!c && puedeVerSecreto(ctx.u, c);
    const detalle = puedeVer ? 'En la ficha tenés «Mostrar» y «Copiar».' : puedePedirSecreto(ctx.u) ? 'En la ficha podés usar «Pedir acceso».' : 'Solo la ve quien tenga acceso.';
    items.push(item(r.titulo, ruta('credenciales', r), (r.subtitulo ? r.subtitulo + ' · ' : '') + detalle, r.organizacion_id));
  }
  return { grupos: [grupo(aviso + (res.length === 1 ? 'esta es la ficha.' : 'estas son las fichas que coinciden:'), items, TOPE)] };
}

/** Búsqueda global para lo que no se reconoce. @param {Ctx} ctx @param {string} pregunta @returns {Promise<Respuesta>} */
async function responderBusqueda(ctx, pregunta) {
  const palabras = palabrasDe(limpiar(pregunta), ['quiero', 'buscar']);
  const res = palabras.length ? await buscarFlexible(ctx, palabras) : [];
  if (!res.length) return { grupos: [{ texto: 'No entendí la pregunta y no encontré nada buscando esas palabras. Probá con alguna de las sugeridas, o con el nombre de un equipo, una IP o un puesto.' }] };
  const items = res.map(r => item(r.titulo, ruta(r.coleccion, r), r.subtitulo, r.organizacion_id));
  return { grupos: [grupo('No reconocí la pregunta, pero buscando «' + palabras.join(' ') + '» encontré ' + res.length + ' resultado' + (res.length === 1 ? '' : 's') + ':', items, 6)] };
}

/** @type {Record<Intencion, (ctx: Ctx, q: Interpretacion) => Promise<Respuesta>>} */
const RESPONDEDORES = {
  ip: responderIp, conexion: responderConexion, vence: responderVence, asignado_a: responderAsignadoA, equipos_de: responderEquiposDe,
  licencias: responderLicencias, sin_verificar: responderSinVerificar, contrasena: responderContrasena
};

// ---------------------------------------------------------------------------------------------
// Opción B: IA integrada del navegador (solo traduce la pregunta a una intención)
// ---------------------------------------------------------------------------------------------

const OPC_IA = { expectedInputs: [{ type: 'text', languages: ['es'] }], expectedOutputs: [{ type: 'text', languages: ['es'] }] };
const ESQUEMA_IA = {
  type: 'object',
  properties: {
    intencion: { type: 'string', enum: [...INTENCIONES, 'ninguna'] },
    objeto: { type: 'string' },
    puesto: { type: 'string' },
    dias: { type: 'integer' },
    filtro: { type: 'string', enum: ['excedidas', 'vencidas', 'ambas'] }
  },
  required: ['intencion', 'objeto'],
  additionalProperties: false
};
const INSTRUCCIONES_IA = 'Sos un clasificador de preguntas de un sistema de documentación de infraestructura de TI. Recibís una pregunta en español y devolvés solo JSON. ' +
  'Intenciones: ip (qué IP tiene un equipo; objeto = nombre o descripción del equipo), conexion (a qué puerto, boca o switch está conectado un equipo o un puesto; objeto = equipo, o puesto = número o nombre del puesto), ' +
  'vence (qué vence; dias = cantidad de días de la ventana, 0 si no se indica), asignado_a (a quién está asignado un equipo; objeto = equipo), equipos_de (qué equipos tiene una persona; objeto = nombre de la persona), ' +
  'licencias (licencias excedidas o vencidas; filtro), sin_verificar (qué no se verificó hace más de cierto tiempo; dias = días), contrasena (contraseña o clave de algo; objeto = de qué), ninguna (cualquier otra cosa). ' +
  'No inventes datos y no respondas la pregunta: solo clasificala.';

/** Estado de la IA del navegador: 'available' | 'downloadable' | 'downloading' | 'no'. */
async function estadoIA() {
  const LM = /** @type {any} */ (globalThis).LanguageModel;
  if (!LM || typeof LM.availability !== 'function') return 'no';
  try { return String(await LM.availability(OPC_IA)); } catch (e) {
    try { return String(await LM.availability()); } catch (e2) { return 'no'; }
  }
}

/**
 * @param {string} pregunta
 * @returns {Promise<Interpretacion|null>}
 */
async function interpretarConIA(pregunta) {
  const LM = /** @type {any} */ (globalThis).LanguageModel;
  let sesionIA = null;
  try {
    sesionIA = await LM.create({ ...OPC_IA, initialPrompts: [{ role: 'system', content: INSTRUCCIONES_IA }] });
    const salida = await Promise.race([
      sesionIA.prompt(pregunta, { responseConstraint: ESQUEMA_IA, omitResponseConstraintInput: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo')), 20000))]);
    const j = JSON.parse(String(salida));
    if (!j || !INTENCIONES.includes(j.intencion)) return null;
    const objeto = palabrasDe(limpiar(String(j.objeto || ''))).join(' ');
    return { intencion: j.intencion, objeto, puesto: j.puesto ? String(j.puesto) : undefined, dias: Number.isFinite(j.dias) && j.dias > 0 ? j.dias : undefined,
      ventana: j.dias > 0 ? j.dias + ' dias' : '', filtro: j.filtro || 'ambas', ilo: /ilo|idrac/i.test(pregunta) };
  } catch (e) {
    return null;
  } finally {
    try { if (sesionIA) sesionIA.destroy(); } catch (e) { /* nada */ }
  }
}

// ---------------------------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------------------------


/** @type {HTMLElement|null} */ let fab = null;
/** @type {HTMLElement|null} */ let panel = null;
/** @type {HTMLElement|null} */ let msgs = null;
/** @type {HTMLInputElement|null} */ let campo = null;
/** @type {HTMLElement|null} */ let zonaChips = null;
/** @type {HTMLElement|null} */ let zonaAviso = null;
/** @type {HTMLElement|null} */ let alcance = null;
let usuarioDelPanel = '';
let ocupado = false;
let estadoIAActual = 'no';

/** @param {Item} it @returns {HTMLElement} */
function pintarItem(it) {
  const li = h('li');
  it.partes.forEach((p, i) => {
    if (i) li.appendChild(h('span', { class: 'as-flecha', 'aria-hidden': 'true', text: '→' }));
    li.appendChild(p.href ? h('a', { href: p.href, text: p.t }) : h('span', { text: p.t }));
  });
  if (it.detalle) li.appendChild(h('span', { class: 'as-det', text: it.detalle }));
  return li;
}

/** @param {Respuesta} r @param {Map<string, string>} orgs @param {boolean} unaOrg @returns {HTMLElement} */
function pintarRespuesta(r, orgs, unaOrg) {
  const cont = h('div', { class: 'as-msg as-bot' });
  for (const g of r.grupos) {
    cont.appendChild(h('p', { text: g.texto }));
    if (g.items && g.items.length) {
      const ul = h('ul', { class: 'as-lista' });
      for (const it of g.items) {
        const li = pintarItem(it);
        if (it.orgId && orgs.get(it.orgId) && !unaOrg) li.appendChild(h('span', { class: 'as-org', text: orgs.get(it.orgId) }));
        ul.appendChild(li);
      }
      cont.appendChild(ul);
      if (g.mas) cont.appendChild(h('p', { class: 'as-mas', text: 'Y ' + g.mas + ' más. Probá una pregunta más específica para acotar.' }));
    }
  }
  if (r.enlace) cont.appendChild(h('p', {}, [h('a', { href: r.enlace.href, text: r.enlace.t })]));
  if (r.nota) cont.appendChild(h('p', { class: 'as-nota', text: r.nota }));
  return cont;
}

/** @param {HTMLElement} el */
function agregarMensaje(el) {
  if (!msgs) return;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

/** Responde una pregunta. Todo el armado de la respuesta sale del repositorio. @param {string} pregunta */
async function preguntar(pregunta) {
  const q = pregunta.trim();
  if (!q || ocupado || !msgs) return;
  ocupado = true;
  if (zonaChips) zonaChips.hidden = true;
  agregarMensaje(h('div', { class: 'as-msg as-usr', text: q }));
  const espera = h('div', { class: 'as-msg as-bot', role: 'status', text: 'Buscando…' });
  agregarMensaje(espera);
  try {
    const ctx = await crearContexto();
    if (!ctx) { espera.textContent = 'Ingresá de nuevo para consultar.'; return; }
    let interp = interpretar(q);
    if (!interp && estadoIAActual === 'available') interp = await interpretarConIA(q);
    const r = interp ? await RESPONDEDORES[interp.intencion](ctx, interp) : await responderBusqueda(ctx, q);
    const nuevo = pintarRespuesta(r, ctx.orgs, !!ctx.org);
    espera.replaceWith(nuevo);
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch (e) {
    console.error(e);
    espera.textContent = 'No pude armar la respuesta. Probá de nuevo.';
  } finally {
    ocupado = false;
  }
}

/** Sugerencias de preguntas armadas con datos que el usuario puede ver (MJ40). @param {Ctx} ctx @returns {Promise<string[]>} */
async function sugerencias(ctx) {
  /** @type {string[]} */
  const s = [];
  const [equipos, puestos, creds, asigs] = await Promise.all([ctx.listar('equipos'), ctx.listar('puestos'), ctx.listar('credenciales'), ctx.listar('asignaciones')]);
  const srv = equipos.find(e => e.equipo_tipo === 'servidor' && ctx.veo('servidores', e.organizacion_id));
  const sw = equipos.find(e => e.equipo_tipo === 'switch' && ctx.veo('red', e.organizacion_id));
  const eqIp = srv || sw;
  if (eqIp) s.push('¿Qué IP tiene ' + eqIp.equipo_nombre + '?');
  const pu = puestos.find(p => /\d/.test(p.puesto_nombre) && ctx.veo('red', p.organizacion_id));
  if (pu) s.push('¿A qué puerto va el puesto ' + pu.puesto_nombre + '?');
  if (['credenciales', 'licencias'].some(m => ctx.veo(m, ctx.org))) s.push('¿Qué vence este mes?');
  const asig = asigs.find(a => !a.asignacion_hasta && ctx.veo('personas', a.organizacion_id));
  const eqA = asig ? equipos.find(e => e.id === asig.equipo_id && ctx.veo(moduloDe('equipos', e), e.organizacion_id)) : null;
  if (eqA) s.push('¿A quién está asignado ' + eqA.equipo_nombre + '?');
  if (ctx.veo('licencias', ctx.org)) s.push('¿Qué licencias están excedidas o vencidas?');
  s.push('¿Qué no se verificó hace más de un año?');
  const cr = creds.find(c => ctx.veo('credenciales', c.organizacion_id));
  if (cr) s.push('¿Cuál es la contraseña de ' + cr.credencial_nombre + '?');
  return s;
}

async function pintarBienvenida() {
  if (!msgs || !zonaChips || !alcance) return;
  const ctx = await crearContexto();
  if (!ctx) return;
  alcance.textContent = ctx.org ? (ctx.orgs.get(ctx.org) || '') : 'Todas las organizaciones que ves';
  msgs.textContent = '';
  agregarMensaje(h('div', { class: 'as-msg as-bot' }, [h('p', { text: 'Hola. Respondo con los datos de Infradoc que podés ver' + (ctx.org ? ' en ' + (ctx.orgs.get(ctx.org) || 'esta organización') : '') + '. Probá con una de estas preguntas o escribí la tuya.' })]));
  zonaChips.textContent = '';
  zonaChips.hidden = false;
  for (const t of await sugerencias(ctx)) zonaChips.appendChild(h('button', { type: 'button', class: 'as-chip', text: t, onclick: () => preguntar(t) }));
}

// Descarga del modelo de IA de Chrome. El estado vive en el módulo para que el progreso siga visible al cerrar y reabrir el panel.
/** @type {{activa: boolean, progreso: number|null, error: string}} */
const descarga = { activa: false, progreso: null, error: '' };

/** Texto del motivo de un error de descarga. @param {any} e */
function motivoError(e) {
  const n = e && e.name;
  if (n === 'QuotaExceededError') return 'No hay espacio suficiente en el disco (Chrome pide unos 22 GB libres en la unidad de su perfil).';
  if (n === 'NotAllowedError') return 'Chrome no permitió la descarga. Puede estar bloqueada por una política de la empresa, o hay que volver a tocar el botón.';
  if (n === 'NetworkError') return 'Se cortó la conexión. Volvé a intentarlo: Chrome retoma desde donde quedó.';
  if (n === 'NotSupportedError') return 'Esta PC no cumple los requisitos del modelo (memoria, placa de video o idioma).';
  return 'No se pudo descargar' + (e && e.message ? ': ' + e.message : '.');
}

/** Explicación cuando Chrome no ofrece la IA. @param {HTMLElement} zona */
function pintarPorQueNo(zona) {
  const det = h('details', { class: 'as-porque' });
  det.appendChild(h('summary', { text: '¿Cómo la activo?' }));
  const lista = h('ul');
  for (const t of [
    'Usá Chrome de escritorio (Windows 10 u 11, macOS 13 o posterior, o Linux), versión 148 o posterior: Menú › Ayuda › Información de Google Chrome.',
    'Necesita unos 22 GB libres en el disco donde está el perfil de Chrome, y placa de video con más de 4 GB o 16 GB de RAM con 4 núcleos. La primera descarga pide una conexión sin límite de datos.',
    'Para ver el estado del modelo, copiá chrome://on-device-internals en la barra de direcciones.',
    'En una PC de empresa puede estar bloqueada por política: consultalo con quien administra Chrome.'
  ]) lista.appendChild(h('li', { text: t }));
  det.appendChild(lista);
  zona.appendChild(det);
}

/** Barra de progreso de la descarga. @param {HTMLElement} zona */
function pintarProgreso(zona) {
  const pct = descarga.progreso === null ? null : Math.round(descarga.progreso * 100);
  zona.appendChild(h('span', { text: pct === null ? 'Descargando el modelo de IA de Chrome…' : 'Descargando el modelo de IA de Chrome: ' + pct + ' %' }));
  const barra = h('progress', { class: 'as-progreso', max: '100', 'aria-label': 'Progreso de la descarga' });
  if (pct !== null) barra.setAttribute('value', String(pct));
  zona.appendChild(barra);
  zona.appendChild(h('span', { class: 'as-nota', text: 'Podés seguir usando el asistente y cerrar este panel; la descarga sigue mientras Chrome esté abierto.' }));
}

async function pintarAviso() {
  if (!zonaAviso) return;
  if (!descarga.activa) estadoIAActual = await estadoIA();
  const zona = zonaAviso;
  zona.textContent = '';
  if (descarga.activa) { pintarProgreso(zona); return; }
  if (estadoIAActual === 'available') {
    zona.appendChild(h('span', { text: 'IA del navegador activa: entiende más formas de preguntar. Los datos salen siempre del repositorio.' }));
    return;
  }
  zona.appendChild(h('span', { text: AVISO_SIN_IA }));
  if (descarga.error) zona.appendChild(h('span', { class: 'as-error', role: 'alert', text: descarga.error }));
  if (estadoIAActual === 'downloadable') {
    const b = h('button', { type: 'button', text: descarga.error ? 'Reintentar la descarga' : 'Descargar la IA del navegador' });
    b.addEventListener('click', () => {
      zona.textContent = '';
      zona.appendChild(h('span', { text: 'Chrome va a descargar su modelo de IA (Gemini Nano, de varios GB; pide unos 22 GB libres en el disco). Se descarga una sola vez y corre en tu PC: tus datos no salen.' }));
      zona.appendChild(h('button', { type: 'button', class: 'primario', text: 'Descargar ahora', onclick: () => descargarModelo() }));
      zona.appendChild(h('button', { type: 'button', text: 'Cancelar', onclick: () => { pintarAviso(); } }));
    });
    zona.appendChild(b);
  } else if (estadoIAActual === 'downloading') {
    // Chrome ya la está bajando (por otro sitio o una pestaña anterior): un toque engancha el progreso.
    zona.appendChild(h('span', { text: 'Chrome ya está descargando su modelo de IA.' }));
    zona.appendChild(h('button', { type: 'button', text: 'Ver el progreso', onclick: () => descargarModelo() }));
  } else {
    pintarPorQueNo(zona);
  }
}

/** Descarga (o engancha una descarga en curso) creando una sesión con monitor. Necesita el toque del usuario. */
async function descargarModelo() {
  const LM = /** @type {any} */ (globalThis).LanguageModel;
  if (!LM || descarga.activa) return;
  descarga.activa = true; descarga.progreso = null; descarga.error = '';
  await pintarAviso();
  try {
    const s = await LM.create({ ...OPC_IA, monitor(/** @type {any} */ m) {
      m.addEventListener('downloadprogress', (/** @type {any} */ e) => {
        descarga.progreso = Math.max(0, Math.min(1, Number(e.loaded) || 0));
        if (panel && !panel.hidden) pintarAviso();
      });
    } });
    try { s.destroy(); } catch (e) { /* nada */ }
  } catch (e) {
    console.warn(e);
    descarga.error = motivoError(e);
  }
  descarga.activa = false;
  await pintarAviso();
}

function abrirPanel() {
  if (!panel || !fab) return;
  panel.hidden = false;
  fab.setAttribute('aria-expanded', 'true');
  const u = sesion.usuarioActual();
  if (u && usuarioDelPanel !== u.id + '|' + (sesion.organizacionActiva() || '')) {
    usuarioDelPanel = u.id + '|' + (sesion.organizacionActiva() || '');
    pintarBienvenida();
  } else if (alcance && u) { crearContexto().then(c => { if (c && alcance) alcance.textContent = c.org ? (c.orgs.get(c.org) || '') : 'Todas las organizaciones que ves'; }); }
  pintarAviso();
  if (campo) campo.focus();
}

function cerrarPanel() {
  if (!panel || !fab || panel.hidden) return;
  panel.hidden = true;
  fab.setAttribute('aria-expanded', 'false');
  if (!fab.hidden) fab.focus();
}

/** Muestra el botón solo con sesión; al cerrar sesión borra la conversación. */
function sincronizarSesion() {
  if (!fab || !panel) return;
  const u = sesion.usuarioActual();
  fab.hidden = !u;
  if (!u) {
    panel.hidden = true;
    usuarioDelPanel = '';
    if (msgs) msgs.textContent = '';
  }
}

/** Arma el botón flotante y el panel (una sola vez) y los conecta a la sesión. */
export function iniciarAsistente() {
  if (fab) return;
  fab = h('button', { type: 'button', class: 'as-fab', 'aria-label': 'Asistente de consultas', title: 'Asistente de consultas', 'aria-expanded': 'false', 'aria-controls': 'as-panel', hidden: true }, [icono('pregunta')]);
  fab.addEventListener('click', () => { if (panel && panel.hidden) abrirPanel(); else cerrarPanel(); });

  msgs = h('div', { class: 'as-msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversación' });
  zonaChips = h('div', { class: 'as-chips', 'aria-label': 'Preguntas sugeridas' });
  zonaAviso = h('div', { class: 'as-aviso' });
  alcance = h('span', { class: 'as-alcance' });
  campo = /** @type {HTMLInputElement} */ (h('input', { class: 'as-input', type: 'text', id: 'as-pregunta', 'aria-label': 'Tu pregunta', placeholder: 'Preguntá algo…', autocomplete: 'off', maxlength: '300' }));
  const form = h('form', { class: 'as-form' }, [campo, h('button', { type: 'submit', class: 'primario as-enviar', text: 'Preguntar' })]);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const t = campo ? campo.value : '';
    if (campo) campo.value = '';
    preguntar(t);
  });
  const cerrar = h('button', { type: 'button', class: 'as-cerrar', 'aria-label': 'Cerrar el asistente', text: '×' });
  cerrar.addEventListener('click', cerrarPanel);

  panel = h('div', { class: 'as-panel', id: 'as-panel', role: 'dialog', 'aria-label': 'Asistente de consultas', 'aria-modal': 'false', hidden: true }, [
    h('div', { class: 'as-cab' }, [h('h2', { text: 'Asistente' }), alcance, cerrar]), msgs, zonaChips, zonaAviso, form]);

  document.body.appendChild(panel);
  document.body.appendChild(fab);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel && !panel.hidden && !modalAbierto()) cerrarPanel();
  });
  window.addEventListener('hashchange', sincronizarSesion);
  sincronizarSesion();
}
