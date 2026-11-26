// @ts-check
/**
 * Ficha de mapeo de disco (`#/mapeo/<id|nuevo>[/historial]`): letra, ruta de red, servidor que la comparte, a quién se aplica
 * (todos, un grupo o una persona) y cómo (directiva de grupo, script o a mano). Edición en el lugar (D-037). Los permisos son los
 * del módulo `configuraciones` (D-066); para elegir una persona hace falta además ver el módulo `personas`.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla, fmtFechaHora, hoyISO } from '../assets/js/utiles.js';
import { ROTULO_MAPEO_APLICA_A, ROTULO_MAPEO_METODO } from '../assets/js/modelos.js';
import { selectorConCrear } from '../assets/js/altas.js';
import { altaDesdeRuta, opcionesEquipos, opcionesPersonas } from '../assets/js/altas/comunes.js';
import { sinPermiso, enlaceEquipo, pestanas, campo, fichaCab, botonBaja, valorHistorial } from '../assets/js/credenciales.js';

/** @type {Object<string, string>} */
const ROTULO_CAMPO = { mapeo_letra: 'Letra de unidad', mapeo_ruta: 'Ruta de red', equipo_id: 'Servidor', mapeo_aplica_a: 'Se aplica a', mapeo_grupo: 'Grupo', persona_id: 'Persona', mapeo_metodo: 'Método' };

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const idHash = decodeURIComponent(partes[1] || '');
  const nuevo = idHash === 'nuevo' || idHash === 'nueva';
  let tab = ['historial', 'relaciones', 'archivos'].includes(partes[2]) ? partes[2] : 'resumen';
  const migas = await migasRaiz();
  migas.push(['Configuraciones', '#/configuraciones'], ['Mapeos de discos', '#/configuraciones/mapeos']);
  if (nuevo) { await altaDesdeRuta('mapeos_disco', '#/configuraciones/mapeos', r => '#/mapeo/' + r.id, 'Mapeo creado'); return; }

  /** @type {any} */
  let m = null;
  let orgId = /** @type {string} */ (sesion.organizacionActiva());
  {
    m = await repositorio.obtener('mapeos_disco', idHash);
    if (!m) {
      pantalla(contenedor, { codigo: 'P10', nombre: 'Ficha de mapeo de disco', migas: migas.concat([['No encontrado']]) });
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Ese mapeo no existe o fue dado de baja.' }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/configuraciones/mapeos', text: 'Volver al listado de mapeos' })])]));
      return;
    }
    orgId = m.organizacion_id;
  }
  if (!puede(u, 'ver', 'configuraciones', orgId)) {
    pantalla(contenedor, { codigo: 'P10', nombre: 'Ficha de mapeo de disco', migas: migas.concat([['Ficha']]) });
    sinPermiso(contenedor, u, 'Configuraciones');
    return;
  }
  const modifica = puede(u, 'modificar', 'configuraciones', orgId);
  const verPersonas = puede(u, 'ver', 'personas', orgId);
  let editando = partes[2] === 'editar';
  if (editando && !modifica) editando = false;
  let error = '';
  /** @type {any} */
  let ed = null;
  const iniciarEd = () => {
    ed = { letra: m.mapeo_letra, ruta: m.mapeo_ruta, equipo: m.equipo_id || '', aplica: m.mapeo_aplica_a, grupo: m.mapeo_grupo || '', persona: m.persona_id || '', metodo: m.mapeo_metodo };
  };
  if (editando) iniciarEd();
  const rerender = async () => { if (m) m = (await repositorio.obtener('mapeos_disco', m.id)) || m; await pintar(); };

  async function pintar() {
    contenedor.textContent = '';
    const [umbrales, usuarios, equipos, personas] = await Promise.all([
      repositorio.umbralesVerificacion(), repositorio.listar('usuarios', null, { incluirBajas: true }),
      repositorio.listar('equipos', { organizacion_id: orgId }, { ordenarPor: 'equipo_nombre' }),
      verPersonas ? repositorio.listar('personas', { organizacion_id: orgId }, { ordenarPor: 'persona_nombre' }) : Promise.resolve([])]);
    const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
    const equipoPorId = new Map(equipos.map(e => [e.id, e]));
    const personaPorId = new Map(personas.map(p => [p.id, p]));
    const titulo = m.mapeo_letra + ' ' + m.mapeo_ruta;
    pantalla(contenedor, { codigo: 'P10', nombre: 'Ficha de mapeo de disco', migas: migas.concat([[m.mapeo_letra, tab !== 'resumen' ? '#/mapeo/' + m.id : undefined]]).concat(tab === 'historial' ? [['Historial']] : []) });

    const datos = h('div', { class: 'datos' });
    if (editando) {
      const inp = (/** @type {string} */ k, /** @type {string} */ et, /** @type {Object<string, string>} */ extra) => {
        const i = /** @type {HTMLInputElement} */ (h('input', { value: ed[k], 'aria-label': et, ...(extra || {}) }));
        i.addEventListener('input', () => { ed[k] = i.value; });
        return i;
      };
      /** @param {string} k @param {string} et @param {Array<[string, string]>} opciones */
      const sel = (k, et, opciones) => {
        const s = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': et }, opciones.map(([v, t]) => h('option', { value: v, text: t, selected: v === ed[k] ? 'selected' : null }))));
        s.addEventListener('change', () => { ed[k] = s.value; if (k === 'aplica') pintar(); });
        return s;
      };
      datos.appendChild(campo('Letra de unidad', inp('letra', 'Letra de unidad', { maxlength: '2', placeholder: 'P:', style: 'width:80px' })));
      datos.appendChild(campo('Ruta de red', inp('ruta', 'Ruta de red', { placeholder: '\\\\SERVIDOR\\Carpeta' })));
      datos.appendChild(campo('Servidor que la comparte', selectorConCrear({ desde: 'mapeos_disco', campo: 'equipo_id', organizacion_id: orgId, valor: ed.equipo || null, etiqueta: 'Servidor',
        cargarOpciones: () => opcionesEquipos(orgId, { filtro: e => e.equipo_tipo === 'servidor' }), valoresAlta: { equipo_tipo: 'servidor' }, rotuloOrigen: 'Editar mapeo', alCambiar: v => { ed.equipo = v; } })));
      datos.appendChild(campo('Se aplica a', sel('aplica', 'Se aplica a', Object.keys(ROTULO_MAPEO_APLICA_A).map(k => /** @type {[string, string]} */ ([k, ROTULO_MAPEO_APLICA_A[k]])))));
      if (ed.aplica === 'grupo') datos.appendChild(campo('Grupo de dominio', inp('grupo', 'Grupo de dominio', { placeholder: 'GG-Compras' })));
      if (ed.aplica === 'persona') {
        datos.appendChild(campo('Persona', verPersonas
          ? selectorConCrear({ desde: 'mapeos_disco', campo: 'persona_id', organizacion_id: orgId, valor: ed.persona || null, etiqueta: 'Persona', obligatorio: true,
            cargarOpciones: () => opcionesPersonas(orgId, { soloActivas: true }), rotuloOrigen: 'Editar mapeo', alCambiar: v => { ed.persona = v; } })
          : h('span', { class: 'mut', text: 'Tu rol no ve el módulo Personas: elegí otro destino o pedile a alguien que lo cargue.' })));
      }
      datos.appendChild(campo('Método', sel('metodo', 'Método', Object.keys(ROTULO_MAPEO_METODO).map(k => /** @type {[string, string]} */ ([k, ROTULO_MAPEO_METODO[k]])))));
      if (error) datos.appendChild(h('div', { class: 'msg mal', role: 'alert', style: 'grid-column:1/-1', text: error }));
    } else {
      datos.appendChild(campo('Letra de unidad', m.mapeo_letra));
      datos.appendChild(campo('Ruta de red', m.mapeo_ruta));
      datos.appendChild(campo('Servidor que la comparte', enlaceEquipo(u, orgId, m.equipo_id ? equipoPorId.get(m.equipo_id) : null)));
      datos.appendChild(campo('Se aplica a', aQuien(m, personaPorId, verPersonas)));
      datos.appendChild(campo('Método', ROTULO_MAPEO_METODO[m.mapeo_metodo] || m.mapeo_metodo));
    }

    const guardar = async () => {
      const letra = ed.letra.trim().toUpperCase().replace(/[^A-Z:]/g, '');
      const letraOk = /^[A-Z]:?$/.test(letra);
      if (!letraOk) { error = 'La letra de unidad es una sola letra, por ejemplo «P:».'; await pintar(); return; }
      if (!ed.ruta.trim()) { error = 'Escribí la ruta de red, por ejemplo \\\\SERVIDOR\\Carpeta.'; await pintar(); return; }
      if (ed.aplica === 'grupo' && !ed.grupo.trim()) { error = 'Indicá el grupo de dominio al que se aplica.'; await pintar(); return; }
      if (ed.aplica === 'persona' && !ed.persona) { error = 'Elegí la persona a la que se aplica.'; await pintar(); return; }
      try {
        await repositorio.guardar('mapeos_disco', { ...m, mapeo_letra: letra.length === 1 ? letra + ':' : letra, mapeo_ruta: ed.ruta.trim(), equipo_id: ed.equipo || null, mapeo_aplica_a: ed.aplica,
          mapeo_grupo: ed.aplica === 'grupo' ? ed.grupo.trim() : null, persona_id: ed.aplica === 'persona' ? ed.persona : null, mapeo_metodo: ed.metodo }, u.id);
        toast('Cambios guardados · verificado hoy (' + hoyISO().split('-').reverse().join('/') + ')');
        ed = null; error = '';
        editando = false; await rerender();
      } catch (e) { error = e instanceof Error ? e.message : 'No se pudo guardar.'; await pintar(); }
    };
    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { ed = null; error = ''; editando = false; pintar(); } })]
      : [modifica ? h('button', { type: 'button', text: 'Editar', onclick: () => { iniciarEd(); error = ''; editando = true; pintar(); } }) : null,
        await botonBaja({ u, coleccion: 'mapeos_disco', registro: m, modulo: 'configuraciones', orgId, nombre: m.mapeo_letra + ' ' + m.mapeo_ruta, volver: '#/configuraciones/mapeos', rerender })];
    contenedor.appendChild(fichaCab({ tipo: 'configuracion', etiqueta: 'mapeo de disco', titulo, datos, botones, modoEdicion: editando, registro: m,
      coleccion: 'mapeos_disco', modulo: 'configuraciones', u, orgId, umbrales, usuarios: nombreUsuario, rerender }));

    /** @type {Array<[string, string]>} */
    const tabs = [['resumen', 'Cómo se aplica'], ['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']];
    const verHist = puede(u, 'ver_historial', 'configuraciones', orgId);
    if (verHist) tabs.push(['historial', 'Historial']);
    if (tab === 'historial' && !verHist) tab = 'resumen';
    contenedor.appendChild(pestanas(tabs, tab, k => { tab = k; history.replaceState(null, '', '#/mapeo/' + m.id + (k === 'resumen' ? '' : '/' + k)); pintar(); }));
    if (tab === 'relaciones' || tab === 'archivos') {
      const zona = h('div'); contenedor.appendChild(zona);
      if (tab === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'MapeoDisco', entidadId: m.id, organizacionId: orgId });
      else await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'MapeoDisco', entidadId: m.id, organizacionId: orgId });
      return;
    }
    if (tab === 'resumen') {
      const sv = m.equipo_id ? equipoPorId.get(m.equipo_id) : null;
      const dest = m.mapeo_aplica_a === 'todos' ? 'a todos los usuarios' : m.mapeo_aplica_a === 'grupo' ? 'a los miembros del grupo ' + m.mapeo_grupo : verPersonas ? 'a ' + ((personaPorId.get(m.persona_id) || {}).persona_nombre || 'una persona que ya no está documentada') : 'a una persona';
      const como = m.mapeo_metodo === 'gpo' ? 'con una directiva de grupo (GPO)' : m.mapeo_metodo === 'script' ? 'con un script de inicio de sesión' : 'a mano, en cada equipo';
      contenedor.appendChild(h('div', { class: 'bloque' }, [
        h('p', { text: 'La unidad ' + m.mapeo_letra + ' apunta a ' + m.mapeo_ruta + (sv ? ' (comparte ' + sv.equipo_nombre + ')' : '') + ' y se le arma ' + dest + ' ' + como + '.' }),
        m.mapeo_metodo === 'manual' ? h('p', { class: 'mut', text: 'Al ser manual, si se reinstala un equipo hay que volver a mapearla.' }) : null]));
      return;
    }
    const cambios = await repositorio.listar('cambios', x => x.cambio_entidad === 'MapeoDisco' && x.entidad_id === m.id, { ordenarPor: 'cambio_fecha', descendente: true });
    if (!cambios.length) { contenedor.appendChild(h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' })); return; }
    const nombres = new Map(equipos.map(e => [e.id, e.equipo_nombre]).concat(personas.map(p => [p.id, p.persona_nombre])));
    /** @param {string|null} json @param {string|null} k */
    const val = (json, k) => {
      if (k === 'mapeo_aplica_a' && json) { try { return ROTULO_MAPEO_APLICA_A[JSON.parse(json)] || json; } catch { return json; } }
      if (k === 'mapeo_metodo' && json) { try { return ROTULO_MAPEO_METODO[JSON.parse(json)] || json; } catch { return json; } }
      if (k === 'equipo_id' || k === 'persona_id') return valorHistorial(json, 'equipo_id', false, nombres);
      return valorHistorial(json, k, false, nombres);
    };
    contenedor.appendChild(tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(x => {
      const op = x.cambio_operacion;
      if (op !== 'modificacion') return [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', op === 'alta' ? 'Alta' : op === 'baja' ? 'Baja' : 'Restauración', '—', op === 'alta' ? 'Creado' : '—'];
      return [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', ROTULO_CAMPO[x.cambio_campo] || x.cambio_campo, val(x.cambio_valor_anterior, x.cambio_campo), val(x.cambio_valor_nuevo, x.cambio_campo)];
    })));
  }
  await pintar();
}

/**
 * «Todos», «Grupo GG-Compras» o el nombre de la persona (enlazada si el rol ve Personas).
 * @param {any} m @param {Map<string, any>} personaPorId @param {boolean} verPersonas
 * @returns {Node|string}
 */
export function aQuien(m, personaPorId, verPersonas) {
  if (m.mapeo_aplica_a === 'todos') return 'Todos';
  if (m.mapeo_aplica_a === 'grupo') return 'Grupo ' + m.mapeo_grupo;
  if (!verPersonas) return 'Una persona';
  const p = personaPorId.get(m.persona_id);
  return p ? h('a', { href: '#/persona/' + p.id, text: p.persona_nombre, onclick: (/** @type {Event} */ e) => e.stopPropagation() }) : '(persona dada de baja)';
}
