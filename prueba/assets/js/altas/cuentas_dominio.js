// @ts-check
/**
 * Alta de cuentas de dominio (colección `cuentas_dominio`). Se abre con `abrirAlta('cuentas_dominio', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `persona_id` (persona preelegida), `cuenta_dominio`, `cuenta_usuario`, `cuenta_unidad_organizativa`,
 * `cuenta_grupos` (lista), `cuenta_estado`, `credencial_id`. Persona y credencial se eligen con `selectorConCrear`
 * (se puede crear la persona o la credencial al vuelo). Sin persona = cuenta de servicio.
 */

import * as repositorio from '../repositorio.js';
import { h } from '../utiles.js';
import { ROTULO_CUENTA_ESTADO } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import { enlazarValidacion } from '../validaciones.js';
import { entrada, selectorDeRotulos, opcionesPersonas } from './comunes.js';

/**
 * Lista editable de grupos: chips con «×» y un campo para agregar (también la usa la ficha de la cuenta).
 * @param {string[]} inicial
 * @returns {{nodo: HTMLElement, leer: () => string[]}}
 */
export function editorGrupos(inicial) {
  /** @type {string[]} */
  let grupos = inicial.slice();
  const lista = h('div', { class: 'pe-grupos', role: 'list', 'aria-label': 'Grupos' });
  const entradaG = /** @type {HTMLInputElement} */ (h('input', { type: 'text', placeholder: 'Nombre del grupo y Enter', 'aria-label': 'Agregar grupo', style: 'max-width:260px' }));
  const pintar = () => {
    lista.textContent = '';
    if (!grupos.length) lista.appendChild(h('span', { class: 'mut', text: 'Sin grupos.' }));
    for (const g of grupos) lista.appendChild(h('span', { class: 'pe-grupo', role: 'listitem' }, [g, h('button', { type: 'button', 'aria-label': 'Quitar el grupo ' + g, title: 'Quitar', text: '×', onclick: () => { grupos = grupos.filter(x => x !== g); pintar(); } })]));
  };
  const agregar = () => {
    const x = entradaG.value.trim();
    if (x && !grupos.some(y => y.toLowerCase() === x.toLowerCase())) grupos.push(x);
    entradaG.value = ''; pintar();
  };
  entradaG.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); agregar(); } });
  pintar();
  return { nodo: h('div', null, [lista, h('div', { class: 'herr', style: 'margin:6px 0 0' }, [entradaG, h('button', { type: 'button', class: 'chico', text: 'Agregar', onclick: agregar })])]), leer: () => { agregar(); return grupos.slice(); } };
}

registrarAlta('cuentas_dominio', async ctx => {
  const v = ctx.valores;
  const id = { dominio: idUnico('cu-dominio'), usuario: idUnico('cu-usuario'), uo: idUnico('cu-uo'), estado: idUnico('cu-estado'), persona: idUnico('cu-persona'), cred: idUnico('cu-cred') };
  const cuentas = await repositorio.listar('cuentas_dominio', { organizacion_id: ctx.organizacion_id });
  /** @type {Map<string, number>} */
  const uso = new Map();
  for (const c of cuentas) uso.set(c.cuenta_dominio, (uso.get(c.cuenta_dominio) || 0) + 1);
  const sugerido = Array.from(uso.entries()).sort((a, b) => b[1] - a[1])[0];
  const dominio = entrada(id.dominio, v.cuenta_dominio || (sugerido ? sugerido[0] : ''), { maxlength: '80', placeholder: 'Ej.: AGRODEMO' });
  const usuario = entrada(id.usuario, v.cuenta_usuario, { maxlength: '80', autocomplete: 'off', placeholder: 'Ej.: lferrero' });
  const uo = entrada(id.uo, v.cuenta_unidad_organizativa, { placeholder: 'Ej.: OU=Administración,OU=Usuarios' });
  const estado = selectorDeRotulos(id.estado, ROTULO_CUENTA_ESTADO, v.cuenta_estado || 'habilitada');
  const grupos = editorGrupos(Array.isArray(v.cuenta_grupos) ? v.cuenta_grupos : ['Usuarios del dominio']);
  const persona = selectorConCrear({ desde: 'cuentas_dominio', campo: 'persona_id', organizacion_id: ctx.organizacion_id, valor: v.persona_id || null, id: id.persona,
    cargarOpciones: () => opcionesPersonas(ctx.organizacion_id), rotuloOrigen: 'Nueva cuenta de dominio' });
  const cred = selectorConCrear({ desde: 'cuentas_dominio', campo: 'credencial_id', organizacion_id: ctx.organizacion_id, valor: v.credencial_id || null, id: id.cred,
    valoresAlta: { credencial_tipo: 'dominio' }, rotuloOrigen: 'Nueva cuenta de dominio' });
  const cGrupos = h('div', { class: 'campo ancho' }, [h('label', { text: 'Grupos' }), grupos.nodo]);
  const cUsuario = campoDeAlta(id.usuario, 'Usuario *', usuario);
  enlazarValidacion(cUsuario, () => {
    const dom = dominio.value.trim().toLowerCase(), usu = usuario.value.trim().toLowerCase();
    return dom && usu && cuentas.some(c => c.cuenta_dominio.toLowerCase() === dom && c.cuenta_usuario.toLowerCase() === usu)
      ? { nivel: 'mal', mensaje: 'Ya existe la cuenta ' + dominio.value.trim() + '\\' + usuario.value.trim() + ' en esta organización.' } : null;
  }, { tambien: [dominio] });
  return abrirFormularioDeAlta({
    titulo: 'Nueva cuenta de dominio', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva cuenta de dominio' ? ctx.rotulo : null, textoGuardar: 'Crear cuenta', enfocar: usuario,
    secciones: [{ titulo: 'Identificación', cuerpo: [campoDeAlta(id.dominio, 'Dominio *', dominio), cUsuario, campoDeAlta(id.estado, 'Estado *', estado),
      campoDeAlta(id.persona, 'Persona', persona, 'Si la cuenta no es de una persona (impresora, servicio, escáner), dejalo sin elegir: es una cuenta de servicio.')] }],
    mas: { resumen: 'unidad organizativa, grupos, credencial con la contraseña', cuerpo: [campoDeAlta(id.uo, 'Unidad organizativa', uo), cGrupos,
      campoDeAlta(id.cred, 'Credencial con la contraseña', cred, 'La contraseña no se carga acá: va como credencial.')] },
    alGuardar: async () => {
      const dom = dominio.value.trim(), usu = usuario.value.trim();
      if (!dom) throw new Error('Escribí el dominio.');
      if (!usu) throw new Error('Escribí el usuario.');
      const otras = await repositorio.listar('cuentas_dominio', { organizacion_id: ctx.organizacion_id });
      if (otras.some(c => c.cuenta_dominio.toLowerCase() === dom.toLowerCase() && c.cuenta_usuario.toLowerCase() === usu.toLowerCase())) throw new Error('Ya existe la cuenta ' + dom + '\\' + usu + ' en esta organización.');
      return repositorio.guardar('cuentas_dominio', { organizacion_id: ctx.organizacion_id, persona_id: persona.value || null, cuenta_dominio: dom, cuenta_usuario: usu,
        cuenta_unidad_organizativa: uo.value.trim() || null, cuenta_grupos: grupos.leer(), cuenta_estado: estado.value, credencial_id: cred.value || null }, ctx.usuario.id);
    }
  });
});
