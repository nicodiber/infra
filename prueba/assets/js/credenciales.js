// @ts-check
/**
 * Lógica compartida de las pantallas de credenciales, configuraciones y registro de accesos:
 * ficha con cabecera y pie de verificación, pestañas, enlaces entre fichas y etiquetas de campos.
 * No toca datos por su cuenta: usa `repositorio` y `permisos`.
 */

import * as repositorio from './repositorio.js';
import { puede } from './permisos.js';
import { ir, toast, abrirModal, cerrarModal, repintarMarco } from './marco.js';
import { h, icono, ahoraISO, fmtFecha, fmtFechaHora, diasHasta, textoVence, indicadorVerificacion } from './utiles.js';
import { ROTULO_PERFIL } from './modelos.js';
import { confirmarConPasos } from './verificacion.js';

/** @typedef {import('./modelos.js').UsuarioSesion} UsuarioSesion */

/** Aviso de falta de permiso. @param {HTMLElement} contenedor @param {UsuarioSesion} u @param {string} que */
export function sinPermiso(contenedor, u, que) {
  contenedor.appendChild(h('div', { class: 'aviso' }, [
    h('div', { text: 'Tu rol (' + ROTULO_PERFIL[u.usuario_perfil] + ') no tiene acceso a ' + que + '.' }),
    h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/inicio', text: 'Volver al inicio' })])]));
}

/** @returns {Promise<Map<string, string>>} id de usuario → nombre. */
export async function nombresUsuarios() {
  const l = await repositorio.listar('usuarios', null, { incluirBajas: true });
  return new Map(l.map(x => [x.id, x.usuario_nombre]));
}

/**
 * Enlace al equipo (a su ficha si el rol ve ese módulo) o texto.
 * @param {UsuarioSesion} u @param {string} orgId @param {any|null|undefined} equipo
 */
export function enlaceEquipo(u, orgId, equipo) {
  if (!equipo) return h('span', { text: '—' });
  const srv = equipo.equipo_tipo === 'servidor';
  if (!puede(u, 'ver', srv ? 'servidores' : 'red', orgId)) return h('span', { text: equipo.equipo_nombre });
  return h('a', { href: (srv ? '#/servidor/' : '#/equipo/') + equipo.id, text: equipo.equipo_nombre });
}

/** «15/12/2026 · en 23 días» con énfasis si pasó o es pronto. @param {string|null} fecha */
export function textoVencimiento(fecha) {
  if (!fecha) return h('span', { text: '—' });
  const d = diasHasta(fecha);
  return h('span', { class: 'vence-tag ' + (d < 0 ? 'pasado' : d <= 30 ? 'pronto' : '') }, [fmtFecha(fecha) + ' · ' + textoVence(fecha)]);
}

/** @param {Array<[string, string, string?]>} tabs @param {string} actual @param {(k: string) => void} alElegir */
export function pestanas(tabs, actual, alElegir) {
  return h('div', { class: 'pestanas', role: 'tablist' }, tabs.map(t => h('button', {
    type: 'button', class: t[0] === actual ? 'sel' : '', role: 'tab', 'aria-selected': t[0] === actual ? 'true' : 'false', onclick: () => alElegir(t[0])
  }, [t[1]])));
}

/** @param {string} etiqueta @param {Node|string} valor */
export function campo(etiqueta, valor) {
  return h('div', { class: 'campo' }, [h('label', { text: etiqueta }), valor instanceof Node ? h('div', null, [valor]) : h('div', { text: valor })]);
}

/**
 * Cabecera de ficha con datos y pie de verificación (D-041).
 * @param {{tipo: string, etiqueta: string, titulo: string, datos: Node, botones: Array<Node|null>, modoEdicion: boolean,
 *   registro: any|null, coleccion: string, modulo: import('./modelos.js').Modulo, u: UsuarioSesion, orgId: string,
 *   umbrales: import('./utiles.js').Umbrales, usuarios: Map<string, string>, rerender: () => void}} o
 */
export function fichaCab(o) {
  const cab = h('div', { class: 'fila cab-ficha', style: 'align-items:center;margin-bottom:10px' }, [
    h('div', { style: 'flex:1;min-width:0' }, [h('div', { class: 'eyebrow' }, [icono(o.tipo), o.etiqueta]), h('h1', { text: o.titulo })]),
    o.modoEdicion ? h('span', { class: 'mut', text: 'Modo edición · al guardar, queda verificado hoy' }) : null,
    h('div', { class: 'herr', style: 'margin:0' }, o.botones)]);
  const pie = h('div', { class: 'ficha-pie' });
  const r = o.registro;
  if (r) {
    pie.appendChild(h('span', { class: 'cambio', text: 'Último cambio: ' + fmtFechaHora(r.actualizado_en) + ' · ' + (o.usuarios.get(r.actualizado_por) || '?') }));
    pie.appendChild(indicadorVerificacion(r.verificado_en, o.umbrales, false));
    pie.appendChild(h('span', { class: 'verif-det', text: 'Confirmó ' + (o.usuarios.get(r.verificado_por) || '?') + ' el ' + fmtFecha(r.verificado_en) }));
    pie.appendChild(h('span', { class: 'esp' }));
    if (puede(o.u, 'verificar', o.modulo, o.orgId)) {
      pie.appendChild(h('button', { type: 'button', class: 'chico', text: 'Confirmar vigente', title: 'Confirma que lo documentado sigue siendo real. No abre ningún formulario.', onclick: async () => {
        try { if (!(await confirmarConPasos(o.coleccion, r.id, o.u))) return; toast('Confirmado como vigente: ' + o.titulo + ' · verificado hoy por ' + o.u.usuario_nombre); o.rerender(); }
        catch (e) { toast(e instanceof Error ? e.message : 'No se pudo confirmar.'); }
      } }));
    } else pie.appendChild(h('span', { class: 'verif-det', text: o.u.usuario_perfil === 'operario' ? 'Tu rol no confirma vigencia.' : 'Sin permiso para confirmar en este módulo.' }));
  }
  return h('div', { class: 'bloque ficha t-' + o.tipo }, [cab, h('div', { class: 'ficha-cab' }, [h('div', { class: 'ficha-datos' }, [o.datos])]), r ? pie : null]);
}

/** @type {Object<string, string>} */
const ROTULO_CAMPO = {
  credencial_nombre: 'Nombre', credencial_tipo: 'Tipo', credencial_usuario: 'Usuario', credencial_secreto: 'Contraseña',
  credencial_url_o_host: 'Host o URL', equipo_id: 'Equipo', configuracion_id: 'Configuración vinculada', credencial_notas: 'Notas',
  credencial_vence_en: 'Vence el', configuracion_tipo: 'Tipo', configuracion_titulo: 'Título', configuracion_contenido: 'Contenido',
  configuracion_datos: 'Reglas', configuracion_version_fecha: 'Fecha', configuracion_notas: 'Notas', credencial_secreto_actualizado_en: 'Fecha del último cambio de contraseña'
};

/** @param {string|null} campo */
export function rotuloCampo(campo) { return campo ? ROTULO_CAMPO[campo] || campo.replace(/^[a-z]+_/, '').replace(/_/g, ' ') : ''; }

/**
 * Valor de un cambio del historial, legible y corto. Los secretos nunca llegan (vienen null y ocultos).
 * @param {string|null} json @param {string|null} campo @param {boolean} oculto @param {Map<string, string>} nombres ids → nombre (equipos, configuraciones)
 */
export function valorHistorial(json, campo, oculto, nombres) {
  if (oculto) return '••••••••';
  if (json === null || json === undefined) return '—';
  let v;
  try { v = JSON.parse(json); } catch { v = json; }
  if (v === null || v === '') return '—';
  if (campo === 'equipo_id' || campo === 'configuracion_id') return nombres.get(v) || '(registro dado de baja)';
  if (campo === 'configuracion_datos') return Array.isArray(v) ? v.length + ' reglas' : '—';
  if (campo === 'configuracion_contenido') return String(v).split('\n').length + ' líneas de texto';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtFecha(v);
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 70 ? t.slice(0, 67) + '…' : t;
}

/**
 * Chips con la cantidad por nivel de verificación (MJ25).
 * @param {Array<[string, string, number]>} items [clave, rótulo, cantidad] @param {string} actual @param {(k: string) => void} alElegir
 */
export function chips(items, actual, alElegir) {
  return h('div', { class: 'chips-estado', role: 'group', 'aria-label': 'Cantidad por estado de verificación' }, items.map(([k, r, n]) =>
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(actual === k), onclick: () => alElegir(actual === k ? 'todos' : k) }, [r, h('span', { class: 'n', text: String(n) })])));
}

export { ir };

/**
 * Botón «Dar de baja»: directo para quien puede `baja`; pedido para el técnico que puede modificar; nada para el resto.
 * @param {{u: UsuarioSesion, coleccion: string, registro: any, modulo: import('./modelos.js').Modulo, orgId: string, nombre: string, volver: string, rerender: () => void}} o
 * @returns {Promise<HTMLElement|null>}
 */
export async function botonBaja(o) {
  const directa = puede(o.u, 'baja', o.modulo, o.orgId);
  if (!directa && !puede(o.u, 'pedir_baja', o.modulo, o.orgId)) return null;
  if (!directa) {
    const pend = await repositorio.contar('solicitudes', s => s.solicitud_tipo === 'baja_registro' && s.solicitud_estado === 'pendiente' && s.solicitud_entidad_id === o.registro.id);
    if (pend) return h('span', { class: 'mut', text: 'Baja pedida, la confirma el superadmin' });
  }
  return h('button', { type: 'button', text: directa ? 'Dar de baja' : 'Pedir la baja', onclick: () => {
    const motivo = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Motivo (opcional)', 'aria-label': 'Motivo', style: 'width:100%' }));
    abrirModal(h('div', { role: 'dialog', 'aria-label': 'Dar de baja' }, [
      h('h2', { text: directa ? '¿Dar de baja «' + o.nombre + '»?' : '¿Pedir la baja de «' + o.nombre + '»?' }),
      h('p', { class: 'mut', text: directa ? 'Deja de aparecer en los listados. Queda en el historial y se puede restaurar.' : 'La confirma el superadmin; hasta entonces sigue vigente.' }),
      directa ? null : motivo,
      h('div', { class: 'herr' }, [
        h('button', { type: 'button', class: 'primario', text: directa ? 'Sí, dar de baja' : 'Enviar pedido', onclick: async () => {
          try {
            if (directa) await repositorio.guardar(o.coleccion, { ...o.registro, eliminado_en: ahoraISO() }, o.u.id, { motivo: 'Baja' });
            else await repositorio.crearSolicitudBaja({ coleccion: o.coleccion, id: o.registro.id, usuarioId: o.u.id, motivo: motivo.value.trim() });
            cerrarModal();
            toast(directa ? 'Dado de baja: ' + o.nombre : 'Pedido de baja enviado');
            await repintarMarco();
            if (directa) ir(o.volver); else o.rerender();
          } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo completar.'); }
        } }),
        h('button', { type: 'button', text: 'Cancelar', onclick: cerrarModal })])]));
  } });
}
