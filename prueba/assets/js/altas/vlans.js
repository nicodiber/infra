// @ts-check
/**
 * Alta de VLAN (colección `vlans`, D-083). Se abre con `abrirAlta('vlans', {organizacion_id, valores, rotulo})`.
 *
 * Valores iniciales (`ctx.valores`): `vlan_numero`, `vlan_nombre`, `vlan_red_cidr`, `vlan_gateway`, `vlan_dhcp_activo`,
 * `vlan_dhcp_rango`, `vlan_descripcion`; `duplicado_de` (nombre de la VLAN que se copia, solo para el aviso).
 * Una VLAN no depende de otra entidad: no lleva selectores con «+ Crear».
 *
 * `problemasDeVlan` es la validación compartida: la usan este alta y la edición de la ficha (`views/vlan.view.js`).
 */

import * as repositorio from '../repositorio.js';
import { h, normalizar } from '../utiles.js';
import { ipANumero } from '../red.js';
import { leerCidr, enlazarValidacion, validarNumeroVlan, validarCidr, validarGateway, validarRangoDhcp } from '../validaciones.js';

export { leerCidr };
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta } from '../altas.js';

/**
 * Problemas de los datos de una VLAN (lista vacía = todo bien). Comprueba número 1 a 4094 y único en la organización, nombre,
 * red en CIDR, gateway dentro de la red y rango DHCP (obligatorio con DHCP activo, «ip - ip», dentro de la red).
 * @param {{vlan_numero: number|null, vlan_nombre: string, vlan_red_cidr: string|null, vlan_gateway: string|null, vlan_dhcp_activo: boolean, vlan_dhcp_rango: string|null}} v
 * @param {{orgId: string, idActual?: string|null}} o
 * @returns {Promise<string[]>}
 */
export async function problemasDeVlan(v, o) {
  /** @type {string[]} */
  const e = [];
  const n = v.vlan_numero;
  if (n == null || !Number.isInteger(n) || n < 1 || n > 4094) e.push('El número de VLAN va de 1 a 4094.');
  else {
    const otra = (await repositorio.listar('vlans', { organizacion_id: o.orgId })).find(x => x.id !== o.idActual && x.vlan_numero === n);
    if (otra) e.push('Ya existe la VLAN ' + n + ' («' + otra.vlan_nombre + '») en esta organización.');
  }
  if (!String(v.vlan_nombre || '').trim()) e.push('Falta el nombre de la VLAN.');
  const red = v.vlan_red_cidr ? leerCidr(v.vlan_red_cidr) : null;
  if (v.vlan_red_cidr && !red) e.push('La red tiene que estar en formato CIDR, por ejemplo 10.10.20.0/24.');
  if (v.vlan_gateway) {
    const g = ipANumero(v.vlan_gateway);
    if (g == null) e.push('El gateway no es una IP válida (por ejemplo 10.10.20.1).');
    else if (red && (g < red.base || g >= red.base + red.tam)) e.push('El gateway ' + v.vlan_gateway + ' no está dentro de la red ' + v.vlan_red_cidr + '.');
  }
  if (v.vlan_dhcp_activo && !v.vlan_dhcp_rango) e.push('Si el DHCP está activo, indicá el rango (por ejemplo 10.10.20.100 - 10.10.20.200).');
  if (v.vlan_dhcp_rango) {
    const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*[-–]\s*(\d{1,3}(?:\.\d{1,3}){3})\s*$/.exec(v.vlan_dhcp_rango);
    const a = m ? ipANumero(m[1]) : null, b = m ? ipANumero(m[2]) : null;
    if (a == null || b == null) e.push('El rango DHCP tiene que ser «IP inicial - IP final», por ejemplo 10.10.20.100 - 10.10.20.200.');
    else if (a > b) e.push('El rango DHCP empieza después de donde termina.');
    else if (red && (a < red.base || b >= red.base + red.tam)) e.push('El rango DHCP no está dentro de la red ' + v.vlan_red_cidr + '.');
  }
  return e;
}

registrarAlta('vlans', async ctx => {
  const v = ctx.valores;
  const ID_NUM = idUnico('vl-num'), ID_NOM = idUnico('vl-nom'), ID_CIDR = idUnico('vl-cidr'), ID_GW = idUnico('vl-gw'), ID_DHCP = idUnico('vl-dhcp'), ID_RANGO = idUnico('vl-rango'), ID_DESC = idUnico('vl-desc');
  const numero = /** @type {HTMLInputElement} */ (h('input', { id: ID_NUM, type: 'number', min: '1', max: '4094', step: '1' }));
  numero.value = v.vlan_numero == null ? '' : String(v.vlan_numero);
  const nombre = /** @type {HTMLInputElement} */ (h('input', { id: ID_NOM, type: 'text', maxlength: '120', placeholder: 'Ej.: Administración' }));
  nombre.value = v.vlan_nombre || '';
  const cidr = /** @type {HTMLInputElement} */ (h('input', { id: ID_CIDR, type: 'text', placeholder: '10.10.20.0/24' }));
  cidr.value = v.vlan_red_cidr || '';
  const gateway = /** @type {HTMLInputElement} */ (h('input', { id: ID_GW, type: 'text', placeholder: '10.10.20.1' }));
  gateway.value = v.vlan_gateway || '';
  const dhcp = /** @type {HTMLSelectElement} */ (h('select', { id: ID_DHCP }, [h('option', { value: 'no', text: 'No (IP fija)' }), h('option', { value: 'si', text: 'Sí' })]));
  dhcp.value = v.vlan_dhcp_activo ? 'si' : 'no';
  const rango = /** @type {HTMLInputElement} */ (h('input', { id: ID_RANGO, type: 'text', placeholder: '10.10.20.100 - 10.10.20.200' }));
  rango.value = v.vlan_dhcp_rango || '';
  const desc = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: ID_DESC, rows: '2', placeholder: 'Para qué se usa' }));
  desc.value = v.vlan_descripcion || '';
  const cRango = campoDeAlta(ID_RANGO, 'Rango DHCP *', rango, 'Formato «IP inicial - IP final».');
  const alDhcp = () => { cRango.hidden = dhcp.value !== 'si'; };
  dhcp.addEventListener('change', alDhcp); alDhcp();
  // Validación al salir de cada campo (QC78-A): número repetido, red en CIDR, gateway y rango DHCP dentro de la red.
  const cNumero = campoDeAlta(ID_NUM, 'Número (1 a 4094) *', numero), cCidr = campoDeAlta(ID_CIDR, 'Red (CIDR)', cidr), cGw = campoDeAlta(ID_GW, 'Gateway', gateway);
  enlazarValidacion(cNumero, () => validarNumeroVlan({ numero: numero.value, org: ctx.organizacion_id }));
  enlazarValidacion(cCidr, () => validarCidr(cidr.value));
  enlazarValidacion(cGw, () => validarGateway(gateway.value, cidr.value), { tambien: [cidr] });
  enlazarValidacion(cRango, () => validarRangoDhcp(rango.value, cidr.value), { tambien: [cidr] });

  return abrirFormularioDeAlta({
    titulo: 'Nueva VLAN', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva VLAN' ? ctx.rotulo : null, textoGuardar: 'Crear VLAN', enfocar: numero,
    intro: v.duplicado_de ? 'Copia de «' + v.duplicado_de + '»: cambiá el número (tiene que ser distinto) y lo que haga falta. Los campos con * son obligatorios.' : undefined,
    secciones: [{ titulo: 'Identificación', cuerpo: [cNumero, campoDeAlta(ID_NOM, 'Nombre *', nombre)] },
      { titulo: 'Red', cuerpo: [cCidr, cGw, campoDeAlta(ID_DHCP, 'DHCP activo', dhcp), cRango] }],
    mas: { resumen: 'uso', cuerpo: [campoDeAlta(ID_DESC, 'Uso', desc)] },
    alGuardar: async () => {
      const activo = dhcp.value === 'si';
      const datos = { vlan_numero: numero.value.trim() === '' ? null : Number(numero.value), vlan_nombre: nombre.value.trim(), vlan_red_cidr: cidr.value.trim() || null,
        vlan_gateway: gateway.value.trim() || null, vlan_dhcp_activo: activo, vlan_dhcp_rango: activo ? rango.value.trim() || null : null };
      const problemas = await problemasDeVlan(datos, { orgId: ctx.organizacion_id });
      if (problemas.length) throw new Error(problemas.join(' '));
      return repositorio.guardar('vlans', { organizacion_id: ctx.organizacion_id, ...datos, vlan_descripcion: desc.value.trim() || null }, ctx.usuario.id);
    }
  });
});

void normalizar;
