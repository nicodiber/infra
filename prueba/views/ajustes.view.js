// @ts-check
/** P20 · Ajustes del sistema (solo superadmin): umbrales «a revisar» y «viejo» de la verificación (D-046). */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, icono, ahoraISO, estadoVerificacion } from '../assets/js/utiles.js';
import { ROTULO_TIPO_VERIFICACION, PLANTILLAS_INICIALES, leerPlantillas, guardarPlantillas } from '../assets/js/verificacion.js';

/** Colecciones cuyos elementos se verifican (igual que el tablero). */
const VERIFICABLES = ['equipos', 'credenciales', 'puestos', 'racks', 'configuraciones', 'vlans', 'redes_wifi', 'enlaces_isp'];
const POR_DEFECTO = { aRevisar: 90, viejo: 365 };

function estilos() {
  if (document.getElementById('estilos-ajustes')) return;
  const s = document.createElement('style');
  s.id = 'estilos-ajustes';
  s.textContent = '.aju-fila{display:flex;align-items:center;gap:10px;margin-top:12px}.aju-fila label{width:130px;font-weight:700}.aju-fila input{width:90px}.aju-ayuda{color:var(--muted);font-size:12.5px;margin:2px 0 0 140px}';
  document.head.appendChild(s);
}

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  estilos();
  const u = sesion.usuarioActual();
  const base = await migasRaiz();
  pantalla(contenedor, { codigo: 'P20', nombre: 'Ajustes del sistema', migas: base.concat([['Ajustes del sistema']]) });
  if (!u) return;
  if (!puede(u, 'ajustes_sistema')) {
    contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Solo el superadmin puede cambiar los ajustes del sistema.' }),
      h('div', { style: 'margin-top:8px' }, [h('button', { text: 'Volver al inicio', onclick: () => ir('#/inicio') })])]));
    return;
  }
  const actual = await repositorio.umbralesVerificacion();
  const orgs = await repositorio.listar('organizaciones', null, { ordenarPor: 'organizacion_nombre' });
  const orgActiva = sesion.organizacionActiva();

  // Se leen una sola vez los elementos verificables; después la vista previa se recalcula sin volver a leer.
  /** @type {Array<{org: string, verificado_en: string}>} */
  const elementos = [];
  for (const c of VERIFICABLES) {
    const l = await repositorio.listar(c, r => !(c === 'equipos' && r.equipo_estado === 'baja'));
    for (const r of l) elementos.push({ org: r.organizacion_id, verificado_en: r.verificado_en });
  }

  const inRev = /** @type {HTMLInputElement} */ (h('input', { id: 'aju-rev', type: 'number', min: '1', step: '1', value: String(actual.aRevisar) }));
  const inViejo = /** @type {HTMLInputElement} */ (h('input', { id: 'aju-viejo', type: 'number', min: '2', step: '1', value: String(actual.viejo) }));
  const selOrg = /** @type {HTMLSelectElement} */ (h('select', { id: 'aju-org', 'aria-label': 'Organización para la vista previa' }, [h('option', { value: '', text: 'Todas las organizaciones' })]
    .concat(orgs.map(o => h('option', { value: o.id, text: o.organizacion_nombre })))));
  selOrg.value = orgActiva || '';
  const vista = h('div', { 'aria-live': 'polite' });
  const error = h('div', { class: 'msg mal', role: 'alert', style: 'display:none' });
  const guardar = /** @type {HTMLButtonElement} */ (h('button', { class: 'primario', text: 'Guardar' }));

  const leer = () => ({ aRevisar: Number(inRev.value), viejo: Number(inViejo.value) });
  /** @param {{aRevisar: number, viejo: number}} v */
  const valido = v => Number.isInteger(v.aRevisar) && Number.isInteger(v.viejo) && v.aRevisar >= 1 && v.viejo > v.aRevisar;

  function actualizar() {
    const v = leer(), ok = valido(v);
    error.style.display = ok ? 'none' : 'block';
    error.textContent = ok ? '' : 'Los dos valores tienen que ser números enteros, y «viejo» tiene que ser mayor que «a revisar».';
    guardar.disabled = !ok || (v.aRevisar === actual.aRevisar && v.viejo === actual.viejo);
    vista.textContent = '';
    if (!ok) return;
    const n = { vigente: 0, revisar: 0, viejo: 0 };
    const lista = elementos.filter(e => !selOrg.value || e.org === selOrg.value);
    for (const e of lista) n[estadoVerificacion(e.verificado_en, v).nivel]++;
    vista.appendChild(h('div', { class: 'mut', text: 'Con estos valores, entre los ' + lista.length + ' elementos verificables (sin contar equipos dados de baja):' }));
    vista.appendChild(h('div', { class: 'herr' }, [
      h('span', { class: 'verif v-reciente' }, [icono('check'), n.vigente + ' recientes (menos de ' + v.aRevisar + ' días)']),
      h('span', { class: 'verif v-revisar' }, [icono('reloj'), n.revisar + ' a revisar (de ' + v.aRevisar + ' a ' + v.viejo + ' días)']),
      h('span', { class: 'verif v-viejo' }, [icono('alerta'), n.viejo + ' viejos (más de ' + v.viejo + ' días)'])]));
  }
  [inRev, inViejo, selOrg].forEach(i => i.addEventListener('input', actualizar));

  /** Guarda un ajuste por clave: lo crea si no existe. @param {string} clave @param {number} valor */
  async function guardarAjuste(clave, valor) {
    const previo = (await repositorio.listar('ajustes_sistema', { ajuste_clave: clave }))[0];
    if (previo) await repositorio.guardar('ajustes_sistema', { ...previo, ajuste_valor: String(valor) }, /** @type {any} */ (u).id);
    else await repositorio.guardar('ajustes_sistema', { ajuste_clave: clave, ajuste_valor: String(valor), actualizado_en: ahoraISO(), actualizado_por: /** @type {any} */ (u).id }, /** @type {any} */ (u).id);
  }
  guardar.addEventListener('click', async () => {
    const v = leer();
    if (!valido(v)) return;
    guardar.disabled = true;
    try {
      await guardarAjuste('verificacion_dias_a_revisar', v.aRevisar);
      await guardarAjuste('verificacion_dias_viejo', v.viejo);
      toast('Ajustes guardados: a revisar desde ' + v.aRevisar + ' días · viejo desde ' + v.viejo + ' días. Todos los indicadores usan estos valores.');
      ir(location.hash);
    } catch (e) { guardar.disabled = false; toast(e instanceof Error ? e.message : 'No se pudo guardar'); }
  });
  const restaurar = h('button', { text: 'Volver a ' + POR_DEFECTO.aRevisar + ' y ' + POR_DEFECTO.viejo, onclick: () => { inRev.value = String(POR_DEFECTO.aRevisar); inViejo.value = String(POR_DEFECTO.viejo); actualizar(); } });
  actualizar();

  contenedor.appendChild(h('h1', { text: 'Ajustes del sistema' }));
  contenedor.appendChild(h('p', { class: 'mut', text: 'Definen cuándo la última verificación de un elemento (equipo, puerto, credencial…) se considera «a revisar» o «vieja». Valen para todas las organizaciones y para todos los indicadores, resúmenes y avisos.' }));
  contenedor.appendChild(h('div', { class: 'bloque', style: 'max-width:900px' }, [
    h('h2', { text: 'Umbrales de verificación' }),
    h('div', { class: 'aju-fila' }, [h('label', { for: 'aju-rev', text: 'A revisar desde' }), inRev, h('span', { text: 'días' })]),
    h('div', { class: 'aju-ayuda', text: 'Antes de este plazo el elemento figura como «reciente».' }),
    h('div', { class: 'aju-fila' }, [h('label', { for: 'aju-viejo', text: 'Viejo desde' }), inViejo, h('span', { text: 'días' })]),
    h('div', { class: 'aju-ayuda', text: 'Pasado este plazo figura como «viejo»: aparece en «Pendientes de verificar» y avisa al superadmin al ingresar.' }),
    error,
    h('div', { style: 'margin-top:14px' }, [h('label', { for: 'aju-org', class: 'mut', text: 'Vista previa en: ' }), selOrg, vista]),
    h('div', { class: 'herr', style: 'margin-top:14px' }, [guardar, restaurar, h('button', { text: 'Cancelar', onclick: () => ir('#/organizaciones') })]),
    h('div', { class: 'mut', style: 'margin-top:6px', text: 'Valores iniciales del sistema: 90 y 365 días. Solo el superadmin puede cambiarlos.' })]));
  contenedor.appendChild(await bloquePlantillas(/** @type {any} */ (u).id));
}

/** Plantillas de pasos de verificación por tipo (D-055, MJ38). @param {string} usuarioId */
async function bloquePlantillas(usuarioId) {
  const actual = await leerPlantillas();
  /** @type {Object<string, HTMLTextAreaElement>} */
  const areas = {};
  const filas = Object.keys(ROTULO_TIPO_VERIFICACION).map(k => {
    const a = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'aju-pl-' + k, rows: '3', style: 'width:100%', 'aria-label': 'Pasos para ' + ROTULO_TIPO_VERIFICACION[k] }));
    a.value = (actual[k] || []).join('\n');
    areas[k] = a;
    return h('div', { style: 'margin-top:10px' }, [h('label', { for: 'aju-pl-' + k, style: 'font-weight:700', text: ROTULO_TIPO_VERIFICACION[k] }), a]);
  });
  const leer = () => {
    /** @type {Object<string, string[]>} */
    const o = {};
    for (const k of Object.keys(areas)) o[k] = areas[k].value.split('\n').map(x => x.trim()).filter(Boolean);
    return o;
  };
  const guardar = h('button', { class: 'primario', text: 'Guardar plantillas', onclick: async () => {
    try { await guardarPlantillas(leer(), usuarioId); toast('Plantillas de pasos guardadas. Se usan al «Confirmar vigente» y en el recorrido.'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron guardar'); }
  } });
  const restaurar = h('button', { text: 'Volver a los pasos iniciales', onclick: () => { for (const k of Object.keys(areas)) areas[k].value = (PLANTILLAS_INICIALES[k] || []).join('\n'); } });
  return h('div', { class: 'bloque', style: 'max-width:900px;margin-top:16px' }, [
    h('h2', { text: 'Pasos de verificación por tipo' }),
    h('div', { class: 'mut', text: 'Un paso por línea. Al tocar «Confirmar vigente» en un elemento de ese tipo, la persona tilda cada paso antes de confirmar. Cada elemento puede sumar pasos propios. Un tipo sin pasos se confirma directo.' }),
    ...filas, h('div', { class: 'herr', style: 'margin-top:14px' }, [guardar, restaurar])]);
}
