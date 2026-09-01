# Planificacion - {TRIMESTRE} {ANIO}

**LINK PROYECTOS:** {TRIMESTRE} {ANIO}

---

## Estructura de la hoja

| Bloque | Tarea | Detalle | Comentarios | Cliente | Responsable | %Estimado | %Real | Fecha Inicio | Fecha Fin | Status | {Sem1} | {Sem2} | {Sem3} | ... | {SemN} |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

---

## Reglas del Gantt

### Columnas semanales
- Fechas de LUNES de cada semana del trimestre. Formato: DD/mmm (05/ene, 12/ene...).
- Valores: 1 = tarea existe pero NO activa esa semana. 11 = tarea ACTIVA esa semana. vacio = no existe.

### Fila resumen del bloque
- Primera fila de cada bloque (ej: 1, 2, 3) es resumen que abarca de primera a ultima subtarea.
- Status del bloque: Done si todas Done, Doing si alguna Doing/To do, Blocked si alguna Blocked.

### Numeracion jerarquica
- Bloques: 1, 2, 3... Subtareas: 1.1, 1.2, 1.3... (pueden repetir numero si son paralelas).

### Valores de Status
- Done = Completado (verde). Doing = En progreso (amarillo). To do = Pendiente. Blocked = Bloqueado (rojo).

### Tareas tipicas por desarrollo (en este orden)
1. Cierre de requerimientos / Analisis
2. Documento diseno de solucion
3. Documento diseno tecnico (P037) si aplica
4. Desarrollo (una o mas tareas por componente)
5. Pruebas unitarias
6. Pruebas en integrado
7. Pruebas en preproduccion
8. Paso a PRO

### Calculo de duracion
- 1 dia = 6h productivas, 1 semana = 30h.
- Documento diseno: 1-2 semanas. Pruebas/subida: 2-3 dias.

### Formato condicional en Google Sheets
- Celdas 11: fondo azul claro (#99CCFF). Celdas 1: fondo gris (#F2F2F2).
- Status Done: verde (#C6EFCE). Doing: amarillo (#FFEB9C). Blocked: rojo (#FFC7CE).
- Filas de bloque: fondo azul oscuro (#2F5496), texto blanco, negrita.
