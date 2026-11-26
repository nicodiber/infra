// @ts-check
/**
 * Alta de organizaciones (colección `organizaciones`, solo superadmin). Se abre con `abrirAlta('organizaciones', {valores, rotulo})`;
 * no necesita una organización activa. Valores iniciales: `organizacion_nombre`, `organizacion_rubro`, `organizacion_cuit`, `organizacion_notas`.
 * Nace `activa`. El nombre es obligatorio y único (también entre las dadas de baja). La edición sigue en `views/organizaciones.view.js`.
 */

import { puede } from '../permisos.js';
import { toast } from '../marco.js';
import { normalizar } from '../utiles.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { entrada, areaTexto } from './comunes.js';

registrarAlta('organizaciones', async ctx => {
  if (!puede(ctx.usuario, 'ver_organizaciones')) { toast('Solo el superadmin gestiona organizaciones.'); return null; }
  const v = ctx.valores;
  const id = { nombre: idUnico('og-nombre'), rubro: idUnico('og-rubro'), cuit: idUnico('og-cuit'), notas: idUnico('og-notas') };
  const nombre = entrada(id.nombre, v.organizacion_nombre, { maxlength: '120' });
  const rubro = entrada(id.rubro, v.organizacion_rubro, { maxlength: '80', placeholder: 'Ej.: Agroindustria' });
  const cuit = entrada(id.cuit, v.organizacion_cuit, { maxlength: '20', placeholder: '30-00000000-0' });
  const notas = areaTexto(id.notas, v.organizacion_notas, 3);
  return abrirFormularioDeAlta({
    titulo: 'Nueva organización', rotulo: ctx.rotulo, textoGuardar: 'Crear organización', enfocar: nombre,
    cuerpo: [campoDeAlta(id.nombre, 'Nombre *', nombre), campoDeAlta(id.rubro, 'Rubro', rubro), campoDeAlta(id.cuit, 'CUIT', cuit, 'En el prototipo, siempre ficticio.'), campoDeAlta(id.notas, 'Notas (sin secretos)', notas)],
    alGuardar: async () => {
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Falta el nombre de la organización.');
      const todas = await repositorio.listar('organizaciones', null, { incluirBajas: true });
      const igual = todas.find(o => normalizar(o.organizacion_nombre) === normalizar(nom));
      if (igual) throw new Error('Ya existe una organización llamada «' + igual.organizacion_nombre + '»' + (igual.eliminado_en ? ' (dada de baja: podés reactivarla desde «Ver dadas de baja»)' : '') + '.');
      return repositorio.guardar('organizaciones', { organizacion_nombre: nom, organizacion_rubro: rubro.value.trim() || null, organizacion_cuit: cuit.value.trim() || null,
        organizacion_notas: notas.value.trim() || null, organizacion_estado: 'activa' }, ctx.usuario.id);
    }
  });
});
