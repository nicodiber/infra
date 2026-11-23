// @ts-check
/**
 * P19 · Recorrido de verificación (`#/recorrido/<rackId|pendientes>`, MJ29, D-046).
 * Lista ordenada para confirmar en el lugar: los equipos de un rack por U y después los puertos con algo
 * documentado de sus switches y patcheras, o los pendientes «viejos» de la organización. Cada ítem:
 * «Sigue igual» (confirmarVigente) o «Cambió» (se edita en la fila y queda verificado hoy).
 * La lista se arma al entrar y no cambia mientras se recorre, para que lo confirmado no desaparezca.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, icono, indicadorVerificacion, diasDesde, normalizar } from '../assets/js/utiles.js';
import { confirmarConPasos, pasosDe, leerPlantillas } from '../assets/js/verificacion.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_ESTADO_EQUIPO } from '../assets/js/modelos.js';
import {
  aplicarEstilos, bloqueSinPermiso, estadoVacio, partesHash, rangoU, rutaEquipo, moduloEquipo, porId, crearCampo, validarLugarEnRack, ipValida
} from '../assets/js/racks.js';

/** @typedef {import('../assets/js/racks.js').CampoDef} CampoDef */

/**
 * @typedef {Object} Item
 * @property {string} clave
 * @property {string} coleccion
 * @property {string} id
 * @property {'racks'|'servidores'|'red'|'credenciales'|'configuraciones'} modulo
 * @property {string} etq Rótulo del tipo («Equipo», «Puerto»…).
 * @property {string} tipo Clase de color (`t-…`).
 * @property {string} nombre
 * @property {string} donde
 * @property {string|null} ruta
 * @property {any} registro
 * @property {CampoDef[]} campos
 * @property {string} [nota] Texto de apoyo (por ejemplo, a qué está conectado el puerto).
 */

/** @type {Array<[string, string]>} */
const OPC_PUERTO = [['activo', 'Activo'], ['libre', 'Libre'], ['deshabilitado', 'Deshabilitado']];
/** @type {Array<[string, string]>} */
const OPC_ESTADO = /** @type {Array<[string, string]>} */ (Object.entries(ROTULO_ESTADO_EQUIPO));

/** Campos que se pueden corregir en la fila, por colección. @type {Object<string, CampoDef[]>} */
const CAMPOS_POR_COLECCION = {
  racks: [{ k: 'rack_nombre', etq: 'Nombre', req: true }, { k: 'rack_notas', etq: 'Notas' }],
  credenciales: [{ k: 'credencial_nombre', etq: 'Nombre', req: true }, { k: 'credencial_usuario', etq: 'Usuario' }, { k: 'credencial_url_o_host', etq: 'Host o URL' }, { k: 'credencial_notas', etq: 'Notas' }],
  puestos: [{ k: 'puesto_nombre', etq: 'Nombre', req: true }, { k: 'puesto_boca_pared', etq: 'Boca de pared' }, { k: 'puesto_notas', etq: 'Notas' }],
  configuraciones: [{ k: 'configuracion_titulo', etq: 'Título', req: true }, { k: 'configuracion_notas', etq: 'Notas' }],
  vlans: [{ k: 'vlan_nombre', etq: 'Nombre', req: true }, { k: 'vlan_red_cidr', etq: 'Red (CIDR)' }, { k: 'vlan_gateway', etq: 'Gateway' }, { k: 'vlan_descripcion', etq: 'Descripción' }],
  redes_wifi: [{ k: 'wifi_ssid', etq: 'SSID', req: true }],
  enlaces_isp: [{ k: 'enlace_proveedor', etq: 'Proveedor', req: true }, { k: 'enlace_ip_publica', etq: 'IP pública' }, { k: 'enlace_telefono_soporte', etq: 'Teléfono de soporte' }]
};

/** @type {Object<string, string>} */
const ETQ_COLECCION = { racks: 'Rack', credenciales: 'Credencial', puestos: 'Puesto', configuraciones: 'Configuración', vlans: 'VLAN', redes_wifi: 'Wi-Fi', enlaces_isp: 'Enlace ISP' };
/** @type {Object<string, string>} */
const TIPO_COLECCION = { racks: 't-rack', credenciales: 't-credencial', puestos: 't-puesto', configuraciones: 't-configuracion', vlans: 't-vlan', redes_wifi: 't-wifi', enlaces_isp: 't-equipo' };
/** @type {Object<string, string>} */
const MODULO_COLECCION = { racks: 'racks', credenciales: 'credenciales', puestos: 'red', configuraciones: 'configuraciones', vlans: 'red', redes_wifi: 'red', enlaces_isp: 'red' };
/** @type {Object<string, (r: any) => string>} */
const NOMBRE_COLECCION = {
  racks: r => r.rack_nombre, credenciales: r => r.credencial_nombre, puestos: r => r.puesto_nombre, configuraciones: r => r.configuracion_titulo,
  vlans: r => 'VLAN ' + r.vlan_numero + ' · ' + r.vlan_nombre, redes_wifi: r => 'Wi-Fi ' + r.wifi_ssid, enlaces_isp: r => 'Enlace ' + r.enlace_proveedor
};
/** @type {Object<string, (r: any) => string>} */
const RUTA_COLECCION = {
  racks: r => '#/rack/' + r.id, credenciales: r => '#/credencial/' + r.id, puestos: r => '#/puesto/' + r.id, configuraciones: r => '#/config/' + r.id,
  vlans: r => '#/vlan/' + r.id, redes_wifi: r => '#/wifi/' + r.id, enlaces_isp: () => '#/red/isp'
};

/** Un puerto tiene «algo documentado» si está conectado, descrito o llega a un puesto. @param {any} p */
const tieneAlgo = p => !!(p.conectado_a_puerto_id || p.conectado_a_descripcion || p.puesto_id);

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  aplicarEstilos();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const org = sesion.organizacionActiva();
  const { segs } = partesHash();
  const destino = segs[1] || 'pendientes';
  const modoRack = destino !== 'pendientes';
  const raiz = await migasRaiz();

  const rack = modoRack ? await repositorio.obtener('racks', destino) : null;
  /** @type {Array<[string, string?]>} */
  const migas = raiz.concat(modoRack ? [['Racks', '#/racks'], [rack ? rack.rack_nombre : 'Rack', rack ? '#/rack/' + rack.id : undefined], ['Recorrido de verificación']] : [['Recorrido de verificación']]);
  pantalla(contenedor, { codigo: 'P19', nombre: 'Recorrido de verificación', migas });

  const modulos = /** @type {Array<'racks'|'servidores'|'red'|'credenciales'|'configuraciones'>} */ (['racks', 'servidores', 'red', 'credenciales', 'configuraciones']);
  const orgDe = rack ? rack.organizacion_id : org;
  if (!orgDe || !modulos.some(m => puede(u, 'verificar', m, orgDe))) {
    contenedor.appendChild(bloqueSinPermiso('Tu rol no confirma vigencia: el Recorrido de verificación es para quien puede modificar la documentación.'));
    return;
  }
  if (modoRack && !rack) {
    contenedor.appendChild(estadoVacio('No encontramos ese rack', 'Puede que se haya dado de baja. Elegí otro desde el listado.', 'rack', [h('a', { href: '#/racks', text: 'Ir a Racks' })]));
    return;
  }
  const orgId = /** @type {string} */ (orgDe);
  const umbrales = await repositorio.umbralesVerificacion();
  const items = modoRack && rack ? await armarPorRack(rack) : await armarPendientes(orgId, umbrales.viejo);

  /** Confirmados en esta sesión: clave → true. @type {Set<string>} */
  const hechos = new Set();
  /** @type {string|null} */
  let editando = null;
  /** @type {Map<string, HTMLElement>} */
  const filas = new Map();
  /** @param {Item} it */
  const estaHecho = it => hechos.has(it.clave) || diasDesde(it.registro.verificado_en) <= 0;
  /** @param {Item} it */
  const puedeItem = it => puede(u, 'verificar', it.modulo, orgId);

  // ---- cabecera con avance
  const textoAvance = h('b', { style: 'white-space:nowrap;font-size:17px' });
  const relleno = h('i');
  const barra = h('div', { class: 'rk-progreso', style: 'flex:1', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(items.length), 'aria-label': 'Avance del recorrido' }, [relleno]);
  const btnTodo = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'primario',
    title: 'Marca como vigente, con fecha de hoy, todo lo que no cambió y todavía no confirmaste', onclick: () => confirmarTodo() }));
  const pintarAvance = () => {
    const ok = items.filter(estaHecho).length, n = items.length;
    textoAvance.textContent = ok + ' de ' + n + ' confirmados';
    relleno.style.width = (n ? Math.round(ok / n * 100) : 0) + '%';
    barra.setAttribute('aria-valuenow', String(ok));
    const faltan = items.filter(it => !estaHecho(it) && puedeItem(it) && editando !== it.clave).length;
    btnTodo.textContent = 'Confirmar todo lo visto' + (faltan ? ' (' + faltan + ')' : '');
    btnTodo.disabled = !faltan;
  };
  const cabecera = h('div', { class: 'bloque ficha ' + (modoRack ? 't-rack' : 't-equipo') }, [
    h('div', { class: 'eyebrow' }, [icono('check'), 'recorrido de verificación']),
    h('div', { class: 'fila', style: 'align-items:center;margin:2px 0 8px' }, [h('h1', { style: 'flex:1', text: modoRack && rack ? 'Rack ' + rack.rack_nombre : 'Pendientes de verificar' }), btnTodo]),
    h('div', { class: 'mut', text: modoRack
      ? 'Estando frente al rack, andá de abajo hacia arriba: primero los equipos por unidad (U) y después los puertos documentados de cada switch y patchera. Tocá «Sigue igual» si todo coincide con lo documentado, o «Cambió» para corregirlo en el lugar.'
      : 'Lo que pasó a «viejo» (hace ' + umbrales.viejo + ' días o más sin confirmar). Tocá «Sigue igual» si coincide con la realidad, o «Cambió» para corregirlo en el lugar. Los equipos dados de baja no entran.' }),
    h('div', { style: 'display:flex;align-items:center;gap:12px;margin-top:10px' }, [textoAvance, barra])]);
  contenedor.appendChild(cabecera);

  if (!items.length) {
    contenedor.appendChild(h('div', { class: 'aviso', style: 'margin-top:10px' }, [
      h('div', { text: modoRack ? 'Este rack no tiene equipos ni puertos documentados para recorrer.' : 'No hay nada pendiente: todo lo documentado se verificó hace menos de ' + umbrales.viejo + ' días.' }),
      h('div', { style: 'margin-top:8px' }, [h('button', { type: 'button', text: modoRack ? 'Volver al rack' : 'Volver al inicio', onclick: () => ir(modoRack && rack ? '#/rack/' + rack.id : '#/inicio') })])]));
    pintarAvance();
    return;
  }

  // ---- pasos de verificación de cada elemento (D-055)
  /** @type {Map<string, string[]>} */
  const pasosItem = new Map();
  const conPasos = new Set();
  const plantillas = await leerPlantillas();
  for (const it of items) {
    const p = await pasosDe(it.coleccion, it.registro, plantillas), todos = p.tipo.concat(p.propios);
    if (todos.length) { pasosItem.set(it.clave, todos); conPasos.add(it.clave); }
  }

  // ---- lista
  const tbody = h('tbody');
  for (const it of items) { const tr = h('tr'); filas.set(it.clave, tr); tbody.appendChild(tr); pintarFila(it); }
  contenedor.appendChild(h('div', { style: 'margin-top:10px' }, [h('div', { class: 'rk-lista', tabindex: '0', 'aria-label': 'Elementos a recorrer' }, [
    h('table', null, [h('thead', null, [h('tr', null, ['Dónde', 'Elemento', 'Verificación', ''].map(t => h('th', { text: t })))]), tbody])])]));
  pintarAvance();

  // -------------------------------------------------------------------------------------------

  /** @param {Item} it */
  function pintarFila(it) {
    const tr = /** @type {HTMLElement} */ (filas.get(it.clave));
    tr.textContent = '';
    const hecho = estaHecho(it);
    tr.className = hecho ? 'rk-hecho' : '';
    if (editando === it.clave) { filaEdicion(it, tr); return; }
    tr.appendChild(h('td', { text: it.donde, style: 'white-space:nowrap;font-weight:600' }));
    tr.appendChild(h('td', null, [h('span', { class: 'rk-tag ' + it.tipo, text: it.etq }), it.ruta ? h('a', { href: it.ruta, text: it.nombre }) : it.nombre,
      it.nota ? h('div', { class: 'rk-celda-rotulo', text: it.nota }) : null,
      pasosItem.get(it.clave) ? h('div', { class: 'rk-celda-rotulo', text: 'Pasos: ' + /** @type {string[]} */ (pasosItem.get(it.clave)).join(' · ') }) : null]));
    tr.appendChild(h('td', null, [indicadorVerificacion(it.registro.verificado_en, umbrales, true)]));
    const acc = h('td', { style: 'white-space:nowrap;text-align:right' });
    if (hecho) acc.appendChild(h('span', { class: 'rk-ok' }, [icono('check'), 'Confirmado hoy']));
    else if (!puedeItem(it)) acc.appendChild(h('span', { class: 'verif-det', text: 'Tu rol no confirma ' + it.etq.toLowerCase() + 's' }));
    else {
      acc.appendChild(h('button', { type: 'button', class: 'chico primario', text: 'Sigue igual', title: 'Lo documentado coincide: verificado hoy, sin abrir formularios', onclick: () => sigueIgual(it) }));
      acc.appendChild(document.createTextNode(' '));
      acc.appendChild(h('button', { type: 'button', class: 'chico', text: 'Cambió', title: 'Corregirlo en el lugar; al guardar queda verificado hoy', onclick: () => { const previo = editando; editando = it.clave; if (previo) pintarFilaPorClave(previo); pintarFila(it); pintarAvance(); } }));
    }
    tr.appendChild(acc);
  }

  /** @param {string} clave */
  function pintarFilaPorClave(clave) { const it = items.find(x => x.clave === clave); if (it) pintarFila(it); }

  /** @param {Item} it */
  async function recargar(it) {
    const r = await repositorio.obtener(it.coleccion, it.id);
    if (r) it.registro = r;
  }

  /** @param {Item} it */
  async function sigueIgual(it) {
    try {
      if (!await confirmarConPasos(it.coleccion, it.id, u)) return;
      await recargar(it); hechos.add(it.clave); pintarFila(it); pintarAvance();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo confirmar.'); }
  }

  async function confirmarTodo() {
    let ok = 0, sin = 0, conPasosOmitidos = 0;
    btnTodo.disabled = true;
    for (const it of items) {
      if (estaHecho(it) || editando === it.clave) continue;
      if (!puedeItem(it)) { sin++; continue; }
      if (conPasos.has(it.clave)) { conPasosOmitidos++; continue; }
      try { await repositorio.confirmarVigente(it.coleccion, it.id, u.id); await recargar(it); hechos.add(it.clave); ok++; pintarFila(it); } catch { sin++; }
    }
    pintarAvance();
    toast(ok + (ok === 1 ? ' elemento confirmado' : ' elementos confirmados') + ' como vigentes · verificados hoy' + (sin ? ' · ' + sin + ' quedan para alguien con permiso' : '') + (conPasosOmitidos ? ' · ' + conPasosOmitidos + ' tienen pasos: confirmalos uno por uno' : ''));
  }

  /** @param {Item} it @param {HTMLElement} tr */
  function filaEdicion(it, tr) {
    /** @type {Array<[CampoDef, {leer: () => string}, HTMLElement]>} */
    const entradas = [];
    const campos = h('div', { class: 'rk-campos' });
    for (const f of it.campos) {
      const c = f.c ? (it.registro.equipo_campos || {})[f.k] : it.registro[f.k];
      const ent = crearCampo(f, c, 'rec-' + it.clave.replace(/[^a-z0-9]/gi, ''));
      entradas.push([f, ent, ent.caja]);
      campos.appendChild(h('div', null, [ent.caja]));
    }
    const error = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    const guardar = async () => {
      const falla = (/** @type {string} */ m) => { error.textContent = m; error.hidden = false; };
      const nuevo = structuredClone(it.registro);
      for (const [f, ent] of entradas) {
        let v = /** @type {any} */ (ent.leer());
        if (f.req && !v) return falla('Falta completar «' + f.etq + '».');
        if (v === '' ) v = null;
        else if (f.tipo === 'number') { if (!/^\d+$/.test(v)) return falla('«' + f.etq + '» tiene que ser un número entero.'); v = parseInt(v, 10); }
        if (f.k === 'equipo_ip_gestion' && v && !ipValida(v)) return falla('La IP de gestión no es válida (por ejemplo 10.10.20.21).');
        if (f.c) { nuevo.equipo_campos = nuevo.equipo_campos || {}; nuevo.equipo_campos[f.k] = v; } else nuevo[f.k] = v;
      }
      if (it.coleccion === 'equipos') {
        if (normalizar(nuevo.equipo_nombre) !== normalizar(it.registro.equipo_nombre)) {
          const rep = await repositorio.contar('equipos', e => e.organizacion_id === orgId && e.id !== it.id && normalizar(e.equipo_nombre) === normalizar(nuevo.equipo_nombre));
          if (rep) return falla('Ya existe un equipo llamado «' + nuevo.equipo_nombre + '».');
        }
        if (nuevo.rack_id && (nuevo.rack_u_inicio !== it.registro.rack_u_inicio || nuevo.rack_u_alto !== it.registro.rack_u_alto)) {
          const p = await validarLugarEnRack(nuevo.rack_id, nuevo.rack_u_inicio, nuevo.rack_u_alto, it.id);
          if (p) return falla(p);
        }
      }
      try {
        await repositorio.guardar(it.coleccion, nuevo, u.id);
        await repositorio.confirmarVigente(it.coleccion, it.id, u.id); // aunque no haya cambiado nada, lo viste
        await recargar(it);
        it.nombre = it.coleccion === 'equipos' ? it.registro.equipo_nombre : NOMBRE_COLECCION[it.coleccion] ? NOMBRE_COLECCION[it.coleccion](it.registro) : it.nombre;
        hechos.add(it.clave); editando = null;
        toast('«' + it.nombre + '» corregido y verificado hoy');
        pintarFila(it); pintarAvance();
      } catch (e) { falla(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    };
    tr.appendChild(h('td', { class: 'rk-edit', colspan: '4' }, [
      h('div', { style: 'font-weight:700;margin-bottom:6px', text: it.nombre + ' · ' + it.donde + ' — corregí lo que cambió (modo edición)' }),
      it.nota ? h('div', { class: 'rk-celda-rotulo', style: 'margin-bottom:6px', text: it.nota + (it.ruta ? ' · para cambiar la conexión, abrí su ficha.' : '') }) : null,
      campos, error,
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Guardar y confirmar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { editando = null; pintarFila(it); pintarAvance(); } }),
        it.ruta ? h('a', { href: it.ruta, text: 'Abrir su ficha' }) : null])]));
  }

  // -------------------------------------------------------------------------------------------
  // Armado de la lista
  // -------------------------------------------------------------------------------------------

  /** @param {any} e @param {Map<string, any>} racks @returns {Item} */
  function itemEquipo(e, racks) {
    const esServ = e.equipo_tipo === 'servidor';
    /** @type {CampoDef[]} */
    const campos = [{ k: 'equipo_nombre', etq: 'Nombre', req: true }, { k: 'equipo_ip_gestion', etq: 'IP de gestión' }];
    if (esServ) campos.push({ k: 'servidor_rol', c: true, etq: 'Rol', req: true }, { k: 'servidor_sistema_operativo', c: true, etq: 'Sistema operativo', req: true });
    campos.push({ k: 'equipo_estado', etq: 'Estado', tipo: 'select', opciones: OPC_ESTADO, req: true });
    if (e.rack_id) campos.push({ k: 'rack_u_inicio', etq: 'U de inicio', tipo: 'number', req: true }, { k: 'rack_u_alto', etq: 'Alto en U', tipo: 'number', req: true });
    campos.push({ k: 'equipo_notas', etq: 'Notas' });
    const r = e.rack_id ? racks.get(e.rack_id) : null;
    return { clave: 'equipos:' + e.id, coleccion: 'equipos', id: e.id, modulo: moduloEquipo(e), etq: esServ ? 'Servidor' : ROTULO_EQUIPO_TIPO[e.equipo_tipo] || 'Equipo',
      tipo: esServ ? 't-servidor' : e.equipo_tipo === 'ups' ? 't-rack' : 't-equipo', nombre: e.equipo_nombre, donde: r ? r.rack_nombre + ' · ' + rangoU(e) : 'Sin rack',
      ruta: rutaEquipo(e), registro: e, campos };
  }

  /** @param {any} p @param {any} eq @returns {Item} */
  function itemPuerto(p, eq) {
    /** @type {CampoDef[]} */
    const campos = [{ k: 'puerto_estado', etq: 'Estado', tipo: 'select', opciones: OPC_PUERTO, req: true }];
    if (!p.conectado_a_puerto_id) campos.push({ k: 'conectado_a_descripcion', etq: 'Va a (descripción)' });
    campos.push({ k: 'puerto_notas', etq: 'Notas' });
    return { clave: 'puertos:' + p.id, coleccion: 'puertos', id: p.id, modulo: 'red', etq: 'Puerto', tipo: 't-equipo', nombre: eq.equipo_nombre + ' · puerto ' + p.puerto_numero + (p.puerto_nombre ? ' (' + p.puerto_nombre + ')' : ''),
      donde: 'Puerto ' + p.puerto_numero, ruta: '#/equipo/' + eq.id + '/puertos/' + p.puerto_numero, registro: p, campos, nota: '' };
  }

  /** Completa a qué va cada puerto (texto de apoyo). @param {Item[]} lista */
  async function completarNotasPuertos(lista) {
    const cache = new Map();
    for (const it of lista) {
      if (it.coleccion !== 'puertos') continue;
      const p = it.registro;
      if (p.conectado_a_puerto_id) {
        if (!cache.has(p.conectado_a_puerto_id)) {
          const otro = await repositorio.obtener('puertos', p.conectado_a_puerto_id);
          const eq = otro ? await repositorio.obtener('equipos', otro.equipo_id) : null;
          cache.set(p.conectado_a_puerto_id, otro && eq ? eq.equipo_nombre + ' · puerto ' + otro.puerto_numero : null);
        }
        it.nota = 'Va a ' + (cache.get(p.conectado_a_puerto_id) || 'otro equipo');
      } else if (p.conectado_a_descripcion) it.nota = 'Va a ' + p.conectado_a_descripcion;
      else if (p.puesto_id) it.nota = 'Llega a un puesto de trabajo';
    }
  }

  /** @param {any} r @returns {Promise<Item[]>} */
  async function armarPorRack(r) {
    const [equipos, racks] = await Promise.all([repositorio.listar('equipos', { rack_id: r.id }, { ordenarPor: 'rack_u_inicio' }), Promise.resolve(new Map([[r.id, r]]))]);
    /** @type {Item[]} */
    const lista = equipos.map(e => itemEquipo(e, racks));
    for (const e of equipos) {
      if (e.equipo_tipo !== 'switch' && e.equipo_tipo !== 'patchera') continue;
      const puertos = await repositorio.listar('puertos', p => p.equipo_id === e.id && tieneAlgo(p), { ordenarPor: 'puerto_numero' });
      for (const p of puertos) lista.push(itemPuerto(p, e));
    }
    await completarNotasPuertos(lista);
    return lista;
  }

  /** @param {string} orgId2 @param {number} diasViejo @returns {Promise<Item[]>} */
  async function armarPendientes(orgId2, diasViejo) {
    const viejo = (/** @type {any} */ r) => diasDesde(r.verificado_en) > diasViejo;
    const [equipos, racks] = await Promise.all([repositorio.listar('equipos', e => e.organizacion_id === orgId2), repositorio.listar('racks', { organizacion_id: orgId2 })]);
    const racksMap = porId(racks);
    const eqMap = porId(equipos);
    /** @type {Item[]} */
    const lista = [];
    for (const e of equipos) if (e.equipo_estado !== 'baja' && viejo(e)) lista.push(itemEquipo(e, racksMap));
    const puertos = await repositorio.listar('puertos', p => eqMap.has(p.equipo_id) && viejo(p));
    for (const p of puertos) { const eq = eqMap.get(p.equipo_id); if (eq && eq.equipo_estado !== 'baja') lista.push(itemPuerto(p, eq)); }
    for (const col of Object.keys(CAMPOS_POR_COLECCION)) {
      const regs = await repositorio.listar(col, r => r.organizacion_id === orgId2 && viejo(r));
      for (const r of regs) lista.push({ clave: col + ':' + r.id, coleccion: col, id: r.id, modulo: /** @type {any} */ (MODULO_COLECCION[col]), etq: ETQ_COLECCION[col], tipo: TIPO_COLECCION[col],
        nombre: NOMBRE_COLECCION[col](r), donde: col === 'racks' ? 'Racks' : ETQ_COLECCION[col], ruta: RUTA_COLECCION[col](r), registro: r, campos: CAMPOS_POR_COLECCION[col] });
    }
    lista.sort((a, b) => a.registro.verificado_en < b.registro.verificado_en ? -1 : a.registro.verificado_en > b.registro.verificado_en ? 1 : a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    await completarNotasPuertos(lista);
    return lista;
  }
}
