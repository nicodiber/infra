// @ts-check
/**
 * Alta de enlaces a Internet (colección `enlaces_isp`, D-083). Se abre con `abrirAlta('enlaces_isp', {organizacion_id, valores, rotulo})`.
 *
 * Valores iniciales: `enlace_proveedor`, `enlace_tipo`, `enlace_velocidad_bajada_mbps`, `enlace_velocidad_subida_mbps`, `enlace_ip_publica`,
 * `enlace_tipo_ip`, `equipo_id`, `enlace_numero_cliente`, `enlace_telefono_soporte`, `enlace_es_principal`.
 * El equipo donde termina (router o firewall) se elige con «+ Crear …».
 */

import * as repositorio from '../repositorio.js';
import { h } from '../utiles.js';
import { ROTULO_ENLACE_TIPO } from '../red.js';
import { ipValida } from '../racks.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear, opcionesDe } from '../altas.js';
import { enlazarValidacion } from '../validaciones.js';

registrarAlta('enlaces_isp', async ctx => {
  const v = ctx.valores;
  const org = ctx.organizacion_id;
  const ID = { prov: idUnico('is-prov'), tipo: idUnico('is-tipo'), baja: idUnico('is-baja'), sube: idUnico('is-sube'), ip: idUnico('is-ip'), tip: idUnico('is-tip'),
    eq: idUnico('is-eq'), cli: idUnico('is-cli'), tel: idUnico('is-tel'), pri: idUnico('is-pri') };
  const existentes = await repositorio.listar('enlaces_isp', { organizacion_id: org });
  const principal = existentes.find(e => e.enlace_es_principal) || null;
  const txt = (/** @type {string} */ id, /** @type {string|undefined} */ val, /** @type {Object<string,string>} */ ex) => { const i = /** @type {HTMLInputElement} */ (h('input', { id, type: 'text', ...(ex || {}) })); i.value = val || ''; return i; };
  const num = (/** @type {string} */ id, /** @type {any} */ val) => { const i = /** @type {HTMLInputElement} */ (h('input', { id, type: 'number', min: '0', step: '1' })); i.value = val == null ? '' : String(val); return i; };
  const prov = txt(ID.prov, v.enlace_proveedor, { maxlength: '120', placeholder: 'Ej.: Proveedor Demo Fibra' });
  const tipo = /** @type {HTMLSelectElement} */ (h('select', { id: ID.tipo }, Object.keys(ROTULO_ENLACE_TIPO).map(k => h('option', { value: k, text: ROTULO_ENLACE_TIPO[k] }))));
  tipo.value = v.enlace_tipo || 'fibra';
  const baja = num(ID.baja, v.enlace_velocidad_bajada_mbps), sube = num(ID.sube, v.enlace_velocidad_subida_mbps);
  const ip = txt(ID.ip, v.enlace_ip_publica, { placeholder: '203.0.113.45' });
  const tip = /** @type {HTMLSelectElement} */ (h('select', { id: ID.tip }, [h('option', { value: '', text: '—' }), h('option', { value: 'fija', text: 'Fija' }), h('option', { value: 'dinamica', text: 'Dinámica' })]));
  tip.value = v.enlace_tipo_ip || '';
  const equipo = selectorConCrear({ desde: 'enlaces_isp', campo: 'equipo_id', organizacion_id: org, valor: v.equipo_id || null, id: ID.eq, rotuloOrigen: 'Nuevo enlace a Internet',
    cargarOpciones: () => opcionesDe('equipos', org, { filtro: e => e.equipo_tipo === 'router' || e.equipo_tipo === 'firewall' }), valoresAlta: { equipo_tipo: 'router', tipos: ['router', 'firewall'] } });
  const cli = txt(ID.cli, v.enlace_numero_cliente), tel = txt(ID.tel, v.enlace_telefono_soporte);
  const pri = /** @type {HTMLSelectElement} */ (h('select', { id: ID.pri }, [h('option', { value: 'si', text: 'Principal' }), h('option', { value: 'no', text: 'Respaldo' })]));
  pri.value = v.enlace_es_principal != null ? (v.enlace_es_principal ? 'si' : 'no') : (principal ? 'no' : 'si');
  const cIp = campoDeAlta(ID.ip, 'IP pública', ip);
  enlazarValidacion(cIp, () => (ip.value.trim() && !ipValida(ip.value.trim()) ? { nivel: 'mal', mensaje: 'La IP pública no es válida (por ejemplo 203.0.113.45).' } : null));
  return abrirFormularioDeAlta({
    titulo: 'Nuevo enlace a Internet', rotulo: ctx.rotulo && ctx.rotulo !== 'Nuevo enlace a Internet' ? ctx.rotulo : null, textoGuardar: 'Crear enlace', enfocar: prov,
    secciones: [{ titulo: 'Identificación', cuerpo: [campoDeAlta(ID.prov, 'Proveedor *', prov), campoDeAlta(ID.tipo, 'Medio *', tipo),
      campoDeAlta(ID.pri, 'Rol *', pri, principal ? 'Ya hay un enlace principal («' + principal.enlace_proveedor + '»): este tiene que ser de respaldo.' : 'Máximo un enlace principal por organización.')] },
      { titulo: 'Velocidad e IP', cuerpo: [campoDeAlta(ID.baja, 'Bajada contratada (Mbps)', baja), campoDeAlta(ID.sube, 'Subida contratada (Mbps)', sube), cIp, campoDeAlta(ID.tip, 'Tipo de IP', tip)] },
      { titulo: 'Conexión', cuerpo: [campoDeAlta(ID.eq, 'Termina en (router o firewall)', equipo)] }],
    mas: { resumen: 'N.º de cliente, teléfono de soporte', cuerpo: [campoDeAlta(ID.cli, 'N.º de cliente o de servicio', cli), campoDeAlta(ID.tel, 'Teléfono de soporte', tel)] },
    alGuardar: async () => {
      const p = prov.value.trim();
      if (!p) throw new Error('Falta el proveedor.');
      const entero = (/** @type {HTMLInputElement} */ i, /** @type {string} */ n) => { if (i.value.trim() === '') return null; const x = Number(i.value); if (!Number.isInteger(x) || x < 0) throw new Error(n + ' tiene que ser un entero positivo.'); return x; };
      const b = entero(baja, 'La bajada'), s = entero(sube, 'La subida');
      if (ip.value.trim() && !ipValida(ip.value.trim())) throw new Error('La IP pública no es válida (por ejemplo 203.0.113.45).');
      const esP = pri.value === 'si';
      if (esP && principal) throw new Error('Ya hay un enlace principal («' + principal.enlace_proveedor + '»). Dejá este como respaldo o cambiá primero el otro.');
      return repositorio.guardar('enlaces_isp', { organizacion_id: org, enlace_proveedor: p, enlace_tipo: tipo.value, enlace_velocidad_bajada_mbps: b, enlace_velocidad_subida_mbps: s,
        enlace_ip_publica: ip.value.trim() || null, enlace_tipo_ip: tip.value || null, equipo_id: equipo.value || null, enlace_numero_cliente: cli.value.trim() || null,
        enlace_telefono_soporte: tel.value.trim() || null, enlace_es_principal: esP }, ctx.usuario.id);
    }
  });
});
