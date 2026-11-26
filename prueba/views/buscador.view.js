// @ts-check
/**
 * P04 · Buscador (CU03, CU04, CU04b, H04, H05). Identidad de la opción C: filtros a la vista, un color por tipo de
 * dato, resultados agrupados con «Cambió el…», vista previa al costado (D-022 a D-026).
 * Busca en todas las organizaciones que el rol puede ver (D-019). NUNCA busca ni muestra secretos: en una
 * credencial, «Copiar» y «Mostrar» solo existen si `puedeVerSecreto`; si no, se pide acceso.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede, puedeVerSecreto, puedePedirSecreto } from '../assets/js/permisos.js';
import { abrirModal, cerrarModal, ir, repintarMarco, toast } from '../assets/js/marco.js';
import { h, icono, resaltar, normalizar, fmtFechaHora, fmtFecha, indicadorVerificacion } from '../assets/js/utiles.js';

/** @typedef {import('../assets/js/repositorio.js').ResultadoBusqueda} ResultadoBusqueda */

/** @type {Object<string, string>} */
const ROTULO_TIPO_RESULTADO = {
  Equipos: 'Equipo', Puertos: 'Puerto de un equipo', Servidores: 'Servidor', Puestos: 'Puesto de trabajo', Racks: 'Rack', Configuraciones: 'Configuración',
  Credenciales: 'Credencial', 'Red (VLAN y Wi-Fi)': 'VLAN, Wi-Fi o enlace', 'Sedes y salas': 'Sede o sala'
};
const EJEMPLOS = ['ilo srv', 'vpn admin', '10.10.10.', 'wifi'];
const TOPE_POR_GRUPO = 40;
const TOPE_POR_GRUPO_VACIO = 6;
const SEGUNDOS_VISIBLE = 10;

/** Ruta de la ficha de un resultado (las fichas llegan en próximas entregas: hoy abren un estado vacío claro). @param {ResultadoBusqueda} r */
function rutaDe(r) {
  switch (r.coleccion) {
    case 'equipos': return (r.tipo === 'servidor' ? '#/servidor/' : '#/equipo/') + r.id;
    case 'credenciales': return '#/credencial/' + r.id;
    case 'racks': return '#/rack/' + r.id;
    case 'configuraciones': return '#/config/' + r.id;
    case 'vlans': return '#/vlan/' + r.id;
    case 'redes_wifi': return '#/wifi/' + r.id;
    case 'puestos': return '#/puesto/' + r.id;
    case 'ubicaciones': return '#/ubicacion/' + r.id;
    case 'puertos': return '#/equipo/' + r.equipo_id + '/puertos/' + r.puerto_numero;
    case 'personas': return '#/persona/' + r.id;
    case 'cuentas_dominio': return '#/cuenta/' + r.id;
    case 'licencias': return '#/licencia/' + r.id;
    case 'mapeos_disco': return '#/mapeo/' + r.id;
    case 'notas': return '#/notas/' + r.id;
    case 'enlaces_isp': return '#/red/isp';
    default: return r.ruta || '#/inicio';
  }
}

/** Ícono de un tipo de resultado: las sedes y salas usan el del edificio; el Wi-Fi, el suyo. @param {string} tipo */
const iconoDe = tipo => icono(tipo === 'ubicacion' ? 'edificio' : tipo);

/** Avisa a las métricas (D-080) sin importarlas. @param {string} tipo @param {Object} detalle */
const metrica = (tipo, detalle) => { try { window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo, detalle } })); } catch { /* nada */ } };

/** Cómo se abrió el buscador: se anota el último Ctrl K o clic en «Buscar» (por si app.js no lo informa). */
let origenAbierto = { como: 'desconocido', cuando: 0 };
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') origenAbierto = { como: 'ctrl_k', cuando: Date.now() }; }, true);
document.addEventListener('click', e => { if (e.target instanceof Element && e.target.closest('#btnBuscar')) origenAbierto = { como: 'boton', cuando: Date.now() }; }, true);

/**
 * Estado de la búsqueda abierta para las métricas.
 * @type {{t0: number, q: string, qEnviado: string, resultados: number, filtros: Object, elegido: boolean, temporizador: number}|null}
 */
let estadoMetrica = null;

/** Envía `busqueda_texto` si el texto cambió desde el último envío. */
function enviarTextoBusqueda() {
  const m = estadoMetrica;
  if (!m) return;
  clearTimeout(m.temporizador);
  if (m.q === m.qEnviado) return;
  m.qEnviado = m.q;
  metrica('busqueda_texto', { texto: m.q, resultados: m.resultados, filtros: m.filtros });
}

/** Al cerrarse la ventana: si no se eligió nada, `busqueda_cerrada`. */
function cerroBuscador() {
  const m = estadoMetrica;
  if (!m) return;
  enviarTextoBusqueda();
  estadoMetrica = null;
  if (!m.elegido) metrica('busqueda_cerrada', { texto: m.q, resultados: m.resultados, ms: Math.round(performance.now() - m.t0) });
}

/** Abre el buscador superpuesto (botón «Buscar» o Ctrl K) desde cualquier pantalla. */
export async function abrirBuscador() {
  if (!sesion.usuarioActual()) return;
  const caja = h('div');
  const como = Date.now() - origenAbierto.cuando < 1500 ? origenAbierto.como : 'desconocido';
  estadoMetrica = { t0: performance.now(), q: '', qEnviado: '', resultados: 0, filtros: {}, elegido: false, temporizador: 0 };
  await renderVistaBuscador(caja);
  if (estadoMetrica) estadoMetrica.t0 = performance.now();
  metrica('busqueda_abierta', { como });
  abrirModal(caja, cerroBuscador);
  const campo = caja.querySelector('input[role=combobox]');
  if (campo) /** @type {HTMLInputElement} */ (campo).focus();
}

/** @param {HTMLElement} contenedor */
export async function renderVistaBuscador(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const esSuper = puede(u, 'cambiar_organizacion');
  const [orgsTodas, umbrales, misPedidos] = await Promise.all([
    repositorio.listar('organizaciones', null, { ordenarPor: 'organizacion_nombre' }),
    repositorio.umbralesVerificacion(),
    repositorio.listar('solicitudes', s => s.solicitado_por === u.id && s.solicitud_tipo === 'ver_secreto' && s.solicitud_estado === 'pendiente')]);
  const orgsDisp = esSuper ? orgsTodas : orgsTodas.filter(o => o.id === u.organizacion_id);
  /** @type {Map<string, string>} credencial_id → fecha del pedido pendiente */
  const pedidosPendientes = new Map(misPedidos.map(s => [s.solicitud_entidad_id, s.solicitado_en]));

  /** Si hay una organización abierta, se ofrece como filtro activado (D-019). */
  const orgAbierta = esSuper ? sesion.organizacionActiva() : null;
  const busq = { q: '', tiposOff: /** @type {Set<string>} */ (new Set()), org: /** @type {string|null} */ (orgAbierta), idx: 0 };
  let token = 0;
  /** @type {ResultadoBusqueda[]} */
  let plano = [];
  /** @type {HTMLElement[]} */
  let els = [];
  /** @type {string[]} */
  let palabras = [];
  /** @type {number} */
  let temporizador = 0;

  const campoQ = /** @type {HTMLInputElement} */ (h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Buscá un equipo, una IP, un usuario, una VLAN…',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'lista', 'aria-autocomplete': 'list', 'aria-label': 'Buscar' }));
  const chipOrgCont = h('span');
  const ejemplos = h('div', { class: 'ejemplos' }, [h('span', { text: 'Probá con' })].concat(EJEMPLOS.map(q =>
    h('button', { type: 'button', class: 'chip-ej', text: q, onclick: () => { busq.q = q; campoQ.value = q; busq.idx = 0; campoQ.focus(); refrescar(false); if (estadoMetrica) { estadoMetrica.q = q; clearTimeout(estadoMetrica.temporizador); estadoMetrica.temporizador = window.setTimeout(enviarTextoBusqueda, 800); } } }))));
  const fTipos = h('div');
  const fOrgs = h('div', { role: 'radiogroup', 'aria-label': 'Organización' });
  const btnQuitar = h('button', { type: 'button', class: 'btn-quitar', text: 'Quitar filtros', hidden: 'hidden' });
  const resumen = h('div', { class: 'resumen', 'aria-live': 'polite' });
  const lista = h('div', { id: 'lista', role: 'listbox', 'aria-label': 'Resultados de búsqueda' });
  const colRes = h('section', { class: 'col-b col-res', 'aria-label': 'Resultados' }, [resumen, lista]);
  const preview = h('aside', { class: 'col-b col-prev', 'aria-label': 'Vista previa' });

  /** @type {Object<string, {input: HTMLInputElement, cant: HTMLElement, fila: HTMLElement}>} */
  const filtroTipo = {};
  for (const g of repositorio.GRUPOS_BUSQUEDA) {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: 'checked' }));
    const cant = h('span', { class: 'cant', text: '–' });
    input.addEventListener('change', () => { if (input.checked) busq.tiposOff.delete(g.nombre); else busq.tiposOff.add(g.nombre); refrescar(true); });
    const fila = h('label', { class: 'f-fila t-' + g.tipo }, [input, h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', { class: 'nom', text: g.nombre }), cant]);
    fTipos.appendChild(fila);
    filtroTipo[g.nombre] = { input, cant, fila };
  }
  /** @type {Object<string, {input: HTMLInputElement, cant: HTMLElement}>} */
  const filtroOrg = {};
  const opcionesOrg = (esSuper ? [{ id: '', nombre: 'Todas' }] : []).concat(orgsDisp.map(o => ({ id: o.id, nombre: o.organizacion_nombre })));
  for (const o of opcionesOrg) {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'filtro-org', value: o.id, disabled: esSuper ? null : 'disabled' }));
    const cant = h('span', { class: 'cant', text: '–' });
    input.addEventListener('change', () => { if (input.checked) { busq.org = o.id || null; refrescar(true); } });
    fOrgs.appendChild(h('label', { class: 'f-fila' }, [input, h('span', { class: 'nom', title: o.nombre, text: o.nombre }), cant]));
    filtroOrg[o.id] = { input, cant };
  }
  btnQuitar.addEventListener('click', () => { busq.tiposOff.clear(); busq.org = null; refrescar(true); });

  // Celular (D-072): filtros plegados, vista previa a pantalla completa al tocar un resultado y botón para cerrar.
  const btnFiltros = h('button', { type: 'button', class: 'solo-cel chico', 'aria-expanded': 'false', text: 'Filtros' });
  const btnCerrarCel = h('button', { type: 'button', class: 'solo-cel chico', 'aria-label': 'Cerrar el buscador', text: '✕', onclick: () => cerrarModal() });
  const enCelular = () => window.matchMedia('(max-width: 760px)').matches;

  const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Buscador de Infradoc' }, [
    h('div', { class: 'barra' }, [icono('buscar'), campoQ, chipOrgCont, h('kbd', { text: 'Esc' }), btnFiltros, btnCerrarCel]),
    ejemplos,
    h('div', { class: 'cuerpo-b' }, [
      h('aside', { class: 'col-b col-filtros', 'aria-label': 'Filtros' }, [h('div', { class: 'f-grupo' }, [h('div', { class: 'f-tit', text: 'Tipo' }), fTipos]),
        h('div', { class: 'f-grupo' }, [h('div', { class: 'f-tit', text: 'Organización' }), fOrgs]), btnQuitar]),
      colRes, preview]),
    h('div', { class: 'pie-panel' }, [
      h('span', null, [h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ' moverse']), h('span', null, [h('kbd', { text: 'Enter' }), ' abrir']), h('span', null, [h('kbd', { text: 'Esc' }), ' cerrar']),
      h('span', { class: 'der', text: 'Las contraseñas nunca se buscan ni se muestran en la lista' })])]);
  contenedor.appendChild(panel);
  btnFiltros.addEventListener('click', () => {
    const ver = panel.classList.toggle('ver-filtros');
    panel.classList.remove('ver-prev');
    btnFiltros.setAttribute('aria-expanded', ver ? 'true' : 'false');
    btnFiltros.textContent = ver ? 'Ver resultados' : 'Filtros';
  });

  /** @param {ResultadoBusqueda} r */
  const abrirFicha = r => {
    if (estadoMetrica) {
      enviarTextoBusqueda();
      estadoMetrica.elegido = true;
      metrica('busqueda_resultado_elegido', { tipo: r.tipo, grupo: r.grupo, posicion: plano.indexOf(r) + 1, texto: busq.q, ms: Math.round(performance.now() - estadoMetrica.t0) });
    }
    cerrarModal();
    ir(rutaDe(r));
  };

  // ---- vista previa
  /** @param {ResultadoBusqueda|undefined} r */
  function renderPreview(r) {
    clearTimeout(temporizador);
    preview.textContent = '';
    preview.appendChild(h('button', { type: 'button', class: 'solo-cel pv-volver', onclick: () => panel.classList.remove('ver-prev') }, ['← Volver a los resultados']));
    if (!r) { preview.appendChild(h('div', { class: 'pv-vacio', text: 'Seleccioná un resultado para ver sus datos acá.' })); return; }
    const dl = h('dl');
    for (const x of r.previa) { dl.appendChild(h('dt', { text: x[0] })); dl.appendChild(h('dd', null, [resaltar(x[1], palabras)])); }
    const pie = h('div', { class: 'pv-pie' }, [h('span', { text: 'Cambió el ' + fmtFechaHora(r.actualizado_en) }), indicadorVerificacion(r.verificado_en, umbrales, false)]);
    const dentro = h('div', { class: 'pv-in' }, [h('div', { class: 'eyebrow' }, [iconoDe(r.tipo), ROTULO_TIPO_RESULTADO[r.grupo] || r.grupo]),
      h('h2', { text: r.titulo }), h('p', { class: 'pv-sub', text: r.subtitulo }), h('span', { class: 'badge', text: r.organizacion_nombre }), dl]);
    if (r.coleccion === 'credenciales') dentro.appendChild(bloqueSecreto(r));
    dentro.appendChild(pie);
    dentro.appendChild(h('div', { class: 'pv-acc' }, [h('button', { type: 'button', class: 'primario', onclick: () => abrirFicha(r) }, [icono('abrir'), ' Abrir ficha ', h('kbd', { text: 'Enter' })])]));
    preview.appendChild(h('div', { class: 'pv t-' + r.tipo }, [dentro]));
    preview.scrollTop = 0;
  }

  /**
   * Acciones sobre el secreto de una credencial: Copiar y Mostrar solo con permiso (cada uso queda registrado);
   * sin permiso, «Pedir acceso» (CU04b).
   * @param {ResultadoBusqueda} r
   */
  function bloqueSecreto(r) {
    const cred = { id: r.id, organizacion_id: r.organizacion_id, credencial_tipo: r.credencial_tipo };
    const caja = h('div', { class: 'pv-acc', 'data-secreto': r.id });
    const salida = h('div', { 'aria-live': 'polite' });
    if (puedeVerSecreto(u, cred)) {
      caja.appendChild(h('div', { class: 'mut', style: 'font-size:12.5px;margin-bottom:6px', text: 'Cada vez que mostrás o copiás la contraseña queda registrado quién y cuándo.' }));
      caja.appendChild(h('div', { class: 'herr' }, [
        h('button', { type: 'button', text: 'Copiar', onclick: async () => {
          try {
            const s = await repositorio.usarSecreto(r.id, u.id, 'copiar');
            await navigator.clipboard.writeText(s);
            toast('Contraseña copiada de «' + r.titulo + '». Quedó registrado.');
          } catch { toast('No se pudo copiar automáticamente. Usá «Mostrar».'); }
        } }),
        h('button', { type: 'button', text: 'Mostrar', onclick: async () => {
          clearTimeout(temporizador);
          const s = await repositorio.usarSecreto(r.id, u.id, 'mostrar');
          salida.textContent = '';
          const valor = h('span', { class: 'sec', text: s });
          const ocultar = () => { valor.textContent = '••••••••'; salida.textContent = ''; salida.appendChild(h('div', { class: 'mut', text: 'Contraseña oculta.' })); };
          salida.appendChild(h('div', { class: 'secreto-caja sec-mostrado' }, [valor, h('button', { type: 'button', class: 'chico', text: 'Ocultar', onclick: () => { clearTimeout(temporizador); ocultar(); } })]));
          salida.appendChild(h('div', { class: 'mut', style: 'font-size:12.5px', text: 'Se oculta sola en ' + SEGUNDOS_VISIBLE + ' segundos.' }));
          temporizador = window.setTimeout(ocultar, SEGUNDOS_VISIBLE * 1000);
        } })]));
    } else if (pedidosPendientes.has(r.id)) {
      caja.appendChild(h('div', { class: 'msg', text: 'Pediste acceso a esta contraseña el ' + fmtFecha(pedidosPendientes.get(r.id)) + ' y todavía no la resolvieron. Cuando te la aprueben, vas a ver un aviso al ingresar.' }));
    } else if (puedePedirSecreto(u)) {
      const motivo = /** @type {HTMLInputElement} */ (h('input', { type: 'text', placeholder: 'Opcional: para qué la necesitás', 'aria-label': 'Motivo del pedido', maxlength: '200' }));
      caja.appendChild(h('div', { class: 'msg', text: 'No ves las contraseñas directamente. Podés pedirle acceso a un superior: ves el nombre, el usuario y el equipo, pero no la contraseña.' }));
      caja.appendChild(h('label', { text: 'Motivo' }));
      caja.appendChild(motivo);
      caja.appendChild(h('div', { class: 'herr', style: 'margin-top:8px' }, [h('button', { type: 'button', class: 'primario', text: 'Pedir acceso', onclick: async () => {
        const res = await repositorio.crearSolicitudVerSecreto({ credencialId: r.id, usuarioId: u.id, motivo: motivo.value });
        pedidosPendientes.set(r.id, res.solicitud.solicitado_en);
        toast(res.yaExistia ? 'Ya habías pedido acceso: sigue pendiente.' : 'Pedido enviado. Te avisamos cuando lo resuelvan.');
        await repintarMarco();
        renderPreview(r);
      } })]));
    }
    caja.appendChild(salida);
    return caja;
  }

  // ---- selección de resultados
  /** @param {number} i @param {boolean} scroll */
  function seleccionar(i, scroll) {
    busq.idx = i;
    els.forEach((el, k) => el.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    const r = plano[i];
    if (r) { campoQ.setAttribute('aria-activedescendant', 'res-' + i); if (scroll && els[i]) els[i].scrollIntoView({ block: 'nearest' }); } else campoQ.removeAttribute('aria-activedescendant');
    renderPreview(r);
  }

  // ---- búsqueda y pintado de la lista
  /** @param {boolean} mantener Mantener el resultado seleccionado si sigue estando. */
  async function refrescar(mantener) {
    const miToken = ++token;
    const q = busq.q;
    palabras = normalizar(q).split(/\s+/).filter(Boolean);
    let base = await repositorio.buscar(q, { permitido: d => puede(u, 'ver', d.modulo, d.organizacion_id) });
    if (miToken !== token) return;
    if (!palabras.length) base = base.slice().sort((a, b) => (a.actualizado_en < b.actualizado_en ? 1 : -1));
    const baseOrg = base.filter(r => !busq.org || r.organizacion_id === busq.org);
    const baseTipo = base.filter(r => !busq.tiposOff.has(r.grupo));
    const visibles = baseOrg.filter(r => !busq.tiposOff.has(r.grupo));
    if (estadoMetrica) { estadoMetrica.resultados = visibles.length; estadoMetrica.filtros = { tiposOcultos: Array.from(busq.tiposOff), organizacion: busq.org ? (orgsTodas.find(x => x.id === busq.org) || { organizacion_nombre: '' }).organizacion_nombre : null }; }
    const tope = palabras.length ? TOPE_POR_GRUPO : TOPE_POR_GRUPO_VACIO;
    const grupos = repositorio.GRUPOS_BUSQUEDA.map(g => ({ g, items: visibles.filter(r => r.grupo === g.nombre) })).filter(x => x.items.length);
    const selAnterior = plano[busq.idx];
    plano = grupos.reduce((a, x) => a.concat(x.items.slice(0, tope)), /** @type {ResultadoBusqueda[]} */ ([]));

    chipOrgCont.textContent = '';
    if (busq.org) {
      const o = orgsTodas.find(x => x.id === busq.org);
      chipOrgCont.appendChild(h('span', { class: 'chip-org', title: 'Estás buscando solo en esta organización. Borrá con la tecla Retroceso para buscar en todas.' }, [o ? o.organizacion_nombre : '', h('button', { type: 'button', 'aria-label': 'Quitar filtro de organización', title: 'Buscar en todas las organizaciones', text: '✕', onclick: () => { busq.org = null; refrescar(true); campoQ.focus(); } })]));
    }
    for (const g of repositorio.GRUPOS_BUSQUEDA) {
      const n = baseOrg.filter(r => r.grupo === g.nombre).length;
      filtroTipo[g.nombre].cant.textContent = String(n);
      filtroTipo[g.nombre].input.checked = !busq.tiposOff.has(g.nombre);
      filtroTipo[g.nombre].fila.classList.toggle('cero', n === 0);
    }
    if (esSuper) filtroOrg[''].cant.textContent = String(baseTipo.length);
    for (const o of orgsDisp) filtroOrg[o.id].cant.textContent = String(baseTipo.filter(r => r.organizacion_id === o.id).length);
    for (const k of Object.keys(filtroOrg)) filtroOrg[k].input.checked = esSuper ? k === (busq.org || '') : true;
    btnQuitar.hidden = !(busq.org || busq.tiposOff.size);

    lista.textContent = '';
    els = [];
    colRes.scrollTop = 0;
    if (!plano.length) {
      resumen.textContent = '0 resultados';
      const v = h('div', { class: 'vacio' }, [h('h3', { text: 'No encontramos nada' + (q.trim() ? ' para «' + q.trim() + '»' : '') }),
        h('p', { text: 'Probá con menos palabras, sin tildes, o con solo una parte de la IP (por ejemplo 10.10.10.).' })]);
      if (busq.org || busq.tiposOff.size) {
        v.appendChild(h('p', { text: 'Tenés filtros activos que pueden estar escondiendo resultados.' }));
        v.appendChild(h('button', { type: 'button', text: 'Quitar filtros', onclick: () => btnQuitar.click() }));
      }
      lista.appendChild(v);
      seleccionar(-1, false);
      return;
    }
    resumen.textContent = '';
    resumen.appendChild(h('b', { text: String(visibles.length) }));
    resumen.appendChild(document.createTextNode(palabras.length ? (visibles.length === 1 ? ' resultado para «' + q.trim() + '»' : ' resultados para «' + q.trim() + '»') : ' elementos · mostrando los cambiados más recientemente; escribí para acotar'));
    let idx = 0;
    for (const { g, items } of grupos) {
      const grupo = h('div', { role: 'group', 'aria-label': g.nombre, class: 't-' + g.tipo });
      grupo.appendChild(h('div', { class: 'grupo-cab', 'aria-hidden': 'true' }, [iconoDe(g.tipo), g.nombre, h('span', { class: 'n', text: String(items.length) })]));
      for (const r of items.slice(0, tope)) {
        const i = idx++;
        const el = h('div', { class: 'res t-' + r.tipo, role: 'option', id: 'res-' + i, 'aria-selected': 'false', title: 'Doble clic para abrir la ficha' }, [
          h('span', { class: 'res-ico' }, [iconoDe(r.tipo)]),
          h('div', { class: 'res-cuerpo' }, [
            h('div', { class: 'res-tit' }, [resaltar(r.titulo, palabras)]), h('div', { class: 'res-sub' }, [resaltar(r.subtitulo, palabras)]),
            h('div', { class: 'res-meta' }, [h('span', { class: 'badge', text: r.organizacion_nombre }), h('span', { text: 'Cambió el ' + fmtFechaHora(r.actualizado_en) }), indicadorVerificacion(r.verificado_en, umbrales, true)])])]);
        el.addEventListener('mousedown', e => e.preventDefault());
        el.addEventListener('click', () => { seleccionar(i, false); if (enCelular()) panel.classList.add('ver-prev'); });
        el.addEventListener('dblclick', () => abrirFicha(r));
        els.push(el);
        grupo.appendChild(el);
      }
      if (items.length > tope) grupo.appendChild(h('div', { class: 'vacio', style: 'padding:8px 16px;font-size:13px', text: 'Mostrando ' + tope + ' de ' + items.length + '. Escribí más para acotar.' }));
      lista.appendChild(grupo);
    }
    let k = 0;
    if (mantener && selAnterior) { const j = plano.findIndex(x => x.clave === selAnterior.clave); if (j >= 0) k = j; }
    seleccionar(k, false);
  }

  campoQ.addEventListener('input', () => {
    panel.classList.remove('ver-prev'); busq.q = campoQ.value; busq.idx = 0; refrescar(false);
    if (estadoMetrica) { estadoMetrica.q = busq.q; clearTimeout(estadoMetrica.temporizador); estadoMetrica.temporizador = window.setTimeout(enviarTextoBusqueda, 800); }
  });
  campoQ.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (plano.length) seleccionar((busq.idx + 1) % plano.length, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (plano.length) seleccionar((busq.idx - 1 + plano.length) % plano.length, true); }
    else if (e.key === 'Enter' && plano[busq.idx]) abrirFicha(plano[busq.idx]);
    else if (e.key === 'Backspace' && !campoQ.value && busq.org) { busq.org = null; refrescar(true); }
  });
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = Array.from(panel.querySelectorAll('button:not([disabled]):not([hidden]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(x => /** @type {HTMLElement} */ (x).offsetParent !== null);
    if (!f.length) return;
    const a = /** @type {HTMLElement} */ (f[0]), z = /** @type {HTMLElement} */ (f[f.length - 1]);
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });
  await refrescar(false);
}
