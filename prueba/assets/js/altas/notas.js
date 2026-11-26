// @ts-check
/**
 * Alta de notas de texto libre (colección `notas`). Se abre con `abrirAlta('notas', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `entidad` + `entidad_id` (ficha donde cuelga; sin ellos es una nota de la organización), `nota_titulo`, `nota_contenido`.
 * La ficha es una referencia polimórfica: no se elige con selector, viene de donde se abre el alta y se muestra como dato fijo.
 */

import { h } from '../utiles.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { origenDeNota } from '../notas.js';
import { entrada, areaTexto } from './comunes.js';

registrarAlta('notas', async ctx => {
  const v = ctx.valores;
  const entidad = v.entidad && v.entidad_id ? String(v.entidad) : null;
  const entidadId = entidad ? String(v.entidad_id) : null;
  const origen = await origenDeNota({ entidad, entidad_id: entidadId });
  const id = { titulo: idUnico('nt-titulo'), contenido: idUnico('nt-contenido') };
  const titulo = entrada(id.titulo, v.nota_titulo, { maxlength: '120', placeholder: 'Ej.: Documentación del controlador de dominio' });
  const contenido = areaTexto(id.contenido, v.nota_contenido, 10, { placeholder: 'Escribí la nota. Los saltos de línea se conservan.' });
  return abrirFormularioDeAlta({
    titulo: 'Nueva nota', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva nota' ? ctx.rotulo : null, textoGuardar: 'Crear nota', enfocar: titulo,
    cuerpo: [h('div', { class: 'mut', text: 'De: ' + (entidad ? origen.etiqueta + ' · ' + origen.nombre : 'la organización') }),
      campoDeAlta(id.titulo, 'Título *', titulo), campoDeAlta(id.contenido, 'Contenido * (sin contraseñas ni claves)', contenido, 'Para las claves están las Credenciales.')],
    alGuardar: async () => {
      if (!titulo.value.trim()) throw new Error('Escribí un título para la nota.');
      if (!contenido.value.trim()) throw new Error('Escribí el contenido de la nota.');
      return repositorio.guardar('notas', { organizacion_id: ctx.organizacion_id, entidad, entidad_id: entidadId, nota_titulo: titulo.value.trim(),
        nota_contenido: contenido.value.replace(/\s+$/, '') }, ctx.usuario.id);
    }
  });
});
