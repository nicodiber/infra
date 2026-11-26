// @ts-check
/**
 * P28 · Documentación de la organización en PDF (IC12, D-061).
 * Ruta: `#/informe`. Se eligen las secciones y se usa «Imprimir / Guardar PDF» del navegador (sin bibliotecas).
 * Nunca incluye contraseñas ni claves: las credenciales, si se piden, se listan solo con nombre y usuario.
 * Solo valores vigentes (D-018). Las colecciones que todavía no existen (`servicios`, `tramos_fibra`) se omiten solas.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, fmtFecha, hoyISO } from '../assets/js/utiles.js';
import { ROTULO_EQUIPO_TIPO, ROTULO_LICENCIA_TIPO, ROTULO_MAPEO_APLICA_A, ROTULO_MAPEO_METODO, ROTULO_CONFIGURACION_TIPO, ROTULO_CREDENCIAL_TIPO, ROTULO_ESTADO_EQUIPO } from '../assets/js/modelos.js';

const CATEGORIAS_PUESTO = ['PC de escritorio', 'Notebook'];

/** @typedef {{ cab: string[], filas: Array<Array<string|number>>, verificados: Array<string|null|undefined>, titulo?: string, vacio?: string }} Tabla */
/** @typedef {{ titulo?: string, items: string[], verificados: Array<string|null|undefined> }} Lista */
/** @typedef {{ tablas?: Tabla[], listas?: Lista[], notas?: Array<{titulo: string, ficha: string, texto: string, fecha: string}>, parrafos?: string[] }} Contenido */
/** @typedef {{ id: string, titulo: string, ayuda?: string, modulo: string, extra?: string, cargar: () => Contenido }} Seccion */

/** Selección que se recuerda mientras dure la pestaña. @type {Object<string, boolean>} */
let marcadas = {};
let conCredenciales = false;

/** Solo el CSS de impresión; el de pantalla está en assets/css/estilos.css (el @page y el @media print se quedan acá para no cambiar la impresión). */
const ESTILOS = `
@media print{
  @page{size:A4 portrait;margin:16mm 14mm 18mm 14mm;@bottom-center{content:"Documentación de infraestructura · Página " counter(page) " de " counter(pages);font:9pt Arial,sans-serif;color:#000}}
  @page :first{@bottom-center{content:none}}
  html,body{height:auto!important;overflow:visible!important;min-width:0!important;display:block!important;background:#fff!important;color:#000!important}
  body>*:not(#inf-impresion){display:none!important}
  #inf-impresion{display:block!important}
  #inf-impresion .inf-doc{font:10pt/1.35 Arial,Helvetica,sans-serif;color:#000;background:#fff}
  #inf-impresion .inf-doc table{font-size:9pt}
  #inf-impresion .inf-portada{min-height:240mm}
  #inf-impresion .inf-doc *{color:#000!important;background:transparent!important;box-shadow:none!important}
  #inf-impresion .inf-doc th{background:#e6e6e6!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

function inyectarEstilos() {
  if (document.getElementById('inf-estilos')) return;
  const s = document.createElement('style');
  s.id = 'inf-estilos';
  s.textContent = ESTILOS;
  document.head.appendChild(s);
}

/** @param {string} coleccion @param {Object<string, any>|((r: any) => boolean)} filtro @returns {Promise<any[]|null>} null si la colección todavía no existe. */
async function leer(coleccion, filtro) {
  try { return await repositorio.listar(coleccion, filtro); } catch { return null; }
}

/** @param {any} v @returns {string} */
function texto(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.length ? v.map(texto).join(', ') : '—';
  if (typeof v === 'object') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return fmtFecha(v);
  return String(v);
}

/** @param {Array<string|null|undefined>} fechas */
function textoVerificacion(fechas) {
  const f = fechas.filter(/** @returns {x is string} */ x => !!x).sort();
  if (!f.length) return 'Sin fecha de verificación registrada.';
  const a = fmtFecha(f[0]), b = fmtFecha(f[f.length - 1]);
  return a === b ? 'Datos verificados el ' + a + '.' : 'Datos verificados entre el ' + a + ' y el ' + b + '.';
}

/** @param {string} clave */
const esClaveSecreta = clave => /secret|clave|contrase|password|token|psk/i.test(clave);

/** Tabla genérica para colecciones que otro agente define (servicios, tramos de fibra). @param {any[]} regs @param {string} prefijo @returns {Tabla} */
function tablaGenerica(regs, prefijo) {
  /** @type {string[]} */
  const claves = [];
  for (const r of regs) for (const k of Object.keys(r)) {
    if (k.startsWith(prefijo + '_') && !claves.includes(k) && !esClaveSecreta(k) && (r[k] == null || typeof r[k] !== 'object' || Array.isArray(r[k]))) claves.push(k);
  }
  const cols = claves.slice(0, 9);
  const rotulo = (/** @type {string} */ k) => { const t = k.slice(prefijo.length + 1).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  return { cab: cols.map(rotulo), filas: regs.map(r => cols.map(k => texto(r[k]))), verificados: regs.map(r => r.verificado_en) };
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  inyectarEstilos();
  quitarImpresion();
  const u = /** @type {any} */ (sesion.usuarioActual());
  const org = /** @type {string} */ (sesion.organizacionActiva());
  const migas = await migasRaiz();
  pantalla(contenedor, { codigo: 'P28', nombre: 'Documentación de la organización', migas: migas.concat([['Documentación en PDF']]) });
  contenedor.appendChild(h('h1', { text: 'Documentación en PDF' }));

  const organizacion = await repositorio.obtener('organizaciones', org);
  if (!organizacion || !puede(u, 'ver', 'organizacion', org)) {
    contenedor.appendChild(h('div', { class: 'aviso', text: 'Tu rol no tiene acceso a la documentación de esta organización.' }));
    return;
  }

  // ---- datos (una sola lectura)
  const [ubicaciones, equipos, puestos, racks, vlans, wifis, enlaces, configs, mapeos, personas, asignaciones, licencias, instalaciones, credenciales, notasTodas, servicios, tramos] = await Promise.all([
    'ubicaciones', 'equipos', 'puestos', 'racks', 'vlans', 'redes_wifi', 'enlaces_isp', 'configuraciones', 'mapeos_disco', 'personas', 'asignaciones', 'licencias', 'instalaciones_licencia', 'credenciales', 'notas'
  ].map(c => leer(c, { organizacion_id: org }).then(r => r || [])).concat(['servicios', 'tramos_fibra'].map(c => leer(c, { organizacion_id: org }))));
  const nomUb = new Map(ubicaciones.map((x /** @type {any} */) => [x.id, x.ubicacion_nombre]));
  const nomRack = new Map(racks.map((x /** @type {any} */) => [x.id, x.rack_nombre]));
  const mapaEq = new Map(equipos.map((x /** @type {any} */) => [x.id, x]));
  const mapaPuesto = new Map(puestos.map((x /** @type {any} */) => [x.id, x]));
  const mapaPers = new Map(personas.map((x /** @type {any} */) => [x.id, x]));
  const mapaVlan = new Map(vlans.map((x /** @type {any} */) => [x.id, x]));
  const verPersonas = puede(u, 'ver', 'personas', org);
  const ordenar = (/** @type {any[]} */ l, /** @type {string} */ k) => l.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k]), 'es', { numeric: true }));
  const nombreEq = (/** @type {string|null} */ id) => (id && mapaEq.get(id) ? /** @type {any} */ (mapaEq.get(id)).equipo_nombre : '—');
  const ubicDe = (/** @type {any} */ e) => {
    const pu = e.puesto_id ? /** @type {any} */ (mapaPuesto.get(e.puesto_id)) : null;
    const partes = [e.rack_id ? nomRack.get(e.rack_id) : null, (pu && pu.ubicacion_id ? nomUb.get(pu.ubicacion_id) : null) || (e.ubicacion_id ? nomUb.get(e.ubicacion_id) : null)];
    return partes.filter(Boolean).join(' · ') || '—';
  };
  const esEscritorio = (/** @type {any} */ e) => e.equipo_tipo === 'otro' && CATEGORIAS_PUESTO.includes(String(e.equipo_campos && e.equipo_campos.otro_categoria));
  const vigentes = equipos.filter(e => e.equipo_estado !== 'baja');
  const eqRed = ordenar(vigentes.filter(e => e.equipo_tipo !== 'servidor' && !esEscritorio(e)), 'equipo_codigo');
  const eqServ = ordenar(vigentes.filter(e => e.equipo_tipo === 'servidor'), 'equipo_codigo');
  const eqEscr = ordenar(vigentes.filter(esEscritorio), 'equipo_codigo');
  /** @type {Map<string, any[]>} Un equipo puede estar compartido por varias personas (D-072). */
  const asigVigentes = new Map();
  for (const a of asignaciones.filter(x => !x.asignacion_hasta)) asigVigentes.set(a.equipo_id, (asigVigentes.get(a.equipo_id) || []).concat([a]));
  const usoLic = new Map();
  for (const i of instalaciones) if (!i.instalacion_hasta) usoLic.set(i.licencia_id, (usoLic.get(i.licencia_id) || 0) + 1);

  /** @type {Seccion[]} */
  const secciones = [
    { id: 'resumen', titulo: 'Resumen', modulo: 'organizacion', cargar: () => ({
      parrafos: [
        'Organización: ' + organizacion.organizacion_nombre,
        'Rubro: ' + texto(organizacion.organizacion_rubro) + ' · CUIT: ' + texto(organizacion.organizacion_cuit),
        organizacion.organizacion_notas ? 'Notas: ' + organizacion.organizacion_notas : ''
      ].filter(Boolean),
      tablas: [{ titulo: 'Ubicaciones', cab: ['Nombre', 'Tipo', 'Dirección'], filas: ordenar(ubicaciones, 'ubicacion_nombre').map(x => [x.ubicacion_nombre, texto(x.ubicacion_tipo), texto(x.ubicacion_direccion)]), verificados: ubicaciones.map(x => x.verificado_en) }]
    }) },
    { id: 'red', titulo: 'Red: equipos, VLAN, Wi-Fi y enlaces de internet', modulo: 'red', cargar: () => ({ tablas: [
      { titulo: 'Equipos de red', cab: ['Código', 'Nombre', 'Tipo', 'Marca / modelo', 'N.º de serie', 'IP de gestión', 'Sede / sala', 'Estado'],
        filas: eqRed.map(e => [e.equipo_codigo, e.equipo_nombre, ROTULO_EQUIPO_TIPO[e.equipo_tipo] || e.equipo_tipo, [e.equipo_marca, e.equipo_modelo].filter(Boolean).join(' ') || '—', texto(e.equipo_numero_serie), texto(e.equipo_ip_gestion), ubicDe(e), ROTULO_ESTADO_EQUIPO[e.equipo_estado] || texto(e.equipo_estado)]), verificados: eqRed.map(e => e.verificado_en) },
      { titulo: 'VLAN', cab: ['N.º', 'Nombre', 'Red', 'Gateway', 'DHCP', 'Descripción'],
        filas: vlans.slice().sort((a, b) => a.vlan_numero - b.vlan_numero).map(v => [v.vlan_numero, v.vlan_nombre, texto(v.vlan_red_cidr), texto(v.vlan_gateway), v.vlan_dhcp_activo ? 'Sí' + (v.vlan_dhcp_rango ? ' (' + v.vlan_dhcp_rango + ')' : '') : 'No', texto(v.vlan_descripcion)]), verificados: vlans.map(v => v.verificado_en) },
      { titulo: 'Redes Wi-Fi', cab: ['SSID', 'VLAN', 'Seguridad', 'Oculta', 'Access points'],
        filas: wifis.map(w => { const v = /** @type {any} */ (mapaVlan.get(w.vlan_id)); return [w.wifi_ssid, v ? 'VLAN ' + v.vlan_numero + ' · ' + v.vlan_nombre : '—', String(w.wifi_seguridad || '—').toUpperCase(), w.wifi_oculta ? 'Sí' : 'No', (w.access_point_ids || []).length]; }), verificados: wifis.map(w => w.verificado_en) },
      { titulo: 'Enlaces de internet', cab: ['Proveedor', 'Tipo', 'Bajada / subida (Mbps)', 'IP pública', 'Tipo de IP', 'Principal', 'N.º de cliente', 'Soporte'],
        filas: enlaces.map(l => [l.enlace_proveedor, texto(l.enlace_tipo), texto(l.enlace_velocidad_bajada_mbps) + ' / ' + texto(l.enlace_velocidad_subida_mbps), texto(l.enlace_ip_publica), texto(l.enlace_tipo_ip), l.enlace_es_principal ? 'Sí' : 'No', texto(l.enlace_numero_cliente), texto(l.enlace_telefono_soporte)]), verificados: enlaces.map(l => l.verificado_en) }
    ] }) },
    { id: 'puestos', titulo: 'Puestos', modulo: 'red', cargar: () => {
      const ordenados = ordenar(puestos, 'puesto_nombre');
      return { tablas: [{ cab: ['Puesto', 'Boca de pared', 'Sede / sala', 'Equipos', 'Notas'],
        filas: ordenados.map(p => [p.puesto_nombre, texto(p.puesto_boca_pared), p.ubicacion_id ? texto(nomUb.get(p.ubicacion_id)) : '—', equipos.filter(e => e.puesto_id === p.id && e.equipo_estado !== 'baja').map(e => e.equipo_nombre).join(', ') || '—', texto(p.puesto_notas)]), verificados: ordenados.map(p => p.verificado_en) }] };
    } },
    { id: 'servidores', titulo: 'Servidores', modulo: 'servidores', cargar: () => ({ tablas: [{ cab: ['Código', 'Nombre', 'Rol', 'Sistema operativo', 'CPU / RAM', 'IP de gestión', 'Ubicación'],
      filas: eqServ.map(e => { const c = e.equipo_campos || {}; return [e.equipo_codigo, e.equipo_nombre, texto(c.servidor_rol), texto(c.servidor_sistema_operativo), texto(c.servidor_cpu) + (c.servidor_ram_gb ? ' / ' + c.servidor_ram_gb + ' GB' : ''), texto(e.equipo_ip_gestion), ubicDe(e)]; }), verificados: eqServ.map(e => e.verificado_en) }] }) },
    { id: 'racks', titulo: 'Racks', modulo: 'racks', cargar: () => { const l = ordenar(racks, 'rack_nombre'); return { tablas: [{ cab: ['Rack', 'Sede / sala', 'Unidades', 'Equipos instalados', 'Notas'],
      filas: l.map(r => [r.rack_nombre, r.ubicacion_id ? texto(nomUb.get(r.ubicacion_id)) : '—', r.rack_unidades_total, equipos.filter(e => e.rack_id === r.id && e.equipo_estado !== 'baja').length, texto(r.rack_notas)]), verificados: l.map(r => r.verificado_en) }] }; } },
    { id: 'configs', titulo: 'Configuraciones y mapeos de disco', modulo: 'configuraciones', ayuda: 'No se imprime el contenido de las configuraciones.', cargar: () => ({ tablas: [
      { titulo: 'Configuraciones', cab: ['Título', 'Tipo', 'Equipo', 'Versión del', 'Notas'], filas: configs.map(c => [c.configuracion_titulo, ROTULO_CONFIGURACION_TIPO[c.configuracion_tipo] || texto(c.configuracion_tipo), nombreEq(c.equipo_id), fmtFecha(c.configuracion_version_fecha), texto(c.configuracion_notas)]), verificados: configs.map(c => c.verificado_en) },
      { titulo: 'Mapeos de disco', cab: ['Letra', 'Ruta', 'Aplica a', 'Método', 'Servidor'], filas: ordenar(mapeos, 'mapeo_letra').map(m => [m.mapeo_letra, m.mapeo_ruta, (ROTULO_MAPEO_APLICA_A[m.mapeo_aplica_a] || texto(m.mapeo_aplica_a)) + (m.mapeo_grupo ? ': ' + m.mapeo_grupo : ''), ROTULO_MAPEO_METODO[m.mapeo_metodo] || texto(m.mapeo_metodo), nombreEq(m.equipo_id)]), verificados: mapeos.map(m => m.verificado_en) }
    ] }) },
    { id: 'escritorio', titulo: 'Equipos de escritorio y asignaciones', modulo: 'red', cargar: () => ({ tablas: [{ cab: ['Código', 'Equipo', 'Categoría', 'Puesto', 'IP', 'Asignado a', 'Desde'],
      filas: eqEscr.map(e => { const as = asigVigentes.get(e.id) || [], a = as[0], pn = as.map(x => /** @type {any} */ (mapaPers.get(x.persona_id))).filter(Boolean).map(x => x.persona_nombre).join(', '), pu = e.puesto_id ? /** @type {any} */ (mapaPuesto.get(e.puesto_id)) : null;
        return [e.equipo_codigo, e.equipo_nombre, texto(e.equipo_campos && e.equipo_campos.otro_categoria), pu ? pu.puesto_nombre : '—', texto(e.equipo_ip_gestion), !verPersonas ? '—' : pn || 'Sin asignar', !verPersonas || !a ? '—' : fmtFecha(a.asignacion_desde)]; }), verificados: eqEscr.map(e => e.verificado_en) }] }) },
    { id: 'licencias', titulo: 'Licencias (sin claves)', modulo: 'licencias', cargar: () => ({ tablas: [{ cab: ['Producto', 'Tipo', 'Cantidad', 'En uso', 'Vence', 'Proveedor'],
      filas: ordenar(licencias, 'licencia_producto').map(l => [l.licencia_producto, ROTULO_LICENCIA_TIPO[l.licencia_tipo] || texto(l.licencia_tipo), texto(l.licencia_cantidad), usoLic.get(l.id) || 0, fmtFecha(l.licencia_vence_en), texto(l.licencia_proveedor)]), verificados: licencias.map(l => l.verificado_en) }] }) }
  ];
  if (servicios) secciones.push({ id: 'servicios', titulo: 'Dominios y servicios', modulo: 'configuraciones', cargar: () => ({ tablas: [tablaGenerica(servicios, 'servicio')] }) });
  if (tramos) secciones.push({ id: 'fibra', titulo: 'Fibra óptica', modulo: 'red', cargar: () => ({ tablas: [tablaGenerica(tramos, 'tramo')] }) });
  secciones.push({ id: 'notas', titulo: 'Notas', modulo: 'organizacion', ayuda: 'Las notas se imprimen tal cual: revisalas antes de entregar.', cargar: () => {
    const l = notasTodas.filter(n => n.__ok).sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
    return { notas: l.map(n => ({ titulo: n.nota_titulo, ficha: n.__ficha, texto: n.nota_contenido || '', fecha: fmtFecha(n.actualizado_en) })) };
  } });

  // notas: se decide por el módulo de la ficha a la que pertenecen
  for (const n of notasTodas) {
    const mod = await repositorio.moduloDeNota(n);
    n.__ok = puede(u, 'ver', /** @type {any} */ (mod), org);
    const reg = n.entidad_id ? mapaEq.get(n.entidad_id) || mapaPuesto.get(n.entidad_id) || mapaPers.get(n.entidad_id) : null;
    n.__ficha = n.entidad ? n.entidad + (reg ? ': ' + (/** @type {any} */ (reg).equipo_nombre || /** @type {any} */ (reg).puesto_nombre || /** @type {any} */ (reg).persona_nombre) : '') : 'La organización';
  }

  const permitidas = secciones.filter(s => puede(u, 'ver', /** @type {any} */ (s.modulo), org));
  const puedeCred = puede(u, 'ver', 'credenciales', org);
  for (const s of permitidas) if (!(s.id in marcadas)) marcadas[s.id] = true;

  // ---- documento
  const construir = () => {
    const doc = h('div', { class: 'inf-doc' });
    const elegidas = permitidas.filter(s => marcadas[s.id]);
    const conCred = puedeCred && conCredenciales;
    doc.appendChild(h('div', { class: 'inf-portada' }, [
      h('div', { class: 'inf-sub', text: 'Documentación de infraestructura' }),
      h('div', { class: 'inf-org', text: organizacion.organizacion_nombre }),
      h('div', { class: 'inf-sub', text: 'Fecha: ' + fmtFecha(hoyISO()) }),
      h('p', { style: 'margin-top:40px;font-size:12px', text: 'Documento generado con Infradoc. No contiene contraseñas ni claves.' })
    ]));
    const titulos = elegidas.map(s => s.titulo).concat(conCred ? ['Lista de credenciales'] : []);
    doc.appendChild(h('div', { class: 'inf-indice' }, [h('h2', { text: 'Índice' }), titulos.length ? h('ol', null, titulos.map(t => h('li', { text: t }))) : h('p', { class: 'inf-vacio', text: 'No elegiste ninguna sección.' })]));
    let n = 0;
    const tabla = (/** @type {Tabla} */ t) => {
      const caja = h('div');
      if (t.titulo) caja.appendChild(h('h3', { text: t.titulo }));
      if (!t.filas.length) { caja.appendChild(h('p', { class: 'inf-vacio', text: t.vacio || 'Sin datos cargados.' })); return caja; }
      caja.appendChild(h('table', null, [h('thead', null, [h('tr', null, t.cab.map(c => h('th', { text: c })))]), h('tbody', null, t.filas.map(f => h('tr', null, f.map(c => h('td', { text: String(c) })))))]));
      caja.appendChild(h('div', { class: 'inf-verif', text: textoVerificacion(t.verificados) }));
      return caja;
    };
    for (const s of elegidas) {
      n++;
      const c = s.cargar();
      const sec = h('section', { class: 'inf-seccion' }, [h('h2', { text: n + '. ' + s.titulo })]);
      for (const p of c.parrafos || []) sec.appendChild(h('p', { text: p }));
      for (const t of c.tablas || []) sec.appendChild(tabla(t));
      if (c.notas) {
        if (!c.notas.length) sec.appendChild(h('p', { class: 'inf-vacio', text: 'Sin notas.' }));
        for (const x of c.notas) sec.appendChild(h('div', { class: 'inf-nota' }, [h('b', { text: x.titulo }), h('div', { text: x.ficha + ' · actualizada el ' + x.fecha }), h('div', { class: 'inf-txt', text: x.texto })]));
      }
      doc.appendChild(sec);
    }
    if (conCred) {
      n++;
      const l = ordenar(credenciales, 'credencial_nombre');
      const sec = h('section', { class: 'inf-seccion' }, [h('h2', { text: n + '. Lista de credenciales' }), h('p', { text: 'Solo se indica qué credenciales existen. Las contraseñas no se imprimen: están guardadas en Infradoc.' })]);
      if (!l.length) sec.appendChild(h('p', { class: 'inf-vacio', text: 'Sin credenciales cargadas.' }));
      else {
        sec.appendChild(h('ul', null, l.map(c => h('li', { text: 'Credencial: ' + c.credencial_nombre + ' (' + (ROTULO_CREDENCIAL_TIPO[c.credencial_tipo] || 'otro') + (c.credencial_usuario ? ', usuario ' + c.credencial_usuario : '') + ') — contraseña guardada en Infradoc' }))));
        sec.appendChild(h('div', { class: 'inf-verif', text: textoVerificacion(l.map(c => c.verificado_en)) }));
      }
      doc.appendChild(sec);
    }
    return doc;
  };

  // ---- pantalla
  const vista = h('div', { class: 'inf-hoja', 'aria-label': 'Vista previa del informe' });
  const pintar = () => {
    vista.textContent = '';
    const doc = construir();
    vista.appendChild(doc);
    let cont = document.getElementById('inf-impresion');
    if (!cont) { cont = h('div', { id: 'inf-impresion' }); document.body.appendChild(cont); }
    cont.textContent = '';
    cont.appendChild(doc.cloneNode(true));
  };
  const panel = h('div', { class: 'inf-panel' }, [h('h2', { text: 'Qué incluir' })]);
  for (const s of permitidas) {
    const cb = h('input', { type: 'checkbox', id: 'inf-cb-' + s.id });
    /** @type {HTMLInputElement} */ (cb).checked = !!marcadas[s.id];
    cb.addEventListener('change', () => { marcadas[s.id] = /** @type {HTMLInputElement} */ (cb).checked; pintar(); });
    panel.appendChild(h('label', { class: 'inf-op' }, [cb, h('span', null, [s.titulo, s.ayuda ? h('span', { class: 'inf-ayuda', text: s.ayuda }) : null])]));
  }
  if (puedeCred) {
    const cb = h('input', { type: 'checkbox', id: 'inf-cb-credenciales' });
    /** @type {HTMLInputElement} */ (cb).checked = conCredenciales;
    cb.addEventListener('change', () => { conCredenciales = /** @type {HTMLInputElement} */ (cb).checked; pintar(); });
    panel.appendChild(h('div', { class: 'inf-sep' }));
    panel.appendChild(h('label', { class: 'inf-op' }, [cb, h('span', null, ['Incluir lista de credenciales', h('span', { class: 'inf-ayuda', text: 'Solo nombre y usuario. Nunca las contraseñas.' })])]));
  }
  const todas = h('button', { type: 'button', text: 'Marcar todo', onclick: () => { for (const s of permitidas) { marcadas[s.id] = true; const c = /** @type {HTMLInputElement|null} */ (document.getElementById('inf-cb-' + s.id)); if (c) c.checked = true; } pintar(); } });
  const ninguna = h('button', { type: 'button', text: 'Desmarcar todo', onclick: () => { for (const s of permitidas) { marcadas[s.id] = false; const c = /** @type {HTMLInputElement|null} */ (document.getElementById('inf-cb-' + s.id)); if (c) c.checked = false; } pintar(); } });
  const imprimir = h('button', { type: 'button', class: 'primario', text: 'Imprimir / Guardar PDF', onclick: () => {
    if (!permitidas.some(s => marcadas[s.id]) && !(puedeCred && conCredenciales)) { toast('Elegí al menos una sección.'); return; }
    pintar();
    window.print();
  } });
  panel.appendChild(h('div', { class: 'inf-acciones' }, [imprimir, todas, ninguna]));
  panel.appendChild(h('p', { class: 'inf-ayuda', style: 'margin-top:10px', text: 'En la ventana de impresión elegí «Guardar como PDF», tamaño A4 vertical.' }));
  contenedor.appendChild(h('div', { class: 'inf-controles' }, [panel, vista]));
  pintar();

  const salir = () => { if (!location.hash.startsWith('#/informe')) { quitarImpresion(); window.removeEventListener('hashchange', salir); } };
  window.addEventListener('hashchange', salir);
}

function quitarImpresion() {
  const x = document.getElementById('inf-impresion');
  if (x) x.remove();
}
