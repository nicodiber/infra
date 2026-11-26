// @ts-check
/**
 * Alta de dominios y servicios (colección `servicios`): dominio, DNS, hosting, certificado SSL o correo.
 * Se abre con `abrirAlta('servicios', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `servicio_tipo`, `servicio_nombre`, `servicio_proveedor`, `servicio_titular`, `servicio_vence_en`,
 * `servicio_delegacion_dns`, `servicio_plan`, `credencial_id`, `servicio_registros` (lista de registros DNS; lo usa «Duplicar»).
 * El acceso al panel es una credencial: `selectorConCrear` (se crea al vuelo, ya con un tipo y nombre sugeridos). Solo se ofrece
 * a quien ve el módulo Credenciales (como antes). La contraseña vive en la credencial, nunca acá.
 */

import { h } from '../utiles.js';
import { puede } from '../permisos.js';
import { ROTULO_SERVICIO_TIPO, TIPOS_REGISTRO_DNS } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { entrada, selectorDeRotulos } from './comunes.js';

/** Tipo de credencial que corresponde al panel de cada tipo de servicio. @type {Object<string, string>} */
const CREDENCIAL_DE_SERVICIO = { dominio: 'dominio', dns: 'nic_dns', hosting: 'hosting', certificado: 'otro', correo: 'correo' };

/**
 * Editor de registros DNS en filas. `leer` lanza `Error` si una fila está incompleta o la prioridad no es entera.
 * @param {any[]} inicial @returns {{nodo: HTMLElement, leer: () => any[]}}
 */
function editorRegistros(inicial) {
  /** @type {any[]} */
  const filas = inicial.map(r => ({ tipo: r.tipo, nombre: r.nombre, valor: r.valor, prioridad: r.prioridad == null ? '' : String(r.prioridad) }));
  const cuerpo = h('div');
  const pintar = () => {
    cuerpo.textContent = '';
    if (!filas.length) cuerpo.appendChild(h('div', { class: 'mut', text: 'Sin registros DNS (se pueden cargar después desde la ficha).' }));
    filas.forEach((r, i) => {
      const t = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo del registro ' + (i + 1) }, TIPOS_REGISTRO_DNS.map(x => h('option', { value: x, text: x }))));
      t.value = r.tipo; t.addEventListener('change', () => { r.tipo = t.value; pintar(); });
      const inp = (/** @type {string} */ k, /** @type {string} */ et, /** @type {string} */ ancho, /** @type {string} */ tipo) => {
        const e = /** @type {HTMLInputElement} */ (h('input', { type: tipo || 'text', value: r[k], 'aria-label': et + ' del registro ' + (i + 1), style: 'width:' + ancho }));
        e.addEventListener('input', () => { r[k] = e.value; });
        return e;
      };
      cuerpo.appendChild(h('div', { class: 'herr', style: 'margin:4px 0;flex-wrap:wrap' }, [t, inp('nombre', 'Nombre', '90px'), inp('valor', 'Valor', '220px'),
        r.tipo === 'MX' ? inp('prioridad', 'Prioridad', '70px', 'number') : null,
        h('button', { type: 'button', class: 'chico', text: 'Quitar', 'aria-label': 'Quitar el registro ' + (i + 1), onclick: () => { filas.splice(i, 1); pintar(); } })]));
    });
  };
  pintar();
  return {
    nodo: h('div', null, [cuerpo, h('div', { class: 'herr' }, [h('button', { type: 'button', class: 'chico', text: 'Agregar registro DNS', onclick: () => { filas.push({ tipo: 'A', nombre: '@', valor: '', prioridad: '' }); pintar(); } })])]),
    leer: () => filas.filter(r => String(r.nombre).trim() || String(r.valor).trim()).map(r => {
      if (!String(r.nombre).trim() || !String(r.valor).trim()) throw new Error('Cada registro DNS necesita nombre y valor.');
      /** @type {any} */
      const reg = { tipo: r.tipo, nombre: String(r.nombre).trim(), valor: String(r.valor).trim() };
      if (r.tipo === 'MX' && String(r.prioridad).trim() !== '') {
        const n = Number(r.prioridad);
        if (!Number.isInteger(n) || n < 0) throw new Error('La prioridad de un registro MX es un número entero.');
        reg.prioridad = n;
      }
      return reg;
    })
  };
}

registrarAlta('servicios', async ctx => {
  const v = ctx.valores;
  const verCred = puede(ctx.usuario, 'ver', 'credenciales', ctx.organizacion_id);
  const id = { nombre: idUnico('sv-nombre'), tipo: idUnico('sv-tipo'), prov: idUnico('sv-prov'), titular: idUnico('sv-titular'), vence: idUnico('sv-vence'), deleg: idUnico('sv-deleg'), plan: idUnico('sv-plan'), cred: idUnico('sv-cred') };
  const nombre = entrada(id.nombre, v.servicio_nombre, { maxlength: '160', placeholder: 'Ej.: agrodemo.example' });
  const tipo = selectorDeRotulos(id.tipo, ROTULO_SERVICIO_TIPO, v.servicio_tipo || 'dominio');
  const proveedor = entrada(id.prov, v.servicio_proveedor, { placeholder: 'Registrador, empresa de hosting, autoridad certificante…' });
  const titular = entrada(id.titular, v.servicio_titular, { placeholder: 'A nombre de quién está' });
  const vence = entrada(id.vence, v.servicio_vence_en, { type: 'date' });
  const deleg = entrada(id.deleg, v.servicio_delegacion_dns, { placeholder: 'Ej.: Cloudflare' });
  const plan = entrada(id.plan, v.servicio_plan);
  const registros = editorRegistros(Array.isArray(v.servicio_registros) ? v.servicio_registros : []);
  const valoresCred = /** @type {Object<string, any>} */ ({ credencial_tipo: CREDENCIAL_DE_SERVICIO[tipo.value] });
  const sugerir = () => { valoresCred.credencial_tipo = CREDENCIAL_DE_SERVICIO[tipo.value]; valoresCred.credencial_nombre = nombre.value.trim() ? 'Panel: ' + nombre.value.trim() : ''; };
  tipo.addEventListener('change', sugerir); nombre.addEventListener('input', sugerir); sugerir();
  const cred = verCred ? selectorConCrear({ desde: 'servicios', campo: 'credencial_id', organizacion_id: ctx.organizacion_id, valor: v.credencial_id || null, id: id.cred,
    valoresAlta: valoresCred, rotuloOrigen: 'Nuevo servicio' }) : null;
  return abrirFormularioDeAlta({
    titulo: 'Nuevo dominio o servicio', rotulo: ctx.rotulo && ctx.rotulo !== 'Nuevo servicio' ? ctx.rotulo : null, textoGuardar: 'Crear servicio', enfocar: nombre,
    secciones: [{ titulo: 'Identificación', cuerpo: [campoDeAlta(id.nombre, 'Nombre *', nombre), campoDeAlta(id.tipo, 'Tipo *', tipo), campoDeAlta(id.prov, 'Proveedor', proveedor),
      campoDeAlta(id.vence, 'Vence el', vence, 'Vacío en lo que no vence (una zona DNS).')] },
      { titulo: 'Registros DNS', cuerpo: [h('div', { class: 'campo ancho' }, [registros.nodo])] }],
    mas: { resumen: 'titular, DNS delegado, plan, acceso al panel', cuerpo: [campoDeAlta(id.titular, 'Titular', titular), campoDeAlta(id.deleg, 'DNS delegado en', deleg), campoDeAlta(id.plan, 'Plan', plan),
      cred ? campoDeAlta(id.cred, 'Acceso al panel (credencial)', cred, 'La contraseña del panel se carga en la credencial, no acá.') : null] },
    alGuardar: async () => {
      if (!nombre.value.trim()) throw new Error('Escribí el nombre del servicio.');
      return repositorio.guardar('servicios', { organizacion_id: ctx.organizacion_id, servicio_tipo: tipo.value, servicio_nombre: nombre.value.trim(),
        servicio_proveedor: proveedor.value.trim() || null, servicio_titular: titular.value.trim() || null, servicio_vence_en: vence.value || null,
        servicio_delegacion_dns: deleg.value.trim() || null, servicio_plan: plan.value.trim() || null, credencial_id: cred && cred.value || null,
        servicio_registros: registros.leer() }, ctx.usuario.id);
    }
  });
});
