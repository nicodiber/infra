// @ts-check
/**
 * P10 · Ficha de configuración: contenido (texto), reglas de reenvío de puertos, credenciales vinculadas e historial.
 * Edición en el lugar (D-037): al guardar, el registro queda verificado hoy.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, fmtFechaHora } from '../assets/js/utiles.js';
import { ROTULO_CONFIGURACION_TIPO, ROTULO_CREDENCIAL_TIPO } from '../assets/js/modelos.js';
import { sinPermiso, enlaceEquipo, pestanas, campo, fichaCab, botonBaja, rotuloCampo, valorHistorial } from '../assets/js/credenciales.js';

const NAT = 'nat_reenvio_puertos';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const idHash = decodeURIComponent(partes[1] || '');
  const nuevo = idHash === 'nuevo';
  let tab = ['contenido', 'reglas', 'credenciales', 'relaciones', 'archivos', 'historial'].includes(partes[2]) ? partes[2] : 'contenido';
  const migas = await migasRaiz();
  migas.push(['Configuraciones', '#/configuraciones']);

  /** @type {any} */
  let c = null;
  let orgId = /** @type {string} */ (sesion.organizacionActiva());
  if (!nuevo) {
    c = await repositorio.obtener('configuraciones', idHash);
    if (!c) {
      pantalla(contenedor, { codigo: 'P10', nombre: 'Ficha de configuración', migas: migas.concat([['No encontrada']]) });
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Esa configuración no existe o fue dada de baja.' }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/configuraciones', text: 'Volver al listado de configuraciones' })])]));
      return;
    }
    orgId = c.organizacion_id;
  }
  if (!puede(u, nuevo ? 'modificar' : 'ver', 'configuraciones', orgId)) {
    pantalla(contenedor, { codigo: 'P10', nombre: 'Ficha de configuración', migas: migas.concat([[nuevo ? 'Nueva' : 'Ficha']]) });
    sinPermiso(contenedor, u, nuevo ? 'cargar configuraciones' : 'Configuraciones');
    return;
  }

  const [umbrales, usuarios, equipos] = await Promise.all([
    repositorio.umbralesVerificacion(), repositorio.listar('usuarios', null, { incluirBajas: true }),
    repositorio.listar('equipos', { organizacion_id: orgId }, { ordenarPor: 'equipo_nombre' })]);
  const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
  const equipoPorId = new Map(equipos.map(e => [e.id, e]));
  const rotuloTipo = (/** @type {string} */ t) => ROTULO_CONFIGURACION_TIPO[t] || t;

  let editando = nuevo || partes[2] === 'editar';
  if (editando && !nuevo && !puede(u, 'modificar', 'configuraciones', orgId)) editando = false;
  /** @type {any} */
  let ed = null;
  const iniciarEd = () => {
    ed = c ? { titulo: c.configuracion_titulo, tipo: c.configuracion_tipo, equipo: c.equipo_id || '', fecha: c.configuracion_version_fecha || '', notas: c.configuracion_notas || '',
      contenido: c.configuracion_contenido || '', datos: structuredClone(c.configuracion_datos || []) }
      : { titulo: '', tipo: 'general', equipo: '', fecha: '', notas: '', contenido: '', datos: [] };
  };
  if (editando) iniciarEd();
  const rerender = async () => { if (c) c = (await repositorio.obtener('configuraciones', c.id)) || c; await pintar(); };

  async function pintar() {
    contenedor.textContent = '';
    const titulo = nuevo ? 'Nueva configuración' : c.configuracion_titulo;
    pantalla(contenedor, { codigo: 'P10', nombre: 'Ficha de configuración', migas: migas.concat([[titulo, !nuevo && tab !== 'contenido' ? '#/config/' + c.id : undefined]]).concat(tab === 'contenido' ? [] : [[{ reglas: 'Reglas', credenciales: 'Credenciales vinculadas', historial: 'Historial' }[/** @type {'reglas'|'credenciales'|'historial'} */ (tab)]]]) });
    const puedeModificar = puede(u, 'modificar', 'configuraciones', orgId);

    // ---- resumen
    const datos = h('div', { class: 'datos' });
    if (editando) {
      const t = /** @type {HTMLInputElement} */ (h('input', { value: ed.titulo, 'aria-label': 'Título' }));
      t.addEventListener('input', () => { ed.titulo = t.value; });
      const selT = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo' }, Object.keys(ROTULO_CONFIGURACION_TIPO).map(k => h('option', { value: k, text: ROTULO_CONFIGURACION_TIPO[k], selected: k === ed.tipo ? 'selected' : null }))));
      selT.addEventListener('change', () => { ed.tipo = selT.value; pintar(); });
      const selE = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Equipo' }, [h('option', { value: '', text: 'Sin equipo' })].concat(equipos.map(e => h('option', { value: e.id, text: e.equipo_nombre, selected: e.id === ed.equipo ? 'selected' : null })))));
      selE.addEventListener('change', () => { ed.equipo = selE.value; });
      const f = /** @type {HTMLInputElement} */ (h('input', { type: 'date', value: ed.fecha, 'aria-label': 'Fecha de la versión' }));
      f.addEventListener('input', () => { ed.fecha = f.value; });
      const n = /** @type {HTMLInputElement} */ (h('input', { value: ed.notas, 'aria-label': 'Notas' }));
      n.addEventListener('input', () => { ed.notas = n.value; });
      datos.appendChild(campo('Título', t)); datos.appendChild(campo('Tipo', selT)); datos.appendChild(campo('Equipo', selE));
      datos.appendChild(campo('Fecha de la versión', f)); datos.appendChild(campo('Notas', n));
    } else {
      datos.appendChild(campo('Tipo', rotuloTipo(c.configuracion_tipo)));
      datos.appendChild(campo('Equipo', enlaceEquipo(u, orgId, c.equipo_id ? equipoPorId.get(c.equipo_id) : null)));
      datos.appendChild(campo('Fecha de la versión', fmtFecha(c.configuracion_version_fecha)));
      datos.appendChild(campo('Notas', c.configuracion_notas || '—'));
    }

    const guardar = async () => {
      if (!ed.titulo.trim()) { toast('Escribí el título de la configuración.'); return; }
      const filas = ed.tipo === NAT ? ed.datos.filter((/** @type {any} */ r) => String(r.puerto_externo || '').trim() || String(r.ip_destino || '').trim()) : null;
      if (filas) {
        for (const r of filas) {
          const pe = Number(r.puerto_externo), pd = Number(r.puerto_destino);
          if (!(pe >= 1 && pe <= 65535) || !(pd >= 1 && pd <= 65535) || !String(r.ip_destino).trim()) { toast('Cada regla necesita puerto externo, IP destino y puerto destino válidos (1 a 65535).'); tab = 'reglas'; pintar(); return; }
        }
      }
      try {
        const reg = { ...(nuevo ? { organizacion_id: orgId } : c), configuracion_titulo: ed.titulo.trim(), configuracion_tipo: ed.tipo, equipo_id: ed.equipo || null,
          configuracion_version_fecha: ed.fecha || null, configuracion_notas: ed.notas.trim() || null, configuracion_contenido: ed.contenido,
          configuracion_datos: filas ? filas.map((/** @type {any} */ r) => ({ protocolo: r.protocolo || 'tcp', puerto_externo: Number(r.puerto_externo), ip_destino: String(r.ip_destino).trim(), puerto_destino: Number(r.puerto_destino), descripcion: String(r.descripcion || '').trim() })) : (nuevo ? null : c.configuracion_datos) };
        const g = await repositorio.guardar('configuraciones', reg, u.id);
        toast(nuevo ? 'Configuración creada' : 'Cambios guardados · verificado hoy');
        if (nuevo) { ir('#/config/' + g.id); return; }
        editando = false; ed = null; await rerender();
      } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    };
    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { if (nuevo) ir('#/configuraciones'); else { editando = false; ed = null; pintar(); } } })]
      : [puedeModificar ? h('button', { type: 'button', text: 'Editar', onclick: () => { iniciarEd(); editando = true; pintar(); } }) : null,
        nuevo ? null : await botonBaja({ u, coleccion: 'configuraciones', registro: c, modulo: 'configuraciones', orgId, nombre: c.configuracion_titulo, volver: '#/configuraciones', rerender })];
    contenedor.appendChild(fichaCab({ tipo: 'configuracion', etiqueta: 'configuración', titulo, datos, botones, modoEdicion: editando, registro: nuevo ? null : c,
      coleccion: 'configuraciones', modulo: 'configuraciones', u, orgId, umbrales, usuarios: nombreUsuario, rerender }));

    // ---- pestañas
    const credsVinc = nuevo ? [] : await repositorio.listar('credenciales', { organizacion_id: orgId, configuracion_id: c.id });
    const nReglas = (editando ? ed.datos : c.configuracion_datos || []).length;
    const verHist = puede(u, 'ver_historial', 'configuraciones', orgId);
    const tabs = /** @type {Array<[string, string]>} */ ([['contenido', 'Contenido'], ['reglas', 'Reglas (' + nReglas + ')']]);
    if (puede(u, 'ver', 'credenciales', orgId)) tabs.push(['credenciales', 'Credenciales vinculadas (' + credsVinc.length + ')']);
    if (!nuevo) tabs.push(['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']);
    if (verHist && !nuevo) tabs.push(['historial', 'Historial']);
    if (!tabs.some(t => t[0] === tab)) tab = 'contenido';
    contenedor.appendChild(pestanas(tabs, tab, k => { tab = k; if (!nuevo) history.replaceState(null, '', '#/config/' + c.id + '/' + k); pintar(); }));
    const cuerpo = h('div');
    contenedor.appendChild(cuerpo);
    if (tab === 'contenido') cuerpo.appendChild(await bloqueContenido());
    else if (tab === 'reglas') cuerpo.appendChild(bloqueReglas());
    else if (tab === 'credenciales') cuerpo.appendChild(bloqueCredenciales(credsVinc));
    else if (tab === 'relaciones' || tab === 'archivos') {
      const zona = h('div'); cuerpo.appendChild(zona);
      if (tab === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'Configuracion', entidadId: c.id, organizacionId: orgId });
      else await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'Configuracion', entidadId: c.id, organizacionId: orgId });
    }
    else cuerpo.appendChild(await bloqueHistorial());
  }

  async function bloqueContenido() {
    if (editando) {
      const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'pre', 'aria-label': 'Contenido', text: ed.contenido }));
      ta.addEventListener('input', () => { ed.contenido = ta.value; });
      return h('div', null, [ta, h('div', { class: 'mut', style: 'margin-top:4px', text: 'Nunca escribas contraseñas acá: usá una línea «[ver credencial «Nombre»]» y cargá la contraseña en Credenciales.' })]);
    }
    if (!c.configuracion_contenido) return h('div', { class: 'mut', text: 'Esta configuración todavía no tiene contenido.' + (puede(u, 'modificar', 'configuraciones', orgId) ? ' Tocá «Editar» para cargarlo.' : '') });
    const creds = puede(u, 'ver', 'credenciales', orgId) ? await repositorio.listar('credenciales', { organizacion_id: orgId }) : [];
    const porNombre = new Map(creds.map(x => [x.credencial_nombre, x.id]));
    const pre = h('pre', { class: 'pre' });
    const lineas = String(c.configuracion_contenido).split('\n');
    lineas.forEach((ln, i) => {
      const fin = i < lineas.length - 1 ? '\n' : '';
      const re = /\[ver credencial «([^»]+)»\]/g;
      let ult = 0, m;
      while ((m = re.exec(ln))) {
        pre.appendChild(document.createTextNode(ln.slice(ult, m.index)));
        const id = porNombre.get(m[1]);
        pre.appendChild(id ? h('a', { href: '#/credencial/' + id, text: m[0] }) : document.createTextNode(m[0]));
        ult = m.index + m[0].length;
      }
      pre.appendChild(document.createTextNode(ln.slice(ult) + fin));
    });
    return pre;
  }

  function bloqueReglas() {
    const tipo = editando ? ed.tipo : c.configuracion_tipo;
    if (tipo !== NAT) return h('div', { class: 'mut', text: 'Las reglas en filas se usan solo en «NAT / reenvío de puertos». Para este tipo de configuración, todo va en el contenido.' });
    if (!editando) {
      const l = c.configuracion_datos || [];
      if (!l.length) return h('div', { class: 'mut', text: 'No hay reglas cargadas.' + (puede(u, 'modificar', 'configuraciones', orgId) ? ' Tocá «Editar» para agregarlas.' : '') });
      return tabla(['Protocolo', 'Puerto externo', 'IP destino', 'Puerto destino', 'Descripción'], l.map((/** @type {any} */ r) => [String(r.protocolo || '').toUpperCase(), String(r.puerto_externo), r.ip_destino, String(r.puerto_destino), r.descripcion || '—']));
    }
    const t = h('table');
    t.appendChild(h('thead', null, [h('tr', null, ['Protocolo', 'Puerto externo', 'IP destino', 'Puerto destino', 'Descripción', ''].map(x => h('th', { text: x })))]));
    const tb = h('tbody');
    ed.datos.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
      const campoIn = (/** @type {string} */ k, /** @type {string} */ et, /** @type {string} */ ancho) => {
        const inp = /** @type {HTMLInputElement} */ (h('input', { value: r[k] == null ? '' : String(r[k]), 'aria-label': et + ' de la regla ' + (i + 1), style: 'width:' + ancho }));
        inp.addEventListener('input', () => { r[k] = inp.value; });
        return inp;
      };
      const proto = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Protocolo de la regla ' + (i + 1) }, ['tcp', 'udp'].map(p => h('option', { value: p, text: p.toUpperCase(), selected: p === (r.protocolo || 'tcp') ? 'selected' : null }))));
      proto.addEventListener('change', () => { r.protocolo = proto.value; });
      tb.appendChild(h('tr', null, [h('td', null, [proto]), h('td', null, [campoIn('puerto_externo', 'Puerto externo', '90px')]), h('td', null, [campoIn('ip_destino', 'IP destino', '140px')]),
        h('td', null, [campoIn('puerto_destino', 'Puerto destino', '90px')]), h('td', null, [campoIn('descripcion', 'Descripción', '100%')]),
        h('td', null, [h('button', { type: 'button', class: 'chico', text: 'Quitar', 'aria-label': 'Quitar la regla ' + (i + 1), onclick: () => { ed.datos.splice(i, 1); pintar(); } })])]));
    });
    t.appendChild(tb);
    return h('div', null, [ed.datos.length ? t : h('div', { class: 'mut', text: 'Todavía no hay reglas.' }),
      h('div', { class: 'herr' }, [h('button', { type: 'button', text: 'Agregar regla', onclick: () => { ed.datos.push({ protocolo: 'tcp', puerto_externo: '', ip_destino: '', puerto_destino: '', descripcion: '' }); pintar(); } })])]);
  }

  /** @param {any[]} lista */
  function bloqueCredenciales(lista) {
    if (!lista.length) return h('div', { class: 'mut', text: 'Ninguna credencial está vinculada a esta configuración. Se vinculan desde la ficha de cada credencial.' });
    return h('div', null, [tabla(['Nombre', 'Tipo', 'Usuario', 'Último cambio'], lista.map(x => [h('a', { href: '#/credencial/' + x.id, text: x.credencial_nombre }), ROTULO_CREDENCIAL_TIPO[x.credencial_tipo] || x.credencial_tipo, x.credencial_usuario || '—', fmtFecha(x.actualizado_en)])),
      h('div', { class: 'mut', style: 'margin-top:6px', text: 'Las contraseñas no se muestran acá: se ven desde la ficha de cada credencial.' })]);
  }

  async function bloqueHistorial() {
    const cambios = await repositorio.listar('cambios', x => x.cambio_entidad === 'Configuracion' && x.entidad_id === c.id, { ordenarPor: 'cambio_fecha', descendente: true });
    const nombres = new Map(equipos.map(e => [e.id, e.equipo_nombre]));
    if (!cambios.length) return h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' });
    return tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(x => x.cambio_operacion !== 'modificacion'
      ? [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', x.cambio_operacion === 'alta' ? 'Alta' : x.cambio_operacion === 'baja' ? 'Baja' : 'Restauración', '—', x.cambio_operacion === 'alta' ? 'Creada' : '—']
      : [fmtFechaHora(x.cambio_fecha), nombreUsuario.get(x.usuario_id) || '?', rotuloCampo(x.cambio_campo), valorHistorial(x.cambio_valor_anterior, x.cambio_campo, x.cambio_valor_oculto, nombres), valorHistorial(x.cambio_valor_nuevo, x.cambio_campo, x.cambio_valor_oculto, nombres)]));
  }

  await pintar();
}
