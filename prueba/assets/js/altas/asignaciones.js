// @ts-check
/**
 * Alta de asignaciones de equipos a personas (colección `asignaciones`). Se abre con `abrirAlta('asignaciones', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `persona_id`, `equipo_id` (preelegidos; sirven para «Asignar equipo» desde la persona o «Asignar» desde el equipo),
 * `asignacion_desde`, `asignacion_motivo`, `asignacion_observaciones`. Persona y equipo con `selectorConCrear`.
 * Si el equipo ya lo tienen otras personas, pregunta si se reemplaza (se les cierra la asignación) o se comparte (D-072).
 * Lo guarda `repositorio.asignarEquipo` (que valida baja, organización y duplicados); la fecha y las observaciones se ajustan después.
 */

import * as repositorio from '../repositorio.js';
import { h, hoyISO } from '../utiles.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import { entrada, areaTexto, opcionesPersonas, opcionesEquipos } from './comunes.js';

registrarAlta('asignaciones', async ctx => {
  const v = ctx.valores;
  const id = { persona: idUnico('as-persona'), equipo: idUnico('as-equipo'), desde: idUnico('as-desde'), motivo: idUnico('as-motivo'), obs: idUnico('as-obs'), modo: idUnico('as-modo') };
  const desde = entrada(id.desde, v.asignacion_desde || hoyISO(), { type: 'date' });
  const motivo = entrada(id.motivo, v.asignacion_motivo, { placeholder: 'Por ejemplo: ingreso, reemplazo, mudanza (opcional)' });
  const obs = areaTexto(id.obs, v.asignacion_observaciones, 2);
  const aviso = h('div', { class: 'msg', role: 'status', hidden: 'hidden' });
  const rReemplazar = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: id.modo, id: id.modo + '-r', checked: 'checked' }));
  const rCompartir = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: id.modo, id: id.modo + '-c' }));
  const txtR = h('span'), txtC = h('span');
  const modo = h('fieldset', { class: 'bloque', hidden: 'hidden' }, [h('legend', { text: 'El equipo ya lo tiene alguien más' }),
    h('label', { for: id.modo + '-r', style: 'display:flex;gap:8px;align-items:flex-start' }, [rReemplazar, txtR]),
    h('label', { for: id.modo + '-c', style: 'display:flex;gap:8px;align-items:flex-start;margin-top:6px' }, [rCompartir, txtC])]);

  /** @type {HTMLSelectElement} */ let persona;
  /** @type {HTMLSelectElement} */ let equipo;
  const revisar = async () => {
    modo.hidden = true; aviso.hidden = true;
    if (!persona || !equipo || !equipo.value) return;
    const [vig, pers] = await Promise.all([repositorio.asignacionesVigentes(equipo.value), repositorio.listar('personas', { organizacion_id: ctx.organizacion_id })]);
    const nombre = new Map(pers.map(p => [p.id, p.persona_nombre]));
    if (persona.value && vig.some(a => a.persona_id === persona.value)) { aviso.textContent = 'Esta persona ya tiene este equipo asignado.'; aviso.hidden = false; return; }
    const otros = vig.filter(a => a.persona_id !== persona.value).map(a => nombre.get(a.persona_id) || 'otra persona');
    if (otros.length) {
      txtR.textContent = 'Reemplazar a ' + otros.join(', ') + ': se cierra su asignación hoy y queda en el historial.';
      txtC.textContent = 'Compartir con ' + otros.join(', ') + ': el equipo queda asignado a varias personas a la vez.';
      modo.hidden = false;
    }
  };
  persona = selectorConCrear({ desde: 'asignaciones', campo: 'persona_id', organizacion_id: ctx.organizacion_id, valor: v.persona_id || null, obligatorio: true, id: id.persona,
    cargarOpciones: () => opcionesPersonas(ctx.organizacion_id, { soloActivas: true }), rotuloOrigen: 'Nueva asignación', alCambiar: () => { revisar(); } });
  equipo = selectorConCrear({ desde: 'asignaciones', campo: 'equipo_id', organizacion_id: ctx.organizacion_id, valor: v.equipo_id || null, obligatorio: true, id: id.equipo,
    cargarOpciones: () => opcionesEquipos(ctx.organizacion_id), rotuloOrigen: 'Nueva asignación', alCambiar: () => { revisar(); } });
  Promise.all([persona.listo, equipo.listo]).then(revisar);
  return abrirFormularioDeAlta({
    titulo: 'Asignar un equipo a una persona', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva asignación' ? ctx.rotulo : null, textoGuardar: 'Asignar', enfocar: persona.value ? equipo : persona,
    cuerpo: [campoDeAlta(id.persona, 'Persona *', persona), campoDeAlta(id.equipo, 'Equipo *', equipo), modo, aviso, campoDeAlta(id.desde, 'Desde *', desde),
      campoDeAlta(id.motivo, 'Motivo', motivo), campoDeAlta(id.obs, 'Observaciones', obs, 'Estado, accesorios entregados.')],
    alGuardar: async () => {
      if (!persona.value) throw new Error('Elegí la persona (si no está cargada, usá «+ Crear nueva persona…»).');
      if (!equipo.value) throw new Error('Elegí el equipo (si no está cargado, usá «+ Crear nuevo equipo…»).');
      if (!desde.value) throw new Error('Indicá desde cuándo lo tiene.');
      const vig = await repositorio.asignacionesVigentes(equipo.value);
      if (vig.some(a => a.persona_id === persona.value)) throw new Error('Esta persona ya tiene este equipo asignado.');
      const compartir = !modo.hidden && rCompartir.checked;
      let a = await repositorio.asignarEquipo({ equipoId: equipo.value, personaId: persona.value, motivo: motivo.value, usuarioId: ctx.usuario.id, compartir });
      const obsTxt = obs.value.trim() || null;
      if (a.asignacion_desde !== desde.value || obsTxt) a = await repositorio.guardar('asignaciones', { ...a, asignacion_desde: desde.value, asignacion_observaciones: obsTxt }, ctx.usuario.id);
      return a;
    }
  });
});
