// @ts-check
/** P16 · Ficha y alta de usuario: datos, matriz de permisos por módulo (plantilla según el rol), credenciales del prototipo e historial. */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import {
  rolesAsignables, puedeGestionar, plantillaPermisos, limiteConcesion, permisosDe, guardarPermisos, claveTemporal, emailValido,
  nombresDeUsuarios, cambiarEstadoUsuario
} from '../assets/js/gestion.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, ahoraISO, fmtFecha, fmtFechaHora } from '../assets/js/utiles.js';
import { ROTULO_PERFIL, ROTULO_MODULO, MODULOS } from '../assets/js/modelos.js';

/** @typedef {import('../assets/js/gestion.js').Matriz} Matriz */

/** @type {Object<string, string>} */
const ROTULO_MOD_LARGO = { ...ROTULO_MODULO, credenciales: 'Credenciales (nombre y tipo; la contraseña se pide)' };
const ROTULO_ESTADO = /** @type {Object<string, string>} */ ({ activo: 'Activo', inactivo: 'Desactivado', pendiente_aprobacion: 'Pendiente' });

/**
 * Dibuja la matriz Módulo × Ver / Modificar. Devuelve el nodo y una función para leer lo marcado.
 * @param {{perfil: string, valores: Matriz, editable: boolean, limite: (m: any) => {ver: boolean, mod: boolean}}} o
 */
function matriz(o) {
  const total = o.perfil === 'superadmin' || o.perfil === 'gerente';
  const t = h('table', { class: 'matriz' });
  t.appendChild(h('thead', null, [h('tr', null, ['Módulo', 'Ver', 'Modificar'].map(x => h('th', { text: x })))]));
  const tb = h('tbody');
  /** @type {Object<string, [HTMLInputElement, HTMLInputElement]>} */
  const cajas = {};
  for (const m of MODULOS) {
    const v = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', 'aria-label': 'Ver ' + ROTULO_MODULO[m] }));
    const md = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', 'aria-label': 'Modificar ' + ROTULO_MODULO[m] }));
    const lim = o.limite(m);
    v.checked = total || !!o.valores[m].ver;
    md.checked = total ? true : o.perfil === 'operario' ? false : !!o.valores[m].mod;
    if (!o.editable || total) { v.disabled = true; md.disabled = true; }
    else {
      if (!lim.ver) v.disabled = true;
      if (!lim.mod || o.perfil === 'operario') md.disabled = true;
      v.addEventListener('change', () => { if (!v.checked && !md.disabled) md.checked = false; });
      md.addEventListener('change', () => { if (md.checked && !v.disabled) v.checked = true; });
    }
    cajas[m] = [v, md];
    if (o.editable) tb.appendChild(h('tr', null, [h('td', { text: ROTULO_MOD_LARGO[m] }), h('td', null, [v]), h('td', null, [md])]));
    else tb.appendChild(h('tr', null, [h('td', { text: ROTULO_MOD_LARGO[m] }), h('td', { text: v.checked ? 'Sí' : 'No' }), h('td', { text: md.checked ? 'Sí' : 'No' })]));
  }
  t.appendChild(tb);
  const nota = total ? 'Este rol tiene acceso completo dentro de su alcance.'
    : o.perfil === 'operario' ? 'El operario es de solo lectura: nunca puede modificar.' : '';
  const nodo = h('div', null, [t, nota ? h('div', { class: 'mut', style: 'margin-top:4px', text: nota }) : null]);
  return { nodo, leer: () => { /** @type {Matriz} */ const r = {}; for (const m of MODULOS) r[m] = { ver: cajas[m][0].checked, mod: cajas[m][1].checked }; return r; } };
}

/** Matriz de la plantilla del rol, recortada a lo que puede conceder quien edita. @param {string} perfil @param {(m: any) => {ver: boolean, mod: boolean}} limite */
function plantillaRecortada(perfil, limite) {
  const p = plantillaPermisos(/** @type {any} */ (perfil));
  for (const m of MODULOS) { const l = limite(m); p[m] = { ver: p[m].ver && l.ver, mod: p[m].mod && l.mod }; }
  return p;
}

/** @param {string} texto */
async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); toast('Credenciales copiadas'); } catch (e) { toast('No se pudo copiar: seleccioná el texto y copialo a mano'); }
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = sesion.usuarioActual();
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const id = partes[1] || 'nuevo';
  const tab = partes[2] === 'historial' ? 'historial' : 'datos';
  const nuevo = id === 'nuevo';
  const base = await migasRaiz();
  const sinAcceso = (/** @type {string} */ que) => {
    pantalla(contenedor, { codigo: 'P16', nombre: 'Ficha / alta de usuario', migas: base.concat([['Usuarios', '#/usuarios']]) });
    contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'No tenés acceso a ' + que + '.' }),
      h('div', { style: 'margin-top:8px' }, [h('button', { text: 'Volver a Usuarios', onclick: () => ir('#/usuarios') })])]));
  };
  if (!u) return;
  const orgActiva = sesion.organizacionActiva();
  if (!puede(u, 'ver_usuarios', null, orgActiva)) return sinAcceso('Usuarios');
  const esSA = u.usuario_perfil === 'superadmin';

  /** @type {any} */
  let objetivo = null;
  if (!nuevo) {
    objetivo = await repositorio.obtener('usuarios', id);
    if (!objetivo || !(puedeGestionar(u, objetivo) || objetivo.id === u.id)) return sinAcceso('este usuario');
  } else if (!puede(u, 'crear_usuario', null, orgActiva)) return sinAcceso('el alta de usuarios');

  const [nombres, orgs] = await Promise.all([nombresDeUsuarios(), repositorio.listar('organizaciones', null, { ordenarPor: 'organizacion_nombre' })]);
  const nombreOrg = (/** @type {string|null} */ i) => (i ? (orgs.find(o => o.id === i) || { organizacion_nombre: '' }).organizacion_nombre : 'Todas las organizaciones');
  const roles = rolesAsignables(u);
  const propio = !nuevo && objetivo.id === u.id;

  pantalla(contenedor, { codigo: 'P16', nombre: 'Ficha / alta de usuario', migas: base.concat([['Usuarios', '#/usuarios'], [nuevo ? 'Nuevo usuario' : objetivo.usuario_nombre]]) });
  contenedor.appendChild(h('h1', { text: nuevo ? 'Alta de usuario' : objetivo.usuario_nombre }));
  if (!nuevo) {
    const ing = await repositorio.ultimoIngreso(objetivo.id);
    contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:2px', text: 'Creado por ' + (nombres.get(objetivo.creado_por) || '—') + ' el ' + fmtFecha(objetivo.creado_en) + ' · último ingreso: ' + (ing ? fmtFechaHora(ing) : '—') + ' · ' + ROTULO_ESTADO[objetivo.usuario_estado] }));
    const tabs = /** @type {Array<[string, string]>} */ ([['datos', 'Datos y permisos'], ['historial', 'Historial']]);
    contenedor.appendChild(h('div', { class: 'pestanas', role: 'tablist' }, tabs.map(t => h('button', { type: 'button', role: 'tab', class: t[0] === tab ? 'sel' : '', 'aria-selected': t[0] === tab ? 'true' : 'false', text: t[1],
      onclick: () => ir('#/usuario/' + objetivo.id + (t[0] === 'historial' ? '/historial' : '')) }))));
    if (tab === 'historial') { contenedor.appendChild(await historial(objetivo, nombres, orgs)); return; }
  }

  // ---------------------------------------------------------------- datos y permisos
  const caja = h('div', { class: 'bloque', style: 'margin-top:8px' });
  contenedor.appendChild(caja);
  let editando = nuevo;
  const guardados = nuevo ? null : await permisosDe(objetivo.id);

  function pintar() {
    caja.textContent = '';
    const perfilInicial = nuevo ? 'operario' : objetivo.usuario_perfil;
    const orgInicial = nuevo ? (esSA ? (orgActiva || '') : u && u.organizacion_id || '') : objetivo.organizacion_id;
    const campos = h('div', { class: 'datos', style: 'grid-template-columns:repeat(3,1fr)' });
    const campo = (/** @type {string} */ etq, /** @type {Node} */ nodo, /** @type {string} */ idc) => h('div', { class: 'campo' }, [h('label', { for: idc, text: etq }), nodo]);
    const lectura = (/** @type {string} */ txt) => h('div', { text: txt || '—' });
    const resumen = h('div', { 'aria-live': 'polite' });

    if (!editando) {
      campos.appendChild(campo('Nombre', lectura(objetivo.usuario_nombre), 'x1'));
      campos.appendChild(campo('Email', lectura(objetivo.usuario_email), 'x2'));
      campos.appendChild(campo('Rol', lectura(ROTULO_PERFIL[objetivo.usuario_perfil]), 'x3'));
      campos.appendChild(campo('Organización', lectura(nombreOrg(objetivo.organizacion_id)), 'x4'));
      campos.appendChild(campo('Estado', lectura(ROTULO_ESTADO[objetivo.usuario_estado]), 'x5'));
      caja.appendChild(campos);
      caja.appendChild(h('h3', { text: 'Permisos por módulo', style: 'margin:12px 0 4px' }));
      const lim = (/** @type {any} */ m) => limiteConcesion(u, m, objetivo.organizacion_id);
      caja.appendChild(matriz({ perfil: objetivo.usuario_perfil, valores: /** @type {Matriz} */ (guardados), editable: false, limite: lim }).nodo);
      const gestionable = !propio && puedeGestionar(u, objetivo);
      caja.appendChild(h('div', { class: 'herr' }, [
        gestionable ? h('button', { class: 'primario', text: 'Editar', onclick: () => { editando = true; pintar(); } }) : null,
        gestionable ? (objetivo.usuario_estado === 'activo'
          ? h('button', { text: 'Desactivar', onclick: async () => { await cambiarEstadoUsuario(objetivo, 'inactivo', u.id); toast('Usuario desactivado'); ir(location.hash); } })
          : h('button', { text: 'Reactivar', onclick: async () => { await cambiarEstadoUsuario(objetivo, 'activo', u.id); toast('Usuario reactivado'); ir(location.hash); } })) : null,
        h('button', { text: 'Volver a Usuarios', onclick: () => ir('#/usuarios') })]));
      if (propio) caja.appendChild(h('div', { class: 'mut', text: 'Es tu propio usuario: no podés cambiar tu rol, tus permisos ni desactivarte.' }));
      return;
    }

    const nombre = /** @type {HTMLInputElement} */ (h('input', { id: 'u-nombre', value: nuevo ? '' : objetivo.usuario_nombre, placeholder: 'Nombre y apellido (ficticio)' }));
    const email = /** @type {HTMLInputElement} */ (h('input', { id: 'u-email', type: 'email', value: nuevo ? '' : objetivo.usuario_email, placeholder: 'nombre@empresa.example' }));
    const selRol = /** @type {HTMLSelectElement} */ (h('select', { id: 'u-rol' }, roles.map(r => h('option', { value: r, text: ROTULO_PERFIL[r] }))));
    selRol.value = roles.includes(perfilInicial) ? perfilInicial : roles[0];
    const selOrg = /** @type {HTMLSelectElement} */ (h('select', { id: 'u-org' }, orgs.map(o => h('option', { value: o.id, text: o.organizacion_nombre }))));
    if (orgInicial) selOrg.value = orgInicial;
    campos.appendChild(campo('Nombre', nombre, 'u-nombre'));
    campos.appendChild(campo('Email (es el usuario de ingreso)', email, 'u-email'));
    campos.appendChild(campo('Rol (solo inferiores al tuyo)', selRol, 'u-rol'));
    if (nuevo && esSA) campos.appendChild(campo('Organización', selOrg, 'u-org'));
    else campos.appendChild(campo('Organización', lectura(nombreOrg(nuevo ? u.organizacion_id : objetivo.organizacion_id)), 'x4'));
    caja.appendChild(campos);

    const orgDestino = () => (selRol.value === 'superadmin' ? null : nuevo ? (esSA ? selOrg.value : u.organizacion_id) : objetivo.organizacion_id);
    const lim = (/** @type {any} */ m) => limiteConcesion(u, m, orgDestino());
    const cajaMatriz = h('div');
    /** @type {() => Matriz} */
    let leer = () => plantillaPermisos('operario');
    const pintarMatriz = (/** @type {boolean} */ desdePlantilla) => {
      cajaMatriz.textContent = '';
      const valores = desdePlantilla || nuevo || !guardados ? plantillaRecortada(selRol.value, lim) : guardados;
      const m = matriz({ perfil: selRol.value, valores, editable: true, limite: lim });
      leer = m.leer;
      cajaMatriz.appendChild(m.nodo);
      cajaMatriz.appendChild(h('div', { class: 'mut', style: 'margin-top:4px', text: desdePlantilla || nuevo ? 'Cargada desde la plantilla del rol «' + ROTULO_PERFIL[selRol.value] + '». Ajustala módulo por módulo. Nadie puede dar más permisos de los que tiene.' : 'Permisos actuales. Si cambiás el rol, se carga la plantilla del nuevo rol.' }));
    };
    pintarMatriz(false);
    selRol.addEventListener('change', () => pintarMatriz(true));
    selOrg.addEventListener('change', () => pintarMatriz(true));
    caja.appendChild(h('h3', { text: 'Permisos por módulo', style: 'margin:12px 0 4px' }));
    caja.appendChild(cajaMatriz);
    caja.appendChild(resumen);

    const bGuardar = /** @type {HTMLButtonElement} */ (h('button', { class: 'primario', text: nuevo ? 'Crear usuario' : 'Guardar' }));
    bGuardar.addEventListener('click', async () => {
      resumen.textContent = '';
      const error = (/** @type {string} */ t) => resumen.appendChild(h('div', { class: 'msg mal', role: 'alert', text: t }));
      const n = nombre.value.trim(), e = email.value.trim();
      if (!n) return error('Completá el nombre.');
      if (!emailValido(e)) return error('Escribí un email válido, por ejemplo nombre@empresa.example.');
      const todos = await repositorio.listar('usuarios', null, { incluirBajas: true });
      if (todos.some(x => x.id !== (objetivo && objetivo.id) && x.usuario_email.toLowerCase() === e.toLowerCase())) return error('Ya existe un usuario con ese email.');
      if (!roles.includes(selRol.value)) return error('No podés asignar ese rol.');
      const perfil = selRol.value;
      const org = orgDestino();
      if (perfil !== 'superadmin' && !org) return error('Elegí la organización del usuario.');
      bGuardar.disabled = true;
      try {
        if (nuevo) {
          const clave = claveTemporal();
          const creado = await repositorio.guardar('usuarios', {
            usuario_nombre: n, usuario_email: e, usuario_perfil: perfil, organizacion_id: org, usuario_estado: 'activo',
            aprobado_por: u.id, aprobado_en: ahoraISO(), usuario_clave_prototipo: clave
          }, u.id);
          await guardarPermisos(creado.id, perfil, leer(), u.id);
          caja.textContent = '';
          caja.appendChild(h('div', { class: 'msg ok', role: 'status' }, [h('b', { text: 'Usuario creado. ' }), n + ' ya puede ingresar (queda activo).']));
          caja.appendChild(h('div', { class: 'bloque gris', style: 'margin-top:10px' }, [
            h('h3', { text: 'Credenciales de acceso del prototipo para entregar a ' + n }),
            h('div', { class: 'sec', style: 'margin:6px 0', text: 'Usuario: ' + e }),
            h('div', { class: 'sec', style: 'margin:6px 0', text: 'Contraseña temporal: ' + clave }),
            h('div', { class: 'mut', text: 'Es una contraseña ficticia, solo del prototipo. Se muestra una sola vez: pasásela en persona.' }),
            h('div', { class: 'herr' }, [
              h('button', { class: 'primario', text: 'Copiar', onclick: () => copiar('Usuario: ' + e + '\nContraseña: ' + clave) }),
              h('button', { text: 'Ver la ficha', onclick: () => ir('#/usuario/' + creado.id) }),
              h('button', { text: 'Crear otro usuario', onclick: () => ir('#/usuario/nuevo') }),
              h('button', { text: 'Volver a Usuarios', onclick: () => ir('#/usuarios') })])]));
        } else {
          await repositorio.guardar('usuarios', { ...objetivo, usuario_nombre: n, usuario_email: e, usuario_perfil: perfil, organizacion_id: org }, u.id);
          await guardarPermisos(objetivo.id, perfil, leer(), u.id);
          toast('Cambios guardados');
          ir(location.hash);
        }
      } catch (err) { bGuardar.disabled = false; error(err instanceof Error ? err.message : 'No se pudo guardar.'); }
    });
    caja.appendChild(h('div', { class: 'herr' }, [bGuardar, h('button', { text: 'Cancelar', onclick: () => { if (nuevo) ir('#/usuarios'); else { editando = false; pintar(); } } })]));
    if (nuevo) caja.appendChild(h('div', { class: 'mut', text: 'El usuario queda activo enseguida y se le muestran las credenciales de acceso para que se las entregues.' }));
  }
  pintar();
}

/**
 * Historial del usuario: cambios de sus datos y de sus permisos por módulo.
 * @param {any} objetivo @param {Map<string, string>} nombres @param {any[]} orgs
 */
async function historial(objetivo, nombres, orgs) {
  const permisos = await repositorio.listar('permisos_modulo', { usuario_id: objetivo.id }, { incluirBajas: true });
  const modDe = new Map(permisos.map(p => [p.id, p.modulo]));
  const cambios = await repositorio.listar('cambios', c => (c.cambio_entidad === 'Usuario' && c.entidad_id === objetivo.id) || (c.cambio_entidad === 'PermisoModulo' && modDe.has(c.entidad_id)),
    { ordenarPor: 'cambio_fecha', descendente: true });
  const visibles = cambios.filter(c => !(c.cambio_entidad === 'PermisoModulo' && c.cambio_operacion === 'alta'));
  /** @type {Object<string, string>} */
  const ETQ = { usuario_nombre: 'Nombre', usuario_email: 'Email', usuario_perfil: 'Rol', organizacion_id: 'Organización', usuario_estado: 'Estado', puede_ver: 'Ver', puede_modificar: 'Modificar', aprobado_por: 'Aprobado por', aprobado_en: 'Aprobado el' };
  /** @param {string} campo @param {string|null} crudo */
  const valor = (campo, crudo) => {
    if (crudo === null) return '—';
    let v; try { v = JSON.parse(crudo); } catch (e) { v = crudo; }
    if (campo === 'usuario_perfil') return ROTULO_PERFIL[v] || String(v);
    if (campo === 'usuario_estado') return ROTULO_ESTADO[v] || String(v);
    if (campo === 'organizacion_id') return (orgs.find(o => o.id === v) || { organizacion_nombre: String(v) }).organizacion_nombre;
    if (campo === 'puede_ver' || campo === 'puede_modificar') return v ? 'Sí' : 'No';
    if (campo === 'aprobado_por') return nombres.get(v) || String(v);
    return String(v);
  };
  /** @param {any} c */
  const queCambio = c => {
    const esPerm = c.cambio_entidad === 'PermisoModulo';
    const mod = esPerm ? 'Permiso «' + (ROTULO_MODULO[modDe.get(c.entidad_id)] || '') + '» · ' : '';
    if (c.cambio_operacion === 'alta') return 'Alta del usuario, con los permisos de la plantilla de su rol';
    if (c.cambio_operacion === 'baja') return mod + 'Quitado';
    if (c.cambio_operacion === 'restauracion') return mod + 'Restablecido';
    if (c.cambio_valor_oculto) return mod + (ETQ[c.cambio_campo] || c.cambio_campo) + ' cambió (valor oculto)';
    return mod + (ETQ[c.cambio_campo] || c.cambio_campo) + ': ' + valor(c.cambio_campo, c.cambio_valor_anterior) + ' → ' + valor(c.cambio_campo, c.cambio_valor_nuevo);
  };
  const caja = h('div', { class: 'bloque', style: 'margin-top:8px' });
  if (!visibles.length) { caja.appendChild(h('div', { class: 'aviso', text: 'Este usuario todavía no tiene cambios registrados.' })); return caja; }
  const filas = visibles.slice(0, 100).map(c => [fmtFechaHora(c.cambio_fecha), nombres.get(c.usuario_id) || '—', queCambio(c)]);
  const t = h('table');
  t.appendChild(h('thead', null, [h('tr', null, ['Fecha', 'Quién', 'Qué cambió'].map(x => h('th', { text: x })))]));
  t.appendChild(h('tbody', null, filas.map(f => h('tr', null, f.map(x => h('td', { text: x }))))));
  caja.appendChild(h('div', { class: 'mut', style: 'margin-bottom:6px', text: visibles.length + (visibles.length === 1 ? ' cambio' : ' cambios') + (visibles.length > 100 ? ' (se muestran los 100 más nuevos)' : '') }));
  caja.appendChild(t);
  return caja;
}
