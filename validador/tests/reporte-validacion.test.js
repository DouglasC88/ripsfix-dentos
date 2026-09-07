// Tests del reporte con formato "Resultados de Validación del Paquete".
'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var Motor = require('../motor-rvc.js');
var Reporte = require('../reporte-validacion.js');
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
  assert.match(t, /el desfase es esperado/);
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
