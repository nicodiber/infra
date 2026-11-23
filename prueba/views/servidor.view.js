// @ts-check
/**
 * P06 · Ficha de servidor (`#/servidor/<id>[/<pestaña>]`): campos fijos del tipo `servidor`, mini rack (MJ27),
 * verificación y «Confirmar vigente», edición en el lugar (D-037) y pestañas Red, Credenciales vinculadas,
 * Máquinas virtuales (si es host) o Host (si es una VM), Notas (documentación libre, por ejemplo del controlador de dominio) e Historial.
 */

import * as repositorio from '../assets/js/repositorio.js';
import * as sesion from '../assets/js/sesion.js';
import { puede } from '../assets/js/permisos.js';
import { ir, pantalla, migasRaiz, toast } from '../assets/js/marco.js';
import { h, tabla, fmtFechaHora, indicadorVerificacion, icono } from '../assets/js/utiles.js';
import { ROTULO_CREDENCIAL_TIPO } from '../assets/js/modelos.js';
import { pintarNotas } from '../assets/js/notas.js';
import { cargarVinculos, contarVinculos, pintarVinculos } from '../assets/js/vinculos.js';
import { confirmarConPasos } from '../assets/js/verificacion.js';
import {
  bloqueSinPermiso, estadoVacio, estadoPill, botonBaja, miniRack, fichaBloque, pieVerificacion, nombresDeUsuarios, partesHash, rangoU, rutaEquipo,
  CAMPOS_SERVIDOR, valorCampo, textoCampo, crearCampo, validarServidor, aplicarServidor, validarLugarEnRack, porId, rutaUbicacion
} from '../assets/js/racks.js';

/** @type {Object<string, string>} */
const ETIQUETAS = { equipo_nombre: 'Nombre', equipo_marca: 'Marca', equipo_modelo: 'Modelo', equipo_numero_serie: 'Número de serie', equipo_mac: 'MAC', equipo_ip_gestion: 'IP de gestión',
  equipo_estado: 'Estado', equipo_notas: 'Notas', rack_id: 'Rack', rack_u_inicio: 'U de inicio', rack_u_alto: 'Alto en U', ubicacion_id: 'Ubicación', puesto_id: 'Puesto' };

/**
 * @param {HTMLElement} contenedor
 */
export async function renderVista(contenedor) {
  const u = /** @type {import('../assets/js/modelos.js').UsuarioSesion} */ (sesion.usuarioActual());
  const { segs } = partesHash();
  const id = segs[1] || '';
  const tabPedida = segs[2] || 'vinculos';
  const raiz = await migasRaiz();
  const eq0 = id ? await repositorio.obtener('equipos', id) : null;
  if (!eq0 || eq0.equipo_tipo !== 'servidor') {
    pantalla(contenedor, { codigo: 'P06', nombre: 'Ficha de servidor', migas: raiz.concat([['Servidores', '#/servidores'], ['No encontrado']]) });
    contenedor.appendChild(estadoVacio('No encontramos ese servidor', 'Puede que se haya dado de baja o que el enlace sea viejo. Volvé al listado y buscalo de nuevo.', 'servidor',
      [h('a', { href: '#/servidores', text: 'Ir a Servidores' })]));
    return;
  }
  const org = eq0.organizacion_id;
  if (!puede(u, 'ver', 'servidores', org)) {
    pantalla(contenedor, { codigo: 'P06', nombre: 'Ficha de servidor', migas: raiz.concat([['Servidores']]) });
    contenedor.appendChild(bloqueSinPermiso('Tu rol no tiene acceso al módulo Servidores.'));
    return;
  }
  let editando = false;
  /** @type {string|null} */
  let errorForm = null;

  const pintar = async () => {
    contenedor.textContent = '';
    const eq = await repositorio.obtener('equipos', id);
    if (!eq) { ir('#/servidores'); return; }
    const c = eq.equipo_campos || {};
    const esVM = !!c.host_id;
    const [umbrales, nombres, racks, ubicaciones, todosServidores, cantNotas, vinc] = await Promise.all([
      repositorio.umbralesVerificacion(), nombresDeUsuarios(),
      repositorio.listar('racks', { organizacion_id: org }, { ordenarPor: 'rack_nombre' }),
      repositorio.listar('ubicaciones', { organizacion_id: org }),
      repositorio.listar('equipos', e => e.organizacion_id === org && e.equipo_tipo === 'servidor', { ordenarPor: 'equipo_nombre' }),
      repositorio.contar('notas', n => n.entidad === 'Equipo' && n.entidad_id === id), cargarVinculos(id)]);
    const host = esVM ? todosServidores.find(s => s.id === c.host_id) || null : null;
    const vms = todosServidores.filter(s => s.equipo_campos && s.equipo_campos.host_id === id);
    const rack = eq.rack_id ? racks.find(r => r.id === eq.rack_id) || null : null;
    const ubic = porId(ubicaciones);
    const puedeModificar = puede(u, 'modificar', 'servidores', org);
    const puedeVerificar = puede(u, 'verificar', 'servidores', org);

    // ---- pestañas disponibles
    /** @type {Array<[string, string]>} */
    const tabs = [['vinculos', 'Vínculos (' + contarVinculos(vinc) + ')'], ['red', 'Red'], ['credenciales', 'Credenciales vinculadas']];
    if (esVM) tabs.push(['host', 'Host']);
    else if (vms.length || c.servidor_virtualizacion !== 'ninguna') tabs.push(['vms', 'Máquinas virtuales (' + vms.length + ')']);
    tabs.push(['notas', 'Notas (' + cantNotas + ')'], ['relaciones', 'Relacionado con'], ['archivos', 'Fotos y archivos']);
    if (puede(u, 'ver_historial', 'servidores', org)) tabs.push(['historial', 'Historial']);
    const tab = tabs.some(t => t[0] === tabPedida) ? tabPedida : 'vinculos';

    // ---- datos (lectura o edición)
    const datos = h('div', { class: 'datos' });
    /** @type {Object<string, {leer: () => string}>} */
    const entradas = {};
    const camposVisibles = CAMPOS_SERVIDOR.filter(f => !(f.soloFisico && esVM));
    for (const f of camposVisibles) {
      if (editando) { const ent = crearCampo(f, valorCampo(eq, f), 'ficha'); entradas[f.k] = ent; datos.appendChild(ent.caja); }
      else datos.appendChild(h('div', { class: 'campo' }, [h('label', { text: f.etq }), h('div', { text: textoCampo(eq, f) })]));
    }
    // ubicación en rack (solo servidores físicos)
    /** @type {HTMLSelectElement|null} */ let selRack = null;
    /** @type {HTMLInputElement|null} */ let inUIni = null;
    /** @type {HTMLInputElement|null} */ let inUAlto = null;
    if (esVM) {
      datos.appendChild(h('div', { class: 'campo' }, [h('label', { text: 'Corre en el host' }), h('div', null, [host ? h('a', { href: rutaEquipo(host), text: host.equipo_nombre }) : '—'])]));
    } else if (editando) {
      selRack = /** @type {HTMLSelectElement} */ (h('select', { id: 'ficha-rack' }, [h('option', { value: '', text: 'Sin rack' })].concat(racks.map(r => h('option', { value: r.id, text: r.rack_nombre, selected: r.id === eq.rack_id ? 'selected' : null })))));
      inUIni = /** @type {HTMLInputElement} */ (h('input', { id: 'ficha-uini', type: 'number', min: '1' })); inUIni.value = eq.rack_u_inicio == null ? '' : String(eq.rack_u_inicio);
      inUAlto = /** @type {HTMLInputElement} */ (h('input', { id: 'ficha-ualto', type: 'number', min: '1' })); inUAlto.value = eq.rack_u_alto == null ? '' : String(eq.rack_u_alto);
      datos.appendChild(h('div', { class: 'campo' }, [h('label', { for: 'ficha-rack', text: 'Rack' }), selRack]));
      datos.appendChild(h('div', { class: 'campo' }, [h('label', { for: 'ficha-uini', text: 'U de inicio (1 = abajo)' }), inUIni]));
      datos.appendChild(h('div', { class: 'campo' }, [h('label', { for: 'ficha-ualto', text: 'Alto en U' }), inUAlto]));
    } else {
      datos.appendChild(h('div', { class: 'campo' }, [h('label', { text: 'Rack / unidad' }), h('div', null, [rack ? h('a', { href: '#/rack/' + rack.id + '?resaltar=' + eq.id, text: rack.rack_nombre + ' · ' + rangoU(eq) }) : '—'])]));
      datos.appendChild(h('div', { class: 'campo' }, [h('label', { text: 'Ubicación' }), h('div', { text: eq.ubicacion_id ? rutaUbicacion(eq.ubicacion_id, ubic) || '—' : '—' })]));
    }
    /** @type {HTMLTextAreaElement|null} */ let notas = null;
    if (editando) {
      notas = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'ficha-notas', rows: '2', style: 'width:100%' })); notas.value = eq.equipo_notas || '';
      datos.appendChild(h('div', { class: 'campo', style: 'grid-column:1/-1' }, [h('label', { for: 'ficha-notas', text: 'Notas (sin contraseñas)' }), notas]));
    } else if (eq.equipo_notas) datos.appendChild(h('div', { class: 'campo', style: 'grid-column:1/-1' }, [h('label', { text: 'Notas' }), h('div', { text: eq.equipo_notas })]));

    const errorCaja = h('div', { class: 'msg mal', role: 'alert', text: errorForm || '', hidden: errorForm ? null : 'hidden' });

    const guardar = async () => {
      /** @type {Object<string, string>} */
      const vals = {};
      for (const k of Object.keys(entradas)) vals[k] = entradas[k].leer();
      /** @param {string} m */
      const falla = m => { errorCaja.textContent = m; errorCaja.hidden = false; errorForm = m; };
      let problema = await validarServidor(vals, { orgId: org, idActual: eq.id, esVM });
      if (problema) return falla(problema);
      const nuevo = aplicarServidor(eq, vals, esVM);
      nuevo.equipo_notas = notas && notas.value.trim() ? notas.value.trim() : null;
      if (!esVM && selRack && inUIni && inUAlto) {
        if (selRack.value) {
          const ini = parseInt(inUIni.value, 10), alto = parseInt(inUAlto.value, 10);
          problema = await validarLugarEnRack(selRack.value, ini, alto, eq.id);
          if (problema) return falla(problema);
          const r = racks.find(x => x.id === selRack.value);
          Object.assign(nuevo, { rack_id: selRack.value, rack_u_inicio: ini, rack_u_alto: alto, ubicacion_id: r ? r.ubicacion_id : nuevo.ubicacion_id });
        } else Object.assign(nuevo, { rack_id: null, rack_u_inicio: null, rack_u_alto: null });
      }
      try {
        await repositorio.guardar('equipos', nuevo, u.id);
        editando = false; errorForm = null;
        toast('Cambios guardados · verificado hoy');
        await pintar();
      } catch (e) { falla(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    };

    const botones = editando
      ? [h('button', { type: 'button', class: 'primario', text: 'Guardar', onclick: guardar }), h('button', { type: 'button', text: 'Cancelar', onclick: () => { editando = false; errorForm = null; pintar(); } })]
      : [h('button', { type: 'button', text: 'Etiqueta', title: 'Imprimir la etiqueta con QR', onclick: () => { location.hash = '#/etiqueta/equipos/' + eq.id; } }),
        puedeModificar ? h('button', { type: 'button', text: 'Editar', onclick: () => { editando = true; errorForm = null; pintar(); } }) : null,
        rack ? h('button', { type: 'button', text: 'Ver en rack', onclick: () => ir('#/rack/' + rack.id + '?resaltar=' + eq.id) }) : null];

    if (!editando) {
      const baja = await botonBaja({ u, org, modulo: 'servidores', coleccion: 'equipos', registro: eq, nombre: eq.equipo_nombre, alTerminar: () => ir(puede(u, 'baja', 'servidores', org) ? '#/servidores' : location.hash),
        bloqueo: vms.length ? 'Es el host de ' + vms.length + ' máquina(s) virtual(es) (' + vms.map(v => v.equipo_nombre).join(', ') + '). Primero dalas de baja o cambialas de host.' : null });
      if (baja) botones.push(baja);
    }
    const pie = pieVerificacion({ coleccion: 'equipos', registro: eq, umbrales, nombresUsuario: nombres, puedeVerificar: puedeVerificar && !editando,
      alConfirmar: async () => { if (!(await confirmarConPasos('equipos', eq.id, u))) return; toast('«' + eq.equipo_nombre + '» confirmado como vigente hoy'); await pintar(); },
      error: toast });

    pantalla(contenedor, { codigo: 'P06', nombre: 'Ficha de servidor', migas: raiz.concat([['Servidores', '#/servidores'], [eq.equipo_nombre, tab !== 'vinculos' ? '#/servidor/' + eq.id : undefined]]).concat(tab !== 'vinculos' ? [[(tabs.find(t => t[0] === tab) || ['', ''])[1].replace(/ \(\d+\)$/, '')]] : []) });
    contenedor.appendChild(fichaBloque({ tipo: 'servidor', etiqueta: esVM ? 'máquina virtual' : 'servidor', titulo: eq.equipo_nombre, datos: h('div', null, [datos, errorCaja]),
      botones: botones.concat([estadoPill(eq.equipo_estado)]), mini: rack && !editando ? miniRack(rack, eq) : null, modoEdicion: editando, pie }));

    // ---- pestañas
    contenedor.appendChild(h('div', { class: 'pestanas', role: 'tablist' }, tabs.map(t => h('button', { type: 'button', role: 'tab', class: t[0] === tab ? 'sel' : '', 'aria-selected': String(t[0] === tab),
      onclick: () => ir('#/servidor/' + eq.id + (t[0] === 'vinculos' ? '' : '/' + t[0])) }, [t[1]]))));
    const cuerpo = h('div');
    contenedor.appendChild(cuerpo);
    if (tab === 'vinculos') pintarVinculos(cuerpo, eq, vinc);
    else if (tab === 'red') await pestanaRed(cuerpo, eq, host, org);
    else if (tab === 'credenciales') await pestanaCredenciales(cuerpo, eq, u, org);
    else if (tab === 'vms') pestanaVMs(cuerpo, eq, vms, umbrales);
    else if (tab === 'host') pestanaHost(cuerpo, host);
    else if (tab === 'notas') await pintarNotas(cuerpo, { entidad: 'Equipo', entidadId: eq.id, organizacionId: org });
    else if (tab === 'relaciones') await (await import('../assets/js/relaciones.js')).pintarRelaciones(cuerpo, { entidad: 'Equipo', entidadId: eq.id, organizacionId: org });
    else if (tab === 'archivos') await (await import('../assets/js/archivos.js')).pintarArchivos(cuerpo, { entidad: 'Equipo', entidadId: eq.id, organizacionId: org });
    else await pestanaHistorial(cuerpo, eq, nombres);
  };
  await pintar();
}

// ---------------------------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------------------------

/**
 * @param {HTMLElement} cuerpo @param {any} eq @param {any|null} host @param {string} org
 */
async function pestanaRed(cuerpo, eq, host, org) {
  const c = eq.equipo_campos || {};
  const resumen = h('div', { class: 'datos', style: 'margin-bottom:10px' }, [
    h('div', { class: 'campo' }, [h('label', { text: 'IP de gestión' }), h('div', { text: eq.equipo_ip_gestion || '—' })]),
    h('div', { class: 'campo' }, [h('label', { text: 'MAC' }), h('div', { text: eq.equipo_mac || '—' })]),
    host ? h('div', { class: 'campo' }, [h('label', { text: 'Sale a la red por el host' }), h('div', null, [h('a', { href: rutaEquipo(host), text: host.equipo_nombre })])])
      : h('div', { class: 'campo' }, [h('label', { text: 'IP de iLO / iDRAC' }), h('div', { text: c.servidor_ip_ilo_idrac || '—' })])]);
  cuerpo.appendChild(resumen);
  const puertos = await repositorio.listar('puertos', { equipo_id: eq.id }, { ordenarPor: 'puerto_numero' });
  if (!puertos.length) {
    cuerpo.appendChild(h('div', { class: 'aviso', text: host ? 'Una máquina virtual no tiene puertos físicos: usa la red de su host.' : 'Este servidor no tiene puertos documentados todavía. Cuando cargues sus NIC y a qué puerto de switch van, aparecen acá.' }));
    return;
  }
  const filas = [];
  const vlans = new Map((await repositorio.listar('vlans', { organizacion_id: org })).map(v => [v.id, v]));
  for (const p of puertos) {
    /** @type {Node|string} */
    let va = '—';
    if (p.conectado_a_puerto_id) {
      const otro = await repositorio.obtener('puertos', p.conectado_a_puerto_id);
      const sw = otro ? await repositorio.obtener('equipos', otro.equipo_id) : null;
      if (otro && sw) va = h('a', { href: '#/equipo/' + sw.id + '/puertos/' + otro.puerto_numero, text: sw.equipo_nombre + ' · puerto ' + otro.puerto_numero });
    } else if (p.conectado_a_descripcion) va = p.conectado_a_descripcion;
    const v = p.vlan_nativa_id ? vlans.get(p.vlan_nativa_id) : null;
    filas.push([p.puerto_nombre || 'Puerto ' + p.puerto_numero, p.puerto_tipo === 'rj45' ? 'RJ45' : p.puerto_tipo === 'sfp_plus' ? 'SFP+' : 'SFP', p.puerto_velocidad || '—', v ? v.vlan_numero + ' · ' + v.vlan_nombre : '—', p.puerto_estado, va]);
  }
  cuerpo.appendChild(tabla(['Puerto / NIC', 'Conector', 'Velocidad', 'VLAN nativa', 'Estado', 'Va a'], filas));
  cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Cada enlace abre el switch con ese puerto seleccionado.' }));
}

/**
 * @param {HTMLElement} cuerpo @param {any} eq @param {import('../assets/js/modelos.js').UsuarioSesion} u @param {string} org
 */
async function pestanaCredenciales(cuerpo, eq, u, org) {
  if (!puede(u, 'ver', 'credenciales', org)) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'Tu rol no ve el módulo Credenciales.' })); return; }
  const creds = await repositorio.listar('credenciales', c => c.equipo_id === eq.id, { ordenarPor: 'credencial_nombre' });
  if (!creds.length) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'Este servidor no tiene credenciales vinculadas (iLO / iDRAC, administrador, etc.). Se vinculan desde la ficha de la credencial.' })); return; }
  cuerpo.appendChild(tabla(['Nombre', 'Tipo', 'Usuario', 'Host o URL', 'Último cambio'],
    creds.map(c => [c.credencial_nombre, ROTULO_CREDENCIAL_TIPO[c.credencial_tipo] || c.credencial_tipo, c.credencial_usuario || '—', c.credencial_url_o_host || '—', fmtFechaHora(c.actualizado_en)]),
    { tipo: 'credencial', onFila: (_f, i) => ir('#/credencial/' + creds[i].id) }));
  cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'Nunca se muestran contraseñas acá: se piden desde la ficha de la credencial.' }));
}

/** @param {HTMLElement} cuerpo @param {any} eq @param {any[]} vms @param {import('../assets/js/utiles.js').Umbrales} umbrales */
function pestanaVMs(cuerpo, eq, vms, umbrales) {
  cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-bottom:6px', text: eq.equipo_nombre + ' es host' + (eq.equipo_campos.servidor_virtualizacion !== 'ninguna' ? ' (' + textoCampo(eq, /** @type {any} */ (CAMPOS_SERVIDOR.find(f => f.k === 'servidor_virtualizacion'))) + ')' : '') + '.' }));
  if (!vms.length) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'Todavía no hay máquinas virtuales documentadas en este host. Se agregan desde «Nuevo servidor» eligiendo «Máquina virtual».' })); return; }
  cuerpo.appendChild(tabla(['Máquina virtual', 'Rol', 'Sistema operativo', 'RAM', 'IP de gestión', 'Estado', 'Verificado'],
    vms.map(v => { const c = v.equipo_campos || {}; return [v.equipo_nombre, c.servidor_rol || '—', c.servidor_sistema_operativo || '—', c.servidor_ram_gb ? c.servidor_ram_gb + ' GB' : '—', v.equipo_ip_gestion || '—', estadoPill(v.equipo_estado), indicadorVerificacion(v.verificado_en, umbrales, true)]; }),
    { tipo: 'servidor', onFila: (_f, i) => ir('#/servidor/' + vms[i].id) }));
}

/** @param {HTMLElement} cuerpo @param {any|null} host */
function pestanaHost(cuerpo, host) {
  if (!host) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'El host de esta máquina virtual ya no está documentado (puede haberse dado de baja).' })); return; }
  const c = host.equipo_campos || {};
  cuerpo.appendChild(h('div', { class: 'bloque' }, [
    h('div', { class: 'eyebrow t-servidor' }, [icono('servidor'), 'host']),
    h('h2', null, [h('a', { href: rutaEquipo(host), text: host.equipo_nombre })]),
    h('div', { class: 'datos', style: 'margin-top:8px' }, [
      h('div', { class: 'campo' }, [h('label', { text: 'Modelo' }), h('div', { text: [host.equipo_marca, host.equipo_modelo].filter(Boolean).join(' ') || '—' })]),
      h('div', { class: 'campo' }, [h('label', { text: 'Rol' }), h('div', { text: c.servidor_rol || '—' })]),
      h('div', { class: 'campo' }, [h('label', { text: 'Sistema operativo' }), h('div', { text: c.servidor_sistema_operativo || '—' })]),
      h('div', { class: 'campo' }, [h('label', { text: 'IP de gestión' }), h('div', { text: host.equipo_ip_gestion || '—' })])]),
    h('div', { class: 'herr' }, [h('button', { type: 'button', text: 'Abrir ficha del host', onclick: () => ir(rutaEquipo(host)) })])]));
}

/** @param {HTMLElement} cuerpo @param {any} eq @param {Map<string, string>} nombres */
async function pestanaHistorial(cuerpo, eq, nombres) {
  const cambios = await repositorio.listar('cambios', c => c.cambio_entidad === 'Equipo' && c.entidad_id === eq.id, { ordenarPor: 'cambio_fecha', descendente: true });
  if (!cambios.length) { cuerpo.appendChild(h('div', { class: 'aviso', text: 'Sin cambios registrados.' })); return; }
  /** @param {string|null} json */
  const val = json => { if (json === null || json === undefined) return '—'; let v; try { v = JSON.parse(json); } catch { v = json; } return v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v); };
  /** @param {string|null} k */
  const campo = k => { if (!k) return '—'; if (ETIQUETAS[k]) return ETIQUETAS[k]; const f = CAMPOS_SERVIDOR.find(x => x.k === k); return f ? f.etq : k.replace(/^[a-z]+_/, '').replace(/_/g, ' '); };
  cuerpo.appendChild(tabla(['Fecha', 'Quién', 'Qué', 'Antes', 'Ahora'], cambios.map(c => [fmtFechaHora(c.cambio_fecha), nombres.get(c.usuario_id) || 'Alguien',
    c.cambio_operacion === 'modificacion' ? campo(c.cambio_campo) : c.cambio_operacion === 'alta' ? 'Alta' : c.cambio_operacion === 'baja' ? 'Baja' : 'Restauración',
    c.cambio_valor_oculto ? 'oculto' : val(c.cambio_valor_anterior), c.cambio_valor_oculto ? 'oculto' : val(c.cambio_valor_nuevo)])));
  cuerpo.appendChild(h('div', { class: 'mut', style: 'margin-top:6px', text: 'El valor anterior solo se ve acá, nunca al lado del vigente.' }));
}
