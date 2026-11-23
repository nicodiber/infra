// @ts-check
/**
 * Permisos: ÚNICA fuente de verdad sobre qué puede ver o hacer cada rol (D-006).
 * Implementa la matriz de docs/permisos.md. Las vistas preguntan `puede(usuario, accion, modulo, organizacion)`;
 * nunca comparan el rol a mano.
 *
 * Módulos (`MODULOS` en modelos.js): organizacion, red, servidores, racks, credenciales, configuraciones, usuarios y,
 * desde D-066, `personas` (personas, cuentas de dominio, asignaciones) y `licencias`. Siguen la misma lógica que los
 * demás: superadmin y gerente todo; técnico y operario según su permiso por módulo. Las notas siguen el módulo de su
 * ficha (`moduloDeNota` en repositorio.js) y las de la organización, `organizacion`. Los archivos y las relaciones siguen el módulo
 * de su ficha (`moduloDeEntidad` en repositorio.js); los servicios, `configuraciones`; los tramos de fibra, `red` (v0.5, sin módulos nuevos).
 *
 * Son funciones puras sobre el usuario de la sesión (`UsuarioSesion`), que trae sus permisos por módulo y
 * sus aprobaciones vigentes ya cargados (ver sesion.js): no leen el almacenamiento.
 */

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */
/** @typedef {import('./modelos.js').Usuario} Usuario */
/** @typedef {import('./modelos.js').Solicitud} Solicitud */
/** @typedef {import('./modelos.js').Modulo} Modulo */

/** Jerarquía (D-028): mayor número = mayor rol. @type {Object<string, number>} */
export const RANGO = { superadmin: 4, gerente: 3, tecnico: 2, operario: 1 };

/**
 * Acciones que entiende `puede`.
 *  - `ver` / `modificar`: sobre un módulo.
 *  - `ver_historial`: historial de cambios de una ficha de un módulo.
 *  - `ver_cambios`: lista «Últimos cambios» del tablero (un técnico solo ve los de los módulos que ve).
 *  - `pedir_baja`: el técnico pide la baja; la confirma el superadmin (PE1).
 *  - `baja`: dar de baja directamente.
 *  - `verificar`: «Confirmar vigente» y recorrido de verificación (MJ29).
 *  - `ver_registro_accesos`, `exportar`, `importar`, `restablecer`, `ajustes_sistema`, `ver_usuarios`,
 *    `crear_usuario`, `aprobar`, `marcar_leidos`, `ver_organizaciones`, `cambiar_organizacion`.
 * @typedef {'ver'|'modificar'|'ver_historial'|'ver_cambios'|'pedir_baja'|'baja'|'verificar'|'ver_registro_accesos'|'exportar'|'importar'|'restablecer'|'ajustes_sistema'|'ver_usuarios'|'crear_usuario'|'aprobar'|'marcar_leidos'|'ver_organizaciones'|'cambiar_organizacion'} Accion
 */

/** @param {Usuario|UsuarioSesion|null|undefined} u */
export function rangoDe(u) { return u ? RANGO[u.usuario_perfil] || 0 : 0; }

/** `a` es de un rol estrictamente superior al de `b`. @param {Usuario} a @param {Usuario} b */
export function esSuperior(a, b) { return rangoDe(a) > rangoDe(b); }

/** @param {UsuarioSesion} u */
export function esSuperadmin(u) { return !!u && u.usuario_perfil === 'superadmin'; }

/**
 * ¿El usuario pertenece a esa organización (o es superadmin)? Sin organización indicada no se limita.
 * @param {UsuarioSesion} u @param {string|null|undefined} organizacionId
 */
function dentroDeAlcance(u, organizacionId) {
  if (u.usuario_perfil === 'superadmin') return true;
  if (!organizacionId) return true;
  return u.organizacion_id === organizacionId;
}

/**
 * Permiso por módulo de un técnico u operario.
 * @param {UsuarioSesion} u @param {Modulo} modulo
 */
function permisoModulo(u, modulo) {
  return u.permisos.find(p => p.modulo === modulo && !p.eliminado_en) || null;
}

/**
 * @param {UsuarioSesion} usuario
 * @param {Accion} accion
 * @param {Modulo|null} [modulo] Módulo sobre el que se actúa (para `ver`, `modificar` y similares).
 * @param {string|null} [organizacionId] Organización del dato; si es de otra, no hay acceso (regla de alcance).
 * @returns {boolean}
 */
export function puede(usuario, accion, modulo, organizacionId) {
  if (!usuario || usuario.usuario_estado !== 'activo') return false;
  const perfil = usuario.usuario_perfil;
  const sa = perfil === 'superadmin', ger = perfil === 'gerente', tec = perfil === 'tecnico';

  switch (accion) {
    // ---- sin referencia a una organización
    case 'ver_organizaciones':
    case 'cambiar_organizacion':
    case 'exportar':
    case 'importar':
    case 'restablecer':
    case 'ajustes_sistema':
      return sa;
    case 'ver_registro_accesos':
      return (sa || ger) && dentroDeAlcance(usuario, organizacionId);
    case 'ver_usuarios':
    case 'crear_usuario':
    case 'aprobar':
      return (sa || ger || tec) && dentroDeAlcance(usuario, organizacionId);
    case 'marcar_leidos':
      return (sa || ger || tec) && dentroDeAlcance(usuario, organizacionId);
  }

  // ---- con organización y módulo
  if (!dentroDeAlcance(usuario, organizacionId)) return false;
  if (!modulo) return false;
  const pm = sa || ger ? null : permisoModulo(usuario, modulo);
  const ve = sa || ger || !!(pm && pm.puede_ver);
  const modifica = sa || ger || (tec && !!(pm && pm.puede_modificar));

  switch (accion) {
    case 'ver':
      // Regla 7: sin ningún permiso configurado, un técnico u operario solo ve la ficha básica de su organización.
      return modulo === 'organizacion' && !sa && !ger && !pm ? true : ve;
    case 'modificar': return modifica;
    case 'baja': return sa || ger;
    case 'pedir_baja': return tec && modifica;
    case 'ver_historial':
    case 'ver_cambios': return (sa || ger || tec) && ve;
    case 'verificar': return modifica;
    default: return false;
  }
}

/**
 * Organización con la que trabaja el usuario: la suya, o null para el superadmin (elige en la cabecera).
 * @param {UsuarioSesion} u
 */
export function organizacionPropia(u) { return u.usuario_perfil === 'superadmin' ? null : u.organizacion_id; }

/**
 * ¿Puede mostrar o copiar el secreto de esta credencial? Solo el superadmin directo (D-029); el resto, con una
 * aprobación vigente (aprobada y no quitada) para esa credencial o para su tipo (PE13), de su organización.
 * @param {UsuarioSesion} usuario
 * @param {{id: string, organizacion_id: string, credencial_tipo?: string}} credencial
 */
export function puedeVerSecreto(usuario, credencial) {
  if (!usuario || usuario.usuario_estado !== 'activo') return false;
  if (usuario.usuario_perfil === 'superadmin') return true;
  if (usuario.organizacion_id !== credencial.organizacion_id) return false;
  return usuario.aprobaciones.some(a => a.organizacion_id === credencial.organizacion_id
    && (a.alcance === 'tipo_credencial' ? a.credencial_tipo === credencial.credencial_tipo : a.credencial_id === credencial.id));
}

/**
 * ¿Puede resolver (aprobar o rechazar) esta solicitud? Las de ver secretos las resuelve cualquier rol superior
 * al de quien pide, de su organización, o el superadmin; las bajas de técnicos, solo el superadmin (PE1, PE10).
 * @param {UsuarioSesion} usuario
 * @param {Solicitud} solicitud
 * @param {Usuario} solicitante
 */
export function puedeResolverSolicitud(usuario, solicitud, solicitante) {
  if (!usuario || usuario.usuario_estado !== 'activo' || solicitud.solicitud_estado !== 'pendiente') return false;
  if (usuario.usuario_perfil === 'superadmin') return true;
  if (solicitud.solicitud_tipo === 'baja_registro') return false;
  return usuario.organizacion_id === solicitud.organizacion_id && esSuperior(usuario, solicitante);
}

/**
 * ¿Puede quitarle a `titular` el permiso de ver secretos? Cualquier rol superior al suyo (PE12), o el superadmin.
 * @param {UsuarioSesion} usuario @param {Usuario} titular
 */
export function puedeQuitarAprobacion(usuario, titular) {
  if (!usuario || usuario.usuario_estado !== 'activo') return false;
  if (usuario.usuario_perfil === 'superadmin') return true;
  return usuario.organizacion_id === titular.organizacion_id && esSuperior(usuario, titular);
}

/**
 * Los pedidos para ver secretos solo los hacen quienes no los ven directamente (todos menos el superadmin).
 * @param {UsuarioSesion} usuario
 */
export function puedePedirSecreto(usuario) { return !!usuario && usuario.usuario_estado === 'activo' && usuario.usuario_perfil !== 'superadmin'; }
