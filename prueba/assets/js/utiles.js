// @ts-check
/**
 * Utilidades compartidas: armado del DOM (siempre con textContent, nunca innerHTML), íconos, fechas en formato
 * local (DD/MM/AAAA), normalización de texto para buscar y estado de verificación.
 */

// ---------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------

/**
 * Crea un elemento. `attrs.text` va como textContent; `attrs.class` como className; `onXxx` agrega un listener.
 * Los hijos pueden ser nodos o texto (el texto se agrega como nodo de texto, nunca como HTML).
 * @param {string} tag
 * @param {Object<string, any>|null} [attrs]
 * @param {Array<Node|string|null|undefined|false>} [hijos]
 * @returns {HTMLElement}
 */
export function h(tag, attrs, hijos) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of hijos || []) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

/** Vacía un contenedor. @param {Element} el */
export function vaciar(el) { el.textContent = ''; }

/**
 * Tabla simple. Celdas: texto o nodo.
 * @param {string[]} cabeceras
 * @param {Array<Array<Node|string|number>>} filas
 * @param {{onFila?: (fila: any[], i: number) => void, tipo?: string, clase?: string}} [opciones]
 */
export function tabla(cabeceras, filas, opciones) {
  const o = opciones || {};
  const t = h('table', { class: [o.tipo ? 'conTipo t-' + o.tipo : '', o.clase || ''].join(' ').trim() || null });
  t.appendChild(h('thead', null, [h('tr', null, cabeceras.map(c => h('th', { text: c })))]));
  const tb = h('tbody');
  filas.forEach((f, i) => {
    const onFila = o.onFila;
    const attrs = onFila ? { class: 'clic', tabindex: '0', onclick: () => onFila(f, i), onkeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') onFila(f, i); } } : null;
    // data-label: en el celular la tabla se ve como tarjetas (estilos.css)
    const rotulo = (/** @type {number} */ j) => (typeof cabeceras[j] === 'string' && cabeceras[j]) ? cabeceras[j] : null;
    tb.appendChild(h('tr', attrs, f.map((c, j) => (c instanceof Node) ? h('td', { 'data-label': rotulo(j) }, [c]) : h('td', { text: String(c), 'data-label': rotulo(j) }))));
  });
  t.appendChild(tb);
  return t;
}

// ---------------------------------------------------------------------------------------------
// Íconos (markup propio y constante; nunca se arma con datos del usuario)
// ---------------------------------------------------------------------------------------------

/** @type {Object<string, string>} */
const ICONOS = {
  credencial: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>',
  equipo: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
  servidor: '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9 7h6M9 11h6M9 15h2M15 17.5h.01"/>',
  configuracion: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  vlan: '<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M12 7.2v4.3M12 11.5L6 17M12 11.5L18 17"/>',
  puerto: '<rect x="4" y="7" width="16" height="11" rx="1.5"/><path d="M8 18v-4M11 18v-4M14 18v-4M17 18v-4M8 7V5h8v2"/>',
  wifi: '<path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10.5 10.5 0 0 1 13 0M8.6 16a6 6 0 0 1 6.8 0"/><path d="M12 19.5h.01"/>',
  red: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  rack: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 9h14M5 15h14M8 6h.01M8 12h.01M8 18h.01"/>',
  buscar: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  inicio: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/>',
  edificio: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  luna: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  usuarios: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5.5a3 3 0 0 1 0 5.8M18 14.5c1.8.8 3 2.6 3 5.5"/>',
  solicitudes: '<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
  accesos: '<path d="M7 4h10a1 1 0 0 1 1 1v15H6V5a1 1 0 0 1 1-1z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
  datos: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alerta: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  pregunta: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1.9-1.1 1.7M12 17h.01"/>',
  escritorio: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  licencia: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h4"/><circle cx="16" cy="17" r="1.5"/>',
  nota: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 11h8M8 15h8M8 19h5"/>',
  puesto: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M9 20h6M12 15v5"/>',
  abrir: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  construccion: '<path d="M4 20h16M6 20V10l6-6 6 6v10"/><path d="M10 20v-5h4v5"/>'
};

/** @type {Map<string, Element>} */
const MOLDES_ICONO = new Map();

/**
 * Ícono SVG inline (hereda el color del texto).
 * @param {string} nombre
 * @param {string} [clase]
 */
export function icono(nombre, clase) {
  const s = document.createElement('span');
  s.className = ('ico ' + (clase || '')).trim();
  s.setAttribute('aria-hidden', 'true');
  let molde = MOLDES_ICONO.get(nombre);
  if (!molde) {
    const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONOS[nombre] || '') + '</svg>';
    molde = document.importNode(new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement, true);
    MOLDES_ICONO.set(nombre, molde);
  }
  s.appendChild(molde.cloneNode(true));
  return s;
}

/** Completa los `[data-icon]` que están escritos a mano en index.html. */
export function pintarIconosEstaticos() {
  document.querySelectorAll('[data-icon]').forEach(el => {
    el.textContent = '';
    el.setAttribute('aria-hidden', 'true');
    el.appendChild(/** @type {Node} */ (icono(/** @type {HTMLElement} */ (el).dataset.icon || '').firstChild));
  });
}

// ---------------------------------------------------------------------------------------------
// Aviso emergente
// ---------------------------------------------------------------------------------------------

/** @type {number} */
let temporizadorToast = 0;

/** @param {string} msg */
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(temporizadorToast);
  temporizadorToast = window.setTimeout(() => { t.style.display = 'none'; }, 3600);
}

// ---------------------------------------------------------------------------------------------
// Fechas: se guardan en ISO 8601 y se muestran como DD/MM/AAAA (zona horaria de Argentina)
// ---------------------------------------------------------------------------------------------

const ZONA = 'America/Argentina/Buenos_Aires';
const FORMATO_PARTES = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

/**
 * @param {string|Date} iso
 * @returns {{d: string, m: string, a: string, hh: string, mm: string}}
 */
function partes(iso) {
  /** @type {Object<string, string>} */
  const p = {};
  for (const x of FORMATO_PARTES.formatToParts(typeof iso === 'string' ? new Date(iso) : iso)) p[x.type] = x.value;
  return { d: p.day, m: p.month, a: p.year, hh: p.hour, mm: p.minute };
}

/** Fecha (con o sin hora) a «DD/MM/AAAA». Una fecha sola (`2026-12-15`) no se corre de huso. @param {string|null|undefined} iso */
export function fmtFecha(iso) {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  const p = partes(iso);
  return `${p.d}/${p.m}/${p.a}`;
}

/** Fecha y hora a «DD/MM/AAAA HH:MM». @param {string|null|undefined} iso */
export function fmtFechaHora(iso) {
  if (!iso) return '—';
  const p = partes(iso);
  return `${p.d}/${p.m}/${p.a} ${p.hh}:${p.mm}`;
}

/** Fecha de hoy («AAAA-MM-DD») en la zona horaria de Argentina. */
export function hoyISO() {
  const p = partes(new Date());
  return `${p.a}-${p.m}-${p.d}`;
}

/** Fecha-hora actual en ISO 8601 con huso -03:00. */
export function ahoraISO() {
  const p = partes(new Date());
  const s = String(new Date().getSeconds()).padStart(2, '0');
  return `${p.a}-${p.m}-${p.d}T${p.hh}:${p.mm}:${s}-03:00`;
}

/** @param {string} a @param {string} b Diferencia en días (b − a) entre dos fechas «AAAA-MM-DD». */
function diasEntre(a, b) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
}

/** Días desde la fecha dada hasta hoy (positivo = pasó). @param {string} iso */
export function diasDesde(iso) {
  const p = partes(iso);
  return diasEntre(`${p.a}-${p.m}-${p.d}`, hoyISO());
}

/** Días desde hoy hasta una fecha «AAAA-MM-DD» (positivo = falta). @param {string} fecha */
export function diasHasta(fecha) { return diasEntre(hoyISO(), fecha.slice(0, 10)); }

/** «hoy», «ayer», «hace 8 días», «hace 5 meses»… @param {string} iso */
export function textoHace(iso) {
  const dias = diasDesde(iso);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 31) return 'hace ' + dias + ' días';
  const meses = Math.floor(dias / 30.4);
  if (meses < 24) return 'hace ' + meses + (meses === 1 ? ' mes' : ' meses');
  return 'hace ' + Math.floor(dias / 365) + ' años';
}

/** «en 23 días», «mañana», «venció hace 5 días»… @param {string} fecha «AAAA-MM-DD» */
export function textoVence(fecha) {
  const d = diasHasta(fecha);
  if (d === 0) return 'vence hoy';
  if (d === 1) return 'vence mañana';
  if (d > 1) return d < 61 ? 'en ' + d + ' días' : 'en ' + Math.round(d / 30.4) + ' meses';
  return d === -1 ? 'venció ayer' : 'venció hace ' + (-d) + ' días';
}

// ---------------------------------------------------------------------------------------------
// Verificación (D-041, D-045, D-046)
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Umbrales
 * @property {number} aRevisar Días desde los que un elemento figura «a revisar».
 * @property {number} viejo Días desde los que figura «viejo».
 */

/**
 * Estado de verificación según los umbrales del superadmin.
 * @param {string} verificadoEn
 * @param {Umbrales} umbrales
 * @returns {{nivel: 'vigente'|'revisar'|'viejo', dias: number, texto: string, corto: string, icono: string}}
 */
export function estadoVerificacion(verificadoEn, umbrales) {
  const dias = diasDesde(verificadoEn);
  const nivel = dias >= umbrales.viejo ? 'viejo' : dias >= umbrales.aRevisar ? 'revisar' : 'vigente';
  const cuando = textoHace(verificadoEn);
  return {
    nivel, dias,
    texto: 'Verificado ' + cuando + (nivel === 'revisar' ? ' · a revisar' : nivel === 'viejo' ? ' · desactualizado' : ''),
    corto: dias <= 0 ? 'Hoy' : dias < 31 ? dias + ' d' : dias < 730 ? Math.floor(dias / 30.4) + ' m' : Math.floor(dias / 365) + ' a',
    icono: nivel === 'vigente' ? 'check' : nivel === 'revisar' ? 'reloj' : 'alerta'
  };
}

/**
 * Indicador con ícono y texto (legible sin color).
 * @param {string} verificadoEn
 * @param {Umbrales} umbrales
 * @param {boolean} [chica]
 */
export function indicadorVerificacion(verificadoEn, umbrales, chica) {
  const a = estadoVerificacion(verificadoEn, umbrales);
  const clase = { vigente: 'v-reciente', revisar: 'v-revisar', viejo: 'v-viejo' }[a.nivel];
  return h('span', { class: 'verif ' + clase + (chica ? ' chica' : ''), title: a.texto + ' (' + fmtFecha(verificadoEn) + ')' },
    [icono(a.icono), chica ? a.corto : a.texto]);
}

// ---------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------

/** Minúsculas y sin tildes: para comparar y buscar. @param {string} s */
export function normalizar(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Marca coincidencias con <mark> armando nodos a mano (nunca con innerHTML). @param {string} texto @param {string[]} palabras */
export function resaltar(texto, palabras) {
  const frag = document.createDocumentFragment();
  const chars = Array.from(texto);
  const nc = chars.map(c => normalizar(c));
  if (!palabras.length || nc.some(n => n.length !== 1)) { frag.append(texto); return frag; }
  const n = nc.join('');
  const marca = new Array(chars.length).fill(false);
  for (const p of palabras) {
    let i = n.indexOf(p);
    while (i !== -1) { for (let k = i; k < i + p.length; k++) marca[k] = true; i = n.indexOf(p, i + 1); }
  }
  let i = 0;
  while (i < chars.length) {
    let j = i;
    while (j < chars.length && marca[j] === marca[i]) j++;
    const seg = chars.slice(i, j).join('');
    frag.append(marca[i] ? h('mark', null, [seg]) : seg);
    i = j;
  }
  return frag;
}

/** Iniciales para el avatar. @param {string} nombre */
export function iniciales(nombre) {
  return nombre.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
}

/** Descarga un texto como archivo. @param {string} nombre @param {string} texto */
export function descargarTexto(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  const a = h('a', { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
