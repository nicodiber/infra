// @ts-check
/**
 * Ficha de un enlace a Internet (D-072). Ruta: `#/enlace/<id>`. Solo lectura: proveedor, servicio, IP pública, soporte, el equipo donde
 * termina y el puerto (de router o firewall) al que llega. Se llega desde «¿A qué va?» de un puerto y desde Red › Enlaces ISP.
 */

import * as repositorio from '../assets/js/repositorio.js';
import { puede } from '../assets/js/permisos.js';
import { ir } from '../assets/js/marco.js';
import { h, tabla } from '../assets/js/utiles.js';
import { inyectarEstilos, cargarContexto, leerRuta, encabezado, campo, enlace, avisoVista, fichaCab, textoUltimoCambio, hashEquipo, ROTULO_ENLACE_TIPO, ROTULO_ESTADO_PUERTO } from '../assets/js/red.js';

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  inyectarEstilos();
  const ctx = await cargarContexto();
  const id = leerRuta().partes[0];
  const l = id ? await repositorio.obtener('enlaces_isp', id) : null;
  await encabezado(contenedor, 'P05', 'Ficha de enlace a Internet', [['Red', '#/red/equipos'], ['Enlaces ISP', '#/red/isp'], [l ? l.enlace_proveedor : 'Enlace']]);
  if (!puede(ctx.u, 'ver', 'red', ctx.org)) { avisoVista(contenedor, 'Tu rol no tiene acceso al módulo Red.'); return; }
  if (!l || l.organizacion_id !== ctx.org) { avisoVista(contenedor, 'No encontramos ese enlace en esta organización (puede haberse dado de baja).'); return; }
  const armar = async () => {
    while (contenedor.children.length > 2) contenedor.removeChild(/** @type {Node} */ (contenedor.lastChild));
    const actual = await repositorio.obtener('enlaces_isp', id);
    if (actual) await dibujar(contenedor, ctx, actual, armar);
  };
  await dibujar(contenedor, ctx, l, armar);
}

/** @param {HTMLElement} cont @param {import('../assets/js/red.js').Contexto} ctx @param {any} l @param {() => Promise<void>} rearmar */
async function dibujar(cont, ctx, l, rearmar) {
  const [equipos, puertos] = await Promise.all([repositorio.listar('equipos', { organizacion_id: ctx.org }), repositorio.listar('puertos', p => p.enlace_isp_id === l.id)]);
  const me = new Map(equipos.map(e => [e.id, e]));
  const termina = l.equipo_id ? me.get(l.equipo_id) : null;
  const datos = h('div', { class: 'datos' }, [
    campo('Proveedor', l.enlace_proveedor), campo('Rol', l.enlace_es_principal ? 'Principal' : 'Respaldo'),
    campo('Servicio', (ROTULO_ENLACE_TIPO[l.enlace_tipo] || l.enlace_tipo) + ' · ' + (l.enlace_velocidad_bajada_mbps ?? '—') + '/' + (l.enlace_velocidad_subida_mbps ?? '—') + ' Mbps (bajada/subida)'),
    campo('IP pública', l.enlace_ip_publica ? l.enlace_ip_publica + (l.enlace_tipo_ip ? ' (' + (l.enlace_tipo_ip === 'fija' ? 'fija' : 'dinámica') + ')' : '') : null),
    campo('Teléfono de soporte', l.enlace_telefono_soporte), campo('N.º de cliente', l.enlace_numero_cliente),
    campo('Termina en', termina ? enlace(termina.equipo_nombre, hashEquipo(termina)) : null)]);
  cont.appendChild(fichaCab({ ctx, tipo: 'equipo', etiqueta: 'enlace a Internet', titulo: l.enlace_proveedor + (l.enlace_es_principal ? ' (principal)' : ' (respaldo)'), icono: 'red', datos, botones: [
    h('button', { type: 'button', text: 'Ver todos los enlaces', onclick: () => ir('#/red/isp') })], editando: false, registro: l, coleccion: 'enlaces_isp',
  ultimoCambio: await textoUltimoCambio(ctx, 'EnlaceIsp', l), alConfirmar: rearmar }));
  const bloque = h('div', { class: 'bloque', style: 'margin-top:10px' }, [h('h3', { text: 'Puerto al que llega' })]);
  if (!puertos.length) bloque.appendChild(h('div', { class: 'mut', text: 'Ningún puerto de router o firewall está marcado como salida de este enlace.' + (ctx.modifica ? ' Se indica en el detalle del puerto, con «Editar puerto» › «Sale a Internet por».' : '') }));
  else bloque.appendChild(tabla(['Equipo', 'Puerto', 'Estado', 'Velocidad'], puertos.map(p => {
    const e = me.get(p.equipo_id);
    return [e ? enlace(e.equipo_nombre, hashEquipo(e)) : '—', enlace((p.puerto_nombre ? p.puerto_nombre + ' · ' : '') + 'puerto ' + p.puerto_numero, '#/equipo/' + p.equipo_id + '/puertos/' + p.puerto_numero), ROTULO_ESTADO_PUERTO[p.puerto_estado] || p.puerto_estado, p.puerto_velocidad || '—'];
  })));
  cont.appendChild(bloque);
}
