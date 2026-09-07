# Validador local de RIPS

Motor de reglas que corre en el navegador y en Node, para detectar antes de
radicar los errores que hoy solo aparecen al validar contra SISPRO. Sirve para
**cualquier RIPS**: particulares, convenios por evento, por caso o paquete,
global prospectivo y capitación.

## La modalidad de pago es lo único que cambia

Todas las reglas se aplican igual en cualquier RIPS. La única parte que depende
del contrato es **contra qué periodo se compara la fecha de la atención**:

| Modalidad | Estrategia | Las atenciones caen… |
|---|---|---|
| `04` Pago por evento | `mismoPeriodo` | **dentro** del periodo facturado |
| `01` Pago por caso, conjunto integral, paquete o canasta | `mismoPeriodo` | **dentro** del periodo facturado |
| `02` Pago global prospectivo | `mesAnterior` | en el periodo **anterior** al facturado |
| `03` Pago por capitación | `mesAnterior` | en el periodo **anterior** al facturado |

La razón: en evento y por caso el servicio se factura **después** de prestarlo,
así que la atención está dentro del periodo que la factura cubre. En capitación
y global prospectivo la factura se emite **anticipada** para un periodo futuro,
pero el RIPS que la soporta reporta lo **ya prestado**.

Sin modalidad declarada se asume **pago por evento**, que es el caso general.
Asumir capitación marcaría como rechazo un paquete de particulares correcto.

### Consecuencias en las modalidades anticipadas

1. Si el `InvoicePeriod` de la FEV cubre **A → B**, ninguna `fechaInicioAtencion`
   debe caer en A → B: todas deben caer en el periodo previo. Cuando no es así,
   el validador oficial rechaza el paquete por **RVC014**.
2. El **desfase de `numFactura`** entre el RIPS y la FEV (el RIPS dice `FE8` y la
   factura es `FE10`) es **normal y esperado**. El motor lo muestra como dato en
   el reporte y **nunca** lo reporta como hallazgo.

### Lo que se tomó por analogía

Hay evidencia directa para capitación (paquetes reales) y para evento (es lo que
ya asumía el resto de la app). Para **`01` y `02` la regla salió por analogía**
con esas dos, y el reporte lo dice en cada corrida para que se contraste contra
el contrato. `resolverModalidad()` lo marca con `confirmar: true`.

## Dónde vive el código

**El motor está dentro de `index.html`.** La app es un solo archivo a propósito:
así el despliegue no depende de ningún otro recurso y no hay forma de publicar un
`index.html` al que le falten sus scripts.

El bloque está delimitado por dos marcadores en el script de `index.html`:

```js
// ═══ INICIO DEL MOTOR DE VALIDACIÓN DE CAPITACIÓN ═══
…
// ═══ FIN DEL MOTOR DE VALIDACIÓN DE CAPITACIÓN ═══
```

y contiene cuatro módulos, en este orden (importa: el motor usa el de periodo):

| Módulo | Global | Qué hace |
|---|---|---|
| periodo | `RipsPeriodo` | Resuelve el periodo de prestación que el RIPS debe traer. |
| motor-rvc | `RipsMotorRVC` | Registro de reglas y ejecutor. Cada regla es una función pura. |
| reporte-validacion | `RipsReporte` | Reporte con el formato de *Resultados de Validación del Paquete* (HTML, texto, CSV). |
| tablas-referencia | `RipsTablas` | Arma el `ctx.tablas` y define la forma de las tablas que hay que cargar a mano. |

Ninguno toca el DOM ni lee archivos. La UI que los usa está más abajo en el mismo
script, bajo `VALIDACIÓN DE CAPITACIÓN (panel)`.

### Los tests no tienen copia del motor

`tests/cargar-motor.js` recorta ese bloque del propio `index.html` y lo evalúa,
así que **los tests prueban el código que se despliega**, no un duplicado que se
desincroniza (son 109 casos). Dos consecuencias prácticas:

- No borres ni renombres los marcadores: si desaparecen, los tests fallan de
  inmediato con un mensaje claro en vez de validar algo viejo.
- Cualquier cambio en el motor se hace en `index.html` y se comprueba con
  `node --test`.

Este directorio, por tanto, solo tiene tests, fixtures y esta documentación:
nada de lo que hay aquí se despliega ni hace falta en tiempo de ejecución.

## Uso

Los cuatro globales quedan disponibles en la página tras cargar `index.html`:

```js
var ctx = {
  fev: {
    numFactura: 'FE10',
    periodo: { inicio: '2026-08-01', fin: '2026-08-31' }, // InvoicePeriod de la FEV
    cobertura: '17'                                       // COBERTURA_PLAN_BENEFICIOS
  },
  modalidadPago: { codigo: '03' },  // o { nombre: 'Pago por capitación' }
  tablas: RipsTablas.construir({
    cups: CUPS_DATA,            // tabla de referencia CUPSRips
    cie10: CIE10_DATA,          // para distinguir un diagnóstico roto de uno válido
    cupsCie10: CUPS_CIE10,      // CUPS -> diagnóstico de referencia
    cupsCodServicio: CSERV_CUPS // CUPS -> codServicio
  })
};

var res = RipsMotorRVC.validar(paqueteRips, ctx);          // solo reporta
var res = RipsMotorRVC.validarYCorregir(paqueteRips, ctx); // reporta y corrige

console.log(RipsReporte.reporteTexto(res));   // tabla para consola
RipsReporte.reporteHTML(res);                 // documento HTML con las dos pestañas
RipsReporte.reporteCSV(res);                  // CSV con separador ";" y BOM
```

`modalidadPago` acepta el código, el nombre o las dos cosas; el **nombre manda
sobre el código**, igual que en el resto de la app, para que un emisor con otra
codificación se siga reconociendo. También se lee del XML vía `fev.mp` /
`fev.mpNom`, que es lo que devuelve `cvXmlInfo()`.

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
| `RVC014` | Rechazado | Fecha de la atención dentro del periodo esperado **según la modalidad**. Cubre `fechaInicioAtencion`, `fechaEgreso`, `fechaDispensAdmon` y `fechaSuministroTecnologia`. | — (el periodo de la FEV y la modalidad) |
| `RVC096` | Rechazado | El CUPS existe en CUPSRips. | `cups` |
| `RVC019` | Notificación | CUPS coherente con el diagnóstico principal, comparando por categoría CIE-10 (3 primeros caracteres). Se puede endurecer a rechazo con `opciones.claseRVC019`. | `cupsCie10`, y `cie10` para corregir |
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
`RESTRICCIONES_FINALIDAD` en el módulo de tablas dentro de `index.html` (la
forma exacta está documentada ahí, junto a cada constante) o pásalas por
`ctx.tablas`.

### Fuera de alcance local

`RVG01` y `FED137` cruzan contra bases del Ministerio (BDUA/RUAF, la FEV
radicada ante la DIAN). Sin conectividad a SISPRO no se pueden evaluar, y el
motor **no las simula**: las lista como pendientes de la validación oficial.

## Corrección del JSON

`validarYCorregir()` aplica lo corregible **sobre una copia** —el paquete de
entrada nunca se toca— y vuelve a validar el resultado, para probar que la
corrección sirvió:

```js
var res = RipsMotorRVC.validarYCorregir(paquete, ctx);
res.correcciones.aplicadas;          // [{codigo, path, campo, antes, despues, motivo}]
res.corregido.paquete;               // el JSON corregido, listo para exportar
res.corregido.resumen.rechazados;    // lo que sigue mal: eso va al origen
```

Las reglas siguen siendo funciones puras: no corrigen nada, solo dejan la
corrección propuesta en el hallazgo (`_correccion`). Aplicarla es un paso aparte
(`aplicarCorrecciones()`), así que se puede reportar sin corregir y comparar
antes/después.

### Qué se corrige y qué no

| Regla | ¿Se corrige? | Por qué |
|---|---|---|
| `RVC096` | **Sí**, si es formato | Separadores o ceros a la izquierda: el código es el mismo mal escrito. |
| `RVC019` | **Solo si el diagnóstico no existe en CIE-10** | Ahí no hay criterio clínico que respetar, hay un dato roto. Si el diagnóstico es válido pero no cuadra con el CUPS, la decisión es del profesional que atendió. |
| `RVC059` | **Sí** | El `codServicio` se deriva del CUPS por tabla de referencia. |
| `RVC014` | **No, nunca** | Reescribir la fecha para que entre en el periodo haría pasar el paquete **reportando atenciones en días en que no ocurrieron**. Ver abajo. |
| `RVC017`, `RVC051` | **No** | No hay un valor correcto que deducir. |

Requisito para que RVC019 corrija: `ctx.tablas.cie10`. Sin ella el motor no puede
distinguir un diagnóstico roto de uno válido y **no reemplaza ninguno**, para no
pisar criterio clínico a ciegas.

### RVC014 no se corrige: se diagnostica

Cuando un bloque grande de atenciones cae fuera del periodo, la causa casi nunca
es que las fechas estén mal — es que **el RIPS quedó pegado a la factura
equivocada**. Reescribir 109 fechas haría pasar el paquete falseando cuándo se
prestó el servicio.

Así que en vez de corregir, el motor diagnostica. `res.desfase` (incluido en todo
resultado de `validar()`) mira qué periodo cubre realmente el paquete y, con la
inversa de la estrategia de la modalidad, dice a qué factura corresponde:

```
El paquete reporta atenciones de 2026-06 (3 de 3 registros). Con la regla de
esta modalidad, un RIPS de ese periodo acompaña a la factura cuyo periodo
facturado sea 2026-07-01 a 2026-07-31. Antes de tocar una sola fecha, revisa si
este RIPS quedó pegado a la factura equivocada: reescribir las fechas haría
pasar el paquete reportando atenciones en días en que no ocurrieron.
```

Si el paquete mezcla varios periodos no propone ninguna factura —proponer una
sola sería engañoso— y dice que hay que separarlo por periodo.

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

`calcularPeriodoEsperado(periodoFEV, { modalidad, estrategia })` acepta tres
estrategias. Normalmente la pone la modalidad; `estrategia` la fuerza:

- **`mismoPeriodo`**: el periodo facturado tal cual. Evento y caso/paquete.
- **`mesAnterior`**: el mes calendario inmediatamente anterior al mes en que
  arranca el periodo facturado. FEV de agosto → RIPS de julio. Capitación y
  global prospectivo.
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
// [ { estrategia:'mismoPeriodo',  periodo:{inicio:'2026-08-01',fin:'2026-08-31'}, registros:137, … },
//   { estrategia:'mesAnterior',   periodo:{inicio:'2026-07-01',fin:'2026-07-31'}, registros:109, … },
//   { estrategia:'ventanaPrevia', periodo:{inicio:'2026-07-01',fin:'2026-07-31'}, registros:109, … } ]
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

La pestaña **✅ Validar Paquete** carga el JSON del paquete y el XML de la
factura, resuelve la modalidad y el periodo, corre el motor con las tablas que la
página ya tiene en memoria (`CUPS_DATA`, `CIE10_DATA`, `CUPS_CIE10`,
`CSERV_CUPS`) y muestra el resultado con las pestañas Rechazados /
Notificaciones, más los botones para ver o descargar el reporte en HTML y CSV.

- **Modalidad de pago**: se lee del XML, y se puede forzar a mano cuando el XML
  no la trae o usa otra codificación.
- **Corregir lo corregible**: casilla opcional. Al marcarla aparece el botón para
  descargar el JSON corregido y una tabla con cada cambio (antes → después → por
  qué).
- **Los dos periodos** se pueden escribir a mano: el **facturado** cuando el XML
  no trae `InvoicePeriod` o lo trae mal, y el **prestado** cuando se conoce de
  primera mano. Con el prestado lleno, el facturado deja de ser necesario.

## Un defecto aparte, en el corrector de particulares

`fCUPS()` —que usa `fixJson()`, no este motor— hace
`padStart(6,'0').slice(-6)`, así que **trunca los CUPS de 7 dígitos**:
`1005371` queda en `005371` y `1000034` en `000034`, códigos que nadie reportó.
Hay CUPS de 7 dígitos reales en uso (están en `C10` y `CSERV_CUPS` de esta misma
app). Este motor no comparte ese código: su `candidatosCups()` solo rellena
cuando el código quedó **más corto** que 6 y nunca recorta.
