// @ts-check
/** P02 · Organizaciones (CU02, H03): tarjeta por organización con sus cantidades; solo el superadmin. */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, repintarMarco, abrirModal, cerrarModal, toast } from '../assets/js/marco.js';
import { h, normalizar } from '../assets/js/utiles.js';
import { abrirAlta } from '../assets/js/altas.js';

/**
 * Formulario de alta o edición de una organización (solo superadmin). Nombre obligatorio y único (también entre las dadas de baja).
 * @param {any|null} org null para crear
 * @param {(o: any) => void|Promise<void>} alGuardar
 */
export function abrirFormularioOrganizacion(org, alGuardar) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  if (!puede(u, 'ver_organizaciones')) { toast('Solo el superadmin gestiona organizaciones.'); return; }
  if (!org) { // el alta vive en `assets/js/altas/organizaciones.js`; acá solo se edita
    abrirAlta('organizaciones').then(async nueva => { if (nueva) { toast('Organización «' + nueva.organizacion_nombre + '» creada'); await alGuardar(nueva); } });
    return;
  }
  const inNombre = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'org-nombre', maxlength: '120' })); inNombre.value = org ? org.organizacion_nombre : '';
  const inRubro = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'org-rubro', maxlength: '80' })); inRubro.value = (org && org.organizacion_rubro) || '';
  const inCuit = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'org-cuit', maxlength: '20', placeholder: '30-00000000-0' })); inCuit.value = (org && org.organizacion_cuit) || '';
  const inNotas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'org-notas', rows: '3' })); inNotas.value = (org && org.organizacion_notas) || '';
  const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
  const campo = (/** @type {string} */ etq, /** @type {string} */ idc, /** @type {HTMLElement} */ el) => h('div', { class: 'campo' }, [h('label', { for: idc, text: etq }), el]);
  const guardar = async () => {
    const falla = (/** @type {string} */ m) => { error.textContent = m; error.hidden = false; };
    const nom = inNombre.value.trim();
    if (!nom) return falla('Falta el nombre de la organización.');
    const todas = await repositorio.listar('organizaciones', null, { incluirBajas: true });
    const igual = todas.find(o => (!org || o.id !== org.id) && normalizar(o.organizacion_nombre) === normalizar(nom));
    if (igual) return falla('Ya existe una organización llamada «' + igual.organizacion_nombre + '»' + (igual.eliminado_en ? ' (dada de baja: podés reactivarla desde «Ver dadas de baja»)' : '') + '.');
    try {
      const guardada = await repositorio.guardar('organizaciones', { ...org, organizacion_nombre: nom, organizacion_rubro: inRubro.value.trim() || null,
        organizacion_cuit: inCuit.value.trim() || null, organizacion_notas: inNotas.value.trim() || null }, u.id);
      cerrarModal();
      toast('Organización «' + nom + '» actualizada');
      await alGuardar(guardada);
    } catch (e) { falla(e instanceof Error ? e.message : 'No se pudo guardar.'); }
  };
  abrirModal(h('div', { class: 'bloque rk-modal rk-form', role: 'dialog', 'aria-label': org ? 'Editar organización' : 'Nueva organización' }, [
    h('h2', { text: org ? 'Editar «' + org.organizacion_nombre + '»' : 'Nueva organización' }),
    campo('Nombre *', 'org-nombre', inNombre), campo('Rubro', 'org-rubro', inRubro), campo('CUIT', 'org-cuit', inCuit), campo('Notas', 'org-notas', inNotas), error,
    h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: org ? 'Guardar' : 'Crear organización', onclick: guardar }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() })])]));
  inNombre.focus();
}

/** @param {HTMLElement} contenedor */
export async function renderVistaOrganizaciones(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const migas = /** @type {Array<[string, string?]>} */ ([['Organizaciones']]);
  if (!puede(u, 'ver_organizaciones')) {
    pantalla(contenedor, { codigo: 'P02', nombre: 'Organizaciones', migas });
    contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Tu rol no tiene acceso al listado de organizaciones: cada rol trabaja sobre la suya.' }),
      h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/inicio', text: 'Ir al inicio de mi organización' })])]));
    return;
  }
  pantalla(contenedor, { codigo: 'P02', nombre: 'Organizaciones', migas });

  const orgs = await repositorio.listar('organizaciones', null, { ordenarPor: 'organizacion_nombre' });
  const bajas = await repositorio.listar('organizaciones', o => !!o.eliminado_en, { incluirBajas: true, ordenarPor: 'organizacion_nombre' });
  const refrescar = async () => { await repintarMarco(); contenedor.textContent = ''; await renderVistaOrganizaciones(contenedor); };
  /** @type {any[]} */
  const datos = [];
  for (const o of orgs) {
    const porOrg = { organizacion_id: o.id };
    const [equipos, servidores, vlans, racks, credenciales, pendientes] = await Promise.all([
      repositorio.contar('equipos', r => r.organizacion_id === o.id && r.equipo_tipo !== 'servidor'),
      repositorio.contar('equipos', r => r.organizacion_id === o.id && r.equipo_tipo === 'servidor'),
      repositorio.contar('vlans', porOrg), repositorio.contar('racks', porOrg), repositorio.contar('credenciales', porOrg),
      repositorio.contar('solicitudes', s => s.organizacion_id === o.id && s.solicitud_estado === 'pendiente')]);
    datos.push({ o, nums: [['Equipos', equipos], ['Servidores', servidores], ['VLAN', vlans], ['Racks', racks], ['Credenciales', credenciales]], pendientes });
  }

  const lista = h('div', { class: 'fila', style: 'flex-wrap:wrap' });
  const pintar = (/** @type {string} */ filtro) => {
    lista.textContent = '';
    const f = normalizar(filtro);
    const vis = datos.filter(d => normalizar(d.o.organizacion_nombre).includes(f));
    if (!vis.length) lista.appendChild(h('div', { class: 'mut', text: 'Ninguna organización coincide con «' + filtro + '».' }));
    for (const d of vis) {
      lista.appendChild(h('div', { class: 'tarjeta tarjeta-org', role: 'group', 'aria-label': d.o.organizacion_nombre }, [
        h('h2', { text: d.o.organizacion_nombre }),
        d.o.organizacion_rubro ? h('div', { class: 'mut', style: 'font-size:13px', text: d.o.organizacion_rubro }) : null,
        h('div', { class: 'nums' }, d.nums.map(/** @param {any} n */ n => h('div', null, [h('b', { text: String(n[1]) }), h('small', { text: String(n[0]) })]))),
        h('div', { class: 'herr', style: 'margin-top:6px' }, [
          h('button', { type: 'button', class: 'primario', text: 'Entrar →', 'aria-label': 'Entrar a ' + d.o.organizacion_nombre, onclick: () => { sesion.fijarOrganizacionActiva(d.o.id); ir('#/inicio'); } }),
          h('button', { type: 'button', text: 'Editar', 'aria-label': 'Editar ' + d.o.organizacion_nombre, onclick: () => abrirFormularioOrganizacion(d.o, refrescar) }),
          h('button', { type: 'button', text: 'Dar de baja', 'aria-label': 'Dar de baja ' + d.o.organizacion_nombre, onclick: () => confirmarBaja(d.o) })])]));
    }
  };
  const confirmarBaja = (/** @type {any} */ o) => {
    const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    abrirModal(h('div', { class: 'bloque rk-modal rk-form', role: 'dialog', 'aria-label': 'Dar de baja la organización' }, [
      h('h2', { text: 'Dar de baja «' + o.organizacion_nombre + '»' }),
      h('p', { text: 'La organización y todos sus datos (equipos, racks, credenciales, etc.) dejan de verse, pero no se borran: quedan guardados con su historial.' }),
      h('p', { text: 'Solo el superadmin puede reactivarla, desde «Ver dadas de baja». Sus usuarios no van a poder trabajar con ella mientras esté dada de baja.' }), error,
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Sí, dar de baja', onclick: async () => {
        try {
          await repositorio.darDeBaja('organizaciones', o.id, { usuarioId: u.id });
          if (sesion.organizacionActiva() === o.id) sesion.fijarOrganizacionActiva(null);
          cerrarModal(); toast('Organización «' + o.organizacion_nombre + '» dada de baja'); await refrescar();
        } catch (e) { error.textContent = e instanceof Error ? e.message : 'No se pudo dar de baja.'; error.hidden = false; }
      } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() })])]));
  };
  const abrirBajas = () => {
    const cuerpo = h('div');
    const pintarBajas = async () => {
      cuerpo.textContent = '';
      const hoy = await repositorio.listar('organizaciones', o => !!o.eliminado_en, { incluirBajas: true, ordenarPor: 'organizacion_nombre' });
      if (!hoy.length) cuerpo.appendChild(h('div', { class: 'mut', text: 'No hay organizaciones dadas de baja.' }));
      for (const o of hoy) cuerpo.appendChild(h('div', { class: 'fila', style: 'align-items:center;justify-content:space-between;margin:6px 0' }, [
        h('span', null, [h('b', { text: o.organizacion_nombre }), ' · baja el ' + String(o.eliminado_en).slice(0, 10).split('-').reverse().join('/')]),
        h('button', { type: 'button', text: 'Reactivar', 'aria-label': 'Reactivar ' + o.organizacion_nombre, onclick: async () => {
          await repositorio.guardar('organizaciones', { ...o, eliminado_en: null }, u.id);
          cerrarModal(); toast('Organización «' + o.organizacion_nombre + '» reactivada'); await refrescar();
        } })]));
    };
    pintarBajas();
    abrirModal(h('div', { class: 'bloque rk-modal', role: 'dialog', 'aria-label': 'Organizaciones dadas de baja' }, [h('h2', { text: 'Organizaciones dadas de baja' }),
      h('p', { class: 'mut', text: 'Sus datos siguen guardados. Al reactivarlas vuelven a verse tal como estaban.' }), cuerpo,
      h('div', { class: 'herr' }, [h('button', { type: 'button', text: 'Cerrar', onclick: () => cerrarModal() })])]));
  };
  const filtro = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Filtrar por nombre…', style: 'width:280px', 'aria-label': 'Filtrar organizaciones' }));
  filtro.addEventListener('input', () => pintar(filtro.value));
  pintar('');
  contenedor.appendChild(h('h1', { text: 'Organizaciones' }));
  contenedor.appendChild(h('p', { class: 'mut', text: 'Elegí una organización para ver su información. Para buscar un dato sin elegir antes la organización, usá «Buscar» (Ctrl K) en la cabecera.' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [filtro, h('span', { style: 'flex:1' }),
    bajas.length ? h('button', { type: 'button', text: 'Ver dadas de baja (' + bajas.length + ')', onclick: () => abrirBajas() }) : null,
    h('button', { type: 'button', class: 'primario', text: 'Nueva organización', onclick: () => abrirFormularioOrganizacion(null, async (/** @type {any} */ nueva) => {
      sesion.fijarOrganizacionActiva(nueva.id); await repintarMarco(); ir('#/inicio');
    }) })]));
  if (!orgs.length) contenedor.appendChild(h('div', { class: 'estado-vacio', role: 'status' }, [h('h2', { text: 'Todavía no hay organizaciones' }),
    h('p', { text: 'Creá la primera con «Nueva organización»; después cargá sus ubicaciones, racks y equipos.' })]));
  contenedor.appendChild(lista);
}

