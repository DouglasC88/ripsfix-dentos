// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE: PAQUETE DE CAPITACIÓN CON 57 USUARIOS Y 109 REGISTROS FUERA DE
// PERIODO
// ═══════════════════════════════════════════════════════════════════════════
// Reconstrucción del caso real que motivó el motor: un paquete de capitación
// cuya FEV cubre agosto/2026 (periodo facturado) mientras el RIPS debía traer
// las atenciones de julio/2026 (periodo prestado). En el paquete original hay
// 109 registros de servicio con fechaInicioAtencion fuera de julio, repartidos
// en 42 usuarios, pero el validador oficial solo señaló a los usuarios 0, 1 y 14:
// reporta una muestra, no el total. El motor local debe listar los 109.
//
// El fixture es DETERMINÍSTICO (sin aleatoriedad) para que las cifras del test
// no se muevan. No es el paquete del cliente: son datos sintéticos con la misma
// forma y las mismas cifras. Para correr los tests contra el paquete real,
// reemplaza rips-capitacion-57usuarios.json por el archivo verdadero y ajusta
// las constantes esperadas en motor-rvc.test.js.
//
// Regenerar:  node validador/tests/fixtures/generar-rips-capitacion.js
'use strict';

var TOTAL_USUARIOS = 57;
var TOTAL_FUERA_DE_PERIODO = 109;

// La FEV va anticipada: cubre agosto y se emite antes de agosto.
var FEV = {
  numFactura: 'FE10',
  periodo: { inicio: '2026-08-01', fin: '2026-08-31' },
  cobertura: '17'
};
// El RIPS va atrasado y por eso su numFactura no es el de su propia factura.
// En capitación ese desfase es normal y el motor no lo reporta.
var NUM_FACTURA_RIPS = 'FE8';
var PERIODO_PRESTADO = { inicio: '2026-07-01', fin: '2026-07-31' };

// Odontología: los CUPS y diagnósticos son los que usa la app para capitación.
var CONSULTAS = [
  { cups: '890203', dx: 'K021', codServicio: 334 },
  { cups: '890303', dx: 'K021', codServicio: 334 },
  { cups: '890224', dx: 'K088', codServicio: 334 }
];
var PROCEDIMIENTOS = [
  { cups: '237101', dx: 'K040', codServicio: 334 },
  { cups: '242103', dx: 'K053', codServicio: 334 },
  { cups: '233101', dx: 'K083', codServicio: 334 },
  { cups: '231100', dx: 'K029', codServicio: 334 }
];

// Fechas dentro de julio: el paquete correcto.
var DIAS_EN_PERIODO = ['2026-07-03', '2026-07-08', '2026-07-14', '2026-07-21', '2026-07-29'];
// Fechas fuera de julio. Las de agosto son el error típico de capitación
// (se reportó el periodo que la factura factura, no el prestado); la de junio
// es una atención rezagada que también queda fuera.
var DIAS_FUERA = ['2026-08-04', '2026-08-11', '2026-08-19', '2026-08-27', '2026-06-25'];

/**
 * Cuántos registros fuera de periodo lleva cada usuario. Los usuarios 0, 1 y
 * 14 —los únicos que señaló el validador oficial— van primero y con varios
 * registros cada uno; el resto se reparte de forma cíclica hasta completar
 * exactamente TOTAL_FUERA_DE_PERIODO.
 */
function repartirFueraDePeriodo() {
  var fuera = new Array(TOTAL_USUARIOS).fill(0);
  var senalados = [0, 1, 14];
  fuera[0] = 4; fuera[1] = 4; fuera[14] = 3;
  var restante = TOTAL_FUERA_DE_PERIODO - (4 + 4 + 3);
  // Reparto cíclico 3-2-3-2… sobre los usuarios que el validador no señaló,
  // saltando el 55 y el 56 para dejar usuarios completamente limpios.
  var candidatos = [];
  for (var i = 0; i < TOTAL_USUARIOS - 2; i++) {
    if (senalados.indexOf(i) < 0) candidatos.push(i);
  }
  var k = 0;
  while (restante > 0) {
    var u = candidatos[k % candidatos.length];
    var cuota = Math.min(restante, (k % 2 === 0) ? 3 : 2);
    fuera[u] += cuota;
    restante -= cuota;
    k++;
    if (k > 10000) throw new Error('reparto sin converger');
  }
  return fuera;
}

function documento(i) { return String(1010000000 + i * 37); }

function nacimiento(i) {
  // Edades repartidas entre ~4 y ~74 años a julio/2026.
  var anio = 1952 + (i * 5) % 70;
  var mes = 1 + (i * 7) % 12;
  var dia = 1 + (i * 11) % 28;
  return anio + '-' + ('0' + mes).slice(-2) + '-' + ('0' + dia).slice(-2);
}

function construirPaquete() {
  var fuera = repartirFueraDePeriodo();
  var usuarios = [];

  for (var i = 0; i < TOTAL_USUARIOS; i++) {
    var consultas = [], procedimientos = [];
    var consec = { c: 1, p: 1 };
    var nFuera = fuera[i];
    // Cada usuario lleva al menos una atención correcta, para que el test
    // demuestre que el motor no marca el paquete completo.
    var nDentro = 1 + (i % 3);

    function registro(plantilla, fecha, esConsulta) {
      var base = {
        codPrestador: '050010123401',
        fechaInicioAtencion: fecha + ' 08:00',
        numAutorizacion: null,
        modalidadGrupoServicioTecSal: '01',
        grupoServicios: '01',
        codServicio: plantilla.codServicio,
        finalidadTecnologiaSalud: '15',
        codDiagnosticoPrincipal: plantilla.dx,
        tipoDocumentoIdentificacion: 'CC',
        numDocumentoIdentificacion: '43567890',
        vrServicio: 0,
        valorPagoModerador: 0,
        numFEVPagoModerador: null,
        conceptoRecaudo: '05'
      };
      if (esConsulta) {
        base.codConsulta = plantilla.cups;
        base.causaMotivoAtencion = '26';
        base.tipoDiagnosticoPrincipal = '02';
        base.codDiagnosticoRelacionado1 = null;
        base.codDiagnosticoRelacionado2 = null;
        base.codDiagnosticoRelacionado3 = null;
        base.consecutivo = consec.c++;
        consultas.push(base);
      } else {
        base.codProcedimiento = plantilla.cups;
        base.viaIngresoServicioSalud = '01';
        base.idMIPRES = null;
        base.codDiagnosticoRelacionado = null;
        base.codComplicacion = null;
        base.consecutivo = consec.p++;
        procedimientos.push(base);
      }
    }

    var j;
    for (j = 0; j < nDentro; j++) {
      var dia = DIAS_EN_PERIODO[(i + j) % DIAS_EN_PERIODO.length];
      if ((i + j) % 2 === 0) registro(CONSULTAS[(i + j) % CONSULTAS.length], dia, true);
      else registro(PROCEDIMIENTOS[(i + j) % PROCEDIMIENTOS.length], dia, false);
    }
    for (j = 0; j < nFuera; j++) {
      var diaF = DIAS_FUERA[(i * 2 + j) % DIAS_FUERA.length];
      if ((i + j) % 2 === 0) registro(PROCEDIMIENTOS[(i + j) % PROCEDIMIENTOS.length], diaF, false);
      else registro(CONSULTAS[(i + j) % CONSULTAS.length], diaF, true);
    }

    usuarios.push({
      tipoDocumentoIdentificacion: 'CC',
      numDocumentoIdentificacion: documento(i),
      tipoUsuario: '04',
      fechaNacimiento: nacimiento(i),
      codSexo: (i % 2 === 0) ? 'F' : 'M',
      codPaisResidencia: '170',
      codMunicipioResidencia: '05001',
      codZonaTerritorialResidencia: '01',
      incapacidad: 'NO',
      codPaisOrigen: '170',
      consecutivo: i + 1,
      servicios: {
        consultas: consultas.length ? consultas : null,
        procedimientos: procedimientos.length ? procedimientos : null
      }
    });
  }

  // Defectos deliberados para las demás reglas, siempre con fecha DENTRO del
  // periodo para no alterar el conteo de RVC014:
  //   · usuario 2: CUPS que no existe en CUPSRips           → RVC096
  //   · usuario 3: diagnóstico ajeno a la categoría del CUPS → RVC019
  usuarios[2].servicios.procedimientos.push({
    codPrestador: '050010123401', fechaInicioAtencion: '2026-07-15 08:00', idMIPRES: null,
    numAutorizacion: null, codProcedimiento: '999999', viaIngresoServicioSalud: '01',
    modalidadGrupoServicioTecSal: '01', grupoServicios: '01', codServicio: 334,
    finalidadTecnologiaSalud: '15', tipoDocumentoIdentificacion: 'CC',
    numDocumentoIdentificacion: '43567890', codDiagnosticoPrincipal: 'K083',
    codDiagnosticoRelacionado: null, codComplicacion: null, vrServicio: 0,
    conceptoRecaudo: '05', valorPagoModerador: 0, numFEVPagoModerador: null,
    consecutivo: usuarios[2].servicios.procedimientos.length + 1
  });
  usuarios[3].servicios.procedimientos.push({
    codPrestador: '050010123401', fechaInicioAtencion: '2026-07-16 08:00', idMIPRES: null,
    numAutorizacion: null, codProcedimiento: '237101', viaIngresoServicioSalud: '01',
    modalidadGrupoServicioTecSal: '01', grupoServicios: '01', codServicio: 334,
    finalidadTecnologiaSalud: '15', tipoDocumentoIdentificacion: 'CC',
    numDocumentoIdentificacion: '43567890', codDiagnosticoPrincipal: 'J039',
    codDiagnosticoRelacionado: null, codComplicacion: null, vrServicio: 0,
    conceptoRecaudo: '05', valorPagoModerador: 0, numFEVPagoModerador: null,
    consecutivo: usuarios[3].servicios.procedimientos.length + 1
  });

  return {
    numDocumentoIdObligado: '9001234567',
    numFactura: NUM_FACTURA_RIPS,
    tipoNota: null,
    numNota: null,
    usuarios: usuarios
  };
}

var API = {
  TOTAL_USUARIOS: TOTAL_USUARIOS,
  TOTAL_FUERA_DE_PERIODO: TOTAL_FUERA_DE_PERIODO,
  FEV: FEV,
  NUM_FACTURA_RIPS: NUM_FACTURA_RIPS,
  PERIODO_PRESTADO: PERIODO_PRESTADO,
  USUARIOS_SENALADOS_POR_SISPRO: [0, 1, 14],
  DIAS_EN_PERIODO: DIAS_EN_PERIODO,
  DIAS_FUERA: DIAS_FUERA,
  repartirFueraDePeriodo: repartirFueraDePeriodo,
  construirPaquete: construirPaquete
};

if (typeof module === 'object' && module.exports) module.exports = API;

// Ejecutado directamente: (re)escribe el JSON del fixture.
if (typeof require !== 'undefined' && require.main === module) {
  var fs = require('fs'), path = require('path');
  var destino = path.join(__dirname, 'rips-capitacion-57usuarios.json');
  fs.writeFileSync(destino, JSON.stringify(construirPaquete(), null, 2) + '\n', 'utf8');
  var meta = path.join(__dirname, 'fev-capitacion.json');
  fs.writeFileSync(meta, JSON.stringify({
    numFactura: FEV.numFactura,
    InvoicePeriod: { StartDate: FEV.periodo.inicio, EndDate: FEV.periodo.fin },
    cobertura: FEV.cobertura
  }, null, 2) + '\n', 'utf8');
  console.log('Fixture escrito en ' + destino);
}
