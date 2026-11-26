// @ts-check
/**
 * Alta de mapeos de disco (colección `mapeos_disco`): letra de unidad, ruta de red, servidor, a quién se aplica y cómo.
 * Se abre con `abrirAlta('mapeos_disco', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `mapeo_letra`, `mapeo_ruta`, `equipo_id` (servidor), `mapeo_aplica_a`, `mapeo_grupo`, `persona_id`, `mapeo_metodo`.
 * Servidor y persona con `selectorConCrear` (el servidor nuevo nace con `equipo_tipo: 'servidor'`). La persona solo se ofrece
 * a quien ve el módulo Personas (como antes).
 */

import { h } from '../utiles.js';
import { puede } from '../permisos.js';
import { ROTULO_MAPEO_APLICA_A, ROTULO_MAPEO_METODO } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { entrada, selectorDeRotulos, opcionesEquipos, opcionesPersonas } from './comunes.js';

registrarAlta('mapeos_disco', async ctx => {
  const v = ctx.valores;
  const verPersonas = puede(ctx.usuario, 'ver', 'personas', ctx.organizacion_id);
  const id = { letra: idUnico('mp-letra'), ruta: idUnico('mp-ruta'), srv: idUnico('mp-srv'), aplica: idUnico('mp-aplica'), grupo: idUnico('mp-grupo'), persona: idUnico('mp-persona'), metodo: idUnico('mp-metodo') };
  const letra = entrada(id.letra, v.mapeo_letra, { maxlength: '2', placeholder: 'P:', style: 'width:80px' });
  const ruta = entrada(id.ruta, v.mapeo_ruta, { placeholder: '\\\\SERVIDOR\\Carpeta' });
  const aplica = selectorDeRotulos(id.aplica, ROTULO_MAPEO_APLICA_A, v.mapeo_aplica_a || 'todos');
  const grupo = entrada(id.grupo, v.mapeo_grupo, { placeholder: 'GG-Compras' });
  const metodo = selectorDeRotulos(id.metodo, ROTULO_MAPEO_METODO, v.mapeo_metodo || 'gpo');
  const servidor = selectorConCrear({ desde: 'mapeos_disco', campo: 'equipo_id', organizacion_id: ctx.organizacion_id, valor: v.equipo_id || null, id: id.srv,
    cargarOpciones: () => opcionesEquipos(ctx.organizacion_id, { filtro: e => e.equipo_tipo === 'servidor' }), valoresAlta: { equipo_tipo: 'servidor' }, rotuloOrigen: 'Nuevo mapeo de disco' });
  const persona = verPersonas ? selectorConCrear({ desde: 'mapeos_disco', campo: 'persona_id', organizacion_id: ctx.organizacion_id, valor: v.persona_id || null, id: id.persona,
    cargarOpciones: () => opcionesPersonas(ctx.organizacion_id, { soloActivas: true }), rotuloOrigen: 'Nuevo mapeo de disco' }) : null;
  const cGrupo = campoDeAlta(id.grupo, 'Grupo de dominio *', grupo);
  const cPersona = persona ? campoDeAlta(id.persona, 'Persona *', persona) : h('div', { class: 'mut', text: 'Tu rol no ve el módulo Personas: elegí otro destino o pedile a alguien que lo cargue.' });
  const ajustar = () => { cGrupo.hidden = aplica.value !== 'grupo'; cPersona.hidden = aplica.value !== 'persona'; };
  aplica.addEventListener('change', ajustar); ajustar();
  return abrirFormularioDeAlta({
    titulo: 'Nuevo mapeo de disco', rotulo: ctx.rotulo && ctx.rotulo !== 'Nuevo mapeo de disco' ? ctx.rotulo : null, textoGuardar: 'Crear mapeo', enfocar: letra,
    cuerpo: [campoDeAlta(id.letra, 'Letra de unidad *', letra), campoDeAlta(id.ruta, 'Ruta de red *', ruta), campoDeAlta(id.srv, 'Servidor que la comparte', servidor),
      campoDeAlta(id.aplica, 'Se aplica a *', aplica), cGrupo, cPersona, campoDeAlta(id.metodo, 'Método *', metodo)],
    alGuardar: async () => {
      const l = letra.value.trim().toUpperCase().replace(/[^A-Z:]/g, '');
      if (!/^[A-Z]:?$/.test(l)) throw new Error('La letra de unidad es una sola letra, por ejemplo «P:».');
      if (!ruta.value.trim()) throw new Error('Escribí la ruta de red, por ejemplo \\\\SERVIDOR\\Carpeta.');
      if (aplica.value === 'grupo' && !grupo.value.trim()) throw new Error('Indicá el grupo de dominio al que se aplica.');
      if (aplica.value === 'persona' && !(persona && persona.value)) throw new Error('Elegí la persona a la que se aplica.');
      return repositorio.guardar('mapeos_disco', { organizacion_id: ctx.organizacion_id, mapeo_letra: l.length === 1 ? l + ':' : l, mapeo_ruta: ruta.value.trim(),
        equipo_id: servidor.value || null, mapeo_aplica_a: aplica.value, mapeo_grupo: aplica.value === 'grupo' ? grupo.value.trim() : null,
        persona_id: aplica.value === 'persona' && persona ? persona.value : null, mapeo_metodo: metodo.value }, ctx.usuario.id);
    }
  });
});
