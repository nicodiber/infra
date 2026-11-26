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
 * `valoresParaDuplicar(equipo)` arma los valores de «Duplicar» (MJ48).
 */

import * as repositorio from '../repositorio.js';
import { h, normalizar } from '../utiles.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_ESTADO_EQUIPO } from '../modelos.js';
import { CAMPOS_POR_TIPO, camposIniciales, camposDeCategoria, formulario } from '../red.js';
import { ipValida, macValida, validarLugarEnRack, primeraUnidadLibre, ROTULO_VIRTUALIZACION } from '../racks.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear, opcionesDe } from '../altas.js';

/** @typedef {import('../red.js').Campo} Campo */

const TIPOS = ['router', 'firewall', 'switch', 'access_point', 'servidor', 'patchera', 'ups', 'otro'];
const CATEGORIAS_SUGERIDAS = ['PC de escritorio', 'Notebook', 'Impresora de red', 'Impresora', 'Reloj de control de personal', 'HMI / terminal de planta', 'Terminal de balanza', 'NVR de cámaras', 'NAS'];
/** Claves de `equipo_campos` que son una IP del propio equipo: no se copian al duplicar. */
const CLAVES_IP = ['router_ip_lan', 'firewall_ip_lan', 'servidor_ip_ilo_idrac'];

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
  const titulo = v.titulo || (tipoFijo && tipo !== 'otro' ? (tipo === 'patchera' ? 'Nueva patchera' : 'Nuevo ' + ROTULO_EQUIPO_TIPO[tipo].toLowerCase()) : 'Nuevo equipo');
  const dos = (/** @type {Node[]} */ ...c) => h('div', { class: 'rk-dos' }, c);
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
  const filaRack = h('div', { class: 'rk-tres' }, [cRack, cIni, cAlto]);

  // ---- campos propios del tipo
  const zonaTipo = h('div');
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
      fTipo = formulario(campos, inicial);
      zonaTipo.appendChild(h('h3', { text: 'Datos propios de ' + (tipo === 'otro' ? 'este equipo' : ROTULO_EQUIPO_TIPO[tipo].toLowerCase()), style: 'margin:10px 0 6px' })); zonaTipo.appendChild(fTipo.nodo);
    }
    if (tipo === 'otro') {
      const cs = camposDeCategoria(categoria.value);
      if (cs.length) {
        const vals = { ...inicial }; if (!vals.impresora_conexion && cs.some(c => c.k === 'impresora_conexion')) vals.impresora_conexion = 'red';
        fCat = formulario(cs.filter(c => c.t !== 'equipo'), vals);
        zonaTipo.appendChild(h('h3', { text: 'Datos propios de «' + categoria.value.trim() + '»', style: 'margin:10px 0 6px' })); zonaTipo.appendChild(fCat.nodo);
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
  };

  // ---- qué se ve según el tipo, y el lugar
  const alTipo = () => {
    tipo = selTipo.value;
    const vm = esVM();
    selQue.parentElement && (selQue.parentElement.hidden = tipo !== 'servidor');
    cHost.hidden = !vm; cCat.hidden = tipo !== 'otro'; filaRack.hidden = vm; cUb.hidden = vm; cPu.hidden = tipo !== 'otro' || vm;
    pintarTipo(); sincronizar();
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
    } else if (pu) {
      const p = await repositorio.obtener('puestos', pu);
      if (p) { await ubic.listo; ubic.value = p.ubicacion_id; }
      ubic.disabled = true;
    } else ubic.disabled = false;
  }
  uAlto.addEventListener('change', () => { uIni.value = ''; sincronizar(); });
  selTipo.addEventListener('change', alTipo);
  selQue.addEventListener('change', alTipo);
  categoria.addEventListener('change', () => { if (tipo === 'otro') { pintarTipo(); } });

  const cCat = campoDeAlta(ID.cat, 'Categoría *', categoria, 'Qué es. Las PC y notebooks se ven en «Equipos de escritorio».');
  cCat.appendChild(listaCat);
  const cTipo = tipoFijo ? h('div', { class: 'mut', style: 'margin-top:8px', text: 'Tipo: ' + ROTULO_EQUIPO_TIPO[tipo] + '. No se puede cambiar después.' }) : campoDeAlta(ID.tipo, 'Tipo *', selTipo, 'No se puede cambiar después de creado.');
  const cQue = campoDeAlta(ID.que, 'Qué es', selQue);
  alTipo();
  await Promise.all([rack.listo, ubic.listo, puesto.listo]);
  await sincronizar();

  return abrirFormularioDeAlta({
    titulo, rotulo: ctx.rotulo && ctx.rotulo !== titulo ? ctx.rotulo : null, textoGuardar: 'Crear', enfocar: nombre,
    intro: v.duplicado_de ? 'Copia de «' + v.duplicado_de + '». No se copian el número de serie, la MAC, las IP, el código, la posición en el rack, las conexiones de puertos ni las credenciales. Los campos con * son obligatorios.' : undefined,
    cuerpo: [dos(cTipo, cQue), cCat, cHost, dos(campoDeAlta(ID.nom, 'Nombre *', nombre), campoDeAlta(ID.cod, 'Código', codigo)), dos(campoDeAlta(ID.marca, 'Marca', marca), campoDeAlta(ID.mod, 'Modelo', modelo)),
      dos(campoDeAlta(ID.ser, 'Número de serie', serie), campoDeAlta(ID.mac, 'MAC', mac)), dos(campoDeAlta(ID.ip, 'IP de gestión', ip), campoDeAlta(ID.est, 'Estado *', estado)),
      h('h3', { text: 'Dónde está', style: 'margin:10px 0 0' }), filaRack, cUb, cPu, zonaTipo, campoDeAlta(ID.notas, 'Notas', notas)],
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
      return repositorio.guardar('equipos', reg, ctx.usuario.id);
    }
  });
});
