// @ts-check
/**
 * Sugerencias a partir de lo ya cargado: marca y modelo más usados, nombre con numeración («SW-PLA-04» detrás de «SW-PLA-03»)
 * y «Igual que <último equipo del mismo tipo>». Son funciones puras sobre listas de registros más un par de ayudas de pantalla
 * (`chipsDeSugerencia`). Las usan los formularios de alta y la edición en las fichas.
 */

import { h, normalizar } from './utiles.js';

/**
 * Valores más usados de un campo (sin repetir por mayúsculas o acentos), del más al menos frecuente.
 * @param {any[]} registros @param {(r: any) => any} leer @param {number} [cuantos]
 * @returns {string[]}
 */
export function masUsados(registros, leer, cuantos) {
  /** @type {Map<string, {texto: string, n: number}>} */
  const cuenta = new Map();
  for (const r of registros) {
    const t = String(leer(r) == null ? '' : leer(r)).trim();
    if (!t) continue;
    const k = normalizar(t);
    const x = cuenta.get(k);
    if (x) x.n++; else cuenta.set(k, { texto: t, n: 1 });
  }
  return Array.from(cuenta.values()).sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto, 'es')).slice(0, cuantos || 4).map(x => x.texto);
}

/**
 * Si los nombres forman una serie con número al final, propone el que sigue.
 * `SW-PLA-01`, `SW-PLA-02`, `SW-PLA-03` → `SW-PLA-04` y la ayuda «Sigue la serie: SW-PLA-01 a 03 ya existen.».
 * Con varias series, la más numerosa.
 * @param {string[]} nombres
 * @returns {{sugerido: string, ayuda: string}|null}
 */
export function siguienteEnSerie(nombres) {
  /** @type {Map<string, Array<{n: number, ancho: number, nombre: string}>>} */
  const series = new Map();
  for (const nombre of nombres) {
    const m = /^(.*\D)(\d+)$/.exec(String(nombre || '').trim());
    if (!m) continue;
    const l = series.get(m[1]) || [];
    l.push({ n: parseInt(m[2], 10), ancho: m[2].length, nombre: nombre.trim() });
    series.set(m[1], l);
  }
  /** @type {{prefijo: string, lista: Array<{n: number, ancho: number, nombre: string}>}|null} */
  let mejor = null;
  for (const [prefijo, lista] of series) {
    const max = Math.max(...lista.map(x => x.n));
    if (!mejor || lista.length > mejor.lista.length || (lista.length === mejor.lista.length && max > Math.max(...mejor.lista.map(x => x.n)))) mejor = { prefijo, lista };
  }
  if (!mejor) return null;
  const orden = mejor.lista.slice().sort((a, b) => a.n - b.n);
  const ultimo = orden[orden.length - 1], primero = orden[0];
  const sugerido = mejor.prefijo + String(ultimo.n + 1).padStart(ultimo.ancho, '0');
  const ayuda = orden.length === 1 ? 'Sigue la serie: ' + primero.nombre + ' ya existe.'
    : 'Sigue la serie: ' + primero.nombre + ' a ' + String(ultimo.n).padStart(ultimo.ancho, '0') + ' ya existen.';
  return { sugerido, ayuda };
}

/**
 * El registro creado más recientemente (por `creado_en`).
 * @param {any[]} registros @returns {any|null}
 */
export function ultimoCreado(registros) {
  let u = null;
  for (const r of registros) if (!u || String(r.creado_en || '') > String(u.creado_en || '')) u = r;
  return u;
}

/**
 * @typedef {Object} Sugerencia
 * @property {string} texto Lo que dice el botón.
 * @property {boolean} [destacada] Estilo de propuesta principal.
 * @property {() => void} alElegir Qué hace al tocarla.
 */

/**
 * Fila de botones de sugerencia (`.sug`). Devuelve el contenedor y `pintar(lista)` para cambiar las opciones (por ejemplo,
 * los modelos de la marca elegida). Sin sugerencias, el contenedor queda oculto.
 * @returns {{nodo: HTMLElement, pintar: (lista: Sugerencia[]) => void}}
 */
export function chipsDeSugerencia() {
  const nodo = h('div', { class: 'sugerencias', hidden: 'hidden' });
  /** @param {Sugerencia[]} lista */
  const pintar = lista => {
    nodo.textContent = '';
    for (const s of lista) nodo.appendChild(h('button', { type: 'button', class: 'sug' + (s.destacada ? ' prop' : ''), text: s.texto, onclick: s.alElegir }));
    nodo.hidden = !lista.length;
  };
  return { nodo, pintar };
}

/**
 * Escribe un valor en un campo como si lo hubiera tipeado el usuario (para que validaciones y vista previa se enteren).
 * @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} control @param {string} valor
 */
export function escribirEn(control, valor) {
  control.value = valor;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}
