// @ts-check
/**
 * Alta de personas de la organización (colección `personas`; no son usuarios del sistema).
 * Se abre con `abrirAlta('personas', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `persona_nombre`, `persona_sector`, `puesto_id`, `persona_notas`. El puesto se elige con `selectorConCrear`.
 * Nace siempre `activa`.
 */

import * as repositorio from '../repositorio.js';
import { normalizar } from '../utiles.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import { entrada, areaTexto } from './comunes.js';

registrarAlta('personas', async ctx => {
  const v = ctx.valores;
  const id = { nombre: idUnico('pe-nombre'), sector: idUnico('pe-sector'), puesto: idUnico('pe-puesto'), notas: idUnico('pe-notas') };
  const nombre = entrada(id.nombre, v.persona_nombre, { maxlength: '120', placeholder: 'Ej.: Lucía Ferrero' });
  const sector = entrada(id.sector, v.persona_sector, { maxlength: '80', placeholder: 'Ej.: Administración' });
  const notas = areaTexto(id.notas, v.persona_notas, 2);
  const puesto = selectorConCrear({ desde: 'personas', campo: 'puesto_id', organizacion_id: ctx.organizacion_id, valor: v.puesto_id || null, id: id.puesto, rotuloOrigen: 'Nueva persona' });
  return abrirFormularioDeAlta({
    titulo: 'Nueva persona', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva persona' ? ctx.rotulo : null, textoGuardar: 'Crear persona', enfocar: nombre,
    intro: 'Es alguien de la organización (no un usuario del sistema). Después podés asignarle equipos y cuentas desde su ficha. Los campos con * son obligatorios.',
    cuerpo: [campoDeAlta(id.nombre, 'Nombre y apellido *', nombre), campoDeAlta(id.sector, 'Sector', sector),
      campoDeAlta(id.puesto, 'Puesto habitual', puesto, 'Vacío si no tiene un puesto fijo (por ejemplo, quien trabaja con notebook).'), campoDeAlta(id.notas, 'Notas', notas)],
    alGuardar: async () => {
      const nom = nombre.value.trim();
      if (!nom) throw new Error('Escribí el nombre y apellido.');
      const existentes = await repositorio.listar('personas', { organizacion_id: ctx.organizacion_id });
      if (existentes.some(x => normalizar(x.persona_nombre) === normalizar(nom))) throw new Error('Ya hay una persona con ese nombre en esta organización: si es otra, agregale algo que las distinga.');
      return repositorio.guardar('personas', { organizacion_id: ctx.organizacion_id, persona_nombre: nom, persona_sector: sector.value.trim() || null,
        puesto_id: puesto.value || null, persona_estado: 'activa', persona_notas: notas.value.trim() || null }, ctx.usuario.id);
    }
  });
});
