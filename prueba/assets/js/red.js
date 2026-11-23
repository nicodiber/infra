// @ts-check
/**
 * Lógica y componentes compartidos por las pantallas de Red (P05, P06, ficha de puesto, P11):
 * especificación de los campos fijos por tipo de equipo (modelo-de-datos.md, sección 4), formularios de edición
 * en el lugar, cabecera de ficha con verificación, mini rack, cadena switch → patchera → puesto (D-047),
 * baja en cascada y estilos propios (clases con prefijo `rd-`).
 * Datos solo con `repositorio`; permisos solo con `permisos`.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import { ir, toast, pantalla, migasRaiz, abrirModal, cerrarModal } from './marco.js';
import { h, icono, ahoraISO, fmtFecha, fmtFechaHora, indicadorVerificacion, normalizar } from './utiles.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_ESTADO_EQUIPO, CATEGORIA_RELOJ, CATEGORIA_IMPRESORA } from './modelos.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */
/** @typedef {import('./modelos.js').Equipo} Equipo */
/** @typedef {import('./modelos.js').Puerto} Puerto */

/** Tipos de equipo que aparecen en el módulo Red (los servidores tienen su propio módulo). */
export const TIPOS_RED = ['firewall', 'router', 'switch', 'patchera', 'access_point', 'ups', 'otro'];
/** Categorías de «otro» que son puestos de trabajo y no equipos de red (se ven en la ficha del puesto). */
export const CATEGORIAS_PUESTO = ['PC de escritorio', 'Notebook'];

/** @type {Object<string, string>} */
export const ROTULO_ESTADO_PUERTO = { activo: 'Con enlace', libre: 'Libre', deshabilitado: 'Deshabilitado' };
/** @type {Object<string, string>} */
export const ROTULO_SEGURIDAD = { wpa2: 'WPA2', wpa3: 'WPA3', abierta: 'Abierta', portal: 'Portal cautivo' };
/** @type {Object<string, string>} */
export const ROTULO_ENLACE_TIPO = { fibra: 'Fibra', radio: 'Radioenlace', cable: 'Cable', '4g': '4G' };

// ---------------------------------------------------------------------------------------------
// Estilos propios (los que el mockup tiene y estilos.css todavía no)
// ---------------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------------
// Contexto, rutas y utilidades de pantalla
// ---------------------------------------------------------------------------------------------

/**
 * Parámetros de la ruta actual: `#/equipo/<id>/<pestaña>/<puerto>?editar=1`.
 * @returns {{partes: string[], consulta: URLSearchParams}}
 */
export function leerRuta() {
  const crudo = location.hash.replace(/^#\/?/, '');
  const [camino, q] = crudo.split('?');
  return { partes: camino.split('/').slice(1).map(decodeURIComponent), consulta: new URLSearchParams(q || '') };
}

/**
 * @typedef {Object} Contexto
 * @property {UsuarioSesion} u
 * @property {string} org
 * @property {import('./utiles.js').Umbrales} umbrales
 * @property {Map<string, string>} nombresUsuario
 * @property {boolean} modifica
 * @property {boolean} verifica
 * @property {boolean} historial
 * @property {boolean} baja
 * @property {boolean} pideBaja
 */

/** Usuario, organización activa, umbrales y permisos del módulo Red. @returns {Promise<Contexto>} */
export async function cargarContexto() {
  const u = /** @type {UsuarioSesion} */ (sesion.usuarioActual());
  const org = /** @type {string} */ (sesion.organizacionActiva());
  const [umbrales, usuarios] = await Promise.all([repositorio.umbralesVerificacion(), repositorio.listar('usuarios')]);
  return {
    u, org, umbrales, nombresUsuario: new Map(usuarios.map(x => [x.id, x.usuario_nombre])),
    modifica: puede(u, 'modificar', 'red', org), verifica: puede(u, 'verificar', 'red', org),
    historial: puede(u, 'ver_historial', 'red', org), baja: puede(u, 'baja', 'red', org), pideBaja: puede(u, 'pedir_baja', 'red', org)
  };
}

/** Aviso de falta de permiso o de registro inexistente. @param {HTMLElement} cont @param {string} texto */
export function avisoVista(cont, texto) {
  cont.appendChild(h('div', { class: 'aviso' }, [h('div', { text: texto }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/red/equipos', text: 'Volver a Red' })])]));
}

/** Enlace interno que navega con el router. @param {string} texto @param {string} hash */
export function enlace(texto, hash) { return h('a', { text: texto, href: hash, onclick: (/** @type {Event} */ e) => { e.preventDefault(); ir(hash); } }); }

/** Campo de lectura de una ficha. @param {string} etq @param {Node|string|null|undefined} valor */
export function campo(etq, valor) {
  const v = valor == null || valor === '' ? '—' : valor;
  return h('div', { class: 'campo' }, [h('label', { text: etq }), v instanceof Node ? h('div', null, [v]) : h('div', { text: v })]);
}

/**
 * Pestañas. tabs: [clave, texto, tipo?].
 * @param {Array<[string, string, string?]>} tabs @param {string} actual @param {(k: string) => string} hashDe
 */
export function pestanas(tabs, actual, hashDe) {
  return h('div', { class: 'pestanas', role: 'tablist' }, tabs.map(t => h('button', {
    type: 'button', class: (t[0] === actual ? 'sel ' : '') + (t[2] ? 't-' + t[2] : ''), role: 'tab', 'aria-selected': t[0] === actual ? 'true' : 'false', onclick: () => ir(hashDe(t[0]))
  }, [t[2] ? h('span', { class: 'pt', 'aria-hidden': 'true' }) : null, t[1]])));
}

/** Estado del equipo con marca no solo de color. @param {string} estado */
export function estadoPill(estado) {
  return h('span', { class: 'estp ' + (estado === 'en_deposito' ? 'dep' : estado === 'baja' ? 'baja' : ''), text: ROTULO_ESTADO_EQUIPO[estado] || estado });
}

/**
 * Chips con la cantidad por estado (MJ25); filtran al tocarlos.
 * @param {Array<[string, string]>} estados pares [clave, rótulo]
 * @param {(clave: string) => number} cuenta @param {number} total @param {string} actual @param {(clave: string) => void} alElegir
 */
export function chipsEstado(estados, cuenta, total, actual, alElegir) {
  /** @param {string} clave @param {string} rotulo @param {number} n */
  const mk = (clave, rotulo, n) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(actual === clave), title: 'Filtrar por estado: ' + rotulo, onclick: () => alElegir(actual === clave ? '' : clave) }, [rotulo, h('span', { class: 'n', text: String(n) })]);
  return h('div', { class: 'chips-estado', role: 'group', 'aria-label': 'Cantidad por estado' }, [mk('', 'Todos', total)].concat(estados.map(e => mk(e[0], e[1], cuenta(e[0])))));
}

/** Encabezado + migas de una pantalla de Red. @param {HTMLElement} cont @param {string} codigo @param {string} nombre @param {Array<[string, string?]>} extra */
export async function encabezado(cont, codigo, nombre, extra) {
  const migas = await migasRaiz();
  pantalla(cont, { codigo, nombre, migas: migas.concat(extra) });
}

/** Ejecuta `fn` y, si falla, avisa en vez de romper la pantalla. @param {() => Promise<any>} fn */
export async function seguro(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast(e instanceof Error ? e.message : 'No se pudo completar la acción.'); return null; }
}

// ---------------------------------------------------------------------------------------------
// Campos fijos por tipo de equipo y formularios
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Campo
 * @property {string} k Clave.
 * @property {string} r Rótulo.
 * @property {'texto'|'entero'|'bool'|'enum'|'fecha'|'largo'|'equipo'} t `equipo`: guarda el id de un equipo y se edita con un selector (ver `opciones.equipos` de `formulario`).
 * @property {Array<[string, string]>} [op] Opciones de un enum.
 * @property {boolean} [req]
 * @property {boolean} [num] El enum guarda números.
 */

/** @param {string} k @param {string} r @param {Campo['t']} t @param {Partial<Campo>} [x] @returns {Campo} */
const C = (k, r, t, x) => ({ k, r, t, ...(x || {}) });

/** Campos comunes de un equipo editables como texto (el rack y la ubicación se editan aparte). @type {Campo[]} */
export const CAMPOS_COMUNES = [
  C('equipo_nombre', 'Nombre', 'texto', { req: true }), C('equipo_codigo', 'Código', 'texto', { req: true }), C('equipo_marca', 'Marca', 'texto'), C('equipo_modelo', 'Modelo', 'texto'),
  C('equipo_ip_gestion', 'IP de gestión', 'texto'), C('equipo_mac', 'MAC', 'texto'), C('equipo_numero_serie', 'Número de serie', 'texto'),
  C('equipo_estado', 'Estado', 'enum', { req: true, op: [['en_uso', 'En uso'], ['en_deposito', 'En depósito'], ['baja', 'Baja']] }),
  C('equipo_notas', 'Notas', 'largo')
];

/** @type {Object<string, Campo[]>} */
export const CAMPOS_POR_TIPO = {
  router: [
    C('router_firmware_version', 'Firmware', 'texto'), C('router_puertos_wan', 'Puertos WAN', 'entero', { req: true }), C('router_puertos_lan', 'Puertos LAN', 'entero', { req: true }),
    C('router_modo', 'Modo', 'enum', { req: true, op: [['ruteo', 'Ruteo'], ['bridge', 'Bridge']] }), C('router_ip_lan', 'IP en la LAN', 'texto'),
    C('router_dhcp_activo', 'Entrega DHCP', 'bool'), C('router_dns', 'DNS', 'texto'), C('router_soporta_vpn', 'Termina VPN', 'bool')],
  firewall: [
    C('firewall_firmware_version', 'Firmware', 'texto'), C('firewall_interfaces_total', 'Interfaces', 'entero', { req: true }), C('firewall_ip_lan', 'IP interna', 'texto'),
    C('firewall_alta_disponibilidad', 'Alta disponibilidad', 'enum', { req: true, op: [['ninguna', 'Ninguna'], ['activo_pasivo', 'Activo / pasivo'], ['activo_activo', 'Activo / activo']] }),
    C('firewall_throughput_mbps', 'Rendimiento (Mbps)', 'entero'), C('firewall_licencia_vence_en', 'Licencia vence', 'fecha'), C('firewall_soporta_vpn', 'Termina VPN', 'bool')],
  switch: [
    C('switch_puertos_total', 'Puertos de cobre', 'entero', { req: true }), C('switch_puertos_sfp', 'Puertos SFP / SFP+', 'entero', { req: true }),
    C('switch_administrable', 'Administrable', 'bool', { req: true }), C('switch_capa', 'Capa', 'enum', { num: true, op: [['2', '2'], ['3', '3']] }),
    C('switch_stack', 'En stack', 'bool', { req: true }), C('switch_stack_miembro', 'Miembro del stack', 'entero'), C('switch_poe', 'PoE', 'bool'),
    C('switch_poe_presupuesto_w', 'Presupuesto PoE (W)', 'entero'), C('switch_firmware_version', 'Firmware', 'texto')],
  access_point: [
    C('access_point_modo', 'Modo', 'enum', { req: true, op: [['autonomo', 'Autónomo'], ['controlado', 'Controlado'], ['mesh', 'Mesh'], ['repetidor', 'Repetidor']] }),
    C('access_point_controladora', 'Controladora', 'texto'),
    C('access_point_banda', 'Banda', 'enum', { req: true, op: [['2_4', '2,4 GHz'], ['5', '5 GHz'], ['dual', 'Dual'], ['tri', 'Tri-banda']] }),
    C('access_point_canal_2_4', 'Canal 2,4 GHz', 'texto'), C('access_point_canal_5', 'Canal 5 GHz', 'texto'),
    C('access_point_estandar', 'Estándar Wi-Fi', 'enum', { op: [['wifi5', 'Wi-Fi 5'], ['wifi6', 'Wi-Fi 6'], ['wifi6e', 'Wi-Fi 6E'], ['wifi7', 'Wi-Fi 7'], ['otro', 'Otro']] }),
    C('access_point_firmware_version', 'Firmware', 'texto')],
  patchera: [
    C('patchera_cantidad_bocas', 'Bocas', 'entero', { req: true }),
    C('patchera_categoria', 'Categoría', 'enum', { req: true, op: [['cat5e', 'Cat 5e'], ['cat6', 'Cat 6'], ['cat6a', 'Cat 6a'], ['fibra', 'Fibra']] }),
    C('patchera_conector', 'Conector', 'enum', { req: true, op: [['rj45', 'RJ45'], ['lc', 'LC'], ['sc', 'SC']] }),
    C('patchera_apantallada', 'Apantallada (STP)', 'bool'), C('patchera_rotulado', 'Rotulado', 'texto')],
  ups: [
    C('ups_potencia_va', 'Potencia (VA)', 'entero', { req: true }), C('ups_potencia_w', 'Potencia (W)', 'entero'),
    C('ups_topologia', 'Topología', 'enum', { op: [['offline', 'Offline'], ['linea_interactiva', 'Línea interactiva'], ['online', 'Online']] }),
    C('ups_autonomia_min', 'Autonomía (min)', 'entero'), C('ups_baterias_modelo', 'Modelo de batería', 'texto'), C('ups_baterias_cantidad', 'Cantidad de baterías', 'entero'),
    C('ups_baterias_cambio_en', 'Último cambio de baterías', 'fecha'), C('ups_tarjeta_red', 'Tarjeta de red', 'bool')],
  otro: [
    C('otro_categoria', 'Categoría', 'texto', { req: true }), C('otro_descripcion', 'Descripción', 'texto'), C('otro_proveedor_soporte', 'Soporte', 'texto'),
    C('otro_garantia_vence_en', 'Garantía vence', 'fecha')]
};

/** Campos de una impresora (D-072): cómo se conecta y, si es USB / local, a qué computadora. */
const CAMPOS_IMPRESORA = [
  C('impresora_conexion', 'Conexión', 'enum', { req: true, op: [['red', 'Red'], ['usb', 'USB / local']] }),
  C('impresora_pc_id', 'Computadora a la que está conectada (si es USB)', 'equipo')
];

/**
 * Campos propios de una categoría de equipo `otro` (además de los de `CAMPOS_POR_TIPO.otro`), por `otro_categoria`:
 * el reloj de control de personal (MD10-C, D-066) y las impresoras (D-072; «Impresora de red» e «Impresora» comparten campos).
 * @type {Object<string, Campo[]>}
 */
export const CAMPOS_POR_CATEGORIA = {
  [CATEGORIA_RELOJ]: [
    C('reloj_software', 'Software que lo lee', 'texto'), C('reloj_empleados', 'Empleados cargados', 'entero'),
    C('reloj_metodo', 'Método de fichada', 'enum', { req: true, op: [['huella', 'Huella'], ['tarjeta', 'Tarjeta'], ['rostro', 'Rostro'], ['pin', 'PIN']] }),
    C('reloj_pc_descarga_id', 'PC de descarga de fichadas', 'equipo')],
  [CATEGORIA_IMPRESORA]: CAMPOS_IMPRESORA,
  'Impresora': CAMPOS_IMPRESORA
};

/**
 * Todos los campos fijos de un equipo: los de su tipo y, si es `otro` con categoría con campos propios, los de la categoría.
 * (`reloj_pc_descarga_id` e `impresora_pc_id` guardan el id de un equipo: la pantalla los muestra como selector de equipos.)
 * @param {string} tipo @param {string|null} [categoria] `otro_categoria`
 * @returns {Campo[]}
 */
export function camposDe(tipo, categoria) {
  return (CAMPOS_POR_TIPO[tipo] || []).concat(tipo === 'otro' && categoria ? camposDeCategoria(categoria) : []);
}

/** Campos propios de una categoría de `otro` (sin distinguir mayúsculas). @param {string|null|undefined} categoria @returns {Campo[]} */
export function camposDeCategoria(categoria) {
  const c = String(categoria || '').trim().toLowerCase();
  if (!c) return [];
  const k = Object.keys(CAMPOS_POR_CATEGORIA).find(x => x.toLowerCase() === c);
  return k ? CAMPOS_POR_CATEGORIA[k] : [];
}

/** Texto de un valor según su campo. @param {Campo} c @param {any} v */
export function textoValor(c, v) {
  if (v == null || v === '') return '—';
  if (c.t === 'bool') return v ? 'Sí' : 'No';
  if (c.t === 'fecha') return fmtFecha(v);
  if (c.t === 'enum') { const o = (c.op || []).find(x => x[0] === String(v)); return o ? o[1] : String(v); }
  return String(v);
}

/**
 * Formulario de edición para una lista de campos. `leer()` devuelve los valores ya convertidos o los errores.
 * @param {Campo[]} campos @param {Object<string, any>} valores
 * @param {{equipos?: Array<[string, string]>}} [opciones] `equipos`: pares [id, rótulo] para los campos de tipo `equipo`.
 */
export function formulario(campos, valores, opciones) {
  /** @type {Object<string, HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>} */
  const ctl = {};
  const cont = h('div', { class: 'datos' });
  for (const c of campos) {
    const v = valores[c.k];
    /** @type {HTMLElement} */
    let e;
    if (c.t === 'bool' || c.t === 'enum') {
      const ops = c.t === 'bool' ? [['true', 'Sí'], ['false', 'No']] : (c.op || []);
      e = h('select', { 'aria-label': c.r }, [h('option', { value: '', text: c.req ? '— elegir —' : '—' })].concat(ops.map(o => h('option', { value: o[0], text: o[1] }))));
      /** @type {HTMLSelectElement} */ (e).value = v == null ? '' : String(v);
    } else if (c.t === 'equipo') {
      const ops = (opciones && opciones.equipos) || [];
      const hay = v == null || v === '' || ops.some(o => o[0] === v);
      e = h('select', { 'aria-label': c.r }, [h('option', { value: '', text: c.req ? '— elegir —' : '—' })].concat(ops.map(o => h('option', { value: o[0], text: o[1] })), hay ? [] : [h('option', { value: String(v), text: '(equipo que ya no está)' })]));
      /** @type {HTMLSelectElement} */ (e).value = v == null ? '' : String(v);
    } else if (c.t === 'largo') {
      e = h('textarea', { rows: '2', 'aria-label': c.r, style: 'width:100%' });
      /** @type {HTMLTextAreaElement} */ (e).value = v == null ? '' : String(v);
    } else {
      e = h('input', { type: c.t === 'entero' ? 'number' : c.t === 'fecha' ? 'date' : 'text', 'aria-label': c.r, min: c.t === 'entero' ? '0' : null });
      /** @type {HTMLInputElement} */ (e).value = v == null ? '' : String(v);
    }
    ctl[c.k] = /** @type {any} */ (e);
    cont.appendChild(h('div', { class: 'campo', style: c.t === 'largo' ? 'grid-column:1/-1' : null }, [h('label', { text: c.r + (c.req ? ' *' : '') }), e]));
  }
  return {
    nodo: cont,
    /** Controles por clave (para mostrar u ocultar según otro campo). */
    ctl,
    /** @returns {{valores: Object<string, any>, errores: string[]}} */
    leer() {
      /** @type {Object<string, any>} */
      const out = {};
      /** @type {string[]} */
      const errores = [];
      for (const c of campos) {
        const crudo = ctl[c.k].value.trim();
        /** @type {any} */
        let val = crudo === '' ? null : crudo;
        if (val != null) {
          if (c.t === 'entero') { val = parseInt(crudo, 10); if (!Number.isFinite(val) || val < 0) { errores.push(c.r + ': tiene que ser un número entero positivo.'); val = null; } }
          else if (c.t === 'bool') val = crudo === 'true';
          else if (c.t === 'enum' && c.num) val = Number(crudo);
        }
        if (c.req && val == null) errores.push(c.r + ' es obligatorio.');
        out[c.k] = val;
      }
      return { valores: out, errores };
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Ficha: cabecera con verificación (D-041, D-045), último cambio y mini rack (MJ27)
// ---------------------------------------------------------------------------------------------

/**
 * Último cambio registrado de un registro: «DD/MM/AAAA HH:MM · Nombre».
 * @param {Contexto} ctx @param {string} entidad @param {any} reg
 */
export async function textoUltimoCambio(ctx, entidad, reg) {
  const cs = await repositorio.listar('cambios', c => c.entidad_id === reg.id && c.cambio_entidad === entidad, { ordenarPor: 'cambio_fecha', descendente: true });
  const c = cs[0];
  if (c) return fmtFechaHora(c.cambio_fecha) + ' · ' + (ctx.nombresUsuario.get(c.usuario_id) || '—');
  return fmtFechaHora(reg.actualizado_en) + ' · ' + (ctx.nombresUsuario.get(reg.actualizado_por) || '—');
}

/**
 * Cabecera de ficha: eyebrow, título, botones, datos, pie con último cambio y verificación.
 * @param {Object} o
 * @param {Contexto} o.ctx
 * @param {string} o.tipo Clase de color (`equipo`, `vlan`…).
 * @param {string} o.etiqueta @param {string} o.titulo @param {string} [o.icono]
 * @param {Node} o.datos @param {Node[]} [o.botones] @param {boolean} [o.editando]
 * @param {any} o.registro Para la verificación. @param {string} o.coleccion @param {string} o.ultimoCambio
 * @param {Node|null} [o.minirack] @param {boolean} [o.compacta] @param {() => void} o.alConfirmar
 */
export function fichaCab(o) {
  const ctx = o.ctx;
  const cab = h('div', { class: 'fila cab-ficha rd-cab', style: 'align-items:center;margin-bottom:10px' }, [
    h('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column' }, [h('div', { class: 'eyebrow' }, [icono(o.icono || o.tipo), o.etiqueta]), h('h1', { text: o.titulo })]),
    o.editando ? h('span', { class: 'mut', text: 'Modo edición · al guardar, queda verificado hoy' }) : null,
    h('div', { class: 'herr', style: 'margin:0' }, o.botones || [])]);
  const cuerpo = h('div', { class: 'ficha-cab' }, [h('div', { class: 'ficha-datos' }, [o.datos]), o.minirack || null]);
  const r = o.registro;
  const pie = h('div', { class: 'ficha-pie' }, [
    h('span', { class: 'cambio', text: 'Último cambio: ' + o.ultimoCambio }),
    indicadorVerificacion(r.verificado_en, ctx.umbrales),
    h('span', { class: 'verif-det', text: 'Confirmó ' + (ctx.nombresUsuario.get(r.verificado_por) || '—') + ' el ' + fmtFecha(r.verificado_en) }),
    h('span', { class: 'esp' }),
    ctx.verifica
      ? h('button', { type: 'button', class: 'chico', text: 'Confirmar vigente', title: 'Confirma que lo documentado sigue siendo real. No abre ningún formulario.', onclick: async () => {
        const { confirmarConPasos } = await import('./verificacion.js');
        const ok = await seguro(() => confirmarConPasos(o.coleccion, r.id, ctx.u));
        if (ok) { toast('Confirmado como vigente · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); o.alConfirmar(); }
      } })
      : h('span', { class: 'verif-det', text: ctx.u.usuario_perfil === 'operario' ? 'Tu rol no confirma vigencia.' : 'Sin permiso para confirmar en este módulo.' })]);
  return h('div', { class: 'bloque ficha t-' + o.tipo + (o.compacta ? ' rd-compacta' : '') }, [cab, cuerpo, pie]);
}

/**
 * Mini rack que resalta las unidades del equipo y lleva al rack (MJ27).
 * @param {Equipo} e @param {any} rack
 */
export function miniRack(e, rack) {
  if (!rack || !e.rack_u_inicio || !e.rack_u_alto) return null;
  const total = rack.rack_unidades_total || 42;
  const u = e.rack_u_alto > 1 ? 'U' + e.rack_u_inicio + '–U' + (e.rack_u_inicio + e.rack_u_alto - 1) : 'U' + e.rack_u_inicio;
  const eq = h('div', { class: 'mr-eq', style: 'bottom:' + ((e.rack_u_inicio - 1) / total * 100) + '%;height:' + Math.max(e.rack_u_alto / total * 100, 3) + '%' });
  return h('a', { class: 'minirack t-equipo', href: '#/rack/' + rack.id + '?resaltar=' + e.id, title: 'Ver ' + e.equipo_nombre + ' en el rack ' + rack.rack_nombre, 'aria-label': 'Ver ' + e.equipo_nombre + ' en el rack ' + rack.rack_nombre + ', ' + u,
    onclick: (/** @type {Event} */ ev) => { ev.preventDefault(); ir('#/rack/' + rack.id + '?resaltar=' + e.id); } },
  [h('span', { text: 'Rack' }), h('div', { class: 'mr-cuerpo', 'aria-hidden': 'true' }, [eq]), h('b', { text: rack.rack_nombre + ' · ' + u })]);
}

// ---------------------------------------------------------------------------------------------
// Cadena switch → boca de patchera → puesto (MJ26, D-047)
// ---------------------------------------------------------------------------------------------

/** Hash de la ficha de un equipo según su tipo. @param {{id: string, equipo_tipo: string}} e */
export function hashEquipo(e) { return (e.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + e.id; }

/** Un nodo enlazado de la cadena. @param {string} tipo @param {string} ico @param {string} rotulo @param {string} titulo @param {string} sub @param {string} hash */
export function nodoCadena(tipo, ico, rotulo, titulo, sub, hash) {
  return h('a', { class: 'nodo t-' + tipo, href: hash, onclick: (/** @type {Event} */ e) => { e.preventDefault(); ir(hash); } },
    [h('span', { class: 'n-tipo' }, [icono(ico), rotulo]), h('b', { text: titulo }), h('span', { class: 'n-sub', text: sub })]);
}

/**
 * Nodos de la cadena de un puerto, con cada tramo enlazado a la ficha o al puerto que corresponde.
 * @param {Puerto} p @param {Equipo} e Equipo del puerto.
 * @param {{equipos: Map<string, Equipo>, puertos: Map<string, Puerto>, puestos: Map<string, any>}} m
 * @param {boolean} [vertical] @param {boolean} [invertida] Muestra el puesto primero (ficha de puesto).
 */
export function cadenaDePuerto(p, e, m, vertical, invertida) {
  /** @type {HTMLElement[]} */
  const nodos = [];
  const nodoPuerto = (/** @type {Puerto} */ q, /** @type {Equipo} */ eq) => {
    const patch = eq.equipo_tipo === 'patchera';
    return nodoCadena(eq.equipo_tipo === 'servidor' ? 'servidor' : 'equipo', patch ? 'puerto' : eq.equipo_tipo === 'servidor' ? 'servidor' : 'equipo', patch ? 'Patchera' : ROTULO_EQUIPO_TIPO[eq.equipo_tipo] || 'Equipo',
      eq.equipo_nombre + ' · ' + (patch ? 'boca ' : 'puerto ') + q.puerto_numero, q.puerto_nombre || '',
      eq.equipo_tipo === 'servidor' ? '#/servidor/' + eq.id : '#/equipo/' + eq.id + '/puertos/' + q.puerto_numero);
  };
  const otro = p.conectado_a_puerto_id ? m.puertos.get(p.conectado_a_puerto_id) : null;
  const otroEq = otro ? m.equipos.get(otro.equipo_id) : null;
  const desdePatchera = e.equipo_tipo === 'patchera';
  const puestoId = p.puesto_id || (otro && otro.puesto_id) || null;
  // Lado «de arriba»: el que no es patchera (switch, servidor…).
  if (desdePatchera) {
    if (otro && otroEq) nodos.push(nodoPuerto(otro, otroEq));
    nodos.push(nodoPuerto(p, e));
  } else {
    nodos.push(nodoPuerto(p, e));
    if (otro && otroEq) nodos.push(nodoPuerto(otro, otroEq));
    else if (p.conectado_a_descripcion) nodos.push(h('div', { class: 'nodo t-neutro' }, [h('span', { class: 'n-tipo' }, ['Destino (texto libre)']), h('b', { text: p.conectado_a_descripcion, style: 'text-decoration:none;color:var(--texto)' })]));
  }
  const pu = puestoId ? m.puestos.get(puestoId) : null;
  if (pu) nodos.push(nodoCadena('puesto', 'puesto', 'Puesto', pu.puesto_nombre, pu.puesto_boca_pared || '', '#/puesto/' + pu.id));
  if (invertida) nodos.reverse();
  const hijos = [];
  nodos.forEach((n, i) => { if (i) hijos.push(h('span', { class: 'tramo', 'aria-hidden': 'true' })); hijos.push(n); });
  return h('div', { class: 'cadena' + (vertical ? ' v' : '') + (invertida ? ' rd-inv' : ''), role: 'group', 'aria-label': 'Recorrido: ' + nodos.length + ' tramos enlazados' }, hijos);
}

// ---------------------------------------------------------------------------------------------
// Alta y baja de equipos
// ---------------------------------------------------------------------------------------------

/**
 * Campos fijos con valores por defecto razonables para un equipo nuevo.
 * @param {string} tipo
 */
export function camposIniciales(tipo) {
  /** @type {Object<string, any>} */
  const o = {};
  for (const c of CAMPOS_POR_TIPO[tipo] || []) o[c.k] = c.t === 'bool' ? (c.req ? false : null) : c.t === 'entero' ? (c.req ? 0 : null) : c.op && c.req ? c.op[0][0] : null;
  if (tipo === 'switch') Object.assign(o, { switch_puertos_total: 24, switch_puertos_sfp: 0, switch_administrable: true });
  if (tipo === 'patchera') Object.assign(o, { patchera_cantidad_bocas: 24, patchera_categoria: 'cat6', patchera_conector: 'rj45' });
  if (tipo === 'otro') o.otro_categoria = 'Sin clasificar';
  return o;
}

/**
 * Crea un equipo nuevo y abre su ficha en edición.
 * @param {Contexto} ctx @param {string} tipo @param {string} nombre
 */
export async function crearEquipo(ctx, tipo, nombre) {
  const existentes = await repositorio.listar('equipos', { organizacion_id: ctx.org });
  if (existentes.some(x => normalizar(x.equipo_nombre) === normalizar(nombre))) throw new Error('Ya hay un equipo llamado «' + nombre + '» en esta organización.');
  const nuevo = await repositorio.guardar('equipos', {
    organizacion_id: ctx.org, equipo_tipo: tipo, equipo_nombre: nombre, equipo_marca: null, equipo_modelo: null, equipo_numero_serie: null, equipo_mac: null,
    equipo_ip_gestion: null, ubicacion_id: null, rack_id: null, rack_u_inicio: null, rack_u_alto: null, puesto_id: null, equipo_estado: 'en_uso', equipo_notas: null,
    equipo_campos: camposIniciales(tipo)
  }, ctx.u.id);
  return nuevo;
}

/** Texto «Ubicación / rack» de un equipo. @param {Equipo} e @param {Map<string, any>} racks @param {Map<string, any>} ubicaciones */
export function textoUbicacion(e, racks, ubicaciones) {
  const rk = e.rack_id ? racks.get(e.rack_id) : null;
  const ub = e.ubicacion_id ? ubicaciones.get(e.ubicacion_id) : null;
  if (rk) return rk.rack_nombre + (e.rack_u_inicio ? ' · U' + e.rack_u_inicio + (e.rack_u_alto > 1 ? '–U' + (e.rack_u_inicio + e.rack_u_alto - 1) : '') : '') + (ub ? ' · ' + ub.ubicacion_nombre : '');
  return ub ? ub.ubicacion_nombre : '—';
}

/** Tabla de la antigüedad del historial: valor JSON a texto. @param {string|null} v */
export function valorHistorial(v) {
  if (v == null) return '—';
  try { const x = JSON.parse(v); if (x === true) return 'Sí'; if (x === false) return 'No'; if (x == null || x === '') return '—'; return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch (e) { return v; }
}

/**
 * El técnico pide la baja de un registro; la confirma el superadmin.
 * @param {Contexto} ctx @param {string} coleccion @param {string} id
 */
export async function pedirBaja(ctx, coleccion, id) {
  const r = await seguro(() => repositorio.crearSolicitudBaja({ coleccion, id, usuarioId: ctx.u.id }));
  if (r) toast('Baja pedida, la confirma el superadmin');
}

/**
 * Crea un puesto de trabajo nuevo (la ubicación es obligatoria) y lo devuelve.
 * @param {Contexto} ctx @param {string} nombre @param {string} ubicacionId @param {string} [boca]
 */
export async function crearPuesto(ctx, nombre, ubicacionId, boca) {
  if (!ubicacionId) throw new Error('Elegí la ubicación del puesto.');
  const existentes = await repositorio.listar('puestos', { organizacion_id: ctx.org });
  if (existentes.some(x => normalizar(x.puesto_nombre) === normalizar(nombre))) throw new Error('Ya hay un puesto llamado «' + nombre + '» en esta organización.');
  return repositorio.guardar('puestos', { organizacion_id: ctx.org, ubicacion_id: ubicacionId, puesto_nombre: nombre, puesto_boca_pared: boca || null, puesto_notas: null }, ctx.u.id);
}

// ---------------------------------------------------------------------------------------------
// Mudanzas de equipos de escritorio (D-067, MJ43)
// ---------------------------------------------------------------------------------------------

/** @param {any|null} v */
export const textoVlan = v => (v ? 'VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre : 'sin VLAN conocida');

/** Enlace que no dispara el clic de la fila. @param {string} hash @param {string} texto */
export function enlaceFila(hash, texto) {
  return h('a', { text: texto, href: hash, onclick: (/** @type {Event} */ ev) => { ev.preventDefault(); ev.stopPropagation(); ir(hash); } });
}

/**
 * Personas (con permiso de verlas) y asignaciones vigentes de la organización, para cruzar con equipos y puestos.
 * @param {Contexto} ctx
 * @returns {Promise<{ver: boolean, personas: Map<string, any>, porPuesto: Map<string, any[]>, asignadoA: Map<string, any>, asignadasA: Map<string, any[]>}>}
 *   `asignadasA`: equipo_id → todas las personas con la asignación vigente (un equipo puede ser compartido, D-072).
 *   `asignadoA`: equipo_id → la primera de ellas (compatibilidad).
 */
export async function cargarPersonas(ctx) {
  const ver = puede(ctx.u, 'ver', 'personas', ctx.org);
  /** @type {Map<string, any>} */ const personas = new Map();
  /** @type {Map<string, any[]>} */ const porPuesto = new Map();
  /** @type {Map<string, any>} */ const asignadoA = new Map();
  /** @type {Map<string, any[]>} */ const asignadasA = new Map();
  if (!ver) return { ver, personas, porPuesto, asignadoA, asignadasA };
  const [lista, asignaciones] = await Promise.all([repositorio.listar('personas', { organizacion_id: ctx.org }), repositorio.listar('asignaciones', { organizacion_id: ctx.org })]);
  for (const p of lista) {
    personas.set(p.id, p);
    if (p.puesto_id && p.persona_estado !== 'baja') { if (!porPuesto.has(p.puesto_id)) porPuesto.set(p.puesto_id, []); /** @type {any[]} */ (porPuesto.get(p.puesto_id)).push(p); }
  }
  for (const a of asignaciones.slice().sort((x, y) => (x.asignacion_desde < y.asignacion_desde ? 1 : x.asignacion_desde > y.asignacion_desde ? -1 : 0))) {
    if (a.asignacion_hasta || !personas.has(a.persona_id)) continue;
    if (!asignadasA.has(a.equipo_id)) { asignadasA.set(a.equipo_id, []); asignadoA.set(a.equipo_id, personas.get(a.persona_id)); }
    /** @type {any[]} */ (asignadasA.get(a.equipo_id)).push(personas.get(a.persona_id));
  }
  return { ver, personas, porPuesto, asignadoA, asignadasA };
}

/**
 * Modal «Mover a otro puesto»: elegir destino, avisar si cambia la VLAN y confirmar.
 * @param {Contexto} ctx @param {any} equipo @param {(r: {vlanAnterior: any, vlanNueva: any, cambiaVlan: boolean}, destino: any) => void} [alTerminar]
 */
export async function abrirMoverEquipo(ctx, equipo, alTerminar) {
  const [puestos, ubicaciones, equipos] = await Promise.all([repositorio.listar('puestos', { organizacion_id: ctx.org }), repositorio.listar('ubicaciones', { organizacion_id: ctx.org }), repositorio.listar('equipos', { organizacion_id: ctx.org })]);
  const mapaUb = new Map(ubicaciones.map(x => [x.id, x]));
  const vlans = new Map();
  for (const p of puestos) vlans.set(p.id, await repositorio.vlanDePuesto(p.id));
  const vlanActual = equipo.puesto_id ? vlans.get(equipo.puesto_id) || await repositorio.vlanDePuesto(equipo.puesto_id) : null;
  const actual = equipo.puesto_id ? puestos.find(p => p.id === equipo.puesto_id) : null;
  const ocupantes = (/** @type {string} */ id) => equipos.filter(e => e.puesto_id === id && e.id !== equipo.id);
  const candidatos = puestos.filter(p => p.id !== equipo.puesto_id).sort((a, b) => a.puesto_nombre.localeCompare(b.puesto_nombre, 'es', { numeric: true }));
  /** @type {any|null} */ let elegido = null;
  let confirmaVlan = false;
  const lista = h('div', { role: 'listbox', 'aria-label': 'Puestos de destino', style: 'max-height:240px;overflow:auto;border:1px solid var(--borde);border-radius:6px;margin-top:8px' });
  const aviso = h('div', { role: 'status', style: 'margin-top:8px' });
  const err = h('div', { class: 'rd-err', role: 'alert' });
  const q = h('input', { type: 'search', placeholder: 'Buscar por nombre, boca o ubicación…', 'aria-label': 'Buscar puesto de destino', style: 'width:100%' });
  const ok = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'primario', text: 'Mover el equipo', disabled: true }));
  const textoAviso = () => {
    aviso.textContent = ''; ok.disabled = !elegido; confirmaVlan = false; delete ok.dataset.listo; ok.textContent = 'Mover el equipo';
    if (!elegido) return;
    const vn = vlans.get(elegido.id);
    const cambia = !!(vlanActual && vn && vlanActual.id !== vn.id);
    if (cambia) {
      aviso.appendChild(h('div', { class: 'aviso', role: 'alert', text: 'El puesto nuevo está en la VLAN ' + vn.vlan_numero + ' (antes ' + vlanActual.vlan_numero + '): el equipo puede necesitar otra IP o repatchear. Si seguís, confirmá de nuevo.' }));
      ok.textContent = 'Entendido, mover igual'; confirmaVlan = true;
    } else if (!vn) aviso.appendChild(h('div', { class: 'mut', text: 'El puesto nuevo no tiene una conexión a un switch cargada, así que no podemos comparar la VLAN.' }));
    else aviso.appendChild(h('div', { class: 'mut', text: 'Misma VLAN que antes: no hace falta repatchear.' }));
  };
  const pintar = () => {
    lista.textContent = '';
    const t = normalizar(q.value);
    const f = candidatos.filter(p => !t || normalizar([p.puesto_nombre, p.puesto_boca_pared, (mapaUb.get(p.ubicacion_id) || {}).ubicacion_nombre].join(' ')).includes(t));
    if (!f.length) lista.appendChild(h('div', { class: 'mut', style: 'padding:10px', text: candidatos.length ? 'Ningún puesto coincide con la búsqueda.' : 'No hay otros puestos en esta organización. Creá uno desde la pestaña «Puestos de trabajo» de Red.' }));
    for (const p of f) {
      const oc = ocupantes(p.id).length, v = vlans.get(p.id), ub = mapaUb.get(p.ubicacion_id);
      lista.appendChild(h('button', { type: 'button', role: 'option', 'aria-selected': String(!!elegido && elegido.id === p.id), style: 'display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--borde);border-radius:0;padding:7px 10px;' + (elegido && elegido.id === p.id ? 'background:var(--acc-suave)' : ''),
        onclick: () => { elegido = p; pintar(); textoAviso(); } }, [
        h('b', { text: p.puesto_nombre }), h('span', { class: 'mut', text: ' · ' + (ub ? ub.ubicacion_nombre : 'sin ubicación') + (p.puesto_boca_pared ? ' · boca ' + p.puesto_boca_pared : '') }),
        h('div', { class: 'mut', text: (oc ? oc + (oc === 1 ? ' equipo' : ' equipos') + ' en el puesto' : 'Vacío') + ' · ' + textoVlan(v) })]));
    }
  };
  q.addEventListener('input', pintar);
  ok.addEventListener('click', async () => {
    if (!elegido) return;
    if (confirmaVlan && ok.dataset.listo !== '1') { ok.dataset.listo = '1'; ok.textContent = 'Confirmar el cambio de VLAN'; return; }
    try {
      const r = await repositorio.moverEquipoAPuesto({ equipoId: equipo.id, puestoId: elegido.id, usuarioId: ctx.u.id });
      cerrarModal();
      toast('«' + equipo.equipo_nombre + '» ahora está en ' + elegido.puesto_nombre + (r.cambiaVlan ? ' (VLAN ' + r.vlanNueva.vlan_numero + ')' : '') + '.');
      if (alTerminar) alTerminar(r, elegido);
    } catch (x) { err.textContent = x instanceof Error ? x.message : 'No se pudo mover el equipo.'; }
  });
  const asignado = (await repositorio.asignacionVigente(equipo.id));
  let quien = null;
  if (asignado && puede(ctx.u, 'ver', 'personas', ctx.org)) { const pe = await repositorio.obtener('personas', asignado.persona_id); quien = pe ? pe.persona_nombre : null; }
  abrirModal(h('div', { style: 'padding:18px 20px;width:520px', role: 'dialog', 'aria-label': 'Mover a otro puesto' }, [
    h('h2', { text: 'Mover «' + equipo.equipo_nombre + '» a otro puesto' }),
    h('p', { class: 'mut', text: 'Ahora está en: ' + (actual ? actual.puesto_nombre : 'ningún puesto') + ' · ' + textoVlan(vlanActual) + '. Se mueve el equipo, sin repatchear: se cambia solo el puesto donde está.' }),
    asignado ? h('p', { class: 'mut', text: 'La asignación' + (quien ? ' a ' + quien : '') + ' no cambia al mover el equipo. Si la persona también se muda, resolvelo en su ficha.' }) : null,
    q, lista, aviso, err,
    h('div', { class: 'herr', style: 'justify-content:flex-end;margin-top:12px' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }), ok])]));
  pintar(); q.focus();
}

// ---------------------------------------------------------------------------------------------
// IP libres y ocupadas por VLAN (IC11)
// ---------------------------------------------------------------------------------------------

/** @param {string|null|undefined} ip @returns {number|null} */
export function ipANumero(ip) {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(ip || '');
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some(x => x > 255)) return null;
  return ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}
/** @param {number} n */
export function numeroAIp(n) { return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.'); }

/**
 * IP de cada equipo de la organización que caen en la VLAN (por pertenencia a su red CIDR) y estado de cada dirección.
 * Fuentes: IP de gestión, IP LAN de router y firewall, IP de iLO/iDRAC.
 * @param {any} vlan @param {any[]} equipos
 * @returns {any}
 */
export function calcularIpsDeVlan(vlan, equipos) {
  const m = /^\s*([\d.]+)\/(\d{1,2})\s*$/.exec(vlan.vlan_red_cidr || '');
  const base0 = m ? ipANumero(m[1]) : null;
  if (!m || base0 == null || Number(m[2]) > 32) return { valida: false, cidr: vlan.vlan_red_cidr || null };
  const prefijo = Number(m[2]), tam = Math.pow(2, 32 - prefijo);
  const base = Math.floor(base0 / tam) * tam;
  const primero = prefijo >= 31 ? base : base + 1, ultimo = prefijo >= 31 ? base + tam - 1 : base + tam - 2;
  const total = ultimo - primero + 1;
  const gw = ipANumero(vlan.vlan_gateway);
  const rg = /^\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*$/.exec(vlan.vlan_dhcp_rango || '');
  const dIni = vlan.vlan_dhcp_activo && rg ? ipANumero(rg[1]) : null, dFin = rg ? ipANumero(rg[2]) : null;
  /** @type {Map<number, Array<{equipo: any, origen: string}>>} */
  const usos = new Map();
  for (const e of equipos) {
    if (e.equipo_estado === 'baja') continue;
    const c = e.equipo_campos || {};
    for (const [valor, origen] of /** @type {Array<[string|null, string]>} */ ([[e.equipo_ip_gestion, 'IP de gestión'], [c.router_ip_lan, 'IP en la LAN'], [c.firewall_ip_lan, 'IP interna'], [c.servidor_ip_ilo_idrac, 'iLO / iDRAC']])) {
      const n = ipANumero(valor);
      if (n == null || n < base || n >= base + tam) continue;
      if (!usos.has(n)) usos.set(n, []);
      /** @type {any} */ (usos.get(n)).push({ equipo: e, origen });
    }
  }
  const esDhcp = (/** @type {number} */ n) => dIni != null && dFin != null && n >= dIni && n <= dFin;
  /** @type {any[]} */ const usadas = [], duplicadas = [];
  for (const [n, l] of Array.from(usos).sort((a, b) => a[0] - b[0])) { const f = { ip: numeroAIp(n), n, usos: l }; usadas.push(f); if (new Set(l.map(x => x.equipo.id)).size > 1) duplicadas.push(f); }
  let enDhcp = 0, libres = 0, primeraLibre = null;
  for (let n = primero; n <= ultimo; n++) {
    if (usos.has(n) || n === gw) continue;
    if (esDhcp(n)) { enDhcp++; continue; }
    libres++;
    if (primeraLibre == null) primeraLibre = n;
  }
  return { valida: true, cidr: numeroAIp(base) + '/' + prefijo, prefijo, base, primero, ultimo, total, gw, usos, usadas, duplicadas, libres, enDhcp, esDhcp, siguienteLibre: primeraLibre == null ? null : numeroAIp(primeraLibre) };
}

// ---------------------------------------------------------------------------------------------
// Conectar y desconectar puertos (QC36-A: simétrico)
// ---------------------------------------------------------------------------------------------

/**
 * Conecta dos puertos por las dos puntas. Usa `repositorio.conectarPuertos` si existe; si no, versión temporal con `guardar`.
 * @param {string} puertoAId @param {string} puertoBId @param {string} usuarioId
 */
export async function conectar(puertoAId, puertoBId, usuarioId) {
  const fn = /** @type {any} */ (repositorio).conectarPuertos;
  if (typeof fn === 'function') return fn({ puertoAId, puertoBId, usuarioId });
  // Versión temporal (hasta que el núcleo la ofrezca): suelta lo anterior de las dos puntas y vincula.
  const [a, b] = await Promise.all([repositorio.obtener('puertos', puertoAId), repositorio.obtener('puertos', puertoBId)]);
  if (!a || !b) throw new Error('No se encontró alguno de los puertos.');
  if (a.id === b.id) throw new Error('Un puerto no puede conectarse consigo mismo.');
  for (const x of [a, b]) {
    if (x.conectado_a_puerto_id && x.conectado_a_puerto_id !== a.id && x.conectado_a_puerto_id !== b.id) await soltarPunta(x.conectado_a_puerto_id, x.id, usuarioId);
  }
  await repositorio.guardar('puertos', { ...a, conectado_a_puerto_id: b.id, conectado_a_equipo_id: b.equipo_id, conectado_a_descripcion: null, puerto_estado: 'activo' }, usuarioId);
  await repositorio.guardar('puertos', { ...b, conectado_a_puerto_id: a.id, conectado_a_equipo_id: a.equipo_id, conectado_a_descripcion: null, puerto_estado: 'activo' }, usuarioId);
}

/** @param {string} puertoId @param {string} comoId @param {string} usuarioId */
async function soltarPunta(puertoId, comoId, usuarioId) {
  const o = await repositorio.obtener('puertos', puertoId);
  if (o && o.conectado_a_puerto_id === comoId) await repositorio.guardar('puertos', { ...o, conectado_a_puerto_id: null, conectado_a_equipo_id: null, puerto_estado: 'libre' }, usuarioId);
}

/**
 * Desconecta un puerto y su otra punta. Usa `repositorio.desconectarPuerto` si existe; si no, versión temporal.
 * @param {string} puertoId @param {string} usuarioId
 */
export async function desconectar(puertoId, usuarioId) {
  const fn = /** @type {any} */ (repositorio).desconectarPuerto;
  if (typeof fn === 'function') return fn({ puertoId, usuarioId });
  const p = await repositorio.obtener('puertos', puertoId);
  if (!p) throw new Error('No se encontró el puerto.');
  if (p.conectado_a_puerto_id) await soltarPunta(p.conectado_a_puerto_id, p.id, usuarioId);
  await repositorio.guardar('puertos', { ...p, conectado_a_puerto_id: null, conectado_a_equipo_id: null, puerto_estado: 'libre' }, usuarioId);
}

/** ¿Está en uso un puerto (conectado a otro puerto o a un puesto)? @param {any} p */
export const puertoOcupado = p => !!(p && (p.conectado_a_puerto_id || p.puesto_id));

/**
 * Modal «Conectar a…»: elegir equipo y puerto de destino.
 * @param {Contexto} ctx @param {Equipo} e @param {Puerto} origen @param {() => void} alTerminar
 */
export async function abrirConectarPuerto(ctx, e, origen, alTerminar) {
  const [equipos, puertos] = await Promise.all([repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('puertos')]);
  const mEq = new Map(equipos.map(x => [x.id, x]));
  const mP = new Map(puertos.map(x => [x.id, x]));
  const cand = puertos.filter(p => p.id !== origen.id && mEq.has(p.equipo_id)).map(p => ({ p, eq: /** @type {Equipo} */ (mEq.get(p.equipo_id)) }))
    .sort((a, b) => a.eq.equipo_nombre.localeCompare(b.eq.equipo_nombre, 'es', { numeric: true }) || a.p.puerto_numero - b.p.puerto_numero);
  /** @type {{p: Puerto, eq: Equipo}|null} */
  let elegido = null;
  const q = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Buscar equipo o número de puerto…', 'aria-label': 'Buscar puerto de destino', style: 'width:100%' }));
  const lista = h('div', { class: 'rd-conx-lista', role: 'listbox', 'aria-label': 'Puertos de destino' });
  const aviso = h('div', { role: 'status', style: 'margin-top:8px' });
  const err = h('div', { class: 'rd-err', role: 'alert' });
  const ok = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'primario', text: 'Conectar', disabled: true }));
  const textoOcupado = (/** @type {Puerto} */ p) => {
    const o = p.conectado_a_puerto_id ? mP.get(p.conectado_a_puerto_id) : null, oe = o ? mEq.get(o.equipo_id) : null;
    return oe && o ? 'ocupado: va a ' + oe.equipo_nombre + ' · puerto ' + o.puerto_numero : p.puesto_id ? 'ocupado: va a un puesto' : 'ocupado';
  };
  const textoAviso = () => {
    aviso.textContent = ''; ok.disabled = !elegido;
    if (!elegido) return;
    if (puertoOcupado(elegido.p)) aviso.appendChild(h('div', { class: 'aviso', role: 'alert', text: 'El puerto ' + elegido.p.puerto_numero + ' de ' + elegido.eq.equipo_nombre + ' está ' + textoOcupado(elegido.p) + '. Si seguís, se desconecta de lo anterior.' }));
    if (puertoOcupado(origen)) aviso.appendChild(h('div', { class: 'aviso', role: 'alert', style: 'margin-top:6px', text: 'El puerto ' + origen.puerto_numero + ' de ' + e.equipo_nombre + ' también está ocupado: se desconecta de lo anterior.' }));
  };
  const pintar = () => {
    lista.textContent = '';
    const t = normalizar(q.value.trim());
    const f = cand.filter(x => !t || normalizar(x.eq.equipo_nombre + ' ' + x.p.puerto_numero + ' ' + (x.p.puerto_nombre || '')).includes(t)).slice(0, 80);
    if (!f.length) lista.appendChild(h('div', { class: 'mut', style: 'padding:10px', text: 'Ningún puerto coincide con la búsqueda.' }));
    for (const x of f) {
      const oc = puertoOcupado(x.p);
      lista.appendChild(h('button', { type: 'button', role: 'option', 'aria-selected': String(!!elegido && elegido.p.id === x.p.id), onclick: () => { elegido = x; pintar(); textoAviso(); } }, [
        h('b', { text: x.eq.equipo_nombre }), h('span', { text: ' · puerto ' + x.p.puerto_numero + (x.p.puerto_nombre ? ' (' + x.p.puerto_nombre + ')' : '') }),
        h('span', { class: 'mut', text: ' · ' + (oc ? textoOcupado(x.p) : 'libre') })]));
    }
  };
  q.addEventListener('input', pintar);
  ok.addEventListener('click', async () => {
    if (!elegido) return;
    const dest = elegido;
    try {
      await conectar(origen.id, dest.p.id, ctx.u.id);
      cerrarModal();
      toast('Puerto ' + origen.puerto_numero + ' de ' + e.equipo_nombre + ' conectado a ' + dest.eq.equipo_nombre + ' · puerto ' + dest.p.puerto_numero + ' (las dos puntas).');
      alTerminar();
    } catch (x) { err.textContent = x instanceof Error ? x.message : 'No se pudo conectar.'; }
  });
  abrirModal(h('div', { style: 'padding:18px 20px;width:520px', role: 'dialog', 'aria-label': 'Conectar puerto' }, [
    h('h2', { text: 'Conectar el puerto ' + origen.puerto_numero + ' de «' + e.equipo_nombre + '» a…' }),
    h('p', { class: 'mut', text: 'La conexión queda registrada en las dos puntas.' }), q, lista, aviso, err,
    h('div', { class: 'herr', style: 'justify-content:flex-end;margin-top:12px' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }), ok])]));
  pintar(); q.focus();
}

/**
 * Modal de confirmación para desconectar un puerto.
 * @param {Contexto} ctx @param {Equipo} e @param {Puerto} p @param {string} destino a qué estaba conectado @param {() => void} alTerminar
 */
export function abrirDesconectarPuerto(ctx, e, p, destino, alTerminar) {
  const err = h('div', { class: 'rd-err', role: 'alert' });
  abrirModal(h('div', { style: 'padding:18px 20px;width:460px', role: 'alertdialog', 'aria-label': 'Confirmar desconexión' }, [
    h('h2', { text: 'Desconectar el puerto ' + p.puerto_numero }),
    h('p', { text: 'El puerto ' + p.puerto_numero + ' de ' + e.equipo_nombre + (destino ? ' deja de ir a ' + destino : ' queda sin conexión') + '. Se desconecta también la otra punta y ambos puertos quedan libres.' }), err,
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      h('button', { type: 'button', class: 'primario', text: 'Sí, desconectar', onclick: async () => {
        try { await desconectar(p.id, ctx.u.id); cerrarModal(); toast('Puerto ' + p.puerto_numero + ' desconectado (las dos puntas).'); alTerminar(); }
        catch (x) { err.textContent = x instanceof Error ? x.message : 'No se pudo desconectar.'; }
      } })])]));
}
