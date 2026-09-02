# Estimaciones - {TRIMESTRE} {ANIO}

---

## HOJA 1: Inversion (resumen ejecutivo por stream)

Para CADA stream, generar un bloque con esta estructura:

### {Nombre del Stream} (ej: "Desarrollos CR", "Estrategico CR", "4Sight/WeMatch/LOPR")

| Concepto | Coste Nfq | Oferta SDA | Ahorro | Comentarios |
| --- | --- | --- | --- | --- |
| Numero FTEs | {ftes_nfq} | {ftes_sda} | - | |
| Inversion | | | | {descripcion de la inversion, ej: "25% Sergio M. + 15% FTE"} |
| Horas | {horas_nfq} | {horas_sda} | - | |
| Coste | {coste_sin_iva} EUR | {coste_sda_sin_iva} EUR | {ahorro} EUR | {comentario ahorro} |

**Formulas de la hoja Inversion:**
- Numero FTEs = SUMA de los FTEs fraccionarios de las iniciativas del stream (de la hoja Iniciativas)
- Horas = Numero FTEs x 500 (horas/trimestre por FTE)
- Coste Nfq sin IVA = Horas x 51,22 EUR/hora
- Coste Nfq con IVA = Coste sin IVA x 1,21
- Oferta SDA = se toma de la columna SDA de la hoja Iniciativas
- Ahorro = Coste Nfq con IVA - Oferta SDA con IVA

---

## HOJA 2: Iniciativas (resumen por iniciativa)

| Bloque | Estado | Iniciativa | SDA | MMF | Comentarios | Horas (Nfq) | Importe sin IVA (Nfq) | Importe con IVA (Nfq) | Horas (SDA) | Importe sin IVA (SDA) | Importe con IVA (SDA) | {Persona1} | {Persona2} | {PersonaN} | Total FTEs | Cliente |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| {Bloque} | Estimado | {Nombre iniciativa} | {codigo_sda} | {codigo_mmf} | {Descripcion breve} | {horas} | {importe} | {importe_iva} | {horas_sda} | {importe_sda} | {importe_sda_iva} | {0.5} | {0.25} | {1.0} | {suma_ftes} | {cliente} |

**Estados validos:** No presentado, Estimado, Pendiente

**Formulas:**
- Importe sin IVA = Horas x 51,22 EUR/hora (tarifa estandar NFQ)
- Importe con IVA = Importe sin IVA x 1,21
- Total FTEs = SUMA de las columnas de personas
- Fila de totales: SUMA de cada columna numerica

---

## HOJA 3: Estimaciones detalladas

Para CADA iniciativa, generar un bloque independiente con esta estructura:

### --- BLOQUE: {Nombre de la iniciativa} ---

**Descripcion del desarrollo:** {Descripcion completa de la iniciativa en 2-3 lineas}

**FTEs:** {numero de FTEs asignados, ej: 0.5}

| Fase | Detalle | Horas |
| --- | --- | --- |
| Diseno | {Levantamiento del AS-IS de... descripcion especifica.} | {horas} |
| Diseno | {Levantamiento de los requerimientos (TO-BE) para... Realizacion del documento C204.} | - |
| Diseno | {Creacion del diseno de solucion de las tareas necesarias...} | - |
| Desarrollo | {Realizar los desarrollos descritos en el TO-BE...} | {horas} |
| Pruebas | {Ejecucion y validacion de las pruebas inventariadas en el C204.} | {horas} |
| Subida | {Subida a produccion de los desarrollos asegurando la correcta implantacion de los mismos.} | {horas} |
| Subida | {Soporte a la produccion de posibles errores que pudieran surgir derivados de la subida y revision activa durante la siguiente semana.} | {horas} |

**Comentarios:** {Observaciones relevantes}

**Horas totales:** {SUMA de todas las horas del bloque}

---

## Reglas de estimacion

### Distribucion tipica de horas por fase

| Fase | % tipico | Descripcion |
| --- | --- | --- |
| Diseno | 25-40% | AS-IS, TO-BE, documento C204, diseno de solucion |
| Desarrollo | 30-45% | Implementacion del TO-BE |
| Pruebas | 5-15% | Pruebas unitarias, integracion, preproduccion |
| Subida | 5-15% | Despliegue + soporte post-produccion (1 semana) |

### Calculos

- **1 FTE** = 500 horas/trimestre (aprox. 40h/semana x 12.5 semanas)
- **Tarifa hora NFQ** = 51,22 EUR/hora (sin IVA)
- **IVA** = 21%
- **Horas** deben coincidir entre la hoja de resumen y el desglose detallado

### Fases obligatorias en el desglose

Cada iniciativa SIEMPRE debe incluir estas fases en este orden:
1. **Diseno**: Minimo 2 lineas (AS-IS + TO-BE/C204). Si incluye diseno de solucion, anadir linea adicional.
2. **Desarrollo**: Los desarrollos descritos en el TO-BE.
3. **Pruebas**: Ejecucion y validacion de pruebas del C204.
4. **Subida**: Dos lineas siempre: (1) subida a produccion, (2) soporte post-produccion.

### Textos estandar reutilizables

- Pruebas: "Ejecucion y validacion de las pruebas inventariadas en el C204."
- Subida linea 1: "Subida a produccion de los desarrollos asegurando la correcta implantacion de los mismos."
- Subida linea 2: "Soporte a la produccion de posibles errores que pudieran surgir derivados de la subida y revision activa durante la siguiente semana."
