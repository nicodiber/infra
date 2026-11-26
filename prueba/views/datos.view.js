// @ts-check
/**
 * P18 · Datos del prototipo (CU11, CU12, H02): exportar, importar (solo superadmin) y restablecer los datos de
 * ejemplo (solo superadmin). Explica dónde viven los datos (D-042). Incluye la planilla de Excel con la estructura de
 * Infradoc (assets/js/planilla.js, docs/planilla-infradoc.md).
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast, repintarMarco, pintarUltimaExportacion } from '../assets/js/marco.js';
import { h } from '../assets/js/utiles.js';
import * as planilla from '../assets/js/planilla.js';

/** Avisa a las métricas (D-080) sin importarlas. @param {string} tipo @param {Object} detalle */
const metrica = (tipo, detalle) => { try { window.dispatchEvent(new CustomEvent('infradoc:metrica', { detail: { tipo, detalle } })); } catch { /* nada */ } };

/** @type {Object<string, string>} */
const ROTULO_COLECCION = {
  organizaciones: 'organizaciones', usuarios: 'usuarios', permisos_modulo: 'permisos por módulo', ubicaciones: 'ubicaciones', racks: 'racks',
  equipos: 'equipos', puertos: 'puertos', vlans: 'VLAN', enlaces_isp: 'enlaces a Internet', redes_wifi: 'redes Wi-Fi', configuraciones: 'configuraciones',
  credenciales: 'credenciales', puestos: 'puestos de trabajo', solicitudes: 'solicitudes', registro_accesos: 'registros de acceso a credenciales',
  cambios: 'cambios (historial)', lecturas_cambio: 'cambios leídos', ajustes_sistema: 'ajustes del sistema'
};

/** @param {HTMLElement} contenedor */
export async function renderVistaDatos(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const orgId = sesion.organizacionActiva();
  const migas = await migasRaiz();
  migas.push(['Datos del prototipo']);
  pantalla(contenedor, { codigo: 'P18', nombre: 'Datos del prototipo', migas });

  const info = /** @type {any} */ (await repositorio.infoCarga());
  const zona = h('div');
  const puedeExportar = puede(u, 'exportar');
  const puedeImportar = puede(u, 'importar');
  const puedeRestablecer = puede(u, 'restablecer');
  const esSuper = u.usuario_perfil === 'superadmin';
  const hayNuevos = await repositorio.hayDatosEjemploNuevos();

  // ---- exportar
  const bExp = h('button', { type: 'button', text: 'Exportar a un archivo', disabled: puedeExportar ? null : 'disabled', onclick: async () => {
    try {
      const r = await repositorio.exportar({ organizacionId: esSuper ? null : orgId, incluirSecretos: esSuper, usuarioId: u.id });
      metrica('datos_exportar', { resultado: 'ok', registros: r.registros, formato: 'json' });
      toast('Exportado «' + r.archivo + '»: ' + r.registros + ' registros.');
      await pintarUltimaExportacion();
    } catch (e) { metrica('datos_exportar', { resultado: 'error', error: e instanceof Error ? e.message : '' }); toast(e instanceof Error ? e.message : 'No se pudo exportar.'); }
  } });

  // ---- importar
  const archivo = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Archivo a importar', disabled: puedeImportar ? null : 'disabled' }));
  archivo.addEventListener('change', async () => {
    zona.textContent = '';
    const f = archivo.files && archivo.files[0];
    if (!f) return;
    try {
      const r = await repositorio.analizarImportacion(await f.text());
      metrica('datos_importar_analizado', { resultado: 'ok', filas: Object.fromEntries(r.filas.map(x => [x[0], x[1]])), advertencias: r.advertencias.length });
      zona.appendChild(h('div', { class: 'msg' }, [
        h('div', { text: 'El archivo «' + f.name + '» tiene datos de ' + r.alcance + ' (' + r.organizaciones.join(', ') + '):' }),
        h('ul', { class: 'resumen-importar' }, r.filas.map(x => h('li', { text: x[1] + ' ' + (ROTULO_COLECCION[x[0]] || x[0]) }))),
        ...r.advertencias.map(a => h('div', { class: r.migrado && a.startsWith('El archivo se exportó con una versión anterior') ? 'msg' : 'msg mal', text: a })),
        h('div', { text: 'Importar reemplaza TODO lo que hay ahora en este navegador. Si querés conservarlo, exportalo antes.', style: 'font-weight:700' }),
        h('div', { class: 'herr', style: 'margin:8px 0 0' }, [
          h('button', { type: 'button', class: 'primario', text: 'Sí, reemplazar los datos', onclick: async () => {
            try {
              await repositorio.aplicarImportacion();
              metrica('datos_importar', { resultado: 'ok' });
              await terminarCambioDeDatos('Datos importados');
            } catch (e) { metrica('datos_importar', { resultado: 'error', error: e instanceof Error ? e.message : '' }); toast(e instanceof Error ? e.message : 'No se pudo importar.'); }
          } }),
          h('button', { type: 'button', text: 'Cancelar', onclick: () => { repositorio.cancelarImportacion(); zona.textContent = ''; archivo.value = ''; } })])]));
    } catch (e) {
      metrica('datos_importar_analizado', { resultado: 'error', error: e instanceof Error ? e.message : '' });
      zona.appendChild(h('div', { class: 'msg mal', role: 'alert', text: e instanceof Error ? e.message : 'No se pudo leer el archivo.' }));
    }
  });

  // ---- restablecer
  const bRes = h('button', { type: 'button', text: 'Restablecer datos de ejemplo', disabled: puedeRestablecer ? null : 'disabled', onclick: () => {
    zona.textContent = '';
    zona.appendChild(h('div', { class: 'msg mal' }, [
      h('div', { text: '¿Restablecer los datos de ejemplo? Se pierde todo lo que cargaste o cambiaste en este prototipo (equipos, solicitudes, historial, cambios leídos). Si querés conservarlo, exportalo antes.', style: 'font-weight:700' }),
      h('div', { class: 'herr', style: 'margin:8px 0 0' }, [
        h('button', { type: 'button', class: 'primario', text: 'Sí, restablecer', onclick: async () => {
          try {
            const r = await repositorio.restablecerDatosEjemplo();
            metrica('datos_restablecer', { resultado: 'ok', ms: r.totalMs });
            await terminarCambioDeDatos('Datos de ejemplo restablecidos (' + r.totalMs + ' ms)');
          } catch (e) { metrica('datos_restablecer', { resultado: 'error', error: e instanceof Error ? e.message : '' }); toast(e instanceof Error ? e.message : 'No se pudo restablecer.'); }
        } }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { zona.textContent = ''; } })])]));
  } });

  // ---- aviso de datos de ejemplo nuevos (D-073, QC43-C): nunca se restablece solo cuando hay datos propios
  const avisoNuevos = !hayNuevos ? null : h('div', { class: 'msg mal', role: 'status', style: 'margin:10px 0' }, [
    h('div', { text: 'Hay datos de ejemplo nuevos', style: 'font-weight:700' }),
    h('div', { text: 'El sitio trae una versión más nueva de los datos de ejemplo. Como en este navegador hay datos que cargaste o cambiaste, no se reemplazaron solos. Restablecer los vuelve a los de ejemplo y se pierde todo lo demás: exportá primero. Después podés importar tu exportación: aunque sea de una versión anterior del programa, se actualiza sola y no se pierde nada.', style: 'margin:4px 0 8px' }),
    h('div', { class: 'herr', style: 'margin:0' }, [
      h('button', { type: 'button', text: 'Exportar primero', disabled: puedeExportar ? null : 'disabled', onclick: () => bExp.click() }),
      h('button', { type: 'button', class: 'primario', text: 'Restablecer', disabled: puedeRestablecer ? null : 'disabled', onclick: () => bRes.click() })]),
    puedeExportar && puedeRestablecer ? null : h('div', { class: 'mut', style: 'margin-top:6px', text: 'Solo el superadmin puede exportar y restablecer los datos.' })]);

  /** Después de reemplazar todos los datos: la sesión puede haber quedado sin usuario. @param {string} mensaje */
  async function terminarCambioDeDatos(mensaje) {
    const vigente = await sesion.refrescar();
    toast(mensaje);
    if (!vigente) { sesion.salir(); ir('#/ingreso'); return; }
    if (esSuper) sesion.fijarOrganizacionActiva(null);
    await repintarMarco();
    ir(esSuper ? '#/organizaciones' : '#/inicio');
  }

  /** @param {string} titulo @param {string} texto @param {Array<HTMLElement|null>} controles @param {boolean} permitido @param {string} motivo */
  const bloque = (titulo, texto, controles, permitido, motivo) => h('div', { class: 'bloque bloque-datos' }, [
    h('h2', { text: titulo }), h('div', { class: 'mut', text: texto, style: 'margin:4px 0 10px' }), ...controles,
    permitido ? null : h('div', { class: 'mut', style: 'margin-top:8px', text: motivo })]);

  const tiempos = info.primeraCarga
    ? 'Esta sesión cargó los datos de ejemplo por primera vez en ' + info.totalMs + ' ms (descarga ' + info.descargaMs + ' ms, lectura ' + info.lecturaMs + ' ms, escritura en el navegador ' + info.escrituraMs + ' ms; ' + Math.round(info.bytes / 1024) + ' KB).'
    : 'Los datos ya estaban en este navegador: abrir la base tardó ' + info.totalMs + ' ms.' + (info.previa ? ' La primera carga de los datos de ejemplo tardó ' + info.previa.totalMs + ' ms (descarga ' + info.previa.descargaMs + ' ms, lectura ' + info.previa.lecturaMs + ' ms, escritura ' + info.previa.escrituraMs + ' ms).' : '');

  contenedor.appendChild(h('h1', { text: 'Datos del prototipo' }));
  if (avisoNuevos) contenedor.appendChild(avisoNuevos);
  contenedor.appendChild(h('div', { class: 'bloque', style: 'margin:10px 0' }, [
    h('p', { style: 'margin-top:0', text: 'Este prototipo guarda todo lo que cargues solo en este navegador (en la base IndexedDB de esta computadora y este usuario de Windows), sin cifrar y sin enviarlo a ningún lado. Cualquiera que use este navegador en esta computadora puede leerlo.' }),
    h('p', { text: 'Por eso: podés cargar la estructura real (equipos, puertos, VLAN), pero no cargues contraseñas reales (D-042). Con los datos de ejemplo podés probar todo sin riesgo.' }),
    h('p', { text: 'Antes de cada prueba, exportá tus datos. Si después se ajusta el programa, importá esa exportación: aunque sea de una versión anterior, se actualiza sola (los campos nuevos quedan con su valor por defecto y no se pierde nada). Si el sitio trae datos de ejemplo nuevos y todavía no cargaste ni cambiaste nada, se restablecen solos; si ya hay datos tuyos, no se toca nada y acá aparece un aviso.' }),
    h('p', { class: 'tiempo-carga', style: 'margin-bottom:0', text: tiempos })]));
  contenedor.appendChild(h('div', { class: 'fila', style: 'align-items:stretch;flex-wrap:wrap' }, [
    bloque('Exportar', 'Descarga un archivo con los datos de todas las organizaciones (incluidas las contraseñas de ejemplo, porque el superadmin las ve). Sirve para guardarlos o llevarlos a otro navegador.',
      [bExp], puedeExportar, 'Solo el superadmin puede exportar los datos.'),
    bloque('Importar', 'Reemplaza todos los datos de este navegador por los de un archivo exportado antes. Antes de reemplazar te muestra qué trae.', [archivo], puedeImportar, 'Solo el superadmin puede importar.'),
    bloque('Restablecer', 'Borra lo que cargaste y vuelve a los datos de ejemplo.', [bRes], puedeRestablecer, 'Solo el superadmin puede restablecer los datos de ejemplo.')]));
  // ---- planilla de Excel (D-075): bajar la planilla vacía, exportar los datos e importar una planilla completada
  const zonaPlanilla = h('div');
  const ordenCarga = planilla.ESQUEMA.map(x => x.nombre).join(' → ');
  const casillaSecretos = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: 'planilla-secretos', disabled: esSuper ? null : 'disabled' }));
  const avisoSecretos = h('div', { class: 'msg mal', role: 'alert', style: 'margin:6px 0;display:none', text: 'Atención: el archivo va a llevar las contraseñas de las credenciales y NO queda cifrado. Cualquiera que lo abra las lee. Guardalo en un lugar seguro y no lo envíes ni lo compartas.' });
  casillaSecretos.addEventListener('change', () => { avisoSecretos.style.display = casillaSecretos.checked ? '' : 'none'; });
  /** @param {boolean} vacia */
  const bajarPlanilla = async vacia => {
    try {
      const r = await planilla.generarPlanilla({ vacia, usuario: u, incluirContrasenas: casillaSecretos.checked });
      planilla.descargarArchivo(r.nombre, r.bytes);
      metrica('datos_planilla_exportar', { vacia, conContrasenas: !!r.contrasenas });
      const filas = r.resumen.reduce((n, x) => n + x[1], 0);
      toast(vacia ? 'Planilla vacía descargada «' + r.nombre + '».' : 'Planilla descargada «' + r.nombre + '»: ' + filas + ' filas' + (r.contrasenas ? ', con ' + r.contrasenas + ' contraseñas SIN cifrar' : ', sin contraseñas') + '.');
      if (!vacia && (r.recortadas || r.ambiguas)) {
        zonaPlanilla.textContent = '';
        zonaPlanilla.appendChild(h('div', { class: 'msg', role: 'status' }, [
          r.recortadas ? h('div', { text: r.recortadas + ' texto(s) eran más largos de lo que admite una celda de Excel y se recortaron.' }) : null,
          r.ambiguas ? h('div', { text: r.ambiguas + ' registro(s) tienen el mismo nombre que otro de su organización: en las hojas que los nombran se escribió su id para no confundirlos.' }) : null]));
      }
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar la planilla.'); }
  };
  const archivoPlanilla = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'aria-label': 'Planilla a importar', disabled: puedeImportar ? null : 'disabled' }));
  archivoPlanilla.addEventListener('change', async () => {
    zonaPlanilla.textContent = '';
    const f = archivoPlanilla.files && archivoPlanilla.files[0];
    if (!f) return;
    zonaPlanilla.appendChild(h('div', { class: 'mut', role: 'status', text: 'Leyendo «' + f.name + '»…' }));
    try {
      const plan = await planilla.analizarPlanilla(await f.arrayBuffer(), u);
      pintarVistaPrevia(plan, f.name);
    } catch (e) {
      zonaPlanilla.textContent = '';
      zonaPlanilla.appendChild(h('div', { class: 'msg mal', role: 'alert', text: e instanceof Error ? e.message : 'No se pudo leer la planilla.' }));
    }
  });

  /** Vista previa de lo que haría la importación, con los errores por hoja, fila y columna. @param {import('../assets/js/planilla.js').Plan} plan @param {string} nombreArchivo */
  function pintarVistaPrevia(plan, nombreArchivo) {
    zonaPlanilla.textContent = '';
    const presentes = plan.hojas.filter(x => x.presente);
    const ausentes = plan.hojas.filter(x => !x.presente);
    const sinDns = presentes.filter(x => x.nombre !== 'Registros DNS');
    const dns = presentes.find(x => x.nombre === 'Registros DNS');
    const totales = sinDns.reduce((t, x) => ({ crear: t.crear + x.crear, actualizar: t.actualizar + x.actualizar, sin: t.sin + x.sinCambios }), { crear: 0, actualizar: 0, sin: 0 });
    const tabla = h('table', { class: 'tabla-vista-previa' }, [
      h('thead', null, [h('tr', null, ['Hoja', 'Filas', 'Se crean', 'Se actualizan', 'Sin cambios', 'Con errores'].map(t => h('th', { text: t })))]),
      h('tbody', null, presentes.filter(x => x.filas > 0 || x.errores.length).map(x => h('tr', null, [x.nombre, String(x.filas), String(x.crear), String(x.actualizar), String(x.sinCambios), String(new Set(x.errores.filter(e => e.n > 1).map(e => e.n)).size)].map((t, i) => h('td', { text: t, ...(i === 5 && x.errores.length ? { style: 'font-weight:700' } : {}) })))))]);
    const bloqueErrores = plan.hojas.filter(x => x.errores.length || x.avisos.length).map(x => h('details', { open: x.errores.length || x.avisos.length ? 'open' : null, style: 'margin:6px 0' }, [
      h('summary', { text: x.nombre + (x.errores.length ? ': ' + x.errores.length + ' error' + (x.errores.length === 1 ? '' : 'es') : ': avisos') }),
      h('ul', { class: 'resumen-importar' }, [
        ...x.errores.slice(0, 100).map(e => h('li', { class: 'mal', text: x.nombre + (e.n > 1 ? ', fila ' + e.n : ', encabezado') + (e.col ? ', columna «' + e.col + '»' : '') + ': ' + e.mensaje })),
        x.errores.length > 100 ? h('li', { text: '… y ' + (x.errores.length - 100) + ' errores más.' }) : null,
        ...x.avisos.map(a => h('li', { text: x.nombre + ': ' + a }))])]));
    // QC58-A: lo que las filas mencionan y no existe se crea con los datos mínimos; acá se ve antes, qué es y desde qué fila.
    const porTipo = new Map();
    for (const c of plan.creaciones) { const l = porTipo.get(c.tipo) || []; l.push(c); porTipo.set(c.tipo, l); }
    const bloqueCrear = plan.creaciones.length ? h('details', { open: 'open', class: 'se-va-a-crear', style: 'margin:8px 0' }, [
      h('summary', { style: 'font-weight:700', text: 'Se va a crear ' + plan.creaciones.length + (plan.creaciones.length === 1 ? ' cosa' : ' cosas') + ' que las filas mencionan y todavía no existen' }),
      h('div', { class: 'mut', text: 'Se crean con los datos mínimos que se deducen (el nombre y poco más); después los completás en su ficha. Si la fila que lo pide tiene errores, no se crea.' }),
      h('ul', { class: 'resumen-importar' }, plan.creaciones.slice(0, 200).map(c => h('li', null, [
        h('b', { text: c.tipo + ' «' + c.nombre + '»' }), ' — ' + c.detalle + (plan.creaciones.some(x => x.organizacion !== c.organizacion) && c.organizacion ? ' (' + c.organizacion + ')' : '') + '. Lo pide ',
        c.desde.map(d => d.hoja + ', fila ' + d.fila + (d.columna ? ', columna «' + d.columna + '»' : '')).join('; ') + (c.total > c.desde.length ? ' y ' + (c.total - c.desde.length) + ' fila' + (c.total - c.desde.length === 1 ? '' : 's') + ' más' : '') + '.']))),
      plan.creaciones.length > 200 ? h('div', { class: 'mut', text: '… y ' + (plan.creaciones.length - 200) + ' más.' }) : null]) : null;
    const hayErrores = plan.errores > 0;
    const aplicar = async (/** @type {boolean} */ soloValidas) => {
      zonaPlanilla.textContent = '';
      zonaPlanilla.appendChild(h('div', { class: 'mut', role: 'status', text: 'Aplicando la planilla…' }));
      try {
        const r = await planilla.aplicarPlanilla(u, { soloValidas });
        archivoPlanilla.value = '';
        await repintarMarco();
        zonaPlanilla.textContent = '';
        zonaPlanilla.appendChild(h('div', { class: r.errores.length ? 'msg mal' : 'msg', role: 'status' }, [
          h('div', { style: 'font-weight:700', text: 'Planilla importada: ' + r.creados + ' creados, ' + r.actualizados + ' actualizados' + (r.conexiones ? ', ' + r.conexiones + ' conexiones nuevas' : '') + (r.creadosAutomaticos ? ' y ' + r.creadosAutomaticos + ' creados porque las filas los mencionaban y no existían (completalos en su ficha)' : '') + '.' }),
          r.errores.length ? h('div', { text: 'No se pudieron guardar ' + r.errores.length + ' filas:' }) : null,
          r.errores.length ? h('ul', { class: 'resumen-importar' }, r.errores.slice(0, 100).map(e => h('li', { text: e }))) : null]));
        metrica('datos_planilla_importar', { resultado: 'ok', creados: r.creados, actualizados: r.actualizados, creadosAutomaticos: r.creadosAutomaticos, filasConError: r.errores.length });
        toast('Planilla importada: ' + r.creados + ' creados, ' + r.actualizados + ' actualizados' + (r.creadosAutomaticos ? ', ' + r.creadosAutomaticos + ' creados automáticamente' : '') + '.');
      } catch (e) {
        zonaPlanilla.textContent = '';
        zonaPlanilla.appendChild(h('div', { class: 'msg mal', role: 'alert', text: e instanceof Error ? e.message : 'No se pudo importar la planilla.' }));
      }
    };
    const confirmarValidas = h('div');
    const bRespaldo = h('button', { type: 'button', text: 'Exportar un respaldo (JSON) antes', onclick: async () => {
      try {
        const r = await repositorio.exportar({ organizacionId: null, incluirSecretos: true, usuarioId: u.id });
        toast('Respaldo «' + r.archivo + '»: ' + r.registros + ' registros.');
        await pintarUltimaExportacion();
      } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar.'); }
    } });
    zonaPlanilla.appendChild(h('div', { class: 'msg' + (hayErrores ? ' mal' : ''), role: 'status' }, [
      h('div', { style: 'font-weight:700', text: 'Vista previa de «' + nombreArchivo + '» (todavía no se cambió nada)' }),
      h('div', { text: totales.crear + ' filas se crean, ' + totales.actualizar + ' se actualizan, ' + totales.sin + ' no cambian' + (dns && dns.crear ? ' (y se agregan ' + dns.crear + ' registros DNS a sus servicios)' : '') + (hayErrores ? ' y ' + plan.errores + ' errores impiden importar todo.' : '. No hay errores.') }),
      h('div', { class: 'tabla-scroll', style: 'overflow:auto;margin:8px 0' }, [tabla]),
      ausentes.length ? h('div', { class: 'mut', text: 'No están en el archivo: ' + ausentes.map(x => x.nombre).join(', ') + '.' }) : null,
      plan.contrasenas ? h('div', { class: 'msg mal', style: 'margin:6px 0', text: plan.contrasenas + ' credenciales traen contraseña: van a quedar sin cifrar en este navegador (D-042).' }) : null,
      bloqueCrear,
      ...bloqueErrores,
      h('div', { text: 'Importar no borra nada: crea lo nuevo y completa lo que ya existe (una celda vacía nunca pisa un dato). Todo queda en el historial.', style: 'margin-top:6px' }),
      h('div', { class: 'herr', style: 'margin:8px 0 0' }, [
        bRespaldo,
        h('button', { type: 'button', class: 'primario', text: 'Aplicar la planilla', disabled: hayErrores || !plan.validas ? 'disabled' : null, onclick: () => aplicar(false) }),
        hayErrores && plan.validas ? h('button', { type: 'button', text: 'Aplicar solo las filas válidas (' + plan.validas + ')', onclick: () => {
          confirmarValidas.textContent = '';
          confirmarValidas.appendChild(h('div', { class: 'msg mal', role: 'alert' }, [
            h('div', { style: 'font-weight:700', text: 'Las filas con errores (y las que dependen de ellas) NO se van a importar. ¿Aplicar solo las ' + plan.validas + ' filas válidas?' }),
            h('div', { class: 'herr', style: 'margin:8px 0 0' }, [
              h('button', { type: 'button', class: 'primario', text: 'Sí, aplicar las válidas', onclick: () => aplicar(true) }),
              h('button', { type: 'button', text: 'No', onclick: () => { confirmarValidas.textContent = ''; } })])]));
        } }) : null,
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { planilla.cancelarPlanilla(); zonaPlanilla.textContent = ''; archivoPlanilla.value = ''; } })]),
      confirmarValidas]));
    if (!plan.validas && !hayErrores) zonaPlanilla.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'La planilla no trae nada para crear ni actualizar.' }));
  }

  const bloquePlanilla = h('div', { class: 'bloque', style: 'margin:10px 0' }, [
    h('h2', { text: 'Planilla de Excel' }),
    h('p', { class: 'mut', style: 'margin:4px 0 8px', text: 'La estructura de Infradoc en un archivo de Excel (.xlsx): una hoja por tipo de dato y una hoja de instrucciones. Sirve para pasar la documentación del Excel desordenado a datos con estructura, como respaldo y para importar al producto final. Las referencias van por nombre (el rack «RACK-01», la sala «Sala de servidores»), así que se pueden completar a mano; lo que una fila nombra y todavía no existe se crea solo (lo ves en la vista previa antes de importar).' }),
    h('p', { style: 'margin:4px 0', text: 'Orden recomendado de carga (cada hoja apunta a las anteriores): ' + ordenCarga + '.' }),
    h('div', { class: 'herr', style: 'margin:8px 0' }, [
      h('button', { type: 'button', text: 'Descargar planilla vacía', onclick: () => bajarPlanilla(true) }),
      h('button', { type: 'button', text: 'Exportar mis datos a Excel', onclick: () => bajarPlanilla(false) })]),
    h('label', { for: 'planilla-secretos', style: 'display:flex;gap:6px;align-items:center;margin:4px 0' }, [casillaSecretos, 'Incluir contraseñas (solo superadmin)']),
    h('div', { class: 'mut', text: esSuper ? 'Sin la casilla, la planilla NO lleva contraseñas. Con la casilla, el archivo queda sin cifrar.' : 'Tu planilla lleva lo que tu perfil puede ver y nunca contraseñas.' }),
    avisoSecretos,
    h('div', { style: 'margin-top:12px;font-weight:700', text: 'Importar planilla' }),
    h('div', { class: 'mut', style: 'margin:4px 0 8px', text: 'Antes de aplicar nada ves una vista previa con lo que se crea, lo que se actualiza y los errores fila por fila.' }),
    archivoPlanilla,
    puedeImportar ? null : h('div', { class: 'mut', style: 'margin-top:8px', text: 'Solo el superadmin puede importar una planilla.' })]);
  contenedor.appendChild(zona);
  contenedor.appendChild(bloquePlanilla);
  contenedor.appendChild(zonaPlanilla);
}
