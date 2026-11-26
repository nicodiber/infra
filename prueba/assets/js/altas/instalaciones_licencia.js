// @ts-check
/**
 * Alta de instalaciones de licencia (colección `instalaciones_licencia`): en qué equipo está instalada una licencia.
 * Se abre con `abrirAlta('instalaciones_licencia', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `licencia_id`, `equipo_id` (preelegidos), `cuenta_id`, `persona_id`, `instalacion_desde`, `instalacion_hasta`.
 * Licencia, equipo, cuenta y persona con `selectorConCrear`. Cuenta y persona solo se ofrecen a quien ve el módulo Personas (como antes).
 * Avisa (sin impedirlo, regla 18) si la licencia ya está toda en uso.
 */

import * as repositorio from '../repositorio.js';
import { h, hoyISO } from '../utiles.js';
import { puede } from '../permisos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import { entrada, opcionesPersonas, opcionesEquipos, opcionesCuentas } from './comunes.js';

registrarAlta('instalaciones_licencia', async ctx => {
  const v = ctx.valores;
  const verPersonas = puede(ctx.usuario, 'ver', 'personas', ctx.organizacion_id);
  const id = { lic: idUnico('in-lic'), equipo: idUnico('in-equipo'), cuenta: idUnico('in-cuenta'), persona: idUnico('in-persona'), desde: idUnico('in-desde'), hasta: idUnico('in-hasta') };
  const desde = entrada(id.desde, v.instalacion_desde || hoyISO(), { type: 'date' });
  const hasta = entrada(id.hasta, v.instalacion_hasta, { type: 'date' });
  const aviso = h('div', { class: 'msg', role: 'status', hidden: 'hidden' });
  /** @type {HTMLSelectElement} */ let lic;
  const revisar = async () => {
    aviso.hidden = true;
    if (!lic || !lic.value) return;
    const uso = await repositorio.licenciasEnUso(lic.value);
    if (uso.usadas >= uso.cantidad) { aviso.textContent = 'Ya están en uso todas las licencias compradas (' + uso.usadas + ' de ' + uso.cantidad + '): al agregar otra, la licencia queda excedida.'; aviso.hidden = false; }
  };
  lic = selectorConCrear({ desde: 'instalaciones_licencia', campo: 'licencia_id', organizacion_id: ctx.organizacion_id, valor: v.licencia_id || null, obligatorio: true, id: id.lic,
    rotuloOrigen: 'Nueva instalación', alCambiar: () => { revisar(); } });
  const equipo = selectorConCrear({ desde: 'instalaciones_licencia', campo: 'equipo_id', organizacion_id: ctx.organizacion_id, valor: v.equipo_id || null, obligatorio: true, id: id.equipo,
    cargarOpciones: () => opcionesEquipos(ctx.organizacion_id), rotuloOrigen: 'Nueva instalación' });
  lic.listo.then(revisar);
  const cuenta = verPersonas ? selectorConCrear({ desde: 'instalaciones_licencia', campo: 'cuenta_id', organizacion_id: ctx.organizacion_id, valor: v.cuenta_id || null, id: id.cuenta,
    cargarOpciones: () => opcionesCuentas(ctx.organizacion_id), rotuloOrigen: 'Nueva instalación' }) : null;
  const persona = verPersonas ? selectorConCrear({ desde: 'instalaciones_licencia', campo: 'persona_id', organizacion_id: ctx.organizacion_id, valor: v.persona_id || null, id: id.persona,
    cargarOpciones: () => opcionesPersonas(ctx.organizacion_id, { soloActivas: true }), rotuloOrigen: 'Nueva instalación' }) : null;
  return abrirFormularioDeAlta({
    titulo: 'Instalar una licencia en un equipo', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva instalación' ? ctx.rotulo : null, textoGuardar: 'Agregar instalación', enfocar: lic.value ? equipo : lic,
    secciones: [{ titulo: 'Qué se instala dónde', cuerpo: [campoDeAlta(id.lic, 'Licencia *', lic), campoDeAlta(id.equipo, 'Equipo *', equipo), aviso, campoDeAlta(id.desde, 'Instalada desde *', desde)] },
      { titulo: 'Quién la usa', cuerpo: [cuenta ? campoDeAlta(id.cuenta, 'Cuenta de dominio', cuenta) : null, persona ? campoDeAlta(id.persona, 'Persona', persona) : null] }],
    mas: { resumen: 'fecha de retiro', cuerpo: [campoDeAlta(id.hasta, 'Retirada el', hasta, 'Vacío = sigue instalada.')] },
    alGuardar: async () => {
      if (!lic.value) throw new Error('Elegí la licencia (si no está cargada, usá «+ Crear nueva licencia…»).');
      if (!equipo.value) throw new Error('Elegí el equipo donde está instalada.');
      if (!desde.value) throw new Error('Indicá desde cuándo está instalada.');
      if (hasta.value && hasta.value < desde.value) throw new Error('La fecha de retiro no puede ser anterior a la instalación.');
      const ya = await repositorio.instalacionesDeLicencia(lic.value);
      if (ya.some(i => i.equipo_id === equipo.value && !i.instalacion_hasta)) throw new Error('Esa licencia ya está instalada en ese equipo.');
      return repositorio.guardar('instalaciones_licencia', { organizacion_id: ctx.organizacion_id, licencia_id: lic.value, equipo_id: equipo.value,
        cuenta_id: cuenta && cuenta.value || null, persona_id: persona && persona.value || null, instalacion_desde: desde.value, instalacion_hasta: hasta.value || null }, ctx.usuario.id);
    }
  });
});
