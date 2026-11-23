// @ts-check
/**
 * P18 · Datos del prototipo (CU11, CU12, H02): exportar, importar (solo superadmin) y restablecer los datos de
 * ejemplo (solo superadmin). Explica dónde viven los datos (D-042).
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast, repintarMarco, pintarUltimaExportacion } from '../assets/js/marco.js';
import { h } from '../assets/js/utiles.js';

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

  // ---- exportar
  const bExp = h('button', { type: 'button', text: 'Exportar a un archivo', disabled: puedeExportar ? null : 'disabled', onclick: async () => {
    try {
      const r = await repositorio.exportar({ organizacionId: esSuper ? null : orgId, incluirSecretos: esSuper, usuarioId: u.id });
      toast('Exportado «' + r.archivo + '»: ' + r.registros + ' registros.');
      await pintarUltimaExportacion();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar.'); }
  } });

  // ---- importar
  const archivo = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Archivo a importar', disabled: puedeImportar ? null : 'disabled' }));
  archivo.addEventListener('change', async () => {
    zona.textContent = '';
    const f = archivo.files && archivo.files[0];
    if (!f) return;
    try {
      const r = await repositorio.analizarImportacion(await f.text());
      zona.appendChild(h('div', { class: 'msg' }, [
        h('div', { text: 'El archivo «' + f.name + '» tiene datos de ' + r.alcance + ' (' + r.organizaciones.join(', ') + '):' }),
        h('ul', { class: 'resumen-importar' }, r.filas.map(x => h('li', { text: x[1] + ' ' + (ROTULO_COLECCION[x[0]] || x[0]) }))),
        ...r.advertencias.map(a => h('div', { class: 'msg mal', text: a })),
        h('div', { text: 'Importar reemplaza TODO lo que hay ahora en este navegador. Si querés conservarlo, exportalo antes.', style: 'font-weight:700' }),
        h('div', { class: 'herr', style: 'margin:8px 0 0' }, [
          h('button', { type: 'button', class: 'primario', text: 'Sí, reemplazar los datos', onclick: async () => {
            try {
              await repositorio.aplicarImportacion();
              await terminarCambioDeDatos('Datos importados');
            } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo importar.'); }
          } }),
          h('button', { type: 'button', text: 'Cancelar', onclick: () => { repositorio.cancelarImportacion(); zona.textContent = ''; archivo.value = ''; } })])]));
    } catch (e) {
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
            await terminarCambioDeDatos('Datos de ejemplo restablecidos (' + r.totalMs + ' ms)');
          } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo restablecer.'); }
        } }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { zona.textContent = ''; } })])]));
  } });

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
  contenedor.appendChild(h('div', { class: 'bloque', style: 'margin:10px 0' }, [
    h('p', { style: 'margin-top:0', text: 'Este prototipo guarda todo lo que cargues solo en este navegador (en la base IndexedDB de esta computadora y este usuario de Windows), sin cifrar y sin enviarlo a ningún lado. Cualquiera que use este navegador en esta computadora puede leerlo.' }),
    h('p', { text: 'Por eso: podés cargar la estructura real (equipos, puertos, VLAN), pero no cargues contraseñas reales. Con los datos de ejemplo podés probar todo sin riesgo.' }),
    h('p', { class: 'tiempo-carga', style: 'margin-bottom:0', text: tiempos })]));
  contenedor.appendChild(h('div', { class: 'fila', style: 'align-items:stretch;flex-wrap:wrap' }, [
    bloque('Exportar', 'Descarga un archivo con los datos de todas las organizaciones (incluidas las contraseñas de ejemplo, porque el superadmin las ve). Sirve para guardarlos o llevarlos a otro navegador.',
      [bExp], puedeExportar, 'Solo el superadmin puede exportar los datos.'),
    bloque('Importar', 'Reemplaza todos los datos de este navegador por los de un archivo exportado antes. Antes de reemplazar te muestra qué trae.', [archivo], puedeImportar, 'Solo el superadmin puede importar.'),
    bloque('Restablecer', 'Borra lo que cargaste y vuelve a los datos de ejemplo.', [bRes], puedeRestablecer, 'Solo el superadmin puede restablecer los datos de ejemplo.')]));
  contenedor.appendChild(zona);
}
