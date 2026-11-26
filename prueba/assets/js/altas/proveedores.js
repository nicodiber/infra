// @ts-check
/**
 * Alta de proveedores de la organización (colección `proveedores`, QC75): quién da el servicio, cómo contactarlo y qué número
 * de cliente o de contrato tenemos con él. Se abre con `abrirAlta('proveedores', {organizacion_id, valores, rotulo})`.
 * Valores iniciales: todos los `proveedor_*` y `credencial_id` (lo usa «Duplicar»).
 * El acceso al portal es una credencial: `selectorConCrear` (se crea al vuelo, con un nombre sugerido). Solo se ofrece a quien ve
 * el módulo Credenciales. La contraseña vive en la credencial, nunca acá.
 */

import { h } from '../utiles.js';
import { puede } from '../permisos.js';
import { RUBROS_PROVEEDOR } from '../modelos.js';
import { idUnico, registrarAlta, abrirFormularioDeAlta, campoDeAlta, selectorConCrear } from '../altas.js';
import * as repositorio from '../repositorio.js';
import { entrada, areaTexto } from './comunes.js';

registrarAlta('proveedores', async ctx => {
  const v = ctx.valores;
  const verCred = puede(ctx.usuario, 'ver', 'credenciales', ctx.organizacion_id);
  const id = { nombre: idUnico('pv-nombre'), rubro: idUnico('pv-rubro'), lista: idUnico('pv-rubros'), tel: idUnico('pv-tel'), mail: idUnico('pv-mail'), horario: idUnico('pv-horario'),
    cliente: idUnico('pv-cliente'), contrato: idUnico('pv-contrato'), cNombre: idUnico('pv-cnombre'), cTel: idUnico('pv-ctel'), cMail: idUnico('pv-cmail'), portal: idUnico('pv-portal'),
    cred: idUnico('pv-cred'), notas: idUnico('pv-notas') };
  const nombre = entrada(id.nombre, v.proveedor_nombre, { maxlength: '160', placeholder: 'Ej.: Proveedor de Internet' });
  const rubro = entrada(id.rubro, v.proveedor_rubro, { list: id.lista, placeholder: 'Internet, Telefonía, Mantenimiento…' });
  const sugerencias = h('datalist', { id: id.lista }, RUBROS_PROVEEDOR.map(x => h('option', { value: x })));
  const tel = entrada(id.tel, v.proveedor_soporte_telefono, { type: 'tel', placeholder: 'Ej.: 0800-555-0100' });
  const mail = entrada(id.mail, v.proveedor_soporte_mail, { type: 'email', placeholder: 'soporte@proveedor.example' });
  const horario = entrada(id.horario, v.proveedor_horario_soporte, { placeholder: 'Ej.: 24 x 7, o lunes a viernes de 9 a 18' });
  const cliente = entrada(id.cliente, v.proveedor_numero_cliente);
  const contrato = entrada(id.contrato, v.proveedor_numero_contrato);
  const cNombre = entrada(id.cNombre, v.proveedor_comercial_nombre, { placeholder: 'Persona de contacto comercial' });
  const cTel = entrada(id.cTel, v.proveedor_comercial_telefono, { type: 'tel' });
  const cMail = entrada(id.cMail, v.proveedor_comercial_mail, { type: 'email' });
  const portal = entrada(id.portal, v.proveedor_portal_url, { type: 'url', placeholder: 'https://portal.proveedor.example' });
  const notas = areaTexto(id.notas, v.proveedor_notas, 3);
  const valoresCred = /** @type {Object<string, any>} */ ({ credencial_tipo: 'otro' });
  const sugerir = () => { valoresCred.credencial_nombre = nombre.value.trim() ? 'Portal: ' + nombre.value.trim() : ''; };
  nombre.addEventListener('input', sugerir); sugerir();
  const cred = verCred ? selectorConCrear({ desde: 'proveedores', campo: 'credencial_id', organizacion_id: ctx.organizacion_id, valor: v.credencial_id || null, id: id.cred,
    valoresAlta: valoresCred, rotuloOrigen: 'Nuevo proveedor' }) : null;
  const texto = (/** @type {HTMLInputElement|HTMLTextAreaElement} */ x) => x.value.trim() || null;
  return abrirFormularioDeAlta({
    titulo: 'Nuevo proveedor', rotulo: ctx.rotulo && ctx.rotulo !== 'Nuevo proveedor' ? ctx.rotulo : null, textoGuardar: 'Crear proveedor', enfocar: nombre,
    secciones: [{ titulo: 'Identificación', cuerpo: [campoDeAlta(id.nombre, 'Nombre *', nombre), h('div', { class: 'campo' }, [h('label', { for: id.rubro, text: 'Rubro' }), rubro, sugerencias])] },
      { titulo: 'Soporte', cuerpo: [campoDeAlta(id.tel, 'Teléfono de soporte', tel), campoDeAlta(id.mail, 'Mail de soporte', mail), campoDeAlta(id.horario, 'Horario de soporte', horario)] }],
    mas: { resumen: 'cliente, contrato, contacto comercial, portal, notas', cuerpo: [campoDeAlta(id.cliente, 'N.º de cliente', cliente), campoDeAlta(id.contrato, 'N.º de contrato', contrato),
      campoDeAlta(id.cNombre, 'Contacto comercial', cNombre), campoDeAlta(id.cTel, 'Teléfono comercial', cTel), campoDeAlta(id.cMail, 'Mail comercial', cMail),
      campoDeAlta(id.portal, 'Portal del proveedor (URL)', portal),
      cred ? campoDeAlta(id.cred, 'Acceso al portal (credencial)', cred, 'La contraseña del portal se carga en la credencial, no acá.') : null,
      campoDeAlta(id.notas, 'Notas', notas)] },
    alGuardar: async () => {
      if (!nombre.value.trim()) throw new Error('Escribí el nombre del proveedor.');
      return repositorio.guardar('proveedores', { organizacion_id: ctx.organizacion_id, proveedor_nombre: nombre.value.trim(), proveedor_rubro: texto(rubro),
        proveedor_soporte_telefono: texto(tel), proveedor_soporte_mail: texto(mail), proveedor_horario_soporte: texto(horario), proveedor_numero_cliente: texto(cliente),
        proveedor_numero_contrato: texto(contrato), proveedor_comercial_nombre: texto(cNombre), proveedor_comercial_telefono: texto(cTel), proveedor_comercial_mail: texto(cMail),
        proveedor_portal_url: texto(portal), credencial_id: cred && cred.value || null, proveedor_notas: texto(notas) }, ctx.usuario.id);
    }
  });
});
