// ═══════════════════════════════════════════════════════════════════════════
// PERIODO DE PRESTACIÓN EN CAPITACIÓN
// ═══════════════════════════════════════════════════════════════════════════
// En pago por capitación la factura electrónica (FEV) se emite de forma
// ANTICIPADA para un periodo futuro, pero el RIPS que la soporta reporta las
// atenciones YA PRESTADAS, que son las del periodo anterior al que factura.
//
// Consecuencia práctica: si el InvoicePeriod de la FEV cubre A→B, ninguna
// fechaInicioAtencion del RIPS debe caer en A→B; todas deben caer en el
// periodo previo. Por eso también es NORMAL que el numFactura del RIPS vaya
// desfasado respecto al de la FEV (el RIPS dice "FE8" y la factura es "FE10"):
// ese desfase no es un error y este módulo no lo trata como tal.
//
// Cómo se calcula el periodo previo no está fijado por un anexo técnico, así
// que se deja como estrategia configurable y se documenta el supuesto.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.RipsPeriodo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

  // Las fechas del RIPS y de la FEV son fechas civiles ("2026-08-01"), no
  // instantes: se comparan como texto ISO y se aritmetizan en UTC para que el
  // huso horario del navegador no corra un día el resultado.
  function aDia(valor) {
    if (valor == null) return null;
    var m = String(valor).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  function esDiaValido(dia) {
    var m = RE_FECHA.exec(dia || '');
    if (!m) return false;
    var a = +m[1], mes = +m[2], d = +m[3];
    if (mes < 1 || mes > 12 || d < 1) return false;
    return d <= diasEnMes(a, mes);
  }

  function diasEnMes(anio, mes) {
    return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  }

  function partes(dia) {
    var m = RE_FECHA.exec(dia);
    return { anio: +m[1], mes: +m[2], dia: +m[3] };
  }

  function armar(anio, mes, dia) {
    return String(anio) + '-' + ('0' + mes).slice(-2) + '-' + ('0' + dia).slice(-2);
  }

  function sumarDias(dia, n) {
    var p = partes(dia);
    var t = Date.UTC(p.anio, p.mes - 1, p.dia) + n * 86400000;
    var d = new Date(t);
    return armar(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  function diasEntre(desde, hasta) {
    var a = partes(desde), b = partes(hasta);
    return Math.round((Date.UTC(b.anio, b.mes - 1, b.dia) - Date.UTC(a.anio, a.mes - 1, a.dia)) / 86400000);
  }

  // Mes calendario inmediatamente anterior al mes que contiene `dia`.
  function mesAnteriorDe(dia) {
    var p = partes(dia);
    var mes = p.mes - 1, anio = p.anio;
    if (mes === 0) { mes = 12; anio -= 1; }
    return { inicio: armar(anio, mes, 1), fin: armar(anio, mes, diasEnMes(anio, mes)) };
  }

  var ESTRATEGIAS = {
    // Supuesto por defecto: el RIPS trae el mes calendario anterior al mes en
    // que arranca el periodo facturado. Es lo que se observa en los paquetes
    // reales de capitación con facturación mensual anticipada.
    mesAnterior: function (fev) {
      return mesAnteriorDe(fev.inicio);
    },
    // Alternativa para periodos que no son meses calendario completos
    // (quincenas, periodos partidos): ventana de la misma longitud que termina
    // el día anterior al inicio de la FEV.
    ventanaPrevia: function (fev) {
      var largo = diasEntre(fev.inicio, fev.fin) + 1;
      var fin = sumarDias(fev.inicio, -1);
      return { inicio: sumarDias(fin, -(largo - 1)), fin: fin };
    }
  };

  var ESTRATEGIA_POR_DEFECTO = 'mesAnterior';

  // Normaliza el periodo de la FEV desde cualquiera de las formas en que llega:
  // el objeto de parseXML() ({periodStart, periodEnd}), un {inicio, fin} o el
  // InvoicePeriod crudo ({StartDate, EndDate}).
  function normalizarPeriodoFEV(entrada) {
    if (!entrada) return null;
    var ini = aDia(entrada.inicio || entrada.periodStart || entrada.StartDate || entrada.startDate);
    var fin = aDia(entrada.fin || entrada.periodEnd || entrada.EndDate || entrada.endDate);
    if (!esDiaValido(ini) || !esDiaValido(fin)) return null;
    if (fin < ini) return null;
    return { inicio: ini, fin: fin };
  }

  /**
   * Periodo de prestación que el RIPS debe reportar para una FEV de capitación.
   *
   * @param {Object} periodoFEV InvoicePeriod de la factura, en cualquiera de
   *        las formas que acepta normalizarPeriodoFEV().
   * @param {Object} [opciones]
   * @param {string} [opciones.estrategia='mesAnterior'] 'mesAnterior' | 'ventanaPrevia'
   * @returns {Object} { inicio, fin, estrategia, periodoFactura, valido, motivo }
   */
  function calcularPeriodoAnterior(periodoFEV, opciones) {
    opciones = opciones || {};
    var nombre = opciones.estrategia || ESTRATEGIA_POR_DEFECTO;
    var fev = normalizarPeriodoFEV(periodoFEV);
    if (!fev) {
      return {
        valido: false,
        motivo: 'La factura electrónica no trae un InvoicePeriod con fecha de inicio y fin válidas.',
        origen: 'derivado', estrategia: nombre, periodoFactura: null, inicio: null, fin: null
      };
    }
    var fn = ESTRATEGIAS[nombre];
    if (!fn) {
      return {
        valido: false,
        motivo: 'Estrategia de periodo desconocida: "' + nombre + '".',
        origen: 'derivado', estrategia: nombre, periodoFactura: fev, inicio: null, fin: null
      };
    }
    var prev = fn(fev);
    return {
      valido: true, motivo: null, origen: 'derivado', estrategia: nombre, periodoFactura: fev,
      inicio: prev.inicio, fin: prev.fin
    };
  }

  /**
   * Periodo de prestación fijado a mano.
   *
   * El XML de la FEV NO trae el periodo prestado: solo trae el InvoicePeriod,
   * que es el periodo facturado. Todo lo que calcularPeriodoAnterior() devuelve
   * es una derivación —un supuesto— sobre ese periodo facturado. Cuando se sabe
   * de primera mano qué periodo trae el RIPS (porque lo dice el contrato o el
   * área que armó el paquete), este camino lo fija y saca el supuesto del medio.
   *
   * @param {Object} entrada        {inicio, fin} del periodo prestado.
   * @param {Object} [periodoFactura] InvoicePeriod de la FEV, solo informativo.
   */
  function periodoPrestadoExplicito(entrada, periodoFactura) {
    var p = normalizarPeriodoFEV(entrada); // misma normalización de {inicio, fin}
    var fev = normalizarPeriodoFEV(periodoFactura);
    if (!p) {
      return {
        valido: false, origen: 'manual', estrategia: null, periodoFactura: fev,
        inicio: null, fin: null,
        motivo: 'El periodo de prestación indicado a mano no tiene fecha de inicio y fin válidas.'
      };
    }
    return {
      valido: true, motivo: null, origen: 'manual', estrategia: null,
      periodoFactura: fev, inicio: p.inicio, fin: p.fin
    };
  }

  function dentroDelPeriodo(fecha, periodo) {
    var d = aDia(fecha);
    if (!d || !periodo || !periodo.inicio || !periodo.fin) return null; // no evaluable
    return d >= periodo.inicio && d <= periodo.fin;
  }

  // Cuántos días de desfase hay entre la fecha y el periodo esperado; negativo
  // si la atención es anterior al periodo, positivo si es posterior.
  function desfaseEnDias(fecha, periodo) {
    var d = aDia(fecha);
    if (!d || !periodo || !periodo.inicio || !periodo.fin) return null;
    if (d < periodo.inicio) return diasEntre(periodo.inicio, d);
    if (d > periodo.fin) return diasEntre(periodo.fin, d);
    return 0;
  }

  function etiqueta(periodo) {
    if (!periodo || !periodo.inicio || !periodo.fin) return '(sin periodo)';
    return periodo.inicio + ' a ' + periodo.fin;
  }

  return {
    ESTRATEGIAS: Object.keys(ESTRATEGIAS),
    ESTRATEGIA_POR_DEFECTO: ESTRATEGIA_POR_DEFECTO,
    aDia: aDia,
    esDiaValido: esDiaValido,
    sumarDias: sumarDias,
    diasEntre: diasEntre,
    diasEnMes: diasEnMes,
    mesAnteriorDe: mesAnteriorDe,
    normalizarPeriodoFEV: normalizarPeriodoFEV,
    calcularPeriodoAnterior: calcularPeriodoAnterior,
    periodoPrestadoExplicito: periodoPrestadoExplicito,
    dentroDelPeriodo: dentroDelPeriodo,
    desfaseEnDias: desfaseEnDias,
    etiqueta: etiqueta
  };
});
