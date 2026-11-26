// @ts-check
/**
 * Altas desde cualquier formulario («+ Crear nuevo», QC53 a QC57, MJ49). Guía completa: `docs/desarrollo/guia-altas.md`.
 *
 * Problema que resuelve: el sysadmin no carga en el orden de las dependencias. Si un formulario pide elegir algo que no existe
 * (la sede o sala de un rack, el rack de un equipo, la VLAN de un puerto…), se lo crea en el momento y se sigue:
 *
 *  1. `DEPENDENCIAS` es el ÚNICO mapa de qué campo apunta a qué colección. Los formularios lo consultan; no repiten esa decisión.
 *  2. Cada colección que se puede crear al vuelo registra su formulario de alta COMPLETO con `registrarAlta` (en
 *     `assets/js/altas/<coleccion>.js`). `abrirAlta` lo abre en un diálogo apilado ENCIMA del formulario actual (marco.js) y
 *     resuelve con el registro creado, o `null` si se cancela. Lo escrito en el formulario de abajo no se toca.
 *  3. `selectorConCrear` arma el `<select>` de un formulario con las opciones existentes y, al final, «+ Crear nueva/o …»,
 *     que usa `abrirAlta`, deja lo creado elegido y, si se cancela, vuelve al valor anterior. Es encadenable sin límite
 *     (QC56-A): el formulario de una sala usa `selectorConCrear` para su sede, y así.
 *  4. Cada creación desde un selector emite el evento `infradoc:metrica` (sin importar ningún módulo de métricas).
 *
 * No decide permisos (QC57): «+ Crear nuevo» aparece siempre que el formulario esté visible.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { h, normalizar } from './utiles.js';
import { abrirModal, cerrarModal, toast } from './marco.js';
import { ENTIDAD_DE_COLECCION, ROTULO_ENTIDAD, ROTULO_UBICACION_TIPO } from './modelos.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */

// ---------------------------------------------------------------------------------------------
// 1. Mapa único de dependencias (MJ49)
// ---------------------------------------------------------------------------------------------

/** Valor de `DEPENDENCIAS` para una referencia que puede apuntar a cualquier entidad (`entidad` + `entidad_id`). */
export const CUALQUIERA = '*';

/**
 * Qué referencias tiene cada colección: `DEPENDENCIAS[coleccion][campo] = coleccionDestino`. Sale de recorrer
 * `docs/modelo-de-datos.md` y los tipos de `modelos.js`. Convenciones:
 *  - Un campo con lista de ids (`vlans_etiquetadas`, `access_point_ids`) va con el nombre del campo y apunta a la colección de sus elementos.
 *  - Una referencia dentro de `equipo_campos` va con el prefijo `equipo_campos.` (`equipo_campos.host_id`).
 *  - `CUALQUIERA` (`'*'`) es una referencia polimórfica (notas, archivos, relaciones, solicitudes): no se resuelve con un selector.
 *  - `organizacion_id` figura en todas las que cuelgan de una organización: no se elige en un formulario, viene de la sesión.
 *  - Los campos de auditoría (`creado_por`, `eliminado_por`…) no están.
 * Al agregar un campo que apunta a otra entidad, se agrega acá PRIMERO (y en `docs/modelo-de-datos.md`).
 * @type {Readonly<Object<string, Readonly<Object<string, string>>>>}
 */
export const DEPENDENCIAS = Object.freeze({
  organizaciones: {},
  usuarios: { organizacion_id: 'organizaciones', aprobado_por: 'usuarios' },
  permisos_modulo: { usuario_id: 'usuarios' },
  ubicaciones: { organizacion_id: 'organizaciones', ubicacion_padre_id: 'ubicaciones', ubicacion_plano_archivo_id: 'archivos' },
  racks: { organizacion_id: 'organizaciones', ubicacion_id: 'ubicaciones' },
  equipos: {
    organizacion_id: 'organizaciones', ubicacion_id: 'ubicaciones', rack_id: 'racks', puesto_id: 'puestos',
    'equipo_campos.host_id': 'equipos', 'equipo_campos.impresora_pc_id': 'equipos', 'equipo_campos.reloj_pc_descarga_id': 'equipos'
  },
  puertos: {
    equipo_id: 'equipos', vlan_nativa_id: 'vlans', vlans_etiquetadas: 'vlans', conectado_a_equipo_id: 'equipos',
    conectado_a_puerto_id: 'puertos', enlace_isp_id: 'enlaces_isp', puesto_id: 'puestos'
  },
  vlans: { organizacion_id: 'organizaciones' },
  enlaces_isp: { organizacion_id: 'organizaciones', equipo_id: 'equipos' },
  redes_wifi: { organizacion_id: 'organizaciones', vlan_id: 'vlans', credencial_id: 'credenciales', access_point_ids: 'equipos' },
  configuraciones: { organizacion_id: 'organizaciones', equipo_id: 'equipos' },
  credenciales: { organizacion_id: 'organizaciones', equipo_id: 'equipos', configuracion_id: 'configuraciones' },
  puestos: { organizacion_id: 'organizaciones', ubicacion_id: 'ubicaciones' },
  personas: { organizacion_id: 'organizaciones', puesto_id: 'puestos' },
  cuentas_dominio: { organizacion_id: 'organizaciones', persona_id: 'personas', credencial_id: 'credenciales' },
  asignaciones: { organizacion_id: 'organizaciones', equipo_id: 'equipos', persona_id: 'personas' },
  licencias: { organizacion_id: 'organizaciones', credencial_id: 'credenciales' },
  instalaciones_licencia: { organizacion_id: 'organizaciones', licencia_id: 'licencias', equipo_id: 'equipos', cuenta_id: 'cuentas_dominio', persona_id: 'personas' },
  mapeos_disco: { organizacion_id: 'organizaciones', equipo_id: 'equipos', persona_id: 'personas' },
  notas: { organizacion_id: 'organizaciones', entidad_id: CUALQUIERA },
  servicios: { organizacion_id: 'organizaciones', credencial_id: 'credenciales' },
  tramos_fibra: {
    organizacion_id: 'organizaciones', tramo_origen_ubicacion_id: 'ubicaciones', tramo_destino_ubicacion_id: 'ubicaciones',
    tramo_origen_equipo_id: 'equipos', tramo_destino_equipo_id: 'equipos'
  },
  archivos: { organizacion_id: 'organizaciones', entidad_id: CUALQUIERA },
  relaciones: { organizacion_id: 'organizaciones', origen_id: CUALQUIERA, destino_id: CUALQUIERA },
  solicitudes: { organizacion_id: 'organizaciones', solicitado_por: 'usuarios', resuelto_por: 'usuarios', solicitud_entidad_id: CUALQUIERA },
  registro_accesos: { credencial_id: 'credenciales', organizacion_id: 'organizaciones', usuario_id: 'usuarios', cambio_id: 'cambios' }
});

/**
 * A qué colección apunta `campo` en `coleccion`, o null si no es una referencia (o es polimórfica).
 * @param {string} coleccion @param {string} campo
 * @returns {string|null}
 */
export function destinoDe(coleccion, campo) {
  const d = (DEPENDENCIAS[coleccion] || {})[campo];
  return d && d !== CUALQUIERA ? d : null;
}

/**
 * Las referencias que un formulario de `coleccion` suele pedir elegir: todas menos `organizacion_id`, las polimórficas y las
 * de usuarios/auditoría. Sirve para revisar que un formulario no se olvidó de ninguna.
 * @param {string} coleccion @returns {Array<[string, string]>} pares [campo, coleccionDestino]
 */
export function referenciasElegibles(coleccion) {
  return Object.entries(DEPENDENCIAS[coleccion] || {})
    .filter(([campo, destino]) => campo !== 'organizacion_id' && destino !== CUALQUIERA && !['usuarios', 'cambios', 'organizaciones'].includes(destino));
}

/**
 * Qué colecciones apuntan a `destino` (quién depende de él): útil para avisar antes de dar de baja.
 * @param {string} destino @returns {Array<[string, string]>} pares [coleccion, campo]
 */
export function dependientesDe(destino) {
  /** @type {Array<[string, string]>} */
  const r = [];
  for (const [col, campos] of Object.entries(DEPENDENCIAS)) for (const [campo, d] of Object.entries(campos)) if (d === destino) r.push([col, campo]);
  return r;
}

// ---------------------------------------------------------------------------------------------
// 2. Registro de altas
// ---------------------------------------------------------------------------------------------

/**
 * Lo que recibe un formulario de alta.
 * @typedef {Object} ContextoAlta
 * @property {UsuarioSesion} usuario Quien crea (el que tiene la sesión abierta).
 * @property {string} organizacion_id Organización donde se crea.
 * @property {Object<string, any>} valores Valores iniciales (por nombre de campo del modelo): preelegir sede, fijar el tipo, etc.
 * @property {string|null} rotulo De dónde se está creando («Nuevo rack»), para mostrarlo y para las métricas.
 */

/**
 * Formulario de alta: abre el diálogo (con `abrirFormularioDeAlta`) y resuelve con el registro creado o `null` si se cancela.
 * @typedef {(ctx: ContextoAlta) => Promise<any|null>} FormularioDeAlta
 */

/** @type {Map<string, FormularioDeAlta>} */
const ALTAS = new Map();

/**
 * Dónde vive el alta de cada colección. `abrirAlta` importa el módulo la primera vez que hace falta (así el arranque no carga
 * formularios que quizá no se usen y no hay dependencias circulares con las vistas). Para sumar un alta: crear su módulo,
 * que llama a `registrarAlta`, y agregar una línea acá.
 * @type {Object<string, () => Promise<any>>}
 */
/** Módulo que registra el alta de cada colección. Un archivo por colección en `altas/` (si falta, `abrirAlta` avisa). */
/** Momento de la última apertura de cada alta (evita duplicados por doble clic). @type {Map<string, number>} */
const ULTIMA_APERTURA = new Map();

const MODULOS_DE_ALTA = {
  ubicaciones: () => import('./altas/ubicaciones.js'),
  racks: () => import('./altas/racks.js'),
  puestos: () => import('./altas/puestos.js'),
  equipos: () => import('./altas/equipos.js'),
  vlans: () => import('./altas/vlans.js'),
  redes_wifi: () => import('./altas/redes_wifi.js'),
  enlaces_isp: () => import('./altas/enlaces_isp.js'),
  tramos_fibra: () => import('./altas/tramos_fibra.js'),
  credenciales: () => import('./altas/credenciales.js'),
  configuraciones: () => import('./altas/configuraciones.js'),
  personas: () => import('./altas/personas.js'),
  cuentas_dominio: () => import('./altas/cuentas_dominio.js'),
  asignaciones: () => import('./altas/asignaciones.js'),
  licencias: () => import('./altas/licencias.js'),
  instalaciones_licencia: () => import('./altas/instalaciones_licencia.js'),
  mapeos_disco: () => import('./altas/mapeos_disco.js'),
  servicios: () => import('./altas/servicios.js'),
  notas: () => import('./altas/notas.js'),
  organizaciones: () => import('./altas/organizaciones.js')
};

/**
 * Registra el formulario de alta de una colección. Lo llama el módulo del alta al cargarse.
 * @param {string} coleccion @param {FormularioDeAlta} fn
 */
export function registrarAlta(coleccion, fn) {
  if (!DEPENDENCIAS[coleccion]) throw new Error('registrarAlta: colección desconocida «' + coleccion + '».');
  ALTAS.set(coleccion, fn);
}

/** ¿Hay un formulario de alta para esta colección (registrado o por cargar)? @param {string} coleccion */
export function tieneAlta(coleccion) { return ALTAS.has(coleccion) || coleccion in MODULOS_DE_ALTA; }

/** Colecciones con alta disponible. */
export function coleccionesConAlta() { return Array.from(new Set([...ALTAS.keys(), ...Object.keys(MODULOS_DE_ALTA)])); }

/**
 * Abre el formulario de alta COMPLETO de una colección, apilado encima de lo que haya en pantalla (QC55-B).
 * Resuelve con el registro creado, o `null` si se cancela (botón, Esc o fondo). Si esa colección todavía no tiene alta
 * registrada, avisa con claridad y resuelve `null`: nunca rompe.
 * @param {string} coleccion
 * @param {{organizacion_id?: string|null, valores?: Object<string, any>, rotulo?: string|null}} [opciones]
 * @returns {Promise<any|null>}
 */
export async function abrirAlta(coleccion, opciones) {
  const o = opciones || {};
  // Un doble clic en «Nueva …» abría dos formularios apilados iguales: se ignora la segunda apertura inmediata.
  const ahora = Date.now();
  if (ahora - (ULTIMA_APERTURA.get(coleccion) || 0) < 800) return null;
  ULTIMA_APERTURA.set(coleccion, ahora);
  if (!ALTAS.has(coleccion) && MODULOS_DE_ALTA[coleccion]) {
    try { await MODULOS_DE_ALTA[coleccion](); } catch (e) { console.error(e); }
  }
  const fn = ALTAS.get(coleccion);
  const nombre = (ROTULO_ENTIDAD[ENTIDAD_DE_COLECCION[coleccion]] || coleccion).toLowerCase();
  if (!fn) {
    toast('Todavía no se puede crear «' + nombre + '» desde acá. Cargalo desde su propia pantalla y volvé.');
    return null;
  }
  const usuario = sesion.usuarioActual();
  const organizacion_id = o.organizacion_id || sesion.organizacionActiva() || '';
  // Una organización no cuelga de otra: se puede crear sin tener ninguna activa (el superadmin recién entrando).
  if (!usuario || (!organizacion_id && coleccion !== 'organizaciones')) { toast('Elegí una organización antes de crear.'); return null; }
  return fn({ usuario, organizacion_id, valores: o.valores || {}, rotulo: o.rotulo || null });
}

/**
 * Arma y abre el diálogo de un alta (título, campos, error en línea, Guardar / Cancelar) y devuelve la promesa del registro.
 * Cada formulario de alta lo usa para no repetir el esqueleto. `alGuardar` crea el registro con `repositorio.guardar` y lo
 * devuelve; si lanza un `Error`, el mensaje se muestra en el diálogo y no se cierra. NO navega: quien llamó decide qué hacer
 * con el registro (por eso sirve igual desde un botón de pantalla que desde un selector).
 * @param {{titulo: string, rotulo?: string|null, intro?: string, cuerpo: Array<Node|null>, textoGuardar?: string, enfocar?: HTMLElement|null, alGuardar: () => Promise<any>}} o
 * @returns {Promise<any|null>}
 */
export function abrirFormularioDeAlta(o) {
  return new Promise(resolver => {
    let resuelto = false;
    /** @param {any} v */
    const resolverUna = v => { if (!resuelto) { resuelto = true; resolver(v); } };
    const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    const btnGuardar = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'primario', text: o.textoGuardar || 'Crear' }));
    const guardar = async () => {
      if (btnGuardar.disabled) return; // un doble clic o un Enter repetido no crea dos registros
      error.hidden = true;
      btnGuardar.disabled = true;
      try {
        const registro = await o.alGuardar();
        resolverUna(registro);
        cerrarModal();
      } catch (e) {
        error.textContent = e instanceof Error ? e.message : 'No se pudo guardar.';
        error.hidden = false;
      } finally { btnGuardar.disabled = false; }
    };
    btnGuardar.addEventListener('click', guardar);
    const caja = h('div', { class: 'bloque rk-modal rk-form', role: 'dialog', 'aria-label': o.titulo }, [
      h('h2', { text: o.titulo }),
      o.rotulo ? h('div', { class: 'mut', text: 'Mientras cargás: ' + o.rotulo + '. Al guardar, volvés ahí con esto ya elegido.' }) : null,
      o.intro ? h('div', { class: 'mut', text: o.intro }) : h('div', { class: 'mut', text: 'Los campos con * son obligatorios.' }),
      ...o.cuerpo, error,
      h('div', { class: 'herr' }, [btnGuardar, h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() })])]);
    caja.addEventListener('keydown', e => { if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).tagName === 'INPUT') { e.preventDefault(); guardar(); } });
    abrirModal(caja, () => resolverUna(null)); // cualquier cierre sin guardar (Cancelar, Esc, fondo) resuelve null
    if (o.enfocar) o.enfocar.focus();
  });
}

let contadorIds = 0;
/**
 * `id` único para un control de un formulario de alta: el mismo alta puede estar abierto dos veces a la vez (una sala creada
 * desde otra sala…), y dos `id` iguales rompen `<label for>`. Usarlo en TODOS los controles de un alta: `const id = idUnico('rk')`.
 * @param {string} base
 */
export function idUnico(base) { return base + '-' + (++contadorIds); }

/**
 * Fila de formulario «etiqueta + control» con el estilo de los diálogos (clase `campo`).
 * @param {string} id @param {string} etiqueta @param {HTMLElement} control @param {string} [ayuda]
 */
export function campoDeAlta(id, etiqueta, control, ayuda) {
  return h('div', { class: 'campo' }, [h('label', { for: id, text: etiqueta }), control, ayuda ? h('div', { class: 'mut', text: ayuda }) : null]);
}

// ---------------------------------------------------------------------------------------------
// 3. Selector con «+ Crear nuevo»
// ---------------------------------------------------------------------------------------------

/** Valor interno de la opción «+ Crear…» (nunca se guarda). */
const VALOR_CREAR = '__crear__';

/** «nueva sede o sala» por colección (con su género); lo que no esté acá se arma con `ROTULO_ENTIDAD`. @type {Object<string, string>} */
const NUEVO_DE = {
  ubicaciones: 'nueva sede o sala', racks: 'nuevo rack', puestos: 'nuevo puesto', equipos: 'nuevo equipo', vlans: 'nueva VLAN',
  enlaces_isp: 'nuevo enlace a Internet', redes_wifi: 'nueva red Wi-Fi', configuraciones: 'nueva configuración', credenciales: 'nueva credencial',
  personas: 'nueva persona', cuentas_dominio: 'nueva cuenta de dominio', licencias: 'nueva licencia', servicios: 'nuevo servicio', tramos_fibra: 'nuevo tramo de fibra',
  asignaciones: 'nueva asignación', instalaciones_licencia: 'nueva instalación de licencia', mapeos_disco: 'nuevo mapeo de disco', notas: 'nueva nota', organizaciones: 'nueva organización'
};

/** Texto de la opción «+ Crear …». @param {string} coleccion */
export function textoCrear(coleccion) {
  const t = NUEVO_DE[coleccion] || 'nuevo ' + (ROTULO_ENTIDAD[ENTIDAD_DE_COLECCION[coleccion]] || coleccion).toLowerCase();
  return '+ Crear ' + t + '…';
}

/**
 * @typedef {Object} OpcionSelector
 * @property {string} valor Id del registro.
 * @property {string} texto Lo que se lee en la lista.
 */

/** Campo de nombre de cada colección, para rotular sin saber de más. @type {Object<string, (r: any) => string>} */
const ROTULO_REGISTRO = {
  racks: r => r.rack_nombre, puestos: r => r.puesto_nombre, equipos: r => r.equipo_nombre, vlans: r => r.vlan_numero + ' · ' + r.vlan_nombre,
  enlaces_isp: r => r.enlace_proveedor, redes_wifi: r => r.wifi_ssid, configuraciones: r => r.configuracion_titulo, credenciales: r => r.credencial_nombre,
  personas: r => r.persona_nombre, cuentas_dominio: r => r.cuenta_dominio + '\\' + r.cuenta_usuario, licencias: r => r.licencia_producto,
  servicios: r => r.servicio_nombre, tramos_fibra: r => r.tramo_nombre, mapeos_disco: r => r.mapeo_letra + ' ' + r.mapeo_ruta
};

/**
 * Rótulo legible de un registro para una lista. Las sedes y salas llevan su ruta y su tipo («Sede Norte › Sala 2 (Sala)»);
 * pasar `ubicaciones` (lista de la organización) para que la ruta salga completa.
 * @param {string} coleccion @param {any} registro @param {any[]} [ubicaciones]
 */
export function rotuloDeRegistro(coleccion, registro, ubicaciones) {
  if (coleccion === 'ubicaciones') {
    const padre = registro.ubicacion_padre_id && ubicaciones ? ubicaciones.find(x => x.id === registro.ubicacion_padre_id) : null;
    return (padre ? padre.ubicacion_nombre + ' › ' : '') + registro.ubicacion_nombre + ' (' + (ROTULO_UBICACION_TIPO[registro.ubicacion_tipo] || registro.ubicacion_tipo) + ')';
  }
  const f = ROTULO_REGISTRO[coleccion];
  return f ? f(registro) : registro.id;
}

/**
 * Opciones de un selector: todos los registros vigentes de una colección en una organización, ordenados por rótulo.
 * @param {string} coleccion @param {string} organizacion_id @param {{filtro?: (r: any) => boolean}} [o]
 * @returns {Promise<OpcionSelector[]>}
 */
export async function opcionesDe(coleccion, organizacion_id, o) {
  const todos = await repositorio.listar(coleccion, r => r.organizacion_id === organizacion_id);
  const ubic = coleccion === 'ubicaciones' ? todos : undefined;
  return todos.filter(r => !o || !o.filtro || o.filtro(r))
    .map(r => ({ valor: r.id, texto: rotuloDeRegistro(coleccion, r, ubic) }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es', { numeric: true }));
}

/**
 * @typedef {HTMLSelectElement & {recargar: () => Promise<void>, listo: Promise<void>}} SelectorConCrear
 */

/**
 * `<select>` con las opciones existentes y, al final, «+ Crear nuevo…». Se lee igual que un select (`.value`, `.addEventListener`).
 * Al elegir «+ Crear…» se abre el alta COMPLETA de esa colección encima del formulario; si se guarda, el registro nuevo queda
 * elegido (y se llama a `alCambiar`); si se cancela, vuelve al valor anterior. Sin opciones todavía, igual muestra «+ Crear…».
 *
 * Qué colección se crea sale de `DEPENDENCIAS[desde][campo]`; si no se pasa `desde`/`campo`, hay que pasar `coleccion`.
 * @param {Object} o
 * @param {string} [o.desde] Colección del formulario que contiene el selector (para el mapa de dependencias y las métricas).
 * @param {string} [o.campo] Campo del formulario que se está eligiendo (`ubicacion_id`).
 * @param {string} [o.coleccion] Colección a elegir/crear (si no sale de `desde` + `campo`).
 * @param {string} o.organizacion_id
 * @param {string|null} [o.valor] Id elegido al empezar.
 * @param {OpcionSelector[]} [o.opciones] Opciones ya calculadas…
 * @param {() => Promise<OpcionSelector[]>} [o.cargarOpciones] …o cómo cargarlas (se vuelve a llamar después de crear, así una opción nueva respeta el filtro y el orden). Sin ninguna de las dos, `opcionesDe(coleccion, organizacion_id)`.
 * @param {(registro: any) => string} [o.rotuloOpcion] Texto de la opción de un registro recién creado (solo si se pasó `opciones` fijas).
 * @param {Object<string, any>} [o.valoresAlta] Valores iniciales del alta (por ejemplo `{ubicacion_tipo: 'sede'}`).
 * @param {boolean} [o.obligatorio] Sin opción «— sin elegir —».
 * @param {string} [o.id] `id` del select (para `<label for>`).
 * @param {string} [o.etiqueta] `aria-label` si no hay un label asociado.
 * @param {string} [o.rotuloOrigen] Cómo se llama el formulario de abajo («Nuevo rack»); se muestra en el alta y va en la métrica.
 * @param {(valor: string, registro: any|null) => void} [o.alCambiar] Se llama al elegir algo (`registro` solo si se acaba de crear).
 * @returns {SelectorConCrear}
 */
export function selectorConCrear(o) {
  const coleccion = o.coleccion || (o.desde && o.campo ? destinoDe(o.desde, o.campo) : null);
  if (!coleccion) throw new Error('selectorConCrear: no se sabe qué colección elegir (pasá `coleccion` o un `desde` + `campo` que figuren en DEPENDENCIAS).');
  if (o.coleccion && o.desde && o.campo) {
    const esperada = destinoDe(o.desde, o.campo);
    if (esperada && esperada !== o.coleccion) throw new Error('selectorConCrear: DEPENDENCIAS dice que ' + o.desde + '.' + o.campo + ' apunta a «' + esperada + '», no a «' + o.coleccion + '».');
  }
  const sel = /** @type {SelectorConCrear} */ (/** @type {unknown} */ (h('select', { id: o.id || null, 'aria-label': o.etiqueta || null, 'data-crea': coleccion })));
  /** @type {OpcionSelector[]} */
  let opciones = o.opciones ? o.opciones.slice() : [];
  let anterior = o.valor || '';

  const pintar = (/** @type {string} */ elegido) => {
    sel.textContent = '';
    if (!o.obligatorio) sel.appendChild(h('option', { value: '', text: '— sin elegir —' }));
    else if (!elegido) sel.appendChild(h('option', { value: '', text: '— elegir —' }));
    for (const op of opciones) sel.appendChild(h('option', { value: op.valor, text: op.texto }));
    sel.appendChild(h('option', { value: VALOR_CREAR, text: textoCrear(coleccion) }));
    sel.value = opciones.some(x => x.valor === elegido) ? elegido : '';
    anterior = sel.value;
  };

  /** @param {string} [elegido] */
  const cargar = async elegido => {
    if (o.cargarOpciones) opciones = await o.cargarOpciones();
    else if (!o.opciones) opciones = await opcionesDe(coleccion, o.organizacion_id);
    pintar(elegido === undefined ? sel.value : elegido);
  };

  const metrica = (/** @type {'creado'|'cancelado'} */ resultado) => {
    const caja = sel.closest('[role="dialog"]');
    window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo: 'crear_nuevo', detalle: {
      desde: o.desde || o.rotuloOrigen || (caja && caja.getAttribute('aria-label')) || 'pantalla', campo: o.campo || null, crea: coleccion, resultado } } }));
  };

  sel.addEventListener('change', async () => {
    if (sel.value !== VALOR_CREAR) { anterior = sel.value; if (o.alCambiar) o.alCambiar(sel.value, null); return; }
    sel.value = anterior; // mientras el alta está abierta, sigue mostrando lo de antes
    sel.disabled = true;
    let creado = null;
    try {
      creado = await abrirAlta(coleccion, { organizacion_id: o.organizacion_id, valores: o.valoresAlta, rotulo: o.rotuloOrigen || (sel.closest('[role="dialog"]') || document.createElement('i')).getAttribute('aria-label') });
    } finally { sel.disabled = false; }
    if (!creado) { metrica('cancelado'); sel.value = anterior; sel.focus(); return; }
    if (o.cargarOpciones || !o.opciones) await cargar(creado.id);
    else { opciones.push({ valor: creado.id, texto: o.rotuloOpcion ? o.rotuloOpcion(creado) : rotuloDeRegistro(coleccion, creado) }); pintar(creado.id); }
    if (sel.value !== creado.id) { // el filtro de `cargarOpciones` lo dejó afuera: se agrega igual para no perder lo creado
      opciones.push({ valor: creado.id, texto: o.rotuloOpcion ? o.rotuloOpcion(creado) : rotuloDeRegistro(coleccion, creado) }); pintar(creado.id);
    }
    metrica('creado');
    if (o.alCambiar) o.alCambiar(creado.id, creado);
    sel.focus();
  });

  sel.recargar = () => cargar();
  if (o.opciones) pintar(o.valor || ''); // con opciones ya calculadas se dibuja al instante (sin esperar)
  sel.listo = cargar(o.valor || '');
  return sel;
}

/**
 * Compara dos rótulos sin mayúsculas ni acentos (para los avisos de «ya existe»).
 * @param {string} a @param {string} b
 */
export function mismoNombre(a, b) { return normalizar(a) === normalizar(b); }

// ---------------------------------------------------------------------------------------------
// 4. Lista de casillas con «+ Crear …» (referencias que son una lista de ids) y «Duplicar» (MJ48)
// ---------------------------------------------------------------------------------------------

/**
 * Lista de casillas para una referencia que guarda VARIOS ids (por ejemplo `redes_wifi.access_point_ids`), con un botón
 * «+ Crear …» al final que abre el alta COMPLETA encima (igual que `selectorConCrear`) y deja lo creado tildado.
 * @param {Object} o
 * @param {string} [o.desde] @param {string} [o.campo] Para `DEPENDENCIAS` (o `coleccion`).
 * @param {string} [o.coleccion]
 * @param {string} o.organizacion_id
 * @param {string[]} [o.valores] Ids tildados al empezar.
 * @param {() => Promise<OpcionSelector[]>} [o.cargarOpciones] Cómo cargar las opciones (por defecto `opcionesDe`).
 * @param {Object<string, any>} [o.valoresAlta] Valores iniciales del alta.
 * @param {string} [o.rotuloOrigen] Cómo se llama el formulario de abajo.
 * @param {string} [o.vacio] Texto cuando no hay ninguna opción todavía.
 * @param {string} [o.etiqueta] `aria-label` del grupo.
 * @returns {{nodo: HTMLElement, valores: () => string[], listo: Promise<void>}}
 */
export function multiConCrear(o) {
  const coleccion = o.coleccion || (o.desde && o.campo ? destinoDe(o.desde, o.campo) : null);
  if (!coleccion) throw new Error('multiConCrear: no se sabe qué colección elegir (pasá `coleccion` o un `desde` + `campo` que figuren en DEPENDENCIAS).');
  const elegidos = new Set(o.valores || []);
  /** @type {OpcionSelector[]} */
  let opciones = [];
  const lista = h('div', { class: 'rd-lista-etq', role: 'group', 'aria-label': o.etiqueta || null });
  const nodo = h('div', { 'data-crea': coleccion });
  const pintar = () => {
    lista.textContent = '';
    if (!opciones.length) lista.appendChild(h('span', { class: 'mut', text: o.vacio || 'Todavía no hay ninguno cargado.' }));
    for (const op of opciones) {
      const c = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', value: op.valor }));
      c.checked = elegidos.has(op.valor);
      c.addEventListener('change', () => { if (c.checked) elegidos.add(op.valor); else elegidos.delete(op.valor); });
      lista.appendChild(h('label', { class: 'rd-etq' }, [c, op.texto]));
    }
  };
  const cargar = async () => { opciones = o.cargarOpciones ? await o.cargarOpciones() : await opcionesDe(coleccion, o.organizacion_id); pintar(); };
  const boton = h('button', { type: 'button', class: 'chico', text: textoCrear(coleccion), onclick: async () => {
    /** @type {HTMLButtonElement} */ (boton).disabled = true;
    let creado = null;
    try {
      const caja = nodo.closest('[role="dialog"]');
      creado = await abrirAlta(coleccion, { organizacion_id: o.organizacion_id, valores: o.valoresAlta, rotulo: o.rotuloOrigen || (caja && caja.getAttribute('aria-label')) || null });
    } finally { /** @type {HTMLButtonElement} */ (boton).disabled = false; }
    window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo: 'crear_nuevo', detalle: {
      desde: o.desde || o.rotuloOrigen || 'pantalla', campo: o.campo || null, crea: coleccion, resultado: creado ? 'creado' : 'cancelado' } } }));
    if (!creado) return;
    elegidos.add(creado.id);
    await cargar();
    if (!opciones.some(x => x.valor === creado.id)) { opciones.push({ valor: creado.id, texto: rotuloDeRegistro(coleccion, creado) }); pintar(); }
  } });
  nodo.appendChild(lista); nodo.appendChild(h('div', { style: 'margin-top:6px' }, [boton]));
  return { nodo, valores: () => Array.from(elegidos), listo: cargar() };
}

/**
 * «Duplicar» (MJ48): abre el alta de `coleccion` con los valores copiados de `origen` (el llamador decide cuáles se copian) para
 * que el usuario ajuste y guarde. Emite `infradoc:metrica` con `tipo: 'duplicar'`. Resuelve con el registro creado o `null`.
 * @param {string} coleccion @param {{id: string, organizacion_id: string}} origen @param {Object<string, any>} valores
 * @param {string} nombreOrigen Cómo se llama lo que se copia (para el aviso del formulario).
 * @returns {Promise<any|null>}
 */
export function duplicar(coleccion, origen, valores, nombreOrigen) {
  window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo: 'duplicar', detalle: { coleccion, origen_id: origen.id } } }));
  return abrirAlta(coleccion, { organizacion_id: origen.organizacion_id, valores: { ...valores, duplicado_de: nombreOrigen }, rotulo: null }).then(creado => {
    // QC69-C: también si se guardó o se canceló, para saber si «Duplicar» le sirvió.
    window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo: 'duplicar_resultado', detalle: { coleccion, origen_id: origen.id, resultado: creado ? 'guardado' : 'cancelado' } } }));
    return creado;
  });
}
