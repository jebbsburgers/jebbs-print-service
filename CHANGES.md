# Cambios en thermal-printer.ts

## 1. Bebidas y sides del combo no se imprimían en el detalle

**Problema:** El código usaba `slot.selectedExtra` (objeto singular) pero el formato nuevo del JSON manda `slot.selectedExtras` (array).

**Buscar este bloque:**
```ts
// 🥤 BEBIDAS Y NUGGETS
if (slot.selectedExtra) {
  if (slotIndex > 0 || slot.burgers?.length > 0) {
    printer.newLine();
  }

  printer.setTextSize(0, 1);
  const extraPriceLabel = slot.selectedExtra.price > 0
    ? ` - +$${slot.selectedExtra.price.toLocaleString("es-AR")}`
    : "";
  if (slot.slotType === "drink") {
    printer.println(`Bebida: ${slot.selectedExtra.name}${extraPriceLabel}`);
  } else {
    printer.println(`${slot.selectedExtra.name}${extraPriceLabel}`);
  }
  printer.setTextSize(0, 0);
}
```

**Reemplazar por:**
```ts
// 🥤 BEBIDAS Y NUGGETS
const slotExtras = slot.selectedExtras ?? (slot.selectedExtra ? [slot.selectedExtra] : []);
if (slotExtras.length > 0) {
  if (slotIndex > 0 || slot.burgers?.length > 0) {
    printer.newLine();
  }

  slotExtras.forEach((selectedExtra: any) => {
    printer.setTextSize(0, 1);
    const extraPriceLabel = selectedExtra.price > 0
      ? ` - +$${selectedExtra.price.toLocaleString("es-AR")}`
      : "";
    if (slot.slotType === "drink") {
      printer.println(`Bebida: ${selectedExtra.name}${extraPriceLabel}`);
    } else {
      printer.println(`${selectedExtra.name}${extraPriceLabel}`);
    }
    printer.setTextSize(0, 0);
  });
}
```

---

## 2. Bebidas del combo no aparecían en el RESUMEN

**Problema:** Mismo bug de `selectedExtra` vs `selectedExtras`, pero en la sección del resumen de cocina.

**Buscar este bloque:**
```ts
// Bebidas del combo
if (slot.selectedExtra && slot.slotType === "drink") {
  const drinkName = slot.selectedExtra.name;
  drinksSummary[drinkName] = (drinksSummary[drinkName] ?? 0) + item.quantity;
}
```

**Reemplazar por:**
```ts
// Bebidas del combo
const drinkExtras = slot.selectedExtras ?? (slot.selectedExtra ? [slot.selectedExtra] : []);
if (slot.slotType === "drink") {
  drinkExtras.forEach((drink: any) => {
    drinksSummary[drink.name] = (drinksSummary[drink.name] ?? 0) + item.quantity;
  });
}
```

---

## 3. Papas sazonadas aparecían duplicadas en el RESUMEN

**Problema:** Cuando una burger tiene papas sazonadas, `friesQuantity` sumaba a "Papas" Y el extra de papas sazonadas también aparecía por separado. Resultado: "1 Papas" + "1 Papas sazonadas".

**Buscar este bloque** (dentro del `else` de `Array.isArray(customData)`, en la sección del resumen):
```ts
if (customData.friesQuantity !== undefined) {
  totalFries += customData.friesQuantity * item.quantity;
}
```

**Reemplazar por:**
```ts
if (customData.friesQuantity !== undefined) {
  const hasSpecialFries = item.extras.some(e =>
    e.extra_name.toLowerCase().includes("papas")
  );
  if (!hasSpecialFries) {
    totalFries += customData.friesQuantity * item.quantity;
  }
}
```

---

## 4. Gaseosas y extras no aparecían en el RESUMEN

**Problema:** El loop de `item.extras` en el resumen tenía un filtro por nombre (`isSide`) que solo aceptaba "papas", "coca" o "bebida". Extras como "Lata pepsi", "Lata 7up", etc. no matcheaban y se descartaban.

**Buscar este bloque:**
```ts
// Extras dentro de hamburguesas
for (const extra of item.extras) {
  const name = extra.extra_name.toLowerCase();

  const isSide =
    name.includes("papas") ||
    name.includes("coca") ||
    name.includes("bebida");

  if (!isSide) continue;

  const key = extra.extra_name;
  extrasSummary[key] = (extrasSummary[key] ?? 0) + extra.quantity;
}
```

**Reemplazar por:**
```ts
// Extras dentro de hamburguesas - todos al resumen
for (const extra of item.extras) {
  const key = extra.extra_name;
  extrasSummary[key] = (extrasSummary[key] ?? 0) + extra.quantity;
}
```
