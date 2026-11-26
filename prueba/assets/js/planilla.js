// @ts-check
/**
 * Planilla de Excel de Infradoc (D-075): la estructura de los datos en un `.xlsx`, para cargar el Excel desordenado del
 * sysadmin, para respaldo y para importar al producto final. Se genera y se lee en el navegador, sin bibliotecas:
 * un ZIP sin compresión con SpreadsheetML mínimo (escribir) y `DecompressionStream` + `DOMParser` (leer).
 * Los datos van y vienen solo por `repositorio` (`listar`, `guardar`, `conectarPuertos`, `usarSecreto`); nada sale del navegador.
 * Estructura de la planilla: docs/planilla-infradoc.md.
 */

import * as repositorio from './repositorio.js';
import { puede } from './permisos.js';
import {
  ROTULO_EQUIPO_TIPO, ROTULO_ESTADO_EQUIPO, ROTULO_CREDENCIAL_TIPO, ROTULO_LICENCIA_TIPO, ROTULO_PERSONA_ESTADO, ROTULO_CUENTA_ESTADO,
  ROTULO_MAPEO_APLICA_A, ROTULO_MAPEO_METODO, ROTULO_CONFIGURACION_TIPO, ROTULO_SERVICIO_TIPO, ROTULO_FIBRA_TIPO, CONECTORES_FIBRA,
  TIPOS_REGISTRO_DNS, CATEGORIA_RELOJ, CATEGORIA_IMPRESORA, ENTIDAD_DE_COLECCION, COLECCION_DE_ENTIDAD, esImpresora, moduloDeEntidad
} from './modelos.js';
import { CAMPOS_POR_TIPO, CAMPOS_POR_CATEGORIA, ROTULO_ENLACE_TIPO, ROTULO_SEGURIDAD, ROTULO_ESTADO_PUERTO } from './red.js';
import { hoyISO } from './utiles.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */

/** @typedef {Object} Col
 * @property {string} k Clave del campo (va entre paréntesis en el encabezado).
 * @property {string} r Rótulo legible.
 * @property {string} t texto|largo|entero|numero|fecha|bool|enum|ref|lista|listaRef|json|pelos|mediciones|refDin
 * @property {boolean} [req]
 * @property {Array<[string, string]>} [op] Opciones de un enum: [clave, rótulo].
 * @property {boolean} [num] El enum guarda números.
 * @property {string} [ref] Colección a la que apunta una referencia.
 * @property {any} [def] Valor al crear si queda vacío.
 * @property {boolean} [campo] Va dentro de `equipo_campos`.
 * @property {boolean} [virtual] No es un campo del registro (se usa para ubicar o conectar).
 * @property {boolean} [secreto] Contraseña: solo la exporta el superadmin con la casilla.
 * @property {string} [ayuda]
 * @property {(e: any) => boolean} [aplica] Solo campos de equipo: si corresponde al tipo/categoría.
 * @property {string} [segun] En `refDin`: la columna que dice a qué tipo de ficha apunta.
 * @property {string[]} [alias] Rótulos anteriores de la columna: se siguen reconociendo al importar planillas viejas.
 */

/** @typedef {Object} Hoja
 * @property {string} id
 * @property {string} nombre Nombre de la hoja (máx. 31 caracteres).
 * @property {string} col Colección del repositorio ('' si no tiene una propia).
 * @property {string} desc Qué carga.
 * @property {Col[]} cols
 * @property {string[]} claveCols Columnas que identifican un registro cuando no hay `id`.
 * @property {boolean} [sinOrg] La hoja no tiene columna Organización.
 * @property {Object<string, any>} ejemplo Fila de ejemplo ficticia (valores como se ven en la planilla).
 * @property {boolean} [dns] Hoja de registros DNS (agrega registros a un servicio).
 * @property {string[]} [alias] Nombres anteriores de la hoja: se siguen reconociendo al importar planillas viejas.
 */

// ---------------------------------------------------------------------------------------------
// Definición de la planilla
// ---------------------------------------------------------------------------------------------

/** @param {string} k @param {string} r @param {string} t @param {Partial<Col>} [x] @returns {Col} */
const C = (k, r, t, x) => ({ k, r, t, ...(x || {}) });
/** @param {Object<string, string>} o @returns {Array<[string, string]>} */
const pares = o => /** @type {Array<[string, string]>} */ (Object.entries(o));

const ORG = C('organizacion_id', 'Organización', 'ref', { ref: 'organizaciones', req: true, ayuda: 'Nombre de la organización (hoja Organizaciones).' });
const NOTAS = (k = 'notas') => C(k, 'Notas', 'largo');

/** Nombre de la entidad → rótulo, para las notas colgadas de una ficha. */
const FICHAS_NOTA = /** @type {Array<[string, string]>} */ ([
  ['Ubicacion', 'Sede / sala'], ['Rack', 'Rack'], ['Equipo', 'Equipo'], ['Puesto', 'Puesto'], ['Vlan', 'VLAN'], ['RedWifi', 'Red Wi-Fi'],
  ['EnlaceIsp', 'Enlace a Internet'], ['Configuracion', 'Configuración'], ['Credencial', 'Credencial'], ['Persona', 'Persona'],
  ['CuentaDominio', 'Cuenta de dominio'], ['Licencia', 'Licencia'], ['MapeoDisco', 'Mapeo de disco'], ['Servicio', 'Servicio'], ['TramoFibra', 'Tramo de fibra']
]);

/** Campos de un servidor (docs/modelo-de-datos.md, 4.5): los servidores no están en `CAMPOS_POR_TIPO`. @type {Array<{k: string, r: string, t: string, req?: boolean, op?: Array<[string, string]>}>} */
const CAMPOS_SERVIDOR = [
  { k: 'servidor_rol', r: 'Rol', t: 'texto', req: true }, { k: 'servidor_sistema_operativo', r: 'Sistema operativo', t: 'texto', req: true },
  { k: 'servidor_cpu', r: 'Procesador', t: 'texto' }, { k: 'servidor_ram_gb', r: 'RAM (GB)', t: 'entero' }, { k: 'servidor_almacenamiento', r: 'Almacenamiento', t: 'texto' },
  { k: 'servidor_virtualizacion', r: 'Virtualización', t: 'enum', req: true, op: [['ninguna', 'Ninguna'], ['vmware', 'VMware'], ['hyperv', 'Hyper-V'], ['proxmox', 'Proxmox'], ['kvm', 'KVM'], ['otra', 'Otra']] },
  { k: 'servidor_ip_ilo_idrac', r: 'IP de iLO / iDRAC', t: 'texto' }, { k: 'servidor_garantia_vence_en', r: 'Garantía vence', t: 'fecha' }
];

/** @param {any} e @param {string} categoria */
const esCategoria = (e, categoria) => e.equipo_tipo === 'otro' && nrm((e.equipo_campos || {}).otro_categoria) === nrm(categoria);

/** Columnas de los campos fijos por tipo y categoría: una por clave, con el tipo como prefijo del rótulo. @returns {Col[]} */
function columnasCampos() {
  /** @type {Col[]} */
  const out = [];
  /** @param {any} c @param {string} grupo @param {(e: any) => boolean} aplica */
  const conv = (c, grupo, aplica) => {
    const t = c.t === 'equipo' ? 'ref' : c.t;
    out.push(C(c.k, grupo + ' · ' + c.r, t, { req: !!c.req, op: c.op, num: c.num, ref: c.t === 'equipo' ? 'equipos' : undefined, campo: true, aplica }));
  };
  for (const [tipo, etq] of /** @type {Array<[string, string]>} */ ([['router', 'Router'], ['firewall', 'Firewall'], ['switch', 'Switch'], ['access_point', 'Access point'], ['servidor', 'Servidor'], ['patchera', 'Patchera'], ['ups', 'UPS'], ['otro', 'Otro']])) {
    const lista = tipo === 'servidor' ? CAMPOS_SERVIDOR : (CAMPOS_POR_TIPO[tipo] || []);
    for (const c of lista) conv(c, etq, e => e.equipo_tipo === tipo);
    if (tipo === 'servidor') out.push(C('host_id', 'Servidor · Host (si es máquina virtual)', 'ref', { ref: 'equipos', campo: true, aplica: e => e.equipo_tipo === 'servidor' }));
  }
  for (const c of CAMPOS_POR_CATEGORIA[CATEGORIA_RELOJ] || []) conv(c, 'Reloj', e => esCategoria(e, CATEGORIA_RELOJ));
  for (const c of CAMPOS_POR_CATEGORIA[CATEGORIA_IMPRESORA] || []) conv(c, 'Impresora', e => esImpresora(e));
  return out;
}

/** @type {Hoja[]} Hojas en el orden de carga recomendado. */
export const ESQUEMA = [
  { id: 'organizaciones', nombre: 'Organizaciones', col: 'organizaciones', sinOrg: true, desc: 'Los clientes del administrador. Es la primera hoja: todo lo demás cuelga de una organización.',
    claveCols: ['organizacion_nombre'],
    cols: [C('organizacion_nombre', 'Nombre', 'texto', { req: true }), C('organizacion_rubro', 'Rubro', 'texto'), C('organizacion_cuit', 'CUIT', 'texto'), NOTAS('organizacion_notas'),
      C('organizacion_estado', 'Estado', 'enum', { req: true, def: 'activa', op: [['activa', 'Activa'], ['inactiva', 'Inactiva']] })],
    ejemplo: { organizacion_nombre: 'Organización Ejemplo S.A.', organizacion_rubro: 'Servicios', organizacion_cuit: '30-00000000-0', organizacion_estado: 'Activa' } },
  { id: 'ubicaciones', nombre: 'Sedes y salas', alias: ['Ubicaciones'], col: 'ubicaciones', desc: 'Sedes y salas (D-081). Una sede pertenece a la organización; una sala pertenece a una sede (columna «Sede (para salas)»). Una sala sin sede indicada queda en la sede provisoria «Sin sede».',
    claveCols: ['ubicacion_nombre', 'ubicacion_padre_id'],
    cols: [ORG, C('ubicacion_nombre', 'Nombre', 'texto', { req: true }),
      C('ubicacion_tipo', 'Tipo', 'enum', { req: true, op: [['sede', 'Sede'], ['sala', 'Sala']] }),
      C('ubicacion_padre_id', 'Sede (para salas)', 'ref', { ref: 'ubicaciones', alias: ['Ubicación superior'], ayuda: 'Solo en las salas: la sede a la que pertenecen (vacía en las sedes). Si no existe, se crea. Si hay dos con el mismo nombre, escribí «Sede / Sala».' }),
      C('ubicacion_direccion', 'Dirección', 'texto'), C('ubicacion_notas', 'Notas', 'largo')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', ubicacion_nombre: 'Sala de servidores', ubicacion_tipo: 'Sala', ubicacion_padre_id: 'Sede central', ubicacion_direccion: '' } },
  { id: 'racks', nombre: 'Racks', col: 'racks', desc: 'Gabinetes. Los equipos se montan en un rack indicando la U inicial y cuántas U ocupan (hoja Equipos).',
    claveCols: ['rack_nombre'],
    cols: [ORG, C('rack_nombre', 'Nombre', 'texto', { req: true }), C('ubicacion_id', 'Sede / sala', 'ref', { ref: 'ubicaciones', req: true, alias: ['Ubicación'], ayuda: 'Sede o sala donde está. Si no existe, se crea.' }),
      C('rack_unidades_total', 'Unidades (U) totales', 'entero', { req: true }), C('rack_profundidad', 'Profundidad útil (mm)', 'entero'), NOTAS('rack_notas')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', rack_nombre: 'RACK-EJ-01', ubicacion_id: 'Sala de servidores', rack_unidades_total: 42, rack_profundidad: 800 } },
  { id: 'equipos', nombre: 'Equipos', col: 'equipos', desc: 'Todo lo físico: routers, firewalls, switches, access points, servidores, patcheras, UPS y «otro» (PC, notebook, impresora, reloj, NAS…). Las columnas con el nombre del tipo por delante («Switch · Capa») solo se completan para ese tipo.',
    claveCols: ['equipo_nombre'],
    cols: [ORG, C('equipo_tipo', 'Tipo', 'enum', { req: true, op: pares(ROTULO_EQUIPO_TIPO), ayuda: 'No se puede cambiar después de creado.' }),
      C('equipo_nombre', 'Nombre', 'texto', { req: true }), C('equipo_codigo', 'Código', 'texto', { ayuda: 'Vacío al crear: se genera solo (por ejemplo AGR-SW-001).' }),
      C('equipo_marca', 'Marca', 'texto'), C('equipo_modelo', 'Modelo', 'texto'), C('equipo_numero_serie', 'N.º de serie', 'texto'), C('equipo_mac', 'MAC', 'texto'), C('equipo_ip_gestion', 'IP de gestión', 'texto'),
      C('equipo_estado', 'Estado', 'enum', { req: true, def: 'en_uso', op: pares(ROTULO_ESTADO_EQUIPO) }),
      C('ubicacion_id', 'Sede / sala', 'ref', { ref: 'ubicaciones', alias: ['Ubicación'], ayuda: 'Si está en un rack, es la del rack.' }), C('rack_id', 'Rack', 'ref', { ref: 'racks', ayuda: 'Si el rack no existe, se crea (de 42 U).' }),
      C('rack_u_inicio', 'Posición (U)', 'entero', { alias: ['U inicial en el rack'], ayuda: 'U inicial en el rack; 1 = la de abajo. Obligatoria si hay rack.' }), C('rack_u_alto', 'U que ocupa', 'entero', { ayuda: 'Obligatoria si hay rack.' }),
      C('puesto_id', 'Puesto', 'ref', { ref: 'puestos', ayuda: 'Dónde está un equipo de escritorio (PC, impresora, reloj).' }), NOTAS('equipo_notas'), ...columnasCampos()],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', equipo_tipo: 'Switch', equipo_nombre: 'SW-EJ-01', equipo_marca: 'Marca Demo', equipo_modelo: 'Modelo-24', equipo_ip_gestion: '10.0.0.2', equipo_estado: 'En uso',
      rack_id: 'RACK-EJ-01', rack_u_inicio: 20, rack_u_alto: 1, switch_puertos_total: 24, switch_puertos_sfp: 2, switch_administrable: 'Sí', switch_stack: 'No' } },
  { id: 'puertos', nombre: 'Puertos y conexiones', col: 'puertos', desc: 'Una fila por puerto de un equipo. La conexión con otro equipo se indica con el equipo y el número del puerto del otro lado (basta una de las dos puntas).',
    claveCols: ['equipo_id', 'puerto_numero'],
    cols: [C('organizacion_id', 'Organización', 'ref', { ref: 'organizaciones', req: true, virtual: true, ayuda: 'Organización del equipo (sirve para ubicarlo por nombre).' }),
      C('equipo_id', 'Equipo', 'ref', { ref: 'equipos', req: true }), C('puerto_numero', 'N.º de puerto', 'entero', { req: true }), C('puerto_nombre', 'Nombre o etiqueta', 'texto'),
      C('puerto_tipo', 'Conector', 'enum', { req: true, def: 'rj45', op: [['rj45', 'RJ45'], ['sfp', 'SFP'], ['sfp_plus', 'SFP+']] }), C('puerto_velocidad', 'Velocidad', 'texto'),
      C('puerto_modo', 'Modo', 'enum', { op: [['acceso', 'Acceso'], ['troncal', 'Troncal']], ayuda: 'En puertos de switch.' }),
      C('vlan_nativa_id', 'VLAN nativa', 'ref', { ref: 'vlans' }), C('vlans_etiquetadas', 'VLAN etiquetadas', 'listaRef', { ref: 'vlans', ayuda: 'Solo en troncales.' }),
      C('conectado_a_equipo_id', 'Conectado a: equipo', 'ref', { ref: 'equipos', virtual: true }), C('conectado_a_puerto_numero', 'Conectado a: n.º de puerto', 'entero', { virtual: true }),
      C('conectado_a_descripcion', 'Conectado a (texto libre)', 'texto', { ayuda: 'Solo si el otro lado no está cargado como equipo.' }),
      C('enlace_isp_id', 'Enlace a Internet', 'ref', { ref: 'enlaces_isp', ayuda: 'Solo puertos de router o firewall.' }),
      C('puesto_id', 'Puesto (boca de pared)', 'ref', { ref: 'puestos', ayuda: 'Solo bocas de patchera: a qué puesto llega.' }),
      C('puerto_estado', 'Estado', 'enum', { req: true, def: 'libre', op: pares(ROTULO_ESTADO_PUERTO) }), NOTAS('puerto_notas')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', equipo_id: 'SW-EJ-01', puerto_numero: 1, puerto_nombre: 'Gi1/0/1', puerto_tipo: 'RJ45', puerto_velocidad: '1 Gbps', puerto_modo: 'Acceso', vlan_nativa_id: '10 - Administración', puerto_estado: 'Con enlace' } },
  { id: 'vlans', nombre: 'VLAN', col: 'vlans', desc: 'Redes virtuales. El número es único por organización.',
    claveCols: ['vlan_numero'],
    cols: [ORG, C('vlan_numero', 'Número (1–4094)', 'entero', { req: true }), C('vlan_nombre', 'Nombre', 'texto', { req: true }), C('vlan_red_cidr', 'Red (CIDR)', 'texto'), C('vlan_gateway', 'Puerta de enlace', 'texto'),
      C('vlan_dhcp_activo', 'DHCP activo', 'bool', { req: true, def: false }), C('vlan_dhcp_rango', 'Rango DHCP', 'texto', { ayuda: 'Obligatorio si hay DHCP.' }), C('vlan_descripcion', 'Descripción', 'largo')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', vlan_numero: 10, vlan_nombre: 'Administración', vlan_red_cidr: '10.0.10.0/24', vlan_gateway: '10.0.10.1', vlan_dhcp_activo: 'Sí', vlan_dhcp_rango: '10.0.10.100 - 10.0.10.200' } },
  { id: 'wifi', nombre: 'Redes Wi-Fi', col: 'redes_wifi', desc: 'Redes inalámbricas (SSID). La contraseña va como credencial (hoja Credenciales).',
    claveCols: ['wifi_ssid'],
    cols: [ORG, C('wifi_ssid', 'SSID', 'texto', { req: true }), C('vlan_id', 'VLAN', 'ref', { ref: 'vlans' }),
      C('wifi_seguridad', 'Seguridad', 'enum', { req: true, def: 'wpa2', op: pares(ROTULO_SEGURIDAD) }), C('credencial_id', 'Credencial con la clave', 'ref', { ref: 'credenciales' }),
      C('wifi_oculta', 'SSID oculto', 'bool', { req: true, def: false }), C('access_point_ids', 'Access points que la emiten', 'listaRef', { ref: 'equipos', ayuda: 'Equipos de tipo access point, separados por «;».' })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', wifi_ssid: 'Ejemplo-Interna', vlan_id: '10 - Administración', wifi_seguridad: 'WPA2', wifi_oculta: 'No' } },
  { id: 'enlaces', nombre: 'Enlaces ISP', col: 'enlaces_isp', desc: 'Conexiones a Internet contratadas. Como máximo un enlace principal por organización.',
    claveCols: ['enlace_proveedor', 'enlace_tipo', 'enlace_numero_cliente'],
    cols: [ORG, C('enlace_proveedor', 'Proveedor', 'texto', { req: true }), C('enlace_tipo', 'Medio', 'enum', { req: true, op: pares(ROTULO_ENLACE_TIPO) }),
      C('enlace_velocidad_bajada_mbps', 'Bajada (Mbps)', 'entero'), C('enlace_velocidad_subida_mbps', 'Subida (Mbps)', 'entero'), C('enlace_ip_publica', 'IP pública', 'texto'),
      C('enlace_tipo_ip', 'Tipo de IP', 'enum', { op: [['fija', 'Fija'], ['dinamica', 'Dinámica']] }), C('equipo_id', 'Router o firewall donde termina', 'ref', { ref: 'equipos' }),
      C('enlace_numero_cliente', 'N.º de cliente / servicio', 'texto'), C('enlace_telefono_soporte', 'Teléfono de soporte', 'texto'), C('enlace_es_principal', 'Es el principal', 'bool', { req: true, def: false })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', enlace_proveedor: 'Proveedor Demo', enlace_tipo: 'Fibra', enlace_velocidad_bajada_mbps: 300, enlace_velocidad_subida_mbps: 100, enlace_ip_publica: '203.0.113.10', enlace_tipo_ip: 'Fija', enlace_es_principal: 'Sí' } },
  { id: 'puestos', nombre: 'Puestos', col: 'puestos', desc: 'Lugares de trabajo con su boca de pared.',
    claveCols: ['puesto_nombre', 'ubicacion_id'],
    cols: [ORG, C('puesto_nombre', 'Nombre', 'texto', { req: true }), C('ubicacion_id', 'Sede / sala', 'ref', { ref: 'ubicaciones', req: true, alias: ['Ubicación'], ayuda: 'Sede o sala donde está. Si no existe, se crea.' }), C('puesto_boca_pared', 'Boca de pared', 'texto'), NOTAS('puesto_notas')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', puesto_nombre: 'Puesto 01 · Administración', ubicacion_id: 'Sala de servidores', puesto_boca_pared: 'B-001' } },
  { id: 'personas', nombre: 'Personas', col: 'personas', desc: 'Personas de la organización (no son usuarios de Infradoc).',
    claveCols: ['persona_nombre'],
    cols: [ORG, C('persona_nombre', 'Nombre y apellido', 'texto', { req: true }), C('persona_sector', 'Sector', 'texto'), C('puesto_id', 'Puesto habitual', 'ref', { ref: 'puestos' }),
      C('persona_estado', 'Estado', 'enum', { req: true, def: 'activa', op: pares(ROTULO_PERSONA_ESTADO) }), NOTAS('persona_notas')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', persona_nombre: 'Ana Ejemplo', persona_sector: 'Administración', puesto_id: 'Puesto 01 · Administración', persona_estado: 'Activa' } },
  { id: 'cuentas', nombre: 'Cuentas de dominio', col: 'cuentas_dominio', desc: 'Usuarios del dominio. Sin persona = cuenta de servicio. La contraseña, si se guarda, va como credencial.',
    claveCols: ['cuenta_dominio', 'cuenta_usuario'],
    cols: [ORG, C('persona_id', 'Persona', 'ref', { ref: 'personas', ayuda: 'Vacío = cuenta de servicio.' }), C('cuenta_usuario', 'Usuario', 'texto', { req: true }), C('cuenta_dominio', 'Dominio', 'texto', { req: true }),
      C('cuenta_unidad_organizativa', 'Unidad organizativa', 'texto'), C('cuenta_grupos', 'Grupos', 'lista', { ayuda: 'Separados por «;».' }),
      C('cuenta_estado', 'Estado', 'enum', { req: true, def: 'habilitada', op: pares(ROTULO_CUENTA_ESTADO) }), C('credencial_id', 'Credencial con la contraseña', 'ref', { ref: 'credenciales' })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', persona_id: 'Ana Ejemplo', cuenta_usuario: 'aejemplo', cuenta_dominio: 'EJEMPLO', cuenta_grupos: 'Usuarios del dominio; GG-Administracion', cuenta_estado: 'Habilitada' } },
  { id: 'asignaciones', nombre: 'Asignaciones', col: 'asignaciones', desc: 'Qué equipo tiene (o tuvo) cada persona. Sin fecha de fin = lo tiene hoy. Un equipo puede estar compartido por varias personas.',
    claveCols: ['equipo_id', 'persona_id', 'asignacion_desde'],
    cols: [ORG, C('equipo_id', 'Equipo', 'ref', { ref: 'equipos', req: true }), C('persona_id', 'Persona', 'ref', { ref: 'personas', req: true }), C('asignacion_desde', 'Desde', 'fecha', { req: true }),
      C('asignacion_hasta', 'Hasta', 'fecha', { ayuda: 'Vacío = lo tiene hoy.' }), C('asignacion_motivo', 'Motivo', 'texto'), C('asignacion_observaciones', 'Observaciones', 'largo')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', equipo_id: 'PC-EJ-01', persona_id: 'Ana Ejemplo', asignacion_desde: '02/03/2026', asignacion_motivo: 'Equipo nuevo' } },
  { id: 'configuraciones', nombre: 'Configuraciones', col: 'configuraciones', desc: 'Configuraciones de equipos o generales (VPN, NAT, reglas de firewall…). Sin contraseñas.',
    claveCols: ['equipo_id', 'configuracion_titulo'],
    cols: [ORG, C('equipo_id', 'Equipo', 'ref', { ref: 'equipos' }), C('configuracion_tipo', 'Tipo', 'enum', { req: true, op: pares(ROTULO_CONFIGURACION_TIPO) }),
      C('configuracion_titulo', 'Título', 'texto', { req: true }), C('configuracion_contenido', 'Contenido', 'largo', { req: true, ayuda: 'Nunca contraseñas: usá una credencial.' }),
      C('configuracion_datos', 'Datos estructurados (JSON)', 'json', { ayuda: 'Solo reenvío de puertos; podés dejarlo vacío.' }), C('configuracion_version_fecha', 'Fecha de la versión', 'fecha'), NOTAS('configuracion_notas')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', equipo_id: 'SW-EJ-01', configuracion_tipo: 'General', configuracion_titulo: 'Configuración de SW-EJ-01', configuracion_contenido: 'hostname SW-EJ-01' } },
  { id: 'mapeos', nombre: 'Mapeos de discos', col: 'mapeos_disco', desc: 'Unidades de red que se mapean a los usuarios.',
    claveCols: ['mapeo_letra', 'mapeo_ruta'],
    cols: [ORG, C('mapeo_letra', 'Letra de unidad', 'texto', { req: true }), C('mapeo_ruta', 'Ruta de red', 'texto', { req: true }), C('equipo_id', 'Servidor que lo comparte', 'ref', { ref: 'equipos', ayuda: 'Equipo de tipo servidor.' }),
      C('mapeo_aplica_a', 'Se aplica a', 'enum', { req: true, def: 'todos', op: pares(ROTULO_MAPEO_APLICA_A) }), C('mapeo_grupo', 'Grupo', 'texto', { ayuda: 'Solo si se aplica a un grupo.' }),
      C('persona_id', 'Persona', 'ref', { ref: 'personas', ayuda: 'Solo si se aplica a una persona.' }), C('mapeo_metodo', 'Cómo se aplica', 'enum', { req: true, def: 'manual', op: pares(ROTULO_MAPEO_METODO) })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', mapeo_letra: 'P:', mapeo_ruta: '\\\\SRV-EJ-01\\Compras', equipo_id: 'SRV-EJ-01', mapeo_aplica_a: 'Un grupo', mapeo_grupo: 'GG-Compras', mapeo_metodo: 'Directiva de grupo' } },
  { id: 'credenciales', nombre: 'Credenciales', col: 'credenciales', desc: 'Accesos (iLO, routers, VPN, Wi-Fi, dominio, hosting…). La contraseña NO se exporta salvo que el superadmin lo pida; en el prototipo no se recomienda cargar contraseñas reales.',
    claveCols: ['credencial_nombre', 'credencial_tipo'],
    cols: [ORG, C('credencial_tipo', 'Tipo', 'enum', { req: true, op: pares(ROTULO_CREDENCIAL_TIPO) }), C('credencial_nombre', 'Nombre', 'texto', { req: true }), C('credencial_usuario', 'Usuario', 'texto'),
      C('credencial_secreto', 'Contraseña', 'texto', { secreto: true, ayuda: 'Vacía = no se cambia. Queda sin cifrar en este navegador.' }), C('credencial_url_o_host', 'URL o host', 'texto'),
      C('equipo_id', 'Equipo', 'ref', { ref: 'equipos' }), C('configuracion_id', 'Configuración', 'ref', { ref: 'configuraciones' }), NOTAS('credencial_notas'), C('credencial_vence_en', 'Vence', 'fecha')],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', credencial_tipo: 'Switch', credencial_nombre: 'Switch SW-EJ-01', credencial_usuario: 'admin', credencial_url_o_host: '10.0.0.2', equipo_id: 'SW-EJ-01' } },
  { id: 'licencias', nombre: 'Licencias', col: 'licencias', desc: 'Licencias de software. La clave va como credencial de tipo «Clave de licencia».',
    claveCols: ['licencia_producto', 'licencia_tipo'],
    cols: [ORG, C('licencia_producto', 'Producto y edición', 'texto', { req: true }), C('licencia_tipo', 'Tipo', 'enum', { req: true, op: pares(ROTULO_LICENCIA_TIPO) }),
      C('licencia_cantidad', 'Cantidad', 'entero', { req: true, def: 1 }), C('licencia_vence_en', 'Vence', 'fecha', { ayuda: 'Vacío en las perpetuas.' }), C('licencia_proveedor', 'Proveedor', 'texto'),
      C('credencial_id', 'Credencial con la clave', 'ref', { ref: 'credenciales' })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', licencia_producto: 'Microsoft 365 Business Standard', licencia_tipo: 'Suscripción', licencia_cantidad: 10, licencia_vence_en: '31/12/2026' } },
  { id: 'instalaciones', nombre: 'Instalaciones', col: 'instalaciones_licencia', desc: 'En qué equipo está instalada cada licencia (y con qué cuenta o persona).',
    claveCols: ['licencia_id', 'equipo_id', 'instalacion_desde'],
    cols: [ORG, C('licencia_id', 'Licencia', 'ref', { ref: 'licencias', req: true }), C('equipo_id', 'Equipo', 'ref', { ref: 'equipos', req: true }), C('cuenta_id', 'Cuenta de dominio', 'ref', { ref: 'cuentas_dominio', ayuda: 'Formato DOMINIO\\usuario.' }),
      C('persona_id', 'Persona', 'ref', { ref: 'personas' }), C('instalacion_desde', 'Instalada desde', 'fecha', { req: true }), C('instalacion_hasta', 'Desinstalada el', 'fecha', { ayuda: 'Vacío = sigue instalada.' })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', licencia_id: 'Microsoft 365 Business Standard', equipo_id: 'PC-EJ-01', persona_id: 'Ana Ejemplo', instalacion_desde: '10/09/2025' } },
  { id: 'servicios', nombre: 'Servicios', col: 'servicios', desc: 'Dominios, DNS, hosting, certificados y correo. Los registros DNS van en la hoja «Registros DNS».',
    claveCols: ['servicio_tipo', 'servicio_nombre'],
    cols: [ORG, C('servicio_tipo', 'Tipo', 'enum', { req: true, op: pares(ROTULO_SERVICIO_TIPO) }), C('servicio_nombre', 'Nombre', 'texto', { req: true, ayuda: 'Dominio, sitio o certificado.' }),
      C('servicio_proveedor', 'Proveedor', 'texto'), C('servicio_titular', 'Titular', 'texto'), C('servicio_vence_en', 'Vence', 'fecha'), C('servicio_delegacion_dns', 'DNS delegado en', 'texto'),
      C('servicio_plan', 'Plan', 'texto'), C('credencial_id', 'Credencial del panel', 'ref', { ref: 'credenciales' })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', servicio_tipo: 'Dominio', servicio_nombre: 'ejemplo.example', servicio_proveedor: 'Registrador Demo', servicio_titular: 'Organización Ejemplo S.A.', servicio_vence_en: '04/12/2026' } },
  { id: 'dns', nombre: 'Registros DNS', col: '', dns: true, desc: 'Una fila por registro DNS de un servicio. Al importar se agregan los que falten (nunca se borra ninguno).',
    claveCols: [],
    cols: [ORG, C('servicio_id', 'Servicio', 'ref', { ref: 'servicios', req: true, virtual: true }), C('registro_tipo', 'Tipo de registro', 'enum', { req: true, virtual: true, op: TIPOS_REGISTRO_DNS.map(x => /** @type {[string, string]} */ ([x, x])) }),
      C('registro_nombre', 'Nombre', 'texto', { req: true, virtual: true, ayuda: '«@» = el dominio mismo.' }), C('registro_valor', 'Valor', 'texto', { req: true, virtual: true }), C('registro_prioridad', 'Prioridad', 'entero', { virtual: true, ayuda: 'Solo MX.' })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', servicio_id: 'ejemplo.example', registro_tipo: 'MX', registro_nombre: '@', registro_valor: 'mail.ejemplo.example.', registro_prioridad: 10 } },
  { id: 'tramos', nombre: 'Tramos de fibra', col: 'tramos_fibra', desc: 'Fibra óptica entre dos sedes o salas, con las patcheras de cada punta si están cargadas.',
    claveCols: ['tramo_nombre'],
    cols: [ORG, C('tramo_nombre', 'Nombre', 'texto', { req: true }), C('tramo_origen_ubicacion_id', 'Origen: sede / sala', 'ref', { ref: 'ubicaciones', req: true, alias: ['Origen: ubicación'] }), C('tramo_destino_ubicacion_id', 'Destino: sede / sala', 'ref', { ref: 'ubicaciones', req: true, alias: ['Destino: ubicación'] }),
      C('tramo_origen_equipo_id', 'Origen: patchera', 'ref', { ref: 'equipos' }), C('tramo_destino_equipo_id', 'Destino: patchera', 'ref', { ref: 'equipos' }), C('tramo_pelos', 'Cantidad de pelos', 'entero', { req: true }),
      C('tramo_tipo', 'Tipo de fibra', 'enum', { req: true, op: pares(ROTULO_FIBRA_TIPO) }), C('tramo_conector', 'Conector', 'enum', { req: true, op: CONECTORES_FIBRA.map(x => /** @type {[string, string]} */ ([x, x])) }),
      C('tramo_longitud_m', 'Longitud (m)', 'numero'), C('tramo_pelos_usados', 'Pelos usados', 'pelos', { ayuda: 'Una línea por pelo: «1: Troncal core (Tx)».' }),
      C('tramo_mediciones', 'Mediciones', 'mediciones', { ayuda: 'Una línea por medición: «20/08/2026; 3; 3,8; observaciones» (fecha; pelo; atenuación en dB; observaciones).' })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', tramo_nombre: 'Fibra Sede ↔ Depósito', tramo_origen_ubicacion_id: 'Sede central', tramo_destino_ubicacion_id: 'Depósito', tramo_pelos: 12, tramo_tipo: 'Monomodo', tramo_conector: 'LC', tramo_longitud_m: 650, tramo_pelos_usados: '1: Troncal (Tx)\n2: Troncal (Rx)' } },
  { id: 'notas', nombre: 'Notas', col: 'notas', desc: 'Notas libres de la organización o colgadas de una ficha (tipo de ficha + nombre). Sin contraseñas.',
    claveCols: ['entidad', 'entidad_id', 'nota_titulo'],
    cols: [ORG, C('entidad', 'Tipo de ficha', 'enum', { op: FICHAS_NOTA, ayuda: 'Vacío = nota de la organización.' }), C('entidad_id', 'Ficha', 'refDin', { segun: 'entidad', ayuda: 'Nombre de la ficha (según el tipo de ficha).' }),
      C('nota_titulo', 'Título', 'texto', { req: true }), C('nota_contenido', 'Contenido', 'largo', { req: true })],
    ejemplo: { organizacion_id: 'Organización Ejemplo S.A.', entidad: 'Equipo', entidad_id: 'SW-EJ-01', nota_titulo: 'Cambio de fuente', nota_contenido: 'Se reemplazó la fuente en 2026.' } }
];

/** Orden en que se guardan las hojas al importar (cada una después de aquello a lo que apunta). */
const ORDEN_APLICAR = ['organizaciones', 'ubicaciones', 'racks', 'puestos', 'vlans', 'equipos', 'enlaces', 'puertos', 'wifi', 'personas', 'configuraciones', 'credenciales', 'cuentas',
  'licencias', 'asignaciones', 'mapeos', 'instalaciones', 'servicios', 'dns', 'tramos', 'notas'];

/** Cómo se nombra cada colección en un mensaje de error. @type {Object<string, string>} */
const NOMBRE_REF = {
  organizaciones: 'la organización', ubicaciones: 'la sede o sala', racks: 'el rack', equipos: 'el equipo', puestos: 'el puesto', personas: 'la persona', cuentas_dominio: 'la cuenta de dominio',
  vlans: 'la VLAN', enlaces_isp: 'el enlace a Internet', redes_wifi: 'la red Wi-Fi', configuraciones: 'la configuración', credenciales: 'la credencial', licencias: 'la licencia',
  servicios: 'el servicio', mapeos_disco: 'el mapeo', tramos_fibra: 'el tramo'
};

/** Hoja en la que se carga cada colección. @type {Object<string, string>} */
const HOJA_DE_COLECCION = Object.fromEntries(ESQUEMA.filter(h => h.col).map(h => [h.col, h.nombre]));

/** Colecciones que se leen para armar las referencias. */
const COLS_MUNDO = ['organizaciones', 'ubicaciones', 'racks', 'equipos', 'puertos', 'vlans', 'enlaces_isp', 'redes_wifi', 'puestos', 'personas', 'cuentas_dominio', 'configuraciones',
  'mapeos_disco', 'credenciales', 'licencias', 'instalaciones_licencia', 'servicios', 'tramos_fibra', 'notas', 'asignaciones'];

/** Rótulos con los que se puede identificar un registro en una referencia: el primero es el canónico. @type {Object<string, (r: any, m: any) => string[]>} */
const ETQ = {
  organizaciones: r => [r.organizacion_nombre],
  ubicaciones: (r, m) => [r.ubicacion_nombre, rutaUbicacion(r, m)],
  racks: r => [r.rack_nombre],
  equipos: r => [r.equipo_nombre, r.equipo_codigo],
  puestos: (r, m) => { const u = r.ubicacion_id && m.cols.ubicaciones.get(r.ubicacion_id); return [r.puesto_nombre, u ? r.puesto_nombre + ' (' + u.ubicacion_nombre + ')' : '']; },
  personas: r => [r.persona_nombre, r.persona_sector ? r.persona_nombre + ' (' + r.persona_sector + ')' : ''],
  cuentas_dominio: r => [r.cuenta_dominio + '\\' + r.cuenta_usuario, r.cuenta_usuario],
  vlans: r => [r.vlan_numero + ' - ' + r.vlan_nombre, String(r.vlan_numero), r.vlan_nombre],
  enlaces_isp: r => [r.enlace_proveedor, r.enlace_proveedor + ' (' + (ROTULO_ENLACE_TIPO[r.enlace_tipo] || r.enlace_tipo) + (r.enlace_ip_publica ? ', ' + r.enlace_ip_publica : '') + ')'],
  redes_wifi: r => [r.wifi_ssid],
  configuraciones: r => [r.configuracion_titulo],
  credenciales: r => [r.credencial_nombre, r.credencial_nombre + ' (' + (ROTULO_CREDENCIAL_TIPO[r.credencial_tipo] || r.credencial_tipo) + ')'],
  licencias: r => [r.licencia_producto, r.licencia_producto + ' (' + (ROTULO_LICENCIA_TIPO[r.licencia_tipo] || r.licencia_tipo) + ')'],
  servicios: r => [r.servicio_nombre, r.servicio_nombre + ' (' + (ROTULO_SERVICIO_TIPO[r.servicio_tipo] || r.servicio_tipo) + ')'],
  mapeos_disco: r => [r.mapeo_letra + ' ' + r.mapeo_ruta],
  tramos_fibra: r => [r.tramo_nombre]
};

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

/** Minúsculas, sin tildes y con espacios simples: para comparar. @param {any} s */
function nrm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
/** @param {any} s */
const esUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
/** @param {any} v */
const vacio = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
/** «2026-03-02» → «02/03/2026». @param {string} iso */
const isoADMA = iso => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : iso);

/** Ruta «Sede / Sala» de una ubicación. @param {any} r @param {any} m */
function rutaUbicacion(r, m) {
  const partes = [r.ubicacion_nombre];
  let p = r.ubicacion_padre_id && m.cols.ubicaciones.get(r.ubicacion_padre_id);
  for (let i = 0; p && i < 20; i++) { partes.unshift(p.ubicacion_nombre); p = p.ubicacion_padre_id && m.cols.ubicaciones.get(p.ubicacion_padre_id); }
  return partes.join(' / ');
}

/** @param {string} id @returns {Hoja} */
function hojaPorId(id) { return /** @type {Hoja} */ (ESQUEMA.find(h => h.id === id)); }

/** Rótulos de las opciones de un enum, para mostrar. @param {Col} c */
const rotulosOp = c => (c.op || []).map(o => o[1]);

/** Encabezado de una columna: «Nombre (equipo_nombre)». @param {Col} c */
const encabezado = c => c.r + ' (' + c.k + ')';

// ---------------------------------------------------------------------------------------------
// ZIP sin compresión (escribir) y lector (leer, con DecompressionStream)
// ---------------------------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

/** @param {Uint8Array} buf */
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** ZIP con las entradas sin comprimir (método 0). @param {Array<{nombre: string, datos: Uint8Array}>} archivos @returns {Uint8Array} */
function crearZip(archivos) {
  const enc = new TextEncoder();
  const fecha = ((2026 - 1980) << 9) | (1 << 5) | 1;
  /** @type {Uint8Array[]} */
  const locales = [];
  /** @type {Uint8Array[]} */
  const centrales = [];
  let offset = 0;
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre);
    const crc = crc32(a.datos);
    const lh = new Uint8Array(30 + nombre.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true); v.setUint16(10, 0, true); v.setUint16(12, fecha, true);
    v.setUint32(14, crc, true); v.setUint32(18, a.datos.length, true); v.setUint32(22, a.datos.length, true); v.setUint16(26, nombre.length, true); v.setUint16(28, 0, true);
    lh.set(nombre, 30);
    locales.push(lh, a.datos);
    const ch = new Uint8Array(46 + nombre.length);
    const w = new DataView(ch.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true); w.setUint16(10, 0, true); w.setUint16(12, 0, true); w.setUint16(14, fecha, true);
    w.setUint32(16, crc, true); w.setUint32(20, a.datos.length, true); w.setUint32(24, a.datos.length, true); w.setUint16(28, nombre.length, true);
    w.setUint32(42, offset, true);
    ch.set(nombre, 46);
    centrales.push(ch);
    offset += lh.length + a.datos.length;
  }
  const tamCentral = centrales.reduce((n, x) => n + x.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true); f.setUint16(8, archivos.length, true); f.setUint16(10, archivos.length, true); f.setUint32(12, tamCentral, true); f.setUint32(16, offset, true);
  const salida = new Uint8Array(offset + tamCentral + 22);
  let p = 0;
  for (const x of [...locales, ...centrales, fin]) { salida.set(x, p); p += x.length; }
  return salida;
}

/** @param {Uint8Array} datos */
async function inflar(datos) {
  const flujo = new Blob([/** @type {BlobPart} */ (datos)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Lee un ZIP: devuelve las entradas por nombre. @param {ArrayBuffer} buffer @returns {Promise<Map<string, Uint8Array>>} */
async function leerZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const v = new DataView(buffer);
  let fin = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('El archivo no es un .xlsx válido (no se pudo leer como ZIP).');
  const cantidad = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const dec = new TextDecoder();
  /** @type {Map<string, Uint8Array>} */
  const salida = new Map();
  for (let i = 0; i < cantidad; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('El archivo .xlsx está dañado (directorio del ZIP).');
    const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true);
    const nNombre = v.getUint16(p + 28, true), nExtra = v.getUint16(p + 30, true), nComent = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + nNombre));
    p += 46 + nNombre + nExtra + nComent;
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const crudo = bytes.subarray(inicio, inicio + tam);
    if (!/\.(xml|rels)$/i.test(nombre)) continue;
    if (metodo === 0) salida.set(nombre, crudo);
    else if (metodo === 8) salida.set(nombre, await inflar(crudo));
    else throw new Error('El archivo .xlsx usa una compresión que no se puede leer.');
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// SpreadsheetML: escribir
// ---------------------------------------------------------------------------------------------

/** @param {number} i Columna (0 = A). */
function letraColumna(i) { let s = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
/** @param {string} s Letras de columna → índice (A = 0). */
function indiceColumna(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

/** Escapa texto para XML y saca los caracteres que XML no admite. @param {string} s */
function esc(s) { return String(s).replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** Estilos de celda. */
const EST = { normal: 0, encabezado: 1, encabezadoObligatorio: 2, ejemplo: 3, negrita: 4, titulo: 5, ajustado: 6, seccion: 7 };

const LIMITE_CELDA = 32000;

/**
 * @typedef {Object} CeldaX
 * @property {string|number|null} [v]
 * @property {number} [e] Estilo.
 */

/**
 * @param {{filas: CeldaX[][], anchos: number[], validaciones?: Array<{col: number, lista: string[]}>, congelar?: boolean, cantidadFilas?: number}} h
 */
function xmlHoja(h) {
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  x += '<sheetViews><sheetView workbookViewId="0">' + (h.congelar ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') + '</sheetView></sheetViews>';
  x += '<sheetFormatPr defaultRowHeight="15"/>';
  x += '<cols>' + h.anchos.map((a, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + a + '" customWidth="1"/>').join('') + '</cols>';
  x += '<sheetData>';
  h.filas.forEach((fila, i) => {
    x += '<row r="' + (i + 1) + '">';
    fila.forEach((c, j) => {
      if (!c) return;
      const ref = letraColumna(j) + (i + 1);
      const s = c.e ? ' s="' + c.e + '"' : '';
      if (c.v === null || c.v === undefined || c.v === '') { if (c.e) x += '<c r="' + ref + '"' + s + '/>'; return; }
      if (typeof c.v === 'number') x += '<c r="' + ref + '"' + s + '><v>' + c.v + '</v></c>';
      else x += '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(c.v.length > LIMITE_CELDA ? c.v.slice(0, LIMITE_CELDA) : c.v) + '</t></is></c>';
    });
    x += '</row>';
  });
  x += '</sheetData>';
  const val = (h.validaciones || []).filter(v => v.lista.join(',').length <= 250 && v.lista.every(t => !t.includes(',')));
  if (val.length) {
    const hasta = Math.max(1000, (h.cantidadFilas || 0) + 500);
    x += '<dataValidations count="' + val.length + '">' + val.map(v => '<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Valor no permitido" error="Elegí uno de la lista." sqref="'
      + letraColumna(v.col) + '2:' + letraColumna(v.col) + hasta + '"><formula1>"' + esc(v.lista.join(',')) + '"</formula1></dataValidation>').join('') + '</dataValidations>';
  }
  return x + '</worksheet>';
}

const XML_ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF7F7F7F"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="16"/><name val="Calibri"/></font></fonts>'
  + '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFC55A11"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Arma el libro completo. @param {Array<{nombre: string, xml: string}>} hojas @returns {Uint8Array} */
function crearXlsx(hojas) {
  const enc = new TextEncoder();
  const cab = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const tipos = cab + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + hojas.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>';
  const raiz = cab + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const libro = cab + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>'
    + hojas.map((h, i) => '<sheet name="' + esc(h.nombre) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>';
  const rels = cab + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + hojas.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (hojas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  /** @type {Array<{nombre: string, datos: Uint8Array}>} */
  const archivos = [
    { nombre: '[Content_Types].xml', datos: enc.encode(tipos) }, { nombre: '_rels/.rels', datos: enc.encode(raiz) },
    { nombre: 'xl/workbook.xml', datos: enc.encode(libro) }, { nombre: 'xl/_rels/workbook.xml.rels', datos: enc.encode(rels) }, { nombre: 'xl/styles.xml', datos: enc.encode(XML_ESTILOS) }
  ];
  hojas.forEach((h, i) => archivos.push({ nombre: 'xl/worksheets/sheet' + (i + 1) + '.xml', datos: enc.encode(h.xml) }));
  return crearZip(archivos);
}

// ---------------------------------------------------------------------------------------------
// SpreadsheetML: leer
// ---------------------------------------------------------------------------------------------

/** @typedef {{nombre: string, filas: Array<{n: number, c: any[]}>}} HojaLeida */

/** @param {Uint8Array} bytes @param {string} nombre */
function leerXml(bytes, nombre) {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo .xlsx está dañado (' + nombre + ').');
  return doc;
}

/** @param {Element} el @param {string} nombre */
const hijos = (el, nombre) => Array.from(el.getElementsByTagNameNS('*', nombre));

/** Texto de un `<si>` o `<is>`: junta los `<t>` (sin la fonética). @param {Element} el */
function textoRico(el) {
  let s = '';
  for (const t of hijos(el, 't')) { if (t.parentElement && t.parentElement.localName === 'rPh') continue; s += t.textContent || ''; }
  return s;
}

/**
 * Lee las hojas de un `.xlsx`: por cada una, las filas con su número y las celdas por columna (texto, número o booleano).
 * @param {ArrayBuffer} buffer @returns {Promise<HojaLeida[]>}
 */
async function leerXlsx(buffer) {
  const zip = await leerZip(buffer);
  const libroBytes = zip.get('xl/workbook.xml');
  if (!libroBytes) throw new Error('El archivo no parece un libro de Excel (.xlsx).');
  const libro = leerXml(libroBytes, 'workbook.xml');
  const relsBytes = zip.get('xl/_rels/workbook.xml.rels');
  /** @type {Map<string, string>} */
  const destinos = new Map();
  if (relsBytes) for (const r of hijos(leerXml(relsBytes, 'workbook.xml.rels').documentElement, 'Relationship')) destinos.set(r.getAttribute('Id') || '', r.getAttribute('Target') || '');
  /** @type {string[]} */
  const compartidas = [];
  const sst = zip.get('xl/sharedStrings.xml');
  if (sst) for (const si of hijos(leerXml(sst, 'sharedStrings.xml').documentElement, 'si')) compartidas.push(textoRico(si));
  /** @type {HojaLeida[]} */
  const hojas = [];
  let orden = 0;
  for (const s of hijos(libro.documentElement, 'sheet')) {
    orden++;
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id') || '';
    let destino = destinos.get(rid) || 'worksheets/sheet' + orden + '.xml';
    destino = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino;
    const bytes = zip.get(destino);
    if (!bytes) continue;
    const doc = leerXml(bytes, destino);
    /** @type {Array<{n: number, c: any[]}>} */
    const filas = [];
    let proxima = 0;
    for (const fila of hijos(doc.documentElement, 'row')) {
      const n = Number(fila.getAttribute('r')) || proxima + 1;
      proxima = n;
      /** @type {any[]} */
      const c = [];
      let col = 0;
      for (const cel of Array.from(fila.children).filter(x => x.localName === 'c')) {
        const ref = cel.getAttribute('r');
        if (ref) { const m = /^([A-Za-z]+)/.exec(ref); if (m) col = indiceColumna(m[1]); }
        const t = cel.getAttribute('t') || '';
        const vEl = hijos(cel, 'v')[0];
        const raw = vEl ? vEl.textContent || '' : '';
        /** @type {any} */
        let valor = null;
        if (t === 's') valor = compartidas[Number(raw)] ?? '';
        else if (t === 'inlineStr') { const is = hijos(cel, 'is')[0]; valor = is ? textoRico(is) : ''; }
        else if (t === 'str' || t === 'd') valor = raw;
        else if (t === 'b') valor = raw === '1';
        else if (t === 'e') valor = null;
        else if (raw !== '') valor = Number(raw);
        c[col] = valor;
        col++;
      }
      filas.push({ n, c });
    }
    hojas.push({ nombre: s.getAttribute('name') || '', filas });
  }
  return hojas;
}

// ---------------------------------------------------------------------------------------------
// Mundo: los datos actuales + los que se van a crear, con sus índices por nombre
// ---------------------------------------------------------------------------------------------

/** @typedef {Object} Mundo
 * @property {Object<string, Map<string, any>>} cols Registros vigentes por colección (y los planeados).
 * @property {Object<string, Map<string, Map<string, Set<string>>>>} idx colección → organización → rótulo normalizado → ids.
 * @property {Object<string, Map<string, string[]>>} claves colección → clave natural → ids.
 * @property {Map<string, string>} puertoPorNumero «equipoId|número» → id de puerto.
 * @property {Map<string, string>} codigos Código de equipo (normalizado, por organización) → id; incluye las bajas.
 * @property {Set<string>} existentes ids que ya existían.
 * @property {Map<string, Auto>} autos Lo que se va a crear porque una fila lo menciona y no existe (QC58-A), por id.
 */

/** @param {Mundo} m @param {string} col @param {any} r */
function orgClave(m, col, r) {
  if (col === 'organizaciones') return '';
  if (col === 'puertos') { const e = m.cols.equipos.get(r.equipo_id); return e ? e.organizacion_id : ''; }
  return r.organizacion_id || '';
}

/** @param {Mundo} m @param {string} col @param {any} r */
function indexar(m, col, r) {
  const f = ETQ[col];
  if (!f) return;
  const org = orgClave(m, col, r);
  if (!m.idx[col].has(org)) m.idx[col].set(org, new Map());
  const mapa = /** @type {Map<string, Set<string>>} */ (m.idx[col].get(org));
  for (const l of f(r, m)) {
    if (!l) continue;
    const k = nrm(l);
    if (!mapa.has(k)) mapa.set(k, new Set());
    /** @type {Set<string>} */ (mapa.get(k)).add(r.id);
  }
}

/** @param {Mundo} m @param {string} col @param {string} id */
function desindexar(m, col, id) {
  for (const mapa of m.idx[col].values()) for (const s of mapa.values()) s.delete(id);
}

/** Rótulo canónico (el primero) de un registro. @param {Mundo} m @param {string} col @param {any} r */
function rotuloCanonico(m, col, r) { return ETQ[col] ? ETQ[col](r, m)[0] : ''; }

/** Rótulo con el que se escribe una referencia en la planilla: el primero que identifica a un solo registro. @param {Mundo} m @param {string} col @param {any} r */
function etiquetaUnica(m, col, r) {
  const f = ETQ[col];
  if (!f) return '';
  const org = orgClave(m, col, r);
  const mapa = m.idx[col].get(org);
  const lista = f(r, m).filter(Boolean);
  for (const l of lista) { const s = mapa && mapa.get(nrm(l)); if (s && s.size === 1 && s.has(r.id)) return l; }
  return lista.length ? r.id : '';
}

/** Ids que coinciden con un texto de referencia dentro de una organización. @param {Mundo} m @param {string} col @param {string} org @param {any} texto @returns {string[]} */
function buscar(m, col, org, texto) {
  const t = String(texto).trim();
  if (esUuid(t)) { const r = m.cols[col].get(t); return r && (col === 'organizaciones' || !org || orgClave(m, col, r) === org) ? [t] : []; }
  const mapa = m.idx[col].get(col === 'organizaciones' ? '' : org);
  const s = mapa && mapa.get(nrm(t));
  return s ? Array.from(s) : [];
}

/** Carga el estado actual desde el repositorio. @returns {Promise<Mundo>} */
async function cargarMundo() {
  /** @type {Mundo} */
  const m = { cols: {}, idx: {}, claves: {}, puertoPorNumero: new Map(), codigos: new Map(), existentes: new Set(), autos: new Map() };
  for (const c of COLS_MUNDO) { m.cols[c] = new Map(); m.idx[c] = new Map(); m.claves[c] = new Map(); }
  for (const c of COLS_MUNDO) {
    for (const r of await repositorio.listar(c)) { m.cols[c].set(r.id, r); m.existentes.add(r.id); }
  }
  for (const e of await repositorio.listar('equipos', null, { incluirBajas: true })) m.codigos.set(e.organizacion_id + '|' + nrm(e.equipo_codigo), e.id);
  for (const c of COLS_MUNDO) for (const r of m.cols[c].values()) indexar(m, c, r);
  for (const p of m.cols.puertos.values()) m.puertoPorNumero.set(p.equipo_id + '|' + p.puerto_numero, p.id);
  for (const h of ESQUEMA) {
    if (!h.col || !m.cols[h.col]) continue;
    for (const r of m.cols[h.col].values()) agregarClave(m, h.col, claveDeRegistro(h, r, m), r.id);
  }
  return m;
}

/** @param {Mundo} m @param {string} col @param {string|null} clave @param {string} id */
function agregarClave(m, col, clave, id) {
  if (clave === null) return;
  const l = m.claves[col].get(clave);
  if (!l) m.claves[col].set(clave, [id]); else if (!l.includes(id)) l.push(id);
}

/** Clave natural de un registro ya guardado (con ids). @param {Hoja} h @param {any} r @param {Mundo} m */
function claveDeRegistro(h, r, m) {
  const partes = h.claveCols.map(k => {
    const c = /** @type {Col} */ (h.cols.find(x => x.k === k));
    const v = r[k];
    if (vacio(v)) return '';
    if (c.t === 'ref') { const t = m.cols[/** @type {string} */ (c.ref)].get(v); return t ? nrm(rotuloCanonico(m, /** @type {string} */ (c.ref), t)) : ''; }
    if (c.t === 'refDin') { const col = COLECCION_DE_ENTIDAD[r[/** @type {string} */ (c.segun)]]; const t = col && m.cols[col] && m.cols[col].get(v); return t ? nrm(rotuloCanonico(m, col, t)) : ''; }
    if (c.t === 'fecha') return String(v).slice(0, 10);
    return nrm(String(v));
  });
  return orgClave(m, h.col, r) + '|' + partes.join('|');
}

// ---------------------------------------------------------------------------------------------
// Valores: formatear (exportar) y leer (importar)
// ---------------------------------------------------------------------------------------------

/** @param {Mundo} m @param {string} col @param {string} id */
function etiquetaDeId(m, col, id) { const r = m.cols[col] && m.cols[col].get(id); return r ? etiquetaUnica(m, col, r) : ''; }

/** Valor de una celda al exportar. @param {Col} c @param {any} v @param {Mundo} m @param {any} [reg] @returns {string|number} */
function formatear(c, v, m, reg) {
  if (v === undefined || v === null || v === '') return '';
  switch (c.t) {
    case 'entero': case 'numero': return Number(v);
    case 'fecha': return isoADMA(String(v).slice(0, 10));
    case 'bool': return v ? 'Sí' : 'No';
    case 'enum': { const o = (c.op || []).find(p => String(p[0]) === String(v)); return o ? o[1] : String(v); }
    case 'ref': return etiquetaDeId(m, /** @type {string} */ (c.ref), v);
    case 'refDin': { const col = COLECCION_DE_ENTIDAD[reg ? reg[/** @type {string} */ (c.segun)] : '']; return col ? etiquetaDeId(m, col, v) : ''; }
    case 'lista': return Array.isArray(v) ? v.join('; ') : String(v);
    case 'listaRef': return Array.isArray(v) ? v.map(id => etiquetaDeId(m, /** @type {string} */ (c.ref), id)).filter(Boolean).join('; ') : '';
    case 'json': return JSON.stringify(v);
    case 'pelos': return Array.isArray(v) ? v.map(x => x.pelo + ': ' + (x.uso || '')).join('\n') : '';
    case 'mediciones': return Array.isArray(v) ? v.map(x => isoADMA(x.fecha) + '; ' + x.pelo + '; ' + String(x.atenuacion_db).replace('.', ',') + '; ' + (x.observaciones || '')).join('\n') : '';
    default: return String(v);
  }
}

/** Fecha de una celda (texto «DD/MM/AAAA», «AAAA-MM-DD» o número de Excel) → «AAAA-MM-DD», o null si no es válida. @param {any} raw */
function leerFecha(raw) {
  /** @type {number} */ let a, mes, d;
  if (typeof raw === 'number') {
    if (!(raw >= 1 && raw < 2958466)) return null;
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000);
    a = f.getUTCFullYear(); mes = f.getUTCMonth() + 1; d = f.getUTCDate();
  } else {
    const t = String(raw).trim();
    let x = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(t);
    if (x) { d = +x[1]; mes = +x[2]; a = +x[3]; } else {
      x = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
      if (!x) return null;
      a = +x[1]; mes = +x[2]; d = +x[3];
    }
  }
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return String(a).padStart(4, '0') + '-' + String(mes).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** Número de una celda («1.234,5», «3,8», 12). @param {any} raw @param {boolean} entero @returns {number|null} */
function leerNumero(raw, entero) {
  if (typeof raw === 'number') return Number.isFinite(raw) && (!entero || Number.isInteger(raw)) ? raw : null;
  let t = String(raw).trim().replace(/\s/g, '');
  if (entero) return /^-?\d+$/.test(t) ? Number(t) : null;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/**
 * Lee una celda no vacía según el tipo de su columna (las referencias se resuelven aparte).
 * @param {Col} c @param {any} raw @returns {{v?: any, error?: string}}
 */
function leerValor(c, raw) {
  switch (c.t) {
    case 'texto': return { v: String(raw).trim() };
    case 'largo': return { v: String(raw).replace(/\r\n?/g, '\n').trim() };
    case 'entero': { const n = leerNumero(raw, true); return n === null ? { error: 'tiene que ser un número entero (vino «' + raw + '»)' } : { v: n }; }
    case 'numero': { const n = leerNumero(raw, false); return n === null ? { error: 'tiene que ser un número (vino «' + raw + '»)' } : { v: n }; }
    case 'fecha': { const f = leerFecha(raw); return f ? { v: f } : { error: 'no es una fecha válida (usá DD/MM/AAAA; vino «' + raw + '»)' }; }
    case 'bool': {
      if (typeof raw === 'boolean') return { v: raw };
      const t = nrm(raw);
      if (['si', 's', 'true', 'verdadero', '1', 'x', 'yes'].includes(t)) return { v: true };
      if (['no', 'n', 'false', 'falso', '0'].includes(t)) return { v: false };
      return { error: 'tiene que ser «Sí» o «No» (vino «' + raw + '»)' };
    }
    case 'enum': {
      const t = nrm(raw);
      const o = (c.op || []).find(p => nrm(p[0]) === t || nrm(p[1]) === t);
      if (!o) return { error: 'el valor «' + raw + '» no está permitido (permitidos: ' + rotulosOp(c).join(', ') + ')' };
      return { v: c.num ? Number(o[0]) : o[0] };
    }
    case 'lista': return { v: String(raw).split(/[;\n]/).map(x => x.trim()).filter(Boolean) };
    case 'json': {
      try { return { v: JSON.parse(String(raw)) }; } catch { return { error: 'no es un JSON válido' }; }
    }
    case 'pelos': {
      /** @type {Array<{pelo: number, uso: string}>} */
      const out = [];
      for (const l of String(raw).split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
        const x = /^(\d+)\s*[:=\-]\s*(.*)$/.exec(l);
        if (!x) return { error: 'la línea «' + l + '» no tiene el formato «pelo: uso»' };
        out.push({ pelo: Number(x[1]), uso: x[2].trim() });
      }
      return { v: out };
    }
    case 'mediciones': {
      /** @type {Array<{fecha: string, pelo: number, atenuacion_db: number, observaciones: string|null}>} */
      const out = [];
      for (const l of String(raw).split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
        /** @type {string[]} */
        const p = [];
        let resto = l;
        for (let i = 0; i < 3; i++) { const k = resto.indexOf(';'); if (k < 0) break; p.push(resto.slice(0, k).trim()); resto = resto.slice(k + 1); }
        p.push(resto.trim());
        const f = p.length >= 4 ? leerFecha(p[0]) : null, pelo = p.length >= 4 ? leerNumero(p[1], true) : null, db = p.length >= 4 ? leerNumero(p[2], false) : null;
        if (!f || pelo === null || db === null) return { error: 'la medición «' + l + '» no tiene el formato «fecha; pelo; dB; observaciones»' };
        out.push({ fecha: f, pelo, atenuacion_db: db, observaciones: p[3] || null });
      }
      return { v: out };
    }
    default: return { v: String(raw).trim() };
  }
}

/** Forma comparable de un valor, para saber si cambió. @param {Col} c @param {any} v */
function comparable(c, v) {
  if (v === undefined || v === null || v === '') return null;
  switch (c.t) {
    case 'fecha': return String(v).slice(0, 10);
    case 'enum': return String(v);
    case 'bool': return !!v;
    case 'entero': case 'numero': return Number(v);
    case 'lista': case 'listaRef': return JSON.stringify(v);
    case 'json': return JSON.stringify(v);
    case 'pelos': return JSON.stringify((v || []).map((/** @type {any} */ x) => ({ pelo: x.pelo, uso: x.uso || '' })));
    case 'mediciones': return JSON.stringify((v || []).map((/** @type {any} */ x) => ({ fecha: x.fecha, pelo: x.pelo, atenuacion_db: x.atenuacion_db, observaciones: x.observaciones || null })));
    default: return String(v).trim();
  }
}

// ---------------------------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------------------------

/** Orden en que se escriben las filas de cada hoja. @param {Mundo} m @param {Hoja} h @param {any} r */
function ordenFila(m, h, r) {
  const org = m.cols.organizaciones.get(orgClave(m, h.col, r));
  const o = org ? nrm(org.organizacion_nombre) : '';
  const nom = ETQ[h.col] ? nrm(rotuloCanonico(m, h.col, r)) : '';
  if (h.id === 'ubicaciones') return o + '|' + String(rutaUbicacion(r, m).split(' / ').length).padStart(2, '0') + '|' + nrm(rutaUbicacion(r, m));
  if (h.id === 'puertos') { const e = m.cols.equipos.get(r.equipo_id); return o + '|' + nrm(e ? e.equipo_nombre : '') + '|' + String(r.puerto_numero).padStart(6, '0'); }
  if (h.id === 'equipos') return o + '|' + r.equipo_tipo + '|' + nom;
  if (h.id === 'asignaciones') return o + '|' + nrm(etiquetaDeId(m, 'equipos', r.equipo_id)) + '|' + (r.asignacion_desde || '');
  if (h.id === 'instalaciones') return o + '|' + nrm(etiquetaDeId(m, 'licencias', r.licencia_id)) + '|' + nrm(etiquetaDeId(m, 'equipos', r.equipo_id));
  if (h.id === 'notas') return o + '|' + nrm(r.entidad || '') + '|' + nrm(r.nota_titulo);
  return o + '|' + nom;
}

/** Valor crudo de una columna en un registro. @param {Col} c @param {any} r */
function valorDe(c, r) { return c.campo ? (r.equipo_campos || {})[c.k] : r[c.k]; }

/**
 * Qué puede ver el usuario de cada hoja: filtra por organización y por módulo.
 * @param {UsuarioSesion} u @param {Mundo} m @param {Hoja} h @param {any[]} lista
 */
async function visibles(u, m, h, lista) {
  const out = [];
  for (const r of lista) {
    const org = h.col === 'organizaciones' ? r.id : orgClave(m, h.col, r);
    let mod;
    if (h.col === 'puertos') { const e = m.cols.equipos.get(r.equipo_id); mod = moduloDeEntidad('Equipo', e); }
    else if (h.col === 'notas') mod = await repositorio.moduloDeNota(r);
    else if (h.col === 'racks') mod = 'racks';
    else mod = moduloDeEntidad(ENTIDAD_DE_COLECCION[h.col], r);
    if (puede(u, 'ver', mod, org || null)) out.push(r);
  }
  return out;
}

/** @param {any} h @returns {number} */
function anchoColumna(h) { return Math.min(42, Math.max(14, Math.round(String(h).length * 0.95) + 2)); }

/**
 * Arma el `.xlsx`.
 * @param {{vacia: boolean, usuario: UsuarioSesion, incluirContrasenas?: boolean}} o
 * @returns {Promise<{bytes: Uint8Array, nombre: string, resumen: Array<[string, number]>, contrasenas: number, recortadas: number, ambiguas: number}>}
 */
export async function generarPlanilla(o) {
  const u = o.usuario;
  const conSecretos = !!o.incluirContrasenas && !o.vacia && u.usuario_perfil === 'superadmin';
  const m = await cargarMundo();
  /** @type {Array<{nombre: string, xml: string}>} */
  const hojasXml = [];
  /** @type {Array<[string, number]>} */
  const resumen = [];
  let contrasenas = 0, recortadas = 0, ambiguas = 0;
  /** @param {string|number} v */
  const cap = v => { if (typeof v === 'string' && v.length > LIMITE_CELDA) { recortadas++; return v.slice(0, LIMITE_CELDA); } return v; };

  for (const h of ESQUEMA) {
    /** @type {CeldaX[][]} */
    const filas = [];
    const cols = h.cols;
    filas.push([{ v: 'id', e: EST.encabezado }, ...cols.map(c => ({ v: encabezado(c), e: c.req ? EST.encabezadoObligatorio : EST.encabezado }))]);
    let n = 0;
    if (o.vacia) {
      filas.push([{ v: '#ejemplo', e: EST.ejemplo }, ...cols.map(c => ({ v: h.ejemplo[c.k] === undefined ? null : h.ejemplo[c.k], e: EST.ejemplo }))]);
    } else if (h.dns) {
      /** @type {Array<{o: string, r: any, s: any}>} */
      const regs = [];
      for (const s of await visibles(u, m, hojaPorId('servicios'), Array.from(m.cols.servicios.values()))) {
        for (const g of s.servicio_registros || []) regs.push({ o: ordenFila(m, hojaPorId('servicios'), s) + '|' + g.tipo + '|' + nrm(g.nombre), r: g, s });
      }
      regs.sort((a, b) => (a.o < b.o ? -1 : a.o > b.o ? 1 : 0));
      for (const x of regs) {
        const sv = etiquetaUnica(m, 'servicios', x.s);
        const org = etiquetaDeId(m, 'organizaciones', x.s.organizacion_id);
        filas.push([{ v: null }, { v: org }, { v: sv }, { v: x.r.tipo }, { v: cap(String(x.r.nombre)) }, { v: cap(String(x.r.valor)) }, { v: x.r.prioridad == null ? null : Number(x.r.prioridad) }]);
        n++;
      }
    } else {
      const todos = Array.from(m.cols[h.col].values());
      const lista = (await visibles(u, m, h, todos)).map(r => ({ r, o: ordenFila(m, h, r) })).sort((a, b) => (a.o < b.o ? -1 : a.o > b.o ? 1 : 0));
      for (const { r } of lista) {
        /** @type {CeldaX[]} */
        const fila = [{ v: r.id }];
        for (const c of cols) {
          /** @type {string|number} */
          let v = '';
          if (c.k === 'organizacion_id') v = etiquetaDeId(m, 'organizaciones', orgClave(m, h.col, r));
          else if (c.k === 'conectado_a_equipo_id') { const d = r.conectado_a_puerto_id && m.cols.puertos.get(r.conectado_a_puerto_id); v = d ? etiquetaDeId(m, 'equipos', d.equipo_id) : ''; }
          else if (c.k === 'conectado_a_puerto_numero') { const d = r.conectado_a_puerto_id && m.cols.puertos.get(r.conectado_a_puerto_id); v = d ? d.puerto_numero : ''; }
          else if (c.secreto) {
            if (conSecretos && r.credencial_tipo !== undefined) { const s = await repositorio.usarSecreto(r.id, u.id, 'mostrar'); if (s) { v = s; contrasenas++; } }
          } else if (c.campo) { v = c.aplica && !c.aplica(r) ? '' : formatear(c, valorDe(c, r), m, r); }
          else v = formatear(c, valorDe(c, r), m, r);
          v = cap(v);
          fila.push({ v: v === '' ? null : v });
        }
        filas.push(fila);
        n++;
        if (h.col && ETQ[h.col] && etiquetaUnica(m, h.col, r) === r.id) ambiguas++;
      }
    }
    resumen.push([h.nombre, n]);
    const validaciones = [];
    cols.forEach((c, j) => { if (c.t === 'enum' && c.op) validaciones.push({ col: j + 1, lista: rotulosOp(c) }); else if (c.t === 'bool') validaciones.push({ col: j + 1, lista: ['Sí', 'No'] }); });
    hojasXml.push({ nombre: h.nombre, xml: xmlHoja({ filas, anchos: [12, ...cols.map(c => anchoColumna(encabezado(c)))], validaciones, congelar: true, cantidadFilas: filas.length }) });
  }
  hojasXml.unshift({ nombre: 'Instrucciones', xml: xmlInstrucciones(o.vacia, conSecretos) });
  const nombre = o.vacia ? 'infradoc-planilla-vacia.xlsx' : 'infradoc-planilla-' + hoyISO() + '.xlsx';
  return { bytes: crearXlsx(hojasXml), nombre, resumen, contrasenas, recortadas, ambiguas };
}

/** Descarga los bytes como archivo. @param {string} nombre @param {Uint8Array} bytes */
export function descargarArchivo(nombre, bytes) {
  const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------------------------
// Hoja «Instrucciones»
// ---------------------------------------------------------------------------------------------

/** @param {Col} c */
function tipoTexto(c) {
  switch (c.t) {
    case 'texto': return 'Texto'; case 'largo': return 'Texto largo'; case 'entero': return 'Número entero'; case 'numero': return 'Número'; case 'fecha': return 'Fecha DD/MM/AAAA';
    case 'bool': return 'Sí / No'; case 'enum': return 'Lista cerrada'; case 'ref': case 'refDin': return 'Referencia por nombre'; case 'lista': return 'Lista separada por «;»';
    case 'listaRef': return 'Referencias separadas por «;»'; case 'json': return 'JSON'; case 'pelos': return 'Una línea por pelo'; case 'mediciones': return 'Una línea por medición'; default: return c.t;
  }
}

/** @param {Col} c */
function permitidosTexto(c) {
  if (c.t === 'enum') return rotulosOp(c).join(' · ');
  if (c.t === 'bool') return 'Sí · No';
  if (c.t === 'ref' || c.t === 'listaRef') return 'Nombre en la hoja «' + (HOJA_DE_COLECCION[/** @type {string} */ (c.ref)] || c.ref) + '»' + (c.ref === 'equipos' ? ' (o su código)' : '') + (c.ref === 'vlans' ? ' (número, o «10 - Nombre»)' : '') + (c.ref === 'cuentas_dominio' ? ' (DOMINIO\\usuario)' : '');
  if (c.t === 'refDin') return 'Nombre de la ficha, según el tipo de ficha';
  if (c.t === 'fecha') return 'DD/MM/AAAA (también sirve una fecha de Excel)';
  return '';
}

/** @param {Col} c */
function obligatoriaTexto(c) {
  if (c.campo) return c.req ? 'Del tipo' : 'No';
  if (c.virtual && c.k.startsWith('conectado_a')) return 'No';
  if (c.req) return c.def !== undefined ? 'Sí (vacía: ' + (c.t === 'bool' ? (c.def ? 'Sí' : 'No') : c.t === 'enum' ? (rotulosOp(c)[(c.op || []).findIndex(p => p[0] === c.def)] || c.def) : c.def) + ')' : 'Sí';
  return 'No';
}

/** @param {boolean} vacia @param {boolean} conSecretos */
function xmlInstrucciones(vacia, conSecretos) {
  /** @type {CeldaX[][]} */
  const f = [];
  /** @param {string} t @param {number} [e] */
  const lin = (t, e) => f.push([{ v: t, e: e === undefined ? EST.ajustado : e }]);
  lin('Planilla de Infradoc', EST.titulo);
  lin('La estructura de los datos de Infradoc en un Excel. Sirve para pasar la documentación del Excel desordenado a datos con estructura, como respaldo y para importar al producto final.');
  lin('');
  lin('Cómo se usa', EST.seccion);
  lin('1. Completá las hojas (una por tipo de dato). La fila 1 de cada hoja son los nombres de columna: no la cambies, ni cambies los nombres de las hojas. Las columnas naranjas son obligatorias.');
  lin('2. Guardala como .xlsx y, en Infradoc, entrá a «Datos» y usá «Importar planilla» (solo el superadmin). Antes de aplicar nada ves una vista previa: cuántas filas se crean, cuántas se actualizan y los errores fila por fila.');
  lin('3. No hace falta completar todo ni respetar el orden de las hojas, pero conviene cargar en este orden porque cada hoja apunta a las anteriores: Organizaciones, Sedes y salas, Racks, Equipos, Puertos y conexiones, VLAN, Redes Wi-Fi, Enlaces ISP, Puestos, Personas, Cuentas de dominio, Asignaciones, Configuraciones, Mapeos de discos, Credenciales, Licencias, Instalaciones, Servicios, Registros DNS, Tramos de fibra, Notas.');
  lin('');
  lin('Reglas', EST.seccion);
  lin('• Las referencias van por NOMBRE, no por código interno: «Rack» = nombre del rack, «Sede / sala» = nombre de la sede o sala, etc. Tiene que existir en la hoja correspondiente (o ya estar cargado en Infradoc) y ser de la misma organización de la fila. Si hay dos con el mismo nombre se usa el nombre completo: «Sede / Sala» para las salas, «Nombre (sector)» para personas, «Nombre (Tipo)» para credenciales, licencias y servicios; y si aun así no alcanza (dos personas con el mismo nombre y sector), el id de la fila. De un equipo sirve también su código.');
  lin('• Si una fila nombra algo que no existe (un rack en una sala que no cargaste, una persona, una VLAN, la sede de una sala…), Infradoc lo CREA con los datos mínimos que se deducen (el nombre y poco más) y recién después importa la fila. Lo ves antes de importar, en «Se va a crear». Un nombre de sala suelto, sin su sede, crea la sala dentro de la sede provisoria «Sin sede» (una por organización, marcada «para revisar»); un rack nuevo es de 42 U. Lo que no se puede deducir con seguridad (por ejemplo de qué tipo es un equipo) sigue siendo un error de la fila.');
  lin('• Esta planilla reconoce también el formato anterior: hoja «Ubicaciones», columna «Ubicación superior» y tipos Edificio / Oficina (Oficina pasa a Sala; un Edificio con sede arriba se une a su sede y sus salas pasan a ella; un Edificio sin sede queda como sede).');
  lin('• La columna «id» es opcional. Vacía: Infradoc busca el registro por su nombre dentro de la organización (si existe lo actualiza y si no lo crea). Con un id que ya existe, actualiza ese registro (así se puede renombrar).');
  lin('• Una celda vacía NUNCA pisa un dato que ya está cargado: solo cambian las celdas con algo escrito. Para vaciar un dato, hacelo en la ficha.');
  lin('• Fechas: DD/MM/AAAA (por ejemplo 31/12/2026). También se aceptan las fechas de Excel.');
  lin('• Sí/No: escribí «Sí» o «No». Listas cerradas: elegí uno de los valores permitidos (cada columna lo muestra más abajo; en Excel aparece un desplegable). Listas dentro de una celda: separadas por «;».');
  lin('• Una fila cuya primera celda empieza con «#» se ignora (las filas de ejemplo de la planilla vacía la llevan: borralas o dejalas).');
  lin('• Nada de contraseñas en notas ni en configuraciones: las contraseñas van solo en la columna «Contraseña» de la hoja Credenciales.');
  lin('');
  lin('Seguridad', EST.seccion);
  if (vacia) lin('Esta es una planilla vacía: no contiene datos.');
  else if (conSecretos) lin('ATENCIÓN: esta planilla incluye las contraseñas de las credenciales y el archivo NO está cifrado. Guardalo en un lugar seguro y no lo envíes por correo ni lo compartas.');
  else lin('Esta planilla no incluye contraseñas: la columna «Contraseña» de la hoja Credenciales está vacía.');
  lin('Los datos de la planilla son tuyos: se generan y se leen en este navegador y no se envían a ningún lado. Cuidá el archivo como cualquier otro con información de los clientes.');
  lin('');
  lin('Hojas y columnas', EST.seccion);
  ESQUEMA.forEach((h, i) => {
    lin('');
    lin((i + 1) + '. ' + h.nombre, EST.negrita);
    lin(h.desc);
    f.push(['Columna', 'Obligatoria', 'Tipo', 'Valores permitidos / a qué apunta', 'Notas'].map(t => ({ v: t, e: EST.encabezado })));
    f.push([{ v: 'id', e: EST.ajustado }, { v: 'No', e: EST.ajustado }, { v: 'Texto', e: EST.ajustado }, { v: 'Identificador interno (opcional)', e: EST.ajustado }, { v: 'Se completa solo al exportar tus datos.', e: EST.ajustado }]);
    for (const c of h.cols) f.push([{ v: encabezado(c), e: EST.ajustado }, { v: obligatoriaTexto(c), e: EST.ajustado }, { v: tipoTexto(c), e: EST.ajustado }, { v: permitidosTexto(c), e: EST.ajustado }, { v: c.ayuda || (c.secreto ? 'Vacía = no se cambia.' : ''), e: EST.ajustado }]);
  });
  return xmlHoja({ filas: f, anchos: [46, 22, 26, 70, 50] });
}

// ---------------------------------------------------------------------------------------------
// Importar: análisis con vista previa
// ---------------------------------------------------------------------------------------------

/** @typedef {Object} Fila
 * @property {number} n Número de fila en la hoja.
 * @property {Map<string, any>} cel Celdas por clave de columna.
 * @property {Array<{col: string|null, mensaje: string}>} errores
 * @property {string|null} org
 * @property {string} idNuevo
 * @property {any} existente
 * @property {Object<string, any>} vals Valores leídos (con referencias resueltas a id).
 * @property {string[]} cambios Rótulos de las columnas que cambian.
 * @property {any} rec Registro final.
 * @property {Set<string>} refs Ids planeados a los que apunta.
 * @property {string|null} clave
 * @property {string[]} deConexion
 * @property {boolean} nuevo
 */

/** @typedef {Object} ResultadoHoja
 * @property {string} nombre
 * @property {boolean} presente
 * @property {number} filas
 * @property {number} crear
 * @property {number} actualizar
 * @property {number} sinCambios
 * @property {Array<{n: number, col: string|null, mensaje: string}>} errores
 * @property {string[]} avisos
 */

/** @typedef {Object} Estado Una hoja leída de la planilla.
 * @property {Hoja} h
 * @property {ResultadoHoja} res
 * @property {Fila[]} filas
 * @property {Map<string, number>} cols
 * @property {boolean} [viejo] La hoja traía un nombre del formato anterior («Ubicaciones»).
 */

/** @typedef {Object} Plan
 * @property {ResultadoHoja[]} hojas
 * @property {number} errores
 * @property {number} validas Filas que se crean o actualizan.
 * @property {number} contrasenas Filas con contraseña.
 * @property {string[]} avisos
 * @property {any[]} acciones
 * @property {Array<{a: string, b: string, fila: string}>} conexiones
 * @property {Creacion[]} creaciones Lo que se crea además de las filas, porque alguna fila lo menciona y no existe (QC58-A).
 * @property {any[]} acciones_auto Lo mismo, listo para guardar (se aplica antes que la hoja correspondiente).
 */

/** @typedef {Object} Creacion
 * @property {string} tipo Qué es («Sala», «Rack», «Persona»…).
 * @property {string} nombre
 * @property {string} detalle Con qué datos se crea.
 * @property {string} organizacion
 * @property {Array<{hoja: string, fila: number, columna: string|null}>} desde Las primeras filas que lo piden.
 * @property {number} total Cuántas filas lo piden.
 */

/** @type {Plan|null} */
let planPendiente = null;

/** Texto de la celda de una columna, o undefined si está vacía. @param {Fila} f @param {string} k */
const celda = (f, k) => { const v = f.cel.get(k); return vacio(v) ? undefined : v; };

/** Rótulo canónico del texto de una referencia, si se resuelve a uno solo; si no, el último tramo del texto. @param {Mundo} m @param {string} col @param {string|null} org @param {any} texto */
function canonDeTexto(m, col, org, texto) {
  const ids = buscar(m, col, org || '', texto);
  if (ids.length === 1) return nrm(rotuloCanonico(m, col, /** @type {any} */ (m.cols[col].get(ids[0]))));
  return nrm(String(texto).split(' / ').pop());
}

/**
 * Lee la planilla y arma el plan SIN cambiar nada.
 * @param {ArrayBuffer} buffer @param {UsuarioSesion} usuario
 * @returns {Promise<Plan>}
 */
export async function analizarPlanilla(buffer, usuario) {
  if (!puede(usuario, 'importar')) throw new Error('Solo el superadmin puede importar una planilla.');
  planPendiente = null;
  const leidas = await leerXlsx(buffer);
  const porNombre = new Map(leidas.map(x => [nrm(x.nombre), x]));
  const hojaLeida = (/** @type {Hoja} */ h) => porNombre.get(nrm(h.nombre)) || (h.alias || []).map(a => porNombre.get(nrm(a))).find(Boolean);
  if (!ESQUEMA.some(h => hojaLeida(h))) throw new Error('El archivo no tiene ninguna de las hojas de la planilla de Infradoc (Organizaciones, Equipos, etc.). Descargá la planilla vacía y usá esa.');
  const m = await cargarMundo();
  /** @type {Plan} */
  const plan = { hojas: [], errores: 0, validas: 0, contrasenas: 0, avisos: [], acciones: [], conexiones: [], creaciones: [], acciones_auto: [] };

  /** @type {Map<string, Estado>} */
  const estados = new Map();
  for (const h of ESQUEMA) {
    /** @type {ResultadoHoja} */
    const res = { nombre: h.nombre, presente: false, filas: 0, crear: 0, actualizar: 0, sinCambios: 0, errores: [], avisos: [] };
    plan.hojas.push(res);
    const x = hojaLeida(h);
    if (!x) continue;
    res.presente = true;
    const nombreViejo = nrm(x.nombre) !== nrm(h.nombre);
    const cab = x.filas.find(f => f.n === 1);
    /** @type {Map<string, number>} */
    const cols = new Map();
    if (cab) {
      cab.c.forEach((t, j) => {
        if (vacio(t)) return;
        const s = String(t).trim();
        const mk = /\(([A-Za-z0-9_]+)\)\s*$/.exec(s);
        const clave = nrm(s) === 'id' ? 'id' : mk ? mk[1] : null;
        const col = clave && (clave === 'id' || h.cols.some(c => c.k === clave)) ? clave : (h.cols.find(c => nrm(c.r) === nrm(s) || (c.alias || []).some(a => nrm(a) === nrm(s))) || { k: '' }).k;
        if (col) cols.set(col, j); else res.avisos.push('La columna «' + s + '» no se reconoce y se ignora.');
      });
    }
    /** @type {Fila[]} */
    const filas = [];
    for (const fx of x.filas) {
      if (fx.n === 1) continue;
      if (fx.c.every(v => vacio(v))) continue;
      if (typeof fx.c[0] === 'string' && fx.c[0].trim().startsWith('#')) continue;
      /** @type {Map<string, any>} */
      const cel = new Map();
      for (const [k, j] of cols) cel.set(k, fx.c[j] === undefined ? null : fx.c[j]);
      filas.push({ n: fx.n, cel, errores: [], org: null, idNuevo: '', existente: null, vals: {}, cambios: [], rec: null, refs: new Set(), clave: null, deConexion: [], nuevo: false });
    }
    res.filas = filas.length;
    if (filas.length) for (const c of h.cols) if (c.req && !cols.has(c.k) && !c.campo && c.def === undefined) res.errores.push({ n: 1, col: c.r, mensaje: 'falta la columna «' + encabezado(c) + '» (obligatoria)' });
    estados.set(h.id, { h, res, filas, cols, viejo: nombreViejo });
  }
  // Planillas del formato anterior (hoja «Ubicaciones», Edificio / Oficina): se leen como «Sedes y salas».
  adaptarSedesYSalas(estados, m);
  for (const e of estados.values()) e.res.filas = e.filas.length;

  const orden = ORDEN_APLICAR.filter(id => estados.has(id));
  // Pasada A: identidad de cada fila (existente o nueva) y alta provisoria en el índice, así las referencias entre hojas (en cualquier orden) se pueden resolver.
  for (const id of orden) pasadaA(/** @type {any} */ (estados.get(id)), m);
  // Pasada B: referencias, valores, registro final y validaciones propias de cada hoja.
  for (const id of orden) pasadaB(/** @type {any} */ (estados.get(id)), m, plan);
  // Una fila que apunta a una fila con errores también queda con error.
  cascada(estados);
  // Cuentas finales y acciones.
  for (const id of orden) {
    const { h, res, filas } = /** @type {any} */ (estados.get(id));
    for (const f of filas) {
      for (const e of f.errores) res.errores.push({ n: f.n, col: e.col, mensaje: e.mensaje });
      if (f.errores.length) continue;
      if (h.dns) continue;
      if (!f.existente) { res.crear++; plan.acciones.push({ col: h.col, op: 'crear', rec: f.rec, hoja: h.nombre, fila: f.n, hojaId: h.id }); }
      else if (f.cambios.length) { res.actualizar++; plan.acciones.push({ col: h.col, op: 'actualizar', rec: f.rec, hoja: h.nombre, fila: f.n, hojaId: h.id, cambios: f.cambios }); }
      else res.sinCambios++;
      if (h.id === 'credenciales' && !vacio(f.vals.credencial_secreto)) plan.contrasenas++;
      for (const par of f.deConexion) { const [a, b] = par.split('>'); plan.conexiones.push({ a, b, fila: h.nombre + ', fila ' + f.n }); }
    }
  }
  aplicarDns(estados, m, plan);
  cerrarCreaciones(m, plan);
  for (const r of plan.hojas) { r.errores.sort((a, b) => a.n - b.n); plan.errores += r.errores.length; }
  plan.validas = plan.acciones.length;
  planPendiente = plan;
  return plan;
}

/** @param {Estado} est @param {Mundo} m */
function pasadaA(est, m) {
  const { h, filas } = est;
  /** @type {Map<string, number>} */
  const vistos = new Map();
  /** @type {Map<string, number>} */
  const idsVistos = new Map();
  for (const f of filas) {
    let fatal = false;
    /** @param {string|null} col @param {string} mensaje @param {boolean} [grave] */
    const err = (col, mensaje, grave) => { f.errores.push({ col, mensaje }); if (grave) fatal = true; };
    // Organización
    if (!h.sinOrg) {
      const t = celda(f, 'organizacion_id');
      if (t === undefined) err('Organización', 'falta la organización', true);
      else {
        const ids = buscar(m, 'organizaciones', '', t);
        if (ids.length === 0) err('Organización', 'la organización «' + t + '» no existe (cargala en la hoja Organizaciones)', true);
        else if (ids.length > 1) err('Organización', 'hay más de una organización llamada «' + t + '»', true);
        else f.org = ids[0];
      }
    } else f.org = '';
    if (h.dns || fatal) continue;
    // Valores que no son referencias
    for (const c of h.cols) {
      if (c.k === 'organizacion_id') continue;
      const raw = celda(f, c.k);
      if (raw === undefined || c.t === 'ref' || c.t === 'listaRef' || c.t === 'refDin') continue;
      const r = leerValor(c, raw);
      if (r.error) err(c.r, r.error); else f.vals[c.k] = r.v;
    }
    // Clave natural: las referencias se comparan por su rótulo canónico
    const partes = [];
    const faltan = [];
    for (const k of h.claveCols) {
      const c = /** @type {Col} */ (h.cols.find(x => x.k === k));
      const raw = celda(f, k);
      if (raw === undefined) {
        // Una sala que no dice su sede es de la sede provisoria «Sin sede» (así se reconoce al volver a importar).
        partes.push(h.id === 'ubicaciones' && k === 'ubicacion_padre_id' && f.vals.ubicacion_tipo === 'sala' ? nrm(NOMBRE_SIN_SEDE) : '');
        if (c.req) faltan.push(c.r);
        continue;
      }
      if (c.t === 'ref') {
        const col = /** @type {string} */ (c.ref);
        const ids = buscar(m, col, f.org || '', raw);
        if (ids.length === 1) f.vals[k] = ids[0];
        partes.push(canonDeTexto(m, col, f.org, raw));
      } else if (c.t === 'refDin') {
        const colEnt = COLECCION_DE_ENTIDAD[f.vals[/** @type {string} */ (c.segun)]];
        partes.push(colEnt ? canonDeTexto(m, colEnt, f.org, raw) : nrm(raw));
      } else partes.push(c.t === 'fecha' ? String(f.vals[k] || '') : nrm(f.vals[k] ?? raw));
    }
    if (faltan.length) { err(null, 'faltan datos para identificar la fila (' + faltan.map(x => '«' + x + '»').join(', ') + ')', true); continue; }
    const clave = f.org + '|' + partes.join('|');
    f.clave = clave;
    // ¿Existe ya? Primero por id, después por nombre dentro de la organización.
    const idCelda = celda(f, 'id');
    const idTxt = idCelda === undefined ? '' : String(idCelda).trim();
    /** @type {any} */
    let ex = null;
    if (idTxt && !esUuid(idTxt)) err('id', 'el id «' + idTxt + '» no es válido (dejala vacía para que se busque por nombre)', true);
    else if (idTxt && m.existentes.has(idTxt) && m.cols[h.col].get(idTxt)) {
      ex = m.cols[h.col].get(idTxt);
      if (orgClave(m, h.col, ex) !== f.org) err('id', 'el id corresponde a un registro de otra organización', true);
      else if (idsVistos.has(idTxt)) err('id', 'el id está repetido (fila ' + idsVistos.get(idTxt) + ')', true);
      else idsVistos.set(idTxt, f.n);
    } else {
      const previa = vistos.get(clave);
      if (previa !== undefined) err(null, 'repite la fila ' + previa + ' (mismo ' + h.claveCols.map(k => /** @type {Col} */ (h.cols.find(c => c.k === k)).r.toLowerCase()).join(' + ') + ')', true);
      else {
        const ids = m.claves[h.col].get(clave) || [];
        if (ids.length > 1) err(null, 'hay ' + ids.length + ' registros iguales en Infradoc (mismo ' + h.claveCols.map(k => /** @type {Col} */ (h.cols.find(c => c.k === k)).r.toLowerCase()).join(' + ') + '): usá la columna «id» para elegir uno', true);
        else if (ids.length === 1) { ex = m.cols[h.col].get(ids[0]); if (idsVistos.has(ex.id)) err(null, 'ya está en la fila ' + idsVistos.get(ex.id) + ' (por su id)', true); else idsVistos.set(ex.id, f.n); }
        vistos.set(clave, f.n);
      }
    }
    if (fatal) continue;
    f.existente = ex;
    f.nuevo = !ex;
    f.idNuevo = ex ? ex.id : (idTxt && esUuid(idTxt) && !m.cols[h.col].has(idTxt) ? idTxt : crypto.randomUUID());
    if (!ex) {
      // Alta provisoria: con los textos ya leídos y la organización, para que otras filas la puedan nombrar.
      /** @type {any} */
      const sk = { id: f.idNuevo, ...(h.sinOrg ? {} : { organizacion_id: f.org }) };
      for (const c of h.cols) if (!c.campo && c.k in f.vals) sk[c.k] = f.vals[c.k];
      if (h.id === 'equipos') sk.equipo_campos = {};
      m.cols[h.col].set(sk.id, sk);
      indexar(m, h.col, sk);
      agregarClave(m, h.col, clave, sk.id);
      if (h.id === 'puertos' && f.vals.equipo_id && f.vals.puerto_numero !== undefined) m.puertoPorNumero.set(f.vals.equipo_id + '|' + f.vals.puerto_numero, sk.id);
    }
  }
}

/** Dos filas con la misma clave dentro del archivo ya se marcaron; esto agrega a la fila su clave final si cambió el nombre. @param {Mundo} m @param {Hoja} h @param {Fila} f */
function revisarClaveFinal(m, h, f) {
  const nueva = claveDeRegistro(h, f.rec, m);
  if (f.clave && nueva !== f.clave) {
    const otros = (m.claves[h.col].get(nueva) || []).filter(id => id !== f.rec.id);
    if (otros.length) f.errores.push({ col: null, mensaje: 'ya existe otro registro con ese nombre en la organización' });
    else { f.clave = nueva; agregarClave(m, h.col, nueva, f.rec.id); }
  }
}

/** @param {Estado} est @param {Mundo} m @param {Plan} plan */
function pasadaB(est, m, plan) {
  const { h, filas } = est;
  if (h.dns) return;
  const orgNombre = (/** @type {string|null} */ id) => (id && m.cols.organizaciones.get(id) ? m.cols.organizaciones.get(id).organizacion_nombre : '');
  for (const f of filas) {
    if (f.org === null || f.idNuevo === '') continue;
    /** @param {string|null} col @param {string} mensaje */
    const err = (col, mensaje) => f.errores.push({ col, mensaje });
    const org = h.id === 'organizaciones' ? '' : f.org;
    // Referencias
    for (const c of h.cols) {
      if (c.k === 'organizacion_id' || !(c.t === 'ref' || c.t === 'listaRef' || c.t === 'refDin')) continue;
      const raw = celda(f, c.k);
      if (raw === undefined || (c.k in f.vals && c.t === 'ref')) { if (c.k in f.vals && c.t === 'ref') f.refs.add(f.vals[c.k]); continue; }
      /** @type {string} */
      let col;
      if (c.t === 'refDin') {
        col = COLECCION_DE_ENTIDAD[f.vals[/** @type {string} */ (c.segun)]];
        if (!col) { err(c.r, 'indicá primero el tipo de ficha'); continue; }
      } else col = /** @type {string} */ (c.ref);
      const textos = c.t === 'listaRef' ? String(raw).split(/[;\n]/).map(x => x.trim()).filter(Boolean) : [String(raw).trim()];
      /** @type {string[]} */
      const ids = [];
      for (const t of textos) {
        const r = buscar(m, col, org || '', t);
        if (r.length === 0) {
          // No existe ni en Infradoc ni en otra hoja: si se sabe con seguridad qué es, se crea con los datos mínimos (QC58-A).
          const a = intentarCrear(m, est, f, c, org || '', t);
          if (a && a.id) ids.push(a.id);
          else err(c.r, mensajeNoExiste(col, t, orgNombre(f.org), a ? a.error : undefined));
        }
        else if (r.length > 1) err(c.r, NOMBRE_REF[col] + ' «' + t + '» es ambigua: hay ' + r.length + ' con ese nombre; escribí el nombre completo o su id');
        else { ids.push(r[0]); if (m.autos.has(r[0])) anotarOrigen(m, r[0], { hoja: h.nombre, fila: f.n, col: c.r, f }); }
      }
      if (ids.length === textos.length) {
        f.vals[c.k] = c.t === 'listaRef' ? ids : ids[0];
        for (const id of ids) f.refs.add(id);
      }
    }
    // Una sala nueva que no dice su sede queda en la sede provisoria «Sin sede» (única por organización, para revisar).
    if (h.id === 'ubicaciones' && !f.existente && f.vals.ubicacion_tipo === 'sala' && celda(f, 'ubicacion_padre_id') === undefined && org) {
      const id = sinSede(m, org, { hoja: h.nombre, fila: f.n, col: 'Sede (para salas)', f });
      f.vals.ubicacion_padre_id = id;
      f.refs.add(id);
    }
    // Registro final
    const ex = f.existente;
    /** @type {any} */
    const rec = ex ? structuredClone(ex) : baseDe(h, f);
    rec.id = f.idNuevo;
    if (h.id === 'equipos' && !rec.equipo_campos) rec.equipo_campos = {};
    for (const c of h.cols) {
      if (c.virtual || c.k === 'organizacion_id' || !(c.k in f.vals)) continue;
      const destino = c.campo ? rec.equipo_campos : rec;
      const nuevo = f.vals[c.k];
      if (c.secreto) f.cambios.push(c.r);
      else if (!ex || comparable(c, destino[c.k]) !== comparable(c, nuevo)) f.cambios.push(c.r);
      destino[c.k] = nuevo;
    }
    if (!ex) {
      for (const c of h.cols) {
        if (c.virtual || c.k === 'organizacion_id' || c.campo) continue;
        if (c.k in f.vals) continue;
        if (c.def !== undefined) rec[c.k] = c.def;
        else if (c.req && celda(f, c.k) === undefined) err(c.r, 'falta «' + c.r + '» (obligatoria)');
      }
    }
    f.rec = rec;
    const hook = HOOKS[h.id];
    if (hook && (!ex || f.cambios.length)) hook(f, rec, m, err);
    if (!f.errores.length) {
      m.cols[h.col].set(rec.id, rec);
      indexar(m, h.col, rec);
      revisarClaveFinal(m, h, f);
    }
  }
  const post = POST[h.id];
  if (post) post(filas, m, plan);
  // Rótulos con la ruta completa: ahora que están todas las filas de la hoja.
  for (const f of filas) if (f.rec && !f.errores.length) indexar(m, h.col, m.cols[h.col].get(f.rec.id));
}

/** Registro nuevo con los valores por omisión de la hoja. @param {Hoja} h @param {Fila} f */
function baseDe(h, f) {
  /** @type {any} */
  const r = {};
  if (!h.sinOrg) r.organizacion_id = f.org;
  for (const c of h.cols) {
    if (c.virtual || c.k === 'organizacion_id' || c.campo) continue;
    r[c.k] = c.t === 'bool' ? false : c.t === 'lista' || c.t === 'listaRef' || c.t === 'pelos' || c.t === 'mediciones' ? [] : null;
  }
  if (h.id === 'puertos') Object.assign(r, { conectado_a_equipo_id: null, conectado_a_puerto_id: null });
  if (h.id === 'equipos') r.equipo_campos = {};
  if (h.id === 'servicios') r.servicio_registros = [];
  return r;
}

/** @param {Map<string, any>} estados */
function cascada(estados) {
  /** @type {Map<string, string>} */
  const invalidos = new Map();
  for (const est of estados.values()) for (const f of est.filas) if (f.errores.length && f.idNuevo && f.nuevo) invalidos.set(f.idNuevo, est.h.nombre + ', fila ' + f.n);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const est of estados.values()) {
      for (const f of est.filas) {
        if (f.errores.length) continue;
        for (const id of f.refs) {
          const donde = invalidos.get(id);
          if (donde) { f.errores.push({ col: null, mensaje: 'depende de ' + donde + ', que tiene errores' }); if (f.idNuevo && f.nuevo) invalidos.set(f.idNuevo, est.h.nombre + ', fila ' + f.n); cambio = true; break; }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Planillas del formato anterior: «Ubicaciones» con Edificio / Oficina (D-081, QC66-A)
// ---------------------------------------------------------------------------------------------

/**
 * Lee la hoja «Ubicaciones» del formato anterior como «Sedes y salas», con las mismas reglas que la migración del modelo 2 → 3
 * (`migrarUbicacionesASedesYSalas` en modelos.js): Oficina → Sala; un Edificio con sede arriba desaparece y sus salas pasan a esa
 * sede; un Edificio sin sede queda como sede; una sala sin sede arriba se convierte en sede. Lo que otras hojas decían del edificio
 * («Edificio Administración», «Planta / Edificio Administración / Sala 1») se redirige a donde quedó. En el formato nuevo, una sala
 * sin sede indicada no se toca acá: queda en «Sin sede» más adelante (`pasadaB`).
 * @param {Map<string, Estado>} estados @param {Mundo} m
 */
function adaptarSedesYSalas(estados, m) {
  const est = estados.get('ubicaciones');
  if (!est) return;
  const { filas, res } = est;
  /** @param {Fila} f */
  const tipoTxt = f => { const v = celda(f, 'ubicacion_tipo'); return v === undefined ? '' : nrm(v); };
  const viejo = !!est.viejo || filas.some(f => ['edificio', 'oficina'].includes(tipoTxt(f)));
  if (!viejo) return;

  /** @typedef {{f: Fila, org: string, nombre: string, tipo: string, padreTxt: string, actual: string, quitada: any, padre: any}} Info */
  /** @type {Info[]} */
  const infos = filas.map(f => {
    const t = tipoTxt(f);
    const pv = celda(f, 'ubicacion_padre_id');
    return { f, org: nrm(celda(f, 'organizacion_id') ?? ''), nombre: String(celda(f, 'ubicacion_nombre') ?? '').trim(), tipo: t === 'oficina' ? 'sala' : t,
      padreTxt: pv === undefined ? '' : String(pv).trim(), actual: t === 'oficina' ? 'sala' : t, quitada: null, padre: null };
  });
  /** @type {Map<string, Info[]>} */
  const porNombre = new Map();
  for (const i of infos) if (i.nombre) { const k = i.org + '|' + nrm(i.nombre); if (!porNombre.has(k)) porNombre.set(k, []); /** @type {Info[]} */ (porNombre.get(k)).push(i); }
  const ultimo = (/** @type {string} */ t) => { const p = t.split(/\s*\/\s*/).filter(Boolean); return p.length ? p[p.length - 1] : ''; };
  /** Superior de una fila: otra fila de la hoja, un texto externo (algo ya cargado, o que se creará) o nada. @param {Info} i @returns {{info: Info|null, ext: string}|null} */
  const superiorDe = i => {
    if (!i.padreTxt) return null;
    const partes = i.padreTxt.split(/\s*\/\s*/).filter(Boolean);
    let cand = (porNombre.get(i.org + '|' + nrm(ultimo(i.padreTxt))) || []).filter(x => x !== i);
    if (cand.length > 1 && partes.length > 1) cand = cand.filter(x => nrm(ultimo(x.padreTxt)) === nrm(partes[partes.length - 2]));
    return cand.length === 1 ? { info: cand[0], ext: '' } : { info: null, ext: i.padreTxt };
  };
  /** Sede más cercana por encima (cuenta el tipo `actual`). @param {Info} i @returns {{info: Info|null, ext: string}|null} */
  const sedeArriba = i => {
    let p = superiorDe(i);
    for (let v = 0; p && v < 50; v++) {
      if (!p.info) return p;
      if (p.info.actual === 'sede') return p;
      p = superiorDe(p.info);
    }
    return null;
  };
  // 1) Edificios: se eliminan (o se quedan como sede si no hay sede arriba).
  const edificios = infos.filter(i => i.tipo === 'edificio');
  for (const e of edificios) e.quitada = sedeArriba(e);
  for (const e of edificios) if (!e.quitada) { e.actual = 'sede'; e.padre = null; }
  // 2) Salas: cuelgan de la sede más cercana; sin sede, pasan a ser sede. Las sedes no tienen superior.
  let aSede = 0;
  for (const i of infos) {
    if (i.quitada || i.actual === 'sede' || !['sala', 'oficina'].includes(i.tipo)) continue;
    const p = superiorDe(i);
    if (p && (!p.info || p.info.actual === 'sede')) { i.padre = p; continue; }
    const d = sedeArriba(i);
    if (d) i.padre = d; else { i.actual = 'sede'; i.padre = null; aSede++; }
  }
  // Escribir lo adaptado en las filas y sacar los edificios que se eliminan.
  /** @param {Info} i @returns {string} */
  const refNueva = i => (i.quitada ? (i.quitada.info ? refNueva(i.quitada.info) : i.quitada.ext) : i.actual === 'sede' ? i.nombre : (i.padre ? (i.padre.info ? i.padre.info.nombre : ultimo(i.padre.ext)) + ' / ' + i.nombre : i.nombre));
  /** @type {Map<string, string>} */
  const redirigir = new Map();
  /** @param {Info} i */
  const rutaVieja = i => { const n = [i.nombre]; let p = superiorDe(i); for (let v = 0; p && p.info && v < 20; v++) { n.unshift(p.info.nombre); p = superiorDe(p.info); } return n.join(' / '); };
  let sedesDeEdificio = 0, edificiosQuitados = 0, oficinas = 0;
  for (const i of infos) {
    if (!i.nombre) continue;
    if (i.tipo === 'oficina' || tipoTxt(i.f) === 'oficina') oficinas++;
    const nueva = refNueva(i);
    if (i.quitada) redirigir.set(i.org + '|' + nrm(i.nombre), nueva);
    const vieja = rutaVieja(i);
    if (vieja.includes(' / ') && nrm(vieja) !== nrm(nueva)) redirigir.set(i.org + '|' + nrm(vieja), nueva);
    if (i.quitada) { edificiosQuitados++; continue; }
    if (i.tipo === 'edificio') sedesDeEdificio++;
    if (!i.tipo) continue;
    i.f.cel.set('ubicacion_tipo', i.actual === 'sede' ? 'Sede' : 'Sala');
    i.f.cel.set('ubicacion_padre_id', i.actual === 'sede' || !i.padre ? null : (i.padre.info ? i.padre.info.nombre : ultimo(i.padre.ext)));
  }
  for (let k = filas.length - 1; k >= 0; k--) if (infos[k].quitada) filas.splice(k, 1);
  // Las otras hojas que nombran una sede o sala: se redirige lo que decía de un edificio o de una ruta vieja.
  if (redirigir.size) {
    for (const o of estados.values()) {
      for (const c of o.h.cols) {
        const esUb = c.ref === 'ubicaciones';
        const esNota = o.h.id === 'notas' && c.t === 'refDin';
        if (!(esUb || esNota) || o.h.id === 'ubicaciones') continue;
        for (const f of o.filas) {
          const v = celda(f, c.k);
          if (v === undefined || (esNota && nrm(celda(f, 'entidad') ?? '') !== 'ubicacion')) continue;
          const nuevo = redirigir.get(nrm(celda(f, 'organizacion_id') ?? '') + '|' + nrm(v));
          if (nuevo) f.cel.set(c.k, nuevo);
        }
      }
    }
  }
  const partes = [];
  if (oficinas) partes.push(oficinas + ' oficina' + (oficinas === 1 ? '' : 's') + ' pasan a ser sala' + (oficinas === 1 ? '' : 's'));
  if (edificiosQuitados) partes.push(edificiosQuitados + ' edificio' + (edificiosQuitados === 1 ? '' : 's') + ' con sede arriba se unen a su sede (sus salas pasan a ella)');
  if (sedesDeEdificio) partes.push(sedesDeEdificio + ' edificio' + (sedesDeEdificio === 1 ? '' : 's') + ' sin sede arriba queda' + (sedesDeEdificio === 1 ? '' : 'n') + ' como sede');
  if (aSede) partes.push(aSede + ' sala' + (aSede === 1 ? '' : 's') + ' sin sede arriba pasa' + (aSede === 1 ? '' : 'n') + ' a ser sede');
  res.avisos.push('Planilla del formato anterior: la hoja «Ubicaciones» (columna «Ubicación superior») se leyó como «Sedes y salas»' + (partes.length ? ': ' + partes.join('; ') : '') + '. Las mismas reglas que la migración de los datos.');
}

// ---------------------------------------------------------------------------------------------
// Crear lo que falta (D-083, QC58-A)
// ---------------------------------------------------------------------------------------------

/** @typedef {{hoja: string, fila: number, col: string|null, f: Fila}} Origen La fila y columna que pide algo que no existe. */

/** @typedef {Object} Auto Algo que se crea porque una fila lo menciona y no existe.
 * @property {string} id
 * @property {string} col Colección.
 * @property {string} hojaId Hoja de la planilla donde se cargaría (decide cuándo se guarda).
 * @property {any} rec
 * @property {string} tipo Qué es («Sala», «Rack»…).
 * @property {string} nombre
 * @property {string} detalle Con qué datos se crea.
 * @property {Origen[]} origenes Las filas que lo piden.
 * @property {string[]} deps Otras creaciones automáticas de las que depende (si esta se crea, esas también).
 */

/** Nombre de la sede provisoria donde cae lo que no dice a qué sede pertenece (única por organización, «para revisar»). */
const NOMBRE_SIN_SEDE = 'Sin sede';
const NOTA_AUTO = 'Creado automáticamente al importar una planilla de Excel porque otra fila lo mencionaba y no existía. Completá sus datos y revisalo.';
const NOTA_SIN_SEDE = 'PARA REVISAR. Sede provisoria creada al importar una planilla de Excel: agrupa las salas, racks y puestos que no decían a qué sede pertenecen. Pasá cada uno a su sede real y después dala de baja.';
/** Alto (U) de un rack que se crea solo, porque la planilla no lo dice. */
const ALTO_RACK_POR_DEFECTO = 42;
/** Texto de un campo obligatorio que no se puede deducir (servidor creado solo). */
const A_COMPLETAR = 'A completar';

/** Qué se crea solo cuando una referencia no existe: hoja → columna → qué. Lo demás sigue siendo un error de la fila. @type {Object<string, Object<string, string>>} */
const CREABLE = {
  ubicaciones: { ubicacion_padre_id: 'sede' },
  racks: { ubicacion_id: 'ubicacion' },
  puestos: { ubicacion_id: 'ubicacion' },
  equipos: { ubicacion_id: 'ubicacion', rack_id: 'rack', puesto_id: 'puesto', host_id: 'servidor', impresora_pc_id: 'pc', reloj_pc_descarga_id: 'pc' },
  puertos: { vlan_nativa_id: 'vlan', vlans_etiquetadas: 'vlan', puesto_id: 'puesto' },
  wifi: { vlan_id: 'vlan', credencial_id: 'credencial_wifi', access_point_ids: 'access_point' },
  personas: { puesto_id: 'puesto' },
  cuentas: { persona_id: 'persona', credencial_id: 'credencial_dominio' },
  asignaciones: { persona_id: 'persona' },
  mapeos: { equipo_id: 'servidor', persona_id: 'persona' },
  licencias: { credencial_id: 'credencial_licencia' },
  instalaciones: { cuenta_id: 'cuenta', persona_id: 'persona' },
  servicios: { credencial_id: 'credencial_servicio' },
  tramos: { tramo_origen_ubicacion_id: 'ubicacion', tramo_destino_ubicacion_id: 'ubicacion', tramo_origen_equipo_id: 'patchera', tramo_destino_equipo_id: 'patchera' },
  dns: { servicio_id: 'dominio' }
};

/** Por qué algo que falta NO se crea solo, por colección a la que apunta la referencia. @type {Object<string, string>} */
const NO_CREABLE = {
  organizaciones: 'las organizaciones se cargan a propósito en la hoja Organizaciones',
  equipos: 'no se sabe de qué tipo de equipo es: cargalo en la hoja Equipos',
  enlaces_isp: 'falta el medio (fibra, radioenlace…): cargalo en la hoja Enlaces ISP',
  configuraciones: 'falta su contenido: cargala en la hoja Configuraciones',
  licencias: 'falta el tipo de licencia: cargala en la hoja Licencias',
  credenciales: 'no se sabe de qué tipo es: cargala en la hoja Credenciales',
  servicios: 'no se sabe de qué tipo es: cargalo en la hoja Servicios'
};

/** Registro nuevo con los valores por omisión de su hoja. @param {string} hojaId @param {string} org @param {Object<string, any>} valores */
function registroNuevo(hojaId, org, valores) {
  const h = hojaPorId(hojaId);
  const rec = baseDe(h, /** @type {any} */ ({ org }));
  for (const c of h.cols) if (!c.virtual && c.k !== 'organizacion_id' && !c.campo && c.def !== undefined) rec[c.k] = c.def;
  Object.assign(rec, valores);
  rec.id = crypto.randomUUID();
  return rec;
}

/** Lo agrega al «mundo» (para que las demás filas lo encuentren por nombre) y lo anota como «se va a crear». @param {Mundo} m @param {string} hojaId @param {any} rec @param {{tipo: string, nombre: string, detalle: string, origen: Origen, deps?: string[]}} d */
function registrarAuto(m, hojaId, rec, d) {
  const h = hojaPorId(hojaId);
  m.cols[h.col].set(rec.id, rec);
  indexar(m, h.col, rec);
  m.autos.set(rec.id, { id: rec.id, col: h.col, hojaId, rec, tipo: d.tipo, nombre: d.nombre, detalle: d.detalle, origenes: [d.origen], deps: (d.deps || []).filter(Boolean) });
  return rec.id;
}

/** Otra fila también pide algo ya planeado. @param {Mundo} m @param {string} id @param {Origen} origen */
function anotarOrigen(m, id, origen) {
  const a = m.autos.get(id);
  if (a && !a.origenes.some(o => o.f === origen.f && o.col === origen.col)) a.origenes.push(origen);
}

/** @param {Mundo} m @param {string} org @param {string} nombre */
function sedeNombrada(m, org, nombre) {
  const n = nrm(nombre);
  for (const u of m.cols.ubicaciones.values()) if (u.organizacion_id === org && u.ubicacion_tipo === 'sede' && nrm(u.ubicacion_nombre) === n) return u;
  return null;
}

/** @param {Mundo} m @param {string} org @param {string} sedeId @param {string} nombre */
function salaNombrada(m, org, sedeId, nombre) {
  const n = nrm(nombre);
  for (const u of m.cols.ubicaciones.values()) if (u.organizacion_id === org && u.ubicacion_tipo === 'sala' && u.ubicacion_padre_id === sedeId && nrm(u.ubicacion_nombre) === n) return u;
  return null;
}

/** La sede «Sin sede» de la organización (la que ya hay o la que se va a crear, una sola). @param {Mundo} m @param {string} org @param {Origen} origen @returns {string} */
function sinSede(m, org, origen) {
  const ex = sedeNombrada(m, org, NOMBRE_SIN_SEDE);
  if (ex) { anotarOrigen(m, ex.id, origen); return ex.id; }
  const rec = registroNuevo('ubicaciones', org, { ubicacion_nombre: NOMBRE_SIN_SEDE, ubicacion_tipo: 'sede', ubicacion_padre_id: null, ubicacion_notas: NOTA_SIN_SEDE });
  return registrarAuto(m, 'ubicaciones', rec, { tipo: 'Sede', nombre: NOMBRE_SIN_SEDE, detalle: 'sede provisoria «para revisar» (junta lo que no dice a qué sede pertenece)', origen });
}

/** @param {Mundo} m @param {string} org @param {string} nombre @param {Origen} origen @returns {string} */
function crearSede(m, org, nombre, origen) {
  const ex = sedeNombrada(m, org, nombre);
  if (ex) { anotarOrigen(m, ex.id, origen); return ex.id; }
  if (nrm(nombre) === nrm(NOMBRE_SIN_SEDE)) return sinSede(m, org, origen);
  const rec = registroNuevo('ubicaciones', org, { ubicacion_nombre: nombre, ubicacion_tipo: 'sede', ubicacion_padre_id: null, ubicacion_notas: NOTA_AUTO });
  return registrarAuto(m, 'ubicaciones', rec, { tipo: 'Sede', nombre, detalle: 'solo con el nombre (sin dirección)', origen });
}

/** @param {Mundo} m @param {string} org @param {string} nombre @param {string} sedeId @param {Origen} origen @returns {string} */
function crearSala(m, org, nombre, sedeId, origen) {
  const ex = salaNombrada(m, org, sedeId, nombre);
  if (ex) { anotarOrigen(m, ex.id, origen); return ex.id; }
  const sede = m.cols.ubicaciones.get(sedeId);
  const provisoria = !!sede && nrm(sede.ubicacion_nombre) === nrm(NOMBRE_SIN_SEDE);
  const rec = registroNuevo('ubicaciones', org, { ubicacion_nombre: nombre, ubicacion_tipo: 'sala', ubicacion_padre_id: sedeId, ubicacion_notas: provisoria ? 'PARA REVISAR. ' + NOTA_AUTO + ' No decía a qué sede pertenece: pasala a su sede real.' : NOTA_AUTO });
  return registrarAuto(m, 'ubicaciones', rec, { tipo: 'Sala', nombre, detalle: 'en la sede «' + (sede ? sede.ubicacion_nombre : '?') + '»' + (provisoria ? ' (provisoria, para revisar)' : '') + ', sin más datos', origen, deps: [sedeId] });
}

/**
 * Una sede o sala que no existe. `modo` «sede»: se pide una sede (columna «Sede (para salas)»). `modo` «cualquiera»: un nombre
 * suelto es una SALA de la sede «Sin sede»; «Sede / Sala» crea la sede (si falta) y su sala.
 * @param {Mundo} m @param {string} org @param {string} texto @param {'sede'|'cualquiera'} modo @param {Origen} origen @returns {{id?: string, error?: string}}
 */
function crearUbicacionPorTexto(m, org, texto, modo, origen) {
  const partes = texto.split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean);
  if (!partes.length) return {};
  if (partes.length > 2) return { error: 'tiene más de dos niveles: una sede y su sala se escriben «Sede / Sala»' };
  if (modo === 'sede') return partes.length > 1 ? { error: 'una sede se escribe solo con su nombre' } : { id: crearSede(m, org, partes[0], origen) };
  if (partes.length === 1) {
    if (nrm(partes[0]) === nrm(NOMBRE_SIN_SEDE)) return { id: sinSede(m, org, origen) };
    return { id: crearSala(m, org, partes[0], sinSede(m, org, origen), origen) };
  }
  return { id: crearSala(m, org, partes[1], crearSede(m, org, partes[0], origen), origen) };
}

/** @param {Mundo} m @param {string} org @param {string} nombre @param {string|null} ubicacionId @param {Origen} origen @returns {string} */
function crearRack(m, org, nombre, ubicacionId, origen) {
  const ub = ubicacionId || sinSede(m, org, origen);
  const rec = registroNuevo('racks', org, { rack_nombre: nombre, ubicacion_id: ub, rack_unidades_total: ALTO_RACK_POR_DEFECTO, rack_notas: NOTA_AUTO });
  return registrarAuto(m, 'racks', rec, { tipo: 'Rack', nombre, detalle: 'alto ' + ALTO_RACK_POR_DEFECTO + ' U, en «' + rutaUbicacion(m.cols.ubicaciones.get(ub), m) + '»', origen, deps: [ub] });
}

/** @param {Mundo} m @param {string} org @param {string} nombre @param {string|null} ubicacionId @param {Origen} origen @returns {string} */
function crearPuesto(m, org, nombre, ubicacionId, origen) {
  const ub = ubicacionId || sinSede(m, org, origen);
  const rec = registroNuevo('puestos', org, { puesto_nombre: nombre, ubicacion_id: ub, puesto_notas: NOTA_AUTO });
  return registrarAuto(m, 'puestos', rec, { tipo: 'Puesto', nombre, detalle: 'en «' + rutaUbicacion(m.cols.ubicaciones.get(ub), m) + '», sin boca de pared', origen, deps: [ub] });
}

/** «10», «10 - Administración». @param {Mundo} m @param {string} org @param {string} texto @param {Origen} origen @returns {{id?: string, error?: string}} */
function crearVlan(m, org, texto, origen) {
  const x = /^(\d{1,4})\s*(?:[-–—:·]\s*(.*))?$/.exec(texto.trim());
  if (!x) return { error: 'una VLAN solo se puede crear sola si se escribe con su número («10» o «10 - Administración»)' };
  const n = Number(x[1]);
  if (n < 1 || n > 4094) return { error: 'el número de VLAN tiene que estar entre 1 y 4094' };
  const nombre = (x[2] || '').trim() || 'VLAN ' + n;
  const rec = registroNuevo('vlans', org, { vlan_numero: n, vlan_nombre: nombre, vlan_dhcp_activo: false, vlan_descripcion: NOTA_AUTO });
  return { id: registrarAuto(m, 'vlans', rec, { tipo: 'VLAN', nombre: n + ' - ' + nombre, detalle: 'número ' + n + (x[2] ? '' : ' y nombre «' + nombre + '»') + ', sin red ni DHCP', origen }) };
}

/** «Ana Pérez» o «Ana Pérez (Ventas)». @param {Mundo} m @param {string} org @param {string} texto @param {Origen} origen @returns {string} */
function crearPersona(m, org, texto, origen) {
  const x = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(texto.trim());
  const nombre = x && x[1] ? x[1] : texto.trim(), sector = x && x[1] ? x[2].trim() : null;
  const rec = registroNuevo('personas', org, { persona_nombre: nombre, persona_sector: sector, persona_notas: NOTA_AUTO });
  return registrarAuto(m, 'personas', rec, { tipo: 'Persona', nombre, detalle: (sector ? 'sector «' + sector + '», ' : '') + 'estado Activa, sin puesto', origen });
}

/** @param {Mundo} m @param {string} org @param {string} nombre @param {string} tipo clave de `ROTULO_CREDENCIAL_TIPO` @param {Origen} origen @returns {string} */
function crearCredencial(m, org, nombre, tipo, origen) {
  const rec = registroNuevo('credenciales', org, { credencial_tipo: tipo, credencial_nombre: nombre, credencial_notas: NOTA_AUTO });
  return registrarAuto(m, 'credenciales', rec, { tipo: 'Credencial', nombre, detalle: 'de tipo «' + (ROTULO_CREDENCIAL_TIPO[tipo] || tipo) + '», sin contraseña', origen });
}

/**
 * Un equipo con solo su nombre y el tipo (que la referencia deja claro). Los campos obligatorios del tipo toman el valor inicial
 * de la ficha; los de texto, «A completar».
 * @param {Mundo} m @param {string} org @param {string} nombre @param {string} tipo @param {string|null} categoria @param {Origen} origen @returns {string}
 */
function crearEquipo(m, org, nombre, tipo, categoria, origen) {
  const rec = registroNuevo('equipos', org, { equipo_tipo: tipo, equipo_nombre: nombre, equipo_notas: NOTA_AUTO });
  rec.equipo_campos = categoria ? { otro_categoria: categoria } : {};
  let completar = false;
  for (const c of columnasEquipo()) {
    if (!/** @type {(e: any) => boolean} */ (c.aplica)(rec) || c.k in rec.equipo_campos || !c.req) continue;
    if (c.t === 'bool') rec.equipo_campos[c.k] = false;
    else if (c.t === 'entero') rec.equipo_campos[c.k] = 0;
    else if (c.t === 'enum' && c.op) rec.equipo_campos[c.k] = c.num ? Number(c.op[0][0]) : c.op[0][0];
    else { rec.equipo_campos[c.k] = A_COMPLETAR; completar = true; }
  }
  const rotulo = categoria || ROTULO_EQUIPO_TIPO[tipo] || tipo;
  return registrarAuto(m, 'equipos', rec, { tipo: 'Equipo (' + rotulo + ')', nombre, detalle: 'solo con el nombre y el tipo, sin ubicación' + (completar ? '; rol y sistema operativo «' + A_COMPLETAR + '»' : ''), origen });
}

/** «DOMINIO\usuario». @param {Mundo} m @param {string} org @param {string} texto @param {Origen} origen @returns {{id?: string, error?: string}} */
function crearCuenta(m, org, texto, origen) {
  const x = /^([^\\]+)\\(.+)$/.exec(texto.trim());
  if (!x) return { error: 'una cuenta de dominio solo se puede crear sola si se escribe «DOMINIO\\usuario»' };
  const rec = registroNuevo('cuentas', org, { cuenta_dominio: x[1].trim(), cuenta_usuario: x[2].trim() });
  return { id: registrarAuto(m, 'cuentas', rec, { tipo: 'Cuenta de dominio', nombre: x[1].trim() + '\\' + x[2].trim(), detalle: 'habilitada, sin persona (cuenta de servicio)', origen }) };
}

/** Un servicio de tipo dominio (el que lleva registros DNS). @param {Mundo} m @param {string} org @param {string} nombre @param {Origen} origen @returns {string} */
function crearDominio(m, org, nombre, origen) {
  const rec = registroNuevo('servicios', org, { servicio_tipo: 'dominio', servicio_nombre: nombre });
  return registrarAuto(m, 'servicios', rec, { tipo: 'Servicio (dominio)', nombre, detalle: 'solo con el nombre, sin proveedor ni vencimiento', origen });
}

/** Ubicación donde poner un puesto que se crea solo: la del equipo de la fila, si se sabe. @param {Mundo} m @param {Fila} f @returns {string|null} */
function ubicacionDeLaFila(m, f) {
  if (f.vals.ubicacion_id) return f.vals.ubicacion_id;
  const rk = f.vals.rack_id ? m.cols.racks.get(f.vals.rack_id) : null;
  if (rk && rk.ubicacion_id) return rk.ubicacion_id;
  const e = f.vals.equipo_id ? m.cols.equipos.get(f.vals.equipo_id) : null;
  return e && e.ubicacion_id ? e.ubicacion_id : null;
}

/**
 * Una referencia no existe: si se puede deducir con seguridad qué es, se planea crearla con los datos mínimos.
 * Devuelve `{id}` (creada o reusada), `{error}` (se sabe qué es pero el texto no alcanza) o `null` (no se puede crear sola).
 * @param {Mundo} m @param {Estado} est @param {Fila} f @param {Col} c @param {string} org @param {string} texto
 * @returns {{id?: string, error?: string}|null}
 */
function intentarCrear(m, est, f, c, org, texto) {
  const que = (CREABLE[est.h.id] || {})[c.k];
  if (!que || !org) return null;
  /** @type {Origen} */
  const origen = { hoja: est.h.nombre, fila: f.n, col: c.r, f };
  const t = texto.trim();
  switch (que) {
    case 'sede': return crearUbicacionPorTexto(m, org, t, 'sede', origen);
    case 'ubicacion': return crearUbicacionPorTexto(m, org, t, 'cualquiera', origen);
    case 'rack': return { id: crearRack(m, org, t, f.vals.ubicacion_id || null, origen) };
    case 'puesto': return { id: crearPuesto(m, org, t, ubicacionDeLaFila(m, f), origen) };
    case 'vlan': return crearVlan(m, org, t, origen);
    case 'persona': return { id: crearPersona(m, org, t, origen) };
    case 'servidor': return { id: crearEquipo(m, org, t, 'servidor', null, origen) };
    case 'access_point': return { id: crearEquipo(m, org, t, 'access_point', null, origen) };
    case 'patchera': return { id: crearEquipo(m, org, t, 'patchera', null, origen) };
    case 'pc': return { id: crearEquipo(m, org, t, 'otro', 'PC de escritorio', origen) };
    case 'credencial_wifi': return { id: crearCredencial(m, org, t, 'wifi', origen) };
    case 'credencial_dominio': return { id: crearCredencial(m, org, t, 'dominio', origen) };
    case 'credencial_licencia': return { id: crearCredencial(m, org, t, 'clave_licencia', origen) };
    case 'credencial_servicio': return { id: crearCredencial(m, org, t, { hosting: 'hosting', correo: 'correo', dominio: 'nic_dns', dns: 'nic_dns' }[/** @type {'hosting'} */ (f.vals.servicio_tipo)] || 'otro', origen) };
    case 'cuenta': return crearCuenta(m, org, t, origen);
    case 'dominio': return { id: crearDominio(m, org, t, origen) };
    default: return null;
  }
}

/** Mensaje de una referencia que no existe y no se crea sola. @param {string} col @param {string} texto @param {string} nombreOrg @param {string|undefined} [error] */
function mensajeNoExiste(col, texto, nombreOrg, error) {
  const base = NOMBRE_REF[col] + ' «' + texto + '» no existe en ' + (nombreOrg || 'la organización') + (HOJA_DE_COLECCION[col] ? ' (ni en la hoja ' + HOJA_DE_COLECCION[col] + ')' : '');
  if (error) return base + ' y no se puede crear sola: ' + error;
  return base + (NO_CREABLE[col] ? ' y no se crea sola: ' + NO_CREABLE[col] : '');
}

/**
 * Una vez resueltas las filas: se queda con lo que de verdad hace falta (lo que pide alguna fila SIN errores, y de lo que eso
 * depende) y arma la lista de «se va a crear» y las acciones para guardarlo.
 * @param {Mundo} m @param {Plan} plan
 */
function cerrarCreaciones(m, plan) {
  /** @type {Set<string>} */
  const quedan = new Set();
  /** @param {string} id */
  const visitar = id => { if (quedan.has(id)) return; const a = m.autos.get(id); if (!a) return; quedan.add(id); a.deps.forEach(visitar); };
  for (const a of m.autos.values()) if (a.origenes.some(o => !o.f.errores.length)) visitar(a.id);
  for (const a of m.autos.values()) {
    if (!quedan.has(a.id)) continue;
    const validos = a.origenes.filter(o => !o.f.errores.length);
    const desde = (validos.length ? validos : a.origenes).filter((o, i, l) => l.findIndex(x => x.hoja === o.hoja && x.fila === o.fila && x.col === o.col) === i);
    const org = m.cols.organizaciones.get(a.rec.organizacion_id);
    plan.creaciones.push({ tipo: a.tipo, nombre: a.nombre, detalle: a.detalle, organizacion: org ? org.organizacion_nombre : '', desde: desde.slice(0, 3).map(o => ({ hoja: o.hoja, fila: o.fila, columna: o.col })), total: desde.length });
    plan.acciones_auto.push({ col: a.col, op: 'crear', rec: a.rec, hoja: hojaPorId(a.hojaId).nombre, fila: (validos[0] || a.origenes[0]).fila, hojaId: a.hojaId, auto: true });
  }
}

// ---- Validaciones propias de cada hoja ----

/** @type {Object<string, (f: Fila, rec: any, m: Mundo, err: (col: string|null, mensaje: string) => void) => void>} */
const HOOKS = {
  ubicaciones(f, rec, m, err) {
    if (rec.ubicacion_padre_id === rec.id) { err('Sede (para salas)', 'una sala no puede ser su propia sede'); return; }
    if (rec.ubicacion_tipo === 'sede' && rec.ubicacion_padre_id) err('Sede (para salas)', 'una sede no tiene sede superior (pertenece a la organización): ese campo es solo para las salas');
    if (rec.ubicacion_tipo === 'sala') {
      const sede = rec.ubicacion_padre_id ? m.cols.ubicaciones.get(rec.ubicacion_padre_id) : null;
      if (!rec.ubicacion_padre_id) err('Sede (para salas)', 'una sala necesita su sede');
      else if (sede && sede.ubicacion_tipo !== 'sede') err('Sede (para salas)', 'la sede de una sala tiene que ser una sede, no otra sala');
    }
    // Ciclos: se sigue la cadena de padres usando las filas ya vistas y las existentes.
    let p = rec.ubicacion_padre_id;
    for (let i = 0; p && i < 30; i++) { if (p === rec.id) { err('Sede (para salas)', 'forma un ciclo de sedes y salas'); return; } const x = m.cols.ubicaciones.get(p); p = x && x.ubicacion_padre_id; }
  },
  racks(f, rec, m, err) {
    if (rec.rack_unidades_total != null && rec.rack_unidades_total < 1) err('Unidades (U) totales', 'tiene que ser al menos 1');
  },
  vlans(f, rec, m, err) {
    if (rec.vlan_numero != null && (rec.vlan_numero < 1 || rec.vlan_numero > 4094)) err('Número (1–4094)', 'tiene que estar entre 1 y 4094');
    if (rec.vlan_dhcp_activo && !rec.vlan_dhcp_rango) err('Rango DHCP', 'falta el rango, porque el DHCP está activo');
  },
  equipos(f, rec, m, err) {
    const ex = f.existente;
    if (ex && f.vals.equipo_tipo && ex.equipo_tipo !== f.vals.equipo_tipo) err('Tipo', 'el tipo de un equipo no se puede cambiar (es «' + (ROTULO_EQUIPO_TIPO[ex.equipo_tipo] || ex.equipo_tipo) + '»)');
    if (!rec.equipo_tipo) return;
    // Campos del tipo: solo los que corresponden; los obligatorios vacíos toman el valor inicial de la ficha.
    for (const c of columnasEquipo()) {
      const aplica = /** @type {(e: any) => boolean} */ (c.aplica)(rec);
      if (!aplica) { if (c.k in f.vals) err(c.r, 'no corresponde a un equipo de tipo «' + (ROTULO_EQUIPO_TIPO[rec.equipo_tipo] || rec.equipo_tipo) + '»' + (rec.equipo_tipo === 'otro' ? ' con esa categoría' : '')); continue; }
      if (ex || c.k in rec.equipo_campos || !c.req) continue;
      if (c.t === 'bool') rec.equipo_campos[c.k] = false;
      else if (c.t === 'entero') rec.equipo_campos[c.k] = 0;
      else if (c.t === 'enum' && c.op) rec.equipo_campos[c.k] = c.num ? Number(c.op[0][0]) : c.op[0][0];
      else err(c.r, 'falta «' + c.r + '» (obligatoria para este tipo de equipo)');
    }
    // Rack, ubicación y puesto
    if (rec.rack_id) {
      const rk = m.cols.racks.get(rec.rack_id);
      if (rec.rack_u_inicio == null || rec.rack_u_alto == null) err('Posición (U)', 'si hay rack hay que indicar la posición (U inicial) y cuántas U ocupa');
      else if (rk && (rec.rack_u_inicio < 1 || rec.rack_u_alto < 1 || rec.rack_u_inicio + rec.rack_u_alto - 1 > rk.rack_unidades_total)) err('Posición (U)', 'no entra en el rack «' + rk.rack_nombre + '» (' + rk.rack_unidades_total + ' U)');
      if (rk) {
        if (f.vals.ubicacion_id && f.vals.ubicacion_id !== rk.ubicacion_id) err('Sede / sala', 'si está en un rack, la sede o sala es la del rack');
        rec.ubicacion_id = rk.ubicacion_id;
      }
    } else if ((f.vals.rack_u_inicio != null || f.vals.rack_u_alto != null) && !ex) err('Rack', 'hay U pero falta el rack');
    if (rec.puesto_id && !rec.ubicacion_id) { const p = m.cols.puestos.get(rec.puesto_id); if (p) rec.ubicacion_id = p.ubicacion_id; }
    // Código único
    const cod = nrm(rec.equipo_codigo);
    if (cod) { const otro = m.codigos.get(f.org + '|' + cod); if (otro && otro !== rec.id) err('Código', 'el código «' + rec.equipo_codigo + '» ya lo tiene otro equipo'); else m.codigos.set(f.org + '|' + cod, rec.id); }
  },
  puertos(f, rec, m, err) {
    if (f.vals.conectado_a_descripcion && (f.vals.conectado_a_equipo_id || f.vals.conectado_a_puerto_numero != null)) err('Conectado a (texto libre)', 'tiene un equipo/puerto conectado y también un texto libre: dejá solo uno');
    if ((f.vals.conectado_a_equipo_id && f.vals.conectado_a_puerto_numero == null) || (!f.vals.conectado_a_equipo_id && f.vals.conectado_a_puerto_numero != null && !celda(f, 'conectado_a_equipo_id'))) err('Conectado a: n.º de puerto', 'para conectar hay que indicar el equipo y el n.º de puerto del otro lado');
    if (rec.puerto_numero != null && rec.puerto_numero < 1) err('N.º de puerto', 'tiene que ser al menos 1');
    if (f.vals.vlans_etiquetadas && rec.vlans_etiquetadas.length && rec.puerto_modo !== 'troncal') err('VLAN etiquetadas', 'solo un puerto en modo troncal lleva VLAN etiquetadas');
    const eq = m.cols.equipos.get(rec.equipo_id);
    if (rec.enlace_isp_id && eq && !['router', 'firewall'].includes(eq.equipo_tipo)) err('Enlace a Internet', 'solo un puerto de router o firewall puede ir a un enlace a Internet');
  },
  wifi(f, rec, m, err) {
    for (const id of rec.access_point_ids || []) { const e = m.cols.equipos.get(id); if (e && e.equipo_tipo !== 'access_point') err('Access points que la emiten', 'el equipo «' + e.equipo_nombre + '» no es un access point'); }
    if (rec.wifi_seguridad === 'abierta' && rec.credencial_id) err('Credencial con la clave', 'una red abierta no lleva clave');
  },
  enlaces(f, rec, m, err) {
    if (rec.equipo_id) { const e = m.cols.equipos.get(rec.equipo_id); if (e && !['router', 'firewall'].includes(e.equipo_tipo)) err('Router o firewall donde termina', 'el equipo «' + e.equipo_nombre + '» no es un router ni un firewall'); }
  },
  asignaciones(f, rec, m, err) {
    if (rec.asignacion_hasta && rec.asignacion_desde && rec.asignacion_hasta < rec.asignacion_desde) err('Hasta', 'no puede ser anterior a «Desde»');
    const p = rec.persona_id && m.cols.personas.get(rec.persona_id);
    if (p && p.persona_estado === 'baja' && !rec.asignacion_hasta && !f.existente) err('Persona', 'a una persona en baja no se le asigna un equipo nuevo');
  },
  mapeos(f, rec, m, err) {
    if (rec.mapeo_aplica_a === 'grupo' && !rec.mapeo_grupo) err('Grupo', 'falta el grupo, porque se aplica a un grupo');
    if (rec.mapeo_aplica_a === 'persona' && !rec.persona_id) err('Persona', 'falta la persona, porque se aplica a una persona');
    if (rec.mapeo_aplica_a !== 'grupo') rec.mapeo_grupo = null;
    if (rec.mapeo_aplica_a !== 'persona') rec.persona_id = null;
    if (rec.equipo_id) { const e = m.cols.equipos.get(rec.equipo_id); if (e && e.equipo_tipo !== 'servidor') err('Servidor que lo comparte', 'el equipo «' + e.equipo_nombre + '» no es un servidor'); }
  },
  licencias(f, rec, m, err) {
    if (rec.licencia_cantidad != null && rec.licencia_cantidad < 1) err('Cantidad', 'tiene que ser al menos 1');
  },
  instalaciones(f, rec, m, err) {
    if (rec.instalacion_hasta && rec.instalacion_desde && rec.instalacion_hasta < rec.instalacion_desde) err('Desinstalada el', 'no puede ser anterior a «Instalada desde»');
  },
  servicios(f, rec, m, err) {
    if (rec.servicio_tipo !== 'dominio' && rec.servicio_tipo !== 'dns' && rec.servicio_registros && rec.servicio_registros.length) err(null, 'solo un dominio o una zona DNS lleva registros DNS');
  },
  tramos(f, rec, m, err) {
    if (rec.tramo_pelos != null && rec.tramo_pelos < 1) err('Cantidad de pelos', 'tiene que ser al menos 1');
    if (rec.tramo_origen_ubicacion_id && rec.tramo_origen_ubicacion_id === rec.tramo_destino_ubicacion_id && (!rec.tramo_origen_equipo_id || rec.tramo_origen_equipo_id === rec.tramo_destino_equipo_id)) err('Destino: sede / sala', 'el origen y el destino no pueden ser el mismo');
    const usados = new Set();
    for (const u of rec.tramo_pelos_usados || []) {
      if (u.pelo < 1 || u.pelo > rec.tramo_pelos) err('Pelos usados', 'el pelo ' + u.pelo + ' no existe en un tramo de ' + rec.tramo_pelos + ' pelos');
      if (usados.has(u.pelo)) err('Pelos usados', 'el pelo ' + u.pelo + ' está repetido');
      usados.add(u.pelo);
    }
    for (const x of rec.tramo_mediciones || []) if (x.pelo < 1 || x.pelo > rec.tramo_pelos) err('Mediciones', 'la medición es de un pelo que no existe (' + x.pelo + ')');
  },
  notas(f, rec, m, err) {
    if (!!rec.entidad !== !!rec.entidad_id) err('Ficha', 'el tipo de ficha y la ficha van juntos (o los dos vacíos para una nota de la organización)');
  }
};

/** @type {Col[]|null} */
let colsEquipoCache = null;
/** Columnas de campos fijos de equipo. @returns {Col[]} */
function columnasEquipo() { return colsEquipoCache || (colsEquipoCache = hojaPorId('equipos').cols.filter(c => c.campo)); }

/** Pasos que necesitan ver todas las filas de la hoja. @type {Object<string, (filas: Fila[], m: Mundo, plan: Plan) => void>} */
const POST = {
  equipos(filas, m) {
    // Rack: sin superposición. Los equipos que ya están ocupan su lugar; entre las filas del archivo, gana la primera.
    const enArchivo = new Set(filas.map(f => f.idNuevo));
    /** @type {Map<string, any[]>} */
    const porRack = new Map();
    /** @param {any} e */
    const ocupar = e => { if (!porRack.has(e.rack_id)) porRack.set(e.rack_id, []); /** @type {any[]} */ (porRack.get(e.rack_id)).push(e); };
    for (const e of m.cols.equipos.values()) if (e.rack_id && e.rack_u_inicio != null && !enArchivo.has(e.id)) ocupar(e);
    for (const f of filas) {
      const r = f.rec;
      if (!r || f.errores.length || !r.rack_id || r.rack_u_inicio == null || r.rack_u_alto == null) continue;
      const toca = !f.existente || f.cambios.some(x => /rack|posici|U /i.test(x));
      let choca = null;
      if (toca) choca = (porRack.get(r.rack_id) || []).find(o => r.rack_u_inicio <= o.rack_u_inicio + o.rack_u_alto - 1 && o.rack_u_inicio <= r.rack_u_inicio + r.rack_u_alto - 1) || null;
      if (choca) f.errores.push({ col: 'Posición (U)', mensaje: 'se superpone con «' + choca.equipo_nombre + '» en el rack (' + (choca.rack_u_alto > 1 ? 'U ' + choca.rack_u_inicio + ' a ' + (choca.rack_u_inicio + choca.rack_u_alto - 1) : 'U ' + choca.rack_u_inicio) + ')' });
      else ocupar(r);
    }
  },
  puertos(filas, m, plan) {
    // Conexiones: se arman con el equipo y el n.º de puerto del otro lado; la conexión es simétrica.
    /** @type {Map<string, {otro: string, fila: Fila}>} */
    const deseadas = new Map();
    for (const f of filas) {
      if (!f.rec || f.errores.length) continue;
      const num = f.vals.conectado_a_puerto_numero;
      if (num == null) continue;
      const eqDest = f.vals.conectado_a_equipo_id;
      if (!eqDest) continue;
      const dest = m.puertoPorNumero.get(eqDest + '|' + num);
      const nombreEq = (m.cols.equipos.get(eqDest) || {}).equipo_nombre || '';
      if (!dest) { f.errores.push({ col: 'Conectado a: n.º de puerto', mensaje: 'el puerto ' + num + ' del equipo «' + nombreEq + '» no existe (cargalo antes en esta hoja)' }); continue; }
      if (dest === f.rec.id) { f.errores.push({ col: 'Conectado a: equipo', mensaje: 'un puerto no puede conectarse consigo mismo' }); continue; }
      if (f.rec.equipo_id === eqDest) { f.errores.push({ col: 'Conectado a: equipo', mensaje: 'no se puede conectar un equipo consigo mismo' }); continue; }
      f.refs.add(dest);
      deseadas.set(f.rec.id, { otro: dest, fila: f });
    }
    for (const [a, { otro, fila }] of deseadas) {
      const inversa = deseadas.get(otro);
      if (inversa && inversa.otro !== a) { fila.errores.push({ col: 'Conectado a: equipo', mensaje: 'el otro puerto dice estar conectado a otro lado (fila ' + inversa.fila.n + ')' }); continue; }
      const conOtro = Array.from(deseadas.entries()).find(([x, v]) => x !== a && v.otro === otro);
      if (conOtro) { fila.errores.push({ col: 'Conectado a: equipo', mensaje: 'el puerto de destino ya lo reclama la fila ' + conOtro[1].fila.n }); continue; }
      const ex = fila.existente;
      if (!ex || ex.conectado_a_puerto_id !== otro) fila.cambios.push('Conexión');
      if (!(inversa && inversa.otro === a && a > otro)) fila.deConexion.push(a + '>' + otro);
    }
    // Un texto libre no convive con una conexión que ya existe.
    for (const f of filas) {
      if (!f.rec || f.errores.length) continue;
      if (f.vals.conectado_a_descripcion && f.existente && f.existente.conectado_a_puerto_id) f.errores.push({ col: 'Conectado a (texto libre)', mensaje: 'el puerto ya está conectado a otro puerto: desconectalo en la ficha antes de poner un texto libre' });
    }
    void plan;
  }
};

/** Registros DNS: se agregan al servicio. @param {Map<string, any>} estados @param {Mundo} m @param {Plan} plan */
function aplicarDns(estados, m, plan) {
  const est = estados.get('dns');
  if (!est) return;
  const { h, res, filas } = est;
  /** @type {Map<string, any>} */
  const porId = new Map(plan.acciones.filter(a => a.col === 'servicios').map(a => [a.rec.id, a]));
  /** @type {Set<string>} */
  const vistos = new Set();
  for (const f of filas) {
    /** @param {string|null} col @param {string} mensaje */
    const err = (col, mensaje) => f.errores.push({ col, mensaje });
    if (f.errores.length || f.org === null) continue;
    const org = f.org;
    const sT = celda(f, 'servicio_id');
    let svId = '';
    if (sT === undefined) err('Servicio', 'falta el servicio'); else if (org) {
      const r = buscar(m, 'servicios', org, sT);
      if (r.length === 0) {
        // Los registros DNS son de un dominio: si el servicio no existe, se crea como dominio (QC58-A).
        svId = crearDominio(m, org, String(sT).trim(), { hoja: h.nombre, fila: f.n, col: 'Servicio', f });
      }
      else if (r.length > 1) err('Servicio', 'el servicio «' + sT + '» es ambiguo: escribí «nombre (Tipo)»');
      else { svId = r[0]; if (m.autos.has(svId)) anotarOrigen(m, svId, { hoja: h.nombre, fila: f.n, col: 'Servicio', f }); }
    }
    /** @type {any} */
    const g = {};
    for (const c of h.cols) {
      if (!c.k.startsWith('registro_')) continue;
      const raw = celda(f, c.k);
      if (raw === undefined) { if (c.req) err(c.r, 'falta «' + c.r + '»'); continue; }
      const v = leerValor(c, raw);
      if (v.error) err(c.r, v.error); else g[c.k.slice(9)] = v.v;
    }
    if (g.tipo === 'MX' ? false : g.prioridad != null) err('Prioridad', 'la prioridad es solo para registros MX');
    if (f.errores.length) { for (const e of f.errores) res.errores.push({ n: f.n, col: e.col, mensaje: e.mensaje }); continue; }
    const sv = /** @type {any} */ (m.cols.servicios.get(svId));
    const accionPrev = porId.get(svId);
    const esAuto = m.autos.has(svId);
    const rec = esAuto ? sv : accionPrev ? accionPrev.rec : structuredClone(sv);
    if (!['dominio', 'dns'].includes(rec.servicio_tipo)) { res.errores.push({ n: f.n, col: 'Servicio', mensaje: 'solo un dominio o una zona DNS lleva registros DNS' }); continue; }
    const clave = svId + '|' + g.tipo + '|' + nrm(g.nombre) + '|' + nrm(g.valor);
    const ya = vistos.has(clave) || (rec.servicio_registros || []).some((/** @type {any} */ x) => x.tipo === g.tipo && nrm(x.nombre) === nrm(g.nombre) && nrm(x.valor) === nrm(g.valor));
    vistos.add(clave);
    if (ya) { res.sinCambios++; continue; }
    const nuevo = { tipo: g.tipo, nombre: g.nombre, valor: g.valor, ...(g.prioridad != null ? { prioridad: g.prioridad } : {}) };
    rec.servicio_registros = [...(rec.servicio_registros || []), nuevo];
    if (!accionPrev && !esAuto) { const a = { col: 'servicios', op: 'actualizar', rec, hoja: 'Servicios', fila: f.n, hojaId: 'servicios', cambios: ['Registros DNS'] }; plan.acciones.push(a); porId.set(svId, a); }
    res.crear++;
  }
}

// ---------------------------------------------------------------------------------------------
// Importar: aplicar
// ---------------------------------------------------------------------------------------------

/** ¿Hay una planilla analizada esperando? */
export function hayPlanillaPendiente() { return !!planPendiente; }
/** Descarta la planilla analizada. */
export function cancelarPlanilla() { planPendiente = null; }

/**
 * Guarda lo que dice el plan (las filas con errores no entran). Usa `repositorio.guardar`, así que todo queda en el historial.
 * @param {UsuarioSesion} usuario @param {{soloValidas?: boolean}} [opciones]
 * @returns {Promise<{creados: number, actualizados: number, conexiones: number, creadosAutomaticos: number, errores: string[]}>}
 */
export async function aplicarPlanilla(usuario, opciones) {
  if (!puede(usuario, 'importar')) throw new Error('Solo el superadmin puede importar una planilla.');
  const plan = planPendiente;
  if (!plan) throw new Error('No hay ninguna planilla analizada para importar.');
  if (plan.errores > 0 && !(opciones && opciones.soloValidas)) throw new Error('La planilla tiene errores: corregila o aplicá solo las filas válidas.');
  planPendiente = null;
  /** @type {string[]} */
  const errores = [];
  let creados = 0, actualizados = 0, conexiones = 0, creadosAutomaticos = 0;
  const motivo = 'Importado desde planilla de Excel';
  const motivoAuto = 'Creado automáticamente al importar una planilla de Excel (lo mencionaba una fila y no existía)';
  /** @type {any[]} */
  const ordenadas = [];
  for (const id of ORDEN_APLICAR) {
    // Lo que se crea solo va antes que las filas de su hoja (las filas lo nombran); en sedes y salas, las sedes antes que las salas.
    let deHoja = [...plan.acciones_auto.filter(a => a.hojaId === id), ...plan.acciones.filter(a => a.hojaId === id)];
    if (id === 'ubicaciones') deHoja = [...deHoja.filter(a => a.rec.ubicacion_tipo === 'sede'), ...deHoja.filter(a => a.rec.ubicacion_tipo !== 'sede')];
    // Una impresora USB necesita que su computadora ya esté guardada.
    if (id === 'equipos') { const dep = (/** @type {any} */ a) => !!(a.rec.equipo_campos && a.rec.equipo_campos.impresora_pc_id); ordenadas.push(...deHoja.filter(a => !dep(a)), ...deHoja.filter(dep)); }
    else ordenadas.push(...deHoja);
  }
  for (const a of ordenadas) {
    try {
      await repositorio.guardar(a.col, a.rec, usuario.id, { motivo: a.auto ? motivoAuto : motivo });
      if (a.auto) creadosAutomaticos++; else if (a.op === 'crear') creados++; else actualizados++;
    } catch (e) { errores.push(a.hoja + ', fila ' + a.fila + ': ' + (e instanceof Error ? e.message : 'no se pudo guardar')); }
  }
  for (const c of plan.conexiones) {
    try {
      const pa = await repositorio.obtener('puertos', c.a);
      if (pa && pa.conectado_a_puerto_id === c.b) continue;
      await repositorio.conectarPuertos({ puertoAId: c.a, puertoBId: c.b, usuarioId: usuario.id });
      conexiones++;
    } catch (e) { errores.push(c.fila + ': ' + (e instanceof Error ? e.message : 'no se pudo conectar')); }
  }
  return { creados, actualizados, conexiones, creadosAutomaticos, errores };
}

/** Descripción de la planilla (hojas y columnas) para armar la documentación. */
export function describirEsquema() {
  return ESQUEMA.map(h => ({
    hoja: h.nombre, descripcion: h.desc, identificaPor: h.dns ? ['Servicio', 'Tipo de registro', 'Nombre', 'Valor'] : h.claveCols.map(k => /** @type {Col} */ (h.cols.find(c => c.k === k)).r),
    columnas: [{ clave: 'id', rotulo: 'id', obligatoria: 'No', tipo: 'Texto', permitidos: 'Identificador interno (opcional)', ayuda: '' }].concat(h.cols.map(c => ({ clave: c.k, rotulo: c.r, obligatoria: obligatoriaTexto(c), tipo: tipoTexto(c), permitidos: permitidosTexto(c), ayuda: c.ayuda || '' })))
  }));
}
