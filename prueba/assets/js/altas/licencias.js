// @ts-check
/**
 * Alta de licencias de software (colección `licencias`). Se abre con `abrirAlta('licencias', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: `licencia_producto`, `licencia_tipo`, `licencia_cantidad`, `licencia_vence_en`, `licencia_proveedor`, `credencial_id`.
 * La clave vive en una credencial (tipo «Clave de licencia»): se elige con `selectorConCrear` o se crea al vuelo (nunca se
 * escribe ni se muestra acá). Como antes, el selector de la clave solo se ofrece a quien puede modificar credenciales.
 */

import { h } from '../utiles.js';
import { puede } from '../permisos.js';
import { ROTULO_LICENCIA_TIPO } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { entrada, selectorDeRotulos } from './comunes.js';

registrarAlta('licencias', async ctx => {
  const v = ctx.valores;
  const creaClaves = puede(ctx.usuario, 'modificar', 'credenciales', ctx.organizacion_id);
  const id = { producto: idUnico('li-producto'), tipo: idUnico('li-tipo'), cantidad: idUnico('li-cantidad'), vence: idUnico('li-vence'), proveedor: idUnico('li-proveedor'), clave: idUnico('li-clave') };
  const producto = entrada(id.producto, v.licencia_producto, { maxlength: '120', placeholder: 'Ej.: Microsoft 365 Business Standard' });
  const tipo = selectorDeRotulos(id.tipo, ROTULO_LICENCIA_TIPO, v.licencia_tipo || 'suscripcion');
  const cantidad = entrada(id.cantidad, v.licencia_cantidad == null ? '1' : String(v.licencia_cantidad), { type: 'number', min: '1', step: '1' });
  const vence = entrada(id.vence, v.licencia_vence_en, { type: 'date' });
  const proveedor = entrada(id.proveedor, v.licencia_proveedor);
  const cVence = campoDeAlta(id.vence, 'Vence el', vence, 'Una licencia perpetua no vence.');
  const ajustar = () => { cVence.hidden = tipo.value === 'perpetua'; };
  tipo.addEventListener('change', ajustar); ajustar();
  const valoresClave = /** @type {Object<string, any>} */ ({ credencial_tipo: 'clave_licencia' });
  producto.addEventListener('input', () => { valoresClave.credencial_nombre = producto.value.trim() ? 'Clave: ' + producto.value.trim() : ''; });
  const clave = creaClaves ? selectorConCrear({ desde: 'licencias', campo: 'credencial_id', organizacion_id: ctx.organizacion_id, valor: v.credencial_id || null, id: id.clave,
    valoresAlta: valoresClave, rotuloOrigen: 'Nueva licencia' }) : null;
  return abrirFormularioDeAlta({
    titulo: 'Nueva licencia', rotulo: ctx.rotulo && ctx.rotulo !== 'Nueva licencia' ? ctx.rotulo : null, textoGuardar: 'Crear licencia', enfocar: producto,
    secciones: [{ titulo: 'Identificación', cuerpo: [campoDeAlta(id.producto, 'Producto y edición *', producto), campoDeAlta(id.tipo, 'Tipo *', tipo), campoDeAlta(id.cantidad, 'Cantidad comprada *', cantidad), cVence] }],
    mas: { resumen: 'proveedor, clave', cuerpo: [campoDeAlta(id.proveedor, 'Proveedor', proveedor),
      clave ? campoDeAlta(id.clave, 'Clave (credencial)', clave, 'La clave se guarda como credencial de tipo «Clave de licencia»: queda oculta y se pide con registro. Las OEM atadas al equipo pueden no tenerla.')
        : h('div', { class: 'mut', text: 'Tu rol no puede crear credenciales; pedile a quien las administre que cargue la clave y la vincule.' })] },
    alGuardar: async () => {
      const cant = Number(cantidad.value);
      if (!producto.value.trim()) throw new Error('Escribí el producto y la edición.');
      if (!Number.isInteger(cant) || cant < 1) throw new Error('La cantidad comprada tiene que ser un número entero de 1 o más.');
      return repositorio.guardar('licencias', { organizacion_id: ctx.organizacion_id, licencia_producto: producto.value.trim(), licencia_tipo: tipo.value, licencia_cantidad: cant,
        licencia_vence_en: tipo.value === 'perpetua' ? null : vence.value || null, licencia_proveedor: proveedor.value.trim() || null, credencial_id: clave && clave.value || null }, ctx.usuario.id);
    }
  });
});
