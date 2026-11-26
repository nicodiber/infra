// @ts-check
/**
 * Ficha de proveedor (`#/proveedor/<id|nuevo>[/<pestaña>]`, QC75): soporte, número de cliente y de contrato, contacto comercial y portal.
 * Datos con edición en el lugar (D-037), «Confirmar vigente», baja, pestañas Acceso al portal, Notas, Relacionado con, Archivos e Historial.
 * Teléfonos y mails son enlaces `tel:` / `mailto:`; el portal es un enlace externo. La contraseña del portal vive en la credencial vinculada.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla, fmtFechaHora, hoyISO } from '../assets/js/utiles.js';
import { RUBROS_PROVEEDOR } from '../assets/js/modelos.js';
import { selectorConCrear, idUnico } from '../assets/js/altas.js';
import { altaDesdeRuta, duplicar, nombreDeCopia } from '../assets/js/altas/comunes.js';
import { sinPermiso, pestanas, campo, fichaCab, botonBaja, valorHistorial } from '../assets/js/credenciales.js';
import { pintarNotas } from '../assets/js/notas.js';
import { enlaceTel, enlaceMail, enlaceWeb } from './proveedores.view.js';

/** @type {Object<string, string>} */
const ROTULO_CAMPO = { proveedor_nombre: 'Nombre', proveedor_rubro: 'Rubro', proveedor_soporte_telefono: 'Teléfono de soporte', proveedor_soporte_mail: 'Mail de soporte',
  proveedor_horario_soporte: 'Horario de soporte', proveedor_numero_cliente: 'N.º de cliente', proveedor_numero_contrato: 'N.º de contrato', proveedor_comercial_nombre: 'Contacto comercial',
  proveedor_comercial_telefono: 'Teléfono comercial', proveedor_comercial_mail: 'Mail comercial', proveedor_portal_url: 'Portal', credencial_id: 'Acceso al portal (credencial)', proveedor_notas: 'Notas' };

/** Campos de texto de la ficha, en orden: [clave, rótulo, tipo de input, modo de enlace]. @type {Array<[string, string, string, ('tel'|'mail'|'web'|null)]>} */
const CAMPOS = [
  ['proveedor_nombre', 'Nombre', 'text', null], ['proveedor_rubro', 'Rubro', 'text', null],
  ['proveedor_soporte_telefono', 'Teléfono de soporte', 'tel', 'tel'], ['proveedor_soporte_mail', 'Mail de soporte', 'email', 'mail'], ['proveedor_horario_soporte', 'Horario de soporte', 'text', null],
  ['proveedor_numero_cliente', 'N.º de cliente', 'text', null], ['proveedor_numero_contrato', 'N.º de contrato', 'text', null],
  ['proveedor_comercial_nombre', 'Contacto comercial', 'text', null], ['proveedor_comercial_telefono', 'Teléfono comercial', 'tel', 'tel'], ['proveedor_comercial_mail', 'Mail comercial', 'email', 'mail'],
  ['proveedor_portal_url', 'Portal', 'url', 'web']];

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  await sesion.refrescar();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const idHash = decodeURIComponent(partes[1] || '');
  const nuevo = idHash === 'nueva' || idHash === 'nuevo';
  const TABS = ['acceso', 'notas', 'relaciones', 'archivos', 'historial'];
  let tab = TABS.includes(partes[2]) ? partes[2] : 'acceso';
  const migas = await migasRaiz();
  migas.push(['Proveedores', '#/proveedores']);
  if (nuevo) { await altaDesdeRuta('proveedores', '#/proveedores', r => '#/proveedor/' + r.id, 'Proveedor creado'); return; }

  /** @type {any} */
  let s = await repositorio.obtener('proveedores', idHash);
  if (!s) {
    pantalla(contenedor, { codigo: 'P53', nombre: 'Ficha de proveedor', migas: migas.concat([['No encontrado']]) });
    contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Ese proveedor no existe o fue dado de baja.' }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/proveedores', text: 'Volver a proveedores' })])]));
    return;
  }
  const orgId = /** @type {string} */ (s.organizacion_id);
  if (!puede(u, 'ver', 'configuraciones', orgId)) {
    pantalla(contenedor, { codigo: 'P53', nombre: 'Ficha de proveedor', migas: migas.concat([['Ficha']]) });
    sinPermiso(contenedor, u, 'Proveedores');
    return;
  }

  const modifica = puede(u, 'modificar', 'configuraciones', orgId);
  const verCredenciales = puede(u, 'ver', 'credenciales', orgId);
  let editando = partes[2] === 'editar';
  if (editando && !modifica) editando = false;
  let error = '';
  /** @type {any} */
  let ed = null;
  const iniciarEd = () => {
    ed = { credencial: s.credencial_id || '', notas: s.proveedor_notas || '' };
    for (const [k] of CAMPOS) ed[k] = s[k] || '';
  };
  if (editando) iniciarEd();

  const rerender = async () => { s = (await repositorio.obtener('proveedores', s.id)) || s; await pintar(); };

  async function pintar() {
    contenedor.textContent = '';
    const [usuarios, credenciales] = await Promise.all([
      repositorio.listar('usuarios', null, { incluirBajas: true }),
      verCredenciales ? repositorio.listar('credenciales', { organizacion_id: orgId }, { ordenarPor: 'credencial_nombre' }) : Promise.resolve([])]);
    const umbrales = await repositorio.umbralesVerificacion();
    const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
    const titulo = s.proveedor_nombre;
    pantalla(contenedor, { codigo: 'P53', nombre: 'Ficha de proveedor', migas: migas.concat([[titulo, tab !== 'acceso' ? '#/proveedor/' + s.id : undefined]]) });

    const datos = h('div', { class: 'datos' });
    if (editando) {
      const lista = idUnico('pv-ed-rubros');
      for (const [k, et, tipo] of CAMPOS) {
        const i = /** @type {HTMLInputElement} */ (h('input', { type: tipo, value: ed[k], 'aria-label': et, list: k === 'proveedor_rubro' ? lista : null }));
        i.addEventListener('input', () => { ed[k] = i.value; });
        datos.appendChild(campo(et, k === 'proveedor_rubro' ? h('span', null, [i, h('datalist', { id: lista }, RUBROS_PROVEEDOR.map(x => h('option', { value: x })))]) : i));
      }
      if (verCredenciales) {
        const sc = selectorConCrear({ desde: 'proveedores', campo: 'credencial_id', organizacion_id: orgId, valor: ed.credencial || null, etiqueta: 'Credencial del portal',
          valoresAlta: { credencial_tipo: 'otro', credencial_nombre: 'Portal: ' + String(ed.proveedor_nombre).trim() }, rotuloOrigen: 'Editar proveedor', alCambiar: v => { ed.credencial = v; } });
        datos.appendChild(campo('Acceso al portal', sc));
      }
      const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '3', style: 'width:100%', 'aria-label': 'Notas' }));
      ta.value = ed.notas; ta.addEventListener('input', () => { ed.notas = ta.value; });
      datos.appendChild(campo('Notas', ta));
      if (error) datos.appendChild(h('div', { class: 'msg mal', role: 'alert', style: 'grid-column:1/-1', text: error }));
    } else {
      for (const [k, et, , enlace] of CAMPOS) {
        if (k === 'proveedor_nombre') continue;
        const v = s[k];
        datos.appendChild(campo(et, enlace === 'tel' ? enlaceTel(v) : enlace === 'mail' ? enlaceMail(v) : enlace === 'web' ? enlaceWeb(v) : (v || '—')));
      }
      if (s.proveedor_notas) datos.appendChild(campo('Notas', h('span', { style: 'white-space:pre-wrap', text: s.proveedor_notas })));
    }

    const guardar = async () => {
      if (!ed.proveedor_nombre.trim()) { error = 'Escribí el nombre del proveedor.'; await pintar(); return; }
      try {
        /** @type {any} */
        const nuevoReg = { ...s, credencial_id: verCredenciales ? ed.credencial || null : s.credencial_id, proveedor_notas: ed.notas.trim() || null };
        for (const [k] of CAMPOS) nuevoReg[k] = String(ed[k]).trim() || null;
        nuevoReg.proveedor_nombre = ed.proveedor_nombre.trim();
        await repositorio.guardar('proveedores', nuevoReg, u.id);
        toast('Cambios guardados · verificado hoy (' + hoyISO().split('-').reverse().join('/') + ')');
        ed = null; error = '';
        editando = false; await rerender();
      } catch (e) { error = e instanceof Error ? e.message : 'No se pudo guardar.'; await pintar(); }
    };
    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { ed = null; error = ''; editando = false; pintar(); } })]
      : [modifica ? h('button', { type: 'button', text: 'Editar', onclick: () => { iniciarEd(); error = ''; editando = true; pintar(); } }) : null,
        modifica ? h('button', { type: 'button', text: 'Duplicar', title: 'Abre el alta con estos datos para cargar uno parecido', onclick: async () => {
          const otros = await repositorio.listar('proveedores', { organizacion_id: orgId });
          /** @type {Object<string, any>} */
          const valores = { credencial_id: s.credencial_id, proveedor_notas: s.proveedor_notas };
          for (const [k] of CAMPOS) valores[k] = s[k];
          valores.proveedor_nombre = nombreDeCopia(s.proveedor_nombre, otros.map(x => x.proveedor_nombre));
          await duplicar('proveedores', s, valores, r => '#/proveedor/' + r.id, 'Proveedor');
        } }) : null,
        await botonBaja({ u, coleccion: 'proveedores', registro: s, modulo: 'configuraciones', orgId, nombre: s.proveedor_nombre, volver: '#/proveedores', rerender })];
    contenedor.appendChild(fichaCab({ tipo: 'configuracion', etiqueta: 'proveedor', titulo, datos, botones, modoEdicion: editando, registro: s,
      coleccion: 'proveedores', modulo: 'configuraciones', u, orgId, umbrales, usuarios: nombreUsuario, rerender }));

    // ---- pestañas
    const verHist = puede(u, 'ver_historial', 'configuraciones', orgId);
    const hayRel = await existe('relaciones'), hayArch = await existe('archivos');
    /** @type {Array<[string, string]>} */
    const tabs = [['acceso', 'Acceso al portal'], ['notas', 'Notas']];
    if (hayRel) tabs.push(['relaciones', 'Relacionado con']);
    if (hayArch) tabs.push(['archivos', 'Archivos']);
    if (verHist) tabs.push(['historial', 'Historial']);
    if (!tabs.some(t => t[0] === tab)) tab = 'acceso';
    contenedor.appendChild(pestanas(tabs, tab, k => { tab = k; history.replaceState(null, '', '#/proveedor/' + s.id + (k === 'acceso' ? '' : '/' + k)); pintar(); }));
    const cuerpo = h('div');
    contenedor.appendChild(cuerpo);
    if (tab === 'acceso') await pestanaAcceso(cuerpo, credenciales);
    else if (tab === 'notas') await pintarNotas(cuerpo, { entidad: 'Proveedor', entidadId: s.id, organizacionId: orgId });
    else if (tab === 'relaciones' || tab === 'archivos') await pestanaExterna(cuerpo, tab);
    else await pestanaHistorial(cuerpo, nombreUsuario);
  }

  /** @param {'relaciones'|'archivos'} m */
  async function existe(m) {
    try { await import('../assets/js/' + m + '.js'); return true; } catch { return false; }
  }

  /** @param {HTMLElement} cuerpo @param {'relaciones'|'archivos'} m */
  async function pestanaExterna(cuerpo, m) {
    try {
      const mod = await import('../assets/js/' + m + '.js');
      const o = { entidad: 'Proveedor', entidadId: s.id, organizacionId: orgId };
      if (m === 'relaciones') await mod.pintarRelaciones(cuerpo, o); else await mod.pintarArchivos(cuerpo, o);
    } catch (e) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'No se pudo mostrar esta pestaña.' })); }
  }

  /** @param {HTMLElement} cuerpo @param {any[]} credenciales */
  async function pestanaAcceso(cuerpo, credenciales) {
    if (!s.credencial_id) {
      cuerpo.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Este proveedor no tiene una credencial vinculada para el acceso a su portal.' }),
        modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Editá la ficha y elegí la credencial (la contraseña se carga en el módulo Credenciales).' }) : null]));
      return;
    }
    if (!verCredenciales) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'El acceso está guardado en una credencial (tu rol no ve el módulo Credenciales).' })); return; }
    const c = credenciales.find(x => x.id === s.credencial_id) || await repositorio.obtener('credenciales', s.credencial_id);
    if (!c) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'La credencial vinculada fue dada de baja.' })); return; }
    cuerpo.appendChild(h('div', { class: 'datos' }, [
      campo('Credencial', h('a', { href: '#/credencial/' + c.id, text: c.credencial_nombre })),
      campo('Usuario', c.credencial_usuario || '—'),
      campo('Host o URL', c.credencial_url_o_host || '—')]));
    cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'La contraseña no se muestra acá: se abre desde la credencial, donde «Mostrar» y «Pedir acceso» dejan registro.' }));
  }

  /** @param {HTMLElement} cuerpo @param {Map<string, string>} nombreUsuario */
  async function pestanaHistorial(cuerpo, nombreUsuario) {
    const cambios = await repositorio.listar('cambios', x => x.cambio_entidad === 'Proveedor' && x.entidad_id === s.id, { ordenarPor: 'cambio_fecha', descendente: true });
    if (!cambios.length) { cuerpo.appendChild(h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' })); return; }
    /** @param {string|null} json @param {string|null} k */
    const val = (json, k) => {
      if (k === 'credencial_id') return json === null || json === 'null' ? '—' : 'Credencial vinculada';
      return valorHistorial(json, k, false, new Map());
    };
    cuerpo.appendChild(tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(x => {
      const quien = nombreUsuario.get(x.usuario_id) || '?';
      const op = x.cambio_operacion;
      if (op !== 'modificacion') return [fmtFechaHora(x.cambio_fecha), quien, op === 'alta' ? 'Alta' : op === 'baja' ? 'Baja' : 'Restauración', '—', op === 'alta' ? 'Creado' : '—'];
      return [fmtFechaHora(x.cambio_fecha), quien, ROTULO_CAMPO[x.cambio_campo] || String(x.cambio_campo).replace(/^[a-z]+_/, '').replace(/_/g, ' '), val(x.cambio_valor_anterior, x.cambio_campo), val(x.cambio_valor_nuevo, x.cambio_campo)];
    })));
  }

  await pintar();
}
