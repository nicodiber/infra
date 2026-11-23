// @ts-check
/**
 * Repositorio: ÚNICA puerta a los datos (D-006). Las vistas nunca usan indexedDB, localStorage ni fetch:
 * piden todo acá. Hoy guarda en IndexedDB (D-007, provisorio); cambiar a un servidor se hace solo en este archivo.
 *
 * - Una base `infradoc` con un store por colección.
 * - En el primer uso carga `datos-demo/infradoc-demo.json`.
 * - Todo vive solo en este navegador: nada se envía a ningún lado (D-042). No hay métricas ni llamadas externas.
 * - Todas las funciones son asíncronas (como lo serán con un servidor) y devuelven copias: modificar lo devuelto
 *   no cambia lo guardado hasta llamar a `guardar`.
 * - El secreto de una credencial nunca sale en `obtener` ni `listar`: solo con `usarSecreto`, que lo deja registrado.
 *   Tampoco salen la clave de prueba de los usuarios ni los valores ocultos del historial.
 * - Este módulo NO decide permisos (eso es `permisos.js`): quien lo llama debe haberlos consultado antes.
 */

import {
  COLECCIONES, COLECCIONES_COMUNES, ENTIDAD_DE_COLECCION, COLECCION_DE_ENTIDAD, CAMPOS_SECRETOS, ROTULO_EQUIPO_TIPO,
  ROTULO_CREDENCIAL_TIPO, ROTULO_CONFIGURACION_TIPO, ROTULO_ESTADO_EQUIPO, ROTULO_LICENCIA_TIPO, ROTULO_PERSONA_ESTADO,
  ROTULO_CUENTA_ESTADO, ROTULO_MAPEO_APLICA_A, ROTULO_MAPEO_METODO, ROTULO_RELOJ_METODO, CATEGORIA_RELOJ,
  moduloDeEntidad as moduloDeEntidadModelo, ROTULO_SERVICIO_TIPO, TIPOS_REGISTRO_DNS, ROTULO_FIBRA_TIPO, CONECTORES_FIBRA,
  ROTULO_ARCHIVO_TIPO, LIMITE_ARCHIVO_BYTES, ROTULO_ENTIDAD, rutaDeEntidad, VERSION_MODELO, migrarDatos, esImpresora
} from './modelos.js';
import { normalizar, ahoraISO, descargarTexto, hoyISO } from './utiles.js';

/** @typedef {import('./modelos.js').Aprobacion} Aprobacion */
/** @typedef {import('./modelos.js').Solicitud} Solicitud */
/** @typedef {import('./modelos.js').Cambio} Cambio */
/** @typedef {import('./modelos.js').PermisoModulo} PermisoModulo */
/** @typedef {import('./modelos.js').Asignacion} Asignacion */
/** @typedef {import('./modelos.js').InstalacionLicencia} InstalacionLicencia */
/** @typedef {import('./modelos.js').Vlan} Vlan */
/** @typedef {import('./modelos.js').Equipo} Equipo */
/** @typedef {import('./modelos.js').Nota} Nota */
/** @typedef {import('./modelos.js').Archivo} Archivo */
/** @typedef {import('./modelos.js').Relacion} Relacion */
/** @typedef {import('./utiles.js').Umbrales} Umbrales */

const NOMBRE_DB = 'infradoc';
const VERSION_DB = 3; // 2: personas, cuentas de dominio, asignaciones, licencias, instalaciones, mapeos y notas. 3: servicios, tramos de fibra, archivos y relaciones (el upgrade solo agrega stores)
const STORE_META = 'meta';
const URL_DATOS_EJEMPLO = new URL('../../datos-demo/infradoc-demo.json', import.meta.url).href;
/** Archivo chico con la versión de los datos de ejemplo del sitio: se consulta al iniciar sin bajar todos los datos (D-073). */
const URL_VERSION_EJEMPLO = new URL('../../datos-demo/version.json', import.meta.url).href;
const CLAVES_ESTANDAR = ['id', 'creado_en', 'creado_por', 'actualizado_en', 'actualizado_por', 'verificado_en', 'verificado_por'];

/** @type {IDBDatabase|null} */
let db = null;
/** Copia en memoria de todos los registros, por colección: acelera listados y búsquedas. @type {Object<string, Map<string, any>>} */
let cache = {};
/** @type {Promise<void>|null} */
let iniciando = null;
/** @type {Object|null} */
let infoCargaInicial = null;
/** @type {Array<any>|null} */
let indiceBusqueda = null;

// ---------------------------------------------------------------------------------------------
// IndexedDB (privado)
// ---------------------------------------------------------------------------------------------

/** @returns {Promise<IDBDatabase>} */
function abrirDB() {
  return new Promise((resolver, rechazar) => {
    if (!('indexedDB' in window)) { rechazar(new Error('Este navegador no permite guardar datos (IndexedDB no disponible).')); return; }
    const req = indexedDB.open(NOMBRE_DB, VERSION_DB);
    req.onupgradeneeded = () => {
      const base = req.result;
      for (const c of COLECCIONES) if (!base.objectStoreNames.contains(c)) base.createObjectStore(c, { keyPath: 'id' });
      if (!base.objectStoreNames.contains(STORE_META)) base.createObjectStore(STORE_META, { keyPath: 'clave' });
    };
    req.onsuccess = () => resolver(req.result);
    req.onerror = () => rechazar(req.error || new Error('No se pudo abrir la base de datos del navegador.'));
    req.onblocked = () => rechazar(new Error('La base de datos está abierta en otra pestaña; cerrala y volvé a intentar.'));
  });
}

/** @param {IDBTransaction} tx @returns {Promise<void>} */
function terminar(tx) {
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error || new Error('Falló la escritura en el navegador.'));
    tx.onabort = () => rechazar(tx.error || new Error('Se canceló la escritura en el navegador.'));
  });
}

/** @param {IDBRequest} req */
function pedido(req) {
  return new Promise((resolver, rechazar) => { req.onsuccess = () => resolver(req.result); req.onerror = () => rechazar(req.error); });
}

/** @param {string} clave */
async function metaGet(clave) {
  const fila = await pedido(/** @type {IDBDatabase} */ (db).transaction(STORE_META).objectStore(STORE_META).get(clave));
  return fila ? fila.valor : null;
}

/** @param {string} clave @param {any} valor */
async function metaSet(clave, valor) {
  const tx = /** @type {IDBDatabase} */ (db).transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put({ clave, valor });
  await terminar(tx);
}

/** Lee todas las colecciones al cache. */
async function leerTodo() {
  const base = /** @type {IDBDatabase} */ (db);
  const tx = base.transaction(COLECCIONES, 'readonly');
  const pedidos = COLECCIONES.map(c => pedido(tx.objectStore(c).getAll()));
  const listas = await Promise.all(pedidos);
  cache = {};
  COLECCIONES.forEach((c, i) => { cache[c] = new Map(listas[i].map(/** @param {any} r */ r => [r.id, r])); });
  indiceBusqueda = null;
}

/**
 * Reemplaza todo el contenido (vacía y escribe) y lo deja también en el cache.
 * @param {Object<string, any[]>} datos
 */
async function reemplazarTodo(datos) {
  const base = /** @type {IDBDatabase} */ (db);
  const tx = base.transaction(COLECCIONES, 'readwrite');
  for (const c of COLECCIONES) {
    const store = tx.objectStore(c);
    store.clear();
    for (const r of datos[c] || []) store.put(r);
  }
  await terminar(tx);
  cache = {};
  for (const c of COLECCIONES) cache[c] = new Map((datos[c] || []).map(r => [r.id, r]));
  indiceBusqueda = null;
  await completarCodigosDeEquipo();
}

/**
 * Escribe y borra registros sueltos en una sola transacción.
 * @param {Array<[string, any]>} escrituras pares [colección, registro]
 * @param {Array<[string, string]>} [borrados] pares [colección, id]
 * @param {boolean} [interno] true: cambio hecho por el sistema (migración), no por un usuario.
 */
async function persistir(escrituras, borrados, interno) {
  const base = /** @type {IDBDatabase} */ (db);
  const nombres = Array.from(new Set(escrituras.map(e => e[0]).concat((borrados || []).map(b => b[0]))));
  if (!nombres.length) return;
  const tx = base.transaction(nombres, 'readwrite');
  for (const [c, r] of escrituras) { tx.objectStore(c).put(r); cache[c].set(r.id, r); }
  for (const [c, id] of borrados || []) { tx.objectStore(c).delete(id); cache[c].delete(id); }
  indiceBusqueda = null;
  await terminar(tx);
  // Cualquier cambio de un usuario vuelve «propios» a los datos (D-073); marcar un cambio como leído o ver un secreto no cuenta.
  if (!interno && nombres.some(n => !COLECCIONES_SIN_MARCA.includes(n))) await marcarDatosPropios();
}

/** Colecciones cuya escritura no vuelve «propios» a los datos: son del uso, no de lo cargado. */
const COLECCIONES_SIN_MARCA = ['lecturas_cambio', 'registro_accesos'];
/** @type {boolean|null} Copia en memoria de la marca `datos_propios`. */
let datosPropios = null;
/** @type {string|null} Versión de los datos de ejemplo del sitio cuando es distinta de la cargada. */
let ejemploNuevo = null;

/** Marca que alguien cargó o cambió datos en este navegador: el restablecer automático ya no los toca. */
async function marcarDatosPropios() {
  if (datosPropios === true) return;
  datosPropios = true;
  await metaSet('datos_propios', true);
}

// ---------------------------------------------------------------------------------------------
// Código corto de equipo (MJ37)
// ---------------------------------------------------------------------------------------------

/** Abreviatura por categoría de `otro` (el resto de las categorías usa `OTR`). @type {Object<string, string>} */
const ABREVIATURA_CATEGORIA = {
  'pc de escritorio': 'PC', 'notebook': 'NB', 'impresora de red': 'IMP', 'reloj de control de personal': 'REL',
  'impresora': 'IMP', 'hmi / terminal de planta': 'HMI', 'terminal de balanza': 'BAL', 'nvr de camaras': 'NVR', 'nas': 'NAS'
};
/** @type {Object<string, string>} */
const ABREVIATURA_TIPO = { router: 'RTR', firewall: 'FW', switch: 'SW', access_point: 'AP', servidor: 'SRV', patchera: 'PAT', ups: 'UPS', otro: 'OTR' };

/**
 * Abreviatura del tipo de equipo para su código (`PC`, `SW`, `VM`…).
 * @param {{equipo_tipo: string, equipo_campos?: Object<string, any>}} e
 */
export function abreviaturaEquipo(e) {
  const c = e.equipo_campos || {};
  if (e.equipo_tipo === 'servidor' && c.host_id) return 'VM';
  if (e.equipo_tipo === 'otro') return ABREVIATURA_CATEGORIA[normalizar(c.otro_categoria)] || 'OTR';
  return ABREVIATURA_TIPO[e.equipo_tipo] || 'EQ';
}

/** Tres primeras letras (sin tildes, en mayúscula) del nombre de la organización: `AGR`, `MET`, `EST`. @param {string} organizacionId */
function prefijoOrganizacion(organizacionId) {
  const o = cache.organizaciones.get(organizacionId);
  const letras = normalizar(o ? o.organizacion_nombre : '').replace(/[^a-z]/g, '').toUpperCase();
  return (letras + 'XXX').slice(0, 3);
}

/**
 * Próximo código libre de equipo de una organización, por ejemplo `AGR-PC-015` (cuenta también los equipos de baja).
 * @param {{organizacion_id: string, equipo_tipo: string, equipo_campos?: Object<string, any>}} e
 */
function siguienteCodigo(e) {
  const base = prefijoOrganizacion(e.organizacion_id) + '-' + abreviaturaEquipo(e) + '-';
  let max = 0;
  for (const x of cache.equipos.values()) {
    if (x.organizacion_id !== e.organizacion_id || !x.equipo_codigo || !x.equipo_codigo.startsWith(base)) continue;
    const n = parseInt(x.equipo_codigo.slice(base.length), 10);
    if (n > max) max = n;
  }
  return base + String(max + 1).padStart(3, '0');
}

/** Da código a los equipos que no lo tienen (bases anteriores a la v0.4). Sin historial: es una migración. */
async function completarCodigosDeEquipo() {
  const sin = Array.from(cache.equipos.values()).filter(e => !e.equipo_codigo).sort((a, b) => (a.creado_en < b.creado_en ? -1 : a.creado_en > b.creado_en ? 1 : 0));
  if (!sin.length) return;
  /** @type {Array<[string, any]>} */
  const ops = [];
  for (const e of sin) {
    const nuevo = { ...e, equipo_codigo: siguienteCodigo(e) };
    cache.equipos.set(nuevo.id, nuevo); // para que el siguiente no repita
    ops.push(['equipos', nuevo]);
  }
  await persistir(ops, undefined, true);
}

// ---------------------------------------------------------------------------------------------
// Inicio y datos de ejemplo
// ---------------------------------------------------------------------------------------------

/** Fecha en la que se generaron los datos de ejemplo si el archivo no trae `generado_en`. */
const FECHA_BASE_EJEMPLO = '2026-11-22';
const RE_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;

/**
 * Fecha de «hoy» para desplazar los datos de ejemplo. Un gancho de prueba permite fijarla
 * (`globalThis.INFRADOC_HOY = '2026-12-01'`); en el uso normal es la fecha de la computadora.
 */
function hoyParaEjemplo() {
  const forzada = /** @type {any} */ (globalThis).INFRADOC_HOY;
  return typeof forzada === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(forzada) ? forzada : hoyISO();
}

/** @param {string} a @param {string} b Días entre dos «AAAA-MM-DD» (b − a). */
function diasEntre(a, b) {
  const t = (/** @type {string} */ s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

/**
 * Desplaza TODAS las fechas ISO (fecha sola o fecha-hora) de los datos de ejemplo en la diferencia entre hoy y la
 * fecha base del generador, para que vencimientos y verificaciones se vean siempre igual (QC33-B). Solo toca
 * valores que son exactamente una fecha; trabaja sobre los datos de ejemplo, nunca sobre lo que carga el usuario.
 * @param {any} nodo @param {string} base
 */
function desplazarFechas(nodo, base) {
  const dias = diasEntre(base, hoyParaEjemplo());
  if (!dias) return;
  /** @param {string} s */
  const mover = s => {
    const m = RE_FECHA_ISO.exec(s);
    if (!m) return s;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + dias));
    return d.toISOString().slice(0, 10) + (m[4] || '');
  };
  /** @param {any} x */
  const recorrer = x => {
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { if (typeof x[i] === 'string') x[i] = mover(x[i]); else if (x[i] && typeof x[i] === 'object') recorrer(x[i]); } }
    else if (x && typeof x === 'object') { for (const k of Object.keys(x)) { const v = x[k]; if (typeof v === 'string') x[k] = mover(v); else if (v && typeof v === 'object') recorrer(v); } }
  };
  recorrer(nodo);
}

/**
 * Descarga y valida `datos-demo/infradoc-demo.json` (fetch del propio sitio, sin enviar nada).
 * @returns {Promise<{datos: Object<string, any[]>, descargaMs: number, lecturaMs: number, bytes: number, version: string|null}>}
 */
async function leerDatosEjemplo() {
  const t0 = performance.now();
  const resp = await fetch(URL_DATOS_EJEMPLO, { cache: 'no-cache' });
  if (!resp.ok) throw new Error('No se pudieron leer los datos de ejemplo (' + resp.status + ').');
  const texto = await resp.text();
  const t1 = performance.now();
  const crudo = JSON.parse(texto);
  const t2 = performance.now();
  const datos = validarEstructura(crudo);
  migrarDatos(datos, versionModeloDe(crudo));
  desplazarFechas(datos, typeof crudo.generado_en === 'string' ? crudo.generado_en.slice(0, 10) : FECHA_BASE_EJEMPLO);
  return { datos, descargaMs: Math.round(t1 - t0), lecturaMs: Math.round(t2 - t1), bytes: texto.length, version: typeof crudo.version_datos_ejemplo === 'string' ? crudo.version_datos_ejemplo : null };
}

/**
 * Versión del modelo de datos de un archivo exportado: `version_modelo`, o 1 si no la trae (D-073).
 * Rechaza una versión más nueva que la de esta app: no se sabría qué hacer con los campos que no conoce.
 * @param {any} crudo @returns {number}
 */
function versionModeloDe(crudo) {
  const v = crudo.version_modelo == null ? 1 : crudo.version_modelo;
  if (!Number.isInteger(v) || v < 1) throw new Error('El archivo trae una versión del modelo de datos inválida («' + String(crudo.version_modelo) + '»).');
  if (v > VERSION_MODELO) throw new Error('Este archivo se exportó con una versión más nueva de Infradoc (modelo de datos ' + v + '; esta versión llega hasta la ' + VERSION_MODELO + '). Actualizá la aplicación antes de importarlo: así no se pierde ni se rompe nada.');
  return v;
}

/**
 * Comprueba que sea un conjunto de datos de Infradoc y devuelve solo las colecciones conocidas.
 * @param {any} crudo
 * @returns {Object<string, any[]>}
 */
function validarEstructura(crudo) {
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) throw new Error('El archivo no tiene el formato de datos de Infradoc.');
  if (!Array.isArray(crudo.organizaciones) || !Array.isArray(crudo.usuarios)) throw new Error('Al archivo le faltan las organizaciones o los usuarios: no es un archivo de Infradoc.');
  /** @type {Object<string, any[]>} */
  const datos = {};
  for (const c of COLECCIONES) {
    const lista = crudo[c];
    if (lista != null && !Array.isArray(lista)) throw new Error('«' + c + '» no es una lista.');
    datos[c] = lista || [];
    for (const r of datos[c]) if (!r || typeof r.id !== 'string') throw new Error('Hay un registro sin id en «' + c + '».');
  }
  if (!datos.usuarios.some(u => u.usuario_perfil === 'superadmin' && u.usuario_estado === 'activo')) throw new Error('El archivo no trae ningún superadmin activo: no se podría ingresar después de importarlo.');
  return datos;
}

/**
 * Abre la base y, la primera vez, carga los datos de ejemplo. Se puede llamar muchas veces.
 * @returns {Promise<void>}
 */
export function iniciar() {
  if (!iniciando) {
    iniciando = (async () => {
      const t0 = performance.now();
      db = await abrirDB();
      if (!(await metaGet('cargado'))) {
        const { datos, descargaMs, lecturaMs, bytes, version } = await leerDatosEjemplo();
        const t1 = performance.now();
        await reemplazarTodo(datos);
        const escrituraMs = Math.round(performance.now() - t1);
        await metaSet('cargado', true);
        await anotarDatosDeEjemplo(version || await versionEjemploDelSitio());
        infoCargaInicial = { primeraCarga: true, totalMs: Math.round(performance.now() - t0), descargaMs, lecturaMs, escrituraMs, bytes, en: ahoraISO() };
        await metaSet('primera_carga', infoCargaInicial);
      } else {
        await leerTodo();
        const marca = await metaGet('datos_propios');
        datosPropios = marca === true ? true : marca === false ? false : null;
        await migrarBaseGuardada();
        await completarCodigosDeEquipo();
        const restablecido = await revisarDatosDeEjemplo();
        infoCargaInicial = { primeraCarga: false, totalMs: Math.round(performance.now() - t0), previa: await metaGet('primera_carga'), restablecidoAutomatico: restablecido };
      }
    })().catch(e => { iniciando = null; throw e; });
  }
  return iniciando;
}

/**
 * Deja anotado que los datos son los de ejemplo, de qué versión y a qué versión del modelo corresponden.
 * @param {string|null} version
 */
async function anotarDatosDeEjemplo(version) {
  datosPropios = false;
  ejemploNuevo = null;
  await metaSet('datos_propios', false);
  await metaSet('version_datos_ejemplo', version);
  await metaSet('version_modelo', VERSION_MODELO);
}

/** Si la base guardada es de un modelo anterior, la migra (campos nuevos con su valor por defecto) y la vuelve a guardar. */
async function migrarBaseGuardada() {
  const guardada = (await metaGet('version_modelo')) || 1;
  if (guardada >= VERSION_MODELO) return;
  /** @type {Object<string, any[]>} */
  const datos = {};
  for (const c of COLECCIONES) datos[c] = Array.from(cache[c].values());
  migrarDatos(datos, guardada);
  const base = /** @type {IDBDatabase} */ (db);
  const tx = base.transaction(COLECCIONES, 'readwrite');
  for (const c of COLECCIONES) for (const r of datos[c]) { tx.objectStore(c).put(r); cache[c].set(r.id, r); }
  await terminar(tx);
  await metaSet('version_modelo', VERSION_MODELO);
}

/** Versión de los datos de ejemplo que publica el sitio, o null si no se puede consultar (sin conexión, archivo ausente). @returns {Promise<string|null>} */
async function versionEjemploDelSitio() {
  try {
    const resp = await fetch(URL_VERSION_EJEMPLO, { cache: 'no-cache' });
    if (!resp.ok) return null;
    const j = await resp.json();
    return j && typeof j.version_datos_ejemplo === 'string' ? j.version_datos_ejemplo : null;
  } catch { return null; }
}

/**
 * QC43-C con protección (D-073): si el sitio trae datos de ejemplo nuevos y nadie cargó ni cambió nada, los restablece solo;
 * si hay datos propios (o no se puede saber), no toca nada y deja el aviso para `hayDatosEjemploNuevos`.
 * @returns {Promise<boolean>} true si restableció.
 */
async function revisarDatosDeEjemplo() {
  const sitio = await versionEjemploDelSitio();
  const cargada = await metaGet('version_datos_ejemplo');
  if (!sitio || sitio === cargada) { ejemploNuevo = null; return false; }
  // Una base anterior a esta versión no sabe si tiene datos propios: por las dudas se la trata como propia.
  if (datosPropios === null) await marcarDatosPropios();
  if (datosPropios === false) {
    const { datos, version } = await leerDatosEjemplo();
    await reemplazarTodo(datos);
    await anotarDatosDeEjemplo(version || sitio);
    await metaSet('restablecido_en', ahoraISO());
    return true;
  }
  ejemploNuevo = sitio;
  return false;
}

/**
 * ¿El sitio trae datos de ejemplo nuevos que no se cargaron porque este navegador tiene datos propios? La pantalla de Datos
 * muestra entonces el aviso con «Exportar primero» y «Restablecer». Nunca restablece nada.
 * @returns {Promise<boolean>}
 */
export async function hayDatosEjemploNuevos() { await iniciar(); return !!ejemploNuevo; }

/** ¿Hay datos cargados o cambiados por un usuario en este navegador (no solo los de ejemplo)? @returns {Promise<boolean>} */
export async function hayDatosPropios() { await iniciar(); return datosPropios === true; }

/** Fecha-hora (ISO) de la última exportación hecha en este navegador, o null si nunca se exportó. @returns {Promise<string|null>} */
export async function ultimaExportacion() { await iniciar(); return metaGet('ultima_exportacion'); }

/** Tiempos de la carga: la de esta sesión y, si ya hubo una primera, la de la primera vez. */
export async function infoCarga() {
  await iniciar();
  return structuredClone(infoCargaInicial);
}

/**
 * Borra lo cargado y vuelve a los datos de ejemplo. Los usuarios y cambios hechos se pierden.
 * @returns {Promise<{totalMs: number}>}
 */
export async function restablecerDatosEjemplo() {
  await iniciar();
  const t0 = performance.now();
  const { datos, version } = await leerDatosEjemplo();
  await reemplazarTodo(datos);
  await anotarDatosDeEjemplo(version);
  await metaSet('restablecido_en', ahoraISO());
  return { totalMs: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------------

/**
 * Copia de un registro apta para las vistas: sin secretos ni claves.
 * @param {string} coleccion
 * @param {any} r
 */
function publico(coleccion, r) {
  if (coleccion === 'credenciales') { const { credencial_secreto, ...resto } = r; return { ...structuredClone(resto), credencial_secreto: null }; }
  if (coleccion === 'usuarios') { const { usuario_clave_prototipo, ...resto } = r; return structuredClone(resto); }
  if (coleccion === 'cambios' && r.cambio_valor_oculto) return { ...r, cambio_valor_anterior: null, cambio_valor_nuevo: null };
  // El contenido de un archivo (data URL, hasta 5 MB) solo sale con `obtener` o `contenidoDeArchivo`: no en los listados.
  if (coleccion === 'archivos') { const { archivo_contenido, ...resto } = r; return { ...structuredClone(resto), archivo_contenido: '' }; }
  return structuredClone(r);
}

/**
 * Vista de solo lectura que se le pasa a un filtro: sin los campos que no deben salir.
 * @param {string} coleccion @param {any} r
 */
function paraFiltro(coleccion, r) {
  if (coleccion === 'credenciales') { const { credencial_secreto, ...resto } = r; return resto; }
  if (coleccion === 'usuarios') { const { usuario_clave_prototipo, ...resto } = r; return resto; }
  return r;
}

/**
 * @param {string} coleccion
 * @param {string} id
 * @param {{incluirBajas?: boolean}} [opciones]
 */
export async function obtener(coleccion, id, opciones) {
  await iniciar();
  const r = cache[coleccion] && cache[coleccion].get(id);
  if (!r || (r.eliminado_en && !(opciones && opciones.incluirBajas))) return null;
  if (coleccion === 'archivos') return structuredClone(r);
  return publico(coleccion, r);
}

/**
 * @param {string} coleccion
 * @param {Object<string, any>|((r: any) => boolean)|null} [filtro] Objeto de igualdades o función (solo lectura).
 * @param {{incluirBajas?: boolean, ordenarPor?: string, descendente?: boolean}} [opciones]
 */
export async function listar(coleccion, filtro, opciones) {
  await iniciar();
  const o = opciones || {};
  const prueba = typeof filtro === 'function' ? filtro : filtro ? (/** @type {any} */ r) => Object.keys(filtro).every(k => r[k] === filtro[k]) : null;
  const salida = [];
  for (const r of cache[coleccion].values()) {
    if (r.eliminado_en && !o.incluirBajas) continue;
    if (prueba && !prueba(paraFiltro(coleccion, r))) continue;
    salida.push(publico(coleccion, r));
  }
  if (o.ordenarPor) {
    const k = o.ordenarPor;
    salida.sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (o.descendente ? -1 : 1));
  }
  return salida;
}

/**
 * Cuenta registros sin copiarlos.
 * @param {string} coleccion
 * @param {Object<string, any>|((r: any) => boolean)|null} [filtro]
 * @param {{incluirBajas?: boolean}} [opciones]
 */
export async function contar(coleccion, filtro, opciones) {
  await iniciar();
  const prueba = typeof filtro === 'function' ? filtro : filtro ? (/** @type {any} */ r) => Object.keys(filtro).every(k => r[k] === filtro[k]) : null;
  let n = 0;
  for (const r of cache[coleccion].values()) {
    if (r.eliminado_en && !(opciones && opciones.incluirBajas)) continue;
    if (!prueba || prueba(paraFiltro(coleccion, r))) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Escritura con historial
// ---------------------------------------------------------------------------------------------

/** @param {string} coleccion @param {any} r Organización a la que pertenece un registro (o null). */
function orgDe(coleccion, r) {
  if (coleccion === 'organizaciones') return r.id;
  if (coleccion === 'puertos') { const e = cache.equipos.get(r.equipo_id); return e ? e.organizacion_id : null; }
  if (coleccion === 'permisos_modulo') { const u = cache.usuarios.get(r.usuario_id); return u ? u.organizacion_id : null; }
  return r.organizacion_id || null;
}

/** @param {any} v */
const json = v => (v === undefined || v === null ? null : JSON.stringify(v));

/**
 * @param {string} coleccion @param {any} registro @param {'alta'|'modificacion'|'baja'|'restauracion'} operacion
 * @param {string|null} campo @param {any} anterior @param {any} nuevo @param {string} usuarioId @param {string|null} motivo
 * @returns {Cambio}
 */
function nuevoCambio(coleccion, registro, operacion, campo, anterior, nuevo, usuarioId, motivo) {
  if (campo === 'archivo_contenido') { anterior = anterior ? '[contenido anterior]' : null; nuevo = nuevo ? '[contenido nuevo]' : null; } // no se copian MB al historial
  return {
    id: crypto.randomUUID(), cambio_entidad: ENTIDAD_DE_COLECCION[coleccion], entidad_id: registro.id,
    organizacion_id: orgDe(coleccion, registro), cambio_operacion: operacion, cambio_campo: campo,
    cambio_valor_anterior: json(anterior), cambio_valor_nuevo: json(nuevo),
    cambio_valor_oculto: campo !== null && CAMPOS_SECRETOS.includes(campo),
    usuario_id: usuarioId, cambio_fecha: ahoraISO(), cambio_motivo: motivo || null
  };
}

/**
 * Crea o modifica un registro y deja en el historial un `Cambio` por cada campo modificado.
 * Al guardar también actualiza `actualizado_*` y `verificado_*` (D-045: si lo editaste, lo viste).
 * Un registro sin `id` es un alta. Para una credencial, un secreto vacío o null significa «no cambia».
 * @param {string} coleccion
 * @param {any} registro
 * @param {string} usuarioId Quién lo hace.
 * @param {{motivo?: string}} [opciones]
 */
export async function guardar(coleccion, registro, usuarioId, opciones) {
  await iniciar();
  const r = armarGuardado(coleccion, registro, usuarioId, opciones);
  if (r.sinCambios) return publico(coleccion, r.nuevo);
  await persistir(r.escrituras);
  return publico(coleccion, r.nuevo);
}

/**
 * Arma lo que `guardar` escribiría (el registro nuevo y sus `Cambio`) sin tocar el almacenamiento, para poder juntar
 * varias escrituras en una sola operación atómica (`darDeBaja`, `resolverSolicitud`). Valida igual que `guardar`.
 * @param {string} coleccion @param {any} registro @param {string} usuarioId @param {{motivo?: string}} [opciones]
 * @returns {{nuevo: any, escrituras: Array<[string, any]>, sinCambios: boolean}}
 */
function armarGuardado(coleccion, registro, usuarioId, opciones) {
  if (!cache[coleccion]) throw new Error('Colección desconocida: ' + coleccion);
  const motivo = (opciones && opciones.motivo) || null;
  const ahora = ahoraISO();
  const previo = registro.id ? cache[coleccion].get(registro.id) : null;
  /** @type {Cambio[]} */
  const cambios = [];
  let nuevo;
  if (!previo) {
    nuevo = structuredClone(registro);
    nuevo.id = nuevo.id || crypto.randomUUID();
    if (COLECCIONES_COMUNES.includes(coleccion)) {
      Object.assign(nuevo, { creado_en: ahora, creado_por: usuarioId, actualizado_en: ahora, actualizado_por: usuarioId,
        eliminado_en: null, eliminado_por: null, verificado_en: ahora, verificado_por: usuarioId });
    }
    if (coleccion === 'credenciales') nuevo.credencial_secreto_actualizado_en = ahora;
    if (coleccion === 'equipos' && !nuevo.equipo_codigo) nuevo.equipo_codigo = siguienteCodigo(nuevo);
    cambios.push(nuevoCambio(coleccion, nuevo, 'alta', null, null, null, usuarioId, motivo));
  } else {
    nuevo = structuredClone(previo);
    const entrante = structuredClone(registro);
    if (coleccion === 'credenciales' && !entrante.credencial_secreto) entrante.credencial_secreto = previo.credencial_secreto;
    for (const k of Object.keys(entrante)) {
      if (CLAVES_ESTANDAR.includes(k)) continue;
      if (k === 'eliminado_en' || k === 'eliminado_por') continue;
      if (k === 'equipo_campos' && entrante[k] && typeof entrante[k] === 'object') {
        const claves = new Set([...Object.keys(previo[k] || {}), ...Object.keys(entrante[k])]);
        for (const c of claves) {
          if (JSON.stringify((previo[k] || {})[c]) !== JSON.stringify(entrante[k][c])) cambios.push(nuevoCambio(coleccion, previo, 'modificacion', c, (previo[k] || {})[c], entrante[k][c], usuarioId, motivo));
        }
        nuevo[k] = entrante[k];
      } else if (JSON.stringify(previo[k]) !== JSON.stringify(entrante[k])) {
        cambios.push(nuevoCambio(coleccion, previo, 'modificacion', k, previo[k], entrante[k], usuarioId, motivo));
        nuevo[k] = entrante[k];
      }
    }
    if ('eliminado_en' in entrante && (entrante.eliminado_en || null) !== (previo.eliminado_en || null)) {
      cambios.push(nuevoCambio(coleccion, previo, entrante.eliminado_en ? 'baja' : 'restauracion', null, null, null, usuarioId, motivo));
      nuevo.eliminado_en = entrante.eliminado_en ? ahora : null;
      nuevo.eliminado_por = entrante.eliminado_en ? usuarioId : null;
    }
    if (!cambios.length) return { nuevo: previo, escrituras: [], sinCambios: true };
    if (coleccion === 'credenciales' && cambios.some(c => c.cambio_campo === 'credencial_secreto')) nuevo.credencial_secreto_actualizado_en = ahora;
    if (COLECCIONES_COMUNES.includes(coleccion)) Object.assign(nuevo, { actualizado_en: ahora, actualizado_por: usuarioId, verificado_en: ahora, verificado_por: usuarioId });
  }
  validarEscritura(coleccion, nuevo);
  return { nuevo, escrituras: /** @type {Array<[string, any]>} */ ([[coleccion, nuevo]]).concat(cambios.map(c => /** @type {[string, any]} */ (['cambios', c]))), sinCambios: false };
}

/** Colecciones con posición en el plano (`plano_x`, `plano_y`). */
const CON_POSICION_EN_PLANO = ['equipos', 'racks', 'puestos'];

/**
 * Arma, sin escribir, la baja de un registro con todas sus dependencias (regla 5 de `docs/modelo-de-datos.md`):
 * equipo → sus puertos (baja), las conexiones de los puertos de la otra punta (se limpian), sus asignaciones e instalaciones
 * de licencia vigentes (se cierran hoy) y su posición en el plano (se quita); persona → sus asignaciones vigentes (se cierran);
 * licencia → sus instalaciones vigentes (se cierran); rack y puesto → su posición en el plano; y en todos los casos las relaciones
 * donde participa (baja). Devuelve las escrituras listas para `persistir`.
 * @param {string} coleccion @param {string} id @param {string} usuarioId @param {string} [motivo]
 * @returns {Array<[string, any]>}
 */
function armarBaja(coleccion, id, usuarioId, motivo) {
  const reg = cache[coleccion] && cache[coleccion].get(id);
  if (!reg || reg.eliminado_en) throw new Error('El registro no existe o ya está dado de baja.');
  if (coleccion === 'cambios' || coleccion === 'registro_accesos') throw new Error('Este registro no se da de baja.');
  const ahora = ahoraISO(), hoy = hoyISO();
  const entidad = ENTIDAD_DE_COLECCION[coleccion];
  /** @type {Map<string, [string, any]>} */ const porRegistro = new Map();
  /** @type {Array<[string, any]>} */ const cambios = [];
  /** Suma el cambio de un registro (si ya había uno armado en esta operación, parte de ese). @param {string} col @param {any} r @param {any} cambio @param {string} m */
  const sumar = (col, r, cambio, m) => {
    const base = porRegistro.get(col + ':' + r.id);
    const a = armarGuardado(col, { ...publico(col, base ? base[1] : r), ...cambio }, usuarioId, { motivo: m });
    if (a.sinCambios) return;
    for (const w of a.escrituras) { if (w[0] === 'cambios') cambios.push(w); else porRegistro.set(col + ':' + r.id, w); }
  };
  const m = motivo || 'Baja';
  const sub = 'Baja de «' + (nombreDe(coleccion, reg) || id) + '»';
  sumar(coleccion, reg, { eliminado_en: ahora, ...(CON_POSICION_EN_PLANO.includes(coleccion) && (reg.plano_x != null || reg.plano_y != null) ? { plano_x: null, plano_y: null } : {}) }, m);
  const vivo = (/** @type {any} */ x) => !x.eliminado_en;
  if (coleccion === 'equipos') {
    const propios = Array.from(cache.puertos.values()).filter(p => p.equipo_id === id && vivo(p));
    const ids = new Set(propios.map(p => p.id));
    for (const p of cache.puertos.values()) {
      if (p.equipo_id !== id && vivo(p) && (ids.has(p.conectado_a_puerto_id) || p.conectado_a_equipo_id === id)) sumar('puertos', p, { conectado_a_equipo_id: null, conectado_a_puerto_id: null }, sub);
    }
    for (const p of propios) sumar('puertos', p, { eliminado_en: ahora }, sub);
    for (const a of cache.asignaciones.values()) if (a.equipo_id === id && vivo(a) && !a.asignacion_hasta) sumar('asignaciones', a, { asignacion_hasta: hoy }, sub);
    for (const i of cache.instalaciones_licencia.values()) if (i.equipo_id === id && vivo(i) && !i.instalacion_hasta) sumar('instalaciones_licencia', i, { instalacion_hasta: hoy }, sub);
  } else if (coleccion === 'personas') {
    for (const a of cache.asignaciones.values()) if (a.persona_id === id && vivo(a) && !a.asignacion_hasta) sumar('asignaciones', a, { asignacion_hasta: hoy }, sub);
  } else if (coleccion === 'licencias') {
    for (const i of cache.instalaciones_licencia.values()) if (i.licencia_id === id && vivo(i) && !i.instalacion_hasta) sumar('instalaciones_licencia', i, { instalacion_hasta: hoy }, sub);
  }
  for (const x of cache.relaciones.values()) {
    if (vivo(x) && ((x.origen_entidad === entidad && x.origen_id === id) || (x.destino_entidad === entidad && x.destino_id === id))) sumar('relaciones', x, { eliminado_en: ahora }, sub);
  }
  return [...porRegistro.values(), ...cambios];
}

/** Nombre corto de un registro para los motivos del historial. @param {string} coleccion @param {any} r */
function nombreDe(coleccion, r) {
  const k = { equipos: 'equipo_nombre', personas: 'persona_nombre', licencias: 'licencia_producto', racks: 'rack_nombre', puestos: 'puesto_nombre', organizaciones: 'organizacion_nombre' }[/** @type {'equipos'} */ (coleccion)];
  return k ? r[k] : '';
}

/**
 * Da de baja un registro con todas sus dependencias, en UNA sola operación atómica (D-006; regla 5 del modelo).
 * Las vistas llaman a esta función; nunca arman la baja a mano. Quien la llama debe haber comprobado el permiso `baja`.
 * @param {string} coleccion @param {string} id
 * @param {{usuarioId: string, motivo?: string}} datos
 */
export async function darDeBaja(coleccion, id, datos) {
  await iniciar();
  await persistir(armarBaja(coleccion, id, datos.usuarioId, (datos.motivo || '').trim() || undefined));
}

/**
 * Reglas del modelo que se comprueban al guardar (lanza un error con el motivo). Ver `docs/modelo-de-datos.md`, sección 5.
 * @param {string} coleccion @param {any} r
 */
function validarEscritura(coleccion, r) {
  if (coleccion === 'equipos' || coleccion === 'racks' || coleccion === 'puestos') validarPlano(r);
  if (coleccion === 'puertos') validarPuerto(r);
  if (coleccion === 'equipos') {
    if (!r.equipo_codigo) throw new Error('El equipo necesita un código.');
    if (esImpresora(r)) validarImpresora(r);
    const repetido = Array.from(cache.equipos.values()).find(x => x.id !== r.id && x.organizacion_id === r.organizacion_id && x.equipo_codigo === r.equipo_codigo);
    if (repetido) throw new Error('Ya hay un equipo con el código «' + r.equipo_codigo + '» en esta organización.');
  } else if (coleccion === 'asignaciones') {
    const e = cache.equipos.get(r.equipo_id), p = cache.personas.get(r.persona_id);
    if (!e || !p) throw new Error('La asignación necesita un equipo y una persona que existan.');
    if (e.organizacion_id !== r.organizacion_id || p.organizacion_id !== r.organizacion_id) throw new Error('El equipo y la persona tienen que ser de la misma organización.');
    if (r.asignacion_hasta && r.asignacion_hasta < r.asignacion_desde) throw new Error('La asignación no puede terminar antes de empezar.');
    if (!r.asignacion_hasta && !r.eliminado_en) {
      // Un equipo puede tener varias personas a la vez (D-072), pero no la misma persona dos veces.
      const repetida = Array.from(cache.asignaciones.values()).find(x => x.id !== r.id && x.equipo_id === r.equipo_id && x.persona_id === r.persona_id && !x.asignacion_hasta && !x.eliminado_en);
      if (repetida) throw new Error('El equipo ya está asignado a esa persona.');
    }
  } else if (coleccion === 'mapeos_disco') {
    if (r.mapeo_aplica_a === 'grupo' && !r.mapeo_grupo) throw new Error('Falta indicar el grupo al que aplica el mapeo.');
    if (r.mapeo_aplica_a === 'persona' && !r.persona_id) throw new Error('Falta indicar la persona a la que aplica el mapeo.');
  } else if (coleccion === 'servicios') {
    validarServicio(r);
  } else if (coleccion === 'tramos_fibra') {
    validarTramo(r);
  } else if (coleccion === 'archivos') {
    validarArchivo(r);
  } else if (coleccion === 'relaciones') {
    validarRelacion(r);
  } else if (coleccion === 'instalaciones_licencia') {
    const l = cache.licencias.get(r.licencia_id), e = cache.equipos.get(r.equipo_id);
    if (!l || !e || l.organizacion_id !== r.organizacion_id || e.organizacion_id !== r.organizacion_id) throw new Error('La instalación necesita una licencia y un equipo de la misma organización.');
  }
}

/** Posición en el plano (MJ44): `plano_x` y `plano_y` van juntas, entre 0 y 1 (relativas al plano), o ninguna. @param {any} r */
function validarPlano(r) {
  const x = r.plano_x, y = r.plano_y;
  const vacio = (/** @type {any} */ v) => v === undefined || v === null;
  if (vacio(x) && vacio(y)) return;
  const ok = (/** @type {any} */ v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!ok(x) || !ok(y)) throw new Error('La posición en el plano tiene que tener X e Y entre 0 y 1.');
}

/**
 * Reglas de una impresora (D-072): `impresora_conexion` es `red` o `usb`; `impresora_pc_id` solo tiene sentido con `usb` y apunta
 * a otro equipo de la misma organización (si la conexión no es USB se deja en null).
 * @param {any} r
 */
function validarImpresora(r) {
  const c = r.equipo_campos || (r.equipo_campos = {});
  if (c.impresora_conexion != null && c.impresora_conexion !== '' && !['red', 'usb'].includes(c.impresora_conexion)) throw new Error('La conexión de la impresora tiene que ser «Red» o «USB / local».');
  if (!c.impresora_conexion) c.impresora_conexion = 'red';
  if (c.impresora_conexion !== 'usb') { c.impresora_pc_id = null; return; }
  if (!c.impresora_pc_id) { c.impresora_pc_id = null; return; }
  const pc = cache.equipos.get(c.impresora_pc_id);
  if (!pc || pc.eliminado_en) throw new Error('La computadora a la que está conectada la impresora no existe.');
  if (pc.id === r.id) throw new Error('Una impresora no puede estar conectada a sí misma.');
  if (pc.organizacion_id !== r.organizacion_id) throw new Error('La computadora y la impresora tienen que ser de la misma organización.');
  if (esImpresora(pc)) throw new Error('Una impresora USB se conecta a una computadora, no a otra impresora.');
}

/**
 * Un puerto de router o firewall puede salir a un enlace de Internet (`enlace_isp_id`, D-072): el enlace tiene que existir y ser
 * de la misma organización que el equipo. En otros equipos el campo queda en null.
 * @param {any} r
 */
function validarPuerto(r) {
  if (!r.enlace_isp_id) { r.enlace_isp_id = null; return; }
  const e = cache.equipos.get(r.equipo_id), l = cache.enlaces_isp.get(r.enlace_isp_id);
  if (!l || l.eliminado_en) throw new Error('El enlace a Internet del puerto no existe.');
  if (!e || !['router', 'firewall'].includes(e.equipo_tipo)) throw new Error('Solo un puerto de router o firewall puede ir a un enlace a Internet.');
  if (e.organizacion_id !== l.organizacion_id) throw new Error('El enlace y el equipo tienen que ser de la misma organización.');
}

/** @param {any} r */
function validarServicio(r) {
  if (!ROTULO_SERVICIO_TIPO[r.servicio_tipo]) throw new Error('El tipo de servicio no es válido.');
  if (!String(r.servicio_nombre || '').trim()) throw new Error('El servicio necesita un nombre.');
  if (r.servicio_vence_en && !/^\d{4}-\d{2}-\d{2}$/.test(r.servicio_vence_en)) throw new Error('El vencimiento tiene que ser una fecha válida.');
  if (r.credencial_id) {
    const c = cache.credenciales.get(r.credencial_id);
    if (!c || c.organizacion_id !== r.organizacion_id) throw new Error('La credencial del servicio tiene que ser de la misma organización.');
  }
  if (!Array.isArray(r.servicio_registros)) throw new Error('Los registros del servicio tienen que ser una lista.');
  for (const g of r.servicio_registros) {
    if (!g || !TIPOS_REGISTRO_DNS.includes(g.tipo)) throw new Error('Un registro DNS tiene un tipo que no existe (' + (g && g.tipo) + ').');
    if (!String(g.nombre || '').trim() || !String(g.valor || '').trim()) throw new Error('Cada registro DNS necesita nombre y valor.');
    if (g.tipo === 'MX' && g.prioridad != null && !Number.isInteger(g.prioridad)) throw new Error('La prioridad de un registro MX es un número entero.');
  }
}

/** @param {any} r */
function validarTramo(r) {
  if (!String(r.tramo_nombre || '').trim()) throw new Error('El tramo necesita un nombre.');
  const ub = (/** @type {string|null} */ id) => (id ? cache.ubicaciones.get(id) : null);
  for (const c of ['tramo_origen_ubicacion_id', 'tramo_destino_ubicacion_id']) {
    const u = ub(r[c]);
    if (!u || u.organizacion_id !== r.organizacion_id) throw new Error('El origen y el destino del tramo tienen que ser ubicaciones de la organización.');
  }
  if (r.tramo_origen_ubicacion_id === r.tramo_destino_ubicacion_id && (!r.tramo_origen_equipo_id || r.tramo_origen_equipo_id === r.tramo_destino_equipo_id)) throw new Error('El origen y el destino del tramo no pueden ser el mismo.');
  for (const c of ['tramo_origen_equipo_id', 'tramo_destino_equipo_id']) {
    if (!r[c]) continue;
    const e = cache.equipos.get(r[c]);
    if (!e || e.organizacion_id !== r.organizacion_id) throw new Error('La patchera del tramo tiene que ser un equipo de la organización.');
  }
  if (!Number.isInteger(r.tramo_pelos) || r.tramo_pelos < 1) throw new Error('El tramo tiene que tener al menos un pelo.');
  if (!ROTULO_FIBRA_TIPO[r.tramo_tipo]) throw new Error('El tipo de fibra tiene que ser monomodo o multimodo.');
  if (!CONECTORES_FIBRA.includes(r.tramo_conector)) throw new Error('El conector tiene que ser LC, SC o ST.');
  if (r.tramo_longitud_m != null && !(typeof r.tramo_longitud_m === 'number' && r.tramo_longitud_m >= 0)) throw new Error('La longitud del tramo tiene que ser un número positivo.');
  const usados = new Set();
  for (const u of r.tramo_pelos_usados || []) {
    if (!Number.isInteger(u.pelo) || u.pelo < 1 || u.pelo > r.tramo_pelos) throw new Error('Un pelo usado (' + u.pelo + ') no existe en un tramo de ' + r.tramo_pelos + ' pelos.');
    if (usados.has(u.pelo)) throw new Error('El pelo ' + u.pelo + ' está repetido en los pelos usados.');
    usados.add(u.pelo);
  }
  for (const m of r.tramo_mediciones || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.fecha || '')) throw new Error('Cada medición necesita una fecha válida.');
    if (!Number.isInteger(m.pelo) || m.pelo < 1 || m.pelo > r.tramo_pelos) throw new Error('Una medición es de un pelo que no existe (' + m.pelo + ').');
    if (typeof m.atenuacion_db !== 'number' || !Number.isFinite(m.atenuacion_db)) throw new Error('Cada medición necesita la atenuación en dB.');
  }
}

/** @param {number} bytes */
function textoTamano(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

/** @param {any} r */
function validarArchivo(r) {
  if (!ROTULO_ARCHIVO_TIPO[r.archivo_tipo]) throw new Error('El tipo de archivo tiene que ser plano, foto u otro.');
  if (!String(r.archivo_nombre || '').trim()) throw new Error('El archivo necesita un nombre.');
  if (typeof r.archivo_contenido !== 'string' || !r.archivo_contenido.startsWith('data:')) throw new Error('El contenido del archivo no es válido.');
  if (!(r.archivo_bytes > 0)) throw new Error('El archivo está vacío.');
  if (r.archivo_bytes > LIMITE_ARCHIVO_BYTES) throw new Error('El archivo pesa ' + textoTamano(r.archivo_bytes) + ' y el máximo es ' + textoTamano(LIMITE_ARCHIVO_BYTES) + '.');
  const col = COLECCION_DE_ENTIDAD[r.entidad];
  const reg = col && cache[col] ? cache[col].get(r.entidad_id) : null;
  if (!reg || orgDe(col, reg) !== r.organizacion_id) throw new Error('El archivo tiene que colgar de una ficha de la misma organización.');
}

/** @param {any} r */
function validarRelacion(r) {
  if (!COLECCION_DE_ENTIDAD[r.origen_entidad] || !COLECCION_DE_ENTIDAD[r.destino_entidad]) throw new Error('La relación apunta a una ficha que no existe.');
  if (r.origen_entidad === r.destino_entidad && r.origen_id === r.destino_id) throw new Error('Una ficha no se puede relacionar consigo misma.');
  for (const lado of ['origen', 'destino']) {
    const col = COLECCION_DE_ENTIDAD[r[lado + '_entidad']];
    const reg = cache[col] && cache[col].get(r[lado + '_id']);
    if (!reg) throw new Error('La relación apunta a una ficha que no existe.');
    if (orgDe(col, reg) !== r.organizacion_id) throw new Error('Las dos fichas de una relación tienen que ser de la misma organización.');
  }
  if (!r.eliminado_en) {
    const par = (/** @type {any} */ x) => (x.origen_entidad === r.origen_entidad && x.origen_id === r.origen_id && x.destino_entidad === r.destino_entidad && x.destino_id === r.destino_id)
      || (x.origen_entidad === r.destino_entidad && x.origen_id === r.destino_id && x.destino_entidad === r.origen_entidad && x.destino_id === r.origen_id);
    if (Array.from(cache.relaciones.values()).some(x => x.id !== r.id && !x.eliminado_en && par(x))) throw new Error('Esas dos fichas ya están relacionadas.');
  }
}

/**
 * «Confirmar vigente»: alguien comprobó en el lugar que lo documentado sigue siendo real (D-041).
 * Actualiza `verificado_*` sin cambiar datos (no genera un `Cambio`).
 * @param {string} coleccion @param {string} id @param {string} usuarioId
 */
export async function confirmarVigente(coleccion, id, usuarioId) {
  await iniciar();
  const r = cache[coleccion] && cache[coleccion].get(id);
  if (!r || r.eliminado_en || !COLECCIONES_COMUNES.includes(coleccion)) throw new Error('No se puede confirmar ese registro.');
  const nuevo = { ...r, verificado_en: ahoraISO(), verificado_por: usuarioId };
  await persistir([[coleccion, nuevo]]);
  return publico(coleccion, nuevo);
}

// ---------------------------------------------------------------------------------------------
// Credenciales: secretos y accesos
// ---------------------------------------------------------------------------------------------

/**
 * Entrega el secreto de una credencial (el único camino para leerlo) y deja el registro de acceso (regla 4).
 * Quien la llama debe haber comprobado `puedeVerSecreto` antes.
 * @param {string} credencialId @param {string} usuarioId @param {'mostrar'|'copiar'} accion
 * @returns {Promise<string>}
 */
export async function usarSecreto(credencialId, usuarioId, accion) {
  await iniciar();
  const c = cache.credenciales.get(credencialId);
  if (!c || c.eliminado_en) throw new Error('La credencial no existe.');
  await persistir([['registro_accesos', {
    id: crypto.randomUUID(), credencial_id: c.id, organizacion_id: c.organizacion_id, usuario_id: usuarioId,
    registro_accion: accion, cambio_id: null, registro_fecha: ahoraISO()
  }]]);
  return c.credencial_secreto;
}

// ---------------------------------------------------------------------------------------------
// Solicitudes y aprobaciones
// ---------------------------------------------------------------------------------------------

/**
 * Pide ver el secreto de una credencial. Si ya hay un pedido pendiente del mismo usuario, devuelve ese.
 * @param {{credencialId: string, usuarioId: string, motivo?: string}} datos
 * @returns {Promise<{solicitud: Solicitud, yaExistia: boolean}>}
 */
export async function crearSolicitudVerSecreto(datos) {
  await iniciar();
  const c = cache.credenciales.get(datos.credencialId);
  if (!c || c.eliminado_en) throw new Error('La credencial no existe.');
  for (const s of cache.solicitudes.values()) {
    if (s.solicitud_tipo === 'ver_secreto' && s.solicitud_estado === 'pendiente' && s.solicitado_por === datos.usuarioId && s.solicitud_entidad_id === c.id) {
      return { solicitud: structuredClone(s), yaExistia: true };
    }
  }
  /** @type {Solicitud} */
  const s = {
    id: crypto.randomUUID(), organizacion_id: c.organizacion_id, solicitud_tipo: 'ver_secreto', solicitud_entidad: 'Credencial',
    solicitud_entidad_id: c.id, solicitado_por: datos.usuarioId, solicitado_en: ahoraISO(), solicitud_alcance: null,
    solicitud_motivo: (datos.motivo || '').trim() || null, solicitud_estado: 'pendiente', resuelto_por: null, resuelto_en: null,
    solicitud_revocada_por: null, solicitud_revocada_en: null
  };
  await persistir([['solicitudes', s], ['cambios', nuevoCambio('solicitudes', s, 'alta', null, null, null, datos.usuarioId, null)]]);
  return { solicitud: structuredClone(s), yaExistia: false };
}

/**
 * Aprueba o rechaza una solicitud. Al aprobar un `ver_secreto` hay que indicar el alcance (D-029, PE13).
 * Quien la llama debe haber comprobado `puedeResolverSolicitud`.
 * @param {string} solicitudId
 * @param {'aprobada'|'rechazada'} resultado
 * @param {string} usuarioId Quién resuelve.
 * @param {'credencial'|'tipo_credencial'|null} [alcance]
 */
export async function resolverSolicitud(solicitudId, resultado, usuarioId, alcance) {
  await iniciar();
  const s = cache.solicitudes.get(solicitudId);
  if (!s || s.solicitud_estado !== 'pendiente') throw new Error('La solicitud ya no está pendiente.');
  if (resultado === 'aprobada' && s.solicitud_tipo === 'ver_secreto' && !alcance) throw new Error('Falta indicar el alcance de la aprobación.');
  const nueva = { ...s, solicitud_estado: resultado, resuelto_por: usuarioId, resuelto_en: ahoraISO(),
    solicitud_alcance: resultado === 'aprobada' && s.solicitud_tipo === 'ver_secreto' ? alcance : null };
  /** @type {Array<[string, any]>} */
  const ops = [['solicitudes', nueva], ['cambios', nuevoCambio('solicitudes', nueva, 'modificacion', 'solicitud_estado', 'pendiente', resultado, usuarioId, null)]];
  // Baja aprobada (PE1, D-027): se aplica en la misma operación que la resolución.
  if (resultado === 'aprobada' && s.solicitud_tipo === 'baja_registro') {
    const col = COLECCION_DE_ENTIDAD[s.solicitud_entidad];
    const reg = col && cache[col] ? cache[col].get(s.solicitud_entidad_id) : null;
    if (reg && !reg.eliminado_en) ops.push(...armarBaja(col, reg.id, usuarioId, 'Baja aprobada: ' + (s.solicitud_motivo || '')));
  }
  await persistir(ops);
  return structuredClone(nueva);
}

/**
 * Pide dar de baja un registro (técnico, PE1): queda pendiente hasta que lo confirma el superadmin.
 * @param {{coleccion: string, id: string, usuarioId: string, motivo?: string}} datos
 */
export async function crearSolicitudBaja(datos) {
  await iniciar();
  const reg = cache[datos.coleccion] && cache[datos.coleccion].get(datos.id);
  if (!reg || reg.eliminado_en) throw new Error('El registro no existe o ya está dado de baja.');
  const ya = [...cache.solicitudes.values()].some(x => x.solicitud_tipo === 'baja_registro' && x.solicitud_entidad_id === datos.id && x.solicitud_estado === 'pendiente');
  if (ya) throw new Error('Ya hay un pedido de baja pendiente para este registro.');
  const s = {
    id: crypto.randomUUID(), organizacion_id: orgDe(datos.coleccion, reg), solicitud_tipo: 'baja_registro',
    solicitud_entidad: ENTIDAD_DE_COLECCION[datos.coleccion], solicitud_entidad_id: datos.id,
    solicitado_por: datos.usuarioId, solicitado_en: ahoraISO(), solicitud_alcance: null, solicitud_motivo: datos.motivo || null,
    solicitud_estado: 'pendiente', resuelto_por: null, resuelto_en: null, solicitud_revocada_por: null, solicitud_revocada_en: null
  };
  await persistir([['solicitudes', s], ['cambios', nuevoCambio('solicitudes', s, 'alta', null, null, null, datos.usuarioId, null)]]);
  return structuredClone(s);
}

/**
 * Devuelve un valor anterior oculto del historial (por ejemplo una contraseña vieja) y registra el acceso (D-018).
 * Quien llama tiene que haber validado `puedeVerSecreto` sobre la credencial.
 * @param {string} cambioId @param {string} usuarioId @param {'mostrar'|'copiar'} accion
 * @returns {Promise<{anterior: any, nuevo: any}>}
 */
export async function usarValorHistorial(cambioId, usuarioId, accion) {
  await iniciar();
  const c = cache.cambios.get(cambioId);
  if (!c || !c.cambio_valor_oculto) throw new Error('Ese cambio no tiene valores ocultos.');
  const cred = c.cambio_entidad === 'Credencial' ? cache.credenciales.get(c.entidad_id) : null;
  if (!cred) throw new Error('El cambio no pertenece a una credencial.');
  await persistir([['registro_accesos', {
    id: crypto.randomUUID(), credencial_id: cred.id, organizacion_id: cred.organizacion_id, usuario_id: usuarioId,
    registro_accion: accion, cambio_id: c.id, registro_fecha: ahoraISO()
  }]]);
  const leer = (/** @type {any} */ v) => { try { return v == null ? null : JSON.parse(v); } catch (e) { return v; } };
  return { anterior: leer(c.cambio_valor_anterior), nuevo: leer(c.cambio_valor_nuevo) };
}

/**
 * Quita una aprobación vigente (regla 2: la quita un rol superior al que la tiene).
 * @param {string} solicitudId @param {string} usuarioId
 */
export async function quitarAprobacion(solicitudId, usuarioId) {
  await iniciar();
  const s = cache.solicitudes.get(solicitudId);
  if (!s || s.solicitud_estado !== 'aprobada' || s.solicitud_revocada_en) throw new Error('Esa aprobación ya no está vigente.');
  const nueva = { ...s, solicitud_revocada_por: usuarioId, solicitud_revocada_en: ahoraISO() };
  await persistir([['solicitudes', nueva], ['cambios', nuevoCambio('solicitudes', nueva, 'modificacion', 'solicitud_revocada_en', null, nueva.solicitud_revocada_en, usuarioId, null)]]);
}

/**
 * Aprobaciones vigentes (aprobadas y no quitadas) para ver secretos de un usuario.
 * @param {string} usuarioId
 * @returns {Promise<Aprobacion[]>}
 */
export async function aprobacionesVigentes(usuarioId) {
  await iniciar();
  /** @type {Aprobacion[]} */
  const salida = [];
  for (const s of cache.solicitudes.values()) {
    if (s.solicitud_tipo !== 'ver_secreto' || s.solicitud_estado !== 'aprobada' || s.solicitud_revocada_en || s.solicitado_por !== usuarioId) continue;
    const c = cache.credenciales.get(s.solicitud_entidad_id);
    if (!c) continue;
    salida.push({ solicitud_id: s.id, organizacion_id: s.organizacion_id, alcance: s.solicitud_alcance || 'credencial', credencial_id: c.id, credencial_tipo: c.credencial_tipo });
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// Personas, asignaciones de equipos, mudanzas y licencias (D-066, D-067)
// ---------------------------------------------------------------------------------------------

/**
 * Módulo de permisos de una ficha concreta (sin entidad = la organización). Las notas, los archivos y las relaciones siguen
 * el módulo de la ficha de la que cuelgan.
 * @param {string|null} entidad Nombre de la entidad (por ejemplo «Equipo»).
 * @param {string|null} entidadId
 * @returns {import('./modelos.js').Modulo}
 */
function moduloDeFicha(entidad, entidadId) {
  if (!entidad) return 'organizacion';
  const col = COLECCION_DE_ENTIDAD[entidad];
  const reg = col && cache[col] && entidadId ? cache[col].get(entidadId) : null;
  if (reg && entidad === 'Nota') return moduloDeFicha(reg.entidad, reg.entidad_id);
  if (reg && entidad === 'Archivo') return moduloDeFicha(reg.entidad, reg.entidad_id);
  if (reg && entidad === 'Relacion') return moduloDeFicha(reg.origen_entidad, reg.origen_id);
  return moduloDeEntidadModelo(entidad, reg || undefined);
}

/** @param {{entidad: string|null, entidad_id: string|null}} n */
function moduloNota(n) { return moduloDeFicha(n.entidad, n.entidad_id); }

/**
 * Módulo de permisos que decide quién ve una nota (las de la organización, `organizacion`; las de una ficha, el módulo de esa ficha).
 * @param {{entidad: string|null, entidad_id: string|null}} nota
 * @returns {Promise<import('./modelos.js').Modulo>}
 */
export async function moduloDeNota(nota) { await iniciar(); return moduloNota(nota); }

/**
 * Módulo de permisos de una ficha (D-066): para decidir si un usuario ve o modifica sus notas, archivos y relaciones.
 * Generaliza `moduloDeNota`. Con `entidad = null` es la organización.
 * @param {string|null} entidad Nombre de la entidad (por ejemplo «Equipo», «Servicio»).
 * @param {string|null} [entidadId]
 * @returns {Promise<import('./modelos.js').Modulo>}
 */
export async function moduloDeEntidad(entidad, entidadId) { await iniciar(); return moduloDeFicha(entidad, entidadId || null); }

/**
 * Las asignaciones vigentes de un equipo (las que no tienen fecha de fin), de la más reciente a la más antigua. Un equipo
 * puede estar compartido por varias personas a la vez (D-072).
 * @param {string} equipoId
 * @returns {Promise<Asignacion[]>}
 */
export async function asignacionesVigentes(equipoId) {
  await iniciar();
  return vigentesSync(equipoId).map(a => publico('asignaciones', a));
}

/** @param {string} equipoId @returns {any[]} Sin copiar: solo para uso interno. */
function vigentesSync(equipoId) {
  const lista = [];
  for (const a of cache.asignaciones.values()) if (a.equipo_id === equipoId && !a.asignacion_hasta && !a.eliminado_en) lista.push(a);
  return lista.sort((a, b) => (a.asignacion_desde < b.asignacion_desde ? 1 : a.asignacion_desde > b.asignacion_desde ? -1 : a.creado_en < b.creado_en ? 1 : a.creado_en > b.creado_en ? -1 : 0));
}

/**
 * La asignación vigente más reciente de un equipo, o null si nadie lo tiene hoy. Se mantiene por compatibilidad: con un equipo
 * compartido hay más de una vigente (usar `asignacionesVigentes`).
 * @param {string} equipoId
 * @returns {Promise<Asignacion|null>}
 */
export async function asignacionVigente(equipoId) {
  const lista = await asignacionesVigentes(equipoId);
  return lista[0] || null;
}

/**
 * Entrega un equipo a una persona desde hoy.
 * - Sin `compartir`: si el equipo ya estaba asignado a otras personas, cierra esas asignaciones (hasta hoy) en la misma operación.
 * - Con `compartir`: suma la asignación y deja las otras vigentes (equipo compartido, D-072).
 * Si ya era de esta persona, no cambia nada. Todo queda en el historial.
 * @param {{equipoId: string, personaId: string, motivo?: string|null, usuarioId: string, compartir?: boolean}} datos
 * @returns {Promise<Asignacion>} La asignación vigente de esa persona.
 */
export async function asignarEquipo(datos) {
  await iniciar();
  const e = cache.equipos.get(datos.equipoId), p = cache.personas.get(datos.personaId);
  if (!e || e.eliminado_en) throw new Error('El equipo no existe.');
  if (!p || p.eliminado_en) throw new Error('La persona no existe.');
  if (p.persona_estado === 'baja') throw new Error('La persona está dada de baja: no se le puede asignar un equipo.');
  if (e.organizacion_id !== p.organizacion_id) throw new Error('El equipo y la persona son de organizaciones distintas.');
  const hoy = hoyISO();
  const vigentes = vigentesSync(datos.equipoId);
  const propia = vigentes.find(a => a.persona_id === datos.personaId);
  if (propia) return publico('asignaciones', propia);
  if (!datos.compartir) {
    for (const v of vigentes) await guardar('asignaciones', { ...publico('asignaciones', v), asignacion_hasta: hoy }, datos.usuarioId, { motivo: 'Se asignó a otra persona.' });
  }
  return guardar('asignaciones', {
    organizacion_id: e.organizacion_id, equipo_id: e.id, persona_id: p.id, asignacion_desde: hoy, asignacion_hasta: null,
    asignacion_motivo: (datos.motivo || '').trim() || null, asignacion_observaciones: null
  }, datos.usuarioId);
}

/**
 * Cierra asignaciones vigentes de un equipo (hasta hoy): la persona lo devolvió.
 * - Con `personaId`: cierra solo la de esa persona (el equipo sigue con las demás, si las hay).
 * - Sin `personaId`: cierra todas las vigentes y el equipo queda sin asignar.
 * @param {{equipoId: string, personaId?: string|null, usuarioId: string, observaciones?: string|null}} datos
 * @returns {Promise<Asignacion>} La asignación cerrada (si fueron varias, la más reciente).
 */
export async function devolverEquipo(datos) {
  await iniciar();
  let vigentes = vigentesSync(datos.equipoId);
  if (datos.personaId) {
    vigentes = vigentes.filter(a => a.persona_id === datos.personaId);
    if (!vigentes.length) throw new Error('Esa persona no tiene el equipo asignado.');
  }
  if (!vigentes.length) throw new Error('El equipo no está asignado a nadie.');
  const obs = (datos.observaciones || '').trim();
  /** @type {Asignacion|null} */
  let cerrada = null;
  for (const v of vigentes) {
    const c = await guardar('asignaciones', {
      ...publico('asignaciones', v), asignacion_hasta: hoyISO(),
      asignacion_observaciones: obs ? (v.asignacion_observaciones ? v.asignacion_observaciones + ' ' + obs : obs) : v.asignacion_observaciones
    }, datos.usuarioId, { motivo: 'Devolución del equipo.' });
    if (!cerrada) cerrada = c;
  }
  return /** @type {Asignacion} */ (cerrada);
}

/**
 * VLAN nativa del puerto de switch al que llega un puesto (boca de patchera → puerto de switch), o null si el puesto
 * no tiene boca, no está conectado a un switch o el puerto no tiene VLAN.
 * @param {string|null} puestoId
 * @returns {Promise<Vlan|null>}
 */
export async function vlanDePuesto(puestoId) {
  await iniciar();
  return vlanDePuestoSync(puestoId);
}

/** @param {string|null} puestoId */
function vlanDePuestoSync(puestoId) {
  if (!puestoId) return null;
  for (const boca of cache.puertos.values()) {
    if (boca.puesto_id !== puestoId || boca.eliminado_en) continue;
    const swp = boca.conectado_a_puerto_id ? cache.puertos.get(boca.conectado_a_puerto_id) : null;
    const v = swp && !swp.eliminado_en && swp.vlan_nativa_id ? cache.vlans.get(swp.vlan_nativa_id) : null;
    if (v && !v.eliminado_en) return structuredClone(v);
  }
  return null;
}

/**
 * Mueve un equipo de escritorio a otro puesto (mudanza sin repatchear, D-067): cambia `puesto_id` y la ubicación al
 * lugar del puesto nuevo, y avisa si cambia la VLAN del puerto al que queda conectado. Quién tiene el equipo no cambia
 * (para cambiar la asignación, `asignarEquipo`). Pasar `puestoId = null` lo saca del puesto.
 * @param {{equipoId: string, puestoId: string|null, usuarioId: string}} datos
 * @returns {Promise<{vlanAnterior: Vlan|null, vlanNueva: Vlan|null, cambiaVlan: boolean}>}
 *   `vlanAnterior` / `vlanNueva`: VLAN del puesto de antes y de ahora (null si el puesto no tiene conexión a un switch).
 *   `cambiaVlan` es true si ambas se conocen y son distintas.
 */
export async function moverEquipoAPuesto(datos) {
  await iniciar();
  const e = cache.equipos.get(datos.equipoId);
  if (!e || e.eliminado_en) throw new Error('El equipo no existe.');
  if (e.rack_id) throw new Error('Un equipo montado en un rack no se mueve a un puesto.');
  const nuevo = datos.puestoId ? cache.puestos.get(datos.puestoId) : null;
  if (datos.puestoId && (!nuevo || nuevo.eliminado_en)) throw new Error('El puesto no existe.');
  if (nuevo && nuevo.organizacion_id !== e.organizacion_id) throw new Error('El puesto es de otra organización.');
  const vlanAnterior = vlanDePuestoSync(e.puesto_id);
  const vlanNueva = vlanDePuestoSync(datos.puestoId);
  if ((e.puesto_id || null) !== (datos.puestoId || null)) {
    await guardar('equipos', { ...publico('equipos', e), puesto_id: datos.puestoId || null, ubicacion_id: nuevo ? nuevo.ubicacion_id : e.ubicacion_id }, datos.usuarioId,
      { motivo: nuevo ? 'Mudanza al puesto ' + nuevo.puesto_nombre + '.' : 'Se sacó del puesto.' });
  }
  return { vlanAnterior, vlanNueva, cambiaVlan: !!(vlanAnterior && vlanNueva && vlanAnterior.id !== vlanNueva.id) };
}

/**
 * Instalaciones de una licencia (de más reciente a más antigua), con la historia de las ya retiradas.
 * @param {string} licenciaId
 * @param {{soloVigentes?: boolean}} [opciones] `soloVigentes`: deja afuera las que ya tienen fecha de fin.
 * @returns {Promise<InstalacionLicencia[]>}
 */
export async function instalacionesDeLicencia(licenciaId, opciones) {
  await iniciar();
  const lista = [];
  for (const i of cache.instalaciones_licencia.values()) {
    if (i.licencia_id !== licenciaId || i.eliminado_en) continue;
    if (opciones && opciones.soloVigentes && i.instalacion_hasta) continue;
    lista.push(publico('instalaciones_licencia', i));
  }
  return lista.sort((a, b) => (a.instalacion_desde < b.instalacion_desde ? 1 : a.instalacion_desde > b.instalacion_desde ? -1 : 0));
}

/**
 * Cuántas instalaciones vigentes tiene una licencia frente a las compradas.
 * @param {string} licenciaId
 * @returns {Promise<{usadas: number, cantidad: number, disponibles: number, excedida: boolean, exceso: number}>}
 *   `disponibles` nunca es negativo; si hay más instalaciones que licencias, `excedida` es true y `exceso` dice cuántas de más.
 */
export async function licenciasEnUso(licenciaId) {
  await iniciar();
  const l = cache.licencias.get(licenciaId);
  if (!l || l.eliminado_en) throw new Error('La licencia no existe.');
  let usadas = 0;
  for (const i of cache.instalaciones_licencia.values()) if (i.licencia_id === licenciaId && !i.eliminado_en && !i.instalacion_hasta) usadas++;
  return { usadas, cantidad: l.licencia_cantidad, disponibles: Math.max(0, l.licencia_cantidad - usadas), excedida: usadas > l.licencia_cantidad, exceso: Math.max(0, usadas - l.licencia_cantidad) };
}

// ---------------------------------------------------------------------------------------------
// Fichas relacionadas, archivos, plano, red y mudanzas (v0.5)
// ---------------------------------------------------------------------------------------------

/** @param {any} r @param {string} entidad Título y subtítulo de una ficha para listas («Relacionado con»). */
function describir(entidad, r) {
  const f = (/** @type {string|null} */ x) => (x ? x.split('-').reverse().join('/') : '');
  const nombreEq = (/** @type {string|null} */ id) => (id && cache.equipos.get(id) ? cache.equipos.get(id).equipo_nombre : '');
  const nombreUb = (/** @type {string|null} */ id) => (id && cache.ubicaciones.get(id) ? cache.ubicaciones.get(id).ubicacion_nombre : '');
  switch (entidad) {
    case 'Equipo': return { titulo: r.equipo_nombre, subtitulo: unir(r.equipo_codigo, ROTULO_EQUIPO_TIPO[r.equipo_tipo], unir(r.equipo_marca, r.equipo_modelo)) };
    case 'Rack': return { titulo: r.rack_nombre, subtitulo: unir(nombreUb(r.ubicacion_id), r.rack_unidades_total + ' U') };
    case 'Ubicacion': return { titulo: r.ubicacion_nombre, subtitulo: unir(r.ubicacion_tipo, r.ubicacion_direccion) };
    case 'Puesto': return { titulo: r.puesto_nombre, subtitulo: nombreUb(r.ubicacion_id) };
    case 'Vlan': return { titulo: 'VLAN ' + r.vlan_numero + ' · ' + r.vlan_nombre, subtitulo: r.vlan_red_cidr || '' };
    case 'RedWifi': return { titulo: 'Wi-Fi ' + r.wifi_ssid, subtitulo: r.wifi_seguridad };
    case 'EnlaceIsp': return { titulo: 'Enlace ' + r.enlace_proveedor, subtitulo: unir(r.enlace_tipo, r.enlace_ip_publica) };
    case 'Configuracion': return { titulo: r.configuracion_titulo, subtitulo: unir(ROTULO_CONFIGURACION_TIPO[r.configuracion_tipo] || r.configuracion_tipo, nombreEq(r.equipo_id)) };
    case 'Credencial': return { titulo: r.credencial_nombre, subtitulo: unir(ROTULO_CREDENCIAL_TIPO[r.credencial_tipo] || r.credencial_tipo, nombreEq(r.equipo_id)) };
    case 'Persona': return { titulo: r.persona_nombre, subtitulo: unir(r.persona_sector, ROTULO_PERSONA_ESTADO[r.persona_estado]) };
    case 'CuentaDominio': return { titulo: r.cuenta_dominio + '\\' + r.cuenta_usuario, subtitulo: ROTULO_CUENTA_ESTADO[r.cuenta_estado] || '' };
    case 'Licencia': return { titulo: r.licencia_producto, subtitulo: unir(ROTULO_LICENCIA_TIPO[r.licencia_tipo] || r.licencia_tipo, r.licencia_vence_en ? 'vence ' + f(r.licencia_vence_en) : '') };
    case 'MapeoDisco': return { titulo: r.mapeo_letra + ' ' + r.mapeo_ruta, subtitulo: ROTULO_MAPEO_METODO[r.mapeo_metodo] || '' };
    case 'Servicio': return { titulo: r.servicio_nombre, subtitulo: unir(ROTULO_SERVICIO_TIPO[r.servicio_tipo], r.servicio_proveedor, r.servicio_vence_en ? 'vence ' + f(r.servicio_vence_en) : '') };
    case 'TramoFibra': return { titulo: r.tramo_nombre, subtitulo: unir(nombreUb(r.tramo_origen_ubicacion_id) + ' → ' + nombreUb(r.tramo_destino_ubicacion_id), r.tramo_pelos + ' pelos') };
    case 'Nota': return { titulo: r.nota_titulo, subtitulo: 'Nota' };
    case 'Archivo': return { titulo: r.archivo_nombre, subtitulo: ROTULO_ARCHIVO_TIPO[r.archivo_tipo] || '' };
    default: return { titulo: ROTULO_ENTIDAD[entidad] || entidad, subtitulo: '' };
  }
}

/**
 * Resumen de una ficha cualquiera: título, subtítulo, ruta de su pantalla y módulo de permisos. Null si no existe.
 * @param {string} entidad Nombre de la entidad (por ejemplo «Equipo»).
 * @param {string} id
 * @returns {Promise<{entidad: string, id: string, rotulo: string, titulo: string, subtitulo: string, ruta: string|null, modulo: import('./modelos.js').Modulo, organizacion_id: string|null, eliminado: boolean}|null>}
 */
export async function resumenDeRegistro(entidad, id) {
  await iniciar();
  const col = COLECCION_DE_ENTIDAD[entidad];
  const r = col && cache[col] ? cache[col].get(id) : null;
  if (!r) return null;
  const d = describir(entidad, r);
  return { entidad, id, rotulo: (entidad === 'Equipo' && r.equipo_tipo === 'servidor' ? ROTULO_ENTIDAD.Servidor : ROTULO_ENTIDAD[entidad]) || entidad, titulo: d.titulo, subtitulo: d.subtitulo,
    ruta: rutaDeEntidad(entidad, r), modulo: moduloDeFicha(entidad, id), organizacion_id: orgDe(col, r), eliminado: !!r.eliminado_en };
}

// ---- Relaciones (IC4) ----

/**
 * @typedef {Object} RelacionDe
 * @property {Relacion} relacion
 * @property {'saliente'|'entrante'} direccion `saliente`: la ficha consultada es el origen; `entrante`: es el destino.
 * @property {string} entidad Entidad del OTRO lado.
 * @property {string} id Id del otro lado.
 * @property {string} rotulo Nombre legible de la entidad del otro lado («Licencia», «Servidor»…).
 * @property {string} titulo
 * @property {string} subtitulo
 * @property {string|null} ruta Pantalla sugerida para abrir el otro lado.
 * @property {import('./modelos.js').Modulo} modulo Módulo de permisos del otro lado.
 * @property {string} descripcion `relacion_descripcion` (vacío si no tiene).
 */

/**
 * Fichas relacionadas con una (en las dos direcciones), con el registro del otro lado resuelto. El repositorio no decide
 * permisos: la vista pasa `permitido` (con `puede(usuario, 'ver', r.modulo, r.organizacion_id)`) y lo que no se puede ver no aparece.
 * @param {string} entidad Nombre de la entidad (por ejemplo «Equipo»).
 * @param {string} id
 * @param {{permitido?: (otro: {entidad: string, id: string, modulo: import('./modelos.js').Modulo, organizacion_id: string|null}) => boolean}} [opciones]
 * @returns {Promise<RelacionDe[]>}
 */
export async function relacionesDe(entidad, id, opciones) {
  await iniciar();
  const permitido = (opciones && opciones.permitido) || (() => true);
  /** @type {RelacionDe[]} */
  const salida = [];
  for (const x of cache.relaciones.values()) {
    if (x.eliminado_en) continue;
    const sale = x.origen_entidad === entidad && x.origen_id === id;
    const entra = x.destino_entidad === entidad && x.destino_id === id;
    if (!sale && !entra) continue;
    const e = sale ? x.destino_entidad : x.origen_entidad, i = sale ? x.destino_id : x.origen_id;
    const col = COLECCION_DE_ENTIDAD[e];
    const reg = col && cache[col] ? cache[col].get(i) : null;
    if (!reg || reg.eliminado_en) continue;
    const modulo = moduloDeFicha(e, i);
    if (!permitido({ entidad: e, id: i, modulo, organizacion_id: orgDe(col, reg) })) continue;
    const d = describir(e, reg);
    salida.push({ relacion: publico('relaciones', x), direccion: sale ? 'saliente' : 'entrante', entidad: e, id: i,
      rotulo: (e === 'Equipo' && reg.equipo_tipo === 'servidor' ? ROTULO_ENTIDAD.Servidor : ROTULO_ENTIDAD[e]) || e,
      titulo: d.titulo, subtitulo: d.subtitulo, ruta: rutaDeEntidad(e, reg), modulo, descripcion: x.relacion_descripcion || '' });
  }
  return salida.sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'es') || a.titulo.localeCompare(b.titulo, 'es', { numeric: true }));
}

// ---- Cadena y vínculos de un equipo (D-072) ----

/**
 * Impresoras conectadas por USB / local a una computadora (`impresora_conexion = usb` e `impresora_pc_id` = esa computadora).
 * @param {string} equipoId
 * @returns {Promise<Equipo[]>}
 */
export async function impresorasDePc(equipoId) {
  await iniciar();
  return impresorasDePcSync(equipoId).map(e => publico('equipos', e));
}

/** @param {string} equipoId @returns {any[]} */
function impresorasDePcSync(equipoId) {
  return Array.from(cache.equipos.values())
    .filter(e => !e.eliminado_en && esImpresora(e) && (e.equipo_campos || {}).impresora_conexion === 'usb' && (e.equipo_campos || {}).impresora_pc_id === equipoId)
    .sort((a, b) => a.equipo_nombre.localeCompare(b.equipo_nombre, 'es', { numeric: true }));
}

/**
 * @typedef {Object} VinculosDeEquipo
 * @property {Array<{puerto: any, conectadoA: {equipo: Equipo, puerto: any}|null, enlaceIsp: any|null, vlan: Vlan|null, descripcion: string|null}>} puertos
 *   Los puertos del equipo (por número): a qué puerto de qué equipo llegan, el enlace a Internet si salen a uno, y la VLAN nativa.
 *   `descripcion`: «¿A qué va?» en texto libre cuando no está conectado a un puerto.
 * @property {any|null} puesto Puesto de trabajo del equipo (equipos de escritorio).
 * @property {{patchera: Equipo, puerto: any}|null} bocaPatchera Boca de la patchera a la que llega el puesto (o el equipo, si se conecta a una patchera).
 * @property {{equipo: Equipo, puerto: any}|null} switch Switch y puerto al que llega el equipo (por la boca de patchera o directo).
 * @property {Vlan|null} vlan VLAN nativa del puerto de switch (o, si no hay, de un puerto propio).
 * @property {{rack: any, unidad: number|null, alto: number|null, de: 'equipo'|'switch'|'patchera'}|null} rack Rack del equipo o, si no está en uno, el del switch o la patchera a la que llega (`de`).
 * @property {any|null} ubicacion Ubicación del equipo (o la de su puesto).
 * @property {any[]} personas Personas con el equipo asignado hoy (puede ser más de una).
 * @property {Asignacion[]} asignaciones Las asignaciones vigentes (una por persona).
 * @property {Array<{licencia: any, instalacion: any}>} licencias Licencias instaladas hoy.
 * @property {any[]} mapeos Mapeos de unidad de este equipo o de las personas que lo tienen.
 * @property {Array<{id: string, nombre: string, tipo: string}>} credenciales Credenciales de este equipo, SIN secretos.
 * @property {any[]} configuraciones Configuraciones del equipo.
 * @property {any[]} enlacesIsp Enlaces a Internet que terminan en este equipo.
 * @property {any[]} notas Notas colgadas del equipo.
 * @property {Equipo[]} impresoras Impresoras USB conectadas a este equipo (si es una PC).
 * @property {Equipo|null} pc Computadora a la que está conectada esta impresora (si es una impresora USB).
 * @property {RelacionDe[]} relaciones «Relacionado con».
 */

/**
 * Todo lo que se puede alcanzar desde un equipo: la cadena de cableado (puerto o boca de pared → puesto → boca de patchera →
 * patchera → switch y puerto → VLAN → rack → ubicación) y lo que se relaciona con él (personas, licencias, mapeos, credenciales,
 * impresoras, relaciones…). Como `relacionesDe`, no decide permisos: la vista pasa `permitido` (con `puede(…, 'ver', modulo,
 * organizacion_id)`) y lo que no se puede ver no aparece. Nunca devuelve secretos.
 * @param {string} equipoId
 * @param {{permitido?: (otro: {entidad: string, id: string, modulo: import('./modelos.js').Modulo, organizacion_id: string|null}) => boolean}} [opciones]
 * @returns {Promise<VinculosDeEquipo|null>} null si el equipo no existe.
 */
export async function vinculosDeEquipo(equipoId, opciones) {
  await iniciar();
  const e = cache.equipos.get(equipoId);
  if (!e || e.eliminado_en) return null;
  const permitidoFn = (opciones && opciones.permitido) || (() => true);
  /** @param {string} entidad @param {any} reg */
  const ok = (entidad, reg) => { const col = COLECCION_DE_ENTIDAD[entidad]; return permitidoFn({ entidad, id: reg.id, modulo: moduloDeFicha(entidad, reg.id), organizacion_id: orgDe(col, reg) }); };
  /** @param {string|null|undefined} id @returns {any|null} */
  const viva = (/** @type {string|null|undefined} */ id, /** @type {string} */ col) => { const r = id ? cache[col].get(id) : null; return r && !r.eliminado_en ? r : null; };

  // Puertos propios
  const propios = Array.from(cache.puertos.values()).filter(p => p.equipo_id === e.id && !p.eliminado_en).sort((a, b) => a.puerto_numero - b.puerto_numero);
  const vlanDe = (/** @type {any} */ p) => { const v = viva(p && p.vlan_nativa_id, 'vlans'); return v ? publico('vlans', v) : null; };
  const puertos = propios.map(p => {
    const otro = viva(p.conectado_a_puerto_id, 'puertos');
    const eo = otro ? viva(otro.equipo_id, 'equipos') : null;
    const isp = viva(p.enlace_isp_id, 'enlaces_isp');
    return {
      puerto: publico('puertos', p),
      conectadoA: otro && eo && ok('Equipo', eo) ? { equipo: publico('equipos', eo), puerto: publico('puertos', otro) } : null,
      enlaceIsp: isp && ok('EnlaceIsp', isp) ? publico('enlaces_isp', isp) : null,
      vlan: vlanDe(p), descripcion: p.conectado_a_descripcion || null
    };
  });

  // Cadena hacia la red: por el puesto (boca de pared → boca de patchera → puerto de switch) o por un puerto propio.
  const puesto = viva(e.puesto_id, 'puestos');
  /** @type {any|null} */ let boca = null;
  /** @type {any|null} */ let pSwitch = null;
  if (puesto) {
    boca = Array.from(cache.puertos.values()).find(b => b.puesto_id === puesto.id && !b.eliminado_en && viva(b.equipo_id, 'equipos') && cache.equipos.get(b.equipo_id).equipo_tipo === 'patchera') || null;
    pSwitch = boca ? viva(boca.conectado_a_puerto_id, 'puertos') : null;
  }
  if (!pSwitch) {
    for (const p of propios) {
      const otro = viva(p.conectado_a_puerto_id, 'puertos');
      const eo = otro ? viva(otro.equipo_id, 'equipos') : null;
      if (!eo) continue;
      if (eo.equipo_tipo === 'switch') { pSwitch = otro; break; }
      if (eo.equipo_tipo === 'patchera' && !boca) {
        boca = otro;
        const sw = viva(otro.conectado_a_puerto_id, 'puertos');
        if (sw && viva(sw.equipo_id, 'equipos') && cache.equipos.get(sw.equipo_id).equipo_tipo === 'switch') { pSwitch = sw; break; }
      }
    }
  }
  const eSwitch = pSwitch ? viva(pSwitch.equipo_id, 'equipos') : null;
  const ePatch = boca ? viva(boca.equipo_id, 'equipos') : null;
  const vlan = vlanDe(pSwitch) || puertos.map(x => x.vlan).find(v => v) || null;

  /** @type {VinculosDeEquipo['rack']} */
  let rack = null;
  for (const [de, x] of /** @type {Array<['equipo'|'switch'|'patchera', any]>} */ ([['equipo', e], ['switch', eSwitch], ['patchera', ePatch]])) {
    const r = x ? viva(x.rack_id, 'racks') : null;
    if (r && ok('Rack', r)) { rack = { rack: publico('racks', r), unidad: x.rack_u_inicio ?? null, alto: x.rack_u_alto ?? null, de }; break; }
  }
  const ub = viva(e.ubicacion_id, 'ubicaciones') || viva(puesto && puesto.ubicacion_id, 'ubicaciones');

  // Personas y lo que depende de ellas
  const asignaciones = vigentesSync(e.id).filter(a => viva(a.persona_id, 'personas'));
  const personasTodas = asignaciones.map(a => cache.personas.get(a.persona_id));
  const personas = personasTodas.filter(x => ok('Persona', x)).map(x => publico('personas', x));
  const idsPersonas = new Set(personasTodas.map(x => x.id));
  const licencias = Array.from(cache.instalaciones_licencia.values())
    .filter(i => i.equipo_id === e.id && !i.instalacion_hasta && !i.eliminado_en && viva(i.licencia_id, 'licencias'))
    .map(i => ({ licencia: cache.licencias.get(i.licencia_id), instalacion: i })).filter(x => ok('Licencia', x.licencia))
    .sort((a, b) => a.licencia.licencia_producto.localeCompare(b.licencia.licencia_producto, 'es'))
    .map(x => ({ licencia: publico('licencias', x.licencia), instalacion: publico('instalaciones_licencia', x.instalacion) }));
  const mapeos = Array.from(cache.mapeos_disco.values())
    .filter(m => !m.eliminado_en && (m.equipo_id === e.id || (m.mapeo_aplica_a === 'persona' && idsPersonas.has(m.persona_id))) && ok('MapeoDisco', m))
    .sort((a, b) => a.mapeo_letra.localeCompare(b.mapeo_letra, 'es')).map(m => publico('mapeos_disco', m));
  const credenciales = Array.from(cache.credenciales.values())
    .filter(c => c.equipo_id === e.id && !c.eliminado_en && ok('Credencial', c))
    .sort((a, b) => a.credencial_nombre.localeCompare(b.credencial_nombre, 'es'))
    .map(c => ({ id: c.id, nombre: c.credencial_nombre, tipo: c.credencial_tipo }));
  const configuraciones = Array.from(cache.configuraciones.values()).filter(c => c.equipo_id === e.id && !c.eliminado_en && ok('Configuracion', c)).map(c => publico('configuraciones', c));
  const enlacesIsp = Array.from(cache.enlaces_isp.values()).filter(l => l.equipo_id === e.id && !l.eliminado_en && ok('EnlaceIsp', l)).map(l => publico('enlaces_isp', l));
  const notas = Array.from(cache.notas.values()).filter(n => n.entidad === 'Equipo' && n.entidad_id === e.id && !n.eliminado_en && ok('Nota', n)).map(n => publico('notas', n));
  const impresoras = impresorasDePcSync(e.id).filter(x => ok('Equipo', x)).map(x => publico('equipos', x));
  const pcId = esImpresora(e) && (e.equipo_campos || {}).impresora_conexion === 'usb' ? (e.equipo_campos || {}).impresora_pc_id : null;
  const pc = viva(pcId, 'equipos');

  return {
    puertos, puesto: puesto && ok('Puesto', puesto) ? publico('puestos', puesto) : null,
    bocaPatchera: boca && ePatch ? { patchera: publico('equipos', ePatch), puerto: publico('puertos', boca) } : null,
    switch: pSwitch && eSwitch ? { equipo: publico('equipos', eSwitch), puerto: publico('puertos', pSwitch) } : null,
    vlan, rack, ubicacion: ub && ok('Ubicacion', ub) ? publico('ubicaciones', ub) : null,
    personas, asignaciones: asignaciones.map(a => publico('asignaciones', a)), licencias, mapeos, credenciales, configuraciones, enlacesIsp, notas, impresoras,
    pc: pc && ok('Equipo', pc) ? publico('equipos', pc) : null,
    relaciones: await relacionesDe('Equipo', e.id, { permitido: permitidoFn })
  };
}

/**
 * Relaciona dos fichas de la misma organización. No admite repetir el par (en cualquier dirección).
 * @param {{origenEntidad: string, origenId: string, destinoEntidad: string, destinoId: string, descripcion?: string|null, usuarioId: string}} datos
 * @returns {Promise<Relacion>}
 */
export async function crearRelacion(datos) {
  await iniciar();
  const col = COLECCION_DE_ENTIDAD[datos.origenEntidad];
  const reg = col && cache[col] ? cache[col].get(datos.origenId) : null;
  if (!reg) throw new Error('La ficha de origen no existe.');
  return guardar('relaciones', {
    organizacion_id: orgDe(col, reg), origen_entidad: datos.origenEntidad, origen_id: datos.origenId,
    destino_entidad: datos.destinoEntidad, destino_id: datos.destinoId, relacion_descripcion: (datos.descripcion || '').trim() || null
  }, datos.usuarioId);
}

/**
 * Quita una relación (baja lógica: queda en el historial).
 * @param {string} relacionId @param {string} usuarioId
 */
export async function quitarRelacion(relacionId, usuarioId) {
  await iniciar();
  const x = cache.relaciones.get(relacionId);
  if (!x || x.eliminado_en) throw new Error('La relación no existe.');
  await guardar('relaciones', { ...publico('relaciones', x), eliminado_en: ahoraISO() }, usuarioId, { motivo: 'Se quitó la relación.' });
}

// ---- Archivos (planos y fotos, MD11) ----

/** Bytes que ocupa el contenido de un data URL (base64 o texto codificado). @param {string} url */
function bytesDeDataUrl(url) {
  const i = url.indexOf(',');
  const cuerpo = url.slice(i + 1);
  if (/;base64$/i.test(url.slice(0, i))) return Math.floor(cuerpo.length * 3 / 4) - (cuerpo.endsWith('==') ? 2 : cuerpo.endsWith('=') ? 1 : 0);
  return new Blob([decodeURIComponent(cuerpo)]).size;
}

/** @param {Blob} blob @returns {Promise<string>} */
function leerComoDataUrl(blob) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(blob);
  });
}

/**
 * Guarda un archivo (plano, foto u otro) colgado de una ficha. El contenido queda en este navegador, como data URL.
 * Se pasa el archivo (`archivo`: File o Blob) o el `contenido` ya como data URL. El máximo es `LIMITE_ARCHIVO_BYTES` (5 MB, MD11 provisorio).
 * Un plano de una `Ubicacion` queda también como su plano vigente (`ubicacion_plano_archivo_id`).
 * @param {{entidad: string, entidadId: string, tipo: 'plano'|'foto'|'otro', archivo?: Blob & {name?: string}, nombre?: string, mime?: string, contenido?: string, usuarioId: string}} datos
 * @returns {Promise<Archivo>} Sin el contenido (usar `contenidoDeArchivo`).
 */
export async function guardarArchivo(datos) {
  await iniciar();
  const col = COLECCION_DE_ENTIDAD[datos.entidad];
  const reg = col && cache[col] ? cache[col].get(datos.entidadId) : null;
  if (!reg || reg.eliminado_en) throw new Error('La ficha de la que cuelga el archivo no existe.');
  if (datos.archivo && datos.archivo.size > LIMITE_ARCHIVO_BYTES) throw new Error('El archivo pesa ' + textoTamano(datos.archivo.size) + ' y el máximo es ' + textoTamano(LIMITE_ARCHIVO_BYTES) + '.');
  const contenido = datos.contenido || (datos.archivo ? await leerComoDataUrl(datos.archivo) : '');
  if (!contenido) throw new Error('Falta el archivo.');
  const bytes = datos.archivo ? datos.archivo.size : bytesDeDataUrl(contenido);
  const mime = datos.mime || (datos.archivo && datos.archivo.type) || (/^data:([^;,]+)/.exec(contenido) || [])[1] || 'application/octet-stream';
  const nombre = (datos.nombre || (datos.archivo && datos.archivo.name) || '').trim() || 'archivo';
  const guardado = await guardar('archivos', {
    organizacion_id: orgDe(col, reg), entidad: datos.entidad, entidad_id: datos.entidadId, archivo_tipo: datos.tipo,
    archivo_nombre: nombre, archivo_mime: mime, archivo_bytes: bytes, archivo_contenido: contenido
  }, datos.usuarioId);
  if (datos.tipo === 'plano' && datos.entidad === 'Ubicacion') {
    await guardar('ubicaciones', { ...publico('ubicaciones', reg), ubicacion_plano_archivo_id: guardado.id }, datos.usuarioId, { motivo: 'Se cargó el plano.' });
  }
  return guardado;
}

/**
 * Archivos vigentes de una ficha (más nuevos primero), sin su contenido.
 * @param {string} entidad @param {string} entidadId @param {'plano'|'foto'|'otro'} [tipo]
 * @returns {Promise<Archivo[]>}
 */
export async function archivosDe(entidad, entidadId, tipo) {
  await iniciar();
  const lista = [];
  for (const a of cache.archivos.values()) {
    if (a.eliminado_en || a.entidad !== entidad || a.entidad_id !== entidadId || (tipo && a.archivo_tipo !== tipo)) continue;
    lista.push(publico('archivos', a));
  }
  return lista.sort((a, b) => (a.creado_en < b.creado_en ? 1 : a.creado_en > b.creado_en ? -1 : 0));
}

/**
 * Contenido de un archivo (data URL listo para `src` o `href`).
 * @param {string} archivoId @returns {Promise<string|null>}
 */
export async function contenidoDeArchivo(archivoId) {
  await iniciar();
  const a = cache.archivos.get(archivoId);
  return a && !a.eliminado_en ? a.archivo_contenido : null;
}

/**
 * Quita un archivo (baja lógica). Si era el plano vigente de su ubicación, la ubicación queda sin plano.
 * @param {string} archivoId @param {string} usuarioId
 */
export async function quitarArchivo(archivoId, usuarioId) {
  await iniciar();
  const a = cache.archivos.get(archivoId);
  if (!a || a.eliminado_en) throw new Error('El archivo no existe.');
  const aa = structuredClone(a);
  await guardar('archivos', { ...aa, eliminado_en: ahoraISO() }, usuarioId, { motivo: 'Se quitó el archivo.' });
  const u = a.entidad === 'Ubicacion' ? cache.ubicaciones.get(a.entidad_id) : null;
  if (u && u.ubicacion_plano_archivo_id === archivoId) await guardar('ubicaciones', { ...publico('ubicaciones', u), ubicacion_plano_archivo_id: null }, usuarioId, { motivo: 'Se quitó el plano.' });
}

// ---- Posición en el plano (MJ44, D-058) ----

/**
 * Pone (o quita) un rack, puesto o equipo en el plano de su ubicación. `x` e `y` van de 0 a 1 respecto del plano; `null` lo saca.
 * @param {{coleccion: 'racks'|'puestos'|'equipos', id: string, x: number|null, y: number|null, usuarioId: string}} datos
 */
export async function colocarEnPlano(datos) {
  await iniciar();
  if (!['racks', 'puestos', 'equipos'].includes(datos.coleccion)) throw new Error('Eso no se puede poner en un plano.');
  const r = cache[datos.coleccion].get(datos.id);
  if (!r || r.eliminado_en) throw new Error('La ficha no existe.');
  const sacar = datos.x === null || datos.y === null;
  return guardar(datos.coleccion, { ...publico(datos.coleccion, r), plano_x: sacar ? null : datos.x, plano_y: sacar ? null : datos.y }, datos.usuarioId, { motivo: sacar ? 'Se sacó del plano.' : 'Se ubicó en el plano.' });
}

// ---- Puertos: conexión simétrica (QC36-A) ----

/**
 * Conecta dos puertos por las dos puntas. Si una punta estaba conectada a otro puerto, esa conexión se suelta (y la punta del
 * otro lado queda libre). Los puertos tienen que ser de equipos distintos de la misma organización.
 * @param {{puertoAId: string, puertoBId: string, usuarioId: string}} datos
 * @returns {Promise<{a: any, b: any, soltados: string[]}>} `soltados`: ids de los puertos que quedaron libres por el cambio.
 */
export async function conectarPuertos(datos) {
  await iniciar();
  const a = cache.puertos.get(datos.puertoAId), b = cache.puertos.get(datos.puertoBId);
  if (!a || !b || a.eliminado_en || b.eliminado_en) throw new Error('No se encontró alguno de los puertos.');
  if (a.id === b.id) throw new Error('Un puerto no puede conectarse consigo mismo.');
  if (a.equipo_id === b.equipo_id) throw new Error('No se puede conectar un equipo consigo mismo.');
  const ea = cache.equipos.get(a.equipo_id), eb = cache.equipos.get(b.equipo_id);
  if (!ea || !eb || ea.organizacion_id !== eb.organizacion_id) throw new Error('Los dos puertos tienen que ser de la misma organización.');
  if (a.puerto_estado === 'deshabilitado' || b.puerto_estado === 'deshabilitado') throw new Error('Un puerto deshabilitado no se puede conectar: habilitalo antes.');
  /** @type {string[]} */
  const soltados = [];
  if (a.conectado_a_puerto_id === b.id && b.conectado_a_puerto_id === a.id) return { a: publico('puertos', a), b: publico('puertos', b), soltados };
  // Soltar las otras puntas (las que estaban conectadas a una tercera cosa).
  for (const x of [a, b]) {
    const otroId = x.conectado_a_puerto_id;
    if (!otroId || otroId === a.id || otroId === b.id) continue;
    const o = cache.puertos.get(otroId);
    if (o && o.conectado_a_puerto_id === x.id) {
      await guardar('puertos', { ...publico('puertos', o), conectado_a_puerto_id: null, conectado_a_equipo_id: null, puerto_estado: o.puerto_estado === 'deshabilitado' ? 'deshabilitado' : 'libre' }, datos.usuarioId, { motivo: 'Se conectó el otro extremo a otro puerto.' });
      soltados.push(o.id);
    }
  }
  const pa = await guardar('puertos', { ...publico('puertos', cache.puertos.get(a.id)), conectado_a_puerto_id: b.id, conectado_a_equipo_id: b.equipo_id, conectado_a_descripcion: null, puerto_estado: 'activo' }, datos.usuarioId, { motivo: 'Conexión con ' + eb.equipo_nombre + ' · puerto ' + b.puerto_numero + '.' });
  const pb = await guardar('puertos', { ...publico('puertos', cache.puertos.get(b.id)), conectado_a_puerto_id: a.id, conectado_a_equipo_id: a.equipo_id, conectado_a_descripcion: null, puerto_estado: 'activo' }, datos.usuarioId, { motivo: 'Conexión con ' + ea.equipo_nombre + ' · puerto ' + a.puerto_numero + '.' });
  return { a: pa, b: pb, soltados };
}

/**
 * Desconecta un puerto de lo que tenga (otro puerto o una descripción libre) y deja libre la otra punta si la había.
 * @param {{puertoId: string, usuarioId: string}} datos
 * @returns {Promise<{puerto: any, otro: any|null}>}
 */
export async function desconectarPuerto(datos) {
  await iniciar();
  const p = cache.puertos.get(datos.puertoId);
  if (!p || p.eliminado_en) throw new Error('No se encontró el puerto.');
  const libre = (/** @type {any} */ x) => ({ ...publico('puertos', x), conectado_a_puerto_id: null, conectado_a_equipo_id: null, conectado_a_descripcion: null, puerto_estado: x.puerto_estado === 'deshabilitado' ? 'deshabilitado' : 'libre' });
  const o = p.conectado_a_puerto_id ? cache.puertos.get(p.conectado_a_puerto_id) : null;
  const pp = await guardar('puertos', libre(p), datos.usuarioId, { motivo: 'Se desconectó.' });
  let oo = null;
  if (o && !o.eliminado_en && o.conectado_a_puerto_id === p.id) oo = await guardar('puertos', libre(o), datos.usuarioId, { motivo: 'Se desconectó el otro extremo.' });
  return { puerto: pp, otro: oo };
}

// ---- IP de una VLAN (IC11) ----

/** @param {string|null|undefined} ip @returns {number|null} */
function ipANum(ip) {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(ip || '');
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some(x => x > 255) ? null : ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}
/** @param {number} n */
function numAIp(n) { return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.'); }

/**
 * Direcciones usadas y libres de una VLAN: las IP de los equipos de la organización que caen en su red (`vlan_red_cidr`):
 * IP de gestión, IP en la LAN de routers y firewalls e IP de iLO / iDRAC. No cuenta como libre el gateway ni el rango DHCP.
 * @param {string} vlanId
 * @returns {Promise<{cidr: string|null, valida: boolean, total: number, usadas: Array<{ip: string, equipo: string, equipo_id: string}>, libres: number, duplicadas: string[], gateway: string|null, dhcp_cantidad: number, siguiente_libre: string|null}>}
 *   `usadas` tiene una fila por equipo y dirección; `duplicadas`, las IP que usan dos o más equipos. Si la VLAN no tiene una red válida, `valida` es false.
 */
export async function ipsDeVlan(vlanId) {
  await iniciar();
  const v = cache.vlans.get(vlanId);
  if (!v || v.eliminado_en) throw new Error('La VLAN no existe.');
  const m = /^\s*([\d.]+)\/(\d{1,2})\s*$/.exec(v.vlan_red_cidr || '');
  const base0 = m ? ipANum(m[1]) : null;
  if (!m || base0 == null || Number(m[2]) > 32) return { cidr: v.vlan_red_cidr || null, valida: false, total: 0, usadas: [], libres: 0, duplicadas: [], gateway: v.vlan_gateway || null, dhcp_cantidad: 0, siguiente_libre: null };
  const prefijo = Number(m[2]), tam = Math.pow(2, 32 - prefijo);
  const base = Math.floor(base0 / tam) * tam;
  const primero = prefijo >= 31 ? base : base + 1, ultimo = prefijo >= 31 ? base + tam - 1 : base + tam - 2;
  const gw = ipANum(v.vlan_gateway);
  const rg = /^\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*$/.exec(v.vlan_dhcp_rango || '');
  const dIni = v.vlan_dhcp_activo && rg ? ipANum(rg[1]) : null, dFin = v.vlan_dhcp_activo && rg ? ipANum(rg[2]) : null;
  /** @type {Map<number, Array<{id: string, nombre: string}>>} */
  const usos = new Map();
  for (const e of cache.equipos.values()) {
    if (e.organizacion_id !== v.organizacion_id || e.eliminado_en || e.equipo_estado === 'baja') continue;
    const c = e.equipo_campos || {};
    for (const valor of [e.equipo_ip_gestion, c.router_ip_lan, c.firewall_ip_lan, c.servidor_ip_ilo_idrac]) {
      const n = ipANum(valor);
      if (n == null || n < base || n >= base + tam) continue;
      const l = usos.get(n) || [];
      if (!l.some(x => x.id === e.id)) l.push({ id: e.id, nombre: e.equipo_nombre });
      usos.set(n, l);
    }
  }
  const usadas = [], duplicadas = [];
  for (const [n, l] of Array.from(usos).sort((x, y) => x[0] - y[0])) {
    for (const q of l) usadas.push({ ip: numAIp(n), equipo: q.nombre, equipo_id: q.id });
    if (l.length > 1) duplicadas.push(numAIp(n));
  }
  let libres = 0, enDhcp = 0, siguiente = null;
  for (let n = primero; n <= ultimo; n++) {
    if (usos.has(n) || n === gw) continue;
    if (dIni != null && dFin != null && n >= dIni && n <= dFin) { enDhcp++; continue; }
    libres++;
    if (siguiente == null) siguiente = n;
  }
  return { cidr: numAIp(base) + '/' + prefijo, valida: true, total: ultimo - primero + 1, usadas, libres, duplicadas, gateway: v.vlan_gateway || null, dhcp_cantidad: enDhcp, siguiente_libre: siguiente == null ? null : numAIp(siguiente) };
}

// ---- Mudanza de una persona (MJ45, D-067) ----

/**
 * @typedef {Object} ResultadoMudanza
 * @property {string|null} puestoAnteriorId
 * @property {string} puestoNuevoId
 * @property {Array<{equipo_id: string, nombre: string, vlanAnterior: Vlan|null, vlanNueva: Vlan|null, cambiaVlan: boolean}>} equiposMovidos Con `conEquipo`: equipos que se mudaron con la persona.
 * @property {Array<{equipo_id: string, nombre: string, vlanAnterior: number|null, vlanNueva: number|null}>} avisosVlan Los movidos cuya VLAN cambia (pueden necesitar otra IP o repatchear).
 * @property {Array<{equipo_id: string, nombre: string}>} equiposDevueltos Sin `conEquipo`: equipos que la persona devolvió. Con `conEquipo`, los compartidos (ver `equiposCompartidos`) también se devuelven, solo por ella.
 * @property {Array<{equipo_id: string, nombre: string, conPersonas: string[]}>} equiposCompartidos Equipos que comparte con otras personas que se quedan: no se mueven; los devuelve solo ella (D-072).
 * @property {Array<{equipo_id: string, nombre: string}>} equiposAsignados Sin `conEquipo`: equipos libres del puesto nuevo que ahora tiene.
 * @property {Array<{equipo_id: string, nombre: string, persona: string|null}>} equiposDelPuestoOcupados Equipos del puesto nuevo que siguen asignados a otra persona.
 * @property {string[]} resumen Lo hecho, en frases para mostrar.
 */

/**
 * Muda a una persona a otro puesto. Cambia su `puesto_id`.
 * - `conEquipo = true`: sus equipos asignados (los que no están en un rack) se mueven al puesto nuevo (`moverEquipoAPuesto`) y se avisa si cambia la VLAN.
 * - `conEquipo = false`: devuelve sus equipos (`devolverEquipo`) y le asigna los equipos de escritorio del puesto nuevo que estén libres (`asignarEquipo`).
 * @param {{personaId: string, puestoId: string, conEquipo: boolean, usuarioId: string}} datos
 * @returns {Promise<ResultadoMudanza>}
 */
export async function mudarPersona(datos) {
  await iniciar();
  const p = cache.personas.get(datos.personaId);
  if (!p || p.eliminado_en) throw new Error('La persona no existe.');
  if (p.persona_estado === 'baja') throw new Error('La persona está dada de baja: no se puede mudar.');
  const pu = cache.puestos.get(datos.puestoId);
  if (!pu || pu.eliminado_en) throw new Error('El puesto no existe.');
  if (pu.organizacion_id !== p.organizacion_id) throw new Error('El puesto es de otra organización.');
  const nombreEq = (/** @type {string} */ id) => (cache.equipos.get(id) ? cache.equipos.get(id).equipo_nombre : '');
  /** @type {ResultadoMudanza} */
  const res = { puestoAnteriorId: p.puesto_id || null, puestoNuevoId: pu.id, equiposMovidos: [], avisosVlan: [], equiposDevueltos: [], equiposCompartidos: [], equiposAsignados: [], equiposDelPuestoOcupados: [], resumen: [] };
  const vigentes = Array.from(cache.asignaciones.values()).filter(a => a.persona_id === p.id && !a.asignacion_hasta && !a.eliminado_en && cache.equipos.get(a.equipo_id) && !cache.equipos.get(a.equipo_id).eliminado_en);
  if (p.puesto_id === pu.id) { res.resumen.push(p.persona_nombre + ' ya está en el puesto ' + pu.puesto_nombre + '.'); return res; }
  await guardar('personas', { ...publico('personas', p), puesto_id: pu.id }, datos.usuarioId, { motivo: 'Mudanza al puesto ' + pu.puesto_nombre + '.' });
  res.resumen.push(p.persona_nombre + ' pasa al puesto ' + pu.puesto_nombre + '.');
  if (datos.conEquipo) {
    for (const a of vigentes) {
      const e = cache.equipos.get(a.equipo_id);
      if (e.rack_id) continue;
      const otras = vigentesSync(e.id).filter(x => x.persona_id !== p.id).map(x => cache.personas.get(x.persona_id)).filter(x => x && !x.eliminado_en);
      if (otras.length) {
        // Equipo compartido: se queda donde está para las otras personas; quien se muda lo devuelve (D-072).
        await devolverEquipo({ equipoId: e.id, personaId: p.id, usuarioId: datos.usuarioId, observaciones: 'Devuelto por mudanza de ' + p.persona_nombre + ' (lo siguen usando otras personas).' });
        res.equiposDevueltos.push({ equipo_id: e.id, nombre: e.equipo_nombre });
        res.equiposCompartidos.push({ equipo_id: e.id, nombre: e.equipo_nombre, conPersonas: otras.map(x => x.persona_nombre) });
        continue;
      }
      const r = await moverEquipoAPuesto({ equipoId: e.id, puestoId: pu.id, usuarioId: datos.usuarioId });
      res.equiposMovidos.push({ equipo_id: e.id, nombre: e.equipo_nombre, ...r });
      if (r.cambiaVlan) res.avisosVlan.push({ equipo_id: e.id, nombre: e.equipo_nombre, vlanAnterior: r.vlanAnterior ? r.vlanAnterior.vlan_numero : null, vlanNueva: r.vlanNueva ? r.vlanNueva.vlan_numero : null });
    }
    res.resumen.push(res.equiposMovidos.length ? 'Se mudó con ' + res.equiposMovidos.map(x => x.nombre).join(', ') + '.' : (res.equiposCompartidos.length ? 'No tenía equipos propios para mudar.' : 'No tenía equipos asignados para mudar.'));
    for (const x of res.equiposCompartidos) res.resumen.push('Aviso: ' + x.nombre + ' lo comparte con ' + x.conPersonas.join(', ') + ': el equipo no se mueve, queda con ' + (x.conPersonas.length > 1 ? 'ellas' : 'esa persona') + ' y ' + p.persona_nombre + ' lo devuelve.');
    for (const x of res.avisosVlan) res.resumen.push('Aviso: ' + x.nombre + ' cambia de VLAN ' + (x.vlanAnterior ?? '?') + ' a VLAN ' + (x.vlanNueva ?? '?') + ': puede necesitar otra IP o repatchear.');
  } else {
    for (const a of vigentes) {
      await devolverEquipo({ equipoId: a.equipo_id, personaId: p.id, usuarioId: datos.usuarioId, observaciones: 'Devuelto por mudanza de ' + p.persona_nombre + '.' });
      res.equiposDevueltos.push({ equipo_id: a.equipo_id, nombre: nombreEq(a.equipo_id) });
    }
    if (res.equiposDevueltos.length) res.resumen.push('Devolvió ' + res.equiposDevueltos.map(x => x.nombre).join(', ') + '.');
    for (const e of Array.from(cache.equipos.values()).filter(x => x.puesto_id === pu.id && !x.eliminado_en && x.equipo_estado === 'en_uso' && ['PC', 'NB'].includes(abreviaturaEquipo(x)))) {
      const v = await asignacionVigente(e.id);
      if (v) {
        const dueno = cache.personas.get(v.persona_id);
        res.equiposDelPuestoOcupados.push({ equipo_id: e.id, nombre: e.equipo_nombre, persona: dueno ? dueno.persona_nombre : null });
        continue;
      }
      await asignarEquipo({ equipoId: e.id, personaId: p.id, motivo: 'Mudanza al puesto ' + pu.puesto_nombre + '.', usuarioId: datos.usuarioId });
      res.equiposAsignados.push({ equipo_id: e.id, nombre: e.equipo_nombre });
    }
    res.resumen.push(res.equiposAsignados.length ? 'Tomó ' + res.equiposAsignados.map(x => x.nombre).join(', ') + ' (estaba libre en el puesto).' : 'El puesto nuevo no tiene un equipo libre para asignarle.');
    for (const x of res.equiposDelPuestoOcupados) res.resumen.push('Aviso: ' + x.nombre + ' sigue asignado a ' + (x.persona || 'otra persona') + '.');
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// Usuarios, ingreso simulado (D-008) y contexto de permisos
// ---------------------------------------------------------------------------------------------

/**
 * Ingreso simulado del prototipo: usuario (correo o su parte antes de la @) y la clave ficticia de prueba.
 * @param {string} identificador @param {string} clave
 */
export async function autenticar(identificador, clave) {
  await iniciar();
  const id = identificador.trim().toLowerCase();
  if (!id) return null;
  for (const u of cache.usuarios.values()) {
    const email = String(u.usuario_email).toLowerCase();
    if ((email === id || email.split('@')[0] === id) && u.usuario_clave_prototipo === clave && u.usuario_estado === 'activo' && !u.eliminado_en) {
      return publico('usuarios', u);
    }
  }
  return null;
}

/**
 * Lista de usuarios de prueba con su clave ficticia, solo para la pantalla de ingreso (D-008, D-050).
 * @returns {Promise<Array<{id: string, nombre: string, email: string, perfil: string, organizacion: string|null, organizacion_baja: boolean, clave: string}>>}
 */
export async function usuariosDePrueba() {
  await iniciar();
  return Array.from(cache.usuarios.values()).filter(u => u.usuario_estado === 'activo' && !u.eliminado_en).map(u => ({
    id: u.id, nombre: u.usuario_nombre, email: u.usuario_email, perfil: u.usuario_perfil,
    organizacion: u.organizacion_id && cache.organizaciones.get(u.organizacion_id) ? cache.organizaciones.get(u.organizacion_id).organizacion_nombre : null,
    organizacion_baja: !!(u.organizacion_id && cache.organizaciones.get(u.organizacion_id) && cache.organizaciones.get(u.organizacion_id).eliminado_en),
    clave: u.usuario_clave_prototipo
  }));
}

/**
 * Nombre de la organización dada de baja a la que pertenece el usuario, o null si puede trabajar (QC50-A).
 * El superadmin nunca queda afectado. Lee la organización del almacenamiento y no del cache: si otra pestaña la dio de baja
 * mientras tanto, se entera acá.
 * @param {string} usuarioId
 * @returns {Promise<string|null>}
 */
export async function organizacionDeBajaDe(usuarioId) {
  await iniciar();
  const u = cache.usuarios.get(usuarioId);
  if (!u || u.usuario_perfil === 'superadmin' || !u.organizacion_id) return null;
  const fresca = await pedido(/** @type {IDBDatabase} */ (db).transaction('organizaciones').objectStore('organizaciones').get(u.organizacion_id));
  if (fresca) cache.organizaciones.set(fresca.id, fresca);
  const o = fresca || cache.organizaciones.get(u.organizacion_id);
  return o && o.eliminado_en ? o.organizacion_nombre : null;
}

/**
 * Lo que `permisos.js` necesita saber de un usuario: sus permisos por módulo y sus aprobaciones vigentes.
 * @param {string} usuarioId
 * @returns {Promise<{permisos: PermisoModulo[], aprobaciones: Aprobacion[]}>}
 */
export async function contextoUsuario(usuarioId) {
  await iniciar();
  const permisos = Array.from(cache.permisos_modulo.values()).filter(p => p.usuario_id === usuarioId && !p.eliminado_en).map(p => structuredClone(p));
  return { permisos, aprobaciones: await aprobacionesVigentes(usuarioId) };
}

/** Último ingreso de un usuario en este navegador (ISO) o null. @param {string} usuarioId */
export async function ultimoIngreso(usuarioId) { await iniciar(); return metaGet('ingreso:' + usuarioId); }

/** @param {string} usuarioId */
export async function registrarIngreso(usuarioId) { await iniciar(); await metaSet('ingreso:' + usuarioId, ahoraISO()); }

// ---------------------------------------------------------------------------------------------
// Cambios leídos (D-048) y ajustes del sistema (D-046)
// ---------------------------------------------------------------------------------------------

/** Ids de los cambios que un usuario ya marcó como leídos. @param {string} usuarioId @returns {Promise<Set<string>>} */
export async function cambiosLeidos(usuarioId) {
  await iniciar();
  const s = new Set();
  for (const l of cache.lecturas_cambio.values()) if (l.usuario_id === usuarioId) s.add(l.cambio_id);
  return s;
}

/**
 * Marca (o desmarca) un cambio como leído por un usuario. Desmarcar borra la fila.
 * @param {string} usuarioId @param {string} cambioId @param {boolean} leido
 */
export async function marcarLeido(usuarioId, cambioId, leido) {
  await iniciar();
  const existente = Array.from(cache.lecturas_cambio.values()).find(l => l.usuario_id === usuarioId && l.cambio_id === cambioId);
  if (leido && !existente) await persistir([['lecturas_cambio', { id: crypto.randomUUID(), usuario_id: usuarioId, cambio_id: cambioId, lectura_en: ahoraISO() }]]);
  else if (!leido && existente) await persistir([], [['lecturas_cambio', existente.id]]);
}

/**
 * Umbrales de verificación en días: «a revisar» y «viejo».
 * @returns {Promise<Umbrales>}
 */
export async function umbralesVerificacion() {
  await iniciar();
  const valor = (/** @type {string} */ clave, /** @type {number} */ porDefecto) => {
    const a = Array.from(cache.ajustes_sistema.values()).find(x => x.ajuste_clave === clave);
    const n = a ? parseInt(a.ajuste_valor, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : porDefecto;
  };
  return { aRevisar: valor('verificacion_dias_a_revisar', 90), viejo: valor('verificacion_dias_viejo', 365) };
}

// ---------------------------------------------------------------------------------------------
// Búsqueda global (D-019, D-026): nunca indexa ni devuelve secretos (regla 16)
// ---------------------------------------------------------------------------------------------

/** Grupos de resultados, en el orden en que se muestran, con su color por tipo de dato. */
export const GRUPOS_BUSQUEDA = [
  { nombre: 'Equipos', tipo: 'equipo' },
  { nombre: 'Servidores', tipo: 'servidor' },
  { nombre: 'Puertos', tipo: 'puerto' },
  { nombre: 'Puestos', tipo: 'puesto' },
  { nombre: 'Personas', tipo: 'persona' },
  { nombre: 'Cuentas de dominio', tipo: 'persona' },
  { nombre: 'Licencias', tipo: 'licencia' },
  { nombre: 'Mapeos', tipo: 'configuracion' },
  { nombre: 'Notas', tipo: 'nota' },
  { nombre: 'Racks', tipo: 'rack' },
  { nombre: 'Configuraciones', tipo: 'configuracion' },
  { nombre: 'Credenciales', tipo: 'credencial' },
  { nombre: 'Red (VLAN y Wi-Fi)', tipo: 'vlan' },
  { nombre: 'Servicios y dominios', tipo: 'configuracion' },
  { nombre: 'Registros DNS', tipo: 'configuracion' },
  { nombre: 'Fibra', tipo: 'vlan' },
  { nombre: 'Archivos', tipo: 'nota' }
];

/**
 * @typedef {Object} ResultadoBusqueda
 * @property {string} clave
 * @property {string} coleccion
 * @property {string} id
 * @property {string} organizacion_id
 * @property {string} organizacion_nombre
 * @property {import('./modelos.js').Modulo} modulo Módulo de permisos al que pertenece.
 * @property {string} grupo Uno de GRUPOS_BUSQUEDA.
 * @property {string} tipo Clase de color (`t-<tipo>`).
 * @property {string} titulo
 * @property {string} subtitulo
 * @property {Array<[string, string]>} previa Pares etiqueta / valor para la vista previa.
 * @property {string} actualizado_en
 * @property {string} verificado_en
 * @property {string} [credencial_tipo]
 * @property {string} [equipo_id] Solo en puertos.
 * @property {number} [puerto_numero] Solo en puertos.
 * @property {string} [ruta] Pantalla a abrir, cuando no se deduce de `coleccion` + `id` (servicios, registros DNS, tramos y archivos).
 */

/** @param {...any} partes */
const unir = (...partes) => partes.filter(x => x !== null && x !== undefined && x !== '').join(' · ');

/** @type {Object<string, string>} */
const ROTULO_ESTADO_PUERTO = { activo: 'Activo', libre: 'Libre', deshabilitado: 'Deshabilitado' };

/** Arma el índice de búsqueda (lazy). Cada entrada lleva el texto normalizado para comparar. */
function construirIndice() {
  const orgs = cache.organizaciones, equipos = cache.equipos, ubic = cache.ubicaciones, racks = cache.racks;
  const vlans = cache.vlans, puestos = cache.puestos;
  const nombreOrg = (/** @type {string} */ id) => (orgs.get(id) ? orgs.get(id).organizacion_nombre : '');
  const nombreEq = (/** @type {string|null} */ id) => (id && equipos.get(id) ? equipos.get(id).equipo_nombre : '');
  const nombreUb = (/** @type {string|null} */ id) => (id && ubic.get(id) ? ubic.get(id).ubicacion_nombre : '');
  /** @type {Map<string, any[]>} */
  const equiposDePuesto = new Map();
  for (const e of equipos.values()) if (e.puesto_id && !e.eliminado_en) { { let l = equiposDePuesto.get(e.puesto_id); if (!l) { l = []; equiposDePuesto.set(e.puesto_id, l); } l.push(e); } }
  /** @type {Map<string, number>} */
  const ocupacion = new Map();
  for (const e of equipos.values()) if (e.rack_id && !e.eliminado_en) ocupacion.set(e.rack_id, (ocupacion.get(e.rack_id) || 0) + (e.rack_u_alto || 0));
  /** Persona que tiene hoy cada equipo (nombre) y equipos / cuentas / instalaciones por persona y licencia. @type {Map<string, string>} */
  const asignadoA = new Map();
  /** @type {Map<string, string[]>} */
  const equiposDePersona = new Map();
  for (const a of cache.asignaciones.values()) {
    if (a.eliminado_en || a.asignacion_hasta) continue;
    const per = cache.personas.get(a.persona_id), eqp = equipos.get(a.equipo_id);
    if (!per || !eqp || eqp.eliminado_en) continue;
    asignadoA.set(a.equipo_id, per.persona_nombre);
    { let l = equiposDePersona.get(a.persona_id); if (!l) { l = []; equiposDePersona.set(a.persona_id, l); } l.push(eqp.equipo_nombre); }
  }
  /** @type {Map<string, string[]>} */
  const cuentasDePersona = new Map();
  for (const cu of cache.cuentas_dominio.values()) {
    if (cu.eliminado_en || !cu.persona_id) continue;
    { let l = cuentasDePersona.get(cu.persona_id); if (!l) { l = []; cuentasDePersona.set(cu.persona_id, l); } l.push(cu.cuenta_dominio + '\\' + cu.cuenta_usuario); }
  }
  /** @type {Map<string, number>} */
  const usadasDeLicencia = new Map();
  for (const i of cache.instalaciones_licencia.values()) if (!i.eliminado_en && !i.instalacion_hasta) usadasDeLicencia.set(i.licencia_id, (usadasDeLicencia.get(i.licencia_id) || 0) + 1);
  /** @type {Map<string, any>} */
  const bocaDePuesto = new Map();
  for (const p of cache.puertos.values()) if (p.puesto_id && !p.eliminado_en) bocaDePuesto.set(p.puesto_id, p);

  /** @type {any[]} */
  const indice = [];
  /**
   * @param {string} coleccion @param {any} r @param {string} grupo @param {string} tipo @param {string} modulo
   * @param {string} titulo @param {string} subtitulo @param {Array<[string, any]>} previa @param {any[]} extraTexto
   * @param {Object} [extra]
   */
  const agregar = (coleccion, r, grupo, tipo, modulo, titulo, subtitulo, previa, extraTexto, extra) => {
    const prev = /** @type {Array<[string, string]>} */ (previa.filter(x => x[1] !== null && x[1] !== undefined && x[1] !== '').map(x => [x[0], String(x[1])]));
    const texto = normalizar([titulo, subtitulo, nombreOrg(r.organizacion_id)].concat(prev.map(x => x[1]), extraTexto.filter(Boolean).map(String)).join(' '));
    indice.push({
      clave: coleccion + ':' + r.id, coleccion, id: r.id, organizacion_id: r.organizacion_id, organizacion_nombre: nombreOrg(r.organizacion_id),
      modulo, grupo, tipo, titulo, subtitulo, previa: prev, actualizado_en: r.actualizado_en, verificado_en: r.verificado_en,
      _tituloN: normalizar(titulo), _texto: texto, ...(extra || {})
    });
  };

  for (const e of equipos.values()) {
    if (e.eliminado_en) continue;
    const c = e.equipo_campos || {};
    const rack = e.rack_id && racks.get(e.rack_id);
    const ubicacion = rack ? unir(rack.rack_nombre, 'U' + e.rack_u_inicio + (e.rack_u_alto > 1 ? '–U' + (e.rack_u_inicio + e.rack_u_alto - 1) : '')) : nombreUb(e.ubicacion_id);
    const puesto = e.puesto_id && puestos.get(e.puesto_id) ? puestos.get(e.puesto_id).puesto_nombre : '';
    const strings = Object.values(c).filter(v => typeof v === 'string');
    const n0 = indice.length;
    if (e.equipo_tipo === 'servidor') {
      const host = c.host_id ? nombreEq(c.host_id) : '';
      agregar('equipos', e, 'Servidores', 'servidor', 'servidores', e.equipo_nombre,
        unir(e.equipo_codigo, host ? 'Máquina virtual' : 'Servidor', unir(e.equipo_marca, e.equipo_modelo) , c.servidor_rol),
        [['Código', e.equipo_codigo], ['Rol', c.servidor_rol], ['Sistema operativo', c.servidor_sistema_operativo], ['IP de gestión', e.equipo_ip_gestion], ['IP de iLO / iDRAC', c.servidor_ip_ilo_idrac],
          ['Corre en el host', host], ['Rack', host ? '' : ubicacion], ['Estado', ROTULO_ESTADO_EQUIPO[e.equipo_estado]]],
        [e.equipo_codigo, e.equipo_marca, e.equipo_modelo, e.equipo_numero_serie, e.equipo_mac, e.equipo_notas, host].concat(strings));
    } else {
      let detalle = ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo;
      if (e.equipo_tipo === 'switch') detalle += ' ' + c.switch_puertos_total + '+' + c.switch_puertos_sfp;
      if (e.equipo_tipo === 'patchera') detalle += ' ' + c.patchera_cantidad_bocas + ' bocas';
      if (e.equipo_tipo === 'otro' && c.otro_categoria) detalle = c.otro_categoria;
      const reloj = e.equipo_tipo === 'otro' && c.otro_categoria === CATEGORIA_RELOJ;
      const quien = asignadoA.get(e.id);
      agregar('equipos', e, 'Equipos', 'equipo', 'red', e.equipo_nombre, unir(e.equipo_codigo, detalle, unir(e.equipo_marca, e.equipo_modelo)),
        [['Código', e.equipo_codigo], ['Tipo', detalle], ['Modelo', unir(e.equipo_marca, e.equipo_modelo)], ['IP de gestión', e.equipo_ip_gestion], ['MAC', e.equipo_mac], ['N.º de serie', e.equipo_numero_serie],
          ['Ubicación', ubicacion], ['Puesto', puesto], ['Asignado a', quien], ['Estado', ROTULO_ESTADO_EQUIPO[e.equipo_estado]]]
          .concat(reloj ? [['Método de fichada', ROTULO_RELOJ_METODO[c.reloj_metodo] || c.reloj_metodo], ['Software', c.reloj_software], ['PC de descarga', nombreEq(c.reloj_pc_descarga_id)]] : []),
        [e.equipo_codigo, e.equipo_marca, e.equipo_modelo, e.equipo_notas, nombreUb(e.ubicacion_id), ROTULO_EQUIPO_TIPO[e.equipo_tipo], puesto].concat(strings));
    }
    // El código corto cuenta como parte del título: buscar `AGR-PC-014` pone primero al equipo (MJ37).
    if (indice.length > n0) indice[indice.length - 1]._tituloN += ' ' + normalizar(e.equipo_codigo);
  }
  for (const r of racks.values()) {
    if (r.eliminado_en) continue;
    agregar('racks', r, 'Racks', 'rack', 'racks', r.rack_nombre, unir(nombreUb(r.ubicacion_id), r.rack_unidades_total + ' U'),
      [['Ubicación', nombreUb(r.ubicacion_id)], ['Alto', r.rack_unidades_total + ' U'], ['Ocupación', (ocupacion.get(r.id) || 0) + ' / ' + r.rack_unidades_total + ' U']], [r.rack_notas]);
  }
  for (const cf of cache.configuraciones.values()) {
    if (cf.eliminado_en) continue;
    const filas = (cf.configuracion_datos || []).map((/** @type {any} */ f) => [f.protocolo, f.puerto_externo, f.ip_destino, f.puerto_destino, f.descripcion].join(' '));
    const tipoR = ROTULO_CONFIGURACION_TIPO[cf.configuracion_tipo] || cf.configuracion_tipo;
    agregar('configuraciones', cf, 'Configuraciones', 'configuracion', 'configuraciones', cf.configuracion_titulo, unir(tipoR, nombreEq(cf.equipo_id)),
      [['Tipo', tipoR], ['Equipo', nombreEq(cf.equipo_id)], ['Versión del', cf.configuracion_version_fecha ? cf.configuracion_version_fecha.split('-').reverse().join('/') : ''],
        ['Reglas', filas.length ? String(filas.length) : '']],
      [cf.configuracion_contenido, cf.configuracion_notas].concat(filas));
  }
  for (const cr of cache.credenciales.values()) {
    if (cr.eliminado_en) continue;
    const tipoR = ROTULO_CREDENCIAL_TIPO[cr.credencial_tipo] || cr.credencial_tipo;
    // Nunca entra `credencial_secreto` al índice (regla 16).
    agregar('credenciales', cr, 'Credenciales', 'credencial', 'credenciales', cr.credencial_nombre, unir(tipoR, nombreEq(cr.equipo_id)),
      [['Tipo', tipoR], ['Usuario', cr.credencial_usuario], ['Host o URL', cr.credencial_url_o_host], ['Equipo', nombreEq(cr.equipo_id)],
        ['Vence', cr.credencial_vence_en ? cr.credencial_vence_en.split('-').reverse().join('/') : '']],
      [cr.credencial_notas], { credencial_tipo: cr.credencial_tipo });
  }
  for (const v of vlans.values()) {
    if (v.eliminado_en) continue;
    agregar('vlans', v, 'Red (VLAN y Wi-Fi)', 'vlan', 'red', 'VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre, unir(v.vlan_red_cidr, v.vlan_gateway ? 'gateway ' + v.vlan_gateway : ''),
      [['Red', v.vlan_red_cidr], ['Gateway', v.vlan_gateway], ['DHCP', v.vlan_dhcp_activo ? v.vlan_dhcp_rango : 'No']], [v.vlan_descripcion]);
  }
  const rotSeg = /** @type {Object<string, string>} */ ({ wpa2: 'WPA2', wpa3: 'WPA3', abierta: 'Abierta', portal: 'Portal cautivo' });
  for (const w of cache.redes_wifi.values()) {
    if (w.eliminado_en) continue;
    const vl = w.vlan_id && vlans.get(w.vlan_id) ? 'VLAN ' + vlans.get(w.vlan_id).vlan_numero + ' · ' + vlans.get(w.vlan_id).vlan_nombre : '';
    const aps = (w.access_point_ids || []).map(nombreEq).join(', ');
    agregar('redes_wifi', w, 'Red (VLAN y Wi-Fi)', 'wifi', 'red', 'Wi-Fi ' + w.wifi_ssid, unir(rotSeg[w.wifi_seguridad], vl),
      [['SSID', w.wifi_ssid], ['Seguridad', rotSeg[w.wifi_seguridad]], ['VLAN', vl], ['Access points', aps], ['Oculta', w.wifi_oculta ? 'Sí' : 'No']], []);
  }
  for (const l of cache.enlaces_isp.values()) {
    if (l.eliminado_en) continue;
    agregar('enlaces_isp', l, 'Red (VLAN y Wi-Fi)', 'vlan', 'red', 'Enlace ' + l.enlace_proveedor, unir(l.enlace_tipo, l.enlace_ip_publica, l.enlace_es_principal ? 'principal' : 'respaldo'),
      [['Proveedor', l.enlace_proveedor], ['Medio', l.enlace_tipo], ['IP pública', l.enlace_ip_publica], ['Termina en', nombreEq(l.equipo_id)], ['N.º de cliente', l.enlace_numero_cliente], ['Soporte', l.enlace_telefono_soporte]], []);
  }
  for (const pt of cache.puertos.values()) {
    if (pt.eliminado_en) continue;
    const eq = equipos.get(pt.equipo_id);
    if (!eq || eq.eliminado_en) continue;
    const destEq = pt.conectado_a_equipo_id ? equipos.get(pt.conectado_a_equipo_id) : null;
    const destPt = pt.conectado_a_puerto_id ? cache.puertos.get(pt.conectado_a_puerto_id) : null;
    const destEqPt = destPt ? equipos.get(destPt.equipo_id) : null;
    const eqDestino = destEq || destEqPt;
    const destino = eqDestino ? eqDestino.equipo_nombre + (destPt ? ' · puerto ' + destPt.puerto_numero : '') : '';
    const pu = pt.puesto_id ? puestos.get(pt.puesto_id) : null;
    const vl = pt.vlan_nativa_id ? vlans.get(pt.vlan_nativa_id) : null;
    const vlTxt = vl ? 'VLAN ' + vl.vlan_numero + ' · ' + vl.vlan_nombre : '';
    const etiq = (pt.vlans_etiquetadas || []).map((/** @type {string} */ id) => vlans.get(id)).filter(Boolean).map((/** @type {any} */ x) => 'VLAN ' + x.vlan_numero).join(', ');
    const estado = ROTULO_ESTADO_PUERTO[pt.puerto_estado] || pt.puerto_estado;
    agregar('puertos', { ...pt, organizacion_id: eq.organizacion_id }, 'Puertos', 'puerto', 'red', eq.equipo_nombre + ' · puerto ' + pt.puerto_numero, unir(pt.puerto_nombre, destino || pt.conectado_a_descripcion, estado),
      [['Equipo', eq.equipo_nombre], ['Nombre del puerto', pt.puerto_nombre], ['Conectado a', destino], ['Descripción', pt.conectado_a_descripcion],
        ['Puesto', pu ? pu.puesto_nombre : ''], ['Boca de pared', pu ? pu.puesto_boca_pared : ''], ['VLAN nativa', vlTxt], ['VLAN etiquetadas', etiq],
        ['Modo', pt.puerto_modo], ['Velocidad', pt.puerto_velocidad], ['Estado', estado]],
      [pt.puerto_notas, pt.puerto_tipo, 'puerto ' + pt.puerto_numero], { equipo_id: pt.equipo_id, puerto_numero: pt.puerto_numero });
  }
  for (const p of puestos.values()) {
    if (p.eliminado_en) continue;
    const eqs = equiposDePuesto.get(p.id) || [];
    const boca = bocaDePuesto.get(p.id);
    let recorrido = '';
    if (boca) {
      const patch = equipos.get(boca.equipo_id);
      const pSw = boca.conectado_a_puerto_id ? cache.puertos.get(boca.conectado_a_puerto_id) : null;
      const sw = pSw ? equipos.get(pSw.equipo_id) : null;
      recorrido = unir(sw && pSw ? sw.equipo_nombre + ' puerto ' + pSw.puerto_numero : '', patch ? patch.equipo_nombre + ' boca ' + boca.puerto_numero : '', p.puesto_boca_pared ? 'boca de pared ' + p.puesto_boca_pared : '').split(' · ').join(' → ');
    }
    agregar('puestos', p, 'Puestos', 'puesto', 'red', p.puesto_nombre, unir(nombreUb(p.ubicacion_id), p.puesto_boca_pared ? 'boca de pared ' + p.puesto_boca_pared : ''),
      [['Ubicación', nombreUb(p.ubicacion_id)], ['Boca de pared', p.puesto_boca_pared], ['Equipos', eqs.map((/** @type {any} */ e) => e.equipo_nombre).join(', ')], ['Recorrido', recorrido]],
      [p.puesto_notas]);
  }
  const per = (/** @type {string|null} */ id) => (id && cache.personas.get(id) ? cache.personas.get(id).persona_nombre : '');
  const fecha = (/** @type {string|null} */ f) => (f ? f.split('-').reverse().join('/') : '');
  for (const p of cache.personas.values()) {
    if (p.eliminado_en) continue;
    const pu = p.puesto_id ? puestos.get(p.puesto_id) : null;
    const eqs = equiposDePersona.get(p.id) || [];
    const cts = cuentasDePersona.get(p.id) || [];
    agregar('personas', p, 'Personas', 'persona', 'personas', p.persona_nombre, unir(p.persona_sector, pu ? pu.puesto_nombre : '', ROTULO_PERSONA_ESTADO[p.persona_estado]),
      [['Sector', p.persona_sector], ['Puesto', pu ? pu.puesto_nombre : ''], ['Estado', ROTULO_PERSONA_ESTADO[p.persona_estado]], ['Equipos', eqs.join(', ')], ['Cuentas', cts.join(', ')]],
      [p.persona_notas]);
  }
  for (const cu of cache.cuentas_dominio.values()) {
    if (cu.eliminado_en) continue;
    const dueno = per(cu.persona_id);
    agregar('cuentas_dominio', cu, 'Cuentas de dominio', 'persona', 'personas', cu.cuenta_dominio + '\\' + cu.cuenta_usuario, unir(dueno || 'Cuenta de servicio', ROTULO_CUENTA_ESTADO[cu.cuenta_estado]),
      [['Usuario', cu.cuenta_usuario], ['Dominio', cu.cuenta_dominio], ['Persona', dueno || 'Cuenta de servicio (sin persona)'], ['Unidad organizativa', cu.cuenta_unidad_organizativa],
        ['Grupos', (cu.cuenta_grupos || []).join(', ')], ['Estado', ROTULO_CUENTA_ESTADO[cu.cuenta_estado]]],
      [cu.cuenta_usuario].concat(cu.cuenta_grupos || []));
  }
  for (const l of cache.licencias.values()) {
    if (l.eliminado_en) continue;
    const usadas = usadasDeLicencia.get(l.id) || 0;
    const tipoL = ROTULO_LICENCIA_TIPO[l.licencia_tipo] || l.licencia_tipo;
    const clave = l.credencial_id && cache.credenciales.get(l.credencial_id) ? cache.credenciales.get(l.credencial_id).credencial_nombre : '';
    // Solo el nombre de la credencial de la clave: nunca su valor (regla 16).
    agregar('licencias', l, 'Licencias', 'licencia', 'licencias', l.licencia_producto, unir(tipoL, usadas + ' de ' + l.licencia_cantidad + ' en uso', l.licencia_vence_en ? 'vence ' + fecha(l.licencia_vence_en) : ''),
      [['Tipo', tipoL], ['En uso', usadas + ' de ' + l.licencia_cantidad], ['Vence', fecha(l.licencia_vence_en)], ['Proveedor', l.licencia_proveedor], ['Clave', clave ? 'Guardada en la credencial «' + clave + '»' : '']],
      [l.licencia_proveedor]);
  }
  for (const m of cache.mapeos_disco.values()) {
    if (m.eliminado_en) continue;
    const aplica = m.mapeo_aplica_a === 'grupo' ? 'Grupo ' + m.mapeo_grupo : m.mapeo_aplica_a === 'persona' ? per(m.persona_id) : ROTULO_MAPEO_APLICA_A[m.mapeo_aplica_a];
    agregar('mapeos_disco', m, 'Mapeos', 'configuracion', 'configuraciones', m.mapeo_letra + ' ' + m.mapeo_ruta, unir(nombreEq(m.equipo_id), aplica, ROTULO_MAPEO_METODO[m.mapeo_metodo]),
      [['Unidad', m.mapeo_letra], ['Ruta', m.mapeo_ruta], ['Servidor', nombreEq(m.equipo_id)], ['Aplica a', aplica], ['Método', ROTULO_MAPEO_METODO[m.mapeo_metodo]]], []);
  }
  for (const n of cache.notas.values()) {
    if (n.eliminado_en) continue;
    const col = n.entidad ? COLECCION_DE_ENTIDAD[n.entidad] : null;
    const reg = col && cache[col] ? cache[col].get(n.entidad_id) : null;
    const nombreFicha = reg ? (reg.equipo_nombre || reg.persona_nombre || reg.rack_nombre || reg.ubicacion_nombre || reg.puesto_nombre || reg.licencia_producto || reg.configuracion_titulo || reg.servicio_nombre || reg.tramo_nombre || reg.organizacion_nombre || (reg.cuenta_usuario ? reg.cuenta_dominio + '\\' + reg.cuenta_usuario : '') || '') : '';
    const resumen = n.nota_contenido.length > 200 ? n.nota_contenido.slice(0, 200).replace(/\s+\S*$/, '') + '…' : n.nota_contenido;
    agregar('notas', n, 'Notas', 'nota', moduloNota(n), n.nota_titulo, n.entidad ? 'Nota de «' + nombreFicha + '»' : 'Nota de la organización',
      [['Ficha', n.entidad ? nombreFicha : 'La organización'], ['Contenido', resumen]], [n.nota_contenido]);
  }
  // ---- Servicios, DNS, fibra y archivos (v0.5) ----
  for (const sv of cache.servicios.values()) {
    if (sv.eliminado_en) continue;
    const tipoS = ROTULO_SERVICIO_TIPO[sv.servicio_tipo] || sv.servicio_tipo;
    const cred = sv.credencial_id && cache.credenciales.get(sv.credencial_id) ? cache.credenciales.get(sv.credencial_id).credencial_nombre : '';
    const regs = sv.servicio_registros || [];
    const ruta = '#/servicio/' + sv.id;
    agregar('servicios', sv, 'Servicios y dominios', 'configuracion', 'configuraciones', sv.servicio_nombre, unir(tipoS, sv.servicio_proveedor, sv.servicio_vence_en ? 'vence ' + fecha(sv.servicio_vence_en) : ''),
      [['Tipo', tipoS], ['Proveedor', sv.servicio_proveedor], ['Titular', sv.servicio_titular], ['Vence', fecha(sv.servicio_vence_en)], ['DNS delegado en', sv.servicio_delegacion_dns], ['Plan', sv.servicio_plan],
        ['Acceso al panel', cred ? 'Credencial «' + cred + '»' : ''], ['Registros', regs.length ? String(regs.length) : '']],
      [sv.servicio_proveedor, sv.servicio_titular, sv.servicio_delegacion_dns, sv.servicio_plan].concat(regs.map((/** @type {any} */ g) => g.tipo + ' ' + g.nombre + ' ' + g.valor)), { ruta });
    for (const g of regs) {
      const nombreCompleto = g.nombre === '@' ? sv.servicio_nombre : g.nombre;
      agregar('servicios', sv, 'Registros DNS', 'configuracion', 'configuraciones', g.tipo + ' ' + nombreCompleto + ' → ' + g.valor + (g.prioridad != null ? ' (prioridad ' + g.prioridad + ')' : ''), 'Registro de «' + sv.servicio_nombre + '»',
        [['Tipo de registro', g.tipo], ['Nombre', g.nombre], ['Valor', g.valor], ['Prioridad', g.prioridad != null ? String(g.prioridad) : ''], ['Servicio', sv.servicio_nombre], ['Proveedor', sv.servicio_proveedor]], [],
        { clave: 'servicios:' + sv.id + ':' + g.tipo + ':' + g.nombre + ':' + g.valor, ruta });
    }
  }
  for (const t of cache.tramos_fibra.values()) {
    if (t.eliminado_en) continue;
    const dePat = (/** @type {string|null} */ id) => (id && equipos.get(id) ? equipos.get(id).equipo_nombre : '');
    const usados = (t.tramo_pelos_usados || []);
    const med = (t.tramo_mediciones || []);
    const peor = med.reduce((/** @type {any} */ a, /** @type {any} */ x) => (!a || x.atenuacion_db > a.atenuacion_db ? x : a), null);
    agregar('tramos_fibra', t, 'Fibra', 'vlan', 'red', t.tramo_nombre, unir(nombreUb(t.tramo_origen_ubicacion_id) + ' → ' + nombreUb(t.tramo_destino_ubicacion_id), t.tramo_pelos + ' pelos', ROTULO_FIBRA_TIPO[t.tramo_tipo]),
      [['Origen', unir(nombreUb(t.tramo_origen_ubicacion_id), dePat(t.tramo_origen_equipo_id))], ['Destino', unir(nombreUb(t.tramo_destino_ubicacion_id), dePat(t.tramo_destino_equipo_id))],
        ['Pelos', usados.length + ' usados de ' + t.tramo_pelos], ['Tipo', ROTULO_FIBRA_TIPO[t.tramo_tipo]], ['Conector', t.tramo_conector], ['Longitud', t.tramo_longitud_m != null ? t.tramo_longitud_m + ' m' : ''],
        ['Peor medición', peor ? peor.atenuacion_db.toString().replace('.', ',') + ' dB (pelo ' + peor.pelo + ', ' + fecha(peor.fecha) + ')' : '']],
      usados.map((/** @type {any} */ u) => u.uso).concat(med.map((/** @type {any} */ m) => m.observaciones)).concat([t.tramo_conector, t.tramo_tipo]), { ruta: '#/tramo/' + t.id });
  }
  for (const a of cache.archivos.values()) {
    if (a.eliminado_en) continue;
    const col = COLECCION_DE_ENTIDAD[a.entidad];
    const reg = col && cache[col] ? cache[col].get(a.entidad_id) : null;
    const ficha = reg ? describir(a.entidad, reg) : null;
    // Solo por nombre (y tipo / ficha): el contenido no entra al índice.
    agregar('archivos', a, 'Archivos', 'nota', moduloDeFicha(a.entidad, a.entidad_id), a.archivo_nombre, unir(ROTULO_ARCHIVO_TIPO[a.archivo_tipo], ficha ? 'de «' + ficha.titulo + '»' : ''),
      [['Tipo', ROTULO_ARCHIVO_TIPO[a.archivo_tipo]], ['Ficha', ficha ? ficha.titulo : ''], ['Formato', a.archivo_mime], ['Tamaño', textoTamano(a.archivo_bytes)]], [],
      { ruta: (reg && rutaDeEntidad(a.entidad, reg)) || '#/inicio' });
  }
  return indice;
}

/**
 * Busca en todas las organizaciones (D-019). Cada palabra tiene que aparecer en algún lado del registro;
 * tolera mayúsculas, tildes y separadores de MAC (`aa-bb` = `aa:bb`).
 * Devuelve TODAS las coincidencias permitidas; la vista decide cuántas dibuja.
 * @param {string} texto
 * @param {{permitido?: (r: ResultadoBusqueda) => boolean}} [opciones] La vista pasa acá lo que dicen los permisos.
 * @returns {Promise<ResultadoBusqueda[]>}
 */
export async function buscar(texto, opciones) {
  await iniciar();
  if (!indiceBusqueda) indiceBusqueda = construirIndice();
  const permitido = (opciones && opciones.permitido) || (() => true);
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean).map(p => (/^[0-9a-f]{2}([:\-][0-9a-f]{2})+$/.test(p) ? p.replace(/-/g, ':') : p));
  /** @type {Array<[any, number]>} */
  const hallados = [];
  for (const d of indiceBusqueda) {
    if (!permitido(d)) continue;
    let puntos = 0;
    let todas = true;
    for (const p of palabras) {
      if (d._tituloN.includes(p)) puntos += d._tituloN.startsWith(p) ? 5 : 3;
      else if (d._texto.includes(p)) puntos += 1;
      else { todas = false; break; }
    }
    if (todas) hallados.push([d, puntos]);
  }
  hallados.sort((a, b) => b[1] - a[1] || a[0].titulo.localeCompare(b[0].titulo, 'es', { numeric: true }));
  return hallados.map(h => {
    const { _tituloN, _texto, ...resto } = h[0];
    return resto;
  });
}

// ---------------------------------------------------------------------------------------------
// Exportar e importar (CU11)
// ---------------------------------------------------------------------------------------------

/**
 * Baja un archivo JSON con los datos. Sin `organizacionId` exporta todo (superadmin); con él, solo esa organización.
 * Sin `incluirSecretos`, las credenciales salen sin su secreto y sin las claves de prueba (D-029: quien no es
 * superadmin no se lleva secretos por la puerta de atrás).
 * @param {{organizacionId?: string|null, incluirSecretos?: boolean, usuarioId?: string}} [opciones]
 * @returns {Promise<{archivo: string, registros: number, organizaciones: number}>}
 */
export async function exportar(opciones) {
  await iniciar();
  const o = opciones || {};
  const org = o.organizacionId || null;
  /** @type {Object<string, any[]>} */
  const salida = {};
  const idsCambios = new Set();
  const usuariosOrg = new Set(Array.from(cache.usuarios.values()).filter(u => !org || u.organizacion_id === org).map(u => u.id));
  const equiposOrg = new Set(Array.from(cache.equipos.values()).filter(e => !org || e.organizacion_id === org).map(e => e.id));
  for (const c of COLECCIONES) {
    /** @type {any[]} */
    let lista = Array.from(cache[c].values());
    if (org) {
      lista = lista.filter(r => {
        if (c === 'organizaciones') return r.id === org;
        if (c === 'usuarios') return r.organizacion_id === org;
        if (c === 'permisos_modulo') return usuariosOrg.has(r.usuario_id);
        if (c === 'puertos') return equiposOrg.has(r.equipo_id);
        if (c === 'lecturas_cambio') return usuariosOrg.has(r.usuario_id);
        if (c === 'ajustes_sistema') return false;
        return r.organizacion_id === org;
      });
    }
    if (c === 'cambios') lista.forEach(x => idsCambios.add(x.id));
    if (c === 'lecturas_cambio' && org) lista = lista.filter(l => idsCambios.has(l.cambio_id));
    salida[c] = lista.map(r => {
      const copia = structuredClone(r);
      if (!o.incluirSecretos) {
        if (c === 'credenciales') copia.credencial_secreto = null;
        if (c === 'usuarios') delete copia.usuario_clave_prototipo;
        if (c === 'cambios' && copia.cambio_valor_oculto) { copia.cambio_valor_anterior = null; copia.cambio_valor_nuevo = null; }
      }
      return copia;
    });
  }
  const orgObj = org ? cache.organizaciones.get(org) : null;
  const paquete = {
    version_esquema: 1, version_modelo: VERSION_MODELO, generado_en: ahoraISO(), exportado_en: ahoraISO(), exportado_por: o.usuarioId || null,
    alcance: org ? 'organizacion' : 'todas', alcance_organizacion: orgObj ? orgObj.organizacion_nombre : null,
    incluye_secretos: !!o.incluirSecretos, ...salida
  };
  const archivo = 'infradoc-export-' + hoyISO() + (orgObj ? '-' + normalizar(orgObj.organizacion_nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '') + '.json';
  descargarTexto(archivo, JSON.stringify(paquete));
  await metaSet('ultima_exportacion', paquete.exportado_en);
  return { archivo, registros: COLECCIONES.reduce((n, c) => n + salida[c].length, 0), organizaciones: salida.organizaciones.length };
}

/** @type {Object<string, any[]>|null} */
let importacionPendiente = null;

/**
 * Lee un archivo exportado y lo valida SIN cambiar nada: devuelve un resumen para confirmar.
 * @param {string} texto
 * Acepta exportaciones de versiones anteriores del modelo (las migra) y rechaza las de una versión más nueva que la de esta app.
 * @returns {Promise<{filas: Array<[string, number]>, organizaciones: string[], alcance: string, advertencias: string[], versionModelo: number, migrado: boolean}>}
 */
export async function analizarImportacion(texto) {
  await iniciar();
  /** @type {any} */
  let crudo;
  try { crudo = JSON.parse(texto); } catch { throw new Error('El archivo no es un JSON válido.'); }
  const desde = versionModeloDe(crudo);
  const datos = validarEstructura(crudo);
  const migraciones = migrarDatos(datos, desde);
  importacionPendiente = datos;
  const advertencias = [];
  if (migraciones) advertencias.push('El archivo se exportó con una versión anterior de Infradoc (modelo de datos ' + desde + '): se actualiza solo al importarlo (los campos nuevos quedan con su valor por defecto y no se pierde nada).');
  if (crudo.alcance === 'organizacion') advertencias.push('El archivo es de una sola organización («' + (crudo.alcance_organizacion || '?') + '»): al importarlo, las demás organizaciones que hoy hay en este navegador se pierden.');
  if (crudo.incluye_secretos === false) advertencias.push('El archivo se exportó sin contraseñas: las credenciales quedarán sin contraseña y los usuarios, sin su clave de prueba (no vas a poder ingresar con ellos).');
  return {
    filas: COLECCIONES.filter(c => datos[c].length).map(c => /** @type {[string, number]} */ ([c, datos[c].length])),
    organizaciones: datos.organizaciones.map(x => x.organizacion_nombre), alcance: crudo.alcance === 'organizacion' ? 'una organización' : 'todas las organizaciones', advertencias,
    versionModelo: desde, migrado: migraciones > 0
  };
}

/** Reemplaza todos los datos por los del último archivo analizado. */
export async function aplicarImportacion() {
  await iniciar();
  if (!importacionPendiente) throw new Error('No hay ningún archivo analizado para importar.');
  const datos = importacionPendiente;
  importacionPendiente = null;
  await reemplazarTodo(datos);
  await metaSet('importado_en', ahoraISO());
  await metaSet('version_modelo', VERSION_MODELO);
  datosPropios = false;
  await marcarDatosPropios(); // lo importado es de un usuario: el restablecer automático no lo toca (D-073)
}

/** Descarta un archivo analizado que no se llegó a importar. */
export function cancelarImportacion() { importacionPendiente = null; }
