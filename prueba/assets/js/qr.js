// @ts-check
/**
 * Generador de códigos QR propio (sin bibliotecas ni CDN): modo byte (UTF-8), corrección de errores M,
 * versiones 1 a 10 (hasta 213 bytes), máscara elegida por penalización. Salida: matriz de módulos o SVG.
 * Sigue ISO/IEC 18004; la verificación de legibilidad está en docs/desarrollo (se decodifica con OpenCV).
 */

const NS = 'http://www.w3.org/2000/svg';
const VERSION_MIN = 1, VERSION_MAX = 10;
/** Códigos de corrección por bloque y cantidad de bloques, nivel M, versiones 1..10 (índice = versión). */
const ECC_POR_BLOQUE = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOQUES = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

/** @param {number} ver */
function modulosDeDatosCrudos(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/** Palabras de datos que caben en la versión. @param {number} ver */
function palabrasDeDatos(ver) {
  return Math.floor(modulosDeDatosCrudos(ver) / 8) - ECC_POR_BLOQUE[ver] * BLOQUES[ver];
}

/** Multiplicación en GF(256) con polinomio 0x11D. @param {number} x @param {number} y */
function mulGF(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** @param {number} grado */
function divisorRS(grado) {
  const r = new Array(grado).fill(0);
  r[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < grado; j++) {
      r[j] = mulGF(r[j], raiz);
      if (j + 1 < grado) r[j] ^= r[j + 1];
    }
    raiz = mulGF(raiz, 0x02);
  }
  return r;
}

/** @param {number[]} datos @param {number[]} divisor */
function restoRS(datos, divisor) {
  const r = divisor.map(() => 0);
  for (const b of datos) {
    const factor = b ^ /** @type {number} */ (r.shift());
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= mulGF(c, factor); });
  }
  return r;
}

/** Posiciones de los patrones de alineación. @param {number} ver @param {number} tam */
function posicionesAlineacion(ver, tam) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const paso = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = tam - 7; r.length < n; pos -= paso) r.splice(1, 0, pos);
  return r;
}

/** @param {number} x @param {number} i */
const bit = (x, i) => ((x >>> i) & 1) !== 0;

/**
 * @param {number[]} datos Palabras de datos (sin corrección).
 * @param {number} ver
 * @returns {number[]} Datos y corrección intercalados.
 */
function agregarCorreccion(datos, ver) {
  const nBloques = BLOQUES[ver], largoEcc = ECC_POR_BLOQUE[ver];
  const crudas = Math.floor(modulosDeDatosCrudos(ver) / 8);
  const cortos = nBloques - (crudas % nBloques);
  const largoCorto = Math.floor(crudas / nBloques);
  const divisor = divisorRS(largoEcc);
  /** @type {number[][]} */
  const bloques = [];
  for (let i = 0, k = 0; i < nBloques; i++) {
    const largo = largoCorto - largoEcc + (i < cortos ? 0 : 1);
    const dat = datos.slice(k, k + largo);
    k += largo;
    const ecc = restoRS(dat, divisor);
    if (i < cortos) dat.push(0);
    bloques.push(dat.concat(ecc));
  }
  /** @type {number[]} */
  const r = [];
  for (let i = 0; i < bloques[0].length; i++) {
    bloques.forEach((b, j) => { if (i !== largoCorto - largoEcc || j >= cortos) r.push(b[i]); });
  }
  return r;
}

/** Penalización de una matriz según ISO 18004 (reglas N1 a N4). @param {boolean[][]} m */
function penalizacion(m) {
  const tam = m.length;
  let p = 0;
  // N1: rachas de 5 o más módulos iguales en filas y columnas. N3: patrón tipo buscador (1:1:3:1:1) con 4 claros.
  for (let eje = 0; eje < 2; eje++) {
    for (let a = 0; a < tam; a++) {
      let linea = '';
      let racha = 1;
      for (let b = 0; b < tam; b++) {
        const v = eje === 0 ? m[a][b] : m[b][a];
        linea += v ? '1' : '0';
        if (b > 0) {
          const ant = eje === 0 ? m[a][b - 1] : m[b - 1][a];
          if (v === ant) { racha++; if (racha === 5) p += 3; else if (racha > 5) p++; } else racha = 1;
        }
      }
      for (let b = 0; b + 11 <= tam; b++) {
        const t = linea.substr(b, 11);
        if (t === '10111010000' || t === '00001011101') p += 40;
      }
    }
  }
  // N2: bloques de 2x2 del mismo color.
  for (let y = 0; y < tam - 1; y++) {
    for (let x = 0; x < tam - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  }
  // N4: proporción de oscuros.
  let oscuros = 0;
  for (const f of m) for (const v of f) if (v) oscuros++;
  const total = tam * tam;
  p += Math.max(0, Math.ceil(Math.abs(oscuros * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/**
 * Calcula la matriz de módulos del QR.
 * @param {string} texto Se codifica en UTF-8.
 * @returns {{tam: number, version: number, mascara: number, modulos: boolean[][]}}
 */
export function qrMatriz(texto) {
  const bytes = Array.from(new TextEncoder().encode(String(texto)));
  let ver = VERSION_MIN;
  for (; ; ver++) {
    if (ver > VERSION_MAX) throw new Error('El texto es demasiado largo para el generador de QR (máximo 213 bytes).');
    const bitsCuenta = ver < 10 ? 8 : 16;
    if (4 + bitsCuenta + 8 * bytes.length <= palabrasDeDatos(ver) * 8) break;
  }
  // ---- secuencia de bits de datos
  /** @type {number[]} */
  const bits = [];
  /** @param {number} val @param {number} n */
  const poner = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  poner(0b0100, 4);
  poner(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) poner(b, 8);
  const capacidad = palabrasDeDatos(ver) * 8;
  poner(0, Math.min(4, capacidad - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xEC; bits.length < capacidad; pad ^= 0xEC ^ 0x11) poner(pad, 8);
  /** @type {number[]} */
  const palabras = new Array(bits.length / 8).fill(0);
  bits.forEach((b, i) => { palabras[i >>> 3] |= b << (7 - (i & 7)); });
  const todas = agregarCorreccion(palabras, ver);

  // ---- matriz con patrones de función
  const tam = ver * 4 + 17;
  /** @type {boolean[][]} */
  const m = Array.from({ length: tam }, () => new Array(tam).fill(false));
  /** @type {boolean[][]} */
  const fn = Array.from({ length: tam }, () => new Array(tam).fill(false));
  /** @param {number} x @param {number} y @param {boolean} v */
  const set = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };

  for (let i = 0; i < tam; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  /** @param {number} cx @param {number} cy */
  const buscador = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < tam && y >= 0 && y < tam) set(x, y, d !== 2 && d !== 4);
    }
  };
  buscador(3, 3); buscador(tam - 4, 3); buscador(3, tam - 4);
  const al = posicionesAlineacion(ver, tam);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  /** Bits de formato (nivel M = 0b00). @param {number} mascara */
  const formato = mascara => {
    const dato = (0 << 3) | mascara;
    let r = dato;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits15 = ((dato << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits15, i));
    set(8, 7, bit(bits15, 6)); set(8, 8, bit(bits15, 7)); set(7, 8, bit(bits15, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits15, i));
    for (let i = 0; i < 8; i++) set(tam - 1 - i, 8, bit(bits15, i));
    for (let i = 8; i < 15; i++) set(8, tam - 15 + i, bit(bits15, i));
    set(8, tam - 8, true);
  };
  formato(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const bits18 = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const c = bit(bits18, i), a = tam - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, c); set(b, a, c);
    }
  }

  // ---- datos en zigzag
  let k = 0;
  for (let derecha = tam - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let v = 0; v < tam; v++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const arriba = ((derecha + 1) & 2) === 0;
        const y = arriba ? tam - 1 - v : v;
        if (!fn[y][x] && k < todas.length * 8) { m[y][x] = bit(todas[k >>> 3], 7 - (k & 7)); k++; }
      }
    }
  }

  /** @param {number} mascara */
  const aplicar = mascara => {
    for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
      let inv;
      switch (mascara) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0; break;
        default: inv = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
      }
      if (!fn[y][x] && inv) m[y][x] = !m[y][x];
    }
  };
  let mejor = 0, peor = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    aplicar(mk); formato(mk);
    const p = penalizacion(m);
    if (p < peor) { peor = p; mejor = mk; }
    aplicar(mk); // deshace
  }
  aplicar(mejor); formato(mejor);
  return { tam, version: ver, mascara: mejor, modulos: m };
}

/**
 * Arma el QR como elemento SVG (blanco y negro, bordes nítidos).
 * @param {string} texto
 * @param {{modulos?: number, margen?: number, ancho?: string, oscuro?: string, claro?: string}} [opciones]
 *   `modulos`: lado de cada módulo en píxeles (si se da, fija ancho y alto del SVG); `margen`: zona de silencio en módulos (4 por norma, 2 mínimo);
 *   `ancho`: ancho CSS alternativo (por ejemplo «36mm»); `oscuro` y `claro`: colores (por defecto negro y blanco).
 * @returns {SVGSVGElement}
 */
export function qrSvg(texto, opciones) {
  const o = opciones || {};
  const margen = o.margen == null ? 4 : o.margen;
  const { tam, modulos } = qrMatriz(texto);
  const lado = tam + margen * 2;
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('viewBox', '0 0 ' + lado + ' ' + lado);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Código QR');
  if (o.modulos) { svg.setAttribute('width', String(lado * o.modulos)); svg.setAttribute('height', String(lado * o.modulos)); }
  else if (o.ancho) { svg.setAttribute('width', o.ancho); svg.setAttribute('height', o.ancho); }
  const fondo = document.createElementNS(NS, 'rect');
  fondo.setAttribute('width', String(lado)); fondo.setAttribute('height', String(lado)); fondo.setAttribute('fill', o.claro || '#ffffff');
  svg.appendChild(fondo);
  let d = '';
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (modulos[y][x]) d += 'M' + (x + margen) + ' ' + (y + margen) + 'h1v1h-1z';
  const trazo = document.createElementNS(NS, 'path');
  trazo.setAttribute('d', d); trazo.setAttribute('fill', o.oscuro || '#000000');
  svg.appendChild(trazo);
  return svg;
}
