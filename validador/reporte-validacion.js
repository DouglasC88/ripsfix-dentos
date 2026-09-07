// ═══════════════════════════════════════════════════════════════════════════
// REPORTE "RESULTADOS DE VALIDACIÓN DEL PAQUETE"
// ═══════════════════════════════════════════════════════════════════════════
// Presenta los hallazgos del motor con la misma forma que la pantalla oficial
// del MinSalud: dos pestañas (Rechazados / Notificaciones) y las columnas
// Clase, Código, Descripción, Observaciones, PathFuente. La idea es que el
// reporte local se lea igual que el oficial y no haya que traducir nada.
//
// Tres salidas del mismo resultado: texto (consola/tests), HTML (para abrir o
// descargar, con el estilo de la app) y CSV (para pegar en Excel).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.RipsReporte = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLUMNAS = ['Clase', 'Codigo', 'Descripcion', 'Observaciones', 'PathFuente'];
  var ENCABEZADOS = {
    Clase: 'Clase', Codigo: 'Código', Descripcion: 'Descripción',
    Observaciones: 'Observaciones', PathFuente: 'PathFuente'
  };
  var RECHAZADO = 'Rechazado';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Solo las cinco columnas oficiales: los campos internos del motor (_regla,
  // _usuario, …) sirven para agrupar y filtrar, no para el reporte.
  function fila(h) {
    var f = {};
    COLUMNAS.forEach(function (c) { f[c] = h[c] == null ? '' : String(h[c]); });
    return f;
  }

  /** Separa los hallazgos en las dos pestañas de la pantalla oficial. */
  function separarPorClase(resultado) {
    var rech = [], noti = [];
    (resultado.hallazgos || []).forEach(function (h) {
      (h.Clase === RECHAZADO ? rech : noti).push(fila(h));
    });
    return { rechazados: rech, notificaciones: noti };
  }

  function estadoPaquete(resultado) {
    var r = resultado.resumen || { rechazados: 0, notificaciones: 0 };
    if (r.rechazados > 0) return { texto: 'RECHAZADO', detalle: r.rechazados + ' hallazgo(s) de rechazo', ok: false };
    if (r.notificaciones > 0) return { texto: 'ACEPTADO CON NOTIFICACIONES', detalle: r.notificaciones + ' notificación(es)', ok: true };
    return { texto: 'ACEPTADO', detalle: 'sin hallazgos', ok: true };
  }

  function lineaPeriodo(resultado) {
    var p = resultado.periodo;
    if (!p || !p.inicio) return 'Periodo de prestación esperado: no determinado.';
    var fev = p.periodoFactura;
    // El XML de la FEV solo trae el periodo facturado. Decir de dónde salió el
    // periodo prestado es parte del resultado: derivado es un supuesto sobre el
    // facturado, fijado a mano es un dato.
    var fuente = p.origen === 'manual'
      ? 'fijado a mano'
      : 'derivado del periodo facturado con la estrategia "' +
        (p.estrategia || resultado.estrategiaPeriodo) + '"';
    return 'Periodo facturado en la FEV: ' + (fev ? fev.inicio + ' a ' + fev.fin : '(desconocido)') +
      ' · Periodo de prestación que debe traer el RIPS: ' + p.inicio + ' a ' + p.fin +
      ' (' + fuente + ').';
  }

  // El desfase de numFactura entre RIPS y FEV es normal en capitación; se
  // muestra como dato, nunca como hallazgo.
  function lineaFactura(resultado) {
    var rips = (resultado.paquete && resultado.paquete.numFactura) || '(sin numFactura)';
    var fev = resultado.fev && resultado.fev.numFactura;
    if (!fev) return 'numFactura del RIPS: ' + rips + '.';
    if (String(rips) === String(fev)) return 'numFactura: ' + rips + ' (RIPS y FEV coinciden).';
    return 'numFactura del RIPS: ' + rips + ' · de la FEV: ' + fev +
      '. En capitación el desfase es esperado (la FEV va anticipada), no es un hallazgo.';
  }

  // ── Texto ───────────────────────────────────────────────────────────────
  function recortar(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ');
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  function tablaTexto(filas, anchos) {
    if (!filas.length) return '  (ninguno)\n';
    var sep = '  ' + COLUMNAS.map(function (c) {
      return new Array(anchos[c] + 1).join('-');
    }).join('  ') + '\n';
    var out = '  ' + COLUMNAS.map(function (c) {
      return (ENCABEZADOS[c] + new Array(anchos[c] + 1).join(' ')).slice(0, anchos[c]);
    }).join('  ') + '\n' + sep;
    filas.forEach(function (f) {
      out += '  ' + COLUMNAS.map(function (c) {
        return (recortar(f[c], anchos[c]) + new Array(anchos[c] + 1).join(' ')).slice(0, anchos[c]);
      }).join('  ') + '\n';
    });
    return out;
  }

  function reporteTexto(resultado, opciones) {
    opciones = opciones || {};
    var anchos = opciones.anchos || { Clase: 13, Codigo: 7, Descripcion: 38, Observaciones: 70, PathFuente: 46 };
    var partes = separarPorClase(resultado);
    var est = estadoPaquete(resultado);
    var p = resultado.paquete || {};
    var out = '';
    out += 'RESULTADOS DE VALIDACIÓN DEL PAQUETE\n';
    out += '════════════════════════════════════\n';
    out += 'Obligado: ' + (p.numDocumentoIdObligado || '(sin dato)') + ' · ' +
      (p.usuarios || 0) + ' usuario(s) · ' + (p.servicios || 0) + ' registro(s) de servicio\n';
    out += lineaFactura(resultado) + '\n';
    out += lineaPeriodo(resultado) + '\n';
    out += 'Estado: ' + est.texto + ' (' + est.detalle + ')\n\n';
    out += 'RECHAZADOS (' + partes.rechazados.length + ')\n' + tablaTexto(partes.rechazados, anchos) + '\n';
    out += 'NOTIFICACIONES (' + partes.notificaciones.length + ')\n' + tablaTexto(partes.notificaciones, anchos);
    var porRegla = (resultado.resumen && resultado.resumen.porRegla) || {};
    var codigos = Object.keys(porRegla).sort();
    if (codigos.length) {
      out += '\nRESUMEN POR REGLA\n';
      codigos.forEach(function (c) {
        var e = porRegla[c];
        out += '  ' + c + ': ' + e.total + ' hallazgo(s)' +
          (e.nRegistros ? ' en ' + e.nRegistros + ' registro(s) de ' + e.nUsuarios + ' usuario(s)' : '') +
          ' · ' + e.rechazados + ' rechazo(s), ' + e.notificaciones + ' notificación(es)\n';
      });
    }
    return out;
  }

  // ── CSV ─────────────────────────────────────────────────────────────────
  function celdaCsv(v) {
    var s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function reporteCSV(resultado) {
    // Separador ";" porque Excel en configuración regional es-CO lo espera así.
    var lineas = [COLUMNAS.map(function (c) { return ENCABEZADOS[c]; }).join(';')];
    (resultado.hallazgos || []).forEach(function (h) {
      var f = fila(h);
      lineas.push(COLUMNAS.map(function (c) { return celdaCsv(f[c]); }).join(';'));
    });
    return '﻿' + lineas.join('\r\n') + '\r\n';
  }

  // ── HTML ────────────────────────────────────────────────────────────────
  function tablaHTML(filas, vacio) {
    if (!filas.length) return '<p class="none">' + esc(vacio) + '</p>';
    var h = '<div class="tw"><table><thead><tr>' + COLUMNAS.map(function (c) {
      return '<th class="c-' + c + '">' + esc(ENCABEZADOS[c]) + '</th>';
    }).join('') + '</tr></thead><tbody>';
    filas.forEach(function (f) {
      h += '<tr>' + COLUMNAS.map(function (c) {
        if (c === 'Clase') {
          var cls = f.Clase === RECHAZADO ? 'tag rech' : 'tag noti';
          return '<td><span class="' + cls + '">' + esc(f.Clase) + '</span></td>';
        }
        if (c === 'Codigo') return '<td><code>' + esc(f.Codigo) + '</code></td>';
        if (c === 'PathFuente') return '<td><code class="path">' + esc(f.PathFuente) + '</code></td>';
        return '<td class="c-' + c + '">' + esc(f[c]) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  var CSS =
    '*{box-sizing:border-box;}body{font-family:"Nunito Sans",Arial,sans-serif;color:#1A2E3D;margin:0;background:#F8FAFC;}' +
    '.wrap{max-width:1240px;margin:0 auto;padding:24px;}' +
    'header{background:linear-gradient(100deg,#1E3A8A,#1D4ED8 55%,#2563EB 140%);color:#fff;padding:20px 24px;border-radius:12px;margin-bottom:16px;}' +
    'header h1{margin:0;font-size:1.2rem;}header p{margin:5px 0 0;opacity:.92;font-size:.8rem;}' +
    '.estado{display:inline-block;margin-top:10px;padding:5px 12px;border-radius:999px;font-size:.74rem;font-weight:800;letter-spacing:.03em;}' +
    '.estado.no{background:#FEE2E2;color:#B91C1C;}.estado.si{background:#DCFCE7;color:#15803D;}' +
    '.meta{background:#fff;border:1px solid #E2EAF0;border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:.8rem;line-height:1.6;}' +
    '.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;}' +
    '.kpi{background:#fff;border:1px solid #E2EAF0;border-radius:10px;padding:12px 16px;flex:1;min-width:120px;}' +
    '.kpi b{display:block;font-size:1.5rem;color:#1D4ED8;}.kpi span{font-size:.7rem;color:#6B8599;}' +
    '.kpi.rech b{color:#B91C1C;}.kpi.noti b{color:#B45309;}' +
    '.tabs{display:flex;gap:6px;margin-bottom:-1px;}' +
    '.tab{background:#EDF2F7;border:1px solid #E2EAF0;border-bottom:none;border-radius:9px 9px 0 0;padding:9px 16px;' +
    'font-family:"Nunito",sans-serif;font-size:.78rem;font-weight:800;color:#64748B;cursor:pointer;}' +
    '.tab.active{background:#fff;color:#1D4ED8;}' +
    '.pane{background:#fff;border:1px solid #E2EAF0;border-radius:0 10px 10px 10px;padding:14px 16px;margin-bottom:16px;}' +
    '.pane.hidden{display:none;}' +
    '.tw{overflow-x:auto;}' +
    'table{width:100%;border-collapse:collapse;font-size:.76rem;}' +
    'th{background:#EFF6FF;color:#1D4ED8;text-align:left;padding:7px 9px;font-size:.66rem;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;}' +
    'td{padding:7px 9px;border-top:1px solid #F0F4F8;vertical-align:top;}' +
    '.c-Descripcion{min-width:220px;}.c-Observaciones{min-width:320px;}' +
    'code{font-family:"Courier New",monospace;background:#F0F4F8;padding:1px 5px;border-radius:4px;font-size:.74rem;}' +
    'code.path{word-break:break-all;}' +
    '.tag{border-radius:5px;padding:2px 8px;font-size:.66rem;font-weight:800;white-space:nowrap;}' +
    '.tag.rech{background:#FEE2E2;color:#B91C1C;}.tag.noti{background:#FEF3C7;color:#92400E;}' +
    '.none{color:#6B8599;font-size:.8rem;margin:4px 0;}' +
    'section.res{background:#fff;border:1px solid #E2EAF0;border-radius:10px;padding:14px 16px;}' +
    'section.res h2{font-size:.85rem;margin:0 0 8px;color:#1D4ED8;}' +
    '@media print{body{background:#fff;}.tabs{display:none;}.pane{display:block!important;border-radius:10px;margin-top:10px;}' +
    'header,.kpi,th,.tag{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}';

  var JS =
    "function rvPane(n){var p=['rech','noti'];p.forEach(function(k){" +
    "document.getElementById('pane-'+k).classList.toggle('hidden',k!==n);" +
    "document.getElementById('tab-'+k).classList.toggle('active',k===n);});}";

  function reporteHTML(resultado, opciones) {
    opciones = opciones || {};
    var partes = separarPorClase(resultado);
    var est = estadoPaquete(resultado);
    var p = resultado.paquete || {};
    var r = resultado.resumen || { total: 0, rechazados: 0, notificaciones: 0 };
    var fecha = opciones.fecha || new Date().toLocaleString('es-CO');
    var titulo = opciones.titulo || 'Resultados de Validación del Paquete';

    var porRegla = r.porRegla || {};
    var codigos = Object.keys(porRegla).sort();
    var resumen = '';
    if (codigos.length) {
      resumen = '<section class="res"><h2>Resumen por regla</h2><div class="tw"><table><thead><tr>' +
        '<th>Código</th><th>Hallazgos</th><th>Rechazos</th><th>Notificaciones</th>' +
        '<th>Registros afectados</th><th>Usuarios afectados</th></tr></thead><tbody>';
      codigos.forEach(function (c) {
        var e = porRegla[c];
        resumen += '<tr><td><code>' + esc(c) + '</code></td><td>' + e.total + '</td><td>' + e.rechazados +
          '</td><td>' + e.notificaciones + '</td><td>' + (e.nRegistros || '—') + '</td><td>' +
          (e.nUsuarios || '—') + '</td></tr>';
      });
      resumen += '</tbody></table></div></section>';
    }

    var noEval = '';
    if ((resultado.reglasNoEvaluables || []).length) {
      noEval = '<div class="meta"><b>Reglas no evaluadas localmente:</b><ul style="margin:6px 0 0 18px;">' +
        resultado.reglasNoEvaluables.map(function (ne) {
          return '<li><code>' + esc(ne.codigo) + '</code> — ' + esc(ne.motivo) + '</li>';
        }).join('') + '</ul></div>';
    }

    return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(titulo) + '</title><style>' + CSS + '</style></head><body><div class="wrap">' +
      '<header><h1>' + esc(titulo) + '</h1>' +
      '<p>Validación local previa a SISPRO · Generado el ' + esc(fecha) + '</p>' +
      '<span class="estado ' + (est.ok ? 'si' : 'no') + '">' + esc(est.texto) + ' · ' + esc(est.detalle) + '</span>' +
      '</header>' +
      '<div class="meta">' +
      '<div>Obligado a facturar: <code>' + esc(p.numDocumentoIdObligado || '(sin dato)') + '</code></div>' +
      '<div>' + esc(lineaFactura(resultado)) + '</div>' +
      '<div>' + esc(lineaPeriodo(resultado)) + '</div>' +
      '</div>' +
      '<div class="kpis">' +
      '<div class="kpi"><b>' + (p.usuarios || 0) + '</b><span>Usuarios</span></div>' +
      '<div class="kpi"><b>' + (p.servicios || 0) + '</b><span>Registros de servicio</span></div>' +
      '<div class="kpi rech"><b>' + r.rechazados + '</b><span>Rechazados</span></div>' +
      '<div class="kpi noti"><b>' + r.notificaciones + '</b><span>Notificaciones</span></div>' +
      '</div>' + noEval +
      '<div class="tabs">' +
      '<button class="tab active" id="tab-rech" onclick="rvPane(\'rech\')">Rechazados (' + partes.rechazados.length + ')</button>' +
      '<button class="tab" id="tab-noti" onclick="rvPane(\'noti\')">Notificaciones (' + partes.notificaciones.length + ')</button>' +
      '</div>' +
      '<div class="pane" id="pane-rech">' + tablaHTML(partes.rechazados, 'Sin hallazgos de rechazo.') + '</div>' +
      '<div class="pane hidden" id="pane-noti">' + tablaHTML(partes.notificaciones, 'Sin notificaciones.') + '</div>' +
      resumen +
      '<script>' + JS + '<\/script></div></body></html>';
  }

  return {
    COLUMNAS: COLUMNAS,
    ENCABEZADOS: ENCABEZADOS,
    fila: fila,
    separarPorClase: separarPorClase,
    estadoPaquete: estadoPaquete,
    reporteTexto: reporteTexto,
    reporteCSV: reporteCSV,
    reporteHTML: reporteHTML
  };
});
