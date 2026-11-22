// @ts-check
// Datos 100 % ficticios para las maquetas de búsqueda (D-022). No representan ninguna organización real.
// Las marcas de equipos son solo para dar realismo; IPs privadas, usuarios y contraseñas inventados.

/** @typedef {{ id: string, organizacion_nombre: string, organizacion_rubro: string }} OrganizacionMaqueta */
/** @typedef {{ etiqueta: string, valor: string, mono?: boolean }} CampoMaqueta */
/**
 * @typedef {Object} ResultadoMaqueta
 * @property {string} id
 * @property {'credencial'|'equipo'|'vlan'|'puerto'|'configuracion'|'red_wifi'} tipo
 * @property {string} organizacion_id
 * @property {string} titulo
 * @property {string} subtitulo
 * @property {CampoMaqueta[]} campos           Lo que se muestra en la vista previa (y en lo que se busca)
 * @property {{ fecha: string, usuario: string }} ultimo_cambio  Fecha ISO del último cambio (MJ10)
 * @property {string} [secreto]                 Solo credenciales. NUNCA se busca ni se muestra en resultados.
 * @property {string} [vence_en]                Solo credenciales con vencimiento (MD1-B)
 */

/** @type {OrganizacionMaqueta[]} */
export const ORGANIZACIONES = [
  { id: 'org-agro', organizacion_nombre: 'Agro Demo Pampa', organizacion_rubro: 'Agroindustria' },
  { id: 'org-meta', organizacion_nombre: 'Metalúrgica Demo Acero', organizacion_rubro: 'Metalúrgica' },
  { id: 'org-cont', organizacion_nombre: 'Estudio Contable Demo', organizacion_rubro: 'Estudio contable' },
];

/** Nombres visibles de cada tipo de resultado, en el orden en que se agrupan. */
export const TIPOS = {
  credencial: 'Credenciales',
  equipo: 'Equipos',
  configuracion: 'Configuraciones',
  vlan: 'VLAN',
  puerto: 'Puertos',
  red_wifi: 'Redes Wi-Fi',
};

/** Búsquedas de ejemplo para las maquetas (QA11-A). */
export const BUSQUEDAS_EJEMPLO = ['ilo srv', 'vpn admin', '192.168.10.'];

/** Usuario que aparece en la cabecera de las maquetas. */
export const USUARIO_MAQUETA = { nombre: 'Admin Demo', perfil: 'Superadmin' };

/** @type {ResultadoMaqueta[]} */
export const RESULTADOS = [
  // ── iLO / iDRAC ───────────────────────────────────────────────
  { id: 'c1', tipo: 'credencial', organizacion_id: 'org-agro', titulo: 'iLO SRV-AGRO-01', subtitulo: 'iLO / iDRAC · HPE ProLiant DL380 Gen10',
    campos: [ { etiqueta: 'Tipo', valor: 'iLO / iDRAC' }, { etiqueta: 'Usuario', valor: 'administrador', mono: true }, { etiqueta: 'Host', valor: 'https://192.168.10.21', mono: true }, { etiqueta: 'Equipo', valor: 'SRV-AGRO-01' }, { etiqueta: 'Ubicación', valor: 'Planta · Sala de servidores · Rack R1 U12' } ],
    ultimo_cambio: { fecha: '2026-11-03T10:14:00', usuario: 'Admin Demo' }, secreto: 'Pampa#Ilo2026' },
  { id: 'c2', tipo: 'credencial', organizacion_id: 'org-agro', titulo: 'iLO SRV-AGRO-02', subtitulo: 'iLO / iDRAC · HPE ProLiant DL360 Gen10',
    campos: [ { etiqueta: 'Tipo', valor: 'iLO / iDRAC' }, { etiqueta: 'Usuario', valor: 'administrador', mono: true }, { etiqueta: 'Host', valor: 'https://192.168.10.22', mono: true }, { etiqueta: 'Equipo', valor: 'SRV-AGRO-02' }, { etiqueta: 'Ubicación', valor: 'Planta · Sala de servidores · Rack R1 U14' } ],
    ultimo_cambio: { fecha: '2026-06-18T16:40:00', usuario: 'Técnico Demo Agro' }, secreto: 'Silo-Norte!77' },
  { id: 'c3', tipo: 'credencial', organizacion_id: 'org-meta', titulo: 'iDRAC SRV-META-01', subtitulo: 'iLO / iDRAC · Dell PowerEdge R650',
    campos: [ { etiqueta: 'Tipo', valor: 'iLO / iDRAC' }, { etiqueta: 'Usuario', valor: 'root', mono: true }, { etiqueta: 'Host', valor: 'https://10.20.0.11', mono: true }, { etiqueta: 'Equipo', valor: 'SRV-META-01' }, { etiqueta: 'Ubicación', valor: 'Nave 2 · Oficina técnica · Rack A U20' } ],
    ultimo_cambio: { fecha: '2026-10-29T09:02:00', usuario: 'Admin Demo' }, secreto: 'Acero.Forja-19' },
  { id: 'e1', tipo: 'equipo', organizacion_id: 'org-agro', titulo: 'SRV-AGRO-01', subtitulo: 'Servidor · HPE ProLiant DL380 Gen10',
    campos: [ { etiqueta: 'Rol', valor: 'Controlador de dominio y archivos' }, { etiqueta: 'IP de gestión', valor: '192.168.10.11', mono: true }, { etiqueta: 'IP de iLO', valor: '192.168.10.21', mono: true }, { etiqueta: 'Sistema operativo', valor: 'Windows Server 2022' }, { etiqueta: 'N.º de serie', valor: 'CZJ1234DEMO', mono: true }, { etiqueta: 'Rack', valor: 'R1 · U12–U13' } ],
    ultimo_cambio: { fecha: '2026-09-12T11:30:00', usuario: 'Admin Demo' } },
  { id: 'e2', tipo: 'equipo', organizacion_id: 'org-agro', titulo: 'SRV-AGRO-02', subtitulo: 'Servidor · HPE ProLiant DL360 Gen10',
    campos: [ { etiqueta: 'Rol', valor: 'Hipervisor (Proxmox VE)' }, { etiqueta: 'IP de gestión', valor: '192.168.10.12', mono: true }, { etiqueta: 'IP de iLO', valor: '192.168.10.22', mono: true }, { etiqueta: 'N.º de serie', valor: 'CZJ5678DEMO', mono: true }, { etiqueta: 'Rack', valor: 'R1 · U14' } ],
    ultimo_cambio: { fecha: '2026-08-02T15:05:00', usuario: 'Técnico Demo Agro' } },
  { id: 'e3', tipo: 'equipo', organizacion_id: 'org-meta', titulo: 'SRV-META-01', subtitulo: 'Servidor · Dell PowerEdge R650',
    campos: [ { etiqueta: 'Rol', valor: 'ERP y base de datos' }, { etiqueta: 'IP de gestión', valor: '10.20.0.10', mono: true }, { etiqueta: 'IP de iDRAC', valor: '10.20.0.11', mono: true }, { etiqueta: 'N.º de serie', valor: 'DL7Q9DEMO', mono: true }, { etiqueta: 'Rack', valor: 'A · U20–U21' } ],
    ultimo_cambio: { fecha: '2026-10-29T09:00:00', usuario: 'Admin Demo' } },

  // ── VPN ──────────────────────────────────────────────────────
  { id: 'c4', tipo: 'credencial', organizacion_id: 'org-agro', titulo: 'VPN administrador · FW-AGRO', subtitulo: 'VPN administrador · Fortinet FortiGate 60F',
    campos: [ { etiqueta: 'Tipo', valor: 'VPN administrador' }, { etiqueta: 'Usuario', valor: 'vpn.admin', mono: true }, { etiqueta: 'Host', valor: 'vpn.agrodemo.example:10443', mono: true }, { etiqueta: 'Equipo', valor: 'FW-AGRO' } ],
    ultimo_cambio: { fecha: '2026-11-15T08:45:00', usuario: 'Admin Demo' }, secreto: 'Trigo&Soja-2026' },
  { id: 'c5', tipo: 'credencial', organizacion_id: 'org-meta', titulo: 'VPN administrador · RT-META', subtitulo: 'VPN administrador · MikroTik RB4011',
    campos: [ { etiqueta: 'Tipo', valor: 'VPN administrador' }, { etiqueta: 'Usuario', valor: 'admin-vpn', mono: true }, { etiqueta: 'Host', valor: 'vpn.metdemo.example', mono: true }, { etiqueta: 'Equipo', valor: 'RT-META' } ],
    ultimo_cambio: { fecha: '2026-07-21T19:10:00', usuario: 'Admin Demo' }, secreto: 'Torno$Fresa88' },
  { id: 'c6', tipo: 'credencial', organizacion_id: 'org-cont', titulo: 'VPN administrador · FW-CONT', subtitulo: 'VPN administrador · pfSense',
    campos: [ { etiqueta: 'Tipo', valor: 'VPN administrador' }, { etiqueta: 'Usuario', valor: 'soporte.ti', mono: true }, { etiqueta: 'Host', valor: '203.0.113.45:1194', mono: true }, { etiqueta: 'Equipo', valor: 'FW-CONT' } ],
    ultimo_cambio: { fecha: '2026-11-19T13:20:00', usuario: 'Admin Demo' }, secreto: 'Balance.Anual#31' },
  { id: 'c7', tipo: 'credencial', organizacion_id: 'org-cont', titulo: 'VPN usuario · Contadora Demo', subtitulo: 'VPN usuario · pfSense',
    campos: [ { etiqueta: 'Tipo', valor: 'VPN usuario' }, { etiqueta: 'Usuario', valor: 'cdemo', mono: true }, { etiqueta: 'Host', valor: '203.0.113.45:1194', mono: true }, { etiqueta: 'Equipo', valor: 'FW-CONT' } ],
    ultimo_cambio: { fecha: '2026-05-04T10:00:00', usuario: 'Admin Demo' }, secreto: 'Asiento-Doble7' },
  { id: 'k1', tipo: 'configuracion', organizacion_id: 'org-agro', titulo: 'VPN SSL para administradores', subtitulo: 'Configuración · VPN de usuario · FW-AGRO',
    campos: [ { etiqueta: 'Tipo', valor: 'VPN de usuario (SSL)' }, { etiqueta: 'Puerto', valor: '10443', mono: true }, { etiqueta: 'Red asignada', valor: '10.212.134.0/24', mono: true }, { etiqueta: 'Grupo', valor: 'vpn-admin' }, { etiqueta: 'Credencial vinculada', valor: 'VPN administrador · FW-AGRO' } ],
    ultimo_cambio: { fecha: '2026-11-15T08:40:00', usuario: 'Admin Demo' } },
  { id: 'k2', tipo: 'configuracion', organizacion_id: 'org-meta', titulo: 'VPN sitio a sitio Planta–Depósito', subtitulo: 'Configuración · VPN sitio a sitio · RT-META',
    campos: [ { etiqueta: 'Tipo', valor: 'VPN sitio a sitio (IPsec)' }, { etiqueta: 'Extremo remoto', valor: '198.51.100.20', mono: true }, { etiqueta: 'Redes locales', valor: '10.20.0.0/16', mono: true }, { etiqueta: 'Redes remotas', valor: '10.30.0.0/24', mono: true } ],
    ultimo_cambio: { fecha: '2026-03-11T17:25:00', usuario: 'Admin Demo' } },

  // ── 192.168.10.x ─────────────────────────────────────────────
  { id: 'v1', tipo: 'vlan', organizacion_id: 'org-agro', titulo: 'VLAN 10 · Administración', subtitulo: 'VLAN · 192.168.10.0/24',
    campos: [ { etiqueta: 'Número', valor: '10', mono: true }, { etiqueta: 'Red', valor: '192.168.10.0/24', mono: true }, { etiqueta: 'Gateway', valor: '192.168.10.1', mono: true }, { etiqueta: 'DHCP', valor: '192.168.10.100 – 192.168.10.199', mono: true } ],
    ultimo_cambio: { fecha: '2026-02-10T12:00:00', usuario: 'Admin Demo' } },
  { id: 'v2', tipo: 'vlan', organizacion_id: 'org-cont', titulo: 'VLAN 10 · Oficina', subtitulo: 'VLAN · 192.168.10.0/24',
    campos: [ { etiqueta: 'Número', valor: '10', mono: true }, { etiqueta: 'Red', valor: '192.168.10.0/24', mono: true }, { etiqueta: 'Gateway', valor: '192.168.10.254', mono: true }, { etiqueta: 'DHCP', valor: 'No' } ],
    ultimo_cambio: { fecha: '2026-01-22T09:30:00', usuario: 'Admin Demo' } },
  { id: 'e4', tipo: 'equipo', organizacion_id: 'org-agro', titulo: 'FW-AGRO', subtitulo: 'Firewall · Fortinet FortiGate 60F',
    campos: [ { etiqueta: 'IP de gestión', valor: '192.168.10.1', mono: true }, { etiqueta: 'IP pública', valor: '203.0.113.10', mono: true }, { etiqueta: 'Firmware', valor: 'FortiOS 7.4' }, { etiqueta: 'N.º de serie', valor: 'FGT60FDEMO01', mono: true }, { etiqueta: 'Rack', valor: 'R1 · U2' } ],
    ultimo_cambio: { fecha: '2026-11-15T08:38:00', usuario: 'Admin Demo' } },
  { id: 'e5', tipo: 'equipo', organizacion_id: 'org-agro', titulo: 'SW-AGRO-CORE', subtitulo: 'Switch · Ubiquiti UniFi USW-Pro-48',
    campos: [ { etiqueta: 'IP de gestión', valor: '192.168.10.2', mono: true }, { etiqueta: 'Puertos', valor: '48 RJ45 + 4 SFP+' }, { etiqueta: 'MAC', valor: 'AA:BB:CC:10:00:02', mono: true }, { etiqueta: 'Rack', valor: 'R1 · U4' } ],
    ultimo_cambio: { fecha: '2026-10-05T14:12:00', usuario: 'Técnico Demo Agro' } },
  { id: 'e6', tipo: 'equipo', organizacion_id: 'org-agro', titulo: 'AP-AGRO-ADMIN', subtitulo: 'Access point · Ubiquiti UniFi U6 Pro',
    campos: [ { etiqueta: 'IP de gestión', valor: '192.168.10.31', mono: true }, { etiqueta: 'Ubicación', valor: 'Oficinas · Planta alta' }, { etiqueta: 'SSID', valor: 'AGRO-ADMIN, AGRO-INVITADOS' } ],
    ultimo_cambio: { fecha: '2026-04-27T10:50:00', usuario: 'Técnico Demo Agro' } },
  { id: 'e7', tipo: 'equipo', organizacion_id: 'org-cont', titulo: 'IMP-CONT-01', subtitulo: 'Impresora · Brother MFC-L8900',
    campos: [ { etiqueta: 'IP', valor: '192.168.10.40', mono: true }, { etiqueta: 'Ubicación', valor: 'Recepción' }, { etiqueta: 'N.º de serie', valor: 'U6390DEMO', mono: true } ],
    ultimo_cambio: { fecha: '2026-08-14T16:00:00', usuario: 'Admin Demo' } },
  { id: 'p1', tipo: 'puerto', organizacion_id: 'org-agro', titulo: 'SW-AGRO-CORE · Puerto 12', subtitulo: 'Puerto · VLAN 10 · Acceso',
    campos: [ { etiqueta: 'VLAN nativa', valor: '10 · Administración' }, { etiqueta: 'Conectado a', valor: 'SRV-AGRO-01 · NIC 1 (192.168.10.11)' }, { etiqueta: 'Velocidad', valor: '1 Gbps' }, { etiqueta: 'Estado', valor: 'Activo' } ],
    ultimo_cambio: { fecha: '2026-09-12T11:32:00', usuario: 'Admin Demo' } },
  { id: 'w1', tipo: 'red_wifi', organizacion_id: 'org-agro', titulo: 'AGRO-ADMIN', subtitulo: 'Red Wi-Fi · VLAN 10 · WPA2',
    campos: [ { etiqueta: 'VLAN', valor: '10 · Administración (192.168.10.0/24)' }, { etiqueta: 'Seguridad', valor: 'WPA2 Personal' }, { etiqueta: 'Access points', valor: 'AP-AGRO-ADMIN' }, { etiqueta: 'Clave', valor: 'Ver credencial «Wi-Fi AGRO-ADMIN»' } ],
    ultimo_cambio: { fecha: '2026-04-27T10:55:00', usuario: 'Técnico Demo Agro' } },

  // ── Otros (para que la búsqueda no encuentre solo lo esperado) ─
  { id: 'c8', tipo: 'credencial', organizacion_id: 'org-agro', titulo: 'Wi-Fi AGRO-ADMIN', subtitulo: 'Wi-Fi · AP-AGRO-ADMIN',
    campos: [ { etiqueta: 'Tipo', valor: 'Wi-Fi' }, { etiqueta: 'SSID', valor: 'AGRO-ADMIN', mono: true }, { etiqueta: 'Equipo', valor: 'AP-AGRO-ADMIN' } ],
    ultimo_cambio: { fecha: '2026-04-27T10:55:00', usuario: 'Técnico Demo Agro' }, secreto: 'Cosecha2026!' },
  { id: 'c9', tipo: 'credencial', organizacion_id: 'org-cont', titulo: 'Hosting · estudiodemo.example', subtitulo: 'Hosting · Panel cPanel',
    campos: [ { etiqueta: 'Tipo', valor: 'Hosting' }, { etiqueta: 'Usuario', valor: 'estudiodemo', mono: true }, { etiqueta: 'URL', valor: 'https://panel.hostingdemo.example', mono: true } ],
    ultimo_cambio: { fecha: '2026-02-01T09:00:00', usuario: 'Admin Demo' }, secreto: 'Libro.Mayor-45', vence_en: '2026-12-15' },
  { id: 'e8', tipo: 'equipo', organizacion_id: 'org-meta', titulo: 'SW-META-NAVE2', subtitulo: 'Switch · TP-Link TL-SG3428',
    campos: [ { etiqueta: 'IP de gestión', valor: '10.20.0.3', mono: true }, { etiqueta: 'Puertos', valor: '24 RJ45 + 4 SFP' }, { etiqueta: 'Rack', valor: 'A · U3' } ],
    ultimo_cambio: { fecha: '2026-06-30T12:10:00', usuario: 'Admin Demo' } },
];

/**
 * Normaliza texto para buscar: minúsculas, sin tildes y con los separadores de MAC unificados.
 * @param {string} texto
 */
export function normalizar(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/-/g, ':');
}

/**
 * Búsqueda de la maqueta: todas las palabras de la consulta tienen que aparecer en el título,
 * el subtítulo, el tipo o los valores de la vista previa. NUNCA mira `secreto` (CU03).
 * @param {string} consulta
 * @param {string|null} organizacionId  null = todas las organizaciones (D-019)
 * @returns {ResultadoMaqueta[]}
 */
export function buscar(consulta, organizacionId = null) {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  return RESULTADOS.filter((r) => {
    if (organizacionId && r.organizacion_id !== organizacionId) return false;
    const texto = normalizar([r.titulo, r.subtitulo, TIPOS[r.tipo], ...r.campos.map((c) => c.valor)].join(' '));
    return palabras.every((p) => texto.includes(p));
  });
}

/** @param {string} id */
export function nombreOrganizacion(id) {
  return ORGANIZACIONES.find((o) => o.id === id)?.organizacion_nombre ?? '';
}
