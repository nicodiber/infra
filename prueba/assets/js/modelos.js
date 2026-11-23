// @ts-check
/**
 * Tipos de las entidades de Infradoc (JSDoc) y constantes del modelo.
 * Fuente de verdad: docs/modelo-de-datos.md. Si cambia el modelo, se cambia primero ahí,
 * después este archivo y datos-demo/ (ver «Definición de terminado» en AGENTS.md).
 */

/**
 * Campos comunes de las entidades editables (modelo-de-datos.md, sección 1).
 * @typedef {Object} Comunes
 * @property {string} id UUID v4.
 * @property {string} creado_en Fecha-hora ISO 8601.
 * @property {string} creado_por Id del usuario.
 * @property {string} actualizado_en
 * @property {string} actualizado_por
 * @property {string|null} eliminado_en Baja lógica: null = vigente.
 * @property {string|null} eliminado_por
 * @property {string} verificado_en Nunca null (D-045): al crear vale creado_en.
 * @property {string} verificado_por Nunca null (D-045).
 */

/** @typedef {'superadmin'|'gerente'|'tecnico'|'operario'} Perfil */
/** @typedef {'organizacion'|'red'|'servidores'|'racks'|'credenciales'|'configuraciones'|'usuarios'|'personas'|'licencias'} Modulo */

/**
 * @typedef {Comunes & {
 *   organizacion_nombre: string, organizacion_rubro: string|null, organizacion_cuit: string|null,
 *   organizacion_notas: string|null, organizacion_estado: 'activa'|'inactiva'
 * }} Organizacion
 */

/**
 * @typedef {Comunes & {
 *   usuario_nombre: string, usuario_email: string, usuario_perfil: Perfil, organizacion_id: string|null,
 *   usuario_estado: 'pendiente_aprobacion'|'activo'|'inactivo', aprobado_por: string|null, aprobado_en: string|null,
 *   usuario_clave_prototipo?: string
 * }} Usuario
 */

/**
 * @typedef {Comunes & {
 *   usuario_id: string, modulo: Modulo, puede_ver: boolean, puede_modificar: boolean, puede_ver_credenciales: boolean
 * }} PermisoModulo
 */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, ubicacion_nombre: string, ubicacion_tipo: 'sede'|'edificio'|'sala'|'oficina',
 *   ubicacion_direccion: string|null, ubicacion_padre_id: string|null, ubicacion_plano_archivo_id?: string|null
 * }} Ubicacion
 */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, ubicacion_id: string, rack_nombre: string, rack_unidades_total: number,
 *   rack_profundidad: number|null, rack_notas: string|null, plano_x?: number|null, plano_y?: number|null
 * }} Rack
 */

/** @typedef {'router'|'firewall'|'switch'|'access_point'|'servidor'|'patchera'|'ups'|'otro'} EquipoTipo */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, equipo_tipo: EquipoTipo, equipo_nombre: string, equipo_marca: string|null,
 *   equipo_modelo: string|null, equipo_numero_serie: string|null, equipo_mac: string|null,
 *   equipo_codigo: string, equipo_ip_gestion: string|null, ubicacion_id: string|null, rack_id: string|null, rack_u_inicio: number|null,
 *   rack_u_alto: number|null, puesto_id: string|null, equipo_estado: 'en_uso'|'en_deposito'|'baja',
 *   equipo_notas: string|null, equipo_campos: Object<string, any>, plano_x?: number|null, plano_y?: number|null
 * }} Equipo
 */

/**
 * @typedef {Comunes & {
 *   equipo_id: string, puerto_numero: number, puerto_nombre: string|null, puerto_tipo: 'rj45'|'sfp'|'sfp_plus',
 *   puerto_velocidad: string|null, puerto_modo: 'acceso'|'troncal'|null, vlan_nativa_id: string|null,
 *   vlans_etiquetadas: string[], conectado_a_equipo_id: string|null, conectado_a_puerto_id: string|null,
 *   conectado_a_descripcion: string|null, enlace_isp_id: string|null, puesto_id: string|null,
 *   puerto_estado: 'activo'|'libre'|'deshabilitado', puerto_notas: string|null
 * }} Puerto
 */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, vlan_numero: number, vlan_nombre: string, vlan_red_cidr: string|null,
 *   vlan_gateway: string|null, vlan_dhcp_activo: boolean, vlan_dhcp_rango: string|null, vlan_descripcion: string|null
 * }} Vlan
 */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, enlace_proveedor: string, enlace_tipo: 'fibra'|'radio'|'cable'|'4g',
 *   enlace_velocidad_bajada_mbps: number|null, enlace_velocidad_subida_mbps: number|null,
 *   enlace_ip_publica: string|null, enlace_tipo_ip: 'fija'|'dinamica'|null, equipo_id: string|null,
 *   enlace_numero_cliente: string|null, enlace_telefono_soporte: string|null, enlace_es_principal: boolean
 * }} EnlaceIsp
 */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, wifi_ssid: string, vlan_id: string|null, wifi_seguridad: 'wpa2'|'wpa3'|'abierta'|'portal',
 *   credencial_id: string|null, wifi_oculta: boolean, access_point_ids: string[]
 * }} RedWifi
 */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, equipo_id: string|null, configuracion_tipo: string, configuracion_titulo: string,
 *   configuracion_contenido: string, configuracion_datos: Object[]|null, configuracion_version_fecha: string|null,
 *   configuracion_notas: string|null
 * }} Configuracion
 */

/**
 * `credencial_secreto` solo viaja con `repositorio.usarSecreto`; en el resto de las lecturas vale null.
 * @typedef {Comunes & {
 *   organizacion_id: string, credencial_tipo: string, credencial_nombre: string, credencial_usuario: string|null,
 *   credencial_secreto: string|null, credencial_url_o_host: string|null, equipo_id: string|null,
 *   configuracion_id: string|null, credencial_notas: string|null, credencial_vence_en: string|null,
 *   credencial_secreto_actualizado_en: string
 * }} Credencial
 */

/**
 * @typedef {Comunes & {
 *   organizacion_id: string, ubicacion_id: string, puesto_nombre: string, puesto_boca_pared: string|null,
 *   puesto_notas: string|null, plano_x?: number|null, plano_y?: number|null
 * }} Puesto
 */

/**
 * Persona de la organización (no es un usuario del sistema). `puesto_id`: puesto habitual (null si no tiene uno fijo).
 * @typedef {Comunes & {
 *   organizacion_id: string, persona_nombre: string, persona_sector: string|null, puesto_id: string|null,
 *   persona_estado: 'activa'|'baja', persona_notas: string|null
 * }} Persona
 */

/**
 * Cuenta de dominio. `persona_id` null = cuenta de servicio. La contraseña, si se guarda, es la `Credencial` vinculada.
 * @typedef {Comunes & {
 *   organizacion_id: string, persona_id: string|null, cuenta_usuario: string, cuenta_dominio: string,
 *   cuenta_unidad_organizativa: string|null, cuenta_grupos: string[], cuenta_estado: 'habilitada'|'deshabilitada',
 *   credencial_id: string|null
 * }} CuentaDominio
 */

/**
 * Entrega de un equipo a una persona. `asignacion_hasta` null = la tiene hoy. Un equipo puede tener varias vigentes a la vez
 * (equipo compartido, D-072); `asignarEquipo` con `compartir` suma una sin cerrar las otras.
 * @typedef {Comunes & {
 *   organizacion_id: string, equipo_id: string, persona_id: string, asignacion_desde: string,
 *   asignacion_hasta: string|null, asignacion_motivo: string|null, asignacion_observaciones: string|null
 * }} Asignacion
 */

/**
 * Licencia de software. La clave va como `Credencial` de tipo `clave_licencia` (D-066).
 * @typedef {Comunes & {
 *   organizacion_id: string, licencia_producto: string, licencia_tipo: 'perpetua'|'suscripcion'|'oem'|'volumen',
 *   licencia_cantidad: number, licencia_vence_en: string|null, licencia_proveedor: string|null, credencial_id: string|null
 * }} Licencia
 */

/**
 * Instalación de una licencia en un equipo, con la cuenta o persona que la usa (opcionales).
 * `instalacion_hasta` null = sigue instalada.
 * @typedef {Comunes & {
 *   organizacion_id: string, licencia_id: string, equipo_id: string, cuenta_id: string|null, persona_id: string|null,
 *   instalacion_desde: string, instalacion_hasta: string|null
 * }} InstalacionLicencia
 */

/**
 * Mapeo de unidad de red. `mapeo_grupo` solo con `mapeo_aplica_a = grupo`; `persona_id` solo con `persona`.
 * @typedef {Comunes & {
 *   organizacion_id: string, mapeo_letra: string, mapeo_ruta: string, equipo_id: string|null,
 *   mapeo_aplica_a: 'todos'|'grupo'|'persona', mapeo_grupo: string|null, persona_id: string|null,
 *   mapeo_metodo: 'gpo'|'script'|'manual'
 * }} MapeoDisco
 */

/**
 * Nota libre. `entidad` (nombre de entidad, por ejemplo «Equipo») y `entidad_id` null = nota de la organización.
 * @typedef {Comunes & {
 *   organizacion_id: string, entidad: string|null, entidad_id: string|null, nota_titulo: string, nota_contenido: string
 * }} Nota
 */

/**
 * Registro de un servicio (`servicio_registros`): DNS de un dominio.
 * @typedef {Object} RegistroDns
 * @property {'A'|'AAAA'|'CNAME'|'MX'|'TXT'|'NS'} tipo
 * @property {string} nombre
 * @property {string} valor
 * @property {number} [prioridad] Solo MX.
 */

/**
 * Dominio, DNS, hosting, certificado o correo (QA43). Vive en el módulo `configuraciones`.
 * @typedef {Comunes & {
 *   organizacion_id: string, servicio_tipo: 'dominio'|'dns'|'hosting'|'certificado'|'correo', servicio_nombre: string,
 *   servicio_proveedor: string|null, servicio_titular: string|null, servicio_vence_en: string|null,
 *   servicio_delegacion_dns: string|null, servicio_plan: string|null, credencial_id: string|null,
 *   servicio_registros: RegistroDns[]
 * }} Servicio
 */

/**
 * Tramo de fibra entre dos ubicaciones (QA45-C). `tramo_pelos_usados`: qué se transporta por cada pelo.
 * @typedef {Comunes & {
 *   organizacion_id: string, tramo_nombre: string, tramo_origen_ubicacion_id: string, tramo_destino_ubicacion_id: string,
 *   tramo_origen_equipo_id: string|null, tramo_destino_equipo_id: string|null, tramo_pelos: number,
 *   tramo_tipo: 'monomodo'|'multimodo', tramo_conector: 'LC'|'SC'|'ST', tramo_longitud_m: number|null,
 *   tramo_pelos_usados: Array<{pelo: number, uso: string}>,
 *   tramo_mediciones: Array<{fecha: string, pelo: number, atenuacion_db: number, observaciones: string|null}>
 * }} TramoFibra
 */

/**
 * Archivo (plano, foto, otro) colgado de una ficha. `archivo_contenido` es un data URL guardado en el navegador.
 * @typedef {Comunes & {
 *   organizacion_id: string, entidad: string, entidad_id: string, archivo_tipo: 'plano'|'foto'|'otro',
 *   archivo_nombre: string, archivo_mime: string, archivo_bytes: number, archivo_contenido: string
 * }} Archivo
 */

/**
 * «Relacionado con» (IC4): vínculo entre dos fichas cualesquiera de la misma organización.
 * @typedef {Comunes & {
 *   organizacion_id: string, origen_entidad: string, origen_id: string, destino_entidad: string, destino_id: string,
 *   relacion_descripcion: string|null
 * }} Relacion
 */

/**
 * @typedef {Object} Solicitud
 * @property {string} id
 * @property {string} organizacion_id
 * @property {'baja_registro'|'ver_secreto'} solicitud_tipo
 * @property {string} solicitud_entidad Nombre de la entidad (por ejemplo «Credencial»).
 * @property {string} solicitud_entidad_id
 * @property {string} solicitado_por
 * @property {string} solicitado_en
 * @property {'credencial'|'tipo_credencial'|null} solicitud_alcance
 * @property {string|null} solicitud_motivo
 * @property {'pendiente'|'aprobada'|'rechazada'|'vencida'} solicitud_estado
 * @property {string|null} resuelto_por
 * @property {string|null} resuelto_en
 * @property {string|null} solicitud_revocada_por
 * @property {string|null} solicitud_revocada_en
 */

/**
 * @typedef {Object} RegistroAccesoCredencial
 * @property {string} id
 * @property {string} credencial_id
 * @property {string} organizacion_id
 * @property {string} usuario_id
 * @property {'mostrar'|'copiar'} registro_accion
 * @property {string|null} cambio_id
 * @property {string} registro_fecha
 */

/**
 * @typedef {Object} Cambio
 * @property {string} id
 * @property {string} cambio_entidad Nombre de la entidad (por ejemplo «Equipo»).
 * @property {string} entidad_id
 * @property {string|null} organizacion_id
 * @property {'alta'|'modificacion'|'baja'|'restauracion'} cambio_operacion
 * @property {string|null} cambio_campo
 * @property {string|null} cambio_valor_anterior JSON en texto.
 * @property {string|null} cambio_valor_nuevo JSON en texto.
 * @property {boolean} cambio_valor_oculto
 * @property {string} usuario_id
 * @property {string} cambio_fecha
 * @property {string|null} cambio_motivo
 */

/**
 * @typedef {Object} LecturaCambio
 * @property {string} id
 * @property {string} usuario_id
 * @property {string} cambio_id
 * @property {string} lectura_en
 */

/**
 * @typedef {Object} AjusteSistema
 * @property {string} id
 * @property {string} ajuste_clave
 * @property {string} ajuste_valor
 * @property {string} actualizado_en
 * @property {string} actualizado_por
 */

/**
 * Aprobación vigente para ver secretos (una `Solicitud` `ver_secreto` aprobada y no revocada).
 * @typedef {Object} Aprobacion
 * @property {string} solicitud_id
 * @property {string} organizacion_id
 * @property {'credencial'|'tipo_credencial'} alcance
 * @property {string} credencial_id Credencial pedida.
 * @property {string} credencial_tipo Tipo de la credencial pedida.
 */

/**
 * Usuario con la sesión abierta, más lo necesario para consultar permisos sin ir al almacenamiento.
 * @typedef {Usuario & {permisos: PermisoModulo[], aprobaciones: Aprobacion[]}} UsuarioSesion
 */

/** Colecciones del repositorio (un store de IndexedDB por cada una) y la entidad que guarda cada una. */
export const COLECCIONES = /** @type {const} */ ([
  'organizaciones', 'usuarios', 'permisos_modulo', 'ubicaciones', 'racks', 'equipos', 'puertos', 'vlans',
  'enlaces_isp', 'redes_wifi', 'configuraciones', 'credenciales', 'puestos', 'personas', 'cuentas_dominio', 'asignaciones',
  'licencias', 'instalaciones_licencia', 'mapeos_disco', 'notas', 'servicios', 'tramos_fibra', 'archivos', 'relaciones', 'solicitudes', 'registro_accesos',
  'cambios', 'lecturas_cambio', 'ajustes_sistema'
]);

/** @type {Object<string, string>} */
export const ENTIDAD_DE_COLECCION = {
  organizaciones: 'Organizacion', usuarios: 'Usuario', permisos_modulo: 'PermisoModulo', ubicaciones: 'Ubicacion',
  racks: 'Rack', equipos: 'Equipo', puertos: 'Puerto', vlans: 'Vlan', enlaces_isp: 'EnlaceIsp', redes_wifi: 'RedWifi',
  configuraciones: 'Configuracion', credenciales: 'Credencial', puestos: 'Puesto', personas: 'Persona',
  cuentas_dominio: 'CuentaDominio', asignaciones: 'Asignacion', licencias: 'Licencia',
  instalaciones_licencia: 'InstalacionLicencia', mapeos_disco: 'MapeoDisco', notas: 'Nota', solicitudes: 'Solicitud',
  registro_accesos: 'RegistroAccesoCredencial', cambios: 'Cambio', lecturas_cambio: 'LecturaCambio',
  ajustes_sistema: 'AjusteSistema', servicios: 'Servicio', tramos_fibra: 'TramoFibra', archivos: 'Archivo', relaciones: 'Relacion'
};

/** @type {Object<string, string>} */
export const COLECCION_DE_ENTIDAD = Object.fromEntries(Object.entries(ENTIDAD_DE_COLECCION).map(([c, e]) => [e, c]));

/** Colecciones cuyos registros llevan los campos comunes (verificación, baja lógica). */
export const COLECCIONES_COMUNES = [
  'organizaciones', 'usuarios', 'permisos_modulo', 'ubicaciones', 'racks', 'equipos', 'puertos', 'vlans',
  'enlaces_isp', 'redes_wifi', 'configuraciones', 'credenciales', 'puestos', 'personas', 'cuentas_dominio', 'asignaciones',
  'licencias', 'instalaciones_licencia', 'mapeos_disco', 'notas', 'servicios', 'tramos_fibra', 'archivos', 'relaciones'
];

/** @type {Modulo[]} */
export const MODULOS = ['organizacion', 'red', 'servidores', 'racks', 'credenciales', 'configuraciones', 'usuarios', 'personas', 'licencias'];

/** @type {Object<string, string>} */
export const ROTULO_MODULO = {
  organizacion: 'Organización', red: 'Red', servidores: 'Servidores', racks: 'Racks',
  credenciales: 'Credenciales', configuraciones: 'Configuraciones', usuarios: 'Usuarios', personas: 'Personas', licencias: 'Licencias'
};

/** @type {Object<string, string>} */
export const ROTULO_PERFIL = { superadmin: 'Superadmin', gerente: 'Gerente', tecnico: 'Técnico', operario: 'Operario' };

/** @type {Object<string, string>} */
export const ROTULO_EQUIPO_TIPO = {
  router: 'Router', firewall: 'Firewall', switch: 'Switch', access_point: 'Access point', servidor: 'Servidor',
  patchera: 'Patchera', ups: 'UPS', otro: 'Otro'
};

/** @type {Object<string, string>} */
export const ROTULO_CREDENCIAL_TIPO = {
  ilo_idrac: 'iLO / iDRAC', router: 'Router', firewall: 'Firewall', switch: 'Switch', access_point: 'Access point',
  vpn_usuario: 'VPN de usuario', vpn_administrador: 'VPN de administrador', wifi: 'Wi-Fi', dominio: 'Dominio',
  hosting: 'Hosting', nic_dns: 'NIC / DNS', correo: 'Correo', clave_licencia: 'Clave de licencia', otro: 'Otro'
};

/** Categoría de `equipo_tipo = otro` con campos propios `reloj_*` (MD10-C, D-066). */
export const CATEGORIA_RELOJ = 'Reloj de control de personal';

/** Categoría de `equipo_tipo = otro` para las impresoras (campos propios `impresora_*`, D-072). Se reconoce también «Impresora». */
export const CATEGORIA_IMPRESORA = 'Impresora de red';

/** @type {Object<string, string>} */
export const ROTULO_IMPRESORA_CONEXION = { red: 'Red', usb: 'USB / local' };

/**
 * ¿Es una impresora? Un equipo `otro` cuya categoría es «Impresora de red» o «Impresora» (sin distinguir mayúsculas).
 * @param {{equipo_tipo: string, equipo_campos?: Object<string, any>}} e
 */
export function esImpresora(e) {
  if (!e || e.equipo_tipo !== 'otro') return false;
  const c = String((e.equipo_campos || {}).otro_categoria || '').trim().toLowerCase();
  return c === 'impresora de red' || c === 'impresora';
}

/** @type {Object<string, string>} */
export const ROTULO_RELOJ_METODO = { huella: 'Huella', tarjeta: 'Tarjeta', rostro: 'Rostro', pin: 'PIN' };

/** @type {Object<string, string>} */
export const ROTULO_LICENCIA_TIPO = { perpetua: 'Perpetua', suscripcion: 'Suscripción', oem: 'OEM', volumen: 'Volumen' };

/** @type {Object<string, string>} */
export const ROTULO_PERSONA_ESTADO = { activa: 'Activa', baja: 'Baja' };

/** @type {Object<string, string>} */
export const ROTULO_CUENTA_ESTADO = { habilitada: 'Habilitada', deshabilitada: 'Deshabilitada' };

/** @type {Object<string, string>} */
export const ROTULO_MAPEO_APLICA_A = { todos: 'Todos', grupo: 'Un grupo', persona: 'Una persona' };

/** @type {Object<string, string>} */
export const ROTULO_MAPEO_METODO = { gpo: 'Directiva de grupo', script: 'Script', manual: 'Manual' };

/** @type {Object<string, string>} */
export const ROTULO_CONFIGURACION_TIPO = {
  vpn_sitio_a_sitio: 'VPN sitio a sitio', vpn_usuario: 'VPN de usuario', nat_reenvio_puertos: 'NAT / reenvío de puertos',
  reglas_firewall: 'Reglas de firewall', wifi: 'Wi-Fi', general: 'General', otro: 'Otro'
};

/** @type {Object<string, string>} */
export const ROTULO_ESTADO_EQUIPO = { en_uso: 'En uso', en_deposito: 'En depósito', baja: 'Baja' };

/** @type {Object<string, string>} */
export const ROTULO_SERVICIO_TIPO = { dominio: 'Dominio', dns: 'DNS', hosting: 'Hosting', certificado: 'Certificado SSL', correo: 'Correo' };

/** Tipos de registro DNS que se cargan en un servicio. */
export const TIPOS_REGISTRO_DNS = /** @type {const} */ (['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS']);

/** @type {Object<string, string>} */
export const ROTULO_FIBRA_TIPO = { monomodo: 'Monomodo', multimodo: 'Multimodo' };

/** Conectores de fibra. */
export const CONECTORES_FIBRA = /** @type {const} */ (['LC', 'SC', 'ST']);

/** Atenuación (dB) desde la cual una medición de fibra se marca como alta. */
export const ATENUACION_ALTA_DB = 3;

/** @type {Object<string, string>} */
export const ROTULO_ARCHIVO_TIPO = { plano: 'Plano', foto: 'Foto', otro: 'Otro archivo' };

/** Tamaño máximo de un archivo guardado en el navegador (MD11, provisorio: a confirmar con el sysadmin). */
export const LIMITE_ARCHIVO_BYTES = 5 * 1024 * 1024;

/** Nombre legible de cada entidad para mostrar en «Relacionado con». @type {Object<string, string>} */
export const ROTULO_ENTIDAD = {
  Equipo: 'Equipo', Servidor: 'Servidor', Rack: 'Rack', Ubicacion: 'Ubicación', Puesto: 'Puesto', Vlan: 'VLAN', RedWifi: 'Wi-Fi',
  EnlaceIsp: 'Enlace a Internet', Configuracion: 'Configuración', Credencial: 'Credencial', Persona: 'Persona',
  CuentaDominio: 'Cuenta de dominio', Licencia: 'Licencia', MapeoDisco: 'Mapeo de disco', Servicio: 'Servicio', TramoFibra: 'Tramo de fibra'
};

/**
 * Ruta (hash) de la ficha de un registro, o null si esa entidad no tiene ficha propia.
 * @param {string} entidad Nombre de la entidad (por ejemplo «Equipo»).
 * @param {{id: string, equipo_tipo?: string}} registro
 * @returns {string|null}
 */
export function rutaDeEntidad(entidad, registro) {
  const id = registro.id;
  switch (entidad) {
    case 'Equipo': return (registro.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + id;
    case 'Rack': return '#/rack/' + id;
    case 'Ubicacion': return '#/plano/' + id;
    case 'Puesto': return '#/puesto/' + id;
    case 'Vlan': return '#/vlan/' + id;
    case 'EnlaceIsp': return '#/enlace/' + id;
    case 'EnlaceIsp': return '#/enlace/' + id;
    case 'RedWifi': return '#/wifi/' + id;
    case 'Configuracion': return '#/config/' + id;
    case 'Credencial': return '#/credencial/' + id;
    case 'Persona': return '#/persona/' + id;
    case 'CuentaDominio': return '#/cuenta/' + id;
    case 'Licencia': return '#/licencia/' + id;
    case 'MapeoDisco': return '#/mapeo/' + id;
    case 'Servicio': return '#/servicio/' + id;
    case 'TramoFibra': return '#/tramo/' + id;
    default: return null;
  }
}

/** Campos que guardan un secreto: sus valores en el historial se ocultan (regla 1 del modelo). */
export const CAMPOS_SECRETOS = ['credencial_secreto', 'usuario_clave_prototipo'];

/**
 * Módulo de permisos al que pertenece un registro (permisos.md): sirve para decidir si un usuario lo puede ver.
 * @param {string} entidad Nombre de la entidad (por ejemplo «Equipo»).
 * @param {{equipo_tipo?: string}} [registro] Hace falta solo para `Equipo` (los servidores van aparte). Una `Nota`
 * sigue el módulo de la ficha donde cuelga: ver `moduloDeNota` en el repositorio.
 * @returns {Modulo}
 */
export function moduloDeEntidad(entidad, registro) {
  switch (entidad) {
    case 'Equipo': return registro && registro.equipo_tipo === 'servidor' ? 'servidores' : 'red';
    case 'Puerto': case 'Vlan': case 'EnlaceIsp': case 'RedWifi': case 'Puesto': return 'red';
    case 'Rack': return 'racks';
    case 'Ubicacion': case 'Organizacion': return 'organizacion';
    case 'Configuracion': return 'configuraciones';
    case 'Credencial': case 'RegistroAccesoCredencial': return 'credenciales';
    case 'Usuario': case 'PermisoModulo': return 'usuarios';
    case 'Persona': case 'CuentaDominio': case 'Asignacion': return 'personas';
    case 'Licencia': case 'InstalacionLicencia': return 'licencias';
    case 'MapeoDisco': case 'Servicio': return 'configuraciones';
    case 'TramoFibra': return 'red';
    default: return 'organizacion';
  }
}

// ---------------------------------------------------------------------------------------------
// Versión del modelo de datos y migraciones (D-073)
// ---------------------------------------------------------------------------------------------

/**
 * Versión del modelo de datos. Cada exportación la lleva en `version_modelo`; una exportación sin ella es la versión 1.
 * Al cambiar el modelo (campo nuevo, campo renombrado) se sube en 1 y se agrega `MIGRACIONES[versión anterior]`.
 * 1: hasta la v0.5.x. 2: varias personas por equipo, impresoras con conexión (`impresora_conexion`, `impresora_pc_id`) y `puertos.enlace_isp_id` (v0.6).
 */
export const VERSION_MODELO = 2;

/**
 * Migraciones ordenadas: `MIGRACIONES[n]` lleva los datos de la versión n a la n+1, completando los campos nuevos con su valor
 * por defecto. Modifican `datos` (colecciones → registros) en el lugar, no borran nada y conservan los campos que no conocen.
 * @type {Object<number, (datos: Object<string, any[]>) => void>}
 */
export const MIGRACIONES = {
  1: datos => {
    for (const p of datos.puertos || []) if (!('enlace_isp_id' in p)) p.enlace_isp_id = null;
    for (const e of datos.equipos || []) {
      if (!esImpresora(e)) continue;
      if (!e.equipo_campos || typeof e.equipo_campos !== 'object') e.equipo_campos = {};
      if (!e.equipo_campos.impresora_conexion) e.equipo_campos.impresora_conexion = 'red';
      if (!('impresora_pc_id' in e.equipo_campos)) e.equipo_campos.impresora_pc_id = null;
    }
  }
};

/**
 * Lleva `datos` de la versión `desde` a la actual.
 * @param {Object<string, any[]>} datos @param {number} desde
 * @returns {number} Cuántas migraciones se aplicaron.
 */
export function migrarDatos(datos, desde) {
  let n = 0;
  for (let v = desde; v < VERSION_MODELO; v++) {
    const m = MIGRACIONES[v];
    if (!m) throw new Error('Falta la migración del modelo de datos ' + v + ' a ' + (v + 1) + '.');
    m(datos);
    n++;
  }
  return n;
}
