// @ts-check
/**
 * Asistente de consultas (D-063, D-065). Botón flotante con un panel de preguntas y respuestas cortas.
 *  - Opción A (siempre): intérprete de preguntas en español por patrones (con sinónimos rioplatenses; si no entiende, sugiere las preguntas previstas más parecidas). La respuesta sale SIEMPRE del repositorio,
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
import * as ia from './ia-navegador.js';
import * as solicitudes from './solicitudes.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_ESTADO_EQUIPO, ROTULO_CUENTA_ESTADO, ROTULO_SERVICIO_TIPO, ROTULO_CONFIGURACION_TIPO, ROTULO_FIBRA_TIPO, ATENUACION_ALTA_DB } from './modelos.js';
import { h, icono, normalizar, hoyISO, fmtFecha, diasHasta, diasDesde, textoHace, textoVence } from './utiles.js';

// ---------------------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------------------

/** @typedef {{t: string, href?: string}} Parte */
/** @typedef {{partes: Parte[], detalle?: string, orgId?: string|null}} Item */
/** @typedef {{texto: string, items?: Item[], mas?: number, sugerencias?: string[], encabezado?: boolean}} Grupo */
/** @typedef {{grupos: Grupo[], nota?: string, enlace?: Parte}} Respuesta */
/** @typedef {'ayuda'|'ip'|'conexion'|'vence'|'asignado_a'|'equipos_de'|'licencias'|'sin_verificar'|'contrasena'|'ubicacion'|'rack_contenido'|'vlan_info'|'vlan_de'|'wifi'|'internet'|'dato_equipo'|'listar_tipo'|'sin_asignar'|'cuenta_de'|'persona_info'|'licencias_de'|'mapeo'|'servicio'|'config_doc'|'fibra'|'solicitudes'|'navegar'|'camara'|'proveedor'} Intencion */
/**
 * @typedef {Object} Interpretacion
 * @property {Intencion} intencion
 * @property {string} objeto Palabras del equipo, persona o cosa de la que se pregunta.
 * @property {string} [puesto] Número o nombre del puesto.
 * @property {number} [dias]
 * @property {string} [ventana] Texto de la pregunta con el período (vence, sin_verificar).
 * @property {string} [filtro]
 * @property {boolean} [ilo]
 * @property {string} [campo] Qué dato se pide (modelo, serie, gateway, MX…).
 * @property {string} [tipo] Tipo de equipo, de configuración o de servicio.
 * @property {string} [letra] Letra de unidad de red («S:»).
 * @property {number} [numero] Número de VLAN.
 * @property {string} [tema] Pantalla (id de DESTINOS) para `navegar`; varias separadas por coma.
 */
/**
 * @typedef {Object} Ctx
 * @property {import('./modelos.js').UsuarioSesion} u
 * @property {string|null} org Organización abierta (o la propia); null = todas las que el usuario ve.
 * @property {Map<string, string>} orgs id → nombre
 * @property {(modulo: any, orgId: string|null|undefined) => boolean} veo
 * @property {(coleccion: string) => Promise<any[]>} listar Lectura memoizada por pregunta.
 */

const INTENCIONES = /** @type {Intencion[]} */ (['ayuda', 'ip', 'conexion', 'vence', 'asignado_a', 'equipos_de', 'licencias', 'sin_verificar', 'contrasena', 'ubicacion', 'rack_contenido', 'vlan_info', 'vlan_de', 'wifi', 'internet', 'dato_equipo', 'listar_tipo', 'sin_asignar',
  'cuenta_de', 'persona_info', 'licencias_de', 'mapeo', 'servicio', 'config_doc', 'fibra', 'solicitudes', 'navegar', 'camara', 'proveedor']);
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
    case 'ubicaciones': return '#/ubicacion/' + r.id;
    case 'personas': return '#/persona/' + r.id;
    case 'cuentas_dominio': return '#/cuenta/' + r.id;
    case 'licencias': return '#/licencia/' + r.id;
    case 'mapeos_disco': return '#/mapeo/' + r.id;
    case 'servicios': return '#/servicio/' + r.id;
    case 'proveedores': return '#/proveedor/' + r.id;
    case 'tramos': case 'tramos_fibra': return '#/tramo/' + r.id;
    case 'enlaces_isp': return '#/enlace/' + r.id;
    default: return '#/inicio';
  }
}

/** Módulo de permisos de un registro. @param {string} coleccion @param {any} r */
function moduloDe(coleccion, r) {
  switch (coleccion) {
    case 'equipos': return r.equipo_tipo === 'servidor' ? 'servidores' : 'red';
    case 'credenciales': return 'credenciales';
    case 'racks': return 'racks';
    case 'configuraciones': case 'mapeos_disco': case 'servicios': case 'proveedores': return 'configuraciones';
    case 'personas': case 'cuentas_dominio': case 'asignaciones': return 'personas';
    case 'licencias': case 'instalaciones_licencia': return 'licencias';
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
    case 'servicios': return r.servicio_nombre;
    case 'proveedores': return r.proveedor_nombre;
    case 'tramos_fibra': return r.tramo_nombre;
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
  const mejores = lista => {
    // Si algún título tiene todas las palabras al comienzo de sus palabras («nas» → NAS-AGRO-01), quedan solo esos.
    const alInicio = lista.filter(x => { const pals = normalizar(x.titulo).split(/[^a-z0-9]+/); return palabras.every(p => pals.some(w => w.startsWith(p)) || p.includes('-') && normalizar(x.titulo).includes(p)); });
    if (alInicio.length) return alInicio;
    if (!palabras.some(p => /\d/.test(p))) return lista;
    const t = lista.filter(x => palabras.every(p => normalizar(x.titulo).includes(p))); return t.length ? t : lista;
  };
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
// Catálogo de preguntas previstas (MI7, MI8). Cada ejemplo marca con {llaves} el objeto de la pregunta (el nombre
// que el usuario cambia): sirve para completar las sugerencias con lo que escribió.
// ---------------------------------------------------------------------------------------------

/** @type {Record<Intencion, {titulo: string, ejemplos: string[], claves: string[]}>} */
const CATALOGO = {
  ayuda: { titulo: 'Ayuda', ejemplos: ['¿Qué puedo preguntar?', 'Ayuda', 'Hola'], claves: ['ayud', 'preguntar', 'puedo', 'sabes', 'hola', 'buenas'] },
  ip: { titulo: 'Direcciones IP', ejemplos: ['¿Qué IP tiene {SRV-AGRO-01}?', '¿Qué IP de iLO tiene {SRV-AGRO-01}?', 'Dame la dirección de {la impresora de administración}'], claves: ['ip', 'direcc', 'ilo', 'idrac', 'gestion'] },
  conexion: { titulo: 'Conexiones y puertos', ejemplos: ['¿A qué puerto va el puesto {ADM-01}?', '¿Con qué switch se conecta {SRV-AGRO-01}?', '¿En qué boca está la {PC-AGRO-001}?', '¿Qué hay conectado al switch {SW-CORE-01}?'], claves: ['conect', 'puert', 'boca', 'patch', 'cable', 'switch', 'enchuf'] },
  vence: { titulo: 'Vencimientos', ejemplos: ['¿Qué vence este mes?', '¿Qué se termina en diciembre?', '¿Qué hay que renovar pronto?'], claves: ['venc', 'renov', 'venz', 'caduc', 'expir', 'termin', 'pronto'] },
  asignado_a: { titulo: 'Quién tiene un equipo', ejemplos: ['¿A quién está asignado {PC-AGRO-001}?', '¿Quién usa la {PC-AGRO-001}?', '¿De quién es {NB-AGRO-01}?'], claves: ['asign', 'pertenec', 'usa', 'duen'] },
  equipos_de: { titulo: 'Equipos de una persona', ejemplos: ['¿Qué equipos tiene {Fabián Farías}?', '¿Qué compus tiene {Fabián Farías}?', '¿Qué notebooks usa {Fabián Farías}?'], claves: ['compu', 'maquin', 'notebook', 'laptop', 'equipos'] },
  licencias: { titulo: 'Licencias excedidas o vencidas', ejemplos: ['¿Qué licencias están excedidas o vencidas?', '¿Nos pasamos con las licencias de {Office}?'], claves: ['licenc', 'excedid', 'pasamos', 'sobran', 'vencid'] },
  sin_verificar: { titulo: 'Datos sin verificar', ejemplos: ['¿Qué no se verificó hace más de un año?', '¿Hay algo que no revisamos hace mucho?', '¿Qué está sin controlar?'], claves: ['verific', 'revis', 'chequ', 'control', 'actualiz', 'antigu'] },
  contrasena: { titulo: 'Contraseñas y accesos', ejemplos: ['¿Cuál es la contraseña de {iDRAC SRV-AGRO-01}?', '¿Cómo entro a la iLO de {SRV-AGRO-01}?', '¿Usuario y clave del {router}?'], claves: ['contras', 'clave', 'pass', 'acceso', 'entro', 'entrar', 'acced', 'usuario', 'login', 'credenc'] },
  ubicacion: { titulo: 'Dónde está algo', ejemplos: ['¿Dónde está {SRV-AGRO-01}?', '¿En qué rack está el {switch core}?', '¿Dónde queda la {PC-AGRO-001}?'], claves: ['ubic', 'queda', 'sala', 'sede', 'lugar', 'rack', 'posicion'] },
  rack_contenido: { titulo: 'Contenido de un rack', ejemplos: ['¿Qué hay en el {rack principal}?', '¿Qué equipos tiene el rack {RACK-SRV-01}?', '¿Cuántas U libres tiene el rack {RACK-SRV-01}?'], claves: ['rack', 'unidad', 'libres', 'contenido', 'gabinete'] },
  vlan_info: { titulo: 'VLAN', ejemplos: ['¿Qué red tiene la VLAN {10}?', '¿Cuál es el gateway de la VLAN de {cámaras}?', '¿La VLAN {20} tiene DHCP?', '¿Qué VLAN hay?'], claves: ['vlan', 'gateway', 'dhcp', 'subred', 'cidr', 'rango', 'red'] },
  vlan_de: { titulo: 'VLAN de un equipo o puesto', ejemplos: ['¿En qué VLAN está {SRV-AGRO-01}?', '¿Qué VLAN usa el puesto {ADM-01}?'], claves: ['vlan'] },
  wifi: { titulo: 'Redes Wi-Fi', ejemplos: ['¿Cuál es el Wi-Fi de {invitados}?', '¿Qué redes Wi-Fi hay?', '¿Cuál es la clave del wifi?'], claves: ['wifi', 'wi-fi', 'inalam', 'ssid', 'invitad'] },
  internet: { titulo: 'Internet y proveedores', ejemplos: ['¿Qué proveedor de internet tenemos?', '¿Cuál es la IP pública?', '¿Cuál es el número de cliente de {Telecom}?', '¿Teléfono de soporte del ISP?'], claves: ['internet', 'isp', 'proveedor', 'publica', 'cliente', 'soporte', 'velocidad', 'megas', 'mbps'] },
  dato_equipo: { titulo: 'Datos de un equipo', ejemplos: ['¿Qué modelo es {SRV-AGRO-01}?', '¿Número de serie de {PC-AGRO-001}?', '¿Qué sistema operativo tiene {SRV-AGRO-01}?', '¿Cuándo vence la garantía de {SRV-AGRO-01}?'], claves: ['model', 'serie', 'marca', 'mac', 'ram', 'memoria', 'cpu', 'procesador', 'sistema', 'operativo', 'garant', 'firmware', 'almacen', 'disco'] },
  listar_tipo: { titulo: 'Listas de equipos por tipo', ejemplos: ['¿Qué servidores hay?', '¿Cuántas impresoras hay?', 'Listá los switches', '¿Cuántas notebooks hay?'], claves: ['servidor', 'impresora', 'switch', 'notebook', 'router', 'firewall', 'patchera', 'ups', 'cuantos', 'cuantas', 'lista', 'nas', 'reloj'] },
  sin_asignar: { titulo: 'Equipos sin asignar', ejemplos: ['¿Qué equipos están sin asignar?', '¿Qué hay en depósito?', '¿Qué notebooks están libres?'], claves: ['asignar', 'deposito', 'libre', 'disponible', 'sin'] },
  cuenta_de: { titulo: 'Cuentas de dominio', ejemplos: ['¿Cuál es el usuario de dominio de {Fabián Farías}?', '¿Qué cuentas tiene {Fabián Farías}?', '¿A quién pertenece la cuenta {jperez}?'], claves: ['cuenta', 'dominio', 'usuario', 'login'] },
  persona_info: { titulo: 'Personas y sectores', ejemplos: ['¿En qué sector trabaja {Fabián Farías}?', '¿Dónde se sienta {Fabián Farías}?', '¿Quién está en el puesto {ADM-01}?', '¿Quiénes son de {Administración}?'], claves: ['sector', 'sienta', 'puesto', 'persona', 'trabaja', 'quienes', 'area'] },
  licencias_de: { titulo: 'Licencias de un equipo, persona o producto', ejemplos: ['¿Qué licencias tiene {PC-AGRO-001}?', '¿Qué licencias usa {Fabián Farías}?', '¿Dónde está instalado {Office}?', '¿Cuántas licencias de {Windows} quedan?'], claves: ['licenc', 'instalad', 'office', 'windows', 'quedan', 'software'] },
  mapeo: { titulo: 'Unidades de red (mapeos)', ejemplos: ['¿Qué unidades de red tiene {Fabián Farías}?', '¿A dónde apunta la unidad {S:}?', '¿Qué mapeos hay?'], claves: ['mapeo', 'unidad', 'unidades', 'carpeta', 'compartid'] },
  servicio: { titulo: 'Dominios, hosting y DNS', ejemplos: ['¿Dónde está registrado el dominio {agrodemo.example}?', '¿Quién es el proveedor del {hosting}?', '¿Cuáles son los registros {MX}?', '¿Qué DNS tiene el dominio {agrodemo.example}?'], claves: ['dominio', 'dns', 'hosting', 'registr', 'certific', 'ssl', 'correo', 'titular'] },
  config_doc: { titulo: 'Configuraciones y documentación', ejemplos: ['¿Cómo está configurada la {VPN}?', '¿Cuáles son las reglas del {firewall}?', '¿Hay documentación del {controlador de dominio}?', '¿Qué puertos están redirigidos?'], claves: ['config', 'vpn', 'regla', 'reenv', 'redirig', 'document', 'politic'] },
  fibra: { titulo: 'Fibra óptica', ejemplos: ['¿Qué tramos de fibra hay?', '¿Qué va por la fibra entre la planta y la administración?', '¿Cuál fue la última medición de la fibra?'], claves: ['fibra', 'tramo', 'pelo', 'medicion', 'empalm'] },
  solicitudes: { titulo: 'Solicitudes', ejemplos: ['¿Tengo solicitudes pendientes?', '¿Qué pedidos de acceso hay?'], claves: ['solicitud', 'pedido', 'pendiente', 'aprob'] },
  navegar: { titulo: 'Cómo llegar a una pantalla', ejemplos: ['¿Cómo exporto los datos?', '¿Dónde cargo un equipo nuevo?', '¿Dónde veo el registro de accesos?', 'Quiero ver la topología'], claves: ['exporto', 'exportar', 'importar', 'imprimo', 'etiqueta', 'topolog', 'plano', 'registro', 'cargo', 'cargar', 'crear', 'nuevo', 'abrir'] },
  camara: { titulo: 'Cámaras', ejemplos: ['¿Qué IP tiene la cámara {del portón}?', '¿A qué switch y puerto está conectada la cámara {del portón}?', '¿Dónde está la cámara {del portón}?', '¿Qué cámaras graba el {NVR-METAL-01}?'], claves: ['camar', 'nvr', 'dvr', 'canal', 'poe', 'graba', 'grabador', 'enfoca', 'video'] },
  proveedor: { titulo: 'Proveedores y soporte', ejemplos: ['¿Cuál es el teléfono de soporte de {Telecom}?', '¿Qué número de cliente tenemos con {Telecom}?', '¿Quién es el contacto comercial de {Telecom}?', '¿Qué proveedores de {mantenimiento} tenemos?'], claves: ['proveedor', 'soporte', 'cliente', 'contrato', 'comercial', 'portal', 'rubro', 'telefono', 'horario'] }
};

/** Texto de un ejemplo sin las llaves. @param {string} e */
const sinLlaves = e => e.replace(/[{}]/g, '');
/** Objeto marcado entre llaves de un ejemplo («» si no tiene). @param {string} e */
const objetoDeEjemplo = e => { const m = e.match(/\{([^}]*)\}/); return m ? m[1] : ''; };

/** Letras iguales al comienzo de dos palabras. @param {string} a @param {string} b */
function prefijoComun(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }

/** Una palabra de la pregunta coincide con una clave: igual, o 4 o más letras iguales al principio. @param {string} w @param {string} k */
const coincide = (w, k) => w === k || (w.length >= 4 && k.length >= 4 && prefijoComun(w, k) >= 4);

/** Palabras sueltas del texto original, con sus mayúsculas. @param {string} s */
const trozos = s => (s.match(/[^\s¿?¡!«»"“”,;()]+/g) || []).map(x => x.replace(/[.:]+$/, '')).filter(Boolean);

/**
 * Preguntas previstas más parecidas a una que no se entendió (MI8). Puntúa cada intención por palabras clave (3 puntos cada
 * una) y por palabras de sus ejemplos (1 punto), con coincidencia por prefijo de 4 o más letras. Cada sugerencia sale de un
 * ejemplo completado con el objeto que escribió el usuario. Sin ninguna coincidencia devuelve una lista vacía.
 * @param {string} pregunta
 * @returns {Array<{intencion: Intencion, texto: string}>}
 */
function sugerirParecidas(pregunta) {
  const n = limpiar(pregunta);
  const palabras = Array.from(new Set(n.split(' ').map(p => p.replace(/\.+$/, '')).filter(p => p.length >= 2 && !STOP.has(p))));
  if (!palabras.length) return [];
  /** @type {Array<{intencion: Intencion, puntos: number, orden: number}>} */
  const puntaje = [];
  INTENCIONES.forEach((intencion, orden) => {
    if (intencion === 'ayuda') return;
    const c = CATALOGO[intencion];
    let puntos = 0;
    for (const k of c.claves) if (palabras.some(w => coincide(w, k))) puntos += 3;
    /** @type {Set<string>} */
    const delEjemplo = new Set();
    for (const e of c.ejemplos) {
      const obj = normalizar(objetoDeEjemplo(e));
      for (const p of limpiar(sinLlaves(e)).split(' ')) if (p.length >= 4 && !STOP.has(p) && !obj.split(' ').includes(p)) delEjemplo.add(p);
    }
    puntos += palabras.filter(w => Array.from(delEjemplo).some(p => coincide(w, p))).length;
    if (puntos > 0) puntaje.push({ intencion, puntos, orden });
  });
  puntaje.sort((a, b) => b.puntos - a.puntos || a.orden - b.orden);
  // Objeto de la pregunta: lo que no es una palabra vacía ni una palabra clave de ninguna intención.
  const todasLasClaves = INTENCIONES.flatMap(i => CATALOGO[i].claves);
  const objeto = trozos(pregunta).filter(t => { const w = limpiar(t); return w && !STOP.has(w) && !todasLasClaves.some(k => coincide(w, k) || w === k) && !/^(cual|cuales|me|decime|decir|dime)$/.test(w); })
    .map(t => (/\d/.test(t) && /-/.test(t) ? t.toUpperCase() : t)).join(' ');
  /** @type {Array<{intencion: Intencion, texto: string}>} */
  const salida = [];
  for (const { intencion } of puntaje.slice(0, 3)) {
    const c = CATALOGO[intencion];
    const mejor = c.ejemplos.map((e, i) => ({ e, i, p: palabras.filter(w => limpiar(sinLlaves(e)).split(' ').some(x => coincide(w, x))).length + (objeto && /\{/.test(e) ? 0.5 : 0) }))
      .sort((a, b) => b.p - a.p || a.i - b.i)[0].e;
    let texto = sinLlaves(mejor);
    if (objeto && /\{/.test(mejor)) {
      const completo = mejor.replace(/\{[^}]*\}/, () => objeto).replace(/[{}]/g, '');
      const i = interpretar(completo);
      if (i && i.intencion === intencion) texto = completo;
    }
    salida.push({ intencion, texto });
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// Tablas del intérprete: tipos de equipo, campos de un equipo, pantallas
// ---------------------------------------------------------------------------------------------

/**
 * Tipos de equipo que se pueden listar. `patron` se prueba sobre la pregunta limpia; `tipo` es el `equipo_tipo` y `categorias`,
 * las categorías de `equipo_tipo = otro` (equipo_campos.otro_categoria, sin distinguir mayúsculas).
 * @type {Array<{clave: string, rotulo: string, patron: RegExp, tipo?: string, categorias?: string[], pantalla: string}>}
 */
const TIPOS_EQUIPO = [
  { clave: 'router', rotulo: 'routers', patron: /\brouters?\b/, tipo: 'router', pantalla: '#/red' },
  { clave: 'firewall', rotulo: 'firewalls', patron: /\b(firewalls?|cortafuegos)\b/, tipo: 'firewall', pantalla: '#/red' },
  { clave: 'switch', rotulo: 'switches', patron: /\b(switch|switches|switchs|conmutadores?)\b/, tipo: 'switch', pantalla: '#/red' },
  { clave: 'access_point', rotulo: 'access points', patron: /\b(access points?|accesspoints?|aps|puntos? de acceso|antenas?)\b/, tipo: 'access_point', pantalla: '#/red' },
  { clave: 'servidor', rotulo: 'servidores', patron: /\b(servidor|servidores|servers?)\b/, tipo: 'servidor', pantalla: '#/servidores' },
  { clave: 'patchera', rotulo: 'patcheras', patron: /\bpatcher(a|as)\b/, tipo: 'patchera', pantalla: '#/red' },
  { clave: 'ups', rotulo: 'UPS', patron: /\b(ups|no ?breaks?)\b/, tipo: 'ups', pantalla: '#/red' },
  { clave: 'notebook', rotulo: 'notebooks', patron: /\b(notebooks?|laptops?|portatiles?)\b/, categorias: ['notebook'], pantalla: '#/escritorio' },
  { clave: 'pc', rotulo: 'PC de escritorio', patron: /\b(pcs|pc de escritorio|(computadoras?|compus?|equipos?|maquinas?) de escritorio|escritorio)\b/, categorias: ['pc de escritorio'], pantalla: '#/escritorio' },
  { clave: 'computadoras', rotulo: 'computadoras (PC y notebooks)', patron: /\b(computadoras?|compus?|maquinas?|pc)\b/, categorias: ['pc de escritorio', 'notebook'], pantalla: '#/escritorio' },
  { clave: 'impresora', rotulo: 'impresoras', patron: /\bimpresoras?\b/, categorias: ['impresora de red', 'impresora'], pantalla: '#/escritorio' },
  { clave: 'nas', rotulo: 'NAS', patron: /\bnas\b/, categorias: ['nas'], pantalla: '#/red' },
  { clave: 'reloj', rotulo: 'relojes de control de personal', patron: /\brelojes?\b/, categorias: ['reloj de control de personal'], pantalla: '#/red' },
  { clave: 'hmi', rotulo: 'terminales de planta (HMI)', patron: /\b(hmi|terminales? de planta)\b/, categorias: ['hmi / terminal de planta'], pantalla: '#/red' },
  { clave: 'balanza', rotulo: 'terminales de balanza', patron: /\b(balanzas?|terminales? de balanza)\b/, categorias: ['terminal de balanza'], pantalla: '#/red' },
  { clave: 'nvr', rotulo: 'NVR de cámaras', patron: /\b(nvr|dvr|grabadoras? de camaras?)\b/, categorias: ['nvr de camaras'], pantalla: '#/red' }
];

/** Clave del tipo de equipo que menciona la pregunta (o ''). Se prueba del más específico al más general. @param {string} n */
function tipoEquipoDe(n) {
  const orden = ['notebook', 'pc', 'impresora', 'router', 'firewall', 'switch', 'access_point', 'servidor', 'patchera', 'ups', 'nas', 'reloj', 'hmi', 'balanza', 'nvr', 'computadoras'];
  for (const c of orden) { const t = TIPOS_EQUIPO.find(x => x.clave === c); if (t && t.patron.test(n)) return c; }
  return '';
}

/**
 * Campos de un equipo que se pueden preguntar. `patron` se prueba sobre la pregunta limpia.
 * @type {Array<{clave: string, rotulo: string, patron: RegExp}>}
 */
const CAMPOS_EQUIPO = [
  { clave: 'garantia', rotulo: 'Garantía', patron: /\bgarantia\b/ },
  { clave: 'serie', rotulo: 'Número de serie', patron: /\b(numero de serie|nro de serie|n de serie|serie|service tag|s\/n)\b/ },
  { clave: 'mac', rotulo: 'MAC', patron: /\bmac\b/ },
  { clave: 'modelo', rotulo: 'Modelo', patron: /\bmodelo\b/ },
  { clave: 'marca', rotulo: 'Marca', patron: /\b(marca|fabricante)\b/ },
  { clave: 'so', rotulo: 'Sistema operativo', patron: /\b(sistema operativo|so)\b/ },
  { clave: 'ram', rotulo: 'RAM', patron: /\b(ram|memoria)\b/ },
  { clave: 'cpu', rotulo: 'CPU', patron: /\b(cpu|procesador|procesadores)\b/ },
  { clave: 'almacenamiento', rotulo: 'Almacenamiento', patron: /\b(almacenamiento|discos?|raid)\b/ },
  { clave: 'virtualizacion', rotulo: 'Virtualización', patron: /\b(virtualizacion|hipervisor)\b/ },
  { clave: 'rol', rotulo: 'Rol', patron: /\b(rol|funcion|para que sirve)\b/ },
  { clave: 'firmware', rotulo: 'Firmware', patron: /\bfirmware\b/ },
  { clave: 'estado', rotulo: 'Estado', patron: /\bestado\b/ },
  { clave: 'codigo', rotulo: 'Código', patron: /\b(codigo|inventario|patrimonio)\b/ }
];

/** Palabras que acompañan a un campo y no son el objeto. */
const PALABRAS_CAMPO = ['modelo', 'marca', 'fabricante', 'serie', 'numero', 'nro', 'mac', 'ram', 'memoria', 'cpu', 'procesador', 'procesadores', 'sistema', 'operativo', 'so', 'garantia', 'vence', 'vencen', 'vencimiento',
  'cuando', 'cuanta', 'cuanto', 'firmware', 'version', 'almacenamiento', 'disco', 'discos', 'raid', 'rol', 'funcion', 'sirve', 'estado', 'codigo', 'inventario', 'patrimonio', 'virtualizacion', 'hipervisor', 'service', 'tag',
  'del', 'de', 'la', 'el', 'tiene', 'usa', 'esta', 'es', 'mes', 'proximos', 'proximo', 'dias', 'semana', 'este', 'equipo', 'servidor', 'notebook', 'pc'];

/**
 * Pantallas a las que el asistente lleva. `modulo` o `accion` son la regla de visibilidad del menú (marco.js); `org` es
 * true si la pantalla necesita una organización elegida.
 * @type {Array<{id: string, ruta: string, rotulo: string, texto: string, patron: RegExp, modulo?: import('./modelos.js').Modulo, accion?: import('./permisos.js').Accion, org: boolean}>}
 */
const DESTINOS = [
  { id: 'accesos', ruta: '#/accesos', rotulo: 'Registro de accesos', texto: 'Ahí ves quién mostró o copió cada contraseña y cuándo.', patron: /\b(registro de accesos|accesos a (las )?(credenciales|contrasenas)|quien (vio|miro|copio|abrio))/, accion: 'ver_registro_accesos', org: false },
  { id: 'datos', ruta: '#/datos', rotulo: 'Datos del prototipo', texto: 'Desde ahí exportás, importás y restablecés los datos (copia de respaldo, planilla de Excel o datos de ejemplo).', patron: /\b(exportar|exporto|exportamos|importar|importo|importamos|respaldo|respaldar|backup|copia de seguridad|planilla|excel|restablecer|restauro|restaurar|datos de ejemplo|descargar los datos|bajar los datos)\b/, org: false },
  { id: 'ajustes', ruta: '#/ajustes', rotulo: 'Ajustes del sistema', texto: 'Ahí cambiás los umbrales de verificación y descargás o probás la IA del navegador.', patron: /\b(ajustes|umbrales?|ia del navegador|inteligencia artificial|modelo de ia|descargar la ia|ajustar)\b/, accion: 'ajustes_sistema', org: false },
  { id: 'etiquetas', ruta: '#/etiquetas', rotulo: 'Etiquetas', texto: 'Ahí armás e imprimís las etiquetas con código QR de los equipos, racks y puestos.', patron: /\b(etiquetas?|qr|codigos? qr|rotular|rotulos?)\b/, org: true },
  { id: 'informe', ruta: '#/informe', rotulo: 'Documentación PDF', texto: 'Ahí generás la documentación de la organización para imprimir o guardar como PDF.', patron: /\b(informe|informes|pdf|imprimir la documentacion|documentacion de la organizacion|documento de la organizacion)\b/, org: true },
  { id: 'topologia', ruta: '#/topologia', rotulo: 'Topología de red', texto: 'Ahí ves el diagrama de cómo se conectan los equipos de red.', patron: /\btopolog\w*/, modulo: 'red', org: true },
  { id: 'plano', ruta: '#/plano', rotulo: 'Plano de la sede', texto: 'Ahí ves el plano de cada sede con los racks y puestos ubicados.', patron: /\bplanos?\b/, modulo: 'racks', org: true },
  { id: 'recorrido', ruta: '#/recorrido', rotulo: 'Recorrido de verificación', texto: 'Ahí recorrés la organización y confirmás qué datos siguen vigentes.', patron: /\b(recorrido|verificar|verifico|verificacion)\b/, modulo: 'racks', org: true },
  { id: 'fibra', ruta: '#/fibra', rotulo: 'Fibra óptica', texto: 'Ahí ves los tramos de fibra, sus pelos y las mediciones.', patron: /\b(fibra|tramos?|pelos)\b/, modulo: 'red', org: true },
  { id: 'servicios', ruta: '#/servicios', rotulo: 'Dominios y servicios', texto: 'Ahí ves los dominios, el DNS, el hosting, los certificados y el correo.', patron: /\b(dominios?|servicios|hosting|certificados?|dns)\b/, modulo: 'configuraciones', org: true },
  { id: 'proveedores', ruta: '#/proveedores', rotulo: 'Proveedores', texto: 'Ahí ves los proveedores, su soporte, el número de cliente y el acceso a su portal.', patron: /\b(proveedores|proveedor)\b/, modulo: 'configuraciones', org: true },
  { id: 'notas', ruta: '#/notas', rotulo: 'Notas', texto: 'Ahí ves las notas libres de la organización y las de cada ficha.', patron: /\bnotas?\b/, org: true },
  { id: 'licencias', ruta: '#/licencias', rotulo: 'Licencias', texto: 'Ahí ves las licencias, cuántas están en uso y cuándo vencen.', patron: /\blicencias?\b/, modulo: 'licencias', org: true },
  { id: 'personas', ruta: '#/personas', rotulo: 'Personas', texto: 'Ahí ves las personas, sus cuentas de dominio y sus equipos.', patron: /\b(personas?|empleados?|gente|cuentas de dominio)\b/, modulo: 'personas', org: true },
  { id: 'racks', ruta: '#/racks', rotulo: 'Racks', texto: 'Ahí ves cada rack dibujado por unidades.', patron: /\bracks?\b/, modulo: 'racks', org: true },
  { id: 'servidores', ruta: '#/servidores', rotulo: 'Servidores', texto: 'Ahí ves los servidores y las máquinas virtuales.', patron: /\b(servidor|servidores|maquinas virtuales)\b/, modulo: 'servidores', org: true },
  { id: 'escritorio', ruta: '#/escritorio', rotulo: 'Equipos de escritorio', texto: 'Ahí ves las PC de escritorio y notebooks, su puesto y a quién están asignadas.', patron: /\b(escritorio|pcs?|notebooks?|laptops?|computadoras?|compus?|impresoras?)\b/, modulo: 'red', org: true },
  { id: 'red', ruta: '#/red', rotulo: 'Red', texto: 'Ahí ves los equipos de red, las VLAN, las redes Wi-Fi y los enlaces a Internet.', patron: /\b(red|redes|vlans?|wifi|wi-?fi|isp|internet|switch|switches|router|firewall|access points?)\b/, modulo: 'red', org: true },
  { id: 'credenciales', ruta: '#/credenciales', rotulo: 'Credenciales', texto: 'Ahí ves las credenciales; para ver una contraseña entrás a su ficha.', patron: /\b(credenciales?)\b/, modulo: 'credenciales', org: true },
  { id: 'configuraciones', ruta: '#/configuraciones', rotulo: 'Configuraciones', texto: 'Ahí ves las VPN, el reenvío de puertos, las reglas de firewall y los mapeos de disco.', patron: /\b(configuraciones?|vpn|vpns|firewall|mapeos?|reglas|reenvio)\b/, modulo: 'configuraciones', org: true },
  { id: 'solicitudes', ruta: '#/solicitudes', rotulo: 'Solicitudes', texto: 'Ahí gestionás los pedidos para ver contraseñas.', patron: /\b(solicitudes|pedidos)\b/, org: false },
  { id: 'organizaciones', ruta: '#/organizaciones', rotulo: 'Organizaciones', texto: 'Ahí ves las organizaciones que atendés y elegís con cuál trabajar.', patron: /\b(organizaciones?|clientes?|empresas?)\b/, accion: 'ver_organizaciones', org: false },
  { id: 'usuarios', ruta: '#/usuarios', rotulo: 'Usuarios', texto: 'Ahí ves y creás los usuarios de roles inferiores al tuyo.', patron: /\busuarios?\b/, accion: 'ver_usuarios', org: false }
];

/** Pantalla (id de DESTINOS) a la que se refiere el texto limpio, o ''. @param {string} n */
function temaNavegacion(n) {
  const d = DESTINOS.find(x => x.patron.test(n));
  return d ? d.id : '';
}

/** Para «cargar / crear / agregar X»: pantallas donde se carga cada cosa. @param {string} n @returns {string[]} ids de DESTINOS */
function pantallasDeAlta(n) {
  if (/\b(servidor|servidores|maquina virtual|vm)\b/.test(n)) return ['servidores'];
  if (/\b(pc|pcs|notebooks?|laptops?|computadoras?|compus?|impresoras?)\b/.test(n)) return ['escritorio'];
  if (/\b(switch|switches|router|firewall|access points?|patchera|ups|camaras?|nvr|dvr|vlans?|wifi|wi-?fi|enlace|isp)\b/.test(n)) return ['red'];
  if (/\bracks?\b/.test(n)) return ['racks'];
  if (/\b(personas?|empleados?|cuentas?)\b/.test(n)) return ['personas'];
  if (/\blicencias?\b/.test(n)) return ['licencias'];
  if (/\b(credenciales?|contrasenas?)\b/.test(n)) return ['credenciales'];
  if (/\b(configuraciones?|vpn|mapeos?|reglas)\b/.test(n)) return ['configuraciones'];
  if (/\b(dominios?|servicios?|hosting|certificados?)\b/.test(n)) return ['servicios'];
  if (/\bproveedor(es)?\b/.test(n)) return ['proveedores'];
  if (/\b(fibra|tramos?)\b/.test(n)) return ['fibra'];
  if (/\bnotas?\b/.test(n)) return ['notas'];
  if (/\busuarios?\b/.test(n)) return ['usuarios'];
  if (/\b(organizaciones?|clientes?|empresas?)\b/.test(n)) return ['organizaciones'];
  if (/\b(equipos?|dispositivos?)\b/.test(n)) return ['red', 'servidores', 'escritorio'];
  return [];
}

// ---------------------------------------------------------------------------------------------
// Intérprete A: pregunta → intención
// ---------------------------------------------------------------------------------------------

/** ¿Trae un código de equipo (letras, guiones y números, como srv-agro-01)? @param {string} n */
const traeCodigo = n => /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/.test(n) && /\d/.test(n);

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Palabras de sobra al buscar el objeto de una pregunta sobre claves. */
const SOBRA_CLAVE = ['contrasena', 'contrasenas', 'password', 'clave', 'claves', 'pass', 'secreto', 'credencial', 'usuario', 'usuarios', 'entro', 'entrar', 'entramos', 'accedo', 'acceder', 'accedemos', 'acceso', 'ingresar', 'web', 'ingreso'];

/**
 * Cómo se llama la pregunta en la intención `puesto` (número o nombre del puesto), si la pregunta nombra uno.
 * @param {string} n
 */
function puestoDe(n) {
  const m = n.match(/\bpuestos?\s+(?:de\s+trabajo\s+)?(?:n\s*)?([a-z0-9][a-z0-9\-_./]*)/);
  return m ? m[1].replace(/\.+$/, '') : '';
}

/**
 * @param {string} pregunta
 * @returns {Interpretacion|null}
 */
function interpretar(pregunta) {
  const n = limpiar(pregunta);
  if (!n) return null;
  const pal = n.split(' ');
  const codigo = traeCodigo(n);
  const puesto = puestoDe(n);
  const hayClave = /\b(contrasena|contrasenas|password|clave|claves|pass|secreto)\b/.test(n);
  const esWifi = /\b(wifi|wi-?fi|wi fi|wlan|ssid|inalambric\w*)\b/.test(n);

  // Ayuda y saludos
  if (/^(ayuda|ayudame|help|menu|que puedo preguntar|que podes hacer)$/.test(n) || /\bque (puedo|podria|se puede|podes|puedes|podemos) (preguntar|consultar|pedir|hacer)\b/.test(n)
    || /\bque (sabes|sabe|haces|podes|puedes)( hacer)?$/.test(n) || /\ben que (me )?(podes|puedes) ayudar\b/.test(n) || /\bayuda\b/.test(n) && pal.length <= 3
    || (pal.length <= 3 && /^(hola|holi|holis|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|ey|che)\b/.test(n))) {
    return { intencion: 'ayuda', objeto: '' };
  }

  // La clave del Wi-Fi: nunca se muestra, se enlaza a la credencial.
  if (esWifi && hayClave) return { intencion: 'wifi', objeto: palabrasDe(n, [...SOBRA_CLAVE, 'wifi', 'wi-fi', 'wi', 'fi', 'red', 'redes', 'wlan', 'ssid']).join(' '), campo: 'clave' };

  // Solicitudes de acceso a contraseñas
  if (/\b(solicitud(?:es)?|pedidos?|peticion(?:es)?)\b(?![.-]?\w)/.test(n) && !traeCodigo(n)) return { intencion: 'solicitudes', objeto: '' };

  // Contraseñas y claves: nunca se muestran.
  if (hayClave && !/\blicencias?\b.*\b(excedid|vencid)/.test(n)) {
    return { intencion: 'contrasena', objeto: palabrasDe(n, SOBRA_CLAVE).join(' ') };
  }
  // «Cómo entro a…», «acceso al…»: IP de gestión + enlace a la credencial
  if (/\b(entro|entrar|entramos|accedo|acceder|accedemos|acceso|ingresar|loguear)\b/.test(n) && !/\b(registro|permiso|sala|solicitud|pedido)\b/.test(n)
    && (codigo || /\b(ilo|idrac|router|firewall|switch|switches|servidor|servidores|access point|nas|nvr|dvr|impresora|consola|panel|web|modem|ups|camaras?|controladora)\b/.test(n))) {
    return { intencion: 'contrasena', objeto: palabrasDe(n, SOBRA_CLAVE).join(' '), filtro: 'acceso' };
  }

  // Licencias excedidas / vencidas
  if (/\blicencias?\b/.test(n) && /(excedid|sobrepas|de mas|pasad|vencid|nos pasamos|pasamos|sobran|sobrante)/.test(n)) {
    const exc = /(excedid|sobrepas|de mas|nos pasamos|pasamos|sobran|sobrante)/.test(n), ven = /vencid/.test(n);
    return { intencion: 'licencias', objeto: palabrasDe(n, ['licencia', 'licencias', 'excedidas', 'excedida', 'vencidas', 'vencida', 'pasamos', 'nos', 'sobran', 'sobrante', 'sobrantes', 'sobrepasadas', 'pasadas', 'con']).join(' '), filtro: exc && !ven ? 'excedidas' : ven && !exc ? 'vencidas' : 'ambas' };
  }

  // Un dato de un equipo: modelo, serie, MAC, sistema operativo, RAM, garantía…
  const campo = CAMPOS_EQUIPO.find(c => c.patron.test(n));
  if (campo && !/\b(licencias?|licencia)\b/.test(n)) {
    const obj = palabrasDe(n, PALABRAS_CAMPO).join(' ');
    if (obj) return { intencion: 'dato_equipo', objeto: obj, campo: campo.clave };
  }
  if (codigo && /\b(datos|ficha|detalles?|informacion|info|todo)\b/.test(n) && !/\b(vence|ip)\b/.test(n)) return { intencion: 'dato_equipo', objeto: palabrasDe(n, ['datos', 'ficha', 'detalle', 'detalles', 'del', 'de', 'todo']).join(' '), campo: '' };

  // Cámaras (QC74): IP, a qué switch y puerto está conectada, en qué NVR y canal, dónde está.
  if ((/\bcamaras?\b/.test(n) || /\bcanal(es)?\b/.test(n) && /\b(nvr|dvr)\b/.test(n)) && !/\b(vlans?|wifi|licencias?)\b/.test(n)) {
    const c = /\b(ip|ips|direccion)\b/.test(n) ? 'ip'
      : /\b(switch|switches|puertos?|bocas?|alimenta|alimentan|alimentada|poe|conectad[oa]s?|conecta|enchufad[oa]s?|patchera)\b/.test(n) ? 'switch'
        : /\b(donde|ubicad[oa]s?|queda|ubicacion)\b/.test(n) ? 'donde'
          : /\b(nvr|dvr|canal|canales|graba|grabadora|grabadoras)\b/.test(n) ? 'nvr' : '';
    return { intencion: 'camara', campo: c, objeto: palabrasDe(n, ['camara', 'camaras', 'ip', 'ips', 'direccion', 'switch', 'switches', 'puerto', 'puertos', 'boca', 'bocas', 'alimenta', 'alimentan', 'alimentada', 'poe', 'conectada', 'conectado', 'conecta', 'enchufada',
      'patchera', 'nvr', 'dvr', 'canal', 'canales', 'graba', 'grabadora', 'grabadoras', 'ubicada', 'ubicado', 'queda', 'ubicacion', 'hay', 'tenemos', 'tiene', 'cuantas', 'cuantos', 'lista', 'listame', 'todas', 'las', 'cual', 'cuales', 'que', 'enfoca', 'mira', 'esta']).join(' ') };
  }

  // Proveedores (QC75): soporte, número de cliente o de contrato, contacto comercial, portal. Los de Internet los responde `internet`.
  if (/\b(proveedor(es)?|(numero|nro|n) de (cliente|contrato)|contratos?|soporte|contacto comercial|comercial|portal de(l)? proveedor)\b/.test(n)
    && !/\b(internet|isp|isps|ips? publicas?|megas|mbps|ancho de banda|velocidad|enlaces?|tramos?|dominios?|hosting|dns|certificados?|correo|licencias?)\b/.test(n)) {
    const c = /\b(numero|nro|n) de cliente\b/.test(n) ? 'cliente' : /\b(numero|nro|n) de contrato\b|\bcontratos?\b/.test(n) ? 'contrato' : /\b(comercial|vendedor|ejecutivo)\b/.test(n) ? 'comercial'
      : /\bportal|pagina|sitio\b/.test(n) ? 'portal' : /\b(soporte|telefono|mail|horario|atencion)\b/.test(n) ? 'soporte' : '';
    return { intencion: 'proveedor', campo: c, objeto: palabrasDe(n, ['proveedor', 'proveedores', 'numero', 'nro', 'cliente', 'contrato', 'contratos', 'soporte', 'telefono', 'mail', 'horario', 'atencion', 'comercial', 'contacto', 'portal', 'pagina', 'sitio', 'vendedor', 'ejecutivo',
      'tenemos', 'tiene', 'tienen', 'cuales', 'cual', 'quien', 'son', 'hay', 'rubro', 'web', 'acceso', 'usuario']).join(' ') };
  }

  // Vencimientos
  if (/\b(vence|vencen|vencimiento|vencimientos|vencer|vencera|caduc\w*|se termina|terminan|se terminan|se acaba|se acaban|expira|expiran|expirar|renovar|renovamos|renovacion|renovaciones|por vencer|a vencer)\b/.test(n)) {
    return { intencion: 'vence', objeto: '', ventana: n };
  }
  // Sin verificar
  if (/(verific|revis|chequ|control(ar|ado|ada|amos|aron)\b|desactualiz)/.test(n) && /\b(no|sin|nunca|mas de|hace|antiguo|viejo|viejos|desactualizad\w*|pendiente\w*)\b/.test(n)) {
    return { intencion: 'sin_verificar', objeto: '', ventana: n };
  }

  // Licencias de un equipo, de una persona o de un producto
  if (/\b(licencias?|instalad[oa]s?|instalacion(es)?|software)\b/.test(n)) {
    const quedan = /\b(quedan|queda|disponibles?|libres?|sobran|restan)\b/.test(n);
    return { intencion: 'licencias_de', objeto: palabrasDe(n, ['licencia', 'licencias', 'usa', 'usan', 'instalado', 'instalada', 'instalados', 'instaladas', 'instalacion', 'instalaciones', 'quedan', 'queda', 'disponibles', 'disponible', 'libres', 'sobran', 'restan', 'software', 'estan', 'cuantas', 'programas', 'programa']).join(' '), campo: quedan ? 'quedan' : /instalad|donde/.test(n) ? 'instalado' : '' };
  }

  // Mapeos de unidades de red
  if (/\b(mapeos?|mapead\w+|unidades? de red|unidades? compartidas?|carpetas? compartidas?|recursos? compartidos?)\b/.test(n) || /\bunidad\s+[a-z]\b/.test(n)) {
    const l = n.match(/\bunidad\s+([a-z])\b/);
    return { intencion: 'mapeo', objeto: palabrasDe(n, ['mapeo', 'mapeos', 'unidad', 'unidades', 'red', 'apunta', 'tiene', 'carpeta', 'carpetas', 'compartida', 'compartidas', 'recursos', 'recurso', 'compartidos', 'mapeada', 'mapeadas', 'letra', 'a']).filter(w => !l || w !== l[1]).join(' '), letra: l ? l[1].toUpperCase() + ':' : undefined };
  }

  // Cuentas de dominio
  if (/\b(cuentas?|login|logins)\b/.test(n) && !/\bcuentas? (de correo|contables?|bancarias?)\b/.test(n) || /\busuarios? (de|del) (dominio|red|windows|active directory)\b/.test(n) || /\bdominio\\/.test(pregunta)) {
    return { intencion: 'cuenta_de', objeto: palabrasDe(n, ['cuenta', 'cuentas', 'usuario', 'usuarios', 'dominio', 'pertenece', 'login', 'logins', 'red', 'windows', 'nombre', 'active', 'directory', 'tiene', 'tienen', 'cual']).join(' '), campo: /\b(pertenece|de quien|a quien|quien)\b/.test(n) ? 'dueno' : '' };
  }

  // Personas, sectores y puestos
  if (/\bquien(es)?\b/.test(n) && puesto && /\b(esta|estan|se sienta|se sientan|ocupa|usa|trabaja|trabajan|hay|tiene)\b/.test(n)) {
    return { intencion: 'persona_info', objeto: '', puesto, campo: 'puesto' };
  }
  if (/\b(en que|de que|a que|que) (sector|area|departamento)\b/.test(n) || /\b(sector|area|departamento) (de|del)\b/.test(n) && /\b(persona|trabaja|quien)\b/.test(n)) {
    return { intencion: 'persona_info', objeto: palabrasDe(n, ['sector', 'area', 'departamento', 'trabaja', 'esta', 'pertenece']).join(' '), campo: 'persona' };
  }
  if (/\b(se sienta|se sientan|donde trabaja|en que puesto|que puesto (tiene|ocupa|usa))\b/.test(n)) {
    return { intencion: 'persona_info', objeto: palabrasDe(n, ['sienta', 'trabaja', 'puesto', 'tiene', 'ocupa', 'usa', 'se']).join(' '), campo: 'persona' };
  }
  if (/\b(quienes|que personas|cuantas personas|personas) (son |estan |trabajan |hay )?(de|del|en)\b/.test(n) || /\bquienes (son|estan|trabajan)\b/.test(n)) {
    return { intencion: 'persona_info', objeto: palabrasDe(n, ['quienes', 'personas', 'persona', 'son', 'estan', 'trabajan', 'sector', 'area', 'departamento', 'hay', 'cuantas']).join(' '), campo: 'sector' };
  }

  // VLAN
  if (/\bvlans?\b/.test(n)) {
    const num = n.match(/\bvlan\s*(?:n\s*)?(\d+)\b/);
    if (!num && (/\b(en|a) que vlan\b/.test(n) || /\bque vlan (usa|usan|tiene|tienen|le toca|corresponde|esta|estan)\b/.test(n) || puesto || codigo)) {
      return { intencion: 'vlan_de', objeto: puesto ? '' : palabrasDe(n, ['vlan', 'vlans', 'usa', 'usan', 'tiene', 'esta', 'estan', 'que', 'en', 'a']).join(' '), puesto: puesto || undefined };
    }
    const c = /\bgateway|puerta de enlace\b/.test(n) ? 'gateway' : /\bdhcp\b/.test(n) ? 'dhcp' : /\b(rango)\b/.test(n) ? 'rango' : /\b(red|subred|cidr|segmento|mascara)\b/.test(n) ? 'red' : '';
    return { intencion: 'vlan_info', objeto: palabrasDe(n, ['vlan', 'vlans', 'red', 'redes', 'subred', 'cidr', 'gateway', 'puerta', 'enlace', 'dhcp', 'rango', 'segmento', 'mascara', 'direccion', 'numero', 'nombre', 'cual', 'tiene', 'usa', 'hay']).filter(w => !/^\d+$/.test(w)).join(' '), numero: num ? +num[1] : undefined, campo: c };
  }

  // Redes Wi-Fi
  if (esWifi) {
    return { intencion: 'wifi', objeto: palabrasDe(n, ['wifi', 'wi-fi', 'wi', 'fi', 'red', 'redes', 'wlan', 'ssid', 'nombre', 'cual', 'hay', 'tenemos']).join(' '), campo: '' };
  }

  // Contenido de un rack
  if (/\bracks?\b/.test(n) && !/\b(en|a|de) que racks?\b/.test(n) && /\b(que hay|que tiene|que tienen|equipos|contenido|libres?|ocupad\w*|unidades|hay en|hay|cuantos|cuantas|tiene|lleva|alberga)\b/.test(n) && !/\bdonde\b/.test(n)) {
    return { intencion: 'rack_contenido', objeto: palabrasDe(n, ['rack', 'racks', 'hay', 'tiene', 'tienen', 'libres', 'libre', 'ocupadas', 'unidades', 'contenido', 'u', 'cuantas', 'lleva', 'alberga', 'estan', 'montados']).join(' ') };
  }

  // Configuraciones y documentación
  const refConfig = /\b(vpn|vpns|reglas? del? ?(firewall|fw)|reglas de firewall|politicas? (del?|entre)|reenvi\w*|redirigid\w*|redireccion\w*|port forwarding|nat|configurad[oa]s?|configuracion(es)?|controlador(es)? de(l)? dominio)\b/.test(n);
  const refDoc = /\bdocumentacion\b/.test(n) && palabrasDe(n, ['documentacion', 'hay', 'pdf', 'imprimir', 'generar', 'ver', 'donde', 'como', 'organizacion']).length > 0 && !/\b(pdf|imprimir|organizacion)\b/.test(n);
  if (refConfig || refDoc) {
    const tipo = /\bvpn/.test(n) ? 'vpn' : /(regla|politica)/.test(n) ? 'reglas' : /(reenvi|redirig|redireccion|port forwarding|\bnat\b)/.test(n) ? 'nat' : esWifi ? 'wifi' : '';
    return { intencion: 'config_doc', objeto: palabrasDe(n, ['como', 'esta', 'configurada', 'configurado', 'configuracion', 'configuraciones', 'documentacion', 'regla', 'reglas', 'politica', 'politicas', 'hay', 'cuales', 'son', 'puertos', 'estan', 'redirigidos', 'redirigido', 'reenvio', 'reenvios', 'vpn', 'vpns', 'nat', 'del', 'firewall']).join(' '), tipo };
  }

  // Dominios, hosting, DNS y certificados
  if (/\b(dominios?|dns|mx|hosting|hostings|registrad[oa]s?|registrador|certificados?|ssl|tls|correo|mail|nameservers?|spf|cname|txt)\b/.test(n)) {
    const reg = n.match(/\b(mx|txt|cname|aaaa|spf|nameservers?)\b/);
    const regA = /\bregistros? a\b/.test(n);
    const tipo = /\bhosting/.test(n) ? 'hosting' : /\b(certificado|ssl|tls)/.test(n) ? 'certificado' : /\b(correo|mail|mx)\b/.test(n) ? 'correo' : /\bdns|nameserver|cname|txt|spf/.test(n) ? 'dns' : /\bdominio/.test(n) ? 'dominio' : '';
    const campoReg = reg ? (reg[1] === 'nameserver' || reg[1] === 'nameservers' ? 'NS' : reg[1].toUpperCase()) : regA ? 'A' : /\bregistros?\b/.test(n) ? 'registros' : '';
    return { intencion: 'servicio', objeto: palabrasDe(n, ['dominio', 'dominios', 'dns', 'mx', 'registrado', 'registrada', 'registrador', 'proveedor', 'hosting', 'hostings', 'titular', 'certificado', 'certificados', 'correo', 'mail', 'registros', 'registro', 'cuales', 'quien', 'ssl', 'tls', 'tiene', 'nameserver', 'nameservers', 'spf', 'cname', 'txt', 'plan', 'vence', 'del', 'a']).join(' '), tipo, campo: campoReg };
  }

  // Internet: proveedor, IP pública, número de cliente
  if (/\b(isp|isps|proveedor(es)? de (internet|servicio|la fibra|conexion)|internet|ips? publicas?|(numero|nro|n) de cliente|soporte del (isp|proveedor)|telefono de soporte|conexion a internet|enlaces? (de|a) (internet|isp)|velocidad de (bajada|subida|internet)|megas|mbps|ancho de banda)\b/.test(n)) {
    const c = /(ip publica|ips publicas)/.test(n) ? 'ip_publica' : /(de cliente)/.test(n) ? 'cliente' : /(soporte|telefono)/.test(n) ? 'soporte' : /(velocidad|megas|mbps|ancho)/.test(n) ? 'velocidad' : /proveedor/.test(n) ? 'proveedor' : '';
    return { intencion: 'internet', objeto: palabrasDe(n, ['isp', 'isps', 'proveedor', 'proveedores', 'internet', 'ip', 'publica', 'publicas', 'numero', 'nro', 'cliente', 'soporte', 'telefono', 'conexion', 'enlace', 'enlaces', 'velocidad', 'bajada', 'subida', 'megas', 'mbps', 'ancho', 'banda', 'tenemos', 'cual', 'del', 'de', 'servicio', 'la', 'fibra']).join(' '), campo: c };
  }

  // Fibra óptica
  if (/\b(fibra|fibras|tramos?|pelos?|empalmes?|atenuacion)\b/.test(n)) {
    return { intencion: 'fibra', objeto: palabrasDe(n, ['fibra', 'fibras', 'tramo', 'tramos', 'pelo', 'pelos', 'empalme', 'empalmes', 'atenuacion', 'hay', 'va', 'por', 'entre', 'ultima', 'ultimas', 'medicion', 'mediciones', 'fue', 'cuales', 'optica', 'conecta']).join(' '), campo: /\bmedicion\w*|atenuacion\b/.test(n) ? 'medicion' : '' };
  }

  // Conexión de un puesto
  if (puesto && /(conectad|conecta|puerto|boca|patch|switch|va\b|llega|enchufad|donde|cable)/.test(n)) return { intencion: 'conexion', objeto: '', puesto };

  // Dónde está algo («edificio» se sigue entendiendo como forma coloquial de decir sede; las respuestas hablan de sede y sala)
  if (/\b(en|a|de) que (rack|sala|sede|edificio|ubicacion|lugar|gabinete)\b/.test(n) || /\bdonde (esta|estan|queda|quedan|se encuentra|se encuentran|lo encuentro|la encuentro|ubico|tenemos|anda|andan)\b/.test(n) || /\b(ubicacion|ubicado|ubicada) (de|del)?\b/.test(n)) {
    // «¿Dónde está el rack principal?»: lo que se busca es el rack mismo.
    const esRack = /\bdonde\b/.test(n) && /\bracks?\b/.test(n) && !/\b(en|a|de) que racks?\b/.test(n);
    return { intencion: 'ubicacion', objeto: palabrasDe(n, ['rack', 'racks', 'sala', 'sede', 'edificio', 'ubicacion', 'ubicado', 'ubicada', 'lugar', 'queda', 'quedan', 'encuentra', 'encuentran', 'lo', 'la', 'encuentro', 'ubico', 'tenemos', 'anda', 'andan', 'gabinete', 'donde']).join(' '), campo: esRack ? 'rack' : undefined };
  }

  // Asignaciones: quién tiene un equipo
  if (/\ba quien\b/.test(n) && /(asignad|pertenece|es de|tiene|corresponde|usa)/.test(n) || /\bquien (usa|utiliza|tiene|maneja|ocupa|tiene asignad[oa])\b/.test(n) || /\bde quien (es|son)\b/.test(n)) {
    const sacar = ['asignado', 'asignada', 'pertenece', 'quien', 'usa', 'utiliza', 'maneja', 'ocupa', 'corresponde', 'es', 'son', 'a', 'asignados'];
    if (codigo) sacar.push('notebook', 'notebooks', 'laptop', 'laptops', 'compu', 'computadora', 'maquina');
    return { intencion: 'asignado_a', objeto: palabrasDe(n, sacar).join(' ') };
  }

  // Equipos sin asignar o en depósito
  if (/\b(sin asignar|no asignad\w*|sin asignacion|sin dueno|sin usuario|sin persona|libres?|disponibles?|deposito|sin usar|sin uso|desasignad\w*|sobrantes?|stock)\b/.test(n) && !/\b(puertos?|bocas?|ips?|unidades|u)\b/.test(n)) {
    return { intencion: 'sin_asignar', objeto: '', tipo: tipoEquipoDe(n) || undefined, filtro: /\bdeposito\b/.test(n) ? 'deposito' : undefined };
  }

  // Equipos de una persona
  if (/\bequipos?\b.*\b(tiene|tienen|asignad\w*|de)\b/.test(n) && /\b(que|cuales|cuantos)\b/.test(n) || /\bque (pc|pcs|equipos?|compus?|computadoras?|maquinas?|notebooks?|laptops?|dispositivos)\b.*\b(tiene|tienen|usa|usan|utiliza|utilizan|asignad\w*|maneja)\b/.test(n)) {
    return { intencion: 'equipos_de', objeto: palabrasDe(n, ['asignados', 'asignado', 'asignadas', 'notebook', 'notebooks', 'laptop', 'laptops', 'compu', 'compus', 'computadora', 'computadoras', 'maquina', 'maquinas', 'dispositivos', 'usa', 'usan', 'utiliza', 'utilizan', 'maneja', 'cuales', 'cuantos', 'pcs']).join(' ') };
  }

  // Conexión: puerto, boca, conectado, cable
  if (/(conectad|\bconecta\b|\bconectan\b|conectarse|\bpuertos?\b|\bbocas?\b|patchera|\bcables?\b|a que switch|con que switch|que switch|donde va|\bconexion(es)?\b)/.test(n)) {
    return { intencion: 'conexion', objeto: palabrasDe(n, ['conectado', 'conectada', 'conectados', 'conecta', 'conectan', 'puerto', 'puertos', 'va', 'boca', 'bocas', 'patchera', 'donde', 'enchufado', 'enchufada', 'switch', 'cable', 'cables', 'conexion', 'conexiones', 'se', 'llega']).join(' ') };
  }
  // IP
  if (/\bip\b|\bips\b|direccion/.test(n)) {
    const ilo = /\b(ilo|idrac)\b/.test(n);
    return { intencion: 'ip', objeto: palabrasDe(n, ['ilo', 'idrac', 'gestion', 'publica', 'privada', 'asignada']).join(' '), ilo };
  }

  // Listas por tipo de equipo
  const tipoLista = tipoEquipoDe(n);
  if (tipoLista && /\b(cuant\w*|lista\w*|listame|mostra\w*|mostrame|dame|que|cuales|hay|tenemos|existen|todos|todas|ver)\b/.test(n)) {
    const t = TIPOS_EQUIPO.find(x => x.clave === tipoLista);
    const sacar = ['cuantos', 'cuantas', 'lista', 'listame', 'listar', 'mostra', 'mostrame', 'dame', 'cuales', 'hay', 'tenemos', 'existen', 'todos', 'todas', 'ver', 'los', 'las'];
    const objeto = palabrasDe(n, sacar).filter(w => !(t && t.patron.test(w)) && !/^(servidor|servidores|switch|switches|router|routers|firewall|firewalls|impresora|impresoras|notebook|notebooks|pc|pcs|patcheras?|ups|nas|relojes?|computadoras?|compus?)$/.test(w)).join(' ');
    return { intencion: 'listar_tipo', objeto, tipo: tipoLista };
  }

  // Cómo llegar a una pantalla
  const tema = temaNavegacion(n);
  const alta = /\b(cargo|cargar|cargamos|crear|creo|creamos|agregar|agrego|agregamos|dar de alta|alta|nuevo|nueva|nuevos|nuevas|anoto|anotar|registro un|registrar)\b/.test(n);
  if (alta && /\b(como|donde|quiero|necesito|puedo|hago)\b/.test(n)) {
    const lista = pantallasDeAlta(n);
    if (lista.length) return { intencion: 'navegar', objeto: '', tema: lista.join(','), filtro: 'alta' };
  }
  if (tema && /\b(como|donde|quiero|necesito|abrir|abro|abri|llevame|ir a|pantalla|seccion|veo|vemos|ver|exporto|importo|imprimo|genero|descargo|hago|puedo)\b/.test(n) && !codigo) {
    return { intencion: 'navegar', objeto: '', tema };
  }
  if (tema && ['topologia', 'plano', 'etiquetas', 'datos', 'accesos', 'informe', 'recorrido', 'ajustes'].includes(tema) && pal.length <= 4) return { intencion: 'navegar', objeto: '', tema };
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
    const hall = await hallarPuestos(ctx, q.puesto);
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
  const nombreMes = n.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (nombreMes) {
    const i = MESES.indexOf(nombreMes[1] === 'setiembre' ? 'septiembre' : nombreMes[1]);
    const anio = i < m - 1 ? a + 1 : a;
    return { hasta: iso(new Date(anio, i + 1, 0)), texto: 'hasta fin de ' + MESES[i] + (anio !== a ? ' de ' + anio : '') };
  }
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
  for (const col of ['credenciales', 'licencias', 'servicios']) {
    for (const r of await ctx.listar(col)) {
      const k = Object.keys(r).find(x => /_vence_en$/.test(x));
      if (!k || !r[k] || !ctx.veo(moduloDe(col, r), r.organizacion_id)) continue;
      const f = String(r[k]).slice(0, 10);
      if (f > hasta) continue;
      const tipo = col === 'credenciales' ? 'Credencial' : col === 'licencias' ? 'Licencia' : 'Servicio';
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
  const palabrasProducto = q.objeto.split(' ').filter(hay);
  const lics = (await ctx.listar('licencias')).filter(l => ctx.veo('licencias', l.organizacion_id) && palabrasProducto.every(w => normalizar(l.licencia_producto).includes(w)));
  if (palabrasProducto.length && !lics.length) return { grupos: [{ texto: 'No encontré una licencia de «' + palabrasProducto.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'licencias', 'Ver las licencias') };
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
  const avisoClaves = 'Por seguridad no muestro contraseñas ni claves acá. Abrí la ficha de la credencial: ';
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return { grupos: [{ texto: avisoClaves + 'decime de qué equipo o servicio la necesitás (por ejemplo, «¿cuál es la contraseña de la iLO del servidor?»).' }] };
  const res = (await buscarFlexible(ctx, palabras)).filter(r => r.coleccion === 'credenciales');
  // «Cómo entro a…»: además de la credencial, la IP de gestión del equipo.
  /** @type {Item[]} */
  const accesos = [];
  if (q.filtro === 'acceso') {
    // «ilo» e «idrac» son del tipo de credencial, no del nombre del equipo (y «ilo» está dentro de «silos»).
    const palabrasEquipo = palabras.filter(w => !['ilo', 'idrac'].includes(w));
    for (const e of palabrasEquipo.length ? (await hallarEquipos(ctx, palabrasEquipo)).slice(0, 4) : []) {
      const c = e.equipo_campos || {};
      const ips = unir(e.equipo_ip_gestion ? 'IP de gestión ' + e.equipo_ip_gestion : '', c.servidor_ip_ilo_idrac ? 'iLO/iDRAC ' + c.servidor_ip_ilo_idrac : '', c.router_ip_lan ? 'IP LAN ' + c.router_ip_lan : '', c.firewall_ip_lan ? 'IP LAN ' + c.firewall_ip_lan : '');
      accesos.push(item(e.equipo_nombre, ruta('equipos', e), ips || 'No tiene una IP de gestión cargada.', e.organizacion_id));
    }
  }
  if (q.filtro === 'acceso' && !ctx.veo('credenciales', ctx.org) && !accesos.length) return sinPermiso('las credenciales');
  if (!res.length && !accesos.length) return { grupos: [{ texto: 'No encontré una credencial para «' + palabras.join(' ') + '» en lo que podés ver. No muestro contraseñas acá: se ven solo desde su ficha.' }] };
  /** @type {Item[]} */
  const items = [];
  for (const r of res.slice(0, TOPE)) {
    const c = await repositorio.obtener('credenciales', r.id);
    const puedeVer = !!c && puedeVerSecreto(ctx.u, c);
    const detalle = puedeVer ? 'En la ficha tenés «Mostrar» y «Copiar».' : puedePedirSecreto(ctx.u) ? 'En la ficha podés usar «Pedir acceso».' : 'Solo la ve quien tenga acceso.';
    items.push(item(r.titulo, ruta('credenciales', r), (r.subtitulo ? r.subtitulo + ' · ' : '') + detalle, r.organizacion_id));
  }
  /** @type {Grupo[]} */
  const grupos = [];
  if (accesos.length) grupos.push(grupo('Para entrar, estas son las direcciones del equipo:', accesos));
  if (items.length) grupos.push(grupo(avisoClaves + (res.length === 1 ? 'esta es la ficha.' : 'estas son las fichas que coinciden:'), items, TOPE));
  else grupos.push({ texto: ctx.veo('credenciales', ctx.org) ? 'No encontré una credencial cargada para ese equipo. No muestro contraseñas acá: se ven solo desde su ficha.' : 'No tenés permiso para ver las credenciales, así que no puedo llevarte a la ficha de su contraseña.' });
  return { grupos };
}

// ---------------------------------------------------------------------------------------------
// Ayudas para los respondedores nuevos
// ---------------------------------------------------------------------------------------------

/** @param {...any} p */
const unir = (...p) => p.filter(x => x !== null && x !== undefined && x !== '').join(' · ');

/** @param {string} que @returns {Respuesta} */
const sinPermiso = que => ({ grupos: [{ texto: 'No tenés permiso para ver ' + que + '.' }] });

/** @param {string} texto @returns {Respuesta} */
const aviso = texto => ({ grupos: [{ texto }] });

/** ¿Puede el usuario abrir esta pantalla? Misma regla que el menú. @param {Ctx} ctx @param {typeof DESTINOS[number]} d */
function puedeAbrir(ctx, d) {
  if (d.accion) return puede(ctx.u, d.accion, null, ctx.org);
  if (d.modulo) return puede(ctx.u, 'ver', d.modulo, ctx.org);
  return true;
}

/** Atajo a una pantalla: solo si el usuario puede verla y, si hace falta, hay una organización elegida. @param {Ctx} ctx @param {string} id @param {string} texto @returns {Parte|undefined} */
function atajo(ctx, id, texto) {
  const d = DESTINOS.find(x => x.id === id);
  if (!d || !puedeAbrir(ctx, d) || (d.org && !ctx.org)) return undefined;
  return { t: texto, href: d.ruta };
}

/** Enlace a una ficha solo si el usuario puede ver ese módulo; si no, texto plano. @param {Ctx} ctx @param {any} modulo @param {string|null|undefined} orgId @param {string} t @param {string} href @returns {Parte} */
const parteSi = (ctx, modulo, orgId, t, href) => (ctx.veo(modulo, orgId) ? { t, href } : { t });

/**
 * Equipos que coinciden con las palabras: primero por nombre o código (todas las palabras), y si no hay, por la búsqueda global
 * (que también mira marca, tipo, puesto, etc.). Siempre con los permisos del usuario.
 * @param {Ctx} ctx @param {string[]} palabras @returns {Promise<any[]>}
 */
async function hallarEquipos(ctx, palabras) {
  const todos = await ctx.listar('equipos');
  const visibles = todos.filter(e => ctx.veo(moduloDe('equipos', e), e.organizacion_id));
  const texto = (/** @type {any} */ e) => normalizar(e.equipo_nombre + ' ' + (e.equipo_codigo || '') + ' ' + ((e.equipo_campos && e.equipo_campos.otro_categoria) || ''));
  // Primero las palabras al comienzo de una palabra del nombre, código o categoría («nas» → NAS-AGRO-01, no «Oficinas»).
  const alInicio = visibles.filter(e => { const pals = texto(e).split(/[^a-z0-9]+/); return palabras.every(w => pals.some(x => x.startsWith(w)) || texto(e).includes(w) && w.includes('-')); });
  if (alInicio.length) return alInicio.slice(0, 20);
  const directos = visibles.filter(e => palabras.every(w => texto(e).includes(w)));
  if (directos.length) return directos.slice(0, 20);
  const res = (await buscarFlexible(ctx, palabras)).filter(r => r.coleccion === 'equipos');
  const porId = new Map(todos.map(e => [e.id, e]));
  return res.map(r => porId.get(r.id)).filter(Boolean);
}

/**
 * Personas que coinciden con las palabras: primero por nombre (todas las palabras) y, si no hay, por la búsqueda global.
 * Cada una trae `titulo` (el nombre). @param {Ctx} ctx @param {string[]} palabras @returns {Promise<any[]>}
 */
async function hallarPersonas(ctx, palabras) {
  const todas = (await ctx.listar('personas')).filter(p => ctx.veo('personas', p.organizacion_id));
  const directas = todas.filter(p => palabras.every(w => normalizar(p.persona_nombre).includes(w)));
  if (directas.length) return directas.map(p => ({ ...p, titulo: p.persona_nombre }));
  const res = (await buscarFlexible(ctx, palabras)).filter(r => r.coleccion === 'personas');
  const porId = new Map(todas.map(p => [p.id, p]));
  return res.map(r => porId.get(r.id)).filter(Boolean).map(p => ({ ...p, titulo: p.persona_nombre }));
}

/** Sede y sala, de la sede a la sala («Planta Norte › Sala de servidores»); para una sede, solo su nombre (QC60). @param {Map<string, any>} ubics @param {string|null|undefined} id */
function cadenaUbicacion(ubics, id) {
  /** @type {string[]} */
  const partes = [];
  let actual = id, vuelta = 0;
  while (actual && vuelta++ < 5) { const u = ubics.get(actual); if (!u) break; partes.unshift(u.ubicacion_nombre); actual = u.ubicacion_padre_id; }
  return partes.join(' › ');
}

/** «U15–16» o «U15». @param {{rack_u_inicio: number|null, rack_u_alto: number|null}} e */
function rangoU(e) {
  const i = e.rack_u_inicio || 0, a = e.rack_u_alto || 1;
  return a > 1 ? 'U' + i + '–' + (i + a - 1) : 'U' + i;
}

/** Texto de una lista de unidades libres: «U1–U3, U10». @param {number[]} libres */
function rangosLibres(libres) {
  /** @type {string[]} */
  const partes = [];
  for (let i = 0; i < libres.length; i++) {
    let j = i;
    while (j + 1 < libres.length && libres[j + 1] === libres[j] + 1) j++;
    partes.push(j > i ? 'U' + libres[i] + '–U' + libres[j] : 'U' + libres[i]);
    i = j;
  }
  return partes.length > 6 ? partes.slice(0, 6).join(', ') + '…' : partes.join(', ');
}

/** @param {string|null|undefined} s */
function ipANum(s) {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(String(s || ''));
  if (!m || [m[1], m[2], m[3], m[4]].some(x => +x > 255)) return null;
  return ((+m[1] * 256 + +m[2]) * 256 + +m[3]) * 256 + +m[4];
}

/** ¿La IP está dentro de la red CIDR? @param {string|null|undefined} ip @param {string|null|undefined} cidr */
function ipEnCidr(ip, cidr) {
  const m = /^\s*([\d.]+)\/(\d{1,2})\s*$/.exec(String(cidr || ''));
  const n = ipANum(ip), b = m ? ipANum(m[1]) : null;
  if (n == null || b == null || !m || +m[2] > 32) return false;
  const tam = Math.pow(2, 32 - +m[2]);
  const base = Math.floor(b / tam) * tam;
  return n >= base && n < base + tam;
}

/** Busca puestos por número o nombre entre los que el usuario ve. @param {Ctx} ctx @param {string} token @returns {Promise<any[]>} */
async function hallarPuestos(ctx, token) {
  const t = normalizar(token);
  const num = /^\d+$/.test(t);
  const puestos = (await ctx.listar('puestos')).filter(p => ctx.veo('red', p.organizacion_id));
  const hall = puestos.filter(p => {
    const nom = normalizar(p.puesto_nombre);
    if (nom === t) return true;
    if (num) return nom.split(/[^a-z0-9]+/).some(x => /^\d+$/.test(x) && +x === +t);
    return nom.includes(t) || normalizar(p.puesto_boca_pared || '') === t;
  });
  hall.sort((a, b) => Number(normalizar(b.puesto_nombre) === t) - Number(normalizar(a.puesto_nombre) === t) || a.puesto_nombre.localeCompare(b.puesto_nombre, 'es', { numeric: true }));
  return hall;
}

/** ¿El equipo es de esta clave de TIPOS_EQUIPO? @param {any} e @param {string} clave */
function esDeTipo(e, clave) {
  const t = TIPOS_EQUIPO.find(x => x.clave === clave);
  if (!t) return false;
  if (t.tipo) return e.equipo_tipo === t.tipo;
  const cat = normalizar(String((e.equipo_campos || {}).otro_categoria || '').trim());
  return e.equipo_tipo === 'otro' && !!t.categorias && t.categorias.includes(cat);
}

/** Línea con marca y modelo. @param {any} e */
const marcaModelo = e => unir(e.equipo_marca, e.equipo_modelo);

// ---------------------------------------------------------------------------------------------
// Respuestas nuevas
// ---------------------------------------------------------------------------------------------

/**
 * Racks que nombra la pregunta (por nombre o ubicación). «El rack principal» sin un rack con ese nombre: el que más equipos
 * tiene de cada organización. @param {Ctx} _ctx @param {any[]} racks @param {any[]} equipos @param {Map<string, any>} ub @param {string[]} palabras
 * @returns {{elegidos: any[], intro: string}}
 */
function elegirRacks(_ctx, racks, equipos, ub, palabras) {
  const usados = (/** @type {any} */ r) => equipos.filter(e => e.rack_id === r.id && e.equipo_estado !== 'baja').length;
  const elegidos = racks.filter(r => { const t = normalizar(r.rack_nombre + ' ' + cadenaUbicacion(ub, r.ubicacion_id)); return palabras.every(p => t.includes(p)); });
  if (elegidos.length || !palabras.every(p => ['principal', 'central', 'ppal'].includes(p))) return { elegidos, intro: '' };
  const porOrg = new Map();
  for (const r of racks) { const a = porOrg.get(r.organizacion_id); if (!a || usados(r) > usados(a)) porOrg.set(r.organizacion_id, r); }
  return { elegidos: Array.from(porOrg.values()), intro: 'No hay un rack llamado «principal»; te muestro el que más equipos tiene. ' };
}

/** Ejemplos del catálogo adaptados a lo que el usuario puede ver, agrupados por tema (botones). @param {Ctx} ctx @returns {Promise<Grupo[]>} */
async function gruposDeAyuda(ctx) {
  const sust = await sustitucionesDeEjemplo(ctx);
  /** @type {Record<string, any>} */
  const modulo = { ip: 'red', conexion: 'red', ubicacion: 'red', vlan_info: 'red', vlan_de: 'red', wifi: 'red', internet: 'red', dato_equipo: 'red', listar_tipo: 'red', sin_asignar: 'red', fibra: 'red', rack_contenido: 'racks', contrasena: 'credenciales',
    equipos_de: 'personas', asignado_a: 'personas', cuenta_de: 'personas', persona_info: 'personas', licencias: 'licencias', licencias_de: 'licencias', mapeo: 'configuraciones', servicio: 'configuraciones', config_doc: 'configuraciones', camara: 'red', proveedor: 'configuraciones' };
  /** @type {Grupo[]} */
  const grupos = [];
  for (const intencion of INTENCIONES) {
    if (intencion === 'ayuda') continue;
    if (modulo[intencion] && !ctx.veo(modulo[intencion], ctx.org)) continue;
    const c = CATALOGO[intencion];
    /** @type {string[]} */
    const sug = [];
    for (const e of c.ejemplos) {
      let t = sinLlaves(e), ok = true;
      for (const [demo, propio] of sust) {
        if (!t.includes(demo)) continue;
        if (propio) t = t.split(demo).join(propio); else ok = false;
      }
      if (ok && !sug.includes(t)) sug.push(t);
    }
    if (sug.length) grupos.push({ texto: c.titulo, sugerencias: sug.slice(0, 3), encabezado: true });
  }
  return grupos;
}

/** Cambia los nombres de los datos de ejemplo por otros que el usuario puede ver ('' = no hay equivalente: se descarta el ejemplo). @param {Ctx} ctx @returns {Promise<Array<[string, string]>>} */
async function sustitucionesDeEjemplo(ctx) {
  const [equipos, puestos, personas, racks] = await Promise.all([ctx.listar('equipos'), ctx.listar('puestos'), ctx.listar('personas'), ctx.listar('racks')]);
  const hay1 = (/** @type {string} */ nombre) => equipos.some(e => e.equipo_nombre === nombre && ctx.veo(moduloDe('equipos', e), e.organizacion_id));
  const srv = equipos.find(e => e.equipo_tipo === 'servidor' && ctx.veo('servidores', e.organizacion_id));
  const sw = equipos.find(e => e.equipo_tipo === 'switch' && ctx.veo('red', e.organizacion_id));
  const pc = equipos.find(e => esDeTipo(e, 'pc') && ctx.veo('red', e.organizacion_id));
  const nb = equipos.find(e => esDeTipo(e, 'notebook') && ctx.veo('red', e.organizacion_id));
  const pu = puestos.find(p => ctx.veo('red', p.organizacion_id));
  const pe = personas.find(p => ctx.veo('personas', p.organizacion_id));
  const rk = racks.find(r => ctx.veo('racks', r.organizacion_id));
  /** @type {Array<[string, string]>} */
  const s = [];
  // De lo más largo a lo más corto, para no pisar «SRV-AGRO-01» dentro de «iDRAC SRV-AGRO-01».
  s.push(['iDRAC SRV-AGRO-01', srv ? 'iDRAC ' + srv.equipo_nombre : '']);
  s.push(['SRV-AGRO-01', hay1('SRV-AGRO-01') ? 'SRV-AGRO-01' : srv ? srv.equipo_nombre : '']);
  s.push(['SW-CORE-01', hay1('SW-CORE-01') ? 'SW-CORE-01' : sw ? sw.equipo_nombre : '']);
  s.push(['PC-AGRO-001', hay1('PC-AGRO-001') ? 'PC-AGRO-001' : pc ? pc.equipo_nombre : '']);
  s.push(['NB-AGRO-01', hay1('NB-AGRO-01') ? 'NB-AGRO-01' : nb ? nb.equipo_nombre : '']);
  s.push(['ADM-01', puestos.some(p => p.puesto_nombre === 'ADM-01' && ctx.veo('red', p.organizacion_id)) ? 'ADM-01' : pu ? pu.puesto_nombre : '']);
  s.push(['Fabián Farías', personas.some(p => p.persona_nombre === 'Fabián Farías' && ctx.veo('personas', p.organizacion_id)) ? 'Fabián Farías' : pe ? pe.persona_nombre : '']);
  s.push(['RACK-SRV-01', racks.some(r => r.rack_nombre === 'RACK-SRV-01' && ctx.veo('racks', r.organizacion_id)) ? 'RACK-SRV-01' : rk ? rk.rack_nombre : '']);
  return s;
}

/** @param {Ctx} ctx @param {Interpretacion} _q @returns {Promise<Respuesta>} */
async function responderAyuda(ctx, _q) {
  const grupos = await gruposDeAyuda(ctx);
  return { grupos: [{ texto: 'Hola. Te respondo con los datos de Infradoc que podés ver' + (ctx.org ? ' en ' + (ctx.orgs.get(ctx.org) || 'esta organización') : '') + '. Tocá una pregunta o escribí la tuya con tus palabras.' }, ...grupos],
    nota: 'Nunca muestro contraseñas ni claves: para eso te llevo a la ficha de la credencial.' };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderUbicacion(ctx, q) {
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return aviso('¿De qué equipo, rack o puesto querés saber dónde está? Por ejemplo: «¿Dónde está SRV-AGRO-01?».');
  if (q.campo === 'rack') {
    if (!ctx.veo('racks', ctx.org)) return sinPermiso('los racks');
    const [racks, equipos, ubics] = await Promise.all([ctx.listar('racks'), ctx.listar('equipos'), ctx.listar('ubicaciones')]);
    const ub = new Map(ubics.map(u => [u.id, u]));
    const { elegidos, intro } = elegirRacks(ctx, racks.filter(r => ctx.veo('racks', r.organizacion_id)), equipos, ub, palabras);
    if (elegidos.length) return { grupos: [grupo(intro + (elegidos.length === 1 ? 'El rack está en:' : 'Estos racks coinciden:'), elegidos.map(k => ({ partes: [{ t: k.rack_nombre, href: ruta('racks', k) }], detalle: unir(cadenaUbicacion(ub, k.ubicacion_id) || 'sin ubicación cargada', k.rack_unidades_total + ' U'), orgId: k.organizacion_id })))], enlace: atajo(ctx, 'racks', 'Ver los racks') };
    return { grupos: [{ texto: 'No encontré un rack «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'racks', 'Ver los racks') };
  }
  const res = (await buscarFlexible(ctx, palabras)).filter(r => ['equipos', 'racks', 'puestos', 'ubicaciones'].includes(r.coleccion));
  if (!res.length) return { grupos: [{ texto: 'No encontré un equipo, rack, puesto, sede o sala para «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'racks', 'Ver los racks') };
  const [equipos, racks, puestos, ubics] = await Promise.all([ctx.listar('equipos'), ctx.listar('racks'), ctx.listar('puestos'), ctx.listar('ubicaciones')]);
  const ub = new Map(ubics.map(u => [u.id, u]));
  /** @type {Item[]} */
  const items = [];
  for (const r of res.slice(0, TOPE)) {
    if (r.coleccion === 'equipos') {
      const e = equipos.find(x => x.id === r.id);
      if (!e) continue;
      const rack = e.rack_id ? racks.find(x => x.id === e.rack_id) : null;
      const pu = e.puesto_id ? puestos.find(x => x.id === e.puesto_id) : null;
      /** @type {Parte[]} */
      const partes = [{ t: e.equipo_nombre, href: ruta('equipos', e) }];
      const lugar = cadenaUbicacion(ub, (rack && rack.ubicacion_id) || e.ubicacion_id || (pu && pu.ubicacion_id));
      // «Sede › Sala › Rack › Posición (U)»: el tramo del rack es un enlace al rack.
      if (rack) partes.push(parteSi(ctx, 'racks', rack.organizacion_id, [lugar, rack.rack_nombre, rangoU(e)].filter(Boolean).join(' › '), ruta('racks', rack)));
      if (pu) partes.push(parteSi(ctx, 'red', pu.organizacion_id, 'puesto ' + pu.puesto_nombre, ruta('puestos', pu)));
      items.push({ partes, detalle: rack ? undefined : lugar || (pu ? undefined : 'No tiene una sede o sala cargada.'), orgId: e.organizacion_id });
    } else if (r.coleccion === 'racks') {
      const k = racks.find(x => x.id === r.id);
      if (k) items.push({ partes: [{ t: k.rack_nombre, href: ruta('racks', k) }], detalle: unir(cadenaUbicacion(ub, k.ubicacion_id), k.rack_unidades_total + ' U'), orgId: k.organizacion_id });
    } else if (r.coleccion === 'ubicaciones') {
      const u = ub.get(r.id);
      if (u) items.push({ partes: [{ t: (u.ubicacion_tipo === 'sede' ? 'Sede ' : 'Sala ') + u.ubicacion_nombre, href: ruta('ubicaciones', u) }], detalle: u.ubicacion_tipo === 'sala' ? cadenaUbicacion(ub, u.id) : 'Es una sede de la organización.', orgId: u.organizacion_id });
    } else {
      const p = puestos.find(x => x.id === r.id);
      if (p) items.push({ partes: [{ t: 'Puesto ' + p.puesto_nombre, href: ruta('puestos', p) }], detalle: cadenaUbicacion(ub, p.ubicacion_id) || 'No tiene una sede o sala cargada.', orgId: p.organizacion_id });
    }
  }
  if (!items.length) return aviso('No encontré la ubicación de «' + palabras.join(' ') + '».');
  return { grupos: [grupo(items.length === 1 ? 'Esto encontré:' : 'Encontré ' + res.length + ' coincidencias:', items)], enlace: atajo(ctx, 'racks', 'Ver los racks') };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderRackContenido(ctx, q) {
  if (!ctx.veo('racks', ctx.org)) return sinPermiso('los racks');
  const [racksTodos, equipos, ubics] = await Promise.all([ctx.listar('racks'), ctx.listar('equipos'), ctx.listar('ubicaciones')]);
  const ub = new Map(ubics.map(u => [u.id, u]));
  const racks = racksTodos.filter(r => ctx.veo('racks', r.organizacion_id));
  if (!racks.length) return aviso('No hay racks cargados en lo que podés ver.');
  const palabras = q.objeto.split(' ').filter(hay);
  const usados = (/** @type {any} */ r) => equipos.filter(e => e.rack_id === r.id && e.equipo_estado !== 'baja');
  const { elegidos, intro } = palabras.length ? elegirRacks(ctx, racks, equipos, ub, palabras) : { elegidos: /** @type {any[]} */ ([]), intro: '' };
  if (!elegidos.length) {
    const items = racks.map(r => ({ partes: [{ t: r.rack_nombre, href: ruta('racks', r) }], detalle: unir(cadenaUbicacion(ub, r.ubicacion_id), usados(r).length + ' equipos', r.rack_unidades_total + ' U'), orgId: r.organizacion_id }));
    return { grupos: [grupo(palabras.length ? 'No encontré un rack «' + palabras.join(' ') + '». Estos son los racks que podés ver (' + racks.length + '):' : 'Estos son los racks que podés ver (' + racks.length + '):', items)], enlace: atajo(ctx, 'racks', 'Ver los racks') };
  }
  /** @type {Grupo[]} */
  const grupos = [];
  for (const r of elegidos.slice(0, 3)) {
    const eqs = usados(r).sort((a, b) => ((b.rack_u_inicio || 0) + (b.rack_u_alto || 1)) - ((a.rack_u_inicio || 0) + (a.rack_u_alto || 1)));
    const ocupadas = new Set();
    for (const e of eqs) for (let u = e.rack_u_inicio || 0; u < (e.rack_u_inicio || 0) + (e.rack_u_alto || 1); u++) ocupadas.add(u);
    /** @type {number[]} */
    const libres = [];
    for (let u = 1; u <= r.rack_unidades_total; u++) if (!ocupadas.has(u)) libres.push(u);
    const items = eqs.map(e => {
      const ver = ctx.veo(moduloDe('equipos', e), e.organizacion_id);
      return ver ? { partes: [{ t: rangoU(e) + ' · ' + e.equipo_nombre, href: ruta('equipos', e) }], detalle: marcaModelo(e) || undefined, orgId: r.organizacion_id }
        : { partes: [{ t: rangoU(e) + ' · un equipo que no podés ver' }], orgId: r.organizacion_id };
    });
    const donde = ctx.org ? '' : ' (' + (ctx.orgs.get(r.organizacion_id) || '') + ')';
    const texto = (grupos.length ? '' : intro) + r.rack_nombre + donde + ': ' + eqs.length + (eqs.length === 1 ? ' equipo, ' : ' equipos, ') + libres.length + ' de ' + r.rack_unidades_total + ' U libres' + (libres.length ? ' (' + rangosLibres(libres) + ')' : '') + '.';
    grupos.push(eqs.length ? grupo(texto, items, 14) : { texto });
  }
  return { grupos, enlace: elegidos.length === 1 ? { t: 'Ver el rack dibujado', href: ruta('racks', elegidos[0]) } : atajo(ctx, 'racks', 'Ver los racks') };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderVlanInfo(ctx, q) {
  if (!ctx.veo('red', ctx.org)) return sinPermiso('la red');
  const vlans = (await ctx.listar('vlans')).filter(v => ctx.veo('red', v.organizacion_id));
  vlans.sort((a, b) => a.vlan_numero - b.vlan_numero);
  const palabras = q.objeto.split(' ').filter(hay);
  /** @type {any[]} */
  let hall = vlans;
  if (q.numero != null) hall = vlans.filter(v => v.vlan_numero === q.numero);
  else if (palabras.length) hall = vlans.filter(v => { const t = normalizar(v.vlan_nombre + ' ' + (v.vlan_descripcion || '')); return palabras.every(p => t.includes(p)); });
  if (!hall.length) return { grupos: [{ texto: 'No encontré una VLAN ' + (q.numero != null ? 'con el número ' + q.numero : 'para «' + palabras.join(' ') + '»') + ' en lo que podés ver.' }], enlace: atajo(ctx, 'red', 'Ver la red') };
  const linea = (/** @type {any} */ v) => {
    if (q.campo === 'gateway') return 'Gateway: ' + (v.vlan_gateway || 'no cargado');
    if (q.campo === 'dhcp') return 'DHCP: ' + (v.vlan_dhcp_activo ? 'sí' + (v.vlan_dhcp_rango ? ', rango ' + v.vlan_dhcp_rango : '') : 'no');
    if (q.campo === 'rango') return 'Rango DHCP: ' + (v.vlan_dhcp_activo && v.vlan_dhcp_rango ? v.vlan_dhcp_rango : 'no tiene');
    return unir('Red ' + (v.vlan_red_cidr || 'no cargada'), 'Gateway ' + (v.vlan_gateway || 'no cargado'), 'DHCP ' + (v.vlan_dhcp_activo ? 'sí' + (v.vlan_dhcp_rango ? ' (' + v.vlan_dhcp_rango + ')' : '') : 'no'));
  };
  const items = hall.map(v => item('VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre, ruta('vlans', v), q.campo ? unir(linea(v), v.vlan_red_cidr && q.campo !== 'red' ? 'Red ' + v.vlan_red_cidr : '') : linea(v), v.organizacion_id));
  const texto = q.numero == null && !palabras.length ? 'Hay ' + hall.length + ' VLAN:' : hall.length === 1 ? 'Esto encontré:' : 'Encontré ' + hall.length + ' VLAN:';
  return { grupos: [grupo(texto, items, 12)], enlace: atajo(ctx, 'red', 'Ver la red') };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderVlanDe(ctx, q) {
  if (!ctx.veo('red', ctx.org)) return sinPermiso('la red');
  /** @type {Item[]} */
  const items = [];
  if (q.puesto) {
    const hall = await hallarPuestos(ctx, q.puesto);
    if (!hall.length) return aviso('No encontré el puesto «' + q.puesto + '» en lo que podés ver.');
    for (const p of hall.slice(0, TOPE)) {
      const c = await cadenaPuesto(ctx, p);
      if (!c.partes.some(x => /^VLAN /.test(x.t))) c.detalle = 'No encontré la VLAN: el puesto no llega a un puerto de switch con VLAN cargada.';
      items.push(c);
    }
    return { grupos: [grupo(hall.length === 1 ? 'Así llega el puesto:' : 'Hay ' + hall.length + ' puestos que coinciden:', items)] };
  }
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return aviso('¿De qué equipo o puesto? Por ejemplo: «¿En qué VLAN está SRV-AGRO-01?».');
  const equipos = await hallarEquipos(ctx, palabras);
  if (!equipos.length) return aviso('No encontré un equipo para «' + palabras.join(' ') + '» en lo que podés ver.');
  const [vlans, puertos, puestos] = await Promise.all([ctx.listar('vlans'), ctx.listar('puertos'), ctx.listar('puestos')]);
  for (const e of equipos.slice(0, TOPE)) {
    const c = e.equipo_campos || {};
    const ips = [e.equipo_ip_gestion, c.router_ip_lan, c.firewall_ip_lan].filter(Boolean);
    const link = { t: e.equipo_nombre, href: ruta('equipos', e) };
    /** @type {Item|null} */
    let it = null;
    for (const ip of ips) {
      const v = vlans.find(x => x.organizacion_id === e.organizacion_id && ipEnCidr(ip, x.vlan_red_cidr));
      if (v) { it = { partes: [link, { t: 'VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre, href: ruta('vlans', v) }], detalle: 'Su IP ' + ip + ' está dentro de ' + v.vlan_red_cidr, orgId: e.organizacion_id }; break; }
    }
    if (!it && e.puesto_id) {
      const p = puestos.find(x => x.id === e.puesto_id);
      if (p) { const ch = await cadenaPuesto(ctx, p); if (ch.partes.some(x => /^VLAN /.test(x.t))) it = { partes: [link, ...ch.partes], orgId: e.organizacion_id }; }
    }
    if (!it) {
      const conVlan = puertos.filter(p => p.equipo_id === e.id && p.vlan_nativa_id).slice(0, 3);
      if (conVlan.length) {
        it = { partes: [link, ...conVlan.flatMap(p => { const v = vlans.find(x => x.id === p.vlan_nativa_id); return v ? [{ t: 'puerto ' + p.puerto_numero + ' · VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre, href: ruta('vlans', v) }] : []; })], orgId: e.organizacion_id };
      }
    }
    items.push(it || { partes: [link], detalle: 'No tiene una IP dentro de una VLAN ni puertos con VLAN cargados.', orgId: e.organizacion_id });
  }
  return { grupos: [grupo(items.length === 1 ? 'Esto encontré:' : 'Encontré ' + equipos.length + ' equipos:', items)] };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderWifi(ctx, q) {
  if (!ctx.veo('red', ctx.org)) return sinPermiso('la red');
  const [redes, vlans] = await Promise.all([ctx.listar('redes_wifi'), ctx.listar('vlans')]);
  const palabras = q.objeto.split(' ').filter(hay);
  let lista = redes.filter(w => ctx.veo('red', w.organizacion_id));
  if (palabras.length) {
    const f = lista.filter(w => palabras.every(p => normalizar(w.wifi_ssid).includes(p)));
    lista = f;
  }
  if (!lista.length) return { grupos: [{ texto: palabras.length ? 'No encontré una red Wi-Fi para «' + palabras.join(' ') + '» en lo que podés ver.' : 'No hay redes Wi-Fi cargadas en lo que podés ver.' }], enlace: atajo(ctx, 'red', 'Ver la red') };
  const SEG = { wpa2: 'WPA2', wpa3: 'WPA3', portal: 'Portal cautivo', abierta: 'Abierta' };
  /** @type {Item[]} */
  const items = [];
  for (const w of lista.slice(0, TOPE)) {
    const v = w.vlan_id ? vlans.find(x => x.id === w.vlan_id) : null;
    const aps = Array.isArray(w.access_point_ids) ? w.access_point_ids.length : 0;
    items.push(item('Wi-Fi ' + w.wifi_ssid, ruta('redes_wifi', w), unir(/** @type {any} */ (SEG)[w.wifi_seguridad] || w.wifi_seguridad, w.wifi_oculta ? 'oculta' : 'visible', v ? 'VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre : '', aps + (aps === 1 ? ' access point' : ' access points')), w.organizacion_id));
  }
  /** @type {Grupo[]} */
  const grupos = [grupo(lista.length === 1 ? 'Esto encontré:' : 'Hay ' + lista.length + ' redes Wi-Fi:', items)];
  if (q.campo === 'clave') {
    /** @type {Item[]} */
    const creds = [];
    for (const w of lista.slice(0, 4)) {
      if (!w.credencial_id) { creds.push({ partes: [{ t: 'Wi-Fi ' + w.wifi_ssid + ': no tiene una credencial cargada' }], orgId: w.organizacion_id }); continue; }
      const c = await repositorio.obtener('credenciales', w.credencial_id);
      if (c && ctx.veo('credenciales', c.organizacion_id)) {
        const puedeVer = puedeVerSecreto(ctx.u, c);
        creds.push(item(c.credencial_nombre, ruta('credenciales', c), 'Clave de ' + w.wifi_ssid + '. ' + (puedeVer ? 'En la ficha tenés «Mostrar» y «Copiar».' : puedePedirSecreto(ctx.u) ? 'En la ficha podés usar «Pedir acceso».' : 'Solo la ve quien tenga acceso.'), c.organizacion_id));
      } else creds.push({ partes: [{ t: 'Wi-Fi ' + w.wifi_ssid + ': su clave está en una credencial que no podés ver' }], orgId: w.organizacion_id });
    }
    grupos.push(grupo('Por seguridad no muestro claves acá. La clave está en la ficha de la credencial:', creds));
  }
  return { grupos };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderInternet(ctx, q) {
  if (!ctx.veo('red', ctx.org)) return sinPermiso('la red');
  const todos = (await ctx.listar('enlaces_isp')).filter(e => ctx.veo('red', e.organizacion_id));
  if (!todos.length) return { grupos: [{ texto: 'No hay enlaces a Internet cargados en lo que podés ver.' }], enlace: atajo(ctx, 'red', 'Ver la red') };
  const palabras = q.objeto.split(' ').filter(hay);
  let lista = todos, nota = '';
  if (palabras.length) {
    const f = todos.filter(e => palabras.every(p => normalizar(e.enlace_proveedor).includes(p)));
    if (f.length) lista = f; else nota = 'No encontré un proveedor «' + palabras.join(' ') + '»; estos son todos los enlaces que podés ver.';
  }
  lista = lista.slice().sort((a, b) => Number(b.enlace_es_principal) - Number(a.enlace_es_principal));
  const TIPO = { fija: 'IP fija', dinamica: 'IP dinámica' };
  const items = lista.map(e => {
    const det = {
      ip_publica: unir(e.enlace_ip_publica ? 'IP pública ' + e.enlace_ip_publica : 'sin IP pública cargada', /** @type {any} */ (TIPO)[e.enlace_tipo_ip] || e.enlace_tipo_ip),
      cliente: 'Número de cliente: ' + (e.enlace_numero_cliente || 'no cargado'),
      soporte: 'Soporte: ' + (e.enlace_telefono_soporte || 'no cargado'),
      velocidad: 'Velocidad: ' + (e.enlace_velocidad_bajada_mbps || '?') + ' Mbps de bajada / ' + (e.enlace_velocidad_subida_mbps || '?') + ' de subida'
    };
    const completo = unir(e.enlace_tipo, (e.enlace_velocidad_bajada_mbps || '?') + '/' + (e.enlace_velocidad_subida_mbps || '?') + ' Mbps', e.enlace_ip_publica ? 'IP pública ' + e.enlace_ip_publica + (e.enlace_tipo_ip ? ' (' + e.enlace_tipo_ip + ')' : '') : '',
      e.enlace_numero_cliente ? 'cliente ' + e.enlace_numero_cliente : '', e.enlace_telefono_soporte ? 'soporte ' + e.enlace_telefono_soporte : '');
    const primero = q.campo && /** @type {any} */ (det)[q.campo] ? /** @type {any} */ (det)[q.campo] : '';
    return item(e.enlace_proveedor + (e.enlace_es_principal ? ' (principal)' : ''), '#/enlace/' + e.id, primero ? primero + ' · ' + completo : completo, e.organizacion_id);
  });
  /** @type {Respuesta} */
  const r = { grupos: [grupo(lista.length === 1 ? 'Tenés este enlace:' : 'Hay ' + lista.length + ' enlaces a Internet:', items)] };
  if (nota) r.nota = nota;
  return r;
}

/** Valor de un campo de un equipo (null si no corresponde o no está cargado). @param {any} e @param {string} clave */
function valorCampo(e, clave) {
  const c = e.equipo_campos || {};
  const VIRT = /** @type {Record<string, string>} */ ({ hyperv: 'Hyper-V', proxmox: 'Proxmox', vmware: 'VMware', kvm: 'KVM', ninguna: 'Ninguna (equipo físico)' });
  switch (clave) {
    case 'marca': return e.equipo_marca || null;
    case 'modelo': return e.equipo_modelo || null;
    case 'serie': return e.equipo_numero_serie || null;
    case 'mac': return e.equipo_mac || null;
    case 'codigo': return e.equipo_codigo || null;
    case 'estado': return /** @type {any} */ (ROTULO_ESTADO_EQUIPO)[e.equipo_estado] || e.equipo_estado || null;
    case 'so': return c.servidor_sistema_operativo || null;
    case 'ram': return c.servidor_ram_gb != null ? c.servidor_ram_gb + ' GB' : null;
    case 'cpu': return c.servidor_cpu || null;
    case 'almacenamiento': return c.servidor_almacenamiento || null;
    case 'virtualizacion': return c.servidor_virtualizacion ? VIRT[c.servidor_virtualizacion] || c.servidor_virtualizacion : null;
    case 'rol': return c.servidor_rol || null;
    case 'firmware': return c.router_firmware_version || c.firewall_firmware_version || c.switch_firmware_version || c.access_point_firmware_version || null;
    case 'garantia': {
      const f = c.servidor_garantia_vence_en || c.otro_garantia_vence_en || c.firewall_licencia_vence_en || null;
      return f ? 'vence el ' + fmtFecha(f) + ' (' + textoVence(f) + ')' : null;
    }
    default: return null;
  }
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderDatoEquipo(ctx, q) {
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return aviso('¿De qué equipo? Por ejemplo: «¿Qué modelo es SRV-AGRO-01?».');
  const equipos = await hallarEquipos(ctx, palabras);
  if (!equipos.length) return aviso('No encontré un equipo para «' + palabras.join(' ') + '» en lo que podés ver.');
  const def = CAMPOS_EQUIPO.find(c => c.clave === q.campo);
  /** @type {Item[]} */
  const items = equipos.slice(0, TOPE).map(e => {
    if (def) {
      const v = valorCampo(e, def.clave);
      return item(e.equipo_nombre, ruta('equipos', e), def.rotulo + ': ' + (v || 'no cargado para este equipo'), e.organizacion_id);
    }
    const c = e.equipo_campos || {};
    return item(e.equipo_nombre, ruta('equipos', e), unir(ROTULO_EQUIPO_TIPO[e.equipo_tipo] + (c.otro_categoria ? ' (' + c.otro_categoria + ')' : ''), marcaModelo(e), e.equipo_numero_serie ? 'serie ' + e.equipo_numero_serie : '', e.equipo_ip_gestion ? 'IP ' + e.equipo_ip_gestion : '',
      c.servidor_ip_ilo_idrac ? 'iLO/iDRAC ' + c.servidor_ip_ilo_idrac : '', /** @type {any} */ (ROTULO_ESTADO_EQUIPO)[e.equipo_estado]), e.organizacion_id);
  });
  return { grupos: [grupo(items.length === 1 ? 'Esto encontré:' : 'Encontré ' + equipos.length + ' equipos:', items)] };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderListarTipo(ctx, q) {
  const t = TIPOS_EQUIPO.find(x => x.clave === q.tipo);
  if (!t) return aviso('¿Qué tipo de equipo querés listar? Por ejemplo: «¿Qué servidores hay?» o «¿Cuántas impresoras hay?».');
  const modulo = t.tipo === 'servidor' ? 'servidores' : 'red';
  if (!ctx.veo(modulo, ctx.org)) return sinPermiso(modulo === 'servidores' ? 'los servidores' : 'la red y los equipos');
  const [equipos, ubics, puestos] = await Promise.all([ctx.listar('equipos'), ctx.listar('ubicaciones'), ctx.listar('puestos')]);
  const ub = new Map(ubics.map(u => [u.id, u]));
  let lista = equipos.filter(e => esDeTipo(e, t.clave) && e.equipo_estado !== 'baja' && ctx.veo(moduloDe('equipos', e), e.organizacion_id));
  const palabras = q.objeto.split(' ').filter(hay);
  let nota = '';
  if (palabras.length) {
    const f = lista.filter(e => { const p = e.puesto_id ? puestos.find(x => x.id === e.puesto_id) : null; const txt = normalizar([e.equipo_nombre, e.equipo_codigo, e.equipo_marca, e.equipo_modelo, cadenaUbicacion(ub, e.ubicacion_id), p ? p.puesto_nombre : ''].join(' ')); return palabras.every(w => txt.includes(w)); });
    if (f.length) lista = f; else if (lista.length) nota = 'No encontré ninguno que coincida con «' + palabras.join(' ') + '»; te muestro todos.';
  }
  lista.sort((a, b) => a.equipo_nombre.localeCompare(b.equipo_nombre, 'es', { numeric: true }));
  const atajoT = atajo(ctx, t.pantalla.replace('#/', ''), 'Ver ' + (t.pantalla === '#/servidores' ? 'los servidores' : t.pantalla === '#/escritorio' ? 'los equipos de escritorio' : 'la red'));
  if (!lista.length) return { grupos: [{ texto: 'No hay ' + t.rotulo + ' cargados en lo que podés ver.' }], enlace: atajoT };
  const items = lista.map(e => item(e.equipo_nombre, ruta('equipos', e), unir(marcaModelo(e), cadenaUbicacion(ub, e.ubicacion_id).split(' › ').pop(), e.equipo_ip_gestion), e.organizacion_id));
  /** @type {Respuesta} */
  const r = { grupos: [grupo('Hay ' + lista.length + ' ' + t.rotulo + ':', items)], enlace: atajoT };
  if (nota) r.nota = nota;
  return r;
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderSinAsignar(ctx, q) {
  if (!ctx.veo('red', ctx.org)) return sinPermiso('la red y los equipos');
  const clave = q.tipo || 'computadoras';
  const t = TIPOS_EQUIPO.find(x => x.clave === clave) || TIPOS_EQUIPO[0];
  const verAsignaciones = ctx.veo('personas', ctx.org);
  const [equipos, asigs, ubics] = await Promise.all([ctx.listar('equipos'), ctx.listar('asignaciones'), ctx.listar('ubicaciones')]);
  const ub = new Map(ubics.map(u => [u.id, u]));
  const propios = equipos.filter(e => esDeTipo(e, t.clave) && e.equipo_estado !== 'baja' && ctx.veo(moduloDe('equipos', e), e.organizacion_id));
  const enDeposito = propios.filter(e => e.equipo_estado === 'en_deposito');
  const sinDueno = verAsignaciones && q.filtro !== 'deposito' ? propios.filter(e => e.equipo_estado !== 'en_deposito' && !asigs.some(a => a.equipo_id === e.id && !a.asignacion_hasta)) : [];
  const fila = (/** @type {any} */ e, /** @type {string} */ det) => item(e.equipo_nombre, ruta('equipos', e), unir(det, marcaModelo(e), cadenaUbicacion(ub, e.ubicacion_id).split(' › ').pop()), e.organizacion_id);
  /** @type {Grupo[]} */
  const grupos = [];
  grupos.push(enDeposito.length ? grupo('En depósito (' + enDeposito.length + '):', enDeposito.map(e => fila(e, 'en depósito'))) : { texto: 'No hay ' + t.rotulo + ' en depósito.' });
  if (q.filtro !== 'deposito') {
    if (!verAsignaciones) grupos.push({ texto: 'No tenés permiso para ver las asignaciones, así que no puedo decirte cuáles no tienen persona.' });
    else grupos.push(sinDueno.length ? grupo('En uso pero sin persona asignada (' + sinDueno.length + '):', sinDueno.map(e => fila(e, 'sin asignación vigente'))) : { texto: 'Todos los ' + t.rotulo + ' en uso tienen una persona asignada.' });
  }
  return { grupos, enlace: atajo(ctx, 'escritorio', 'Ver los equipos de escritorio') };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderCuentaDe(ctx, q) {
  if (!ctx.veo('personas', ctx.org)) return sinPermiso('las personas y sus cuentas');
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return aviso('¿De qué persona o cuenta? Por ejemplo: «¿Qué cuentas tiene Fabián Farías?».');
  const [cuentas, personas] = await Promise.all([ctx.listar('cuentas_dominio'), ctx.listar('personas')]);
  const visibles = cuentas.filter(c => ctx.veo('personas', c.organizacion_id));
  const lineaCuenta = (/** @type {any} */ c, /** @type {boolean} */ conPersona) => {
    const p = c.persona_id ? personas.find(x => x.id === c.persona_id) : null;
    /** @type {Parte[]} */
    const partes = [{ t: c.cuenta_dominio + '\\' + c.cuenta_usuario, href: ruta('cuentas_dominio', c) }];
    if (conPersona) partes.push(p ? { t: p.persona_nombre, href: ruta('personas', p) } : { t: 'sin persona asignada' });
    const grupos = Array.isArray(c.cuenta_grupos) && c.cuenta_grupos.length ? 'Grupos: ' + c.cuenta_grupos.join(', ') : '';
    return { partes, detalle: unir(/** @type {any} */ (ROTULO_CUENTA_ESTADO)[c.cuenta_estado] || c.cuenta_estado, c.cuenta_unidad_organizativa, grupos), orgId: c.organizacion_id };
  };
  // Primero por persona; si no hay, por el nombre de la cuenta.
  const porPersona = await hallarPersonas(ctx, palabras);
  /** @type {Item[]} */
  const items = [];
  if (q.campo !== 'dueno' || !palabras.some(w => /^[a-z0-9._-]+$/.test(w) && visibles.some(c => normalizar(c.cuenta_usuario) === w))) {
    for (const r of porPersona.slice(0, 4)) {
      const mias = visibles.filter(c => c.persona_id === r.id);
      if (!mias.length) { items.push(item(r.titulo, ruta('personas', r), 'No tiene cuentas de dominio cargadas.', r.organizacion_id)); continue; }
      for (const c of mias) items.push(lineaCuenta(c, true));
    }
  }
  if (!items.length) {
    const porCuenta = visibles.filter(c => palabras.every(w => normalizar(c.cuenta_dominio + '\\' + c.cuenta_usuario).includes(w)));
    for (const c of porCuenta.slice(0, TOPE)) items.push(lineaCuenta(c, true));
  }
  if (!items.length) return { grupos: [{ texto: 'No encontré una persona ni una cuenta para «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'personas', 'Ver las personas') };
  return { grupos: [grupo(items.length === 1 ? 'Esto encontré:' : 'Encontré ' + items.length + ' cuentas:', items)], nota: 'Por seguridad no muestro contraseñas de las cuentas.' };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderPersonaInfo(ctx, q) {
  if (!ctx.veo('personas', ctx.org)) return sinPermiso('las personas');
  const [personas, puestos, ubics] = await Promise.all([ctx.listar('personas'), ctx.listar('puestos'), ctx.listar('ubicaciones')]);
  const ub = new Map(ubics.map(u => [u.id, u]));
  const visibles = personas.filter(p => ctx.veo('personas', p.organizacion_id) && p.persona_estado !== 'baja');
  const fila = (/** @type {any} */ p) => {
    const pu = p.puesto_id ? puestos.find(x => x.id === p.puesto_id) : null;
    /** @type {Parte[]} */
    const partes = [{ t: p.persona_nombre, href: ruta('personas', p) }];
    if (pu) partes.push(parteSi(ctx, 'red', pu.organizacion_id, 'puesto ' + pu.puesto_nombre, ruta('puestos', pu)));
    return { partes, detalle: unir(p.persona_sector ? 'Sector ' + p.persona_sector : 'sin sector cargado', pu ? cadenaUbicacion(ub, pu.ubicacion_id) : 'sin puesto asignado'), orgId: p.organizacion_id };
  };
  if (q.puesto) {
    if (!ctx.veo('red', ctx.org)) return sinPermiso('los puestos');
    const hall = await hallarPuestos(ctx, q.puesto);
    if (!hall.length) return aviso('No encontré el puesto «' + q.puesto + '» en lo que podés ver.');
    /** @type {Item[]} */
    const items = [];
    for (const pu of hall.slice(0, TOPE)) {
      const gente = visibles.filter(p => p.puesto_id === pu.id);
      if (!gente.length) items.push({ partes: [{ t: 'Puesto ' + pu.puesto_nombre, href: ruta('puestos', pu) }, { t: 'sin personas cargadas' }], orgId: pu.organizacion_id });
      for (const p of gente) items.push(fila(p));
    }
    return { grupos: [grupo('En ese puesto:', items)] };
  }
  const palabras = q.objeto.split(' ').filter(hay);
  if (!palabras.length) return aviso('¿De qué persona o sector? Por ejemplo: «¿En qué sector trabaja Fabián Farías?».');
  if (q.campo === 'sector') {
    const hall = visibles.filter(p => palabras.every(w => normalizar(p.persona_sector || '').includes(w)));
    if (!hall.length) return aviso('No encontré personas en un sector «' + palabras.join(' ') + '» en lo que podés ver.');
    hall.sort((a, b) => a.persona_nombre.localeCompare(b.persona_nombre, 'es'));
    return { grupos: [grupo('Hay ' + hall.length + (hall.length === 1 ? ' persona' : ' personas') + ' en ese sector:', hall.map(fila), 12)], enlace: atajo(ctx, 'personas', 'Ver las personas') };
  }
  const res = await hallarPersonas(ctx, palabras);
  if (!res.length) return { grupos: [{ texto: 'No encontré una persona para «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'personas', 'Ver las personas') };
  const items = res.slice(0, TOPE).map(r => fila(r));
  return { grupos: [grupo(items.length === 1 ? 'Esto encontré:' : 'Encontré ' + res.length + ' personas:', items)] };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderLicenciasDe(ctx, q) {
  if (!ctx.veo('licencias', ctx.org)) return sinPermiso('las licencias');
  const [lics, instalaciones, equipos, personas, cuentas] = await Promise.all([ctx.listar('licencias'), ctx.listar('instalaciones_licencia'), ctx.listar('equipos'), ctx.listar('personas'), ctx.listar('cuentas_dominio')]);
  const visibles = lics.filter(l => ctx.veo('licencias', l.organizacion_id));
  const vigentes = instalaciones.filter(i => !i.instalacion_hasta && ctx.veo('licencias', i.organizacion_id));
  const palabras = q.objeto.split(' ').filter(hay);
  const nombreEq = (/** @type {string|null} */ id) => { const e = id ? equipos.find(x => x.id === id) : null; return e ? parteSi(ctx, moduloDe('equipos', e), e.organizacion_id, e.equipo_nombre, ruta('equipos', e)) : null; };
  const lineaLic = async (/** @type {any} */ l) => {
    const uso = await repositorio.licenciasEnUso(l.id);
    return item(l.licencia_producto, ruta('licencias', l), unir(uso.usadas + ' en uso de ' + uso.cantidad, uso.excedida ? uso.exceso + ' de más' : uso.disponibles + (uso.disponibles === 1 ? ' disponible' : ' disponibles'), l.licencia_vence_en ? 'vence ' + fmtFecha(l.licencia_vence_en) : ''), l.organizacion_id);
  };
  /** Instalaciones de un producto: dónde está cada una. */
  const dondeEsta = async (/** @type {any[]} */ prods) => {
    /** @type {Grupo[]} */
    const grupos = [];
    for (const l of prods.slice(0, 4)) {
      const uso = await repositorio.licenciasEnUso(l.id);
      const mias = vigentes.filter(i => i.licencia_id === l.id);
      const filas = mias.map(i => {
        const e = nombreEq(i.equipo_id);
        const p = i.persona_id ? personas.find(x => x.id === i.persona_id) : (i.cuenta_id ? personas.find(x => x.id === (cuentas.find(c => c.id === i.cuenta_id) || {}).persona_id) : null);
        /** @type {Parte[]} */
        const partes = [];
        if (e) partes.push(e);
        if (p && ctx.veo('personas', p.organizacion_id)) partes.push({ t: p.persona_nombre, href: ruta('personas', p) });
        if (!partes.length) partes.push({ t: 'sin equipo ni persona cargados' });
        return { partes, detalle: 'desde ' + fmtFecha(i.instalacion_desde), orgId: l.organizacion_id };
      });
      const texto = l.licencia_producto + ': ' + uso.usadas + ' en uso de ' + uso.cantidad + (uso.excedida ? ' (' + uso.exceso + ' de más)' : ', quedan ' + uso.disponibles) + '.';
      grupos.push(filas.length ? grupo(texto + ' Instalada en:', filas, 8) : { texto: texto + ' No está instalada en ningún equipo.' });
    }
    return grupos;
  };
  if (!palabras.length) {
    const items = [];
    for (const l of visibles.slice(0, 12)) items.push(await lineaLic(l));
    return { grupos: [grupo('Estas son las licencias (' + visibles.length + '):', items, 12)], enlace: atajo(ctx, 'licencias', 'Ver las licencias') };
  }
  const prods = visibles.filter(l => palabras.every(w => normalizar(l.licencia_producto).includes(w)));
  const preferirProducto = q.campo === 'quedan' || q.campo === 'instalado';
  const buscarProducto = async () => (prods.length ? { grupos: await dondeEsta(prods), enlace: atajo(ctx, 'licencias', 'Ver las licencias') } : null);
  if (preferirProducto) {
    const r = await buscarProducto();
    return r || { grupos: [{ texto: 'No encontré una licencia de «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'licencias', 'Ver las licencias') };
  }
  // Licencias de un equipo (si lo que se nombra es una persona, no se mezclan los equipos que tiene)
  const sonPersonas = !/\d/.test(palabras.join(' ')) && (await ctx.listar('personas')).some(p => ctx.veo('personas', p.organizacion_id) && palabras.every(w => normalizar(p.persona_nombre).includes(w)));
  const eqs = sonPersonas ? [] : (await hallarEquipos(ctx, palabras)).slice(0, 4);
  if (eqs.length) {
    /** @type {Grupo[]} */
    const grupos = [];
    for (const e of eqs) {
      const mias = vigentes.filter(i => i.equipo_id === e.id);
      /** @type {Item[]} */
      const items = [];
      for (const i of mias) { const l = visibles.find(x => x.id === i.licencia_id); if (l) items.push(item(l.licencia_producto, ruta('licencias', l), 'instalada desde ' + fmtFecha(i.instalacion_desde), l.organizacion_id)); }
      grupos.push(items.length ? grupo(e.equipo_nombre + ' tiene ' + items.length + (items.length === 1 ? ' licencia:' : ' licencias:'), items) : { texto: e.equipo_nombre + ' no tiene licencias instaladas cargadas.' });
    }
    return { grupos, nota: 'Por seguridad no muestro claves de licencia.' };
  }
  // Licencias de una persona
  const pers = (await hallarPersonas(ctx, palabras)).slice(0, 3);
  if (pers.length) {
    /** @type {Grupo[]} */
    const grupos = [];
    for (const r of pers) {
      const susCuentas = cuentas.filter(c => c.persona_id === r.id).map(c => c.id);
      const susEquipos = (await ctx.listar('asignaciones')).filter(a => a.persona_id === r.id && !a.asignacion_hasta).map(a => a.equipo_id);
      const mias = vigentes.filter(i => i.persona_id === r.id || (i.cuenta_id && susCuentas.includes(i.cuenta_id)) || (i.equipo_id && susEquipos.includes(i.equipo_id)));
      /** @type {Item[]} */
      const items = [];
      const vistos = new Set();
      for (const i of mias) {
        const l = visibles.find(x => x.id === i.licencia_id);
        if (!l || vistos.has(l.id + (i.equipo_id || ''))) continue;
        vistos.add(l.id + (i.equipo_id || ''));
        const e = i.equipo_id ? equipos.find(x => x.id === i.equipo_id) : null;
        items.push(item(l.licencia_producto, ruta('licencias', l), e ? 'en ' + e.equipo_nombre : 'instalación a su nombre', l.organizacion_id));
      }
      grupos.push(items.length ? grupo(r.titulo + ' usa ' + items.length + (items.length === 1 ? ' licencia:' : ' licencias:'), items) : { texto: r.titulo + ' no tiene licencias cargadas.' });
    }
    return { grupos, nota: 'Por seguridad no muestro claves de licencia.' };
  }
  const rp = await buscarProducto();
  if (rp) return rp;
  return { grupos: [{ texto: 'No encontré un equipo, una persona ni un producto para «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'licencias', 'Ver las licencias') };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderMapeo(ctx, q) {
  if (!ctx.veo('configuraciones', ctx.org)) return sinPermiso('las configuraciones y los mapeos de disco');
  const [mapeos, personas, cuentas, equipos] = await Promise.all([ctx.listar('mapeos_disco'), ctx.listar('personas'), ctx.listar('cuentas_dominio'), ctx.listar('equipos')]);
  const visibles = mapeos.filter(m => ctx.veo('configuraciones', m.organizacion_id));
  const METODO = /** @type {Record<string, string>} */ ({ gpo: 'directiva de grupo', script: 'script', manual: 'manual' });
  const aplica = (/** @type {any} */ m) => (m.mapeo_aplica_a === 'todos' ? 'todos' : m.mapeo_aplica_a === 'grupo' ? 'grupo ' + m.mapeo_grupo : (() => { const p = personas.find(x => x.id === m.persona_id); return 'persona ' + (p && ctx.veo('personas', p.organizacion_id) ? p.persona_nombre : '(no visible)'); })());
  const fila = (/** @type {any} */ m) => {
    const e = m.equipo_id ? equipos.find(x => x.id === m.equipo_id) : null;
    return item(m.mapeo_letra + ' ' + m.mapeo_ruta, ruta('mapeos_disco', m), unir('Aplica a: ' + aplica(m), METODO[m.mapeo_metodo] || m.mapeo_metodo, e ? 'servidor ' + e.equipo_nombre : ''), m.organizacion_id);
  };
  if (q.letra) {
    const hall = visibles.filter(m => normalizar(m.mapeo_letra) === normalizar(q.letra || ''));
    if (!hall.length) return { grupos: [{ texto: 'No encontré una unidad ' + q.letra + ' en lo que podés ver.' }], enlace: atajo(ctx, 'configuraciones', 'Ver las configuraciones') };
    return { grupos: [grupo(hall.length === 1 ? 'La unidad ' + q.letra + ' apunta a:' : 'Hay ' + hall.length + ' mapeos de la unidad ' + q.letra + ':', hall.map(fila))] };
  }
  const palabras = q.objeto.split(' ').filter(hay);
  if (palabras.length) {
    if (!ctx.veo('personas', ctx.org)) {
      const comunes = visibles.filter(m => m.mapeo_aplica_a === 'todos');
      return { grupos: [{ texto: 'No tenés permiso para ver las personas, así que solo te puedo decir los mapeos que aplican a todos (' + comunes.length + '):' , items: recortar(comunes.map(fila)), mas: Math.max(0, comunes.length - TOPE) }] };
    }
    const pers = (await hallarPersonas(ctx, palabras)).slice(0, 3);
    if (!pers.length) return { grupos: [{ texto: 'No encontré una persona para «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'configuraciones', 'Ver las configuraciones') };
    /** @type {Grupo[]} */
    const grupos = [];
    for (const r of pers) {
      const grp = new Set(cuentas.filter(c => c.persona_id === r.id).flatMap(c => c.cuenta_grupos || []));
      const mios = visibles.filter(m => m.organizacion_id === r.organizacion_id && (m.mapeo_aplica_a === 'todos' || (m.mapeo_aplica_a === 'persona' && m.persona_id === r.id) || (m.mapeo_aplica_a === 'grupo' && grp.has(m.mapeo_grupo))));
      mios.sort((a, b) => a.mapeo_letra.localeCompare(b.mapeo_letra));
      grupos.push(mios.length ? grupo(r.titulo + ' tiene ' + mios.length + (mios.length === 1 ? ' unidad de red:' : ' unidades de red:'), mios.map(fila)) : { texto: r.titulo + ' no tiene unidades de red cargadas.' });
    }
    return { grupos };
  }
  if (!visibles.length) return { grupos: [{ texto: 'No hay mapeos de disco cargados en lo que podés ver.' }], enlace: atajo(ctx, 'configuraciones', 'Ver las configuraciones') };
  visibles.sort((a, b) => a.mapeo_letra.localeCompare(b.mapeo_letra));
  return { grupos: [grupo('Hay ' + visibles.length + ' mapeos de disco:', visibles.map(fila), 12)], enlace: atajo(ctx, 'configuraciones', 'Ver las configuraciones') };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderServicio(ctx, q) {
  if (!ctx.veo('configuraciones', ctx.org)) return sinPermiso('los dominios y servicios');
  const servicios = (await ctx.listar('servicios')).filter(s => ctx.veo('configuraciones', s.organizacion_id));
  if (!servicios.length) return { grupos: [{ texto: 'No hay dominios ni servicios cargados en lo que podés ver.' }], enlace: atajo(ctx, 'servicios', 'Ver dominios y servicios') };
  const palabras = q.objeto.split(' ').filter(hay);
  let lista = servicios;
  let nota = '';
  if (palabras.length) {
    let f = servicios.filter(s => palabras.every(w => normalizar(s.servicio_nombre).includes(w)));
    // Sin coincidencia exacta («agrodemo.com.ar»): se prueba con el nombre sin la terminación.
    if (!f.length) { const raices = palabras.map(w => w.split('.')[0]).filter(w => w.length >= 4); f = raices.length ? servicios.filter(s => raices.every(w => normalizar(s.servicio_nombre).includes(w))) : []; if (f.length) nota = 'No hay un servicio con ese nombre exacto; te muestro los parecidos.'; }
    if (!f.length) return { grupos: [{ texto: 'No encontré un dominio o servicio para «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'servicios', 'Ver dominios y servicios') };
    lista = f;
  }
  // Registros DNS
  if (q.campo) {
    const dns = lista.filter(s => Array.isArray(s.servicio_registros) && s.servicio_registros.length);
    /** @type {Item[]} */
    const items = [];
    for (const s of dns) for (const g of s.servicio_registros) {
      if (q.campo !== 'registros' && g.tipo !== q.campo) continue;
      items.push(item(g.tipo + ' · ' + g.nombre + ' → ' + g.valor + (g.prioridad != null ? ' (prioridad ' + g.prioridad + ')' : ''), ruta('servicios', s), s.servicio_nombre, s.organizacion_id));
    }
    if (!items.length) return { grupos: [{ texto: 'No hay registros ' + (q.campo === 'registros' ? 'DNS' : q.campo) + ' cargados para ese dominio.' }], enlace: atajo(ctx, 'servicios', 'Ver dominios y servicios') };
    return { grupos: [grupo('Registros ' + (q.campo === 'registros' ? 'DNS' : q.campo) + ' (' + items.length + '):', items, 12)], enlace: atajo(ctx, 'servicios', 'Ver dominios y servicios'), nota: nota || undefined };
  }
  if (q.tipo) { const f = lista.filter(s => s.servicio_tipo === q.tipo); if (f.length) lista = f; }
  lista = lista.slice().sort((a, b) => a.servicio_nombre.localeCompare(b.servicio_nombre, 'es'));
  const items = lista.map(s => item(s.servicio_nombre, ruta('servicios', s), unir(/** @type {any} */ (ROTULO_SERVICIO_TIPO)[s.servicio_tipo] || s.servicio_tipo, s.servicio_proveedor ? 'proveedor ' + s.servicio_proveedor : '', s.servicio_titular ? 'titular ' + s.servicio_titular : '',
    s.servicio_plan, s.servicio_delegacion_dns ? 'DNS en ' + s.servicio_delegacion_dns : '', s.servicio_vence_en ? 'vence ' + fmtFecha(s.servicio_vence_en) + ' (' + textoVence(s.servicio_vence_en) + ')' : ''), s.organizacion_id));
  /** @type {Respuesta} */
  const r = { grupos: [grupo(lista.length === 1 ? 'Esto encontré:' : 'Encontré ' + lista.length + ' servicios:', items)], enlace: atajo(ctx, 'servicios', 'Ver dominios y servicios') };
  if (nota) r.nota = nota;
  return r;
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderConfigDoc(ctx, q) {
  if (!ctx.veo('configuraciones', ctx.org)) return sinPermiso('las configuraciones');
  const [configs, equipos, notas] = await Promise.all([ctx.listar('configuraciones'), ctx.listar('equipos'), ctx.listar('notas')]);
  const palabras = q.objeto.split(' ').filter(hay);
  const TIPOS = /** @type {Record<string, string[]>} */ ({ vpn: ['vpn_sitio_a_sitio', 'vpn_usuario'], reglas: ['reglas_firewall'], nat: ['nat_reenvio_puertos'], wifi: ['wifi'] });
  const visibles = configs.filter(c => ctx.veo('configuraciones', c.organizacion_id));
  const txt = (/** @type {any} */ c) => { const e = c.equipo_id ? equipos.find(x => x.id === c.equipo_id) : null; return normalizar([c.configuracion_titulo, e ? e.equipo_nombre : ''].join(' ')); };
  let hall = visibles;
  if (q.tipo && TIPOS[q.tipo]) hall = visibles.filter(c => TIPOS[q.tipo || ''].includes(c.configuracion_tipo));
  if (palabras.length) { const f = hall.filter(c => palabras.every(w => txt(c).includes(w))); if (f.length || !q.tipo) hall = f; }
  /** @type {Item[]} */
  const items = hall.map(c => {
    const e = c.equipo_id ? equipos.find(x => x.id === c.equipo_id) : null;
    const resumen = String(c.configuracion_notas || '').split('\n')[0].slice(0, 120);
    return item(c.configuracion_titulo, ruta('configuraciones', c), unir(/** @type {any} */ (ROTULO_CONFIGURACION_TIPO)[c.configuracion_tipo] || c.configuracion_tipo, c.configuracion_version_fecha ? 'versión del ' + fmtFecha(c.configuracion_version_fecha) : '', e ? e.equipo_nombre : '', resumen), c.organizacion_id);
  });
  // Notas que mencionan lo mismo
  /** @type {Item[]} */
  const delNotas = [];
  if (palabras.length) {
    for (const n of notas) {
      if (!palabras.every(w => normalizar(n.nota_titulo + ' ' + n.nota_contenido).includes(w))) continue;
      const mod = await repositorio.moduloDeNota(n);
      if (!mod || !ctx.veo(mod, n.organizacion_id)) continue;
      const ficha = await repositorio.resumenDeRegistro(n.entidad, n.entidad_id);
      delNotas.push(item(n.nota_titulo, ficha && ficha.ruta ? ficha.ruta : '#/notas', ficha ? 'Nota de «' + ficha.titulo + '»' : 'Nota', n.organizacion_id));
    }
  }
  if (!items.length && !delNotas.length) return { grupos: [{ texto: 'No encontré configuraciones ni notas para «' + (palabras.join(' ') || q.tipo || '') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'configuraciones', 'Ver las configuraciones') };
  /** @type {Grupo[]} */
  const grupos = [];
  if (items.length) grupos.push(grupo(items.length === 1 ? 'Encontré esta configuración:' : 'Encontré ' + items.length + ' configuraciones:', items));
  if (delNotas.length) grupos.push(grupo(items.length ? (delNotas.length === 1 ? 'Y esta nota:' : 'Y ' + delNotas.length + ' notas:') : (delNotas.length === 1 ? 'No hay una configuración, pero encontré esta nota:' : 'No hay una configuración, pero encontré ' + delNotas.length + ' notas:'), delNotas, 6));
  return { grupos, enlace: atajo(ctx, 'configuraciones', 'Ver las configuraciones'), nota: 'Abrí la ficha para ver el contenido completo.' };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderFibra(ctx, q) {
  if (!ctx.veo('red', ctx.org)) return sinPermiso('la red y la fibra');
  const [tramos, ubics] = await Promise.all([ctx.listar('tramos_fibra'), ctx.listar('ubicaciones')]);
  const ub = new Map(ubics.map(u => [u.id, u]));
  const nom = (/** @type {string|null} */ id) => (id && ub.get(id) ? ub.get(id).ubicacion_nombre : '?');
  let lista = tramos.filter(t => ctx.veo('red', t.organizacion_id));
  if (!lista.length) return { grupos: [{ texto: 'No hay tramos de fibra cargados en lo que podés ver.' }], enlace: atajo(ctx, 'fibra', 'Ver la fibra') };
  const palabras = q.objeto.split(' ').filter(hay);
  if (palabras.length) {
    const txt = (/** @type {any} */ t) => normalizar([t.tramo_nombre, nom(t.tramo_origen_ubicacion_id), nom(t.tramo_destino_ubicacion_id)].join(' '));
    const todas = lista.filter(t => palabras.every(w => txt(t).includes(w)));
    lista = todas.length ? todas : lista.filter(t => palabras.some(w => txt(t).includes(w)));
    if (!lista.length) return { grupos: [{ texto: 'No encontré un tramo de fibra para «' + palabras.join(' ') + '».' }], enlace: atajo(ctx, 'fibra', 'Ver la fibra') };
  }
  const fmt = (/** @type {number} */ x) => String(x).replace('.', ',');
  const ultima = (/** @type {any} */ t) => {
    const med = Array.isArray(t.tramo_mediciones) ? t.tramo_mediciones : [];
    if (!med.length) return 'sin mediciones cargadas';
    const f = med.map((/** @type {any} */ m) => m.fecha).sort().pop();
    const deLaFecha = med.filter((/** @type {any} */ m) => m.fecha === f);
    const peor = deLaFecha.reduce((/** @type {any} */ a, /** @type {any} */ m) => (!a || m.atenuacion_db > a.atenuacion_db ? m : a), null);
    return 'última medición ' + fmtFecha(f) + ' (' + deLaFecha.length + (deLaFecha.length === 1 ? ' pelo' : ' pelos') + ', la más alta ' + fmt(peor.atenuacion_db) + ' dB en el pelo ' + peor.pelo + (peor.atenuacion_db >= ATENUACION_ALTA_DB ? ', alta' : '') + ')';
  };
  const items = lista.map(t => {
    const usados = Array.isArray(t.tramo_pelos_usados) ? t.tramo_pelos_usados.length : 0;
    return { partes: [{ t: t.tramo_nombre, href: '#/tramo/' + t.id }, { t: nom(t.tramo_origen_ubicacion_id) + ' → ' + nom(t.tramo_destino_ubicacion_id) }],
      detalle: unir(t.tramo_pelos + ' pelos (' + usados + ' en uso)', /** @type {any} */ (ROTULO_FIBRA_TIPO)[t.tramo_tipo] || t.tramo_tipo, t.tramo_conector, t.tramo_longitud_m != null ? t.tramo_longitud_m + ' m' : '', ultima(t)), orgId: t.organizacion_id };
  });
  /** @type {Grupo[]} */
  const grupos = [grupo(lista.length === 1 ? 'Encontré este tramo:' : 'Hay ' + lista.length + ' tramos de fibra:', items)];
  if (lista.length <= 2 && q.campo !== 'medicion') {
    for (const t of lista) {
      const usos = (Array.isArray(t.tramo_pelos_usados) ? t.tramo_pelos_usados : []).slice().sort((/** @type {any} */ a, /** @type {any} */ b) => a.pelo - b.pelo);
      if (usos.length) grupos.push(grupo('Qué va por ' + t.tramo_nombre + ':', usos.map((/** @type {any} */ u) => ({ partes: [{ t: 'pelo ' + u.pelo + ': ' + u.uso }], orgId: t.organizacion_id })), 12));
    }
  }
  return { grupos, enlace: atajo(ctx, 'fibra', 'Ver la fibra') };
}

/** @param {Ctx} ctx @param {Interpretacion} _q @returns {Promise<Respuesta>} */
async function responderSolicitudes(ctx, _q) {
  const paraResolver = ctx.u.usuario_perfil === 'operario' ? [] : await solicitudes.paraAprobar(ctx.u, ctx.org);
  const propias = (await solicitudes.mias(ctx.u)).filter(d => d.solicitud.solicitud_estado === 'pendiente' && (!ctx.org || d.solicitud.organizacion_id === ctx.org));
  const fila = (/** @type {import('./solicitudes.js').SolicitudDetallada} */ d, /** @type {boolean} */ conQuien) => {
    const nombreCred = d.credencial && ctx.veo('credenciales', d.credencial.organizacion_id) ? d.credencial.credencial_nombre : 'una credencial';
    return item('Pedido para ver la contraseña de ' + nombreCred, '#/solicitudes', unir(conQuien && d.solicitante ? 'pidió ' + d.solicitante.usuario_nombre : '', 'el ' + fmtFecha(d.solicitud.solicitado_en)), d.solicitud.organizacion_id);
  };
  /** @type {Grupo[]} */
  const grupos = [];
  if (ctx.u.usuario_perfil !== 'operario') grupos.push(paraResolver.length ? grupo('Tenés ' + paraResolver.length + (paraResolver.length === 1 ? ' solicitud para resolver:' : ' solicitudes para resolver:'), paraResolver.map(d => fila(d, true)), 6) : { texto: 'No tenés solicitudes pendientes para resolver.' });
  grupos.push(propias.length ? grupo('Hiciste ' + propias.length + (propias.length === 1 ? ' solicitud que sigue pendiente:' : ' solicitudes que siguen pendientes:'), propias.map(d => fila(d, false)), 6) : { texto: 'No tenés pedidos tuyos pendientes.' });
  return { grupos, enlace: { t: 'Abrir las solicitudes', href: '#/solicitudes' } };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderNavegar(ctx, q) {
  const ids = (q.tema || '').split(',').filter(hay);
  if (!ids.length) { const id = temaNavegacion(limpiar(q.objeto || '')); if (id) ids.push(id); }
  const destinos = ids.map(id => DESTINOS.find(d => d.id === id)).filter(/** @returns {x is typeof DESTINOS[number]} */ x => !!x);
  if (!destinos.length) return { grupos: [{ texto: 'No sé a qué pantalla llevarte con eso. Probá con «¿Qué puedo preguntar?» o con el nombre de la pantalla (por ejemplo, «Quiero ver los racks»).' }] };
  const permitidos = destinos.filter(d => puedeAbrir(ctx, d));
  if (!permitidos.length) return aviso('No tenés permiso para abrir ' + (destinos.length === 1 ? destinos[0].rotulo : 'esas pantallas') + '.');
  const sinOrg = permitidos.filter(d => d.org && !ctx.org);
  if (sinOrg.length === permitidos.length) return aviso('Esa pantalla es de una organización: elegí primero una arriba, en el selector de organización, y después abrí «' + permitidos[0].rotulo + '».');
  const ok = permitidos.filter(d => !(d.org && !ctx.org));
  if (q.filtro === 'alta') {
    const d = ok[0];
    if (ok.length > 1) {
      return { grupos: [{ texto: 'Según el tipo de equipo, se carga en una de estas pantallas. Usá el botón «Nuevo…» que tienen:', items: ok.map(x => item(x.rotulo, x.ruta, x.texto)) }] };
    }
    return { grupos: [{ texto: 'Se carga desde «' + d.rotulo + '». Usá el botón «Nuevo…» en esa pantalla.' }], enlace: { t: 'Abrir ' + d.rotulo, href: d.ruta } };
  }
  const d = ok[0];
  const texto = d.id === 'datos' && !puede(ctx.u, 'exportar', null, ctx.org) ? 'Ahí ves el estado de los datos del prototipo. Exportar, importar o restablecer los datos lo hace el superadmin.' : d.texto;
  return { grupos: [{ texto }], enlace: { t: 'Abrir ' + d.rotulo, href: d.ruta } };
}

/**
 * Lo que se responde cuando no se reconoce la pregunta (MI8, IA6): las preguntas previstas más parecidas, como botones,
 * completadas con lo que escribió el usuario; y debajo, la búsqueda por palabras si encuentra algo.
 * @param {Ctx} ctx @param {string} pregunta @returns {Promise<Respuesta>}
 */
async function responderNoReconocida(ctx, pregunta) {
  const parecidas = sugerirParecidas(pregunta).map(s => s.texto);
  /** @type {string[]} */
  let botones = parecidas;
  if (!botones.length) botones = [...(await sugerencias(ctx)).slice(0, 3), '¿Qué puedo preguntar?'];
  /** @type {Grupo[]} */
  const grupos = [{ texto: parecidas.length ? 'No reconocí la pregunta. ¿Quisiste preguntar…?' : 'No reconocí la pregunta. Probá con alguna de estas, o tocá «¿Qué puedo preguntar?»:', sugerencias: botones }];
  const palabras = palabrasDe(limpiar(pregunta), ['quiero', 'buscar']);
  const res = palabras.length ? await buscarFlexible(ctx, palabras) : [];
  if (res.length) {
    const items = res.map(r => item(r.titulo, ruta(r.coleccion, r), r.subtitulo, r.organizacion_id));
    grupos.push(grupo('Buscando «' + palabras.join(' ') + '» encontré ' + res.length + ' resultado' + (res.length === 1 ? '' : 's') + ':', items, 6));
  }
  return { grupos };
}

/**
 * Cámaras que coinciden con las palabras: por nombre, código, qué miran, NVR («NVR-METAL-01»), «canal N», IP, marca o modelo.
 * Un número solo coincide con una palabra entera (el 3 no es el 13 ni una parte de una IP). Sin palabras devuelve todas las que el usuario ve.
 * @param {Ctx} ctx @param {string[]} palabras @returns {Promise<any[]>}
 */
async function hallarCamaras(ctx, palabras) {
  const equipos = await ctx.listar('equipos');
  const porId = new Map(equipos.map(e => [e.id, e]));
  const visibles = equipos.filter(e => e.equipo_tipo === 'camara' && ctx.veo('red', e.organizacion_id));
  const orden = (/** @type {any} */ a, /** @type {any} */ b) => a.organizacion_id.localeCompare(b.organizacion_id)
    || String(((porId.get((a.equipo_campos || {}).camara_nvr_id) || {}).equipo_nombre) || '').localeCompare(String(((porId.get((b.equipo_campos || {}).camara_nvr_id) || {}).equipo_nombre) || ''), 'es', { numeric: true })
    || ((a.equipo_campos || {}).camara_canal || 0) - ((b.equipo_campos || {}).camara_canal || 0);
  visibles.sort(orden);
  if (!palabras.length) return visibles;
  const texto = (/** @type {any} */ e) => {
    const c = e.equipo_campos || {}, nvr = porId.get(c.camara_nvr_id);
    return normalizar([e.equipo_nombre, e.equipo_codigo, c.camara_enfoque, nvr ? nvr.equipo_nombre : '', c.camara_canal != null ? 'canal ' + c.camara_canal : '', e.equipo_ip_gestion, e.equipo_marca, e.equipo_modelo].filter(Boolean).join(' '));
  };
  const cumple = (/** @type {any} */ e, /** @type {string[]} */ pals) => { const t = texto(e), toks = t.split(/[^a-z0-9]+/).filter(Boolean); return pals.every(w => /^\d+$/.test(w) ? toks.includes(w) : t.includes(w)); };
  let r = visibles.filter(e => cumple(e, palabras));
  for (let i = palabras.length - 1; !r.length && palabras.length > 1 && i >= 0; i--) r = visibles.filter(e => cumple(e, palabras.filter((_, j) => j !== i)));
  return r;
}

/**
 * Cadena de una cámara hasta el switch que la alimenta: su puerto, y si va por una patchera, la boca y el switch del otro lado.
 * @param {any[]} puertos @param {any[]} equipos @param {any} cam
 * @returns {{camPt: any|null, patch: {eq: any, pt: any}|null, sw: {eq: any, pt: any}|null}}
 */
function switchDeCamara(puertos, equipos, cam) {
  const camPt = puertos.filter(p => p.equipo_id === cam.id).sort((a, b) => a.puerto_numero - b.puerto_numero).find(p => p.conectado_a_puerto_id) || puertos.find(p => p.equipo_id === cam.id) || null;
  let actual = camPt;
  /** @type {{eq: any, pt: any}|null} */ let patch = null;
  for (let salto = 0; actual && actual.conectado_a_puerto_id && salto < 3; salto++) {
    const pt = puertos.find(p => p.id === actual.conectado_a_puerto_id);
    const eq = pt ? equipos.find(e => e.id === pt.equipo_id) : null;
    if (!pt || !eq) break;
    if (eq.equipo_tipo === 'patchera') { patch = { eq, pt }; actual = pt.conectado_a_puerto_id === actual.id ? null : pt; continue; }
    return { camPt, patch, sw: { eq, pt } };
  }
  return { camPt, patch, sw: null };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderCamara(ctx, q) {
  if (!ctx.veo('red', ctx.org)) return sinPermiso('la red');
  const palabras = q.objeto.split(' ').filter(hay);
  const campo = q.campo || '';
  if (!palabras.length && (campo === 'ip' || campo === 'switch')) return aviso('¿De qué cámara? Por ejemplo: «¿Qué IP tiene la cámara del portón?».');
  const cams = await hallarCamaras(ctx, palabras);
  if (!cams.length) return { grupos: [{ texto: palabras.length ? 'No encontré una cámara «' + palabras.join(' ') + '» en lo que podés ver.' : 'No hay cámaras cargadas en lo que podés ver.' }], enlace: atajo(ctx, 'red', 'Ver la red') };
  const [equipos, puertos, ubics] = await Promise.all([ctx.listar('equipos'), ctx.listar('puertos'), ctx.listar('ubicaciones')]);
  const ub = new Map(ubics.map(u => [u.id, u]));
  /** @type {Item[]} */
  const items = [];
  for (const cam of cams.slice(0, 50)) {
    const c = cam.equipo_campos || {};
    const org = cam.organizacion_id;
    const nvr = c.camara_nvr_id ? equipos.find(e => e.id === c.camara_nvr_id) : null;
    const { camPt, patch, sw } = switchDeCamara(puertos, equipos, cam);
    /** @type {Parte} */
    const pCam = { t: cam.equipo_nombre, href: ruta('equipos', cam) };
    const lugar = cadenaUbicacion(ub, cam.ubicacion_id);
    /** @type {Parte} */
    const pNvr = nvr ? parteSi(ctx, 'red', org, nvr.equipo_nombre + ' (canal ' + c.camara_canal + ')', ruta('equipos', nvr)) : { t: 'sin NVR cargado' };
    /** @type {Parte} */
    const pSw = sw ? parteSi(ctx, 'red', org, sw.eq.equipo_nombre + ' › Puerto ' + sw.pt.puerto_numero, ruta('puertos', sw.pt)) : { t: 'sin conexión a un switch cargada' };
    const poe = c.camara_poe === false ? 'No usa PoE (tiene fuente propia)' : sw ? 'Se alimenta por PoE desde ese puerto' : 'Se alimenta por PoE';
    const pPatch = patch ? [parteSi(ctx, 'red', org, patch.eq.equipo_nombre + ' · boca ' + patch.pt.puerto_numero, ruta('puertos', patch.pt))] : [];
    if (campo === 'ip') items.push({ partes: [pCam], detalle: cam.equipo_ip_gestion ? 'IP ' + cam.equipo_ip_gestion + (c.camara_enfoque ? ' · mira ' + c.camara_enfoque : '') : 'No tiene una IP cargada.', orgId: org });
    else if (campo === 'switch') items.push({ partes: [pCam, ...pPatch, pSw], detalle: sw ? poe : camPt ? undefined : 'No tiene su puerto cargado.', orgId: org });
    else if (campo === 'nvr') items.push({ partes: [pCam, pNvr], detalle: unir(c.camara_enfoque ? 'mira ' + c.camara_enfoque : '', c.camara_resolucion), orgId: org });
    else {
      // «Dónde está» (MJ57): Sede › Sala → NVR (canal) → Switch › Puerto.
      /** @type {Parte[]} */
      const partes = [pCam];
      if (lugar) partes.push({ t: lugar, href: cam.ubicacion_id ? ruta('ubicaciones', { id: cam.ubicacion_id }) : undefined });
      partes.push(pNvr, ...pPatch, pSw);
      items.push({ partes, detalle: unir(c.camara_enfoque ? 'mira ' + c.camara_enfoque : '', cam.equipo_ip_gestion ? 'IP ' + cam.equipo_ip_gestion : ''), orgId: org });
    }
  }
  const titulos = /** @type {Record<string, string>} */ ({ ip: 'IP de la cámara:', switch: 'Así se conecta:', nvr: 'Se graba así:', donde: 'Esto encontré:' });
  const intro = !palabras.length ? 'Hay ' + cams.length + ' cámara(s):' : cams.length === 1 ? titulos[campo] || 'Esto encontré:' : 'Encontré ' + cams.length + ' cámaras:';
  return { grupos: [grupo(intro, items, 12)], enlace: atajo(ctx, 'red', 'Ver la red') };
}

/** @param {Ctx} ctx @param {Interpretacion} q @returns {Promise<Respuesta>} */
async function responderProveedor(ctx, q) {
  if (!ctx.veo('configuraciones', ctx.org)) return sinPermiso('los proveedores');
  const palabras = q.objeto.split(' ').filter(hay);
  const campo = q.campo || '';
  const todos = (await ctx.listar('proveedores')).filter(p => ctx.veo('configuraciones', p.organizacion_id));
  /** Si no hay un proveedor cargado con ese nombre, puede ser el de un enlace a Internet (tiene su propio número de cliente y soporte). */
  const comoInternet = async () => {
    const r = await responderInternet(ctx, { intencion: 'internet', objeto: q.objeto, campo: campo === 'cliente' || campo === 'soporte' ? campo : '' });
    return r.nota || !r.grupos.some(g => g.items && g.items.length) ? null : r;
  };
  if (!todos.length) return (await comoInternet()) || { grupos: [{ texto: 'No hay proveedores cargados en lo que podés ver.' }], enlace: atajo(ctx, 'proveedores', 'Ver los proveedores') };
  const texto = (/** @type {any} */ p) => normalizar([p.proveedor_nombre, p.proveedor_rubro, p.proveedor_comercial_nombre].filter(Boolean).join(' '));
  const lista = palabras.length ? todos.filter(p => palabras.every(w => texto(p).includes(w))) : todos;
  if (!lista.length) return (await comoInternet()) || { grupos: [{ texto: 'No encontré un proveedor «' + palabras.join(' ') + '» en lo que podés ver.' }], enlace: atajo(ctx, 'proveedores', 'Ver los proveedores') };
  lista.sort((a, b) => a.proveedor_nombre.localeCompare(b.proveedor_nombre, 'es', { numeric: true }));
  const verCred = (/** @type {any} */ p) => ctx.veo('credenciales', p.organizacion_id);
  const falta = (/** @type {string} */ rotulo, /** @type {any} */ v) => rotulo + ': ' + (v || 'no cargado');
  const items = lista.map(p => {
    /** @type {Parte[]} */
    const partes = [{ t: p.proveedor_nombre, href: ruta('proveedores', p) }];
    const soporte = unir(p.proveedor_soporte_telefono, p.proveedor_soporte_mail, p.proveedor_horario_soporte);
    /** @type {string} */
    let detalle;
    if (campo === 'soporte') detalle = 'Soporte: ' + (soporte || 'no cargado');
    else if (campo === 'cliente') detalle = falta('N.º de cliente', p.proveedor_numero_cliente);
    else if (campo === 'contrato') detalle = falta('N.º de contrato', p.proveedor_numero_contrato);
    else if (campo === 'comercial') detalle = 'Contacto comercial: ' + (unir(p.proveedor_comercial_nombre, p.proveedor_comercial_telefono, p.proveedor_comercial_mail) || 'no cargado');
    else if (campo === 'portal') detalle = falta('Portal', p.proveedor_portal_url);
    else detalle = unir(p.proveedor_rubro, soporte ? 'soporte ' + soporte : '', p.proveedor_numero_cliente ? 'cliente ' + p.proveedor_numero_cliente : '');
    return { partes, detalle, orgId: p.organizacion_id };
  });
  // El acceso al portal es una credencial: se enlaza a su ficha (la contraseña nunca se muestra).
  if (campo === 'portal') {
    const creds = await ctx.listar('credenciales');
    lista.forEach((p, i) => {
      const c = p.credencial_id && verCred(p) ? creds.find(x => x.id === p.credencial_id) : null;
      if (c) items[i].partes.push({ t: 'Credencial «' + c.credencial_nombre + '»', href: ruta('credenciales', c) });
    });
  }
  return { grupos: [grupo(lista.length === 1 ? 'Esto encontré:' : 'Encontré ' + lista.length + ' proveedores:', items)], enlace: atajo(ctx, 'proveedores', 'Ver los proveedores') };
}

/** @type {Record<Intencion, (ctx: Ctx, q: Interpretacion) => Promise<Respuesta>>} */
const RESPONDEDORES = {
  ayuda: responderAyuda, ip: responderIp, conexion: responderConexion, vence: responderVence, asignado_a: responderAsignadoA, equipos_de: responderEquiposDe,
  licencias: responderLicencias, sin_verificar: responderSinVerificar, contrasena: responderContrasena, ubicacion: responderUbicacion, rack_contenido: responderRackContenido,
  vlan_info: responderVlanInfo, vlan_de: responderVlanDe, wifi: responderWifi, internet: responderInternet, dato_equipo: responderDatoEquipo, listar_tipo: responderListarTipo,
  sin_asignar: responderSinAsignar, cuenta_de: responderCuentaDe, persona_info: responderPersonaInfo, licencias_de: responderLicenciasDe, mapeo: responderMapeo,
  servicio: responderServicio, config_doc: responderConfigDoc, fibra: responderFibra, solicitudes: responderSolicitudes, navegar: responderNavegar, camara: responderCamara, proveedor: responderProveedor
};

// ---------------------------------------------------------------------------------------------
// Opción B: IA integrada del navegador (solo traduce la pregunta a una intención)
// ---------------------------------------------------------------------------------------------

const ESQUEMA_IA = {
  type: 'object',
  properties: {
    intencion: { type: 'string', enum: [...INTENCIONES, 'ninguna'] },
    objeto: { type: 'string' },
    puesto: { type: 'string' },
    dias: { type: 'integer' },
    filtro: { type: 'string', enum: ['excedidas', 'vencidas', 'ambas'] },
    campo: { type: 'string', enum: ['', ...CAMPOS_EQUIPO.map(c => c.clave), 'gateway', 'dhcp', 'rango', 'red', 'clave', 'ip_publica', 'cliente', 'soporte', 'velocidad', 'quedan', 'instalado', 'MX', 'A', 'TXT', 'CNAME', 'NS', 'registros', 'medicion', 'ip', 'switch', 'nvr', 'donde', 'contrato', 'comercial', 'portal'] },
    tipo: { type: 'string', enum: ['', ...TIPOS_EQUIPO.map(t => t.clave), 'vpn', 'reglas', 'nat', 'wifi', 'dominio', 'dns', 'hosting', 'certificado', 'correo'] },
    letra: { type: 'string' },
    numero: { type: 'integer' },
    tema: { type: 'string', enum: ['', ...DESTINOS.map(d => d.id)] }
  },
  required: ['intencion', 'objeto'],
  additionalProperties: false
};
const INSTRUCCIONES_IA = 'Sos un clasificador de preguntas de un sistema de documentación de infraestructura de TI. Recibís una pregunta en español y devolvés solo JSON. ' +
  'Intenciones: ip (qué IP tiene un equipo; objeto = nombre o descripción del equipo), conexion (a qué puerto, boca o switch está conectado un equipo o un puesto; objeto = equipo, o puesto = número o nombre del puesto), ' +
  'vence (qué vence; dias = cantidad de días de la ventana, 0 si no se indica), asignado_a (a quién está asignado un equipo; objeto = equipo), equipos_de (qué equipos tiene una persona; objeto = nombre de la persona), ' +
  'licencias (licencias excedidas o vencidas; filtro; objeto = producto si lo nombra), sin_verificar (qué no se verificó hace más de cierto tiempo; dias = días), contrasena (contraseña, clave o cómo entrar a algo; objeto = de qué), ' +
  'ubicacion (dónde está un equipo, rack, puesto, sede o sala; objeto), rack_contenido (qué equipos hay en un rack o cuántas U libres; objeto = rack), vlan_info (datos de una VLAN: red, gateway, DHCP; numero = número de VLAN, objeto = nombre, campo = gateway|dhcp|rango|red), ' +
  'vlan_de (en qué VLAN está un equipo o puesto; objeto o puesto), wifi (redes Wi-Fi; objeto = nombre de la red; campo = clave si pregunta por la clave), internet (proveedor de Internet, IP pública, número de cliente, soporte; campo = ip_publica|cliente|soporte|velocidad|proveedor), ' +
  'dato_equipo (un dato de un equipo; objeto = equipo, campo = marca|modelo|serie|mac|so|ram|cpu|almacenamiento|virtualizacion|rol|firmware|garantia|estado|codigo), listar_tipo (listar o contar equipos de un tipo; tipo = servidor|switch|router|firewall|access_point|patchera|ups|notebook|pc|impresora|nas|reloj|hmi|balanza|nvr|computadoras), ' +
  'sin_asignar (equipos sin persona o en depósito; tipo opcional), cuenta_de (cuentas o usuario de dominio de una persona, o de quién es una cuenta; objeto), persona_info (sector o puesto de una persona, quién está en un puesto o quiénes son de un sector; objeto, puesto, campo = persona|sector|puesto), ' +
  'licencias_de (licencias de un equipo, persona o producto, dónde está instalado un producto o cuántas quedan; objeto; campo = quedan|instalado), mapeo (unidades de red de una persona o a dónde apunta una letra; objeto = persona, letra = «S:»), ' +
  'servicio (dominios, hosting, DNS, certificados, correo; objeto = dominio; tipo = dominio|dns|hosting|certificado|correo; campo = tipo de registro DNS como MX), config_doc (cómo está configurada una VPN, reglas de firewall, reenvío de puertos o documentación de algo; objeto; tipo = vpn|reglas|nat|wifi), ' +
  'camara (IP, switch y puerto, NVR y canal o ubicación de una cámara; objeto = nombre o qué mira; campo = ip|switch|nvr|donde), proveedor (teléfono de soporte, número de cliente o de contrato, contacto comercial o portal de un proveedor; objeto = proveedor; campo = soporte|cliente|contrato|comercial|portal), ' +
  'fibra (tramos de fibra, pelos, mediciones; objeto), solicitudes (solicitudes pendientes), navegar (cómo o dónde se hace algo en el sistema; tema = pantalla), ayuda (qué se puede preguntar, saludos), ninguna (cualquier otra cosa). ' +
  'No inventes datos y no respondas la pregunta: solo clasificala.';

/**
 * @param {string} pregunta
 * @returns {Promise<Interpretacion|null>}
 */
async function interpretarConIA(pregunta) {
  const LM = /** @type {any} */ (globalThis).LanguageModel;
  let sesionIA = null;
  try {
    sesionIA = await LM.create({ ...ia.OPC_IA, initialPrompts: [{ role: 'system', content: INSTRUCCIONES_IA }] });
    const salida = await Promise.race([
      sesionIA.prompt(pregunta, { responseConstraint: ESQUEMA_IA, omitResponseConstraintInput: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo')), 20000))]);
    const j = JSON.parse(String(salida));
    if (!j || !INTENCIONES.includes(j.intencion)) return null;
    const objeto = palabrasDe(limpiar(String(j.objeto || ''))).join(' ');
    const campoOk = j.campo && ESQUEMA_IA.properties.campo.enum.includes(String(j.campo)) ? String(j.campo) : undefined;
    const tipoOk = j.tipo && ESQUEMA_IA.properties.tipo.enum.includes(String(j.tipo)) ? String(j.tipo) : undefined;
    const temaOk = j.tema && DESTINOS.some(d => d.id === j.tema) ? String(j.tema) : undefined;
    return { intencion: j.intencion, objeto, puesto: j.puesto ? String(j.puesto) : undefined, dias: Number.isFinite(j.dias) && j.dias > 0 ? j.dias : undefined,
      ventana: j.dias > 0 ? j.dias + ' dias' : '', filtro: j.filtro || (j.intencion === 'licencias' ? 'ambas' : undefined), ilo: /ilo|idrac/i.test(pregunta),
      campo: campoOk, tipo: tipoOk, letra: j.letra ? String(j.letra).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1) + ':' : undefined, numero: Number.isFinite(j.numero) && j.numero > 0 ? j.numero : undefined, tema: temaOk };
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
    cont.appendChild(h('p', { text: g.texto, class: g.encabezado ? 'as-tit' : undefined }));
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
    if (g.sugerencias && g.sugerencias.length) {
      const caja = h('div', { class: 'as-sug', 'aria-label': 'Preguntas sugeridas' });
      for (const t of g.sugerencias) caja.appendChild(h('button', { type: 'button', class: 'as-chip', text: t, onclick: () => preguntar(t) }));
      cont.appendChild(caja);
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
    /** Cómo se entendió la pregunta (MI6). */
    let origen = interp ? 'Pregunta prevista' : 'Búsqueda por palabras: no reconocí la pregunta';
    if (!interp && ia.activa()) {
      interp = await interpretarConIA(q);
      origen = interp ? 'Entendida por la IA del navegador' : 'Búsqueda por palabras: ni la IA del navegador reconoció la pregunta';
    }
    const r = interp ? await RESPONDEDORES[interp.intencion](ctx, interp) : await responderNoReconocida(ctx, q);
    try {
      const conItems = r.grupos.some(g => g.items && g.items.length > 0);
      window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo: 'asistente_pregunta', detalle: { texto: q, comoSeEntendio: origen, intencion: interp ? interp.intencion : null, entendida: !!interp, conResultados: conItems } } }));
    } catch { /* las métricas nunca rompen el asistente */ }
    const nuevo = pintarRespuesta(r, ctx.orgs, !!ctx.org);
    nuevo.appendChild(h('p', { class: 'as-origen', text: origen }));
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
  for (const t of [...await sugerencias(ctx), '¿Qué puedo preguntar?']) zonaChips.appendChild(h('button', { type: 'button', class: 'as-chip', text: t, onclick: () => preguntar(t) }));
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
  ia.actualizarEstado();
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

/** Abre el panel del asistente (por ejemplo desde el indicador de IA del pie). Sin sesión no hace nada. */
export function abrirAsistente() {
  if (fab && !fab.hidden && panel && panel.hidden) abrirPanel();
  else if (panel && !panel.hidden && campo) campo.focus();
}

/** Arma el botón flotante y el panel (una sola vez) y los conecta a la sesión. */
export function iniciarAsistente() {
  if (fab) return;
  fab = h('button', { type: 'button', class: 'as-fab', 'aria-label': 'Asistente de consultas', title: 'Asistente de consultas', 'aria-expanded': 'false', 'aria-controls': 'as-panel', hidden: true }, [icono('pregunta')]);
  fab.addEventListener('click', () => { if (panel && panel.hidden) abrirPanel(); else cerrarPanel(); });

  msgs = h('div', { class: 'as-msgs', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversación' });
  zonaChips = h('div', { class: 'as-chips', 'aria-label': 'Preguntas sugeridas' });
  zonaAviso = ia.control({ clase: 'as-aviso' });
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
  // MI2: estado de la IA del navegador en el pie; al tocarlo abre el asistente, donde está el botón para descargarla.
  const pie = document.getElementById('pie');
  if (pie) pie.appendChild(ia.indicador(abrirAsistente));
}
