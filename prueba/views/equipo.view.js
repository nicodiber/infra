// @ts-check
/**
 * P06 · Ficha de equipo (switch, patchera, firewall, router, access point, UPS, otro).
 * Ruta: `#/equipo/<id>[/<pestaña>[/<puerto>]][?editar=1]`. Pestañas: puertos, credenciales, configuraciones, historial.
 * Los servidores tienen su propia ficha (`#/servidor/<id>`).
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, abrirModal, cerrarModal, toast } from '../assets/js/marco.js';
import { duplicar, selectorConCrear } from '../assets/js/altas.js';
import { valoresParaDuplicar } from '../assets/js/altas/equipos.js';
import { h, icono, tabla, ahoraISO, fmtFecha, fmtFechaHora, indicadorVerificacion, estadoVerificacion, normalizar } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_CREDENCIAL_TIPO, ROTULO_CONFIGURACION_TIPO, esImpresora } from '../assets/js/modelos.js';
import {
  CAMPOS_COMUNES, CAMPOS_POR_TIPO, camposDe, camposDeCategoria, CATEGORIAS_PUESTO, ROTULO_ENLACE_TIPO, ROTULO_ESTADO_PUERTO, ROTULO_SEGURIDAD, cargarContexto, leerRuta, encabezado, pestanas, campo, enlace, avisoVista,
  formulario, textoValor, fichaCab, miniRack, cadenaDePuerto, textoUltimoCambio, pedirBaja, seguro, estadoPill, valorHistorial, nodoCadena, hashEquipo, abrirConectarPuerto, abrirDesconectarPuerto
} from '../assets/js/red.js';
import { bloqueAsignacion } from '../assets/js/personas.js';
import { cargarVinculos, contarVinculos, pintarVinculos } from '../assets/js/vinculos.js';

/** @typedef {import('../assets/js/modelos.js').Puerto} Puerto */
/** @typedef {import('../assets/js/modelos.js').Equipo} Equipo */

const TIPOS_CON_PUERTOS = ['switch', 'patchera', 'router', 'firewall', 'access_point'];
const CLASES_VLAN = ['v10', 'v20', 'v30', 'v40'];

// Estado de la pantalla de puertos que se recuerda entre vistas.
let consultaPuerto = '';
let vistaTabla = false;
let editarVarios = false;
const rangoSel = { desde: 1, hasta: 1, vlan: '', estado: '', verificar: true };

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const ctx = await cargarContexto();
  const { partes, consulta } = leerRuta();
  const id = partes[0];
  const equipo = id ? await repositorio.obtener('equipos', id) : null;
  if (equipo && equipo.equipo_tipo === 'servidor') { location.replace('#/servidor/' + equipo.id); return; }
  await encabezado(contenedor, 'P06', 'Ficha de equipo', [['Red', '#/red/equipos'], [equipo ? equipo.equipo_nombre : 'Equipo']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso al módulo Red.'); return; }
  if (!equipo || equipo.organizacion_id !== ctx.org) { avisoVista(contenedor, 'No encontramos ese equipo en esta organización (puede haberse dado de baja).'); return; }
  const estado = { editando: consulta.get('editar') === '1' && ctx.modifica };

  const armar = async () => {
    const scroller = contenedor.parentElement;
    const y = scroller ? scroller.scrollTop : 0;
    // Conserva el encabezado (código y migas) y rearma el resto.
    while (contenedor.children.length > 2) contenedor.removeChild(/** @type {Node} */ (contenedor.lastChild));
    const actual = await repositorio.obtener('equipos', id);
    if (!actual) { avisoVista(contenedor, 'El equipo ya no existe.'); return; }
    await dibujar(contenedor, ctx, actual, leerRuta().partes, estado, armar);
    if (scroller) scroller.scrollTop = y;
  };
  await dibujar(contenedor, ctx, equipo, partes, estado, armar);
}

/**
 * @param {HTMLElement} cont @param {import('../assets/js/red.js').Contexto} ctx @param {Equipo} e @param {string[]} partes
 * @param {{editando: boolean}} estado @param {() => Promise<void>} rearmar
 */
async function dibujar(cont, ctx, e, partes, estado, rearmar) {
  const tipo = e.equipo_tipo;
  const conPuertos = TIPOS_CON_PUERTOS.includes(tipo);
  const puedeCred = puede(ctx.u, 'ver', 'credenciales', ctx.org), puedeConf = puede(ctx.u, 'ver', 'configuraciones', ctx.org);
  const [racks, ubicaciones, creds, confs, wifis, enlaces, equiposOrg, vinc] = await Promise.all([
    repositorio.listar('racks', { organizacion_id: ctx.org }), repositorio.listar('ubicaciones', { organizacion_id: ctx.org }),
    puedeCred ? repositorio.listar('credenciales', { equipo_id: e.id }) : Promise.resolve([]), puedeConf ? repositorio.listar('configuraciones', { equipo_id: e.id }) : Promise.resolve([]),
    tipo === 'access_point' ? repositorio.listar('redes_wifi', { organizacion_id: ctx.org }) : Promise.resolve([]),
    tipo === 'router' || tipo === 'firewall' ? repositorio.listar('enlaces_isp', { organizacion_id: ctx.org, equipo_id: e.id }) : Promise.resolve([]),
    repositorio.listar('equipos', { organizacion_id: ctx.org }), cargarVinculos(e.id)]);
  const mapaEq = new Map(equiposOrg.map(x => [x.id, x]));
  // Computadoras (y servidores) a las que se puede conectar una impresora USB o de las que un reloj descarga las fichadas.
  /** @type {Array<[string, string]>} */
  const pcOpciones = equiposOrg.filter(x => x.id !== e.id && !esImpresora(x) && (x.equipo_tipo === 'servidor' || (x.equipo_tipo === 'otro' && CATEGORIAS_PUESTO.includes(String((x.equipo_campos || {}).otro_categoria)))))
    .sort((a, b) => a.equipo_nombre.localeCompare(b.equipo_nombre, 'es', { numeric: true })).map(x => [x.id, x.equipo_nombre + (x.equipo_ip_gestion ? ' · ' + x.equipo_ip_gestion : '')]);
  const mapaRacks = new Map(racks.map(r => [r.id, r])), mapaUbic = new Map(ubicaciones.map(x => [x.id, x]));
  const tabs = /** @type {Array<[string, string, string?]>} */ ([['vinculos', 'Vínculos (' + contarVinculos(vinc) + ')']]);
  if (conPuertos) tabs.push(['puertos', 'Puertos']);
  tabs.push(['credenciales', 'Credenciales (' + creds.length + ')'], ['configuraciones', 'Configuraciones (' + confs.length + ')']);
  tabs.push(['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']);
  if (ctx.historial) tabs.push(['historial', 'Historial']);
  const tab = tabs.some(t => t[0] === partes[1]) ? partes[1] : tabs[0][0];
  const hashBase = '#/equipo/' + e.id;
  const compacta = (tab === 'puertos' || tab === 'vinculos') && !estado.editando;

  // ---- datos del resumen
  const camposTipo = CAMPOS_POR_TIPO[tipo] || [];
  const campos = camposDe(tipo, (e.equipo_campos || {}).otro_categoria);
  const rack = e.rack_id ? mapaRacks.get(e.rack_id) : null;
  const ub = e.ubicacion_id ? mapaUbic.get(e.ubicacion_id) : null;
  const uTexto = rack ? rack.rack_nombre + ' · ' + (e.rack_u_alto && e.rack_u_alto > 1 ? 'U' + e.rack_u_inicio + '–U' + (Number(e.rack_u_inicio) + e.rack_u_alto - 1) : 'U' + e.rack_u_inicio) : '—';
  /** @type {HTMLElement} */
  let datos;
  /** @type {null|(() => {valores: Object<string, any>, errores: string[]})} */
  let leerForm = null;
  /** @type {HTMLElement|null} */
  let errorBox = null;
  if (estado.editando) {
    /** Computadora con «+ Crear …» (impresora USB, reloj). @param {import('../assets/js/red.js').Campo} c @param {any} val */
    const selectorPc = (c, val) => selectorConCrear({ desde: 'equipos', campo: 'equipo_campos.' + c.k, organizacion_id: ctx.org, valor: val || null, etiqueta: c.r, rotuloOrigen: 'Editar ' + e.equipo_nombre,
      cargarOpciones: async () => pcOpciones.map(o => ({ valor: o[0], texto: o[1] })), valoresAlta: { equipo_tipo: 'otro', tipos: ['otro'], categorias: ['PC de escritorio', 'Notebook'], otro_categoria: 'PC de escritorio', titulo: 'Nueva computadora' },
      alCambiar: (id, reg) => { if (reg) pcOpciones.push([reg.id, reg.equipo_nombre]); } });
    const fc = formulario(CAMPOS_COMUNES, e), ft = formulario(camposTipo, e.equipo_campos || {}, { equipos: pcOpciones, selectorEquipo: selectorPc });
    // Campos de la categoría (impresora, reloj…): se arman al cambiar la categoría de un equipo «otro».
    /** @type {null|ReturnType<typeof formulario>} */
    let fCat = null;
    const zonaCat = h('div');
    const pintarCat = () => {
      const cat = tipo === 'otro' && ft.ctl.otro_categoria ? ft.ctl.otro_categoria.value : '';
      const cs = camposDeCategoria(cat);
      zonaCat.textContent = '';
      if (!cs.length) { fCat = null; return; }
      const vals = { ...(e.equipo_campos || {}) };
      if (esImpresora({ equipo_tipo: 'otro', equipo_campos: { otro_categoria: cat } }) && !vals.impresora_conexion) vals.impresora_conexion = 'red';
      fCat = formulario(cs, vals, { equipos: pcOpciones, selectorEquipo: selectorPc });
      zonaCat.appendChild(h('h3', { text: 'Datos propios de «' + cat.trim() + '»', style: 'margin:10px 0 6px' }));
      zonaCat.appendChild(fCat.nodo);
      const con = fCat.ctl.impresora_conexion, pc = fCat.ctl.impresora_pc_id;
      if (con && pc) {
        const sync = () => { const usb = con.value === 'usb'; /** @type {HTMLSelectElement} */ (pc).disabled = !usb; if (!usb) /** @type {HTMLSelectElement} */ (pc).value = ''; };
        con.addEventListener('change', sync); sync();
      }
    };
    if (tipo === 'otro' && ft.ctl.otro_categoria) ft.ctl.otro_categoria.addEventListener('change', pintarCat);
    pintarCat();
    const selUb = selectorConCrear({ desde: 'equipos', campo: 'ubicacion_id', organizacion_id: ctx.org, valor: e.ubicacion_id || null, etiqueta: 'Sede / sala', rotuloOrigen: 'Editar ' + e.equipo_nombre });
    const selRack = selectorConCrear({ desde: 'equipos', campo: 'rack_id', organizacion_id: ctx.org, valor: e.rack_id || null, etiqueta: 'Rack', rotuloOrigen: 'Editar ' + e.equipo_nombre,
      alCambiar: (_id, reg) => { if (reg) racks.push(reg); alRack(); } });
    const uIni = h('input', { type: 'number', min: '1', 'aria-label': 'U inicial' }), uAlto = h('input', { type: 'number', min: '1', 'aria-label': 'Alto en U' });
    /** @type {HTMLInputElement} */ (uIni).value = e.rack_u_inicio == null ? '' : String(e.rack_u_inicio);
    /** @type {HTMLInputElement} */ (uAlto).value = e.rack_u_alto == null ? '' : String(e.rack_u_alto);
    function alRack() { const r = racks.find(x => x.id === /** @type {HTMLSelectElement} */ (selRack).value); if (r) /** @type {HTMLSelectElement} */ (selUb).value = r.ubicacion_id; /** @type {HTMLSelectElement} */ (selUb).disabled = !!r; /** @type {HTMLInputElement} */ (uIni).disabled = !r; /** @type {HTMLInputElement} */ (uAlto).disabled = !r; }
    alRack();
    const ubic = h('div', { class: 'datos', style: 'margin-top:8px' }, [
      h('div', { class: 'campo' }, [h('label', { text: 'Rack' }), selRack]), h('div', { class: 'campo' }, [h('label', { text: 'U inicial (1 = abajo)' }), uIni]),
      h('div', { class: 'campo' }, [h('label', { text: 'Alto (U)' }), uAlto]), h('div', { class: 'campo' }, [h('label', { text: 'Sede / sala' }), selUb])]);
    errorBox = h('div', { class: 'rd-err', role: 'alert', 'aria-live': 'polite' });
    datos = h('div', { class: 'rd-edicion' }, [h('div', { class: 'mut', text: 'Tipo: ' + ROTULO_EQUIPO_TIPO[tipo] + ' (no se puede cambiar; si está mal cargado, dalo de baja y creá uno nuevo).' }), fc.nodo, ubic,
      camposTipo.length ? h('h3', { text: 'Datos propios de ' + (ROTULO_EQUIPO_TIPO[tipo] || tipo).toLowerCase(), style: 'margin:10px 0 6px' }) : null, ft.nodo, zonaCat, errorBox]);
    leerForm = () => {
      const a = fc.leer(), b = ft.leer(), cc = fCat ? fCat.leer() : { valores: /** @type {Object<string, any>} */ ({}), errores: /** @type {string[]} */ ([]) };
      /** @type {string[]} */
      const errores = a.errores.concat(b.errores, cc.errores);
      if (cc.valores.impresora_conexion === 'usb' && !cc.valores.impresora_pc_id) errores.push('Una impresora USB / local necesita indicar la computadora a la que está conectada.');
      const rk = racks.find(x => x.id === /** @type {HTMLSelectElement} */ (selRack).value) || null;
      const ini = parseInt(/** @type {HTMLInputElement} */ (uIni).value, 10), alto = parseInt(/** @type {HTMLInputElement} */ (uAlto).value, 10);
      if (rk) {
        if (!(ini >= 1) || !(alto >= 1)) errores.push('Si el equipo está en un rack, indicá la U inicial y el alto (mínimo 1).');
        else if (ini + alto - 1 > rk.rack_unidades_total) errores.push('El equipo no entra: el rack ' + rk.rack_nombre + ' tiene ' + rk.rack_unidades_total + ' U.');
      }
      if (tipo === 'access_point' && b.valores.access_point_modo === 'controlado' && !b.valores.access_point_controladora) errores.push('Un access point controlado necesita indicar la controladora.');
      return { valores: { ...a.valores, __ubicacion: rk ? rk.ubicacion_id : /** @type {HTMLSelectElement} */ (selUb).value || null, __rack: rk ? rk.id : null, __ini: rk ? ini : null, __alto: rk ? alto : null, __tipo: { ...b.valores, ...cc.valores } }, errores };
    };
  } else {
    /** @type {Array<[string, Node|string|null|undefined]>} */
    const pares = [['Nombre', e.equipo_nombre], ['Tipo', ROTULO_EQUIPO_TIPO[tipo]], ['Marca', e.equipo_marca], ['Modelo', e.equipo_modelo], ['IP de gestión', e.equipo_ip_gestion],
      ['MAC', e.equipo_mac], ['Número de serie', e.equipo_numero_serie], ['Estado', estadoPill(e.equipo_estado)], ['Rack / unidad', uTexto], ['Sede / sala', ub ? ub.ubicacion_nombre : null]];
    for (const c of campos) {
      const val = (e.equipo_campos || {})[c.k];
      if (c.k === 'impresora_pc_id' && (e.equipo_campos || {}).impresora_conexion !== 'usb') continue;
      if (c.t === 'equipo') { const pc = val ? mapaEq.get(val) : null; pares.push([c.k === 'impresora_pc_id' ? 'Conectada a' : c.r, pc ? enlace(pc.equipo_nombre, hashEquipo(pc)) : val ? '(equipo que ya no está)' : '—']); }
      else pares.push([c.r, textoValor(c, val)]);
    }
    if (e.equipo_notas) pares.push(['Notas', e.equipo_notas]);
    const compactos = tab === 'vinculos' ? ['Tipo', 'Marca', 'Modelo', 'IP de gestión', 'MAC', 'Número de serie', 'Estado', 'Rack / unidad', 'Sede / sala', 'Categoría', 'Conexión', 'Conectada a']
      : ['Tipo', 'Marca', 'Modelo', 'IP de gestión', 'Rack / unidad', 'Estado'];
    const visibles = compacta ? pares.filter(p => compactos.includes(p[0])) : pares;
    datos = h('div', { class: 'datos' }, visibles.map(p => campo(p[0], p[1])));
  }

  const botones = /** @type {Node[]} */ ([]);
  if (estado.editando) {
    botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
      const r = /** @type {() => any} */ (leerForm)();
      const v = r.valores;
      const errores = /** @type {string[]} */ (r.errores);
      const nombre = String(v.equipo_nombre || '');
      if (nombre) {
        const otros = await repositorio.listar('equipos', x => x.organizacion_id === ctx.org && x.id !== e.id);
        if (otros.some(x => normalizar(x.equipo_nombre) === normalizar(nombre))) errores.push('Ya hay otro equipo llamado «' + nombre + '».');
        if (v.__rack) {
          const choque = otros.find(x => x.rack_id === v.__rack && x.rack_u_inicio != null && x.rack_u_alto != null && v.__ini <= x.rack_u_inicio + x.rack_u_alto - 1 && x.rack_u_inicio <= v.__ini + v.__alto - 1);
          if (choque) errores.push('Esas unidades se superponen con ' + choque.equipo_nombre + ' (U' + choque.rack_u_inicio + ').');
        }
      }
      if (errores.length) { /** @type {HTMLElement} */ (errorBox).textContent = errores.join(' '); return; }
      const reg = { ...e };
      for (const c of CAMPOS_COMUNES) /** @type {any} */ (reg)[c.k] = v[c.k];
      reg.ubicacion_id = v.__ubicacion; reg.rack_id = v.__rack; reg.rack_u_inicio = v.__ini; reg.rack_u_alto = v.__alto;
      reg.equipo_campos = { ...(e.equipo_campos || {}), ...v.__tipo };
      const g = await seguro(() => repositorio.guardar('equipos', reg, ctx.u.id));
      if (!g) return;
      toast('Cambios guardados · verificado hoy (' + fmtFecha(ahoraISO()) + ')');
      estado.editando = false; history.replaceState(null, '', hashBaseConTab(hashBase, partes));
      await rearmar();
    } }));
    botones.push(h('button', { type: 'button', text: 'Cancelar', onclick: async () => { estado.editando = false; history.replaceState(null, '', hashBaseConTab(hashBase, partes)); await rearmar(); } }));
  } else {
    if (ctx.modifica) botones.push(h('button', { type: 'button', text: 'Editar', onclick: async () => { estado.editando = true; await rearmar(); } }));
    if (ctx.modifica) botones.push(h('button', { type: 'button', text: 'Duplicar', title: 'Crear otro equipo con estos datos (sin serie, MAC, IP, código ni conexiones)', onclick: async () => {
      const c = await duplicar('equipos', e, valoresParaDuplicar(e), e.equipo_nombre);
      if (c) { toast('«' + c.equipo_nombre + '» creado a partir de la copia.'); ir(hashEquipo(c)); }
    } }));
    botones.push(h('button', { type: 'button', text: 'Etiqueta', title: 'Imprimir la etiqueta con QR de este equipo', onclick: () => ir('#/etiqueta/equipos/' + e.id) }));
    if (ctx.baja) botones.push(h('button', { type: 'button', text: 'Dar de baja', onclick: () => confirmarBaja(ctx, e) }));
    else if (ctx.pideBaja) botones.push(h('button', { type: 'button', text: 'Pedir la baja', title: 'Lo confirma el superadmin', onclick: () => pedirBaja(ctx, 'equipos', e.id) }));
  }

  cont.appendChild(fichaCab({
    ctx, tipo: 'equipo', etiqueta: (ROTULO_EQUIPO_TIPO[tipo] || 'Equipo').toLowerCase(), titulo: e.equipo_nombre, icono: tipo === 'access_point' ? 'wifi' : 'equipo', datos, botones, editando: estado.editando,
    registro: e, coleccion: 'equipos', ultimoCambio: await textoUltimoCambio(ctx, 'Equipo', e), minirack: estado.editando ? null : miniRack(e, rack), compacta, alConfirmar: rearmar
  }));

  // ---- vínculos propios del tipo
  if (!estado.editando && (wifis.length || enlaces.length)) {
    const emite = wifis.filter(w => (w.access_point_ids || []).includes(e.id));
    const hijos = /** @type {Node[]} */ ([]);
    if (tipo === 'access_point') {
      hijos.push(h('b', { text: 'Redes Wi-Fi que emite: ' }));
      if (!emite.length) hijos.push('ninguna cargada');
      emite.forEach((w, i) => { if (i) hijos.push(', '); hijos.push(enlace(w.wifi_ssid + ' (' + (ROTULO_SEGURIDAD[w.wifi_seguridad] || w.wifi_seguridad) + ')', '#/wifi/' + w.id)); });
    } else {
      hijos.push(h('b', { text: 'Enlaces a Internet que terminan acá: ' }));
      enlaces.forEach((x, i) => { if (i) hijos.push(', '); hijos.push(enlace(x.enlace_proveedor + (x.enlace_es_principal ? ' (principal)' : ' (respaldo)'), '#/enlace/' + x.id)); });
    }
    if (tipo === 'access_point' || enlaces.length) cont.appendChild(h('div', { class: 'msg', style: 'margin-top:8px' }, hijos));
  }
  if (!estado.editando) { const asig = await bloqueAsignacion(ctx, e, rearmar); if (asig) cont.appendChild(asig); }
  if (estado.editando) { cont.appendChild(h('div', { class: 'mut', style: 'margin-top:8px', text: 'Guardá o cancelá la edición para ver los puertos, credenciales y el historial.' })); return; }

  const barra = pestanas(tabs, tab, k => '#/equipo/' + e.id + '/' + k);
  barra.style.margin = '8px 0 8px';
  cont.appendChild(barra);

  if (tab === 'vinculos') { const zona = h('div'); cont.appendChild(zona); pintarVinculos(zona, e, vinc); }
  else if (tab === 'puertos') cont.appendChild(await cuerpoPuertos(ctx, e, partes, rearmar));
  else if (tab === 'credenciales') {
    cont.appendChild(!puedeCred ? h('div', { class: 'aviso' }, ['Tu rol no ve el módulo Credenciales.'])
      : !creds.length ? h('div', { class: 'aviso' }, ['Este equipo no tiene credenciales vinculadas.'])
        : h('div', null, [tabla(['Nombre', 'Tipo', 'Usuario', 'Verificado'], creds.map(c => [c.credencial_nombre, ROTULO_CREDENCIAL_TIPO[c.credencial_tipo] || c.credencial_tipo, c.credencial_usuario || '—', indicadorVerificacion(c.verificado_en, ctx.umbrales, true)]),
          { tipo: 'credencial', onFila: (_, i) => ir('#/credencial/' + creds[i].id) }), h('div', { class: 'mut', style: 'margin-top:6px', text: 'Nunca se muestran contraseñas en los listados. Tocá una credencial para abrir su ficha.' })]));
  } else if (tab === 'configuraciones') {
    cont.appendChild(!puedeConf ? h('div', { class: 'aviso' }, ['Tu rol no ve el módulo Configuraciones.'])
      : !confs.length ? h('div', { class: 'aviso' }, ['Este equipo no tiene configuraciones vinculadas.'])
        : tabla(['Título', 'Tipo', 'Fecha', 'Verificado'], confs.map(c => [c.configuracion_titulo, ROTULO_CONFIGURACION_TIPO[c.configuracion_tipo] || c.configuracion_tipo, fmtFecha(c.configuracion_version_fecha), indicadorVerificacion(c.verificado_en, ctx.umbrales, true)]),
          { tipo: 'configuracion', onFila: (_, i) => ir('#/config/' + confs[i].id) }));
  } else if (tab === 'relaciones') {
    const zona = h('div'); cont.appendChild(zona);
    try { await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'Equipo', entidadId: e.id, organizacionId: ctx.org }); } catch (err) { console.error(err); zona.appendChild(h('div', { class: 'aviso', text: 'No se pudieron mostrar las relaciones.' })); }
  } else if (tab === 'archivos') {
    const zona = h('div'); cont.appendChild(zona);
    try { await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'Equipo', entidadId: e.id, organizacionId: ctx.org }); } catch (err) { console.error(err); zona.appendChild(h('div', { class: 'aviso', text: 'No se pudieron mostrar los archivos.' })); }
  } else cont.appendChild(await cuerpoHistorial(ctx, e));
}

/** @param {string} base @param {string[]} partes */
function hashBaseConTab(base, partes) { return base + (partes[1] ? '/' + partes[1] : '') + (partes[2] ? '/' + partes[2] : ''); }

/** @param {import('../assets/js/red.js').Contexto} ctx @param {Equipo} e */
function confirmarBaja(ctx, e) {
  const cuerpo = h('div', { style: 'padding:18px 20px;width:460px', role: 'alertdialog', 'aria-label': 'Confirmar baja' }, [
    h('h2', { text: 'Dar de baja ' + e.equipo_nombre }),
    h('p', { text: 'El equipo y sus puertos dejan de aparecer en listados y búsquedas, y se desconectan los puertos de otros equipos que iban a él. El historial se conserva y la baja se puede revertir desde el historial de cambios.' }),
    h('div', { class: 'herr', style: 'justify-content:flex-end' }, [h('button', { type: 'button', text: 'Cancelar', onclick: () => cerrarModal() }),
      h('button', { type: 'button', class: 'primario', text: 'Sí, dar de baja', onclick: async () => {
        const ok = await seguro(() => repositorio.darDeBaja('equipos', e.id, { usuarioId: ctx.u.id }));
        cerrarModal();
        if (ok !== null) { toast('«' + e.equipo_nombre + '» dado de baja.'); ir('#/red/equipos'); }
      } })])]);
  abrirModal(cuerpo);
}

/** @param {import('../assets/js/red.js').Contexto} ctx @param {Equipo} e */
async function cuerpoHistorial(ctx, e) {
  const cs = await repositorio.listar('cambios', c => c.cambio_entidad === 'Equipo' && c.entidad_id === e.id, { ordenarPor: 'cambio_fecha', descendente: true });
  if (!cs.length) return h('div', { class: 'aviso' }, ['Este equipo todavía no tiene cambios registrados.']);
  const rot = new Map(CAMPOS_COMUNES.concat(CAMPOS_POR_TIPO[e.equipo_tipo] || []).map(c => [c.k, c.r]));
  rot.set('ubicacion_id', 'Sede / sala'); rot.set('rack_id', 'Rack'); rot.set('rack_u_inicio', 'Posición (U)'); rot.set('rack_u_alto', 'Alto (U)');
  const nombres = new Map([...(await repositorio.listar('racks', { organizacion_id: ctx.org })).map(r => /** @type {[string, string]} */ ([r.id, r.rack_nombre])), ...(await repositorio.listar('ubicaciones', { organizacion_id: ctx.org })).map(u => /** @type {[string, string]} */ ([u.id, u.ubicacion_nombre]))]);
  /** @param {string|null} v */
  const val = v => { const t = valorHistorial(v); return nombres.get(t) || t; };
  const nombreOp = { alta: 'Alta', baja: 'Baja', restauracion: 'Restauración', modificacion: 'Cambio' };
  return tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cs.map(c => [fmtFechaHora(c.cambio_fecha), ctx.nombresUsuario.get(c.usuario_id) || '—',
    c.cambio_campo ? (rot.get(c.cambio_campo) || c.cambio_campo) : nombreOp[c.cambio_operacion], c.cambio_campo ? val(c.cambio_valor_anterior) : '—', c.cambio_campo ? val(c.cambio_valor_nuevo) : '—']));
}

// ---------------------------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------------------------

/**
 * @param {import('../assets/js/red.js').Contexto} ctx @param {Equipo} e @param {string[]} partes @param {() => Promise<void>} rearmar
 */
async function cuerpoPuertos(ctx, e, partes, rearmar) {
  const tipo = e.equipo_tipo, ec = e.equipo_campos || {};
  const [equiposOrg, todosPuertos, puestos, vlans, enlacesIsp] = await Promise.all([repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('puertos'),
    repositorio.listar('puestos', { organizacion_id: ctx.org }), repositorio.listar('vlans', { organizacion_id: ctx.org }), repositorio.listar('enlaces_isp', { organizacion_id: ctx.org })]);
  const mapas = { equipos: new Map(equiposOrg.map(x => [x.id, x])), puertos: new Map(todosPuertos.map(p => [p.id, p])), puestos: new Map(puestos.map(p => [p.id, p])) };
  const mapaIsp = new Map(enlacesIsp.map(l => [l.id, l]));
  const puedeIsp = tipo === 'router' || tipo === 'firewall';
  const mv = new Map(vlans.map(v => [v.id, v]));
  /** @type {Map<number, Puerto>} */
  const reg = new Map(todosPuertos.filter(p => p.equipo_id === e.id).map(p => [p.puerto_numero, p]));
  const maxReg = Math.max(0, ...Array.from(reg.keys()));
  let nRj = 0, nSfp = 0;
  if (tipo === 'switch') { nRj = Number(ec.switch_puertos_total) || 0; nSfp = Number(ec.switch_puertos_sfp) || 0; }
  else if (tipo === 'patchera') nRj = Number(ec.patchera_cantidad_bocas) || 0;
  else if (tipo === 'router') nRj = (Number(ec.router_puertos_wan) || 0) + (Number(ec.router_puertos_lan) || 0);
  else if (tipo === 'firewall') nRj = Number(ec.firewall_interfaces_total) || 0;
  const total = Math.max(nRj + nSfp, maxReg);
  if (!total) return h('div', { class: 'aviso' }, ['Este equipo no tiene puertos cargados.' + (ctx.modifica ? ' Editá sus datos para indicar la cantidad de puertos.' : '')]);
  const esSfp = (/** @type {number} */ n) => { const p = reg.get(n); return p ? p.puerto_tipo !== 'rj45' : tipo === 'switch' && n > nRj; };

  // VLAN → tono y patrón (hay 4 estilos; si hay más, se repiten y el detalle aclara cuál es)
  const usadas = Array.from(new Set(Array.from(reg.values()).map(p => p.vlan_nativa_id).filter(Boolean))).map(x => mv.get(/** @type {string} */ (x))).filter(Boolean).sort((a, b) => a.vlan_numero - b.vlan_numero);
  const claseVlan = new Map(usadas.map((v, i) => [v.id, CLASES_VLAN[i % CLASES_VLAN.length]]));
  /** @param {number} n */
  const textoDestino = n => {
    const p = reg.get(n);
    if (!p) return '';
    const o = p.conectado_a_puerto_id ? mapas.puertos.get(p.conectado_a_puerto_id) : null, oe = o ? mapas.equipos.get(o.equipo_id) : null;
    const pu = (p.puesto_id || (o && o.puesto_id)) ? mapas.puestos.get(/** @type {string} */ (p.puesto_id || (o && o.puesto_id))) : null;
    const isp = p.enlace_isp_id ? mapaIsp.get(p.enlace_isp_id) : null;
    return [oe ? oe.equipo_nombre + ' ' + (o ? (o.puerto_nombre || o.puerto_numero) : '') : '', isp ? 'Internet ' + isp.enlace_proveedor + ' ' + (isp.enlace_ip_publica || '') : '', p.conectado_a_descripcion, pu ? pu.puesto_nombre + ' ' + (pu.puesto_boca_pared || '') : '', p.puerto_nombre, p.puerto_notas].filter(Boolean).join(' ');
  };

  let sel = /^\d+$/.test(partes[2] || '') ? parseInt(partes[2], 10) : null;
  /** @type {Map<number, HTMLElement>} */
  const botones = new Map();
  const base = '#/equipo/' + e.id + '/puertos/';
  /** @param {number} n */
  const clase = n => {
    const p = reg.get(n);
    let c = 'puerto';
    if (!p) c += ' libre rd-sin-cargar';
    else if (p.puerto_estado === 'libre') c += ' libre';
    else if (p.puerto_estado === 'deshabilitado') c += ' off';
    else { c += ' ' + (p.vlan_nativa_id && claseVlan.get(p.vlan_nativa_id) || ''); }
    if (p && p.puerto_modo === 'troncal') c += ' rd-troncal';
    if (sel === n) c += ' sel';
    return c;
  };
  /** @param {number} n */
  const etiquetaAria = n => {
    const p = reg.get(n);
    if (!p) return 'Puerto ' + n + ', sin cargar';
    const v = p.vlan_nativa_id ? mv.get(p.vlan_nativa_id) : null;
    return 'Puerto ' + n + (v ? ', VLAN ' + v.vlan_numero : '') + ', ' + ROTULO_ESTADO_PUERTO[p.puerto_estado].toLowerCase() + (p.puerto_modo === 'troncal' ? ', troncal' : '');
  };
  const detalle = h('div', { class: 'bloque rd-det', style: 'flex:1;min-width:340px' });
  const resultado = h('span', { class: 'mut', role: 'status' });
  const panel = h('div', { class: 'panel-sw' });

  const aplicarConsulta = () => {
    const q = normalizar(consultaPuerto.trim());
    let n = 0;
    botones.forEach((b, num) => { const hit = !!q && normalizar(textoDestino(num)).includes(q); b.classList.toggle('hit', hit); if (hit) n++; });
    panel.classList.toggle('filtrando', !!q);
    resultado.textContent = q ? n + (n === 1 ? ' puerto coincide' : ' puertos coinciden') + ' (los demás se atenúan).' : '';
  };
  /** @param {number} n */
  const seleccionar = n => {
    sel = n;
    botones.forEach((b, num) => { b.classList.toggle('sel', num === n); b.setAttribute('aria-pressed', String(num === n)); });
    history.replaceState(null, '', base + n);
    pintarDetalle();
  };
  /** @param {number} n */
  const boton = n => {
    const b = h('button', { type: 'button', class: clase(n), text: String(n), title: etiquetaAria(n), 'aria-label': etiquetaAria(n), 'aria-pressed': String(sel === n), onclick: () => seleccionar(n) });
    botones.set(n, b);
    return b;
  };
  const numsRj = [], numsSfp = [];
  for (let n = 1; n <= total; n++) (esSfp(n) ? numsSfp : numsRj).push(n);
  let orden = numsRj;
  const colsGrande = numsRj.length > 24;
  if (tipo === 'switch' && numsRj.length > 12) { const cols = colsGrande ? 24 : 12; /** @type {number[]} */ const imp = [], par = []; numsRj.forEach((n, i) => (i % 2 === 0 ? imp : par).push(n)); orden = imp.concat(par); void cols; }
  const grid = h('div', { class: 'grid-rj' + (colsGrande ? '' : ' c12') }, orden.map(boton));
  const fila = tipo === 'switch' && numsRj.length > 12;
  if (fila) grid.style.gridTemplateColumns = 'repeat(' + Math.ceil(numsRj.length / 2) + ',' + (colsGrande ? '26px' : '34px') + ')';
  panel.appendChild(h('div', { class: 'mut', style: 'font-size:11px;margin-bottom:3px', text: (tipo === 'patchera' ? 'Bocas ' : 'RJ45 ') + (numsRj.length ? numsRj[0] + '–' + numsRj[numsRj.length - 1] : '') + (fila ? ' (arriba: impares; abajo: pares)' : '') }));
  panel.appendChild(grid);
  if (numsSfp.length) {
    panel.appendChild(h('div', { class: 'mut', style: 'font-size:11px;margin:8px 0 3px', text: 'SFP / SFP+ ' + numsSfp[0] + '–' + numsSfp[numsSfp.length - 1] }));
    panel.appendChild(h('div', { class: 'sfp-fila', style: 'grid-template-columns:repeat(' + Math.min(numsSfp.length, 12) + ',30px)' }, numsSfp.map(boton)));
  }
  const li = (/** @type {string} */ c, /** @type {string} */ t) => h('span', null, [h('i', { class: c }), t]);
  const ley = h('div', { class: 'leyenda' }, [h('span', { text: 'VLAN nativa:' })].concat(usadas.length ? usadas.map(v => li('l-' + claseVlan.get(v.id), v.vlan_numero + ' ' + v.vlan_nombre)) : [h('span', { text: 'ninguna cargada' })]).concat([
    h('span', { text: 'Estado:' }), li('l-libre', 'Libre / sin cargar'), h('span', { text: '✕ Deshabilitado' }), h('span', { text: 'T = troncal' }), li('l-sel', 'Seleccionado'), li('l-hit', 'Coincide con «¿A qué va?»')]));
  if (usadas.length > CLASES_VLAN.length) ley.appendChild(h('span', { class: 'mut', text: 'Hay más de 4 VLAN: los tonos se repiten; el detalle del puerto y la vista en tabla dicen cuál es.' }));
  const verifs = { vigente: 0, revisar: 0, viejo: 0 };
  reg.forEach(p => { verifs[estadoVerificacion(p.verificado_en, ctx.umbrales).nivel]++; });
  const resumenVerif = h('div', { class: 'leyenda', style: 'margin-top:4px' }, [h('span', { text: 'Verificación de los ' + reg.size + ' puertos cargados:' }),
    h('span', { class: 'verif chica v-reciente' }, [icono('check'), verifs.vigente + ' recientes']), h('span', { class: 'verif chica v-revisar' }, [icono('reloj'), verifs.revisar + ' a revisar']), h('span', { class: 'verif chica v-viejo' }, [icono('alerta'), verifs.viejo + ' viejos'])]);

  // ---- «¿A qué va?» (MJ22)
  const inp = h('input', { placeholder: 'Ej.: SRV-AGRO-01, oficina…', 'aria-label': '¿A qué va?', value: consultaPuerto, style: 'width:210px' });
  inp.addEventListener('input', () => { consultaPuerto = /** @type {HTMLInputElement} */ (inp).value; aplicarConsulta(); });
  const barra = h('div', { class: 'herr', style: 'margin:0 0 6px' }, [h('label', { text: '¿A qué va? ', style: 'font-weight:700' }), inp,
    h('button', { type: 'button', class: 'chico', text: 'Limpiar', onclick: () => { consultaPuerto = ''; /** @type {HTMLInputElement} */ (inp).value = ''; aplicarConsulta(); } }), resultado, h('span', { style: 'flex:1' }),
    h('button', { type: 'button', class: 'chico', text: vistaTabla ? 'Ver el frente dibujado' : 'Ver como tabla', 'aria-pressed': String(vistaTabla), onclick: async () => { vistaTabla = !vistaTabla; await rearmar(); } }),
    ctx.modifica ? h('button', { type: 'button', class: 'chico', text: editarVarios ? 'Cerrar «Editar varios»' : 'Editar varios', 'aria-pressed': String(editarVarios), onclick: async () => { editarVarios = !editarVarios; await rearmar(); } }) : null,
    ctx.verifica ? h('button', { type: 'button', class: 'chico', text: 'Confirmar todos los puertos', title: 'Marca todos los puertos cargados como verificados hoy, sin abrir formularios', onclick: async () => {
      let n = 0;
      for (const p of reg.values()) { await seguro(() => repositorio.confirmarVigente('puertos', p.id, ctx.u.id)); n++; }
      toast('Los ' + n + ' puertos de ' + e.equipo_nombre + ' quedaron confirmados como vigentes · verificados hoy (' + fmtFecha(ahoraISO()) + ')');
      await rearmar();
    } }) : null]);

  // ---- «Editar varios» (D-041)
  /** @type {HTMLElement|null} */
  let panelRango = null;
  if (editarVarios && ctx.modifica) {
    if (rangoSel.hasta < rangoSel.desde || rangoSel.hasta > total) { rangoSel.desde = 1; rangoSel.hasta = Math.min(total, 12); }
    const num = (/** @type {number} */ v, /** @type {string} */ et) => h('input', { type: 'number', min: '1', max: String(total), value: String(v), 'aria-label': et });
    const dd = num(rangoSel.desde, 'Desde el puerto'), hh = num(rangoSel.hasta, 'Hasta el puerto');
    const selV = h('select', { 'aria-label': 'VLAN nativa' }, [h('option', { value: '', text: 'No cambiar' })].concat(vlans.sort((a, b) => a.vlan_numero - b.vlan_numero).map(v => h('option', { value: v.id, text: v.vlan_numero + ' · ' + v.vlan_nombre }))));
    const selE = h('select', { 'aria-label': 'Estado' }, [['', 'No cambiar'], ['activo', 'Con enlace'], ['libre', 'Libre'], ['deshabilitado', 'Deshabilitado']].map(o => h('option', { value: o[0], text: o[1] })));
    /** @type {HTMLSelectElement} */ (selV).value = rangoSel.vlan; /** @type {HTMLSelectElement} */ (selE).value = rangoSel.estado;
    const chk = h('input', { type: 'checkbox' }); /** @type {HTMLInputElement} */ (chk).checked = rangoSel.verificar;
    const info = h('div', { class: 'mut', style: 'margin-top:6px', 'aria-live': 'polite' });
    const aplicar = h('button', { type: 'button', class: 'primario', text: 'Aplicar' });
    const cambiosTxt = () => [rangoSel.vlan ? 'VLAN ' + (mv.get(rangoSel.vlan)?.vlan_numero ?? '') : null, rangoSel.estado ? ROTULO_ESTADO_PUERTO[rangoSel.estado].toLowerCase() : null, rangoSel.verificar ? 'marcar como verificados hoy' : null].filter(Boolean);
    const actualizar = () => {
      rangoSel.desde = parseInt(/** @type {HTMLInputElement} */ (dd).value, 10) || 0; rangoSel.hasta = parseInt(/** @type {HTMLInputElement} */ (hh).value, 10) || 0;
      rangoSel.vlan = /** @type {HTMLSelectElement} */ (selV).value; rangoSel.estado = /** @type {HTMLSelectElement} */ (selE).value; rangoSel.verificar = /** @type {HTMLInputElement} */ (chk).checked;
      const ok = rangoSel.desde >= 1 && rangoSel.hasta <= total && rangoSel.desde <= rangoSel.hasta, n = rangoSel.hasta - rangoSel.desde + 1, c = cambiosTxt();
      info.textContent = !ok ? 'Elegí un rango entre 1 y ' + total + ' (el «desde» no puede ser mayor que el «hasta»).' : !c.length ? 'Elegí qué aplicar: una VLAN, un estado o marcar como verificados.'
        : 'Se van a modificar ' + n + (n === 1 ? ' puerto' : ' puertos') + ' (' + rangoSel.desde + '–' + rangoSel.hasta + '): ' + c.join(' · ') + '. Cada cambio queda en el historial.';
      /** @type {HTMLButtonElement} */ (aplicar).disabled = !(ok && c.length);
      botones.forEach((b, k) => b.classList.toggle('rango', ok && k >= rangoSel.desde && k <= rangoSel.hasta));
    };
    [dd, hh, selV, selE, chk].forEach(x => x.addEventListener('input', actualizar));
    aplicar.addEventListener('click', async () => {
      let n = 0;
      for (let k = rangoSel.desde; k <= rangoSel.hasta; k++) {
        const p = reg.get(k);
        const cambia = !!(rangoSel.vlan || rangoSel.estado);
        if (p && cambia) {
          await seguro(() => repositorio.guardar('puertos', { ...p, ...(rangoSel.vlan ? { vlan_nativa_id: rangoSel.vlan } : {}), ...(rangoSel.estado ? { puerto_estado: rangoSel.estado } : {}) }, ctx.u.id));
        } else if (p && rangoSel.verificar) await seguro(() => repositorio.confirmarVigente('puertos', p.id, ctx.u.id));
        else if (!p && cambia) await seguro(() => repositorio.guardar('puertos', nuevoPuerto(e, k, rangoSel.vlan, rangoSel.estado || 'libre', nSfp, nRj), ctx.u.id));
        else continue;
        n++;
      }
      toast('Se actualizaron ' + n + (n === 1 ? ' puerto' : ' puertos') + ' (' + rangoSel.desde + '–' + rangoSel.hasta + '): ' + cambiosTxt().join(' · '));
      editarVarios = false; await rearmar();
    });
    panelRango = h('div', { class: 'panel-rango' }, [h('h3', { text: 'Editar varios puertos a la vez' }),
      h('div', { class: 'herr' }, [h('div', null, [h('label', { text: 'Desde el puerto' }), dd]), h('div', null, [h('label', { text: 'Hasta el puerto' }), hh]), h('div', null, [h('label', { text: 'VLAN nativa' }), selV]), h('div', null, [h('label', { text: 'Estado' }), selE]),
        h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:13px;color:var(--texto);align-self:flex-end;height:32px' }, [chk, 'Marcar como verificados']), h('span', { style: 'flex:1' }), aplicar,
        h('button', { type: 'button', text: 'Cancelar', onclick: async () => { editarVarios = false; await rearmar(); } })]), info]);
    setTimeout(actualizar, 0);
  }

  // ---- detalle del puerto
  function pintarDetalle() {
    detalle.textContent = '';
    if (sel == null) {
      detalle.appendChild(h('h3', { text: 'Detalle del puerto' }));
      detalle.appendChild(h('div', { class: 'mut', text: 'Tocá un puerto del frente para ver a qué va, su VLAN y el recorrido completo hasta el puesto de trabajo.' }));
      return;
    }
    const n = sel, p = reg.get(n);
    const cab = h('div', { class: 'rd-cab-det' }, [h('h2', { text: 'Puerto ' + n + (p ? ' (' + (p.puerto_tipo === 'rj45' ? 'RJ45' : p.puerto_tipo === 'sfp' ? 'SFP' : 'SFP+') + ')' : '') + (p && p.puerto_nombre ? ' · ' + p.puerto_nombre : '') }), h('span', { class: 'esp' })]);
    if (ctx.modifica) cab.appendChild(h('button', { type: 'button', class: 'chico', text: p ? 'Editar puerto' : 'Cargar puerto', onclick: () => editarPuerto(n) }));
    if (ctx.modifica && p) {
      cab.appendChild(h('button', { type: 'button', class: 'chico', text: 'Conectar a…', title: 'Elegir el equipo y el puerto al que va (queda en las dos puntas)', onclick: () => abrirConectarPuerto(ctx, e, p, async () => { await rearmar(); }) }));
      if (p.conectado_a_puerto_id) {
        const o = mapas.puertos.get(p.conectado_a_puerto_id), oe = o ? mapas.equipos.get(o.equipo_id) : null;
        cab.appendChild(h('button', { type: 'button', class: 'chico', text: 'Desconectar', onclick: () => abrirDesconectarPuerto(ctx, e, p, oe && o ? oe.equipo_nombre + ' · puerto ' + o.puerto_numero : '', async () => { await rearmar(); }) }));
      }
    }
    cab.appendChild(h('button', { type: 'button', class: 'chico', text: 'Cerrar', title: 'Cerrar el detalle', onclick: () => { sel = null; botones.forEach(b => { b.classList.remove('sel'); b.setAttribute('aria-pressed', 'false'); }); history.replaceState(null, '', '#/equipo/' + e.id + '/puertos'); pintarDetalle(); } }));
    detalle.appendChild(cab);
    if (!p) { detalle.appendChild(h('div', { class: 'mut', text: 'Este puerto todavía no está cargado en la documentación.' + (ctx.modifica ? ' Usá «Cargar puerto» para registrarlo.' : '') })); return; }
    const vn = p.vlan_nativa_id ? mv.get(p.vlan_nativa_id) : null;
    const etiq = (p.vlans_etiquetadas || []).map(id => mv.get(id)).filter(Boolean);
    const g = h('div', { class: 'datos' }, [campo('Estado', ROTULO_ESTADO_PUERTO[p.puerto_estado]), campo('Modo', p.puerto_modo ? (p.puerto_modo === 'troncal' ? 'Troncal' : 'Acceso') : null), campo('Velocidad', p.puerto_velocidad),
      campo('VLAN nativa', vn ? enlace(vn.vlan_numero + ' · ' + vn.vlan_nombre, '#/vlan/' + vn.id) : null),
      campo('VLAN etiquetadas', etiq.length ? h('span', null, etiq.flatMap((v, i) => (i ? [', ', enlace(String(v.vlan_numero), '#/vlan/' + v.id)] : [enlace(String(v.vlan_numero), '#/vlan/' + v.id)]))) : null), campo('Notas', p.puerto_notas)]);
    detalle.appendChild(g);
    detalle.appendChild(h('div', { style: 'margin:6px 0;padding-top:6px;border-top:1px solid var(--borde)' }, [
      h('div', { class: 'herr', style: 'margin:0;flex-wrap:nowrap;justify-content:space-between' }, [indicadorVerificacion(p.verificado_en, ctx.umbrales),
        ctx.verifica ? h('button', { type: 'button', class: 'chico', style: 'white-space:nowrap;flex:none', text: 'Confirmar vigente', onclick: async () => {
          if (await seguro(() => repositorio.confirmarVigente('puertos', p.id, ctx.u.id))) { toast('Puerto ' + n + ' confirmado como vigente · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); await rearmar(); }
        } }) : null]),
      h('div', { class: 'verif-det', style: 'font-size:12px;margin-top:2px', text: 'Confirmó ' + (ctx.nombresUsuario.get(p.verificado_por) || '—') + ' el ' + fmtFecha(p.verificado_en) })]));
    const isp = p.enlace_isp_id ? mapaIsp.get(p.enlace_isp_id) : null;
    if (isp) {
      detalle.appendChild(h('label', { class: 'mut', text: '¿A qué va? · sale a Internet por', style: 'display:block;font-size:12px' }));
      detalle.appendChild(h('div', { class: 'cadena v' }, [nodoCadena('equipo', 'red', 'Enlace a Internet', isp.enlace_proveedor + (isp.enlace_es_principal ? ' (principal)' : ' (respaldo)'), isp.enlace_ip_publica || '', '#/enlace/' + isp.id)]));
      detalle.appendChild(h('div', { class: 'datos', style: 'margin-top:6px;grid-template-columns:repeat(2,1fr)' }, [
        campo('Servicio', (ROTULO_ENLACE_TIPO[isp.enlace_tipo] || isp.enlace_tipo) + ' · ' + (isp.enlace_velocidad_bajada_mbps ?? '—') + '/' + (isp.enlace_velocidad_subida_mbps ?? '—') + ' Mbps'),
        campo('IP pública', isp.enlace_ip_publica ? isp.enlace_ip_publica + (isp.enlace_tipo_ip ? ' (' + (isp.enlace_tipo_ip === 'fija' ? 'fija' : 'dinámica') + ')' : '') : null),
        campo('Teléfono de soporte', isp.enlace_telefono_soporte), campo('N.º de cliente', isp.enlace_numero_cliente)]));
    }
    if (p.conectado_a_puerto_id || p.conectado_a_descripcion || p.puesto_id) {
      detalle.appendChild(h('label', { class: 'mut', text: 'Recorrido (cada tramo es un enlace)', style: 'display:block;font-size:12px' }));
      detalle.appendChild(cadenaDePuerto(p, e, mapas, true));
    } else if (!isp) detalle.appendChild(h('div', { class: 'mut', style: 'border-top:1px solid var(--borde);padding-top:6px', text: 'Sin destino cargado.' }));
  }

  /** @param {number} n */
  function editarPuerto(n) {
    const p = reg.get(n) || nuevoPuerto(e, n, '', 'libre', nSfp, nRj);
    detalle.textContent = '';
    const modo = h('select', { 'aria-label': 'Modo' }, [h('option', { value: '', text: '—' }), h('option', { value: 'acceso', text: 'Acceso' }), h('option', { value: 'troncal', text: 'Troncal' })]);
    const estadoS = h('select', { 'aria-label': 'Estado' }, ['activo', 'libre', 'deshabilitado'].map(k => h('option', { value: k, text: ROTULO_ESTADO_PUERTO[k] })));
    const vel = h('input', { type: 'text', 'aria-label': 'Velocidad' });
    const nativa = selectorConCrear({ desde: 'puertos', campo: 'vlan_nativa_id', organizacion_id: ctx.org, valor: p.vlan_nativa_id || null, etiqueta: 'VLAN nativa', rotuloOrigen: 'Editar puerto ' + n,
      alCambiar: (_id, reg) => { if (reg) { vlans.push(reg); mv.set(reg.id, reg); } } });
    const puedePuesto = tipo === 'patchera';
    // Boca de patchera → puesto de trabajo (lado de atrás, D-047). «+ Crear nuevo puesto…» como todo selector de una dependencia (D-082).
    const selPuesto = puedePuesto ? selectorConCrear({ desde: 'puertos', campo: 'puesto_id', organizacion_id: ctx.org, valor: p.puesto_id || null, etiqueta: 'Puesto de trabajo', rotuloOrigen: 'Editar puerto ' + n }) : null;
    const desc = h('input', { type: 'text', 'aria-label': 'Destino en texto libre' });
    const selIsp = h('select', { 'aria-label': 'Enlace a Internet' }, [h('option', { value: '', text: '—' })].concat(enlacesIsp.map(l => h('option', { value: l.id, text: l.enlace_proveedor + (l.enlace_ip_publica ? ' · ' + l.enlace_ip_publica : '') + (l.enlace_es_principal ? ' (principal)' : ' (respaldo)') }))));
    /** @type {HTMLSelectElement} */ (selIsp).value = p.enlace_isp_id || '';
    const notas = h('input', { type: 'text', 'aria-label': 'Notas' });
    /** @type {HTMLSelectElement} */ (modo).value = p.puerto_modo || ''; /** @type {HTMLSelectElement} */ (estadoS).value = p.puerto_estado; /** @type {HTMLInputElement} */ (vel).value = p.puerto_velocidad || '';
    /** @type {HTMLInputElement} */ (desc).value = p.conectado_a_descripcion || ''; /** @type {HTMLInputElement} */ (notas).value = p.puerto_notas || '';
    if (p.conectado_a_puerto_id) { /** @type {HTMLInputElement} */ (desc).disabled = true; /** @type {HTMLInputElement} */ (desc).title = 'Este puerto está conectado a otro puerto cargado.'; }
    /** @type {Map<string, HTMLInputElement>} */
    const chks = new Map();
    const lista = h('div', { class: 'rd-lista-etq' }, vlans.map(v => {
      const c = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' })); c.checked = (p.vlans_etiquetadas || []).includes(v.id); chks.set(v.id, c);
      return h('label', { class: 'rd-etq' }, [c, String(v.vlan_numero)]);
    }));
    const err = h('div', { class: 'rd-err', role: 'alert' });
    const guardar = h('button', { type: 'button', class: 'primario chico', text: 'Guardar' });
    guardar.addEventListener('click', async () => {
      const m = /** @type {HTMLSelectElement} */ (modo).value;
      if (tipo === 'switch' && !m) { err.textContent = 'Indicá el modo del puerto (acceso o troncal).'; return; }
      const reg2 = { ...p, puerto_modo: m || null, puerto_estado: /** @type {HTMLSelectElement} */ (estadoS).value, puerto_velocidad: /** @type {HTMLInputElement} */ (vel).value.trim() || null,
        vlan_nativa_id: /** @type {HTMLSelectElement} */ (nativa).value || null, vlans_etiquetadas: m === 'troncal' ? Array.from(chks).filter(x => x[1].checked).map(x => x[0]) : [],
        conectado_a_descripcion: p.conectado_a_puerto_id ? null : /** @type {HTMLInputElement} */ (desc).value.trim() || null, puerto_notas: /** @type {HTMLInputElement} */ (notas).value.trim() || null,
        ...(puedePuesto ? { puesto_id: /** @type {HTMLSelectElement} */ (selPuesto).value || null } : {}),
        ...(puedeIsp ? { enlace_isp_id: /** @type {HTMLSelectElement} */ (selIsp).value || null } : {}) };
      if (await seguro(() => repositorio.guardar('puertos', reg2, ctx.u.id))) { toast('Puerto ' + n + ' guardado · verificado hoy (' + fmtFecha(ahoraISO()) + ')'); await rearmar(); }
    });
    const campoE = (/** @type {string} */ t, /** @type {Node} */ c) => h('div', { class: 'campo' }, [h('label', { text: t }), c]);
    detalle.appendChild(h('div', { class: 'rd-cab-det' }, [h('h2', { text: 'Editar puerto ' + n }), h('span', { class: 'esp' }), guardar, h('button', { type: 'button', class: 'chico', text: 'Cancelar', onclick: () => pintarDetalle() })]));
    detalle.appendChild(h('div', { class: 'datos', style: 'grid-template-columns:repeat(2,1fr)' }, [campoE('Estado', estadoS), tipo === 'switch' ? campoE('Modo', modo) : null, campoE('Velocidad', vel), campoE('VLAN nativa', nativa),
      puedeIsp ? campoE('Sale a Internet por (enlace)', selIsp) : null, puedePuesto && selPuesto ? campoE('Puesto de trabajo (a qué boca de pared llega)', selPuesto) : null, campoE('Destino (texto libre)', desc), campoE('Notas', notas)]));
    detalle.appendChild(h('div', { class: 'campo', style: 'margin-top:6px' }, [h('label', { text: 'VLAN etiquetadas (solo en troncal)' }), lista]));
    detalle.appendChild(err);
    detalle.appendChild(h('div', { class: 'rd-campo-nota', text: p.conectado_a_puerto_id ? 'Para cambiar la conexión con otro puerto usá «Conectar a…» o «Desconectar» en el detalle del puerto.' : '' }));
  }

  // ---- armado
  let cuerpoPrincipal;
  if (vistaTabla) {
    const filas = Array.from({ length: total }, (_, i) => i + 1).map(n => {
      const p = reg.get(n), v = p && p.vlan_nativa_id ? mv.get(p.vlan_nativa_id) : null;
      return [String(n), p ? (p.puerto_nombre || '—') : '—', p ? ROTULO_ESTADO_PUERTO[p.puerto_estado] : 'Sin cargar', p && p.puerto_modo ? (p.puerto_modo === 'troncal' ? 'Troncal' : 'Acceso') : '—', v ? v.vlan_numero + ' · ' + v.vlan_nombre : '—',
        textoDestino(n) || '—', p ? indicadorVerificacion(p.verificado_en, ctx.umbrales, true) : '—'];
    });
    cuerpoPrincipal = h('div', { class: 'fila', style: 'flex-wrap:wrap;align-items:flex-start' }, [h('div', { style: 'flex:2;min-width:560px;max-height:calc(100vh - 360px);overflow:auto' }, [tabla(['N.º', 'Nombre', 'Estado', 'Modo', 'VLAN nativa', '¿A qué va?', 'Verificado'], filas,
      { clase: 'chica', onFila: (f) => { sel = parseInt(f[0], 10); history.replaceState(null, '', base + sel); pintarDetalle(); } })]), detalle]);
  } else cuerpoPrincipal = h('div', { class: 'fila', style: 'flex-wrap:wrap;align-items:flex-start' }, [h('div', { style: 'flex:none;max-width:700px' }, [panel, ley, resumenVerif]), detalle]);
  pintarDetalle(); aplicarConsulta();
  return h('div', null, [barra, panelRango, cuerpoPrincipal]);
}

/**
 * Registro nuevo de puerto para un número que todavía no está cargado.
 * @param {Equipo} e @param {number} n @param {string} vlanId @param {string} estado @param {number} nSfp @param {number} nRj
 * @returns {any}
 */
function nuevoPuerto(e, n, vlanId, estado, nSfp, nRj) {
  const sfp = e.equipo_tipo === 'switch' && n > nRj && nSfp > 0;
  return { equipo_id: e.id, puerto_numero: n, puerto_nombre: null, puerto_tipo: sfp ? 'sfp_plus' : 'rj45', puerto_velocidad: null, puerto_modo: e.equipo_tipo === 'switch' ? (sfp ? 'troncal' : 'acceso') : null,
    vlan_nativa_id: vlanId || null, vlans_etiquetadas: [], conectado_a_equipo_id: null, conectado_a_puerto_id: null, conectado_a_descripcion: null, enlace_isp_id: null, puesto_id: null, puerto_estado: estado, puerto_notas: null };
}
