// @ts-check
/**
 * Alta de credenciales (colección `credenciales`). Se abre con `abrirAlta('credenciales', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `credencial_tipo`, `credencial_nombre`, `credencial_usuario`, `credencial_url_o_host`, `equipo_id`,
 * `configuracion_id`, `credencial_vence_en`, `credencial_notas`. La contraseña NUNCA se precarga (ni se copia al duplicar).
 * La contraseña es un secreto: `input type=password`, «Mostrar mientras escribo» solo en este formulario, y se guarda por
 * `repositorio.guardar` (que la maneja como secreto y deja el historial oculto). Equipo y configuración con `selectorConCrear`.
 */

import { h } from '../utiles.js';
import { ROTULO_CREDENCIAL_TIPO } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { entrada, areaTexto, selectorDeRotulos, opcionesEquipos } from './comunes.js';

registrarAlta('credenciales', async ctx => {
  const v = ctx.valores;
  const id = { nombre: idUnico('cr-nombre'), tipo: idUnico('cr-tipo'), usuario: idUnico('cr-usuario'), host: idUnico('cr-host'), equipo: idUnico('cr-equipo'),
    config: idUnico('cr-config'), vence: idUnico('cr-vence'), notas: idUnico('cr-notas'), secreto: idUnico('cr-secreto'), ver: idUnico('cr-ver') };
  const nombre = entrada(id.nombre, v.credencial_nombre, { maxlength: '120', placeholder: 'Ej.: iLO SRV-ERP-01' });
  const tipo = selectorDeRotulos(id.tipo, ROTULO_CREDENCIAL_TIPO, v.credencial_tipo || 'otro');
  const usuario = entrada(id.usuario, v.credencial_usuario, { autocomplete: 'off' });
  const host = entrada(id.host, v.credencial_url_o_host, { placeholder: 'URL, IP o host donde se usa' });
  const vence = entrada(id.vence, v.credencial_vence_en, { type: 'date' });
  const notas = areaTexto(id.notas, v.credencial_notas, 2);
  const secreto = /** @type {HTMLInputElement} */ (h('input', { id: id.secreto, type: 'password', autocomplete: 'new-password', placeholder: 'Contraseña' }));
  const ver = /** @type {HTMLInputElement} */ (h('input', { id: id.ver, type: 'checkbox' }));
  ver.addEventListener('change', () => { secreto.type = ver.checked ? 'text' : 'password'; });
  const equipo = selectorConCrear({ desde: 'credenciales', campo: 'equipo_id', organizacion_id: ctx.organizacion_id, valor: v.equipo_id || null, id: id.equipo,
    cargarOpciones: () => opcionesEquipos(ctx.organizacion_id), rotuloOrigen: 'Nueva credencial' });
  const config = selectorConCrear({ desde: 'credenciales', campo: 'configuracion_id', organizacion_id: ctx.organizacion_id, valor: v.configuracion_id || null, id: id.config,
    rotuloOrigen: 'Nueva credencial' });
  return abrirFormularioDeAlta({
    titulo: 'Nueva credencial', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva credencial' ? ctx.rotulo : null, textoGuardar: 'Crear credencial', enfocar: nombre,
    secciones: [{ titulo: 'Identificación', cuerpo: [campoDeAlta(id.nombre, 'Nombre *', nombre), campoDeAlta(id.tipo, 'Tipo *', tipo),
      campoDeAlta(id.secreto, 'Contraseña *', h('div', null, [secreto, h('label', { for: id.ver, style: 'display:flex;gap:6px;align-items:center;margin-top:4px;font-size:12.5px;font-weight:400' }, [ver, 'Mostrar mientras escribo'])]),
        'Se guarda como secreto: después se ve solo con «Mostrar» y queda registrado.', { ancho: true }), campoDeAlta(id.usuario, 'Usuario', usuario), campoDeAlta(id.host, 'Host o URL', host)] },
      { titulo: 'A qué pertenece', cuerpo: [campoDeAlta(id.equipo, 'Equipo vinculado', equipo), campoDeAlta(id.config, 'Configuración vinculada', config)] }],
    mas: { resumen: 'vencimiento, notas', cuerpo: [campoDeAlta(id.vence, 'Vence el', vence), campoDeAlta(id.notas, 'Notas (sin la contraseña)', notas)] },
    alGuardar: async () => {
      if (!nombre.value.trim()) throw new Error('Escribí el nombre de la credencial.');
      if (!secreto.value) throw new Error('Escribí la contraseña de la credencial.');
      return repositorio.guardar('credenciales', { organizacion_id: ctx.organizacion_id, credencial_nombre: nombre.value.trim(), credencial_tipo: tipo.value,
        credencial_usuario: usuario.value.trim() || null, credencial_url_o_host: host.value.trim() || null, equipo_id: equipo.value || null, configuracion_id: config.value || null,
        credencial_vence_en: vence.value || null, credencial_notas: notas.value.trim() || null, credencial_secreto: secreto.value }, ctx.usuario.id);
    }
  });
});
