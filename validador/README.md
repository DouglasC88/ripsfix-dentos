# Validador local de RIPS para capitación

Motor de reglas que corre en el navegador y en Node, para detectar antes de
radicar los errores que hoy solo aparecen al validar contra SISPRO.

## Por qué existe

En pago por **capitación** la factura electrónica se emite **anticipada** para
un periodo futuro, pero el RIPS que la soporta reporta las atenciones **ya
prestadas**, que son las del periodo anterior al facturado.

De ahí salen las dos consecuencias que gobiernan todo este módulo:

1. Si el `InvoicePeriod` de la FEV cubre **A → B**, ninguna `fechaInicioAtencion`
   del RIPS debe caer en A → B: todas deben caer en el periodo previo. Cuando no
   es así, el validador oficial rechaza el paquete por **RVC014**.
2. El **desfase de `numFactura`** entre el RIPS y la FEV (el RIPS dice `FE8` y la
   factura es `FE10`) es **normal y esperado**. El motor lo muestra como dato en
   el reporte y **nunca** lo reporta como hallazgo.

## Archivos

| Archivo | Qué hace |
|---|---|
| `periodo.js` | Calcula el periodo de prestación que el RIPS debe traer, a partir del `InvoicePeriod` de la FEV. |
| `motor-rvc.js` | Registro de reglas y ejecutor. Cada regla es una función pura. |
| `reporte-validacion.js` | Reporte en el formato de la pantalla *Resultados de Validación del Paquete* (HTML, texto y CSV). |
| `tablas-referencia.js` | Arma el `ctx.tablas` del motor y define la forma de las tablas que hay que cargar a mano. |
| `tests/` | Tests unitarios y el fixture de 57 usuarios / 109 registros fuera de periodo. |

Ninguno toca el DOM ni lee archivos: el mismo código corre en la página y en los
tests. Se cargan como scripts clásicos (UMD), sin build ni dependencias.

## Uso

```js
var res = RipsMotorRVC.validar(paqueteRips, {
  fev: {
    numFactura: 'FE10',
    periodo: { inicio: '2026-08-01', fin: '2026-08-31' }, // InvoicePeriod de la FEV
    cobertura: '17'                                       // COBERTURA_PLAN_BENEFICIOS
  },
  tablas: RipsTablas.construir({
    cups: CUPS_DATA,            // tabla de referencia CUPSRips
    cupsCie10: CUPS_CIE10,      // CUPS -> diagnóstico de referencia
    cupsCodServicio: CSERV_CUPS // CUPS -> codServicio
  }),
  opciones: { estrategiaPeriodo: 'mesAnterior' }
});

console.log(RipsReporte.reporteTexto(res));   // tabla para consola
RipsReporte.reporteHTML(res);                 // documento HTML con las dos pestañas
RipsReporte.reporteCSV(res);                  // CSV con separador ";" y BOM
```

Cada hallazgo trae exactamente las cinco columnas de la pantalla oficial:

```js
{
  Clase: 'Rechazado',              // o 'Notificación'
  Codigo: 'RVC014',
  Descripcion: 'La fecha de la atención debe corresponder al periodo …',
  Observaciones: 'fechaInicioAtencion = 2026-08-11 está fuera del periodo …',
  PathFuente: 'usuarios[0].servicios.consultas[1].fechaInicioAtencion'
}
```

Los índices de `PathFuente` son de **base 0**, igual que los que reporta el
validador oficial (“usuario 0”, “usuario 14”). Los campos que empiezan con `_`
(`_usuario`, `_registro`, `_regla`) son internos del motor: sirven para agrupar y
no salen en el reporte.

## Reglas implementadas

| Código | Clase | Qué revisa | Tabla que necesita |
|---|---|---|---|
| `RVC014` | Rechazado | Fecha de la atención dentro del periodo de prestación esperado. Cubre `fechaInicioAtencion`, `fechaEgreso`, `fechaDispensAdmon` y `fechaSuministroTecnologia`. | — (solo el periodo de la FEV) |
| `RVC096` | Rechazado | El CUPS existe en CUPSRips. | `cups` |
| `RVC019` | Notificación | CUPS coherente con el diagnóstico principal, comparando por categoría CIE-10 (3 primeros caracteres). Se puede endurecer a rechazo con `opciones.claseRVC019`. | `cupsCie10` |
| `RVC017` | Rechazado | CUPS incluido en la cobertura o plan de beneficios de la FEV. | `cupsPorCobertura` |
| `RVC051` | Rechazado | Finalidad de la tecnología coherente con el sexo y la edad del usuario **el día de la atención**. | `finalidadRestricciones` |
| `RVC059` | Rechazado / Notificación | CUPS coherente con grupo de servicios, finalidad y causa; y `codServicio` coherente con el CUPS. | `cupsGrupoServicio` y/o `cupsCodServicio` |

### Una tabla vacía no aprueba nada

Si a una regla le falta su tabla de referencia, el motor **no la da por buena**:
la marca como no evaluable, la lista en `res.reglasNoEvaluables` y saca una
notificación en el reporte. Así no se confunde “no lo revisé” con “está bien”.

`RVC017` y `RVC051` salen de fábrica sin tabla, porque sus datos son del anexo
técnico vigente y cargarlos de memoria produciría falsos rechazos justo en las
reglas que menos ruido toleran. Para activarlas, llena `CUPS_POR_COBERTURA` y
`RESTRICCIONES_FINALIDAD` en `tablas-referencia.js` (la forma exacta está
documentada ahí) o pásalas por `ctx.tablas`.

### Fuera de alcance local

`RVG01` y `FED137` cruzan contra bases del Ministerio (BDUA/RUAF, la FEV
radicada ante la DIAN). Sin conectividad a SISPRO no se pueden evaluar, y el
motor **no las simula**: las lista como pendientes de la validación oficial.

## El periodo de prestación no está en el XML

Esto es lo primero que hay que tener claro: **el XML de la FEV no trae el periodo
prestado.** Lo único que trae es el `InvoicePeriod`, que es el periodo
**facturado**. El periodo que debe traer el RIPS no está en ningún campo del XML,
así que solo hay dos formas de saberlo:

| Forma | `periodo.origen` | Qué es |
|---|---|---|
| Derivarlo del periodo facturado | `'derivado'` | Un **supuesto** (ver estrategias abajo). |
| Fijarlo a mano | `'manual'` | Un **dato**, si sabes qué periodo trae el paquete. |

El reporte siempre dice cuál de las dos se usó, para que un rechazo por RVC014
no se lea como un hecho cuando en realidad depende de una derivación.

### Fijarlo a mano (el camino sin supuestos)

`ctx.periodo` manda sobre cualquier derivación:

```js
RipsMotorRVC.validar(paquete, {
  fev: { numFactura: 'FE10', periodo: { inicio: '2026-08-01', fin: '2026-08-31' } },
  periodo: { inicio: '2026-06-16', fin: '2026-07-15' },  // el prestado, como dato
  tablas: …
});
```

El periodo facturado queda solo como referencia del reporte y **no hace falta**
para validar. Si lo que pasas a `ctx.periodo` es inválido (incompleto o al
revés), el motor **no cae de vuelta en la derivación**: marca RVC014 como no
evaluable y lo dice. Callarse el error y derivar en silencio haría creer que se
validó contra el periodo que escribiste.

En la app esto es el paso 3 del panel, **Periodo prestado**. Mientras esté vacío
el periodo se deriva; en cuanto se llena, manda el dato. El botón «Volver a
derivarlo» lo limpia.

### Derivarlo del periodo facturado (el supuesto)

`calcularPeriodoAnterior(periodoFEV, { estrategia })` acepta dos estrategias:

- **`mesAnterior`** (por defecto): el mes calendario inmediatamente anterior al
  mes en que arranca el periodo facturado. FEV de agosto → RIPS de julio.
- **`ventanaPrevia`**: ventana de la misma longitud que el periodo facturado,
  terminando el día anterior a su inicio. Para quincenas o periodos partidos.

> **Supuesto pendiente de confirmar.** Ningún anexo técnico fija cómo se calcula
> el periodo previo, y el XML no lo dice: `mesAnterior` es lo que se observa en
> los paquetes reales de capitación con facturación mensual anticipada. Para una
> FEV que cubre un mes calendario completo ambas estrategias dan el mismo
> resultado, así que la elección entre ellas solo pesa si el contrato factura por
> quincenas o por periodos que no calzan con el mes. Lo que sí pesa siempre es
> que el rango entero sale de una derivación: si lo conoces, fíjalo a mano y
> deja de depender de ella. `RipsMotorRVC.diagnosticarPeriodo()` muestra cuántos
> hallazgos daría cada estrategia sobre un paquete ya conocido:

```js
RipsMotorRVC.diagnosticarPeriodo(paquete, { inicio: '2026-08-01', fin: '2026-08-31' });
// [ { estrategia:'mesAnterior',  periodo:{inicio:'2026-07-01',fin:'2026-07-31'}, registros:109, usuarios:42 },
//   { estrategia:'ventanaPrevia', periodo:{inicio:'2026-07-01',fin:'2026-07-31'}, registros:109, usuarios:42 } ]
```

## Tests

```sh
node --test "validador/tests/**/*.test.js"
```

Sin dependencias: usa el runner que trae Node (probado en Node 22).

### El caso que manda

`tests/fixtures/rips-capitacion-57usuarios.json` reproduce el paquete real que
motivó el motor: **57 usuarios** y **109 registros de servicio** con la fecha
fuera del periodo prestado, repartidos en **42 usuarios**. El validador oficial
señaló solo los usuarios **0, 1 y 14** —reporta una muestra, no el total— y los
tests exigen que el motor local liste los 109 y cubra los 42 usuarios, incluidos
esos tres.

El fixture es determinístico y **sintético**: tiene la forma y las cifras del
paquete del cliente, no sus datos. Para correr los tests contra el paquete real,
reemplaza el JSON y ajusta las constantes esperadas en `motor-rvc.test.js`.
Regenerar el fixture:

```sh
node validador/tests/fixtures/generar-rips-capitacion.js
```

## Dentro de la app

La pestaña **🗓️ Validar Capitación** de `index.html` carga el JSON del paquete y
el XML de la factura, resuelve el periodo, corre el motor con las tablas que la
página ya tiene en memoria (`CUPS_DATA`, `CUPS_CIE10`, `CSERV_CUPS`) y muestra el
resultado con las pestañas Rechazados / Notificaciones, más los botones para ver
o descargar el reporte en HTML y CSV.

Los dos periodos se pueden escribir a mano: el **facturado** cuando el XML no
trae `InvoicePeriod` o lo trae mal, y el **prestado** cuando se conoce de primera
mano. Con el prestado lleno, el facturado deja de ser necesario.
