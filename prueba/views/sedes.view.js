// @ts-check
/**
 * P34 · Sedes y salas (`#/sedes`, QC53 a QC60): árbol sede › salas de la organización. Cada elemento muestra su tipo, cuántos
 * racks, equipos y puestos tiene (con enlace a su ficha) y permite editarlo en el lugar (D-037), crear una sala dentro de una
 * sede y darlo de baja (con aviso de qué lo ocupa).
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, normalizar } from '../assets/js/utiles.js';
import { abrirAlta } from '../assets/js/altas.js';
import { bloqueSinPermiso, estadoVacio, botonBaja } from '../assets/js/racks.js';
import { conteosPorLugar, totalDeSede, formularioDeEdicion, textoConteo } from '../assets/js/sedes.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  pantalla(contenedor, { codigo: 'P34', nombre: 'Sedes y salas', migas: (await migasRaiz()).concat([['Sedes y salas']]) });
  if (!org || !puede(u, 'ver', 'organizacion', org)) { contenedor.appendChild(bloqueSinPermiso('Tu rol no tiene acceso a las sedes y salas de la organización.')); return; }
  const puedeModificar = puede(u, 'modificar', 'organizacion', org);
  /** Id de la sede o sala que se está editando en el lugar. @type {string|null} */
  let editando = null;
  let texto = '';
  const zona = h('div', { class: 'sd-arbol' });

  const crear = async (/** @type {Object<string, any>} */ valores) => {
    const c = await abrirAlta('ubicaciones', { organizacion_id: org, valores, rotulo: null });
    if (c) { toast((c.ubicacion_tipo === 'sede' ? 'Sede «' : 'Sala «') + c.ubicacion_nombre + '» creada'); await pintar(); }
  };

  /** Botón de baja con el aviso de qué la ocupa. @param {any} reg */
  const botonDeBaja = async reg => botonBaja({ u, org, modulo: 'organizacion', coleccion: 'ubicaciones', registro: reg, nombre: reg.ubicacion_nombre,
    bloqueo: await repositorio.bloqueoDeBajaDeUbicacion(reg.id), alTerminar: () => { editando = null; pintar(); } });

  /** @param {any} reg @param {Array<Node|null>} extra */
  const filaEdicion = (reg, extra) => {
    const f = formularioDeEdicion(reg, org);
    const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    const guardar = async () => {
      try { await repositorio.guardar('ubicaciones', f.leer(), u.id); editando = null; toast('Cambios guardados · verificado hoy'); await pintar(); }
      catch (e) { error.textContent = e instanceof Error ? e.message : 'No se pudo guardar.'; error.hidden = false; }
    };
    return h('div', { class: 'sd-edicion' }, [h('div', { class: 'mut', text: 'Modo edición · al guardar, queda verificado hoy' }), f.nodo, error,
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }), h('button', { type: 'button', text: 'Cancelar', onclick: () => { editando = null; pintar(); } }), ...extra])]);
  };

  /** Enlaces «3 racks · 12 equipos · 5 puestos» a las pestañas de la ficha. @param {string} id @param {{racks: number, equipos: number, puestos: number}} c */
  const enlacesConteo = (id, c) => h('span', { class: 'sd-conteo' }, [
    h('a', { href: '#/ubicacion/' + id + '/racks', text: c.racks + (c.racks === 1 ? ' rack' : ' racks') }), ' · ',
    h('a', { href: '#/ubicacion/' + id + '/equipos', text: c.equipos + (c.equipos === 1 ? ' equipo' : ' equipos') }), ' · ',
    h('a', { href: '#/ubicacion/' + id + '/puestos', text: c.puestos + (c.puestos === 1 ? ' puesto' : ' puestos') })]);

  const pintar = async () => {
    const [ubicaciones, conteos] = await Promise.all([repositorio.listar('ubicaciones', { organizacion_id: org }), conteosPorLugar(org)]);
    zona.textContent = '';
    const sedes = ubicaciones.filter(x => x.ubicacion_tipo === 'sede').sort((a, b) => a.ubicacion_nombre.localeCompare(b.ubicacion_nombre, 'es', { numeric: true }));
    if (!sedes.length) {
      zona.appendChild(estadoVacio('Todavía no hay sedes', 'Una sede es un lugar físico de la organización (la casa central, una planta, una sucursal) y se divide en salas: la de servidores, una oficina, un depósito. '
        + (puedeModificar ? 'Empezá con «Nueva sede»; después le creás sus salas, y ahí ubicás racks, equipos y puestos.' : 'Pedile a quien administra la organización que cargue la primera.'), 'edificio',
        puedeModificar ? [h('button', { type: 'button', class: 'primario', text: 'Nueva sede', onclick: () => crear({ ubicacion_tipo: 'sede' }) })] : []));
      return;
    }
    const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
    const coincide = (/** @type {any} */ x) => { const t = normalizar(x.ubicacion_nombre + ' ' + (x.ubicacion_direccion || '') + ' ' + (x.ubicacion_notas || '')); return palabras.every(p => t.includes(p)); };
    let mostradas = 0;
    for (const sede of sedes) {
      const salas = ubicaciones.filter(x => x.ubicacion_padre_id === sede.id).sort((a, b) => a.ubicacion_nombre.localeCompare(b.ubicacion_nombre, 'es', { numeric: true }));
      const visibles = palabras.length ? salas.filter(coincide) : salas;
      if (palabras.length && !coincide(sede) && !visibles.length) continue;
      mostradas++;
      const total = totalDeSede(conteos, sede.id, salas);
      /** @type {Node} */
      let cabecera;
      if (editando === sede.id) cabecera = filaEdicion(sede, [await botonDeBaja(sede)]);
      else cabecera = h('div', { class: 'sd-cab' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', null, [h('span', { class: 'sd-tipo', text: 'Sede' }), h('a', { class: 'sd-nombre', href: '#/ubicacion/' + sede.id, text: sede.ubicacion_nombre })]),
          h('div', { class: 'mut', text: sede.ubicacion_direccion || 'Sin dirección cargada' }),
          h('div', { class: 'mut' }, [enlacesConteo(sede.id, total), ' en total (incluye sus ' + salas.length + (salas.length === 1 ? ' sala)' : ' salas)')])]),
        puedeModificar ? h('div', { class: 'herr', style: 'margin:0' }, [
          h('button', { type: 'button', text: 'Nueva sala', onclick: () => crear({ ubicacion_tipo: 'sala', ubicacion_padre_id: sede.id }) }),
          h('button', { type: 'button', text: 'Editar', onclick: () => { editando = sede.id; pintar(); } })]) : null]);
      const cuerpo = h('div', { class: 'sd-salas' });
      if (!salas.length) cuerpo.appendChild(h('div', { class: 'mut', text: 'Esta sede todavía no tiene salas.' + (puedeModificar ? ' Creá la primera con «Nueva sala».' : '') }));
      for (const sala of visibles) {
        if (editando === sala.id) { cuerpo.appendChild(h('div', { class: 'sd-sala' }, [filaEdicion(sala, [await botonDeBaja(sala)])])); continue; }
        cuerpo.appendChild(h('div', { class: 'sd-sala' }, [
          h('div', { style: 'flex:1;min-width:0' }, [h('span', { class: 'sd-tipo sala', text: 'Sala' }), h('a', { class: 'sd-nombre', href: '#/ubicacion/' + sala.id, text: sala.ubicacion_nombre }),
            h('div', { class: 'mut' }, [enlacesConteo(sala.id, conteos.get(sala.id) || { racks: 0, equipos: 0, puestos: 0 })]),
            sala.ubicacion_notas ? h('div', { class: 'mut', text: sala.ubicacion_notas }) : null]),
          puedeModificar ? h('button', { type: 'button', class: 'chico', text: 'Editar', onclick: () => { editando = sala.id; pintar(); } }) : null]));
      }
      if (palabras.length && salas.length && !visibles.length) cuerpo.appendChild(h('div', { class: 'mut', text: 'Ninguna sala de esta sede coincide con el filtro.' }));
      zona.appendChild(h('section', { class: 'bloque t-ubicacion sd-sede', 'aria-label': 'Sede ' + sede.ubicacion_nombre }, [cabecera, cuerpo]));
    }
    if (!mostradas) zona.appendChild(h('div', { class: 'aviso', text: 'Ninguna sede ni sala coincide con el filtro.' }));
  };

  const filtro = h('input', { type: 'search', placeholder: 'Filtrar por nombre o dirección…', 'aria-label': 'Filtrar sedes y salas', style: 'width:300px' });
  filtro.addEventListener('input', () => { texto = /** @type {HTMLInputElement} */ (filtro).value; pintar(); });
  contenedor.appendChild(h('h1', { text: 'Sedes y salas' }));
  contenedor.appendChild(h('div', { class: 'herr' }, [filtro, h('span', { style: 'flex:1' }),
    puedeModificar ? h('button', { type: 'button', text: 'Nueva sala', onclick: () => crear({ ubicacion_tipo: 'sala' }) }) : null,
    puedeModificar ? h('button', { type: 'button', class: 'primario', text: 'Nueva sede', onclick: () => crear({ ubicacion_tipo: 'sede' }) }) : null]));
  contenedor.appendChild(zona);
  contenedor.appendChild(h('div', { class: 'mut', style: 'margin-top:8px', text: 'Los racks, equipos y puestos se ubican en una sede o en una sala. Tocá un nombre para ver su ficha.' }));
  await pintar();
}
