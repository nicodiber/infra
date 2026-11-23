// @ts-check
/** P15 · Usuarios: los de roles inferiores al del usuario actual (superadmin: todos), con filtros y Desactivar / Reactivar. */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { puedeGestionar, nombresDeUsuarios, cambiarEstadoUsuario, ROLES_ASCENDENTE } from '../assets/js/gestion.js';
import { ir, pantalla, migasRaiz, toast, abrirModal, cerrarModal } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, fmtFechaHora } from '../assets/js/utiles.js';
import { ROTULO_PERFIL } from '../assets/js/modelos.js';

const ROTULO_ESTADO = { activo: 'Activo', inactivo: 'Desactivado', pendiente_aprobacion: 'Pendiente' };

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = sesion.usuarioActual();
  const orgActiva = sesion.organizacionActiva();
  const migas = (await migasRaiz()).concat([['Usuarios']]);
  pantalla(contenedor, { codigo: 'P15', nombre: 'Usuarios', migas });
  if (!u) return;
  if (!puede(u, 'ver_usuarios', null, orgActiva)) {
    contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Tu rol (' + ROTULO_PERFIL[u.usuario_perfil] + ') no tiene acceso a Usuarios.' }),
      h('div', { style: 'margin-top:8px' }, [h('button', { text: 'Volver al inicio', onclick: () => ir('#/inicio') })])]));
    return;
  }
  const esSA = u.usuario_perfil === 'superadmin';
  const [todos, nombres, orgs] = await Promise.all([repositorio.listar('usuarios', null, { ordenarPor: 'usuario_nombre' }), nombresDeUsuarios(), repositorio.listar('organizaciones')]);
  const nombreOrg = new Map(orgs.map(o => [o.id, o.organizacion_nombre]));
  const visibles = todos.filter(x => puedeGestionar(u, x) || (esSA && x.id === u.id));
  const ingresos = new Map();
  for (const x of visibles) ingresos.set(x.id, await repositorio.ultimoIngreso(x.id));

  const f = { estado: 'todos', rol: '', org: esSA ? (orgActiva || '') : '', q: '' };
  const zona = h('div');
  const chips = h('div', { class: 'chips-estado' });

  const selRol = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Filtrar por rol' }, [h('option', { value: '', text: 'Todos los roles' })]
    .concat(ROLES_ASCENDENTE.filter(r => visibles.some(x => x.usuario_perfil === r)).map(r => h('option', { value: r, text: ROTULO_PERFIL[r] })))));
  const selOrg = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Filtrar por organización' }, [h('option', { value: '', text: 'Todas las organizaciones' })]
    .concat(orgs.map(o => h('option', { value: o.id, text: o.organizacion_nombre })))));
  selOrg.value = f.org;
  const campoQ = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Buscar por nombre o email', 'aria-label': 'Buscar usuario', style: 'width:240px' }));
  selRol.addEventListener('change', () => { f.rol = selRol.value; pintar(); });
  selOrg.addEventListener('change', () => { f.org = selOrg.value; pintar(); });
  campoQ.addEventListener('input', () => { f.q = campoQ.value.trim().toLowerCase(); pintar(); });

  /** @param {any} x */
  const pasaBase = x => (!f.rol || x.usuario_perfil === f.rol) && (!f.org || x.organizacion_id === f.org)
    && (!f.q || (x.usuario_nombre + ' ' + x.usuario_email).toLowerCase().includes(f.q));

  /** @param {any} x */
  function confirmarDesactivar(x) {
    const caja = h('div', { style: 'max-width:460px' }, [
      h('h2', { text: 'Desactivar a ' + x.usuario_nombre }),
      h('p', { text: 'No va a poder ingresar hasta que lo reactives. Sus datos y su historial se conservan.' }),
      h('div', { class: 'herr' }, [
        h('button', { class: 'primario', text: 'Desactivar', onclick: async () => { cerrarModal(); await cambiarEstadoUsuario(x, 'inactivo', /** @type {any} */ (u).id); toast('Usuario desactivado'); ir('#/usuarios'); } }),
        h('button', { text: 'Cancelar', onclick: () => cerrarModal() })])]);
    abrirModal(caja);
  }

  function pintar() {
    const base = visibles.filter(pasaBase);
    const n = { todos: base.length, activo: base.filter(x => x.usuario_estado === 'activo').length, inactivo: base.filter(x => x.usuario_estado !== 'activo').length };
    chips.textContent = '';
    for (const [k, t] of /** @type {Array<[string, string]>} */ ([['todos', 'Todos'], ['activo', 'Activos'], ['inactivo', 'Desactivados']])) {
      chips.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': f.estado === k ? 'true' : 'false', onclick: () => { f.estado = k; pintar(); } },
        [t, h('span', { class: 'n', text: String(/** @type {any} */ (n)[k]) })]));
    }
    const lista = base.filter(x => f.estado === 'todos' || (f.estado === 'activo' ? x.usuario_estado === 'activo' : x.usuario_estado !== 'activo'));
    zona.textContent = '';
    if (!lista.length) {
      zona.appendChild(h('div', { class: 'aviso' }, [h('div', { text: visibles.length ? 'Ningún usuario coincide con los filtros.' : 'Todavía no hay usuarios de rol inferior al tuyo.' }),
        visibles.length || !puede(u, 'crear_usuario', null, orgActiva) ? null : h('div', { style: 'margin-top:8px' }, [h('button', { class: 'primario', text: 'Crear el primero', onclick: () => ir('#/usuario/nuevo') })])]));
      return;
    }
    const cab = ['Nombre', 'Rol'].concat(esSA ? ['Organización'] : [], ['Estado', 'Creado por', 'Creado el', 'Último ingreso', '']);
    const filas = lista.map(x => {
      const ing = ingresos.get(x.id);
      const gestionable = x.id !== u.id && puedeGestionar(u, x);
      const boton = !gestionable ? '' : x.usuario_estado === 'activo'
        ? h('button', { class: 'chico', text: 'Desactivar', 'aria-label': 'Desactivar a ' + x.usuario_nombre, onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); confirmarDesactivar(x); } })
        : h('button', { class: 'chico', text: 'Reactivar', 'aria-label': 'Reactivar a ' + x.usuario_nombre, onclick: async (/** @type {Event} */ ev) => { ev.stopPropagation(); await cambiarEstadoUsuario(x, 'activo', u.id); toast('Usuario reactivado'); ir('#/usuarios'); } });
      return [x.usuario_nombre + (x.id === u.id ? ' (vos)' : ''), ROTULO_PERFIL[x.usuario_perfil]].concat(esSA ? [x.organizacion_id ? (nombreOrg.get(x.organizacion_id) || '') : 'Todas'] : [],
        [/** @type {any} */ (ROTULO_ESTADO)[x.usuario_estado] || x.usuario_estado, nombres.get(x.creado_por) || '—', fmtFecha(x.creado_en), ing ? fmtFechaHora(ing) : '—', boton]);
    });
    zona.appendChild(tabla(cab, filas, { onFila: (_, i) => ir('#/usuario/' + lista[i].id) }));
    zona.appendChild(h('div', { class: 'mut', style: 'margin-top:6px;font-size:12.5px', text: 'El último ingreso se registra solo en este navegador (prototipo).' }));
  }
  pintar();

  contenedor.appendChild(h('h1', { text: 'Usuarios' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [
    h('span', { class: 'mut', style: 'flex:1', text: esSA ? 'Ves a todos los usuarios.' : 'Solo ves usuarios de rol inferior al tuyo (' + ROTULO_PERFIL[u.usuario_perfil] + ') en tu organización.' }),
    puede(u, 'crear_usuario', null, orgActiva) ? h('button', { class: 'primario', text: 'Nuevo usuario', onclick: () => ir('#/usuario/nuevo') }) : null]));
  contenedor.appendChild(h('div', { class: 'herr' }, [campoQ, selRol, esSA ? selOrg : null]));
  contenedor.appendChild(chips);
  contenedor.appendChild(zona);
}
