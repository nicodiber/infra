// @ts-check
/**
 * P30 · Ficha de tramo de fibra (`#/tramo/<id|nuevo>[/<pestaña>]`): datos con edición en el lugar (D-037), «Confirmar vigente» con pasos,
 * baja, y pestañas Pelos (uso de cada pelo), Mediciones (atenuación), Historial y, si existen, Relaciones y Archivos.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir, toast, abrirModal, cerrarModal, repintarMarco } from '../assets/js/marco.js';
import { abrirAlta, selectorConCrear, opcionesDe } from '../assets/js/altas.js';
import { h, tabla, fmtFecha, fmtFechaHora, hoyISO } from '../assets/js/utiles.js';
import { ROTULO_FIBRA_TIPO, CONECTORES_FIBRA, ATENUACION_ALTA_DB } from '../assets/js/modelos.js';
import { cargarContexto, encabezado, avisoVista, fichaCab, campo, pestanas, leerRuta, textoUltimoCambio, seguro, enlace, pedirBaja } from '../assets/js/red.js';
import { pelosConAtenuacionAlta, ultimasMediciones, textoDb } from './fibra.view.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  const ctx = await cargarContexto();
  const { partes } = leerRuta();
  const idHash = partes[0] || '';
  const nuevo = idHash === 'nuevo';
  let tab = ['pelos', 'mediciones', 'historial', 'relaciones', 'archivos'].includes(partes[1]) ? partes[1] : 'pelos';
  let org = ctx.org;
  /** @type {any} */ let t = null;
  const migasBase = /** @type {Array<[string, string?]>} */ ([['Red', '#/red/equipos'], ['Fibra', '#/fibra']]);
  if (!nuevo) {
    t = await repositorio.obtener('tramos_fibra', idHash);
    if (!t) {
      await encabezado(contenedor, 'P30', 'Ficha de tramo de fibra', migasBase.concat([['No encontrado']]));
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Ese tramo no existe o fue dado de baja.' }), h('div', { style: 'margin-top:8px' }, [enlace('Volver a Fibra', '#/fibra')])]));
      return;
    }
    org = t.organizacion_id;
  }
  if (!puede(ctx.u, nuevo ? 'modificar' : 'ver', 'red', org)) {
    await encabezado(contenedor, 'P30', 'Ficha de tramo de fibra', migasBase.concat([['Sin acceso']]));
    avisoVista(contenedor, nuevo ? 'Tu rol no puede cargar tramos de fibra.' : 'Tu rol no tiene acceso al módulo Red.');
    return;
  }
  if (nuevo) { // el alta es el formulario completo de `altas/tramos_fibra.js`; esta ruta solo la abre
    const creado = await abrirAlta('tramos_fibra', { organizacion_id: org, rotulo: null });
    ir(creado ? '#/tramo/' + creado.id : '#/fibra');
    return;
  }
  /** @type {Map<string, any>} */ const ubPor = new Map();
  /** @type {Map<string, any>} */ const eqPor = new Map();
  /** Recarga sedes/salas y patcheras: algo creado con «+ Crear nuevo» durante la edición tiene que verse en la ficha al guardar. */
  const cargarMapas = async () => {
    const [ubicaciones, patcheras] = await Promise.all([repositorio.listar('ubicaciones', { organizacion_id: org }, { ordenarPor: 'ubicacion_nombre' }),
      repositorio.listar('equipos', { organizacion_id: org, equipo_tipo: 'patchera' }, { ordenarPor: 'equipo_nombre' })]);
    ubPor.clear(); eqPor.clear();
    for (const x of ubicaciones) ubPor.set(x.id, x);
    for (const x of patcheras) eqPor.set(x.id, x);
  };
  await cargarMapas();
  const nomUb = (/** @type {string|null} */ id) => (id && ubPor.get(id) ? ubPor.get(id).ubicacion_nombre : '—');

  let editando = nuevo;
  let editaPelo = 0;
  /** @type {any} */ let ed = null;
  let error = '';
  const iniciarEd = () => {
    ed = t ? { nombre: t.tramo_nombre, origen: t.tramo_origen_ubicacion_id, destino: t.tramo_destino_ubicacion_id, oeq: t.tramo_origen_equipo_id || '', deq: t.tramo_destino_equipo_id || '',
      pelos: String(t.tramo_pelos), tipo: t.tramo_tipo, conector: t.tramo_conector, longitud: t.tramo_longitud_m != null ? String(t.tramo_longitud_m) : '' }
      : { nombre: '', origen: '', destino: '', oeq: '', deq: '', pelos: '12', tipo: 'monomodo', conector: 'LC', longitud: '' };
  };
  if (editando) iniciarEd();

  /** @param {any} cambios */
  const guardarTramo = async cambios => repositorio.guardar('tramos_fibra', { ...(t || { organizacion_id: org, tramo_pelos_usados: [], tramo_mediciones: [] }), ...cambios }, ctx.u.id);
  const rerender = async () => { t = (await repositorio.obtener('tramos_fibra', t.id)) || t; await cargarMapas(); await pintar(); };

  async function pintar() {
    contenedor.textContent = '';
    const titulo = nuevo ? 'Nuevo tramo de fibra' : t.tramo_nombre;
    await encabezado(contenedor, 'P30', 'Ficha de tramo de fibra', migasBase.concat([[titulo]]));
    const datos = h('div', { class: 'datos' });
    if (editando) {
      const inp = (/** @type {string} */ k, /** @type {string} */ et, /** @type {string} */ tipo, /** @type {Object<string,string>} */ extra) => {
        const i = /** @type {HTMLInputElement} */ (h('input', { type: tipo, value: ed[k], 'aria-label': et, ...(extra || {}) }));
        i.addEventListener('input', () => { ed[k] = i.value; });
        return i;
      };
      const sel = (/** @type {string} */ k, /** @type {string} */ et, /** @type {Array<[string, string]>} */ ops) => {
        const s = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': et }, ops.map(([v, r]) => h('option', { value: v, text: r, selected: v === ed[k] ? 'selected' : null }))));
        s.addEventListener('change', () => { ed[k] = s.value; });
        return s;
      };
      /** Referencia con «+ Crear …»: sede o sala, o patchera. */
      const ref = (/** @type {string} */ k, /** @type {string} */ campo, /** @type {string} */ et, /** @type {boolean} */ esPatchera) => selectorConCrear({ desde: 'tramos_fibra', campo, organizacion_id: org, valor: ed[k] || null,
        obligatorio: !esPatchera, etiqueta: et, rotuloOrigen: 'Editar tramo de fibra',
        ...(esPatchera ? { cargarOpciones: () => opcionesDe('equipos', org, { filtro: e => e.equipo_tipo === 'patchera' }), valoresAlta: { equipo_tipo: 'patchera', tipos: ['patchera'] } } : {}),
        alCambiar: v => { ed[k] = v; } });
      datos.append(campo('Nombre', inp('nombre', 'Nombre', 'text', { maxlength: '120' })), campo('Origen (sede / sala)', ref('origen', 'tramo_origen_ubicacion_id', 'Origen', false)), campo('Patchera de origen', ref('oeq', 'tramo_origen_equipo_id', 'Patchera de origen', true)),
        campo('Destino (sede / sala)', ref('destino', 'tramo_destino_ubicacion_id', 'Destino', false)), campo('Patchera de destino', ref('deq', 'tramo_destino_equipo_id', 'Patchera de destino', true)),
        campo('Cantidad de pelos', inp('pelos', 'Cantidad de pelos', 'number', { min: '1', step: '1' })),
        campo('Tipo de fibra', sel('tipo', 'Tipo de fibra', Object.keys(ROTULO_FIBRA_TIPO).map(k => /** @type {[string, string]} */ ([k, ROTULO_FIBRA_TIPO[k]])))),
        campo('Conector', sel('conector', 'Conector', CONECTORES_FIBRA.map(c => /** @type {[string, string]} */ ([c, c])))),
        campo('Longitud (m)', inp('longitud', 'Longitud en metros', 'number', { min: '0', step: 'any' })));
      if (error) datos.appendChild(h('div', { class: 'msg mal', role: 'alert', style: 'grid-column:1/-1', text: error }));
    } else {
      const pel = (/** @type {string|null} */ id) => { const e = id ? eqPor.get(id) : null; return e ? h('a', { href: '#/equipo/' + e.id, text: e.equipo_nombre }) : '—'; };
      const usados = (t.tramo_pelos_usados || []).length;
      datos.append(campo('Origen', nomUb(t.tramo_origen_ubicacion_id)), campo('Patchera de origen', pel(t.tramo_origen_equipo_id)),
        campo('Destino', nomUb(t.tramo_destino_ubicacion_id)), campo('Patchera de destino', pel(t.tramo_destino_equipo_id)),
        campo('Pelos', usados + ' usados · ' + (t.tramo_pelos - usados) + ' libres · ' + t.tramo_pelos + ' en total'),
        campo('Tipo y conector', ROTULO_FIBRA_TIPO[t.tramo_tipo] + ' · ' + t.tramo_conector),
        campo('Longitud', t.tramo_longitud_m != null ? String(t.tramo_longitud_m).replace('.', ',') + ' m' : null));
    }
    const guardar = async () => {
      const pelos = Number(ed.pelos), lon = ed.longitud === '' ? null : Number(ed.longitud);
      if (!ed.nombre.trim()) { error = 'Escribí el nombre del tramo.'; await pintar(); return; }
      if (!ed.origen || !ed.destino) { error = 'Elegí el origen y el destino.'; await pintar(); return; }
      if (!Number.isInteger(pelos) || pelos < 1) { error = 'La cantidad de pelos tiene que ser un entero de 1 o más.'; await pintar(); return; }
      if (lon != null && !(lon >= 0)) { error = 'La longitud tiene que ser un número positivo.'; await pintar(); return; }
      try {
        const g = await guardarTramo({ tramo_nombre: ed.nombre.trim(), tramo_origen_ubicacion_id: ed.origen, tramo_destino_ubicacion_id: ed.destino, tramo_origen_equipo_id: ed.oeq || null,
          tramo_destino_equipo_id: ed.deq || null, tramo_pelos: pelos, tramo_tipo: ed.tipo, tramo_conector: ed.conector, tramo_longitud_m: lon });
        toast(nuevo ? 'Tramo creado' : 'Cambios guardados · verificado hoy (' + fmtFecha(hoyISO()) + ')');
        ed = null; error = '';
        if (nuevo) { ir('#/tramo/' + g.id); return; }
        editando = false; await rerender();
      } catch (e) { error = e instanceof Error ? e.message : 'No se pudo guardar.'; await pintar(); }
    };
    /** @type {Node[]} */
    const botones = [];
    if (editando) botones.push(h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
      h('button', { type: 'button', text: 'Cancelar', onclick: () => { ed = null; error = ''; if (nuevo) ir('#/fibra'); else { editando = false; pintar(); } } }));
    else {
      if (ctx.modifica) botones.push(h('button', { type: 'button', text: 'Editar', onclick: () => { iniciarEd(); error = ''; editando = true; pintar(); } }));
      if (ctx.baja || ctx.pideBaja) botones.push(await botonBajaTramo());
    }
    if (nuevo) {
      contenedor.appendChild(h('div', { class: 'bloque t-vlan' }, [h('div', { class: 'fila', style: 'align-items:center;margin-bottom:10px' }, [h('h1', { style: 'flex:1', text: titulo }), h('div', { class: 'herr', style: 'margin:0' }, botones)]), datos]));
      return;
    }
    contenedor.appendChild(fichaCab({ ctx, tipo: 'vlan', etiqueta: 'fibra óptica', titulo, datos, botones, editando, registro: t, coleccion: 'tramos_fibra',
      ultimoCambio: await textoUltimoCambio(ctx, 'TramoFibra', t), alConfirmar: () => rerender() }));
    if (editando) return;

    const alta = pelosConAtenuacionAlta(t);
    if (alta.length) contenedor.appendChild(h('div', { class: 'msg mal', role: 'status', style: 'margin-top:8px', text: 'Atenuación alta en ' + (alta.length > 1 ? 'los pelos ' : 'el pelo ') + alta.join(', ') + ' (última medición desde ' + textoDb(ATENUACION_ALTA_DB) + '). Revisá los conectores y empalmes.' }));

    /** @type {Array<[string, string]>} */
    const tabs = [['pelos', 'Pelos'], ['mediciones', 'Mediciones']];
    if (ctx.historial) tabs.push(['historial', 'Historial']);
    const extra = await modulosExtra();
    if (extra.relaciones) tabs.push(['relaciones', 'Relaciones']);
    if (extra.archivos) tabs.push(['archivos', 'Archivos']);
    if (!tabs.some(x => x[0] === tab)) tab = 'pelos';
    const barra = pestanas(tabs, tab, k => '#/tramo/' + t.id + (k === 'pelos' ? '' : '/' + k));
    barra.style.margin = '10px 0 8px';
    contenedor.appendChild(barra);
    const cuerpo = h('div');
    contenedor.appendChild(cuerpo);
    if (tab === 'pelos') pestanaPelos(cuerpo);
    else if (tab === 'mediciones') pestanaMediciones(cuerpo);
    else if (tab === 'historial') await pestanaHistorial(cuerpo);
    else if (tab === 'relaciones' && extra.relaciones) await seguro(() => extra.relaciones.pintarRelaciones(cuerpo, { entidad: 'TramoFibra', entidadId: t.id, organizacionId: org }));
    else if (tab === 'archivos' && extra.archivos) await seguro(() => extra.archivos.pintarArchivos(cuerpo, { entidad: 'TramoFibra', entidadId: t.id, organizacionId: org }));
  }

  /** Baja directa o pedido de baja. */
  async function botonBajaTramo() {
    const directa = ctx.baja;
    return h('button', { type: 'button', text: directa ? 'Dar de baja' : 'Pedir la baja', onclick: async () => {
      if (!directa) { await seguro(async () => { await pedirBaja(ctx, 'tramos_fibra', t.id); await rerender(); }); return; }
      abrirModal(h('div', { role: 'dialog', 'aria-label': 'Dar de baja' }, [h('h2', { text: '¿Dar de baja «' + t.tramo_nombre + '»?' }),
        h('p', { class: 'mut', text: 'Deja de aparecer en la fibra. Queda en el historial y se puede restaurar.' }),
        h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Sí, dar de baja', onclick: async () => {
          const ok = await seguro(() => repositorio.darDeBaja('tramos_fibra', t.id, { usuarioId: ctx.u.id, motivo: 'Baja' }));
          if (ok) { cerrarModal(); toast('Dado de baja: ' + t.tramo_nombre); await repintarMarco(); ir('#/fibra'); }
        } }), h('button', { type: 'button', text: 'Cancelar', onclick: cerrarModal })])]));
    } });
  }

  /** Relaciones y Archivos, si el otro módulo ya existe. @returns {Promise<{relaciones: any, archivos: any}>} */
  async function modulosExtra() {
    /** @type {any} */ let relaciones = null, archivos = null;
    try { const m = await import('../assets/js/relaciones.js'); if (typeof m.pintarRelaciones === 'function') relaciones = m; } catch { /* todavía no existe */ }
    try { const m = await import('../assets/js/archivos.js'); if (typeof m.pintarArchivos === 'function') archivos = m; } catch { /* todavía no existe */ }
    return { relaciones, archivos };
  }

  /** @param {HTMLElement} cuerpo */
  function pestanaPelos(cuerpo) {
    const usos = new Map((t.tramo_pelos_usados || []).map((/** @type {any} */ u) => [u.pelo, u.uso]));
    const ult = ultimasMediciones(t);
    const usados = usos.size;
    cuerpo.appendChild(h('div', { class: 'mut', text: usados + ' de ' + t.tramo_pelos + ' pelos en uso · ' + (t.tramo_pelos - usados) + ' libres.' + (ctx.modifica ? ' Usá «Editar uso» para anotar qué lleva cada pelo o liberarlo.' : '') }));
    const grilla = h('div', { class: 'fb-pelos' });
    for (let n = 1; n <= t.tramo_pelos; n++) {
      const uso = usos.get(n), m = ult.get(n), esAlta = !!m && m.atenuacion_db >= ATENUACION_ALTA_DB;
      grilla.appendChild(h('div', { class: 'fb-pelo ' + (uso != null ? 'usado' : 'libre') + (esAlta ? ' alta' : '') }, [
        h('div', null, [h('b', { text: 'Pelo ' + n }), ' · ', uso != null ? 'Usado' : 'Libre', esAlta ? h('span', { class: 'fb-tag', style: 'margin-left:6px', text: 'Atenuación alta' }) : null]),
        h('div', { text: uso != null ? String(uso) : 'Sin uso asignado' }),
        m ? h('div', { class: 'mut', style: 'font-size:12px', text: 'Última medición: ' + textoDb(m.atenuacion_db) + ' (' + fmtFecha(m.fecha) + ')' }) : null,
        ctx.modifica ? h('button', { type: 'button', class: 'chico acc', text: uso != null ? 'Editar uso' : 'Asignar uso', onclick: () => abrirUso(n, uso != null ? String(uso) : '') }) : null]));
    }
    cuerpo.appendChild(grilla);
    cuerpo.appendChild(h('details', { style: 'margin-top:10px' }, [h('summary', { text: 'Ver como tabla' }),
      tabla(['Pelo', 'Estado', 'Uso'], Array.from({ length: t.tramo_pelos }, (_, i) => [String(i + 1), usos.has(i + 1) ? 'Usado' : 'Libre', usos.has(i + 1) ? String(usos.get(i + 1)) : '—']), { clase: 'chica' })]));
  }

  /** @param {number} n @param {string} actual */
  function abrirUso(n, actual) {
    editaPelo = n;
    const i = /** @type {HTMLInputElement} */ (h('input', { value: actual, 'aria-label': 'Uso del pelo ' + n, placeholder: 'Ej.: Troncal core ↔ switch (Tx). Vacío = libre', style: 'width:100%', maxlength: '160' }));
    const msg = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    const ir_ = async () => {
      const resto = (t.tramo_pelos_usados || []).filter((/** @type {any} */ u) => u.pelo !== n);
      const uso = i.value.trim();
      if (uso) resto.push({ pelo: n, uso });
      resto.sort((/** @type {any} */ a, /** @type {any} */ b) => a.pelo - b.pelo);
      try { await guardarTramo({ tramo_pelos_usados: resto }); cerrarModal(); toast(uso ? 'Pelo ' + n + ' asignado' : 'Pelo ' + n + ' liberado'); await rerender(); }
      catch (e) { msg.textContent = e instanceof Error ? e.message : 'No se pudo guardar.'; msg.hidden = false; }
    };
    i.addEventListener('keydown', e => { if (e.key === 'Enter') ir_(); });
    abrirModal(h('div', { role: 'dialog', 'aria-label': 'Uso del pelo ' + editaPelo }, [h('h2', { text: 'Pelo ' + n + ' de ' + t.tramo_pelos }),
      h('p', { class: 'mut', text: 'Anotá qué lleva este pelo. Si lo dejás vacío, queda libre.' }), i, msg,
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: ir_ }), h('button', { type: 'button', text: 'Cancelar', onclick: cerrarModal })])]));
    i.focus();
  }

  /** @param {HTMLElement} cuerpo */
  function pestanaMediciones(cuerpo) {
    const ms = (t.tramo_mediciones || []).map((/** @type {any} */ m, /** @type {number} */ i) => ({ ...m, i })).sort((/** @type {any} */ a, /** @type {any} */ b) => String(b.fecha).localeCompare(String(a.fecha)) || a.pelo - b.pelo);
    cuerpo.appendChild(h('div', { class: 'herr' }, [h('span', { class: 'mut', style: 'flex:1', text: ms.length + ' medición(es). Se señalan las de ' + textoDb(ATENUACION_ALTA_DB) + ' o más.' }),
      ctx.modifica ? h('button', { type: 'button', class: 'primario', text: 'Agregar medición', onclick: abrirMedicion }) : null]));
    if (!ms.length) { cuerpo.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Este tramo todavía no tiene mediciones de atenuación.' }), ctx.modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Usá «Agregar medición» para cargar la primera.' }) : null])); return; }
    const tb = tabla(['Fecha', 'Pelo', 'Atenuación', 'Observaciones'], ms.map((/** @type {any} */ m) => [fmtFecha(m.fecha), String(m.pelo),
      m.atenuacion_db >= ATENUACION_ALTA_DB ? h('span', null, [textoDb(m.atenuacion_db) + ' ', h('span', { class: 'fb-tag', text: 'Alta' })]) : textoDb(m.atenuacion_db), m.observaciones || '—']));
    Array.from(tb.querySelectorAll('tbody tr')).forEach((tr, k) => { if (ms[k].atenuacion_db >= ATENUACION_ALTA_DB) tr.classList.add('fb-alta'); });
    cuerpo.appendChild(tb);
  }

  function abrirMedicion() {
    const fecha = /** @type {HTMLInputElement} */ (h('input', { type: 'date', value: hoyISO(), max: hoyISO(), 'aria-label': 'Fecha' }));
    const pelo = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Pelo' }, Array.from({ length: t.tramo_pelos }, (_, i) => h('option', { value: String(i + 1), text: 'Pelo ' + (i + 1) }))));
    const at = /** @type {HTMLInputElement} */ (h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Atenuación en dB', placeholder: 'Ej.: 0,45' }));
    const obs = /** @type {HTMLInputElement} */ (h('input', { 'aria-label': 'Observaciones', maxlength: '300', style: 'width:100%' }));
    const msg = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    const falla = (/** @type {string} */ x) => { msg.textContent = x; msg.hidden = false; };
    abrirModal(h('div', { role: 'dialog', 'aria-label': 'Agregar medición' }, [h('h2', { text: 'Agregar medición' }),
      h('div', { class: 'datos' }, [campo('Fecha', fecha), campo('Pelo', pelo), campo('Atenuación (dB)', at), campo('Observaciones (opcional)', obs)]), msg,
      h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: async () => {
        const v = Number(at.value.trim().replace(',', '.'));
        if (!fecha.value) return falla('Indicá la fecha de la medición.');
        if (at.value.trim() === '' || !Number.isFinite(v) || v < 0) return falla('Escribí la atenuación en dB (un número, por ejemplo 0,45).');
        try {
          await guardarTramo({ tramo_mediciones: (t.tramo_mediciones || []).concat([{ fecha: fecha.value, pelo: Number(pelo.value), atenuacion_db: v, observaciones: obs.value.trim() || null }]) });
          cerrarModal(); toast('Medición guardada' + (v >= ATENUACION_ALTA_DB ? ' · atenuación alta' : '')); tab = 'mediciones'; history.replaceState(null, '', '#/tramo/' + t.id + '/mediciones'); await rerender();
        } catch (e) { falla(e instanceof Error ? e.message : 'No se pudo guardar.'); }
      } }), h('button', { type: 'button', text: 'Cancelar', onclick: cerrarModal })])]));
  }

  /** @param {HTMLElement} cuerpo */
  async function pestanaHistorial(cuerpo) {
    const cambios = await repositorio.listar('cambios', c => c.entidad_id === t.id && c.cambio_entidad === 'TramoFibra', { ordenarPor: 'cambio_fecha', descendente: true });
    if (!cambios.length) { cuerpo.appendChild(h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' })); return; }
    /** @type {Object<string, string>} */
    const ROT = { tramo_nombre: 'Nombre', tramo_origen_ubicacion_id: 'Origen', tramo_destino_ubicacion_id: 'Destino', tramo_origen_equipo_id: 'Patchera de origen', tramo_destino_equipo_id: 'Patchera de destino',
      tramo_pelos: 'Pelos', tramo_tipo: 'Tipo de fibra', tramo_conector: 'Conector', tramo_longitud_m: 'Longitud (m)', tramo_pelos_usados: 'Uso de los pelos', tramo_mediciones: 'Mediciones' };
    const usuarios = new Map((await repositorio.listar('usuarios', null, { incluirBajas: true })).map(x => [x.id, x.usuario_nombre]));
    /** @param {string|null} json @param {string} campoK */
    const val = (json, campoK) => {
      if (json == null) return '—';
      let v; try { v = JSON.parse(json); } catch { v = json; }
      if (v == null || v === '') return '—';
      if (Array.isArray(v)) return campoK === 'tramo_pelos_usados' ? v.length + ' pelos en uso' : v.length + ' mediciones';
      if (campoK === 'tramo_tipo') return ROTULO_FIBRA_TIPO[v] || String(v);
      if (/ubicacion_id$/.test(campoK)) return nomUb(v);
      if (/equipo_id$/.test(campoK)) return eqPor.get(v) ? eqPor.get(v).equipo_nombre : '(patchera dada de baja)';
      return String(v).length > 70 ? String(v).slice(0, 67) + '…' : String(v);
    };
    cuerpo.appendChild(tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(x => {
      const op = x.cambio_operacion;
      const quien = usuarios.get(x.usuario_id) || '?';
      if (op !== 'modificacion') return [fmtFechaHora(x.cambio_fecha), quien, op === 'alta' ? 'Alta' : op === 'baja' ? 'Baja' : 'Restauración', '—', op === 'alta' ? 'Creado' : '—'];
      return [fmtFechaHora(x.cambio_fecha), quien, ROT[x.cambio_campo] || String(x.cambio_campo), val(x.cambio_valor_anterior, x.cambio_campo), val(x.cambio_valor_nuevo, x.cambio_campo)];
    })));
  }

  await pintar();
}
