export function translateDeliveryType(type?: string): string | null {
  if (!type) return null;

  return type === "pickup" ? "Retira" : "Envío";
}

export function translatePaymentMethod(method?: string): string | null {
  if (!method) return null;

  return method === "cash" ? "Efectivo" : "Transferencia";
}
