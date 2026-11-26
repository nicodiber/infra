// @ts-check
/**
 * Alta de configuraciones (colección `configuraciones`): VPN, reenvío de puertos, firewall, Wi-Fi, general.
 * Se abre con `abrirAlta('configuraciones', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `configuracion_tipo`, `configuracion_titulo`, `equipo_id`, `configuracion_version_fecha`, `configuracion_notas`,
 * `configuracion_contenido`, `configuracion_datos` (reglas NAT; lo usa «Duplicar»). El equipo se elige con `selectorConCrear`.
 * Nunca contraseñas en el contenido: para eso, una credencial.
 */

import { h } from '../utiles.js';
import { ROTULO_CONFIGURACION_TIPO } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { entrada, areaTexto, selectorDeRotulos, opcionesEquipos } from './comunes.js';

const NAT = 'nat_reenvio_puertos';

/**
 * Editor de reglas de reenvío de puertos (filas).
 * @param {any[]} inicial
 * @returns {{nodo: HTMLElement, leer: () => any[]}} `leer` lanza `Error` si una regla está incompleta o con puertos fuera de 1 a 65535.
 */
function editorReglas(inicial) {
  /** @type {any[]} */
  const filas = (inicial || []).map(r => ({ protocolo: r.protocolo || 'tcp', puerto_externo: r.puerto_externo ?? '', ip_destino: r.ip_destino || '', puerto_destino: r.puerto_destino ?? '', descripcion: r.descripcion || '' }));
  const cuerpo = h('div');
  const pintar = () => {
    cuerpo.textContent = '';
    if (!filas.length) cuerpo.appendChild(h('div', { class: 'mut', text: 'Todavía no hay reglas.' }));
    filas.forEach((r, i) => {
      const inp = (/** @type {string} */ k, /** @type {string} */ et, /** @type {string} */ ancho) => {
        const e = /** @type {HTMLInputElement} */ (h('input', { value: r[k] == null ? '' : String(r[k]), 'aria-label': et + ' de la regla ' + (i + 1), style: 'width:' + ancho }));
        e.addEventListener('input', () => { r[k] = e.value; });
        return e;
      };
      const proto = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Protocolo de la regla ' + (i + 1) }, ['tcp', 'udp'].map(p => h('option', { value: p, text: p.toUpperCase() }))));
      proto.value = r.protocolo; proto.addEventListener('change', () => { r.protocolo = proto.value; });
      cuerpo.appendChild(h('div', { class: 'herr', style: 'margin:4px 0;flex-wrap:wrap' }, [proto, inp('puerto_externo', 'Puerto externo', '90px'), inp('ip_destino', 'IP destino', '130px'),
        inp('puerto_destino', 'Puerto destino', '90px'), inp('descripcion', 'Descripción', '180px'),
        h('button', { type: 'button', class: 'chico', text: 'Quitar', 'aria-label': 'Quitar la regla ' + (i + 1), onclick: () => { filas.splice(i, 1); pintar(); } })]));
    });
  };
  pintar();
  return {
    nodo: h('div', null, [cuerpo, h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'chico', text: 'Agregar regla', onclick: () => { filas.push({ protocolo: 'tcp', puerto_externo: '', ip_destino: '', puerto_destino: '', descripcion: '' }); pintar(); } })])]),
    leer: () => {
      const llenas = filas.filter(r => String(r.puerto_externo).trim() || String(r.ip_destino).trim() || String(r.puerto_destino).trim());
      return llenas.map(r => {
        const pe = Number(r.puerto_externo), pd = Number(r.puerto_destino);
        if (!(pe >= 1 && pe <= 65535) || !(pd >= 1 && pd <= 65535) || !String(r.ip_destino).trim()) throw new Error('Cada regla necesita puerto externo, IP destino y puerto destino válidos (1 a 65535).');
        return { protocolo: r.protocolo || 'tcp', puerto_externo: pe, ip_destino: String(r.ip_destino).trim(), puerto_destino: pd, descripcion: String(r.descripcion || '').trim() };
      });
    }
  };
}

registrarAlta('configuraciones', async ctx => {
  const v = ctx.valores;
  const id = { titulo: idUnico('cf-titulo'), tipo: idUnico('cf-tipo'), equipo: idUnico('cf-equipo'), fecha: idUnico('cf-fecha'), notas: idUnico('cf-notas'), contenido: idUnico('cf-contenido') };
  const titulo = entrada(id.titulo, v.configuracion_titulo, { maxlength: '160', placeholder: 'Ej.: VPN planta ↔ oficina comercial' });
  const tipo = selectorDeRotulos(id.tipo, ROTULO_CONFIGURACION_TIPO, v.configuracion_tipo || 'general');
  const fecha = entrada(id.fecha, v.configuracion_version_fecha, { type: 'date' });
  const notas = areaTexto(id.notas, v.configuracion_notas, 2);
  const contenido = areaTexto(id.contenido, v.configuracion_contenido, 8, { class: 'pre' });
  const equipo = selectorConCrear({ desde: 'configuraciones', campo: 'equipo_id', organizacion_id: ctx.organizacion_id, valor: v.equipo_id || null, id: id.equipo,
    cargarOpciones: () => opcionesEquipos(ctx.organizacion_id), rotuloOrigen: 'Nueva configuración' });
  const reglas = editorReglas(Array.isArray(v.configuracion_datos) ? v.configuracion_datos : []);
  const cReglas = h('div', { class: 'campo ancho' }, [h('label', { text: 'Reglas de reenvío de puertos' }), reglas.nodo]);
  const ajustar = () => { cReglas.hidden = tipo.value !== NAT; };
  tipo.addEventListener('change', ajustar); ajustar();
  return abrirFormularioDeAlta({
    titulo: 'Nueva configuración', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva configuración' ? ctx.rotulo : null, textoGuardar: 'Crear configuración', enfocar: titulo,
    secciones: [{ titulo: 'Identificación', cuerpo: [campoDeAlta(id.titulo, 'Título *', titulo), campoDeAlta(id.tipo, 'Tipo *', tipo), campoDeAlta(id.equipo, 'Equipo', equipo), campoDeAlta(id.fecha, 'Fecha de la versión', fecha)] },
      { titulo: 'Contenido', cuerpo: [cReglas, campoDeAlta(id.contenido, 'Contenido', contenido, 'Nunca escribas contraseñas acá: usá una línea «[ver credencial «Nombre»]» y cargá la contraseña en Credenciales.')] }],
    mas: { resumen: 'notas', cuerpo: [campoDeAlta(id.notas, 'Notas', notas)] },
    alGuardar: async () => {
      if (!titulo.value.trim()) throw new Error('Escribí el título de la configuración.');
      const datos = tipo.value === NAT ? reglas.leer() : null;
      return repositorio.guardar('configuraciones', { organizacion_id: ctx.organizacion_id, configuracion_titulo: titulo.value.trim(), configuracion_tipo: tipo.value,
        equipo_id: equipo.value || null, configuracion_version_fecha: fecha.value || null, configuracion_notas: notas.value.trim() || null,
        configuracion_contenido: contenido.value, configuracion_datos: datos }, ctx.usuario.id);
    }
  });
});
