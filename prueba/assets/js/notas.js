// @ts-check
/**
 * Notas libres (IC15, MJ41): las de una ficha (por ejemplo la documentación del controlador de dominio en un servidor)
 * y las de la organización. El contenido es texto plano con saltos de línea y se muestra siempre con `textContent`.
 * Los permisos siguen el módulo de la ficha donde cuelga la nota (`repositorio.moduloDeNota`); las de la organización, `organizacion`.
 * Exporta `pintarNotas` (lista con alta, edición y baja dentro de una ficha) y ayudas para la pantalla `#/notas`.
 */

import * as repositorio from './repositorio.js';
import * as sesion from './sesion.js';
import { puede } from './permisos.js';
import { toast } from './marco.js';
import { h, fmtFechaHora, hoyISO } from './utiles.js';
import { COLECCION_DE_ENTIDAD, ROTULO_EQUIPO_TIPO } from './modelos.js';
import { botonBaja, nombresUsuarios } from './credenciales.js';
import { abrirAlta } from './altas.js';

/** Hash de la ficha de cada entidad (null: no tiene ficha propia). @type {Object<string, string|null>} */
const RUTA_FICHA = {
  Rack: '#/rack/', Persona: '#/persona/', CuentaDominio: '#/cuenta/', Licencia: '#/licencia/', MapeoDisco: '#/mapeo/', Puesto: '#/puesto/',
  Configuracion: '#/config/', Credencial: '#/credencial/', Vlan: '#/vlan/', RedWifi: '#/wifi/', Ubicacion: null, EnlaceIsp: '#/enlace/'
};

/** Etiqueta de tipo de cada entidad. @type {Object<string, string>} */
const ROTULO_ENTIDAD = {
  Equipo: 'Equipo', Rack: 'Rack', Persona: 'Persona', CuentaDominio: 'Cuenta de dominio', Licencia: 'Licencia', MapeoDisco: 'Mapeo de disco',
  Puesto: 'Puesto', Configuracion: 'Configuración', Credencial: 'Credencial', Vlan: 'VLAN', RedWifi: 'Red Wi-Fi', Ubicacion: 'Sede / sala', EnlaceIsp: 'Enlace ISP'
};

/**
 * Qué es y adónde lleva la ficha donde cuelga una nota.
 * @param {{entidad: string|null, entidad_id: string|null}} nota
 * @returns {Promise<{etiqueta: string, nombre: string, hash: string|null}>}
 */
export async function origenDeNota(nota) {
  if (!nota.entidad || !nota.entidad_id) return { etiqueta: 'Organización', nombre: 'La organización', hash: null };
  const col = COLECCION_DE_ENTIDAD[nota.entidad];
  const r = col ? await repositorio.obtener(col, nota.entidad_id, { incluirBajas: true }) : null;
  if (!r) return { etiqueta: ROTULO_ENTIDAD[nota.entidad] || nota.entidad, nombre: '(ficha dada de baja)', hash: null };
  let etiqueta = ROTULO_ENTIDAD[nota.entidad] || nota.entidad;
  const base = RUTA_FICHA[nota.entidad];
  /** @type {string|null} */
  let hash = base ? (base.endsWith('/') ? base + r.id : base) : null;
  if (nota.entidad === 'Equipo') {
    hash = (r.equipo_tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + r.id + (r.equipo_tipo === 'servidor' ? '/notas' : '');
    etiqueta = ROTULO_EQUIPO_TIPO[r.equipo_tipo] || 'Equipo';
  }
  const nombre = r.equipo_nombre || r.persona_nombre || r.rack_nombre || r.ubicacion_nombre || r.puesto_nombre || r.licencia_producto || r.configuracion_titulo || r.credencial_nombre
    || r.vlan_nombre || r.wifi_nombre || (r.mapeo_letra ? r.mapeo_letra + ' ' + r.mapeo_ruta : '') || (r.cuenta_usuario ? r.cuenta_dominio + '\\' + r.cuenta_usuario : '') || '(sin nombre)';
  return { etiqueta, nombre, hash };
}

/** Primeras palabras del contenido, en una sola línea. @param {string} t @param {number} [max] */
export function resumenNota(t, max) {
  const m = max || 90;
  const plano = t.replace(/\s+/g, ' ').trim();
  return plano.length > m ? plano.slice(0, m).replace(/\s+\S*$/, '') + '…' : plano;
}

/**
 * Lista las notas de una entidad (o de la organización con `entidad` null) dentro de `contenedor`, con alta, edición y baja
 * según los permisos del módulo de la ficha.
 * @param {HTMLElement} contenedor
 * @param {{entidad: string|null, entidadId: string|null, organizacionId: string}} o
 */
export async function pintarNotas(contenedor, o) {
  const u = /** @type {import('./modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const modulo = await repositorio.moduloDeNota({ entidad: o.entidad, entidad_id: o.entidadId });
  const org = o.organizacionId;
  /** @type {string|null} id de la nota que se está editando, 'nueva' para el alta */
  let editando = null;
  let error = '';

  const pintar = async () => {
    contenedor.textContent = '';
    if (!puede(u, 'ver', modulo, org)) { contenedor.appendChild(h('div', { class: 'aviso', text: 'Tu rol no tiene acceso a las notas de esta ficha.' })); return; }
    const [lista, nombres] = await Promise.all([
      repositorio.listar('notas', n => n.organizacion_id === org && (n.entidad || null) === (o.entidad || null) && (n.entidad_id || null) === (o.entidadId || null), { ordenarPor: 'actualizado_en', descendente: true }),
      nombresUsuarios()]);
    const modifica = puede(u, 'modificar', modulo, org);

    contenedor.appendChild(h('div', { class: 'herr' }, [
      h('span', { class: 'mut', style: 'flex:1', text: 'Texto libre para documentar lo que no entra en un campo. Sin contraseñas ni claves: para eso están las Credenciales.' }),
      modifica ? h('button', { type: 'button', class: 'primario', text: 'Nueva nota', onclick: async () => {
        const creada = await abrirAlta('notas', { organizacion_id: org, valores: { entidad: o.entidad || null, entidad_id: o.entidadId || null } });
        if (creada) { toast('Nota creada'); await pintar(); }
      } }) : null]));

    if (!lista.length) {
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Todavía no hay notas acá.' }),
        modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Usá «Nueva nota» para documentar, por ejemplo, cómo está armado el dominio o qué hay que hacer al reemplazar este equipo.' }) : null]));
      return;
    }
    for (const n of lista) {
      if (editando === n.id) { contenedor.appendChild(formulario(n)); continue; }
      const baja = await botonBaja({ u, coleccion: 'notas', registro: n, modulo, orgId: org, nombre: n.nota_titulo, volver: location.hash, rerender: pintar });
      contenedor.appendChild(h('div', { class: 'bloque t-nota', style: 'margin-bottom:10px' }, [
        h('div', { class: 'fila', style: 'align-items:center' }, [
          h('h3', { style: 'flex:1;margin:0', text: n.nota_titulo }),
          modifica ? h('button', { type: 'button', class: 'chico', text: 'Editar', onclick: () => { editando = n.id; error = ''; pintar(); } }) : null, baja]),
        h('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0', text: n.nota_contenido }),
        h('div', { class: 'mut', style: 'font-size:12.5px', text: 'Última edición: ' + fmtFechaHora(n.actualizado_en) + ' · ' + (nombres.get(n.actualizado_por) || '?') })]));
    }
  };

  /** Edición de una nota existente (el alta de notas nuevas es `altas/notas.js`). @param {any} n */
  function formulario(n) {
    const titulo = /** @type {HTMLInputElement} */ (h('input', { 'aria-label': 'Título de la nota', placeholder: 'Título', style: 'width:100%', maxlength: '120' }));
    titulo.value = n ? n.nota_titulo : '';
    const cuerpo = /** @type {HTMLTextAreaElement} */ (h('textarea', { 'aria-label': 'Contenido de la nota', rows: '8', style: 'width:100%', placeholder: 'Escribí la nota. Los saltos de línea se conservan.' }));
    cuerpo.value = n ? n.nota_contenido : '';
    const msg = h('div', { class: 'msg mal', role: 'alert', text: error, hidden: error ? null : 'hidden' });
    const guardar = async () => {
      if (!titulo.value.trim()) { error = 'Escribí un título para la nota.'; msg.textContent = error; msg.hidden = false; return; }
      if (!cuerpo.value.trim()) { error = 'Escribí el contenido de la nota.'; msg.textContent = error; msg.hidden = false; return; }
      try {
        const base = n || { organizacion_id: org, entidad: o.entidad || null, entidad_id: o.entidadId || null };
        await repositorio.guardar('notas', { ...base, nota_titulo: titulo.value.trim(), nota_contenido: cuerpo.value.replace(/\s+$/, '') }, u.id);
        toast(n ? 'Nota guardada · verificada hoy (' + hoyISO().split('-').reverse().join('/') + ')' : 'Nota creada');
        editando = null; error = '';
        await pintar();
      } catch (e) { error = e instanceof Error ? e.message : 'No se pudo guardar.'; msg.textContent = error; msg.hidden = false; }
    };
    return h('div', { class: 'bloque t-nota', style: 'margin-bottom:10px' }, [
      h('h3', { text: 'Editar nota' }), titulo, h('div', { style: 'height:8px' }), cuerpo, msg,
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { editando = null; error = ''; pintar(); } })])]);
  }

  await pintar();
}
