// Tests del reporte con formato "Resultados de Validación del Paquete".
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
// El motor se lee de index.html, no de módulos aparte: la app es un solo archivo.
var App = require('./cargar-motor.js');
var Motor = App.RipsMotorRVC;
var Reporte = App.RipsReporte;
var Fixture = require('./fixtures/generar-rips-capitacion.js');
var PAQUETE_57 = require('./fixtures/rips-capitacion-57usuarios.json');

var CUPS_REF = { '890203': 1, '890303': 1, '890224': 1, '237101': 1, '242103': 1, '233101': 1, '231100': 1 };

function resultado(opciones) {
  return Motor.validar(PAQUETE_57, {
    fev: {
      numFactura: Fixture.FEV.numFactura,
      periodo: Fixture.FEV.periodo,
      cobertura: Fixture.FEV.cobertura
    },
    modalidadPago: { codigo: '03' },   // el fixture es un paquete de capitación
    tablas: { cups: CUPS_REF },
    opciones: Object.assign({ reportarNoEvaluables: false }, opciones || {})
  });
}

test('las columnas son exactamente las de la pantalla oficial y en su orden', function () {
  assert.deepEqual(Reporte.COLUMNAS, ['Clase', 'Codigo', 'Descripcion', 'Observaciones', 'PathFuente']);
});

test('separa los hallazgos en las pestañas Rechazados y Notificaciones', function () {
  var r = resultado();
  var p = Reporte.separarPorClase(r);
  assert.equal(p.rechazados.length, r.resumen.rechazados);
  assert.equal(p.notificaciones.length, r.resumen.notificaciones);
  assert.equal(p.rechazados.length + p.notificaciones.length, r.hallazgos.length);
  assert.equal(p.rechazados.length, 110, '109 de RVC014 + el CUPS inexistente');
});

test('cada fila lleva solo las cinco columnas, sin los campos internos del motor', function () {
  var p = Reporte.separarPorClase(resultado());
  p.rechazados.concat(p.notificaciones).forEach(function (f) {
    assert.deepEqual(Object.keys(f).sort(), Reporte.COLUMNAS.slice().sort());
  });
});

test('el estado del paquete resume igual que el validador oficial', function () {
  assert.equal(Reporte.estadoPaquete(resultado()).texto, 'RECHAZADO');
  assert.deepEqual(Reporte.estadoPaquete({ resumen: { rechazados: 0, notificaciones: 3 } }),
    { texto: 'ACEPTADO CON NOTIFICACIONES', detalle: '3 notificación(es)', ok: true });
  assert.deepEqual(Reporte.estadoPaquete({ resumen: { rechazados: 0, notificaciones: 0 } }),
    { texto: 'ACEPTADO', detalle: 'sin hallazgos', ok: true });
});

test('el reporte de texto trae encabezado, ambas pestañas y el resumen por regla', function () {
  var t = Reporte.reporteTexto(resultado());
  assert.match(t, /RESULTADOS DE VALIDACIÓN DEL PAQUETE/);
  assert.match(t, /RECHAZADOS \(110\)/);
  assert.match(t, /NOTIFICACIONES \(\d+\)/);
  assert.match(t, /RVC014: 109 hallazgo\(s\) en 109 registro\(s\) de 42 usuario\(s\)/);
  assert.match(t, /Periodo de prestación que debe traer el RIPS: 2026-07-01 a 2026-07-31/);
  assert.match(t, /Estado: RECHAZADO/);
});

test('el reporte deja constancia del desfase de numFactura como dato, no como error', function () {
  var t = Reporte.reporteTexto(resultado());
  assert.match(t, /numFactura del RIPS: FE8 · de la FEV: FE10/);
  assert.match(t, /En pago por capitación el desfase es esperado/);
});

test('el reporte de texto no rompe las columnas: una línea por hallazgo', function () {
  var t = Reporte.reporteTexto(resultado());
  var bloque = t.split('RECHAZADOS (110)')[1].split('\nNOTIFICACIONES')[0];
  var filas = bloque.split('\n').filter(function (l) { return /^\s{2}Rechazado/.test(l); });
  assert.equal(filas.length, 110);
});

test('el CSV trae encabezado, BOM y una fila por hallazgo', function () {
  var r = resultado();
  var csv = Reporte.reporteCSV(r);
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'BOM para que Excel lea los acentos');
  var lineas = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lineas[0], 'Clase;Código;Descripción;Observaciones;PathFuente');
  assert.equal(lineas.length, r.hallazgos.length + 1);
});

test('el CSV escapa los separadores y las comillas del texto', function () {
  var csv = Reporte.reporteCSV({ hallazgos: [{
    Clase: 'Rechazado', Codigo: 'RVC014',
    Descripcion: 'con ; punto y coma', Observaciones: 'con "comillas"',
    PathFuente: 'usuarios[0]'
  }] });
  var linea = csv.replace(/^﻿/, '').trim().split('\r\n')[1];
  assert.match(linea, /"con ; punto y coma"/);
  assert.match(linea, /"con ""comillas"""/);
});

test('el HTML trae las dos pestañas, los KPI y el periodo esperado', function () {
  var h = Reporte.reporteHTML(resultado(), { fecha: '2026-09-07 10:00' });
  assert.match(h, /^<!DOCTYPE html>/);
  assert.match(h, /Resultados de Validación del Paquete/);
  assert.match(h, /Rechazados \(110\)/);
  assert.match(h, /Notificaciones \(\d+\)/);
  assert.match(h, /2026-07-01 a 2026-07-31/);
  assert.match(h, /class="estado no"/, 'un paquete con rechazos se marca en rojo');
  assert.match(h, /<td>109<\/td>/, 'el resumen por regla cuenta los 109');
});

test('el HTML escapa el contenido para que un dato del RIPS no inyecte markup', function () {
  var h = Reporte.reporteHTML({
    paquete: { numDocumentoIdObligado: '<script>alert(1)</script>', usuarios: 1, servicios: 1 },
    resumen: { total: 1, rechazados: 1, notificaciones: 0, porRegla: {} },
    hallazgos: [{
      Clase: 'Rechazado', Codigo: 'RVC014', Descripcion: 'x',
      Observaciones: '<img src=x onerror=alert(1)>', PathFuente: 'usuarios[0]'
    }],
    reglasNoEvaluables: []
  });
  assert.equal(h.indexOf('<script>alert(1)</script>'), -1);
  assert.equal(h.indexOf('<img src=x'), -1);
  assert.match(h, /&lt;img src=x/);
});

test('el HTML lista las reglas que no se pudieron evaluar localmente', function () {
  var r = Motor.validar(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo, cobertura: '17' },
    modalidadPago: { codigo: '03' },
    tablas: {}
  });
  var h = Reporte.reporteHTML(r);
  assert.match(h, /Reglas no evaluadas localmente/);
  assert.match(h, /RVC096/);
  assert.match(h, /RVG01/);
});

test('un paquete sin hallazgos se reporta como aceptado y con las tablas vacías', function () {
  var r = { paquete: { usuarios: 0, servicios: 0 }, resumen: { total: 0, rechazados: 0, notificaciones: 0, porRegla: {} }, hallazgos: [], reglasNoEvaluables: [] };
  assert.match(Reporte.reporteTexto(r), /Estado: ACEPTADO \(sin hallazgos\)/);
  assert.match(Reporte.reporteTexto(r), /\(ninguno\)/);
  var h = Reporte.reporteHTML(r);
  assert.match(h, /class="estado si"/);
  assert.match(h, /Sin hallazgos de rechazo\./);
});

test('el reporte dice si el periodo prestado se derivó o se fijó a mano', function () {
  var derivado = Reporte.reporteTexto(resultado());
  assert.match(derivado, /derivado del periodo facturado con la estrategia "mesAnterior"/);

  var manual = Reporte.reporteTexto(Motor.validar(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo },
    modalidadPago: { codigo: '03' },
    periodo: { inicio: '2026-06-16', fin: '2026-07-15' },
    tablas: {}, opciones: { reportarNoEvaluables: false }
  }));
  assert.match(manual, /debe traer el RIPS: 2026-06-16 a 2026-07-15 \(fijado a mano\)/);
  assert.doesNotMatch(manual, /derivado del periodo facturado/);
});

// ── Modalidad, correcciones y diagnóstico en el reporte ─────────────────
test('el reporte nombra la modalidad y qué implica para el periodo', function () {
  var t = Reporte.reporteTexto(resultado());
  assert.match(t, /Modalidad de pago: 03 — Pago por capitación/);
  assert.match(t, /el RIPS debe traer el periodo ANTERIOR al facturado/);

  var evento = Reporte.reporteTexto(Motor.validar(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo },
    modalidadPago: { codigo: '04' },
    tablas: {}, opciones: { reportarNoEvaluables: false }
  }));
  assert.match(evento, /Pago por evento/);
  assert.match(evento, /caen DENTRO del periodo facturado/);
});

test('el reporte advierte cuando la regla de la modalidad salió por analogía', function () {
  var t = Reporte.reporteTexto(Motor.validar(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo },
    modalidadPago: { codigo: '02' },
    tablas: {}, opciones: { reportarNoEvaluables: false }
  }));
  assert.match(t, /por analogía, no de evidencia directa/);
  // Capitación sí tiene evidencia directa, así que ahí no debe advertir.
  assert.doesNotMatch(Reporte.reporteTexto(resultado()), /por analogía/);
});

test('el reporte advierte cuando no se reconoció la modalidad', function () {
  var t = Reporte.reporteTexto(Motor.validar(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo },
    tablas: {}, opciones: { reportarNoEvaluables: false }
  }));
  assert.match(t, /Modalidad de pago: no reconocida/);
  assert.match(t, /Se asumió pago por evento/);
});

test('el reporte incluye el periodo que cubre el paquete', function () {
  var t = Reporte.reporteTexto(resultado());
  assert.match(t, /PERIODO QUE CUBRE EL PAQUETE/);
  assert.match(t, /mezcla atenciones de varios periodos/);
});

test('el reporte lista las correcciones aplicadas con antes y después', function () {
  var paquete = {
    numFactura: 'FE100',
    usuarios: [{ servicios: { procedimientos: [
      { codProcedimiento: '242103.0', codDiagnosticoPrincipal: 'K053', codServicio: 343,
        fechaInicioAtencion: '2026-08-05 08:00' }
    ] } }]
  };
  var r = Motor.validarYCorregir(paquete, {
    fev: { numFactura: 'FE100', periodo: { inicio: '2026-08-01', fin: '2026-08-31' } },
    modalidadPago: { codigo: '04' },
    tablas: { cups: CUPS_REF }, opciones: { reportarNoEvaluables: false }
  });
  var t = Reporte.reporteTexto(r);
  assert.match(t, /CORRECCIONES APLICADAS \(1\)/);
  assert.match(t, /RVC096 · usuarios\[0\]\.servicios\.procedimientos\[0\]\.codProcedimiento: 242103\.0 → 242103/);
  assert.match(t, /Rechazos: 1 antes → 0 después de corregir/);

  var h = Reporte.reporteHTML(r);
  assert.match(h, /Correcciones aplicadas \(1\)/);
  assert.match(h, /class="old">242103\.0/);
  assert.match(h, /class="new">242103/);
});

test('sin correcciones el reporte no muestra la sección vacía como si hubiera corregido', function () {
  var t = Reporte.reporteTexto(resultado());
  assert.doesNotMatch(t, /CORRECCIONES APLICADAS/, 'validar() sin corregir no la incluye');
  var conCorr = Reporte.reporteTexto(Motor.validarYCorregir(PAQUETE_57, {
    fev: { numFactura: 'FE10', periodo: Fixture.FEV.periodo },
    modalidadPago: { codigo: '03' },
    tablas: { cups: CUPS_REF }, opciones: { reportarNoEvaluables: false }
  }));
  assert.match(conCorr, /CORRECCIONES APLICADAS \(0\)/);
  assert.match(conCorr, /nada de lo hallado es corregible automáticamente/);
});
