// @ts-check
/**
 * P35 · Ficha de una sede o sala (`#/ubicacion/<id>[/<pestaña>]`, QC54-A): datos con edición en el lugar (D-037), resumen de lo que
 * hay y pestañas Salas (solo en una sede), Racks, Equipos y Puestos. Enlaza al plano (`#/plano/<id>`) si tiene.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla } from '../assets/js/utiles.js';
import { ROTULO_UBICACION_TIPO, ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import { abrirAlta } from '../assets/js/altas.js';
import { bloqueSinPermiso, estadoVacio, botonBaja, fichaBloque, pieVerificacion, nombresDeUsuarios, partesHash, rutaEquipo, porId } from '../assets/js/racks.js';
import { formularioDeEdicion, conteosPorLugar, totalDeSede, textoConteo } from '../assets/js/sedes.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const { segs } = partesHash();
  const id = segs[1] || '';
  const raiz = await migasRaiz();
  const reg0 = id ? await repositorio.obtener('ubicaciones', id) : null;
  if (!reg0) {
    pantalla(contenedor, { codigo: 'P35', nombre: 'Ficha de sede o sala', migas: raiz.concat([['Sedes y salas', '#/sedes'], ['No encontrada']]) });
    contenedor.appendChild(estadoVacio('No encontramos esa sede o sala', 'Puede que se haya dado de baja o que el enlace sea viejo.', 'edificio', [h('a', { href: '#/sedes', text: 'Ir a Sedes y salas' })]));
    return;
  }
  const org = reg0.organizacion_id;
  if (!puede(u, 'ver', 'organizacion', org)) { pantalla(contenedor, { codigo: 'P35', nombre: 'Ficha de sede o sala', migas: raiz.concat([['Sedes y salas']]) }); contenedor.appendChild(bloqueSinPermiso('Tu rol no tiene acceso a las sedes y salas.')); return; }
  const puedeModificar = puede(u, 'modificar', 'organizacion', org);
  let editando = false;
  const tabs = reg0.ubicacion_tipo === 'sede' ? ['salas', 'racks', 'equipos', 'puestos'] : ['racks', 'equipos', 'puestos'];
  const tab = tabs.includes(segs[2]) ? segs[2] : tabs[0];

  const pintar = async () => {
    contenedor.textContent = '';
    const reg = await repositorio.obtener('ubicaciones', id);
    if (!reg) { ir('#/sedes'); return; }
    const esSede = reg.ubicacion_tipo === 'sede';
    const [todas, conteos, umbrales, nombres, elementos] = await Promise.all([
      repositorio.listar('ubicaciones', { organizacion_id: org }), conteosPorLugar(org), repositorio.umbralesVerificacion(), nombresDeUsuarios(),
      repositorio.elementosDeUbicacion(id)]);
    const mapa = porId(todas);
    const padre = reg.ubicacion_padre_id ? mapa.get(reg.ubicacion_padre_id) : null;
    const salas = todas.filter(x => x.ubicacion_padre_id === id).sort((a, b) => a.ubicacion_nombre.localeCompare(b.ubicacion_nombre, 'es', { numeric: true }));
    pantalla(contenedor, { codigo: 'P35', nombre: 'Ficha de sede o sala', migas: raiz.concat([['Sedes y salas', '#/sedes']], padre ? [[padre.ubicacion_nombre, '#/ubicacion/' + padre.id]] : [], [[reg.ubicacion_nombre]]) });

    const campo = (/** @type {string} */ etq, /** @type {Node|string|null} */ v) => h('div', { class: 'campo' }, [h('label', { text: etq }), v instanceof Node ? h('div', null, [v]) : h('div', { text: v || '—' })]);
    /** @type {HTMLElement} */ let datos;
    /** @type {(() => any)|null} */ let leer = null;
    const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    const botones = /** @type {Node[]} */ ([]);
    if (editando) {
      const f = formularioDeEdicion(reg, org, 'fi');
      leer = f.leer; datos = h('div', null, [f.nodo, error]);
      botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
        try { await repositorio.guardar('ubicaciones', /** @type {() => any} */ (leer)(), u.id); editando = false; toast('Cambios guardados · verificado hoy'); await pintar(); }
        catch (e) { error.textContent = e instanceof Error ? e.message : 'No se pudo guardar.'; error.hidden = false; }
      } }), h('button', { type: 'button', text: 'Cancelar', onclick: () => { editando = false; pintar(); } }));
    } else {
      const total = esSede ? totalDeSede(conteos, id, salas) : (conteos.get(id) || { racks: 0, equipos: 0, puestos: 0 });
      const grilla = h('div', { class: 'datos' }, [campo('Tipo', ROTULO_UBICACION_TIPO[reg.ubicacion_tipo]),
        esSede ? campo('Dirección', reg.ubicacion_direccion) : campo('Sede', h('a', { href: '#/ubicacion/' + (padre ? padre.id : ''), text: padre ? padre.ubicacion_nombre : '—' })),
        campo(esSede ? 'En total (con sus salas)' : 'Contiene', textoConteo(total)),
        esSede ? campo('Salas', String(salas.length)) : null,
        reg.ubicacion_notas ? campo('Notas', reg.ubicacion_notas) : null,
        campo('Plano', reg.ubicacion_plano_archivo_id ? h('a', { href: '#/plano/' + id, text: 'Ver el plano' })
          : puede(u, 'modificar', 'organizacion', org) ? h('a', { href: '#/plano/' + id, text: 'Todavía no tiene plano: subirlo' }) : 'Sin plano')]);
      datos = grilla;
      if (puedeModificar) botones.push(h('button', { type: 'button', text: 'Editar', onclick: () => { editando = true; pintar(); } }));
      if (esSede && puedeModificar) botones.push(h('button', { type: 'button', text: 'Nueva sala', onclick: async () => {
        const c = await abrirAlta('ubicaciones', { organizacion_id: org, valores: { ubicacion_tipo: 'sala', ubicacion_padre_id: id }, rotulo: null });
        if (c) { toast('Sala «' + c.ubicacion_nombre + '» creada'); await pintar(); }
      } }));
      const baja = await botonBaja({ u, org, modulo: 'organizacion', coleccion: 'ubicaciones', registro: reg, nombre: reg.ubicacion_nombre,
        bloqueo: await repositorio.bloqueoDeBajaDeUbicacion(id), alTerminar: () => ir(padre ? '#/ubicacion/' + padre.id : '#/sedes') });
      if (baja) botones.push(baja);
    }
    const pie = pieVerificacion({ coleccion: 'ubicaciones', registro: reg, umbrales, nombresUsuario: nombres, puedeVerificar: puede(u, 'verificar', 'organizacion', org),
      alConfirmar: async () => { await repositorio.confirmarVigente('ubicaciones', id, u.id); toast('Confirmado vigente hoy'); await pintar(); } });
    contenedor.appendChild(fichaBloque({ tipo: 'ubicacion', etiqueta: ROTULO_UBICACION_TIPO[reg.ubicacion_tipo], icon: 'edificio', titulo: reg.ubicacion_nombre, datos, botones, modoEdicion: editando, pie }));
    if (editando) return;

    const rotulos = { salas: 'Salas (' + salas.length + ')', racks: 'Racks (' + elementos.racks.length + ')', equipos: 'Equipos (' + elementos.equipos.length + ')', puestos: 'Puestos (' + elementos.puestos.length + ')' };
    contenedor.appendChild(h('div', { class: 'pestanas', role: 'tablist' }, tabs.map(k => h('button', { type: 'button', role: 'tab', class: k === tab ? 'sel' : null, 'aria-selected': k === tab ? 'true' : 'false',
      text: /** @type {any} */ (rotulos)[k], onclick: () => ir('#/ubicacion/' + id + '/' + k) }))));
    const zona = h('div', { style: 'margin-top:10px' });
    contenedor.appendChild(zona);
    const vacio = (/** @type {string} */ t) => zona.appendChild(h('div', { class: 'aviso', text: t }));
    if (tab === 'salas') {
      if (!salas.length) vacio('Esta sede todavía no tiene salas.' + (puedeModificar ? ' Creá la primera con «Nueva sala».' : ''));
      else zona.appendChild(tabla(['Sala', 'Racks', 'Equipos', 'Puestos'], salas.map(s => { const c = conteos.get(s.id) || { racks: 0, equipos: 0, puestos: 0 }; return [s.ubicacion_nombre, String(c.racks), String(c.equipos), String(c.puestos)]; }),
        { tipo: 'rack', onFila: (_f, i) => ir('#/ubicacion/' + salas[i].id) }));
    } else if (tab === 'racks') {
      if (!elementos.racks.length) vacio('No hay racks en ' + (esSede ? 'esta sede (los de sus salas están en cada sala)' : 'esta sala') + '.');
      else zona.appendChild(tabla(['Rack', 'Alto (U)', 'Notas'], elementos.racks.map(r => [r.rack_nombre, String(r.rack_unidades_total), r.rack_notas || '—']), { tipo: 'rack', onFila: (_f, i) => ir('#/rack/' + elementos.racks[i].id) }));
    } else if (tab === 'equipos') {
      if (!elementos.equipos.length) vacio('No hay equipos cargados directamente acá.');
      else zona.appendChild(tabla(['Equipo', 'Tipo', 'IP de gestión'], elementos.equipos.map(e => [e.equipo_nombre, ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo, e.equipo_ip_gestion || '—']),
        { tipo: 'equipo', onFila: (_f, i) => ir(rutaEquipo(elementos.equipos[i])) }));
    } else {
      if (!elementos.puestos.length) vacio('No hay puestos de trabajo cargados acá.');
      else zona.appendChild(tabla(['Puesto', 'Boca de pared'], elementos.puestos.map(p => [p.puesto_nombre, p.puesto_boca_pared || '—']), { tipo: 'puesto', onFila: (_f, i) => ir('#/puesto/' + elementos.puestos[i].id) }));
    }
  };
  await pintar();
}
