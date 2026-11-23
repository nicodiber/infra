// @ts-check
/**
 * Ficha de servicio (`#/servicio/<id|nuevo>[/<pestaña>]`): dominio, DNS, hosting, certificado o correo (D-070).
 * Datos con edición en el lugar (D-037), «Confirmar vigente», baja, pestañas Registros DNS, Acceso al panel, Notas, Relacionado con,
 * Archivos (si existen los módulos) e Historial. La contraseña del panel vive en la credencial vinculada: acá solo hay un enlace.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla, fmtFechaHora, hoyISO } from '../assets/js/utiles.js';
import { ROTULO_SERVICIO_TIPO, TIPOS_REGISTRO_DNS } from '../assets/js/modelos.js';
import { sinPermiso, pestanas, campo, fichaCab, botonBaja, valorHistorial } from '../assets/js/credenciales.js';
import { pintarNotas } from '../assets/js/notas.js';
import { aplicarEstilosServicios, textoVencimientoServicio } from './servicios.view.js';

/** @type {Object<string, string>} */
const ROTULO_CAMPO = { servicio_tipo: 'Tipo', servicio_nombre: 'Nombre', servicio_proveedor: 'Proveedor', servicio_titular: 'Titular', servicio_vence_en: 'Vence el',
  servicio_delegacion_dns: 'DNS delegado en', servicio_plan: 'Plan', credencial_id: 'Acceso al panel (credencial)', servicio_registros: 'Registros DNS' };

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  aplicarEstilosServicios();
  await sesion.refrescar();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const idHash = decodeURIComponent(partes[1] || '');
  const nuevo = idHash === 'nueva' || idHash === 'nuevo';
  const TABS = ['registros', 'acceso', 'notas', 'relaciones', 'archivos', 'historial'];
  let tab = TABS.includes(partes[2]) ? partes[2] : 'registros';
  const migas = await migasRaiz();
  migas.push(['Dominios y servicios', '#/servicios']);

  /** @type {any} */
  let s = null;
  let orgId = /** @type {string} */ (sesion.organizacionActiva());
  if (!nuevo) {
    s = await repositorio.obtener('servicios', idHash);
    if (!s) {
      pantalla(contenedor, { codigo: 'P51', nombre: 'Ficha de servicio', migas: migas.concat([['No encontrado']]) });
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Ese servicio no existe o fue dado de baja.' }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/servicios', text: 'Volver a dominios y servicios' })])]));
      return;
    }
    orgId = s.organizacion_id;
  }
  if (!puede(u, nuevo ? 'modificar' : 'ver', 'configuraciones', orgId)) {
    pantalla(contenedor, { codigo: 'P51', nombre: 'Ficha de servicio', migas: migas.concat([[nuevo ? 'Nuevo' : 'Ficha']]) });
    sinPermiso(contenedor, u, nuevo ? 'cargar servicios' : 'Dominios y servicios');
    return;
  }

  const modifica = puede(u, 'modificar', 'configuraciones', orgId);
  const verCredenciales = puede(u, 'ver', 'credenciales', orgId);
  let editando = nuevo || partes[2] === 'editar';
  if (editando && !nuevo && !modifica) editando = false;
  let error = '';
  /** @type {any} */
  let ed = null;
  /** @type {{indice: number, tipo: string, nombre: string, valor: string, prioridad: string}|null} Fila de registro en edición (indice -1 = nueva). */
  let fila = null;
  let errorFila = '';
  const iniciarEd = () => {
    ed = s ? { tipo: s.servicio_tipo, nombre: s.servicio_nombre, proveedor: s.servicio_proveedor || '', titular: s.servicio_titular || '', vence: s.servicio_vence_en || '',
      delegacion: s.servicio_delegacion_dns || '', plan: s.servicio_plan || '', credencial: s.credencial_id || '' }
      : { tipo: 'dominio', nombre: '', proveedor: '', titular: '', vence: '', delegacion: '', plan: '', credencial: '' };
  };
  if (editando) iniciarEd();

  const rerender = async () => { if (s) s = (await repositorio.obtener('servicios', s.id)) || s; await pintar(); };

  async function pintar() {
    contenedor.textContent = '';
    const [umbrales, usuarios, credenciales] = await Promise.all([
      repositorio.umbralesVerificacion(), repositorio.listar('usuarios', null, { incluirBajas: true }),
      verCredenciales ? repositorio.listar('credenciales', { organizacion_id: orgId }, { ordenarPor: 'credencial_nombre' }) : Promise.resolve([])]);
    const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
    const titulo = nuevo ? 'Nuevo servicio' : s.servicio_nombre;
    pantalla(contenedor, { codigo: 'P51', nombre: 'Ficha de servicio', migas: migas.concat([[titulo, !nuevo && tab !== 'registros' ? '#/servicio/' + s.id : undefined]]) });

    const datos = h('div', { class: 'datos' });
    if (editando) {
      const inp = (/** @type {string} */ k, /** @type {string} */ et, /** @type {string} */ tipo) => {
        const i = /** @type {HTMLInputElement} */ (h('input', { type: tipo || 'text', value: ed[k], 'aria-label': et }));
        i.addEventListener('input', () => { ed[k] = i.value; });
        return i;
      };
      const selTipo = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo' }, Object.keys(ROTULO_SERVICIO_TIPO).map(k => h('option', { value: k, text: ROTULO_SERVICIO_TIPO[k], selected: k === ed.tipo ? 'selected' : null }))));
      selTipo.addEventListener('change', () => { ed.tipo = selTipo.value; });
      datos.appendChild(campo('Nombre', inp('nombre', 'Nombre', 'text')));
      datos.appendChild(campo('Tipo', selTipo));
      datos.appendChild(campo('Proveedor', inp('proveedor', 'Proveedor', 'text')));
      datos.appendChild(campo('Titular', inp('titular', 'Titular', 'text')));
      datos.appendChild(campo('Vence el', inp('vence', 'Vence el', 'date')));
      datos.appendChild(campo('DNS delegado en', inp('delegacion', 'DNS delegado en', 'text')));
      datos.appendChild(campo('Plan', inp('plan', 'Plan', 'text')));
      if (verCredenciales) {
        const sc = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Credencial del panel' }, [h('option', { value: '', text: 'Sin credencial vinculada' })].concat(
          credenciales.map(c => h('option', { value: c.id, text: c.credencial_nombre, selected: c.id === ed.credencial ? 'selected' : null })))));
        sc.addEventListener('change', () => { ed.credencial = sc.value; });
        datos.appendChild(campo('Acceso al panel', sc));
      }
      if (error) datos.appendChild(h('div', { class: 'msg mal', role: 'alert', style: 'grid-column:1/-1', text: error }));
    } else {
      datos.appendChild(campo('Tipo', ROTULO_SERVICIO_TIPO[s.servicio_tipo] || s.servicio_tipo));
      datos.appendChild(campo('Proveedor', s.servicio_proveedor || '—'));
      datos.appendChild(campo('Titular', s.servicio_titular || '—'));
      datos.appendChild(campo('Vence el', textoVencimientoServicio(s)));
      datos.appendChild(campo('DNS delegado en', s.servicio_delegacion_dns || '—'));
      datos.appendChild(campo('Plan', s.servicio_plan || '—'));
    }

    const guardar = async () => {
      if (!ed.nombre.trim()) { error = 'Escribí el nombre del servicio.'; await pintar(); return; }
      try {
        const base = nuevo ? { organizacion_id: orgId, servicio_registros: [] } : s;
        const g = await repositorio.guardar('servicios', { ...base, servicio_tipo: ed.tipo, servicio_nombre: ed.nombre.trim(), servicio_proveedor: ed.proveedor.trim() || null,
          servicio_titular: ed.titular.trim() || null, servicio_vence_en: ed.vence || null, servicio_delegacion_dns: ed.delegacion.trim() || null, servicio_plan: ed.plan.trim() || null,
          credencial_id: verCredenciales ? ed.credencial || null : (nuevo ? null : s.credencial_id) }, u.id);
        toast(nuevo ? 'Servicio creado' : 'Cambios guardados · verificado hoy (' + hoyISO().split('-').reverse().join('/') + ')');
        ed = null; error = '';
        if (nuevo) { ir('#/servicio/' + g.id); return; }
        editando = false; await rerender();
      } catch (e) { error = e instanceof Error ? e.message : 'No se pudo guardar.'; await pintar(); }
    };
    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { ed = null; error = ''; if (nuevo) ir('#/servicios'); else { editando = false; pintar(); } } })]
      : [modifica ? h('button', { type: 'button', text: 'Editar', onclick: () => { iniciarEd(); error = ''; editando = true; pintar(); } }) : null,
        nuevo ? null : await botonBaja({ u, coleccion: 'servicios', registro: s, modulo: 'configuraciones', orgId, nombre: s.servicio_nombre, volver: '#/servicios', rerender })];
    contenedor.appendChild(fichaCab({ tipo: 'configuracion', etiqueta: 'servicio', titulo, datos, botones, modoEdicion: editando, registro: nuevo ? null : s,
      coleccion: 'servicios', modulo: 'configuraciones', u, orgId, umbrales, usuarios: nombreUsuario, rerender }));
    if (nuevo) return;

    // ---- pestañas
    const verHist = puede(u, 'ver_historial', 'configuraciones', orgId);
    const hayRel = await existe('relaciones'), hayArch = await existe('archivos');
    /** @type {Array<[string, string]>} */
    const tabs = [['registros', 'Registros DNS'], ['acceso', 'Acceso al panel'], ['notas', 'Notas']];
    if (hayRel) tabs.push(['relaciones', 'Relacionado con']);
    if (hayArch) tabs.push(['archivos', 'Archivos']);
    if (verHist) tabs.push(['historial', 'Historial']);
    if (!tabs.some(t => t[0] === tab)) tab = 'registros';
    contenedor.appendChild(pestanas(tabs, tab, k => { tab = k; history.replaceState(null, '', '#/servicio/' + s.id + (k === 'registros' ? '' : '/' + k)); pintar(); }));
    const cuerpo = h('div');
    contenedor.appendChild(cuerpo);
    if (tab === 'registros') pestanaRegistros(cuerpo);
    else if (tab === 'acceso') await pestanaAcceso(cuerpo, credenciales);
    else if (tab === 'notas') await pintarNotas(cuerpo, { entidad: 'Servicio', entidadId: s.id, organizacionId: orgId });
    else if (tab === 'relaciones' || tab === 'archivos') await pestanaExterna(cuerpo, tab);
    else await pestanaHistorial(cuerpo, nombreUsuario);
  }

  /** ¿Existe el módulo opcional escrito por otro agente? @param {'relaciones'|'archivos'} m */
  async function existe(m) {
    try { await import('../assets/js/' + m + '.js'); return true; } catch { return false; }
  }

  /** @param {HTMLElement} cuerpo @param {'relaciones'|'archivos'} m */
  async function pestanaExterna(cuerpo, m) {
    try {
      const mod = await import('../assets/js/' + m + '.js');
      const o = { entidad: 'Servicio', entidadId: s.id, organizacionId: orgId };
      if (m === 'relaciones') await mod.pintarRelaciones(cuerpo, o); else await mod.pintarArchivos(cuerpo, o);
    } catch (e) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'No se pudo mostrar esta pestaña.' })); }
  }

  /** @param {HTMLElement} cuerpo */
  function pestanaRegistros(cuerpo) {
    /** @type {any[]} */
    const regs = s.servicio_registros || [];
    cuerpo.appendChild(h('div', { class: 'herr' }, [
      h('span', { class: 'mut', style: 'flex:1', text: regs.length + ' registro(s) DNS.' }),
      modifica && !fila ? h('button', { type: 'button', class: 'primario', text: 'Agregar registro', onclick: () => { fila = { indice: -1, tipo: 'A', nombre: '@', valor: '', prioridad: '' }; errorFila = ''; pintar(); } }) : null]));
    if (fila) cuerpo.appendChild(formularioFila(regs));
    if (!regs.length) {
      if (!fila) cuerpo.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Este servicio no tiene registros DNS cargados.' }),
        modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Usá «Agregar registro» para anotar los A, MX, TXT, CNAME o NS de la zona.' }) : null]));
      return;
    }
    cuerpo.appendChild(tabla(['Tipo', 'Nombre', 'Valor', 'Prioridad', ''], regs.map((g, i) => [g.tipo, g.nombre, h('span', { style: 'word-break:break-all', text: g.valor }), g.prioridad != null ? String(g.prioridad) : '—',
      modifica ? h('span', { class: 'herr', style: 'margin:0' }, [
        h('button', { type: 'button', class: 'chico', text: 'Editar', onclick: () => { fila = { indice: i, tipo: g.tipo, nombre: g.nombre, valor: g.valor, prioridad: g.prioridad != null ? String(g.prioridad) : '' }; errorFila = ''; pintar(); } }),
        h('button', { type: 'button', class: 'chico', text: 'Quitar', onclick: () => guardarRegistros(regs.filter((_x, k) => k !== i), 'Registro quitado') })]) : ''])));
    cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: '«@» es el dominio mismo. Cada cambio queda en el historial y deja el servicio verificado hoy.' }));
  }

  /** @param {any[]} regs */
  function formularioFila(regs) {
    const f = /** @type {NonNullable<typeof fila>} */ (fila);
    const selTipo = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo de registro' }, TIPOS_REGISTRO_DNS.map(t => h('option', { value: t, text: t, selected: t === f.tipo ? 'selected' : null }))));
    const nombre = /** @type {HTMLInputElement} */ (h('input', { type: 'text', value: f.nombre, 'aria-label': 'Nombre del registro' }));
    const valor = /** @type {HTMLInputElement} */ (h('input', { type: 'text', value: f.valor, 'aria-label': 'Valor del registro' }));
    const prio = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '0', step: '1', value: f.prioridad, 'aria-label': 'Prioridad (solo MX)' }));
    const campoPrio = campo('Prioridad (solo MX)', prio);
    const ajustar = () => { campoPrio.style.display = selTipo.value === 'MX' ? '' : 'none'; };
    selTipo.addEventListener('change', ajustar); ajustar();
    const msg = h('div', { class: 'msg mal', role: 'alert', hidden: errorFila ? null : 'hidden', text: errorFila });
    return h('div', { class: 'bloque t-configuracion', style: 'margin-bottom:10px' }, [h('h3', { text: f.indice < 0 ? 'Agregar registro DNS' : 'Editar registro DNS' }),
      h('div', { class: 'datos' }, [campo('Tipo', selTipo), campo('Nombre', nombre), campo('Valor', valor), campoPrio]), msg,
      h('div', { class: 'herr' }, [
        h('button', { type: 'button', class: 'primario', text: 'Guardar registro', onclick: async () => {
          const reg = /** @type {any} */ ({ tipo: selTipo.value, nombre: nombre.value.trim(), valor: valor.value.trim() });
          if (!TIPOS_REGISTRO_DNS.includes(reg.tipo)) { msg.textContent = 'Elegí un tipo de registro válido.'; msg.hidden = false; return; }
          if (!reg.nombre || !reg.valor) { msg.textContent = 'El registro necesita nombre y valor.'; msg.hidden = false; return; }
          if (reg.tipo === 'MX' && prio.value !== '') {
            const n = Number(prio.value);
            if (!Number.isInteger(n) || n < 0) { msg.textContent = 'La prioridad tiene que ser un número entero.'; msg.hidden = false; return; }
            reg.prioridad = n;
          }
          const nueva = regs.slice();
          if (f.indice < 0) nueva.push(reg); else nueva[f.indice] = reg;
          await guardarRegistros(nueva, f.indice < 0 ? 'Registro agregado' : 'Registro guardado');
        } }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { fila = null; errorFila = ''; pintar(); } })])]);
  }

  /** @param {any[]} regs @param {string} aviso */
  async function guardarRegistros(regs, aviso) {
    try {
      await repositorio.guardar('servicios', { ...s, servicio_registros: regs }, u.id);
      fila = null; errorFila = '';
      toast(aviso);
      await rerender();
    } catch (e) { errorFila = e instanceof Error ? e.message : 'No se pudo guardar.'; await pintar(); }
  }

  /** @param {HTMLElement} cuerpo @param {any[]} credenciales */
  async function pestanaAcceso(cuerpo, credenciales) {
    if (!s.credencial_id) {
      cuerpo.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Este servicio no tiene una credencial vinculada para el acceso al panel del proveedor.' }),
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
    const cambios = await repositorio.listar('cambios', x => x.cambio_entidad === 'Servicio' && x.entidad_id === s.id, { ordenarPor: 'cambio_fecha', descendente: true });
    if (!cambios.length) { cuerpo.appendChild(h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' })); return; }
    /** @param {string|null} json @param {string|null} k */
    const val = (json, k) => {
      if (k === 'credencial_id') return json === null || json === 'null' ? '—' : 'Credencial vinculada';
      if (k === 'servicio_tipo' && json) { try { return ROTULO_SERVICIO_TIPO[JSON.parse(json)] || json; } catch { return json; } }
      if (k === 'servicio_registros') { try { const a = JSON.parse(/** @type {string} */ (json)); return Array.isArray(a) ? a.length + ' registro(s)' : '—'; } catch { return '—'; } }
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
