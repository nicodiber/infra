// @ts-check
/**
 * Alta de equipos de TODOS los tipos (colección `equipos`, D-083): red (router, firewall, switch, access point), servidores y
 * máquinas virtuales, patcheras, UPS y «otro» (PC, notebook, impresora, reloj, NAS…). Un solo formulario, con los campos propios
 * del tipo elegido. Los puertos no se cargan acá: se generan al editar los puertos del equipo.
 * Se abre con `abrirAlta('equipos', {organizacion_id, valores, rotulo})`.
 *
 * Valores iniciales (`ctx.valores`):
 *  - `equipo_tipo`: tipo preelegido. `tipos`: lista de tipos que se pueden elegir (si es uno solo, el tipo queda fijo).
 *  - `otro_categoria`: categoría de «otro»; `categorias`: lista cerrada de categorías posibles (si no, texto libre con sugerencias).
 *  - `es_vm` (true) o `equipo_campos.host_id`: servidor que es máquina virtual; `host_id` también se acepta suelto.
 *  - `rack_id`, `rack_u_inicio`, `rack_u_alto`, `ubicacion_id`, `puesto_id`, `equipo_nombre`, `equipo_marca`, `equipo_modelo`,
 *    `equipo_estado`, `equipo_notas`, `equipo_campos` (campos del tipo), `titulo`, `duplicado_de`.
 * Rack, sede / sala, puesto, host y computadoras se eligen con `selectorConCrear` (se crean en el momento).
 * v0.10: secciones (Identificación · Ubicación · Red · datos del tipo · «Más datos»), validación al salir de cada campo (nombre repetido,
 * IP repetida, U ocupada, canal de NVR), sugerencias (nombre con numeración, marca y modelo más usados, «Igual que …») y, en los equipos que
 * van en un rack, vista previa en vivo (U cercanas del rack y etiqueta).
 * `valoresParaDuplicar(equipo)` arma los valores de «Duplicar» (MJ48).
 */

import * as repositorio from '../repositorio.js';
import { h, normalizar } from '../utiles.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_ESTADO_EQUIPO, CATEGORIA_NVR, esNvr } from '../modelos.js';
import { CAMPOS_POR_TIPO, camposIniciales, camposDeCategoria, formulario } from '../red.js';
import { ipValida, macValida, validarLugarEnRack, primeraUnidadLibre, rutaUbicacion, porId, ROTULO_VIRTUALIZACION } from '../racks.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, marcarObligatorio, selectorConCrear, opcionesDe } from '../altas.js';
import { enlazarValidacion, validarNombreUnico, validarIp, validarPosicion, validarCanalNvr } from '../validaciones.js';
import { masUsados, siguienteEnSerie, ultimoCreado, chipsDeSugerencia, escribirEn } from '../sugerencias.js';
import { qrSvg } from '../qr.js';

/** @typedef {import('../red.js').Campo} Campo */

const TIPOS = ['router', 'firewall', 'switch', 'access_point', 'servidor', 'patchera', 'ups', 'camara', 'otro'];
const CATEGORIAS_SUGERIDAS = ['PC de escritorio', 'Notebook', 'Impresora de red', 'Impresora', 'Reloj de control de personal', 'HMI / terminal de planta', 'Terminal de balanza', 'NVR de cámaras', 'NAS'];
/** Tipos que normalmente van en un rack: muestran la vista previa aunque todavía no se haya elegido el rack. */
const VAN_EN_RACK = ['router', 'firewall', 'switch', 'servidor', 'patchera', 'ups'];
/** Claves de `equipo_campos` que son una IP del propio equipo: no se copian al duplicar. */
const CLAVES_IP = ['router_ip_lan', 'firewall_ip_lan', 'servidor_ip_ilo_idrac'];

/**
 * Selector del NVR de una cámara (QC74): solo equipos «otro» de categoría NVR, con «+ Crear nuevo» que abre el alta de un NVR.
 * @param {import('../red.js').Campo} c @param {any} valor @param {string} org @param {string} rotuloOrigen
 * @param {(id: string, registro: any) => void} [alCambiar]
 */
export function selectorDeNvr(c, valor, org, rotuloOrigen, alCambiar) {
  return selectorConCrear({ desde: 'equipos', campo: 'equipo_campos.' + c.k, organizacion_id: org, valor: valor || null, etiqueta: c.r, rotuloOrigen,
    cargarOpciones: () => opcionesDe('equipos', org, { filtro: esNvr }),
    valoresAlta: { equipo_tipo: 'otro', tipos: ['otro'], otro_categoria: CATEGORIA_NVR, categorias: [CATEGORIA_NVR], titulo: 'Nuevo NVR' }, alCambiar });
}

/**
 * Primer canal libre (desde 1) de un NVR, mirando las cámaras vigentes.
 * @param {string} nvrId @param {string} org @param {string|null} [exceptoId] Cámara que se está editando.
 */
export async function proximoCanalLibre(nvrId, org, exceptoId) {
  const usados = new Set((await repositorio.listar('equipos', { organizacion_id: org }))
    .filter(x => x.equipo_tipo === 'camara' && x.id !== exceptoId && x.equipo_campos && x.equipo_campos.camara_nvr_id === nvrId).map(x => x.equipo_campos.camara_canal));
  let n = 1;
  while (usados.has(n)) n++;
  return n;
}

/** Campos del servidor (modelo 4.5); `host_id` va aparte. @type {Array<Campo & {soloFisico?: boolean}>} */
const CAMPOS_SERVIDOR_ALTA = [
  { k: 'servidor_rol', r: 'Rol', t: 'texto', req: true }, { k: 'servidor_sistema_operativo', r: 'Sistema operativo', t: 'texto', req: true },
  { k: 'servidor_cpu', r: 'CPU', t: 'texto' }, { k: 'servidor_ram_gb', r: 'RAM (GB)', t: 'entero' }, { k: 'servidor_almacenamiento', r: 'Discos / RAID', t: 'texto' },
  { k: 'servidor_virtualizacion', r: 'Hipervisor que ejecuta', t: 'enum', req: true, op: /** @type {Array<[string, string]>} */ (Object.entries(ROTULO_VIRTUALIZACION)) },
  { k: 'servidor_ip_ilo_idrac', r: 'IP de iLO / iDRAC', t: 'texto', soloFisico: true }, { k: 'servidor_garantia_vence_en', r: 'Garantía vence', t: 'fecha', soloFisico: true }
];

/**
 * Valores de «Duplicar» (MJ48): copia lo descriptivo y deja afuera lo que identifica a ESE equipo: número de serie, MAC, IP,
 * código, posición en el rack y conexiones (los puertos y las credenciales no se copian porque el alta no los crea).
 * @param {any} e
 */
export function valoresParaDuplicar(e) {
  const c = { ...(e.equipo_campos || {}) };
  for (const k of CLAVES_IP) delete c[k];
  delete c.switch_stack_miembro;
  delete c.camara_canal; // el canal es único por NVR: el de la copia lo propone el formulario
  return { equipo_tipo: e.equipo_tipo, tipos: [e.equipo_tipo], otro_categoria: c.otro_categoria, equipo_nombre: e.equipo_nombre + ' (copia)', equipo_marca: e.equipo_marca, equipo_modelo: e.equipo_modelo,
    equipo_estado: e.equipo_estado, equipo_notas: e.equipo_notas, ubicacion_id: e.ubicacion_id, rack_id: e.rack_id, rack_u_alto: e.rack_u_alto, puesto_id: e.puesto_id, equipo_campos: c, host_id: c.host_id || null,
    es_vm: !!c.host_id };
}

registrarAlta('equipos', async ctx => {
  const v = ctx.valores;
  const org = ctx.organizacion_id;
  const tiposOk = (Array.isArray(v.tipos) && v.tipos.length ? v.tipos : TIPOS).filter((/** @type {string} */ t) => TIPOS.includes(t));
  const tipoFijo = tiposOk.length === 1;
  const valoresCampos = { ...(v.equipo_campos || {}) };
  const ID = { tipo: idUnico('eq-tipo'), que: idUnico('eq-que'), cat: idUnico('eq-cat'), host: idUnico('eq-host'), nom: idUnico('eq-nom'), cod: idUnico('eq-cod'), marca: idUnico('eq-marca'), mod: idUnico('eq-mod'),
    ser: idUnico('eq-ser'), mac: idUnico('eq-mac'), ip: idUnico('eq-ip'), est: idUnico('eq-est'), rack: idUnico('eq-rack'), ini: idUnico('eq-ini'), alto: idUnico('eq-alto'), ub: idUnico('eq-ub'), pu: idUnico('eq-pu'), notas: idUnico('eq-notas') };
  let tipo = tiposOk.includes(v.equipo_tipo) ? v.equipo_tipo : tiposOk[0];
  const titulo = v.titulo || (tipoFijo && tipo !== 'otro' ? (tipo === 'patchera' ? 'Nueva patchera' : tipo === 'camara' ? 'Nueva cámara' : 'Nuevo ' + ROTULO_EQUIPO_TIPO[tipo].toLowerCase()) : 'Nuevo equipo');
  const inp = (/** @type {string} */ id, /** @type {any} */ val, /** @type {Object<string,string>} */ ex) => { const i = /** @type {HTMLInputElement} */ (h('input', { id, type: 'text', ...(ex || {}) })); i.value = val == null ? '' : String(val); return i; };

  // ---- identidad
  const selTipo = /** @type {HTMLSelectElement} */ (h('select', { id: ID.tipo }, tiposOk.map((/** @type {string} */ t) => h('option', { value: t, text: ROTULO_EQUIPO_TIPO[t] }))));
  selTipo.value = tipo;
  const selQue = /** @type {HTMLSelectElement} */ (h('select', { id: ID.que }, [h('option', { value: 'fisico', text: 'Servidor físico' }), h('option', { value: 'vm', text: 'Máquina virtual' })]));
  selQue.value = v.es_vm || v.host_id || valoresCampos.host_id ? 'vm' : 'fisico';
  const categoria = v.categorias && v.categorias.length
    ? /** @type {HTMLInputElement|HTMLSelectElement} */ (h('select', { id: ID.cat }, v.categorias.map((/** @type {string} */ c) => h('option', { value: c, text: c }))))
    : /** @type {HTMLInputElement|HTMLSelectElement} */ (h('input', { id: ID.cat, type: 'text', list: ID.cat + '-l', maxlength: '80', placeholder: 'Ej.: PC de escritorio, NAS…' }));
  categoria.value = v.otro_categoria || valoresCampos.otro_categoria || (v.categorias && v.categorias[0]) || '';
  const listaCat = h('datalist', { id: ID.cat + '-l' }, CATEGORIAS_SUGERIDAS.map(c => h('option', { value: c })));
  const host = selectorConCrear({ desde: 'equipos', campo: 'equipo_campos.host_id', organizacion_id: org, valor: v.host_id || valoresCampos.host_id || null, id: ID.host, rotuloOrigen: titulo,
    cargarOpciones: () => opcionesDe('equipos', org, { filtro: e => e.equipo_tipo === 'servidor' && !(e.equipo_campos && e.equipo_campos.host_id) }), valoresAlta: { equipo_tipo: 'servidor', tipos: ['servidor'] } });
  const nombre = inp(ID.nom, v.equipo_nombre, { maxlength: '120' });
  const codigo = inp(ID.cod, '', { placeholder: 'Se genera solo (ej. AGR-SW-003)' });
  const marca = inp(ID.marca, v.equipo_marca), modelo = inp(ID.mod, v.equipo_modelo);
  const serie = inp(ID.ser, ''), mac = inp(ID.mac, '', { placeholder: 'AA:BB:CC:DD:EE:FF' }), ip = inp(ID.ip, '', { placeholder: '10.10.0.2' });
  const estado = /** @type {HTMLSelectElement} */ (h('select', { id: ID.est }, Object.keys(ROTULO_ESTADO_EQUIPO).map(k => h('option', { value: k, text: ROTULO_ESTADO_EQUIPO[k] }))));
  estado.value = v.equipo_estado || 'en_uso';
  const notas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: ID.notas, rows: '2', placeholder: 'Sin contraseñas ni secretos' }));
  notas.value = v.equipo_notas || '';

  // ---- dónde está
  const rack = selectorConCrear({ desde: 'equipos', campo: 'rack_id', organizacion_id: org, valor: v.rack_id || null, id: ID.rack, rotuloOrigen: titulo, alCambiar: () => { uIni.value = ''; sincronizar(); } });
  const uIni = /** @type {HTMLInputElement} */ (h('input', { id: ID.ini, type: 'number', min: '1', step: '1' }));
  uIni.value = v.rack_u_inicio == null ? '' : String(v.rack_u_inicio);
  const uAlto = /** @type {HTMLInputElement} */ (h('input', { id: ID.alto, type: 'number', min: '1', step: '1' }));
  uAlto.value = String(v.rack_u_alto || 1);
  const ubic = selectorConCrear({ desde: 'equipos', campo: 'ubicacion_id', organizacion_id: org, valor: v.ubicacion_id || null, id: ID.ub, rotuloOrigen: titulo });
  const puesto = selectorConCrear({ desde: 'equipos', campo: 'puesto_id', organizacion_id: org, valor: v.puesto_id || null, id: ID.pu, rotuloOrigen: titulo, alCambiar: () => { sincronizar(); } });
  const cHost = campoDeAlta(ID.host, 'Host que la aloja *', host, 'El servidor físico donde corre. Si todavía no está cargado, creálo desde acá.');
  const cRack = campoDeAlta(ID.rack, 'Rack', rack);
  const cIni = campoDeAlta(ID.ini, 'Posición (U) inicial (1 = abajo)', uIni), cAlto = campoDeAlta(ID.alto, 'Alto en U', uAlto);
  const cUb = campoDeAlta(ID.ub, 'Sede / sala', ubic);
  const cPu = campoDeAlta(ID.pu, 'Puesto de trabajo', puesto, 'Para PC, notebook, impresora o reloj: el lugar donde llega la boca de pared.');

  // ---- campos propios del tipo
  const zonaTipo = h('section', { class: 'alta-seccion' });
  /** @type {null|ReturnType<typeof formulario>} */ let fTipo = null;
  /** @type {null|ReturnType<typeof formulario>} */ let fCat = null;
  /** @type {Object<string, HTMLSelectElement>} */ let selEquipos = {};
  const esVM = () => tipo === 'servidor' && selQue.value === 'vm';
  const pcs = () => opcionesDe('equipos', org, { filtro: e => e.equipo_tipo === 'servidor' || (e.equipo_tipo === 'otro' && ['pc de escritorio', 'notebook'].includes(normalizar(String((e.equipo_campos || {}).otro_categoria || '')))) });
  const pintarTipo = () => {
    zonaTipo.textContent = ''; fTipo = null; fCat = null; selEquipos = {};
    const inicial = { ...camposIniciales(tipo), ...(tipo === 'servidor' ? { servidor_virtualizacion: 'ninguna' } : {}), ...valoresCampos };
    const campos = (tipo === 'servidor' ? CAMPOS_SERVIDOR_ALTA.filter(c => !(esVM() && c.soloFisico)) : (CAMPOS_POR_TIPO[tipo] || []).filter(c => c.k !== 'otro_categoria'));
    if (campos.length) {
      /** Propone el primer canal libre del NVR elegido (solo si el canal está vacío). @param {string} nvrId */
      const sugerirCanal = async nvrId => {
        const canal = fTipo && fTipo.ctl.camara_canal;
        if (!nvrId || !canal || canal.value.trim()) return;
        canal.value = String(await proximoCanalLibre(nvrId, org, null));
        const cp = /** @type {any} */ (canal.closest('.campo'));
        if (cp && cp.validar) cp.validar();
      };
      fTipo = formulario(campos, inicial, tipo === 'camara' ? { selectorEquipo: (c, val) => selectorDeNvr(c, val, org, titulo, id => { sugerirCanal(id); }) } : undefined);
      if (tipo === 'camara' && inicial.camara_nvr_id) sugerirCanal(inicial.camara_nvr_id);
      const canal = fTipo.ctl.camara_canal, nvr = fTipo.ctl.camara_nvr_id;
      if (tipo === 'camara' && canal && nvr) { // canal ocupado en ese NVR (QC74): propone el primero libre
        enlazarValidacion(/** @type {HTMLElement} */ (canal.closest('.campo')), () => validarCanalNvr({ nvrId: nvr.value || null, canal: canal.value, org }), { controles: [canal], tambien: [nvr] });
      }
      zonaTipo.appendChild(h('h3', { text: 'Datos propios de ' + (tipo === 'otro' ? 'este equipo' : ROTULO_EQUIPO_TIPO[tipo].toLowerCase()) })); zonaTipo.appendChild(fTipo.nodo);
    }
    if (tipo === 'otro') {
      const cs = camposDeCategoria(categoria.value);
      if (cs.length) {
        const vals = { ...inicial }; if (!vals.impresora_conexion && cs.some(c => c.k === 'impresora_conexion')) vals.impresora_conexion = 'red';
        fCat = formulario(cs.filter(c => c.t !== 'equipo'), vals);
        zonaTipo.appendChild(h('h3', { text: 'Datos propios de «' + categoria.value.trim() + '»' })); zonaTipo.appendChild(fCat.nodo);
        for (const c of cs.filter(x => x.t === 'equipo')) {
          const id = idUnico('eq-ref');
          const s = selectorConCrear({ desde: 'equipos', campo: 'equipo_campos.' + c.k, organizacion_id: org, valor: valoresCampos[c.k] || null, id, rotuloOrigen: titulo, cargarOpciones: pcs,
            valoresAlta: { equipo_tipo: 'otro', tipos: ['otro'], otro_categoria: 'PC de escritorio', categorias: ['PC de escritorio', 'Notebook'], titulo: 'Nueva computadora' } });
          selEquipos[c.k] = s;
          zonaTipo.appendChild(campoDeAlta(id, c.k === 'impresora_pc_id' ? 'Computadora a la que está conectada (si es USB)' : c.r, s));
        }
        const con = fCat.ctl.impresora_conexion, pc = selEquipos.impresora_pc_id;
        if (con && pc) { const sync = () => { pc.disabled = con.value !== 'usb'; if (con.value !== 'usb') pc.value = ''; }; con.addEventListener('change', sync); sync(); }
      }
    }
    zonaTipo.hidden = !zonaTipo.childNodes.length;
  };

  // ---- qué se ve según el tipo, y el lugar
  const alTipo = () => {
    tipo = selTipo.value;
    const vm = esVM();
    selQue.parentElement && (selQue.parentElement.hidden = tipo !== 'servidor');
    cHost.hidden = !vm; cCat.hidden = tipo !== 'otro'; cRack.hidden = vm; cIni.hidden = vm; cAlto.hidden = vm; cUb.hidden = vm; cPu.hidden = tipo !== 'otro' || vm;
    pintarTipo(); renovarSugerencias(); sincronizar();
  };
  async function sincronizar() {
    const rk = rack.value, pu = tipo === 'otro' ? puesto.value : '';
    rack.disabled = !!pu; puesto.disabled = !!rk; uIni.disabled = !rk; uAlto.disabled = !rk;
    if (!rk) { uIni.value = ''; }
    if (rk) {
      const r = await repositorio.obtener('racks', rk);
      if (r) { await ubic.listo; ubic.value = r.ubicacion_id; }
      ubic.disabled = true;
      if (!uIni.value && r) { const montados = await repositorio.listar('equipos', { rack_id: rk }); const s = primeraUnidadLibre(r.rack_unidades_total, montados, parseInt(uAlto.value, 10) || 1); uIni.value = s == null ? '' : String(s); }
      marcarObligatorio(cIni, true);
      await /** @type {any} */ (cIni).validar();
    } else if (pu) {
      const p = await repositorio.obtener('puestos', pu);
      if (p) { await ubic.listo; ubic.value = p.ubicacion_id; }
      ubic.disabled = true;
    } else ubic.disabled = false;
    if (!rk) { marcarObligatorio(cIni, false); cIni.classList.remove('ok', 'mal'); cIni.dataset.estado = ''; await /** @type {any} */ (cIni).validar(); }
    pintarPrevia();
  }
  uAlto.addEventListener('change', () => { uIni.value = ''; sincronizar(); });
  selTipo.addEventListener('change', alTipo);
  selQue.addEventListener('change', alTipo);
  categoria.addEventListener('change', () => { if (tipo === 'otro') { pintarTipo(); renovarSugerencias(); } });

  const cCat = campoDeAlta(ID.cat, 'Categoría *', categoria, 'Qué es. Las PC y notebooks se ven en «Equipos de escritorio».');
  cCat.appendChild(listaCat);
  const cTipo = tipoFijo ? h('div', { class: 'mut', text: 'Tipo: ' + ROTULO_EQUIPO_TIPO[tipo] + '. No se puede cambiar después.' }) : campoDeAlta(ID.tipo, 'Tipo *', selTipo, 'No se puede cambiar después de creado.');
  const cQue = campoDeAlta(ID.que, 'Qué es', selQue);

  // ---- campos de identificación con validación y sugerencias
  const cNombre = campoDeAlta(ID.nom, 'Nombre *', nombre), cMarca = campoDeAlta(ID.marca, 'Marca', marca), cModelo = campoDeAlta(ID.mod, 'Modelo', modelo);
  const cIp = campoDeAlta(ID.ip, 'IP de gestión', ip), cEstado = campoDeAlta(ID.est, 'Estado *', estado);
  const cCodigo = campoDeAlta(ID.cod, 'Código', codigo, 'Vacío: se genera solo.');
  const chMarca = chipsDeSugerencia(), chModelo = chipsDeSugerencia();
  cMarca.appendChild(chMarca.nodo); cModelo.appendChild(chModelo.nodo);
  /** Equipos de la organización (se leen una vez: alcanzan para sugerir y para la serie de nombres). */
  const existentes = await repositorio.listar('equipos', { organizacion_id: org });
  /** Equipos «parecidos»: mismo tipo (y categoría si es «otro»; físico o virtual si es servidor). @param {any} e */
  const claveDe = e => e.equipo_tipo === 'otro' ? 'otro:' + normalizar(String((e.equipo_campos || {}).otro_categoria || '')) : e.equipo_tipo === 'servidor' ? 'servidor:' + ((e.equipo_campos || {}).host_id ? 'vm' : 'fisico') : e.equipo_tipo;
  const claveActual = () => claveDe({ equipo_tipo: tipo, equipo_campos: { otro_categoria: categoria.value, host_id: esVM() ? 'x' : null } });
  const parecidos = () => existentes.filter(e => claveDe(e) === claveActual());
  let nombreTocado = !!v.equipo_nombre;
  let propuesta = /** @type {{sugerido: string, ayuda: string}|null} */ (null);
  nombre.addEventListener('input', () => { nombreTocado = true; }); // `renovarSugerencias` escribe el valor sin evento: solo cuenta lo que hace el usuario
  function renovarSugerencias() {
    const mismos = parecidos();
    propuesta = siguienteEnSerie(mismos.map(e => String(e.equipo_nombre)));
    if (!nombreTocado) { nombre.value = propuesta ? propuesta.sugerido : ''; }
    /** @type {Array<import('../sugerencias.js').Sugerencia>} */
    const lista = [];
    const ultimo = ultimoCreado(mismos.filter(e => e.equipo_marca || e.equipo_modelo));
    if (ultimo) lista.push({ texto: 'Igual que ' + ultimo.equipo_nombre, destacada: true, alElegir: () => { escribirEn(marca, ultimo.equipo_marca || ''); escribirEn(modelo, ultimo.equipo_modelo || ''); } });
    for (const m of masUsados(mismos, e => e.equipo_marca, 4)) lista.push({ texto: m, alElegir: () => escribirEn(marca, m) });
    chMarca.pintar(lista);
    const delaMarca = marca.value.trim() ? mismos.filter(e => normalizar(e.equipo_marca) === normalizar(marca.value)) : mismos;
    chModelo.pintar(masUsados(delaMarca, e => e.equipo_modelo, 3).map(m => ({ texto: m, alElegir: () => escribirEn(modelo, m) })));
    /** @type {any} */ (cNombre).validar();
    pintarPrevia();
  }
  marca.addEventListener('input', () => {
    const delaMarca = marca.value.trim() ? parecidos().filter(e => normalizar(e.equipo_marca) === normalizar(marca.value)) : parecidos();
    chModelo.pintar(masUsados(delaMarca, e => e.equipo_modelo, 3).map(m => ({ texto: m, alElegir: () => escribirEn(modelo, m) })));
  });
  enlazarValidacion(cNombre, async () => {
    const r = await validarNombreUnico({ coleccion: 'equipos', campo: 'equipo_nombre', org, valor: nombre.value, articulo: 'un equipo' });
    if (r) return r;
    return propuesta && nombre.value.trim() === propuesta.sugerido ? { nivel: 'ok', mensaje: propuesta.ayuda } : null;
  });
  enlazarValidacion(cIp, () => validarIp({ ip: ip.value, org }));
  enlazarValidacion(cIni, () => validarPosicion({ rackId: rack.value || null, inicio: parseInt(uIni.value, 10), alto: parseInt(uAlto.value, 10) || 1 }), { tambien: [rack, uAlto] });
  uIni.addEventListener('input', () => pintarPrevia());
  uAlto.addEventListener('input', () => pintarPrevia());
  nombre.addEventListener('input', () => pintarPrevia());
  codigo.addEventListener('input', () => pintarPrevia());

  // ---- vista previa en vivo (opción C): U cercanas del rack y etiqueta. Solo equipos que van en un rack.
  const previaRack = h('div'), previaEtiqueta = h('div');
  const previa = h('aside', { 'aria-label': 'Vista previa del equipo', hidden: 'hidden' }, [h('h4', { text: 'Dónde queda' }), previaRack, h('h4', { text: 'Etiqueta que va a salir' }), previaEtiqueta]);
  let turnoPrevia = 0;
  function pintarPrevia() {
    const mio = ++turnoPrevia;
    const sirve = !esVM() && (VAN_EN_RACK.includes(tipo) || !!rack.value);
    previa.hidden = !sirve;
    if (!sirve) return;
    (async () => {
      const rk = rack.value ? await repositorio.obtener('racks', rack.value) : null;
      const montados = rk ? await repositorio.listar('equipos', (/** @type {any} */ e) => e.rack_id === rk.id) : [];
      const ubicaciones = rk ? await repositorio.listar('ubicaciones', { organizacion_id: org }) : [];
      const codigoPrevisto = codigo.value.trim() || await repositorio.proximoCodigoDeEquipo({ organizacion_id: org, equipo_tipo: tipo, equipo_campos: { otro_categoria: categoria.value.trim(), host_id: esVM() ? 'x' : null } });
      if (mio !== turnoPrevia) return; // llegó una actualización más nueva
      const nom = nombre.value.trim() || 'Equipo nuevo';
      const ini = parseInt(uIni.value, 10), alto = parseInt(uAlto.value, 10) || 1;
      previaRack.textContent = '';
      previaRack.appendChild(h('h4', { text: rk ? 'En el rack ' + rk.rack_nombre : 'Elegí un rack para ver dónde queda', style: 'margin-bottom:6px' }));
      if (rk && ini >= 1) {
        const hasta = Math.min(rk.rack_unidades_total, Math.max(ini + alto - 1 + 4, 8)), desde = Math.max(1, Math.min(ini - 3, hasta - 7));
        const caja = h('div', { class: 'ap-rack' });
        for (let u = hasta; u >= desde; u--) {
          const ocupante = montados.find((/** @type {any} */ e) => e.rack_u_inicio != null && u >= e.rack_u_inicio && u <= e.rack_u_inicio + (e.rack_u_alto || 1) - 1);
          const nuevo = u >= ini && u <= ini + alto - 1;
          const arriba = (/** @type {number} */ x) => u === x;
          const c = h('span', { class: 'c' + (nuevo ? ' nuevo' + (ocupante ? ' choque' : '') : ocupante ? ' ocu' : ''),
            text: nuevo ? (arriba(ini + alto - 1) ? nom + (ocupante ? ' · choca' : ' · nuevo') : '') : ocupante && arriba(ocupante.rack_u_inicio + (ocupante.rack_u_alto || 1) - 1) ? ocupante.equipo_nombre : '' });
          caja.appendChild(h('div', { class: 'ap-u' }, [h('span', { class: 'n', text: String(u) }), c]));
        }
        previaRack.appendChild(caja);
      } else if (rk) previaRack.appendChild(h('div', { class: 'mut', text: 'Indicá la posición (U) para verlo en el rack.' }));
      previaEtiqueta.textContent = '';
      const sala = rk ? rutaUbicacion(rk.ubicacion_id, porId(ubicaciones)) : '';
      previaEtiqueta.appendChild(h('div', { class: 'ap-etiq' }, [
        h('div', null, [h('b', { text: codigoPrevisto }), h('span', { text: nom }), h('span', { text: rk ? (sala ? sala + ' · ' : '') + (ini >= 1 ? 'U' + ini : rk.rack_nombre) : 'Sin rack todavía' })]),
        qrSvg('infradoc:' + codigoPrevisto, { margen: 1 })]));
    })().catch(console.error);
  }
  alTipo();
  await Promise.all([rack.listo, ubic.listo, puesto.listo]);
  await sincronizar();

  pintarPrevia();
  return abrirFormularioDeAlta({
    titulo, rotulo: ctx.rotulo && ctx.rotulo !== titulo ? ctx.rotulo : null, textoGuardar: 'Crear', enfocar: nombre,
    intro: v.duplicado_de ? 'Copia de «' + v.duplicado_de + '». No se copian el número de serie, la MAC, las IP, el código, la posición en el rack, las conexiones de puertos ni las credenciales. Los campos con * son obligatorios.' : undefined,
    secciones: [
      { titulo: 'Identificación', cuerpo: [cTipo, cQue, cCat, cHost, cNombre, cMarca, cModelo, cEstado] },
      { titulo: 'Ubicación', cuerpo: [cRack, cIni, cAlto, cUb, cPu] },
      { titulo: 'Red', cuerpo: [cIp] },
      zonaTipo],
    mas: { resumen: 'código, serie, MAC, notas', cuerpo: [cCodigo, campoDeAlta(ID.ser, 'Número de serie', serie), campoDeAlta(ID.mac, 'MAC', mac), campoDeAlta(ID.notas, 'Notas', notas)] },
    previa,
    alGuardar: async () => {
      const vm = esVM();
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Falta el nombre del equipo.');
      const todos = await repositorio.listar('equipos', { organizacion_id: org });
      if (todos.some(x => normalizar(x.equipo_nombre) === normalizar(nom))) throw new Error('Ya hay un equipo llamado «' + nom + '» en esta organización.');
      if (ip.value.trim() && !ipValida(ip.value.trim())) throw new Error('La IP de gestión no es válida (por ejemplo 10.10.20.21).');
      if (mac.value.trim() && !macValida(mac.value.trim())) throw new Error('La MAC no es válida (formato AA:BB:CC:DD:EE:FF).');
      if (tipo === 'otro' && !categoria.value.trim()) throw new Error('Indicá la categoría del equipo (qué es).');
      if (vm && !host.value) throw new Error('Elegí el host que aloja la máquina virtual (si no está cargado, usá «+ Crear nuevo equipo…»).');
      /** @type {Object<string, any>} */
      const campos = { ...camposIniciales(tipo) };
      /** @type {string[]} */ const errores = [];
      for (const f of [fTipo, fCat]) if (f) { const r = f.leer(); errores.push(...r.errores); Object.assign(campos, r.valores); }
      for (const k of Object.keys(selEquipos)) campos[k] = selEquipos[k].value || null;
      if (tipo === 'servidor') {
        if (vm) { campos.servidor_ip_ilo_idrac = null; campos.servidor_garantia_vence_en = null; }
        campos.host_id = vm ? host.value : null;
        for (const k of ['servidor_cpu', 'servidor_almacenamiento']) if (campos[k] === undefined) campos[k] = null;
        if (campos.servidor_ip_ilo_idrac && !ipValida(campos.servidor_ip_ilo_idrac)) errores.push('La IP de iLO / iDRAC no es válida.');
      }
      if (tipo === 'otro') campos.otro_categoria = categoria.value.trim();
      if (tipo === 'access_point' && campos.access_point_modo === 'controlado' && !campos.access_point_controladora) errores.push('Un access point controlado necesita indicar la controladora.');
      if (campos.impresora_conexion === 'usb' && !campos.impresora_pc_id) errores.push('Una impresora USB / local necesita indicar la computadora a la que está conectada.');
      if (errores.length) throw new Error(errores.join(' '));
      const rk = !vm && rack.value ? rack.value : null;
      let ubicacion = vm ? null : ubic.value || null;
      let ini = null, alto = null;
      if (rk) {
        ini = parseInt(uIni.value, 10); alto = parseInt(uAlto.value, 10);
        const p = await validarLugarEnRack(rk, ini, alto, null);
        if (p) throw new Error(p);
        const r = await repositorio.obtener('racks', rk); ubicacion = r ? r.ubicacion_id : ubicacion;
      }
      const pu = tipo === 'otro' && !vm && !rk ? puesto.value || null : null;
      if (pu) { const p = await repositorio.obtener('puestos', pu); ubicacion = p ? p.ubicacion_id : ubicacion; }
      /** @type {any} */
      const reg = { organizacion_id: org, equipo_tipo: tipo, equipo_nombre: nom, equipo_marca: marca.value.trim() || null, equipo_modelo: modelo.value.trim() || null,
        equipo_numero_serie: serie.value.trim() || null, equipo_mac: mac.value.trim() || null, equipo_ip_gestion: ip.value.trim() || null, ubicacion_id: ubicacion, rack_id: rk,
        rack_u_inicio: ini, rack_u_alto: alto, puesto_id: pu, equipo_estado: estado.value, equipo_notas: notas.value.trim() || null, equipo_campos: campos };
      if (codigo.value.trim()) reg.equipo_codigo = codigo.value.trim();
      const creado = await repositorio.guardar('equipos', reg, ctx.usuario.id);
      // Una cámara tiene una boca RJ45: se crea con el equipo para poder conectarla a un puerto de switch (QC74).
      if (tipo === 'camara') {
        await repositorio.guardar('puertos', { equipo_id: creado.id, puerto_numero: 1, puerto_nombre: null, puerto_tipo: 'rj45', puerto_velocidad: null, puerto_modo: null, vlan_nativa_id: null, vlans_etiquetadas: [],
          conectado_a_equipo_id: null, conectado_a_puerto_id: null, conectado_a_descripcion: null, enlace_isp_id: null, puesto_id: null, puerto_estado: 'libre', puerto_notas: null }, ctx.usuario.id);
      }
      return creado;
    }
  });
});
