// @ts-check
/**
 * P25 · Ficha de licencia (`#/licencia/<id|nueva>[/<pestaña>]`): datos con edición en el lugar (D-037), «Confirmar vigente», baja,
 * pestañas Instalaciones (agregar y quitar con fecha) e Historial. La clave es una credencial vinculada (D-066): la ficha nunca la muestra,
 * solo enlaza a `#/credencial/<id>`, donde «Mostrar» y «Pedir acceso» dejan registro. Al crear o completar una licencia con clave,
 * la credencial se crea con `repositorio.guardar('credenciales', …)`, igual que la ficha de credencial.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast, abrirModal, cerrarModal, repintarMarco } from '../assets/js/marco.js';
import { h, tabla, fmtFecha, fmtFechaHora, hoyISO } from '../assets/js/utiles.js';
import { ROTULO_LICENCIA_TIPO, ROTULO_EQUIPO_TIPO } from '../assets/js/modelos.js';
import { selectorConCrear } from '../assets/js/altas.js';
import { altaDesdeRuta, duplicar, nombreDeCopia } from '../assets/js/altas/comunes.js';
import { abrirAlta } from '../assets/js/altas.js';
import { sinPermiso, enlaceEquipo, pestanas, campo, fichaCab, botonBaja, valorHistorial } from '../assets/js/credenciales.js';
import { barraUso, textoVencimientoLicencia } from './licencias.view.js';

/** @type {Object<string, string>} */
const ROTULO_CAMPO = { licencia_producto: 'Producto', licencia_tipo: 'Tipo', licencia_cantidad: 'Cantidad comprada', licencia_vence_en: 'Vence el', licencia_proveedor: 'Proveedor',
  credencial_id: 'Clave (credencial vinculada)', instalacion_hasta: 'Retirada el', instalacion_desde: 'Instalada desde', equipo_id: 'Equipo', cuenta_id: 'Cuenta', persona_id: 'Persona' };

/** @param {HTMLElement} contenedor */
export async function renderVista(contenedor) {
  await sesion.refrescar();
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const idHash = decodeURIComponent(partes[1] || '');
  const nuevo = idHash === 'nueva' || idHash === 'nuevo';
  let tab = ['instalaciones', 'relaciones', 'archivos', 'historial'].includes(partes[2]) ? partes[2] : 'instalaciones';
  const migas = await migasRaiz();
  migas.push(['Licencias', '#/licencias']);
  if (nuevo) { await altaDesdeRuta('licencias', '#/licencias', r => '#/licencia/' + r.id, 'Licencia creada'); return; }

  /** @type {any} */
  let l = null;
  let orgId = /** @type {string} */ (sesion.organizacionActiva());
  {
    l = await repositorio.obtener('licencias', idHash);
    if (!l) {
      pantalla(contenedor, { codigo: 'P25', nombre: 'Ficha de licencia', migas: migas.concat([['No encontrada']]) });
      contenedor.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Esa licencia no existe o fue dada de baja.' }), h('div', { style: 'margin-top:8px' }, [h('a', { href: '#/licencias', text: 'Volver al listado de licencias' })])]));
      return;
    }
    orgId = l.organizacion_id;
  }
  if (!puede(u, 'ver', 'licencias', orgId)) {
    pantalla(contenedor, { codigo: 'P25', nombre: 'Ficha de licencia', migas: migas.concat([['Ficha']]) });
    sinPermiso(contenedor, u, 'Licencias');
    return;
  }

  const modifica = puede(u, 'modificar', 'licencias', orgId);
  const verPersonas = puede(u, 'ver', 'personas', orgId);
  const verCredenciales = puede(u, 'ver', 'credenciales', orgId);
  const creaClaves = puede(u, 'modificar', 'credenciales', orgId);
  let editando = partes[2] === 'editar';
  if (editando && !modifica) editando = false;
  let error = '';
  /** @type {any} */
  let ed = null;
  const iniciarEd = () => {
    ed = { producto: l.licencia_producto, tipo: l.licencia_tipo, cantidad: String(l.licencia_cantidad), vence: l.licencia_vence_en || '', proveedor: l.licencia_proveedor || '', credencial: l.credencial_id || '' };
  };
  if (editando) iniciarEd();

  const rerender = async () => { if (l) l = (await repositorio.obtener('licencias', l.id)) || l; await pintar(); };

  async function pintar() {
    contenedor.textContent = '';
    const [umbrales, usuarios, equipos, personas, cuentas] = await Promise.all([
      repositorio.umbralesVerificacion(), repositorio.listar('usuarios', null, { incluirBajas: true }),
      repositorio.listar('equipos', { organizacion_id: orgId }, { ordenarPor: 'equipo_nombre' }),
      verPersonas ? repositorio.listar('personas', { organizacion_id: orgId }, { ordenarPor: 'persona_nombre' }) : Promise.resolve([]),
      verPersonas ? repositorio.listar('cuentas_dominio', { organizacion_id: orgId }, { ordenarPor: 'cuenta_usuario' }) : Promise.resolve([])]);
    const nombreUsuario = new Map(usuarios.map(x => [x.id, x.usuario_nombre]));
    const equipoPorId = new Map(equipos.map(e => [e.id, e]));
    const personaPorId = new Map(personas.map(p => [p.id, p]));
    const cuentaPorId = new Map(cuentas.map(c => [c.id, c]));
    const titulo = l.licencia_producto;
    pantalla(contenedor, { codigo: 'P25', nombre: 'Ficha de licencia', migas: migas.concat([[titulo, tab !== 'instalaciones' ? '#/licencia/' + l.id : undefined]]).concat(tab === 'historial' ? [['Historial']] : []) });

    // ---- datos
    const datos = h('div', { class: 'datos' });
    if (editando) {
      const inp = (/** @type {string} */ k, /** @type {string} */ et, /** @type {string} */ tipo, /** @type {Object<string, string>} */ extra) => {
        const i = /** @type {HTMLInputElement} */ (h('input', { type: tipo || 'text', value: ed[k], 'aria-label': et, ...(extra || {}) }));
        i.addEventListener('input', () => { ed[k] = i.value; });
        return i;
      };
      const selTipo = /** @type {HTMLSelectElement} */ (h('select', { 'aria-label': 'Tipo' }, Object.keys(ROTULO_LICENCIA_TIPO).map(k => h('option', { value: k, text: ROTULO_LICENCIA_TIPO[k], selected: k === ed.tipo ? 'selected' : null }))));
      selTipo.addEventListener('change', () => { ed.tipo = selTipo.value; if (ed.tipo === 'perpetua') ed.vence = ''; pintar(); });
      datos.appendChild(campo('Producto y edición', inp('producto', 'Producto y edición', 'text', { maxlength: '120' })));
      datos.appendChild(campo('Tipo', selTipo));
      datos.appendChild(campo('Cantidad comprada', inp('cantidad', 'Cantidad comprada', 'number', { min: '1', step: '1' })));
      datos.appendChild(campo('Vence el', ed.tipo === 'perpetua' ? h('span', { class: 'mut', text: 'Una licencia perpetua no vence' }) : inp('vence', 'Vence el', 'date')));
      datos.appendChild(campo('Proveedor', inp('proveedor', 'Proveedor')));
      if (creaClaves) {
        const valoresClave = /** @type {Object<string, any>} */ ({ credencial_tipo: 'clave_licencia', credencial_nombre: 'Clave: ' + ed.producto.trim() });
        const selClave = selectorConCrear({ desde: 'licencias', campo: 'credencial_id', organizacion_id: orgId, valor: ed.credencial || null, etiqueta: 'Clave de la licencia (credencial)',
          valoresAlta: valoresClave, rotuloOrigen: 'Editar licencia', alCambiar: v => { ed.credencial = v; } });
        datos.appendChild(campo('Clave de la licencia (credencial)', h('div', null, [selClave, h('div', { class: 'mut', style: 'font-size:12.5px;margin-top:2px', text: 'La clave se guarda como una credencial de tipo «Clave de licencia»: queda oculta y se pide con registro.' })])));
      } else datos.appendChild(campo('Clave de la licencia', 'Tu rol no puede crear credenciales; pedile a quien administre las credenciales que la cargue y la vincule.'));
      if (error) datos.appendChild(h('div', { class: 'msg mal', role: 'alert', style: 'grid-column:1/-1', text: error }));
    } else {
      const uso = await repositorio.licenciasEnUso(l.id);
      datos.appendChild(campo('Tipo', ROTULO_LICENCIA_TIPO[l.licencia_tipo] || l.licencia_tipo));
      datos.appendChild(campo('Cantidad comprada', String(l.licencia_cantidad)));
      datos.appendChild(campo('En uso', h('div', null, [barraUso(uso), uso.excedida ? h('div', { class: 'mut', style: 'font-size:12.5px', text: 'Hay más instalaciones vigentes que licencias compradas: hay que comprar más o retirar instalaciones.' }) : null])));
      datos.appendChild(campo('Vence el', textoVencimientoLicencia(l)));
      datos.appendChild(campo('Proveedor', l.licencia_proveedor || '—'));
      datos.appendChild(campo('Clave de la licencia', await nodoClave(l)));
    }

    const guardar = async () => {
      const cant = Number(ed.cantidad);
      if (!ed.producto.trim()) { error = 'Escribí el producto y la edición.'; await pintar(); return; }
      if (!Number.isInteger(cant) || cant < 1) { error = 'La cantidad comprada tiene que ser un número entero de 1 o más.'; await pintar(); return; }
      try {
        const credId = creaClaves ? ed.credencial || null : l.credencial_id || null;
        const vence = ed.tipo === 'perpetua' ? null : ed.vence || null;
        await repositorio.guardar('licencias', { ...l, licencia_producto: ed.producto.trim(), licencia_tipo: ed.tipo, licencia_cantidad: cant, licencia_vence_en: vence,
          licencia_proveedor: ed.proveedor.trim() || null, credencial_id: credId }, u.id);
        toast('Cambios guardados · verificada hoy (' + hoyISO().split('-').reverse().join('/') + ')');
        ed = null; error = '';
        editando = false; await rerender();
      } catch (e) { error = e instanceof Error ? e.message : 'No se pudo guardar.'; await pintar(); }
    };
    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }),
        h('button', { type: 'button', text: 'Cancelar', onclick: () => { ed = null; error = ''; editando = false; pintar(); } })]
      : [modifica ? h('button', { type: 'button', text: 'Editar', onclick: () => { iniciarEd(); error = ''; editando = true; pintar(); } }) : null,
        modifica ? h('button', { type: 'button', text: 'Duplicar', title: 'Abre el alta con estos datos (sin la clave) para cargar una parecida', onclick: async () => {
          const otras = await repositorio.listar('licencias', { organizacion_id: orgId });
          await duplicar('licencias', l, { licencia_producto: nombreDeCopia(l.licencia_producto, otras.map(x => x.licencia_producto)), licencia_tipo: l.licencia_tipo, licencia_cantidad: l.licencia_cantidad,
            licencia_vence_en: l.licencia_vence_en, licencia_proveedor: l.licencia_proveedor }, r => '#/licencia/' + r.id, 'Licencia');
        } }) : null,
        await botonBaja({ u, coleccion: 'licencias', registro: l, modulo: 'licencias', orgId, nombre: l.licencia_producto, volver: '#/licencias', rerender })];
    contenedor.appendChild(fichaCab({ tipo: 'licencia', etiqueta: 'licencia', titulo, datos, botones, modoEdicion: editando, registro: l,
      coleccion: 'licencias', modulo: 'licencias', u, orgId, umbrales, usuarios: nombreUsuario, rerender }));

    // ---- pestañas
    /** @type {Array<[string, string]>} */
    const tabs = [['instalaciones', 'Instalaciones'], ['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']];
    const verHist = puede(u, 'ver_historial', 'licencias', orgId);
    if (verHist) tabs.push(['historial', 'Historial']);
    if (tab === 'historial' && !verHist) tab = 'instalaciones';
    contenedor.appendChild(pestanas(tabs, tab, k => { tab = k; history.replaceState(null, '', '#/licencia/' + l.id + (k === 'instalaciones' ? '' : '/' + k)); pintar(); }));
    const cuerpo = h('div');
    contenedor.appendChild(cuerpo);
    if (tab === 'instalaciones') await pestanaInstalaciones(cuerpo, equipos, equipoPorId, personas, cuentas, personaPorId, cuentaPorId);
    else if (tab === 'relaciones' || tab === 'archivos') {
      const zona = h('div'); cuerpo.appendChild(zona);
      if (tab === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(zona, { entidad: 'Licencia', entidadId: l.id, organizacionId: orgId });
      else await (await import('../assets/js/archivos.js')).pintarArchivos(zona, { entidad: 'Licencia', entidadId: l.id, organizacionId: orgId });
    }
    else await pestanaHistorial(cuerpo, nombreUsuario, equipoPorId);
  }

  /** Enlace a la credencial de la clave; nunca el valor. @param {any} lic */
  async function nodoClave(lic) {
    if (!lic.credencial_id) return h('span', { text: lic.licencia_tipo === 'oem' ? 'Sin clave: licencia OEM atada al equipo.' : 'Sin clave cargada.' });
    const c = await repositorio.obtener('credenciales', lic.credencial_id);
    if (!c) return h('span', { text: 'La credencial de la clave fue dada de baja.' });
    if (!verCredenciales) return h('span', { text: 'Guardada en una credencial (tu rol no ve el módulo Credenciales).' });
    return h('div', null, [h('a', { href: '#/credencial/' + c.id, text: c.credencial_nombre }),
      h('div', { class: 'mut', style: 'font-size:12.5px', text: 'Ahí se muestra o se pide acceso; cada vez queda registrado.' })]);
  }

  /**
   * @param {HTMLElement} cuerpo @param {any[]} equipos @param {Map<string, any>} equipoPorId @param {any[]} personas @param {any[]} cuentas
   * @param {Map<string, any>} personaPorId @param {Map<string, any>} cuentaPorId
   */
  async function pestanaInstalaciones(cuerpo, equipos, equipoPorId, personas, cuentas, personaPorId, cuentaPorId) {
    const instalaciones = await repositorio.instalacionesDeLicencia(l.id);
    instalaciones.sort((a, b) => (a.instalacion_hasta ? 1 : 0) - (b.instalacion_hasta ? 1 : 0));
    const vigentes = instalaciones.filter(i => !i.instalacion_hasta);
    const uso = await repositorio.licenciasEnUso(l.id);

    cuerpo.appendChild(h('div', { class: 'herr' }, [
      h('span', { class: 'mut', style: 'flex:1', text: vigentes.length + ' instalación(es) vigente(s)' + (instalaciones.length > vigentes.length ? ' y ' + (instalaciones.length - vigentes.length) + ' retirada(s)' : '') + '.' }),
      modifica ? h('button', { type: 'button', class: 'primario', text: 'Agregar instalación', onclick: async () => {
        const creada = await abrirAlta('instalaciones_licencia', { organizacion_id: orgId, valores: { licencia_id: l.id } });
        if (!creada) return;
        const e = equipoPorId.get(creada.equipo_id);
        toast('Instalación agregada en ' + (e ? e.equipo_nombre : 'el equipo') + (uso.usadas + 1 > uso.cantidad ? ' · la licencia quedó excedida' : ''));
        await repintarMarco(); await pintar();
      } }) : null]));

    if (!instalaciones.length) {
      cuerpo.appendChild(h('div', { class: 'aviso' }, [h('div', { text: 'Esta licencia todavía no está instalada en ningún equipo.' }),
        modifica ? h('div', { class: 'mut', style: 'margin-top:6px', text: 'Usá «Agregar instalación» para anotar dónde se usa.' }) : null]));
      return;
    }
    /** @param {any} i */
    const quien = i => {
      if (!i.cuenta_id && !i.persona_id) return '—';
      if (!verPersonas) return 'Reservado al módulo Personas';
      const c = i.cuenta_id ? cuentaPorId.get(i.cuenta_id) : null, p = i.persona_id ? personaPorId.get(i.persona_id) : null;
      const partes = [];
      if (c) partes.push(h('a', { href: '#/cuenta/' + c.id, text: c.cuenta_dominio + '\\' + c.cuenta_usuario, onclick: (/** @type {Event} */ e) => e.stopPropagation() }));
      if (p) partes.push(h('a', { href: '#/persona/' + p.id, text: p.persona_nombre, onclick: (/** @type {Event} */ e) => e.stopPropagation() }));
      return h('span', null, partes.flatMap((x, k) => (k ? [' · ', x] : [x])));
    };
    cuerpo.appendChild(tabla(['Equipo', 'Persona o cuenta', 'Desde', 'Hasta', ''], instalaciones.map(i => [
      enlaceEquipo(u, orgId, equipoPorId.get(i.equipo_id) || null), quien(i), fmtFecha(i.instalacion_desde), i.instalacion_hasta ? fmtFecha(i.instalacion_hasta) : 'Vigente',
      modifica && !i.instalacion_hasta ? h('button', { type: 'button', class: 'chico', text: 'Quitar', onclick: () => abrirQuitar(i, equipoPorId.get(i.equipo_id)) }) : ''])));
    cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: '«Quitar» no borra la instalación: la cierra con una fecha y queda en el historial.' }));
  }

  /** @param {any} i @param {any} eq */
  function abrirQuitar(i, eq) {
    const hasta = /** @type {HTMLInputElement} */ (h('input', { type: 'date', 'aria-label': 'Retirada el', value: hoyISO(), min: i.instalacion_desde }));
    const msg = h('div', { class: 'msg mal', role: 'alert', hidden: 'hidden' });
    abrirModal(h('div', { role: 'dialog', 'aria-label': 'Quitar instalación' }, [
      h('h2', { text: '¿Quitar la licencia de «' + (eq ? eq.equipo_nombre : 'este equipo') + '»?' }),
      h('p', { class: 'mut', text: 'Se cierra la instalación con la fecha que indiques; deja de contar como «en uso».' }),
      campo('Retirada el', hasta), msg,
      h('div', { class: 'herr' }, [
        h('button', { type: 'button', class: 'primario', text: 'Quitar', onclick: async () => {
          if (!hasta.value || hasta.value < i.instalacion_desde) { msg.textContent = 'La fecha no puede ser anterior a la instalación (' + fmtFecha(i.instalacion_desde) + ').'; msg.hidden = false; return; }
          try {
            await repositorio.guardar('instalaciones_licencia', { ...i, instalacion_hasta: hasta.value }, u.id);
            cerrarModal(); toast('Instalación cerrada el ' + fmtFecha(hasta.value)); await repintarMarco(); await pintar();
          } catch (e) { msg.textContent = e instanceof Error ? e.message : 'No se pudo quitar.'; msg.hidden = false; }
        } }),
        h('button', { type: 'button', text: 'Cancelar', onclick: cerrarModal })])]));
  }

  /** @param {HTMLElement} cuerpo @param {Map<string, string>} nombreUsuario @param {Map<string, any>} equipoPorId */
  async function pestanaHistorial(cuerpo, nombreUsuario, equipoPorId) {
    const todas = await repositorio.listar('instalaciones_licencia', i => i.licencia_id === l.id, { incluirBajas: true });
    const deInst = new Map(todas.map(i => [i.id, i]));
    const cambios = await repositorio.listar('cambios', x => (x.cambio_entidad === 'Licencia' && x.entidad_id === l.id) || (x.cambio_entidad === 'InstalacionLicencia' && deInst.has(x.entidad_id)),
      { ordenarPor: 'cambio_fecha', descendente: true });
    if (!cambios.length) { cuerpo.appendChild(h('div', { class: 'mut', text: 'Todavía no hay cambios registrados.' })); return; }
    /** @param {any} x */
    const nombreEq = x => { const i = deInst.get(x.entidad_id); const e = i ? equipoPorId.get(i.equipo_id) : null; return e ? e.equipo_nombre : 'un equipo'; };
    /** @param {string|null} json @param {string|null} campoK */
    const val = (json, campoK) => {
      if (campoK === 'credencial_id') return json === null || json === 'null' ? '—' : 'Credencial vinculada';
      if (campoK === 'licencia_tipo' && json) { try { return ROTULO_LICENCIA_TIPO[JSON.parse(json)] || json; } catch { return json; } }
      return valorHistorial(json, campoK, false, new Map());
    };
    cuerpo.appendChild(tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(x => {
      const quien = nombreUsuario.get(x.usuario_id) || '?';
      const inst = x.cambio_entidad === 'InstalacionLicencia';
      const op = x.cambio_operacion;
      if (op !== 'modificacion') return [fmtFechaHora(x.cambio_fecha), quien, (inst ? 'Instalación en ' + nombreEq(x) + ': ' : '') + (op === 'alta' ? 'Alta' : op === 'baja' ? 'Baja' : 'Restauración'), '—', op === 'alta' ? 'Creada' : '—'];
      return [fmtFechaHora(x.cambio_fecha), quien, (inst ? 'Instalación en ' + nombreEq(x) + ': ' : '') + (ROTULO_CAMPO[x.cambio_campo] || String(x.cambio_campo).replace(/^[a-z]+_/, '').replace(/_/g, ' ')),
        val(x.cambio_valor_anterior, x.cambio_campo), val(x.cambio_valor_nuevo, x.cambio_campo)];
    })));
    cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Incluye las instalaciones agregadas y retiradas. El valor de la clave no está en este historial: vive en la credencial.' }));
  }

  await pintar();
}
