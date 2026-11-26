// @ts-check
/**
 * Alta de redes Wi-Fi (colección `redes_wifi`, D-083). Se abre con `abrirAlta('redes_wifi', {organizacion_id, valores, rotulo})`.
 *
 * Valores iniciales (`ctx.valores`): `wifi_ssid`, `wifi_seguridad`, `wifi_oculta`, `vlan_id`, `credencial_id`, `access_point_ids`,
 * `duplicado_de`. La VLAN, la credencial de la clave y los access points se eligen con «+ Crear …»: se puede crear la VLAN
 * (y el access point) en el momento, encima de este formulario.
 */

import * as repositorio from '../repositorio.js';
import { puede } from '../permisos.js';
import { h, normalizar } from '../utiles.js';
import { ROTULO_SEGURIDAD } from '../red.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear, multiConCrear, opcionesDe } from '../altas.js';

registrarAlta('redes_wifi', async ctx => {
  const v = ctx.valores;
  const ID_SSID = idUnico('wf-ssid'), ID_SEG = idUnico('wf-seg'), ID_VLAN = idUnico('wf-vlan'), ID_CRED = idUnico('wf-cred'), ID_OC = idUnico('wf-oculta');
  const org = ctx.organizacion_id;
  const ssid = /** @type {HTMLInputElement} */ (h('input', { id: ID_SSID, type: 'text', maxlength: '64', placeholder: 'Ej.: Empresa-Interna' }));
  ssid.value = v.wifi_ssid || '';
  const seg = /** @type {HTMLSelectElement} */ (h('select', { id: ID_SEG }, Object.keys(ROTULO_SEGURIDAD).map(k => h('option', { value: k, text: ROTULO_SEGURIDAD[k] }))));
  seg.value = v.wifi_seguridad || 'wpa2';
  const oculta = /** @type {HTMLSelectElement} */ (h('select', { id: ID_OC }, [h('option', { value: 'no', text: 'No' }), h('option', { value: 'si', text: 'Sí' })]));
  oculta.value = v.wifi_oculta ? 'si' : 'no';
  const vlan = selectorConCrear({ desde: 'redes_wifi', campo: 'vlan_id', organizacion_id: org, valor: v.vlan_id || null, id: ID_VLAN, rotuloOrigen: 'Nueva red Wi-Fi' });
  const verCreds = puede(ctx.usuario, 'ver', 'credenciales', org);
  const cred = verCreds ? selectorConCrear({ desde: 'redes_wifi', campo: 'credencial_id', organizacion_id: org, valor: v.credencial_id || null, id: ID_CRED, rotuloOrigen: 'Nueva red Wi-Fi',
    cargarOpciones: async () => (await opcionesDe('credenciales', org, { filtro: c => c.credencial_tipo === 'wifi' })), valoresAlta: { credencial_tipo: 'wifi' } }) : null;
  const aps = multiConCrear({ desde: 'redes_wifi', campo: 'access_point_ids', organizacion_id: org, valores: v.access_point_ids || [], rotuloOrigen: 'Nueva red Wi-Fi', etiqueta: 'Access points que la emiten',
    vacio: 'Todavía no hay access points cargados.', valoresAlta: { equipo_tipo: 'access_point', tipos: ['access_point'] },
    cargarOpciones: async () => (await opcionesDe('equipos', org, { filtro: e => e.equipo_tipo === 'access_point' })) });
  const cCred = cred ? campoDeAlta(ID_CRED, 'Credencial de la clave', cred, 'Sin clave si la red es abierta.') : null;
  const alSeg = () => { if (cCred) cCred.hidden = seg.value === 'abierta' || seg.value === 'portal'; };
  seg.addEventListener('change', alSeg); alSeg();
  const dos = (/** @type {Node[]} */ ...c) => h('div', { class: 'rk-dos' }, c);
  return abrirFormularioDeAlta({
    titulo: 'Nueva red Wi-Fi', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva red Wi-Fi' ? ctx.rotulo : null, textoGuardar: 'Crear red Wi-Fi', enfocar: ssid,
    intro: v.duplicado_de ? 'Copia de «' + v.duplicado_de + '»: el SSID tiene que ser distinto. Los campos con * son obligatorios.' : undefined,
    cuerpo: [dos(campoDeAlta(ID_SSID, 'SSID *', ssid), campoDeAlta(ID_SEG, 'Seguridad *', seg)), dos(campoDeAlta(ID_VLAN, 'VLAN', vlan, 'La VLAN a la que cae la red.'), campoDeAlta(ID_OC, 'SSID oculto', oculta)),
      cCred, h('div', { class: 'campo' }, [h('label', { text: 'Access points que la emiten' }), aps.nodo])],
    alGuardar: async () => {
      const nom = ssid.value.trim();
      if (!nom) throw new Error('Falta el SSID.');
      const otras = await repositorio.listar('redes_wifi', { organizacion_id: org });
      if (otras.some(w => normalizar(w.wifi_ssid) === normalizar(nom))) throw new Error('Ya existe una red Wi-Fi con el SSID «' + nom + '» en esta organización.');
      const sinClave = seg.value === 'abierta' || seg.value === 'portal';
      return repositorio.guardar('redes_wifi', { organizacion_id: org, wifi_ssid: nom, vlan_id: vlan.value || null, wifi_seguridad: seg.value, wifi_oculta: oculta.value === 'si',
        credencial_id: sinClave || !cred ? (sinClave ? null : v.credencial_id || null) : cred.value || null, access_point_ids: aps.valores() }, ctx.usuario.id);
    }
  });
});
