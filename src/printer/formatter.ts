import {
  OrderWithItems,
  OrderItemWithExtras,
  ComboCustomization,
  BurgerCustomization,
} from "../types/order";
import {
  translateDeliveryType,
  translatePaymentMethod,
} from "../utils/translate";

const LINE_WIDTH = 42;
const BOLD_ON = "\x1B\x45\x01";
const BOLD_OFF = "\x1B\x45\x00";
const ALIGN_CENTER = "\x1B\x61\x01";
const ALIGN_LEFT = "\x1B\x61\x00";

function formatLine(label: string, value: string) {
  const space = LINE_WIDTH - label.length - value.length;
  return label + " ".repeat(Math.max(1, space)) + value;
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("es-AR")}`;
}

function formatBurgerDetails(burger: BurgerCustomization): string {
  let details = "";

  if (burger.meatCount !== 2) {
    details += `    ${burger.meatCount} ${burger.meatCount === 1 ? "carne" : "carnes"}\n`;
  }

  if (burger.friesQuantity === 0) {
    details += `    Sin papas\n`;
  } else if (burger.friesQuantity === 1) {
    details += `    1 Porción de papas\n`;
  } else {
    details += `    ${burger.friesQuantity} porciones de papas\n`;
  }

  if (burger.removedIngredients.length > 0) {
    details += `    Sin: ${burger.removedIngredients.join(", ")}\n`;
  }

  if (burger.extras.length > 0) {
    burger.extras.forEach((extra) => {
      details += `    + ${extra.quantity}x ${extra.name}\n`;
    });
  }

  return details;
}

function formatComboItem(item: OrderItemWithExtras): string {
  let text = "";
  const customizations = item.parsedCustomizations as
    | ComboCustomization[]
    | undefined;

  text += `${BOLD_ON}${item.quantity}x ${item.burger_name}${BOLD_OFF}\n`;
  text += `${formatCurrency(item.subtotal)}\n`;

  if (!customizations) {
    text += "\n";
    return text;
  }

  customizations.forEach((slot) => {
    if (slot.burgers.length === 0) return;
    slot.burgers.forEach((burger) => {
      text += `  ${burger.quantity}x ${burger.name}\n`;
      text += formatBurgerDetails(burger);
    });
  });

  if (item.extras.length > 0) {
    text += `\n  Extras adicionales:\n`;
    item.extras.forEach((extra) => {
      text += `    + ${extra.quantity}x ${extra.extra_name} ${formatCurrency(extra.unit_price)}\n`;
    });
  }

  text += "\n";
  return text;
}

function formatBurgerItem(item: OrderItemWithExtras): string {
  let text = "";

  text += `${BOLD_ON}${item.quantity}x ${item.burger_name}${BOLD_OFF}\n`;
  text += `${formatCurrency(item.subtotal)}\n`;

  let parsedCustom: any = null;
  if (item.customizations) {
    try {
      parsedCustom = JSON.parse(item.customizations);
    } catch {
      text += `  ${item.customizations}\n`;
    }
  }

  if (parsedCustom?.meatCount && parsedCustom.meatCount !== 2) {
    text += `  ${parsedCustom.meatCount} ${parsedCustom.meatCount === 1 ? "carne" : "carnes"}\n`;
  }

  if (parsedCustom?.friesQuantity !== undefined) {
    if (parsedCustom.friesQuantity === 0) {
      text += `  Sin papas\n`;
    } else if (parsedCustom.friesQuantity === 1) {
      text += `  1 porción de papas\n`;
    } else {
      text += `  ${parsedCustom.friesQuantity} porciones de papas\n`;
    }
  }

  if (
    parsedCustom?.removedIngredients &&
    parsedCustom.removedIngredients.length > 0
  ) {
    text += `  Sin: ${parsedCustom.removedIngredients.join(", ")}\n`;
  }

  if (item.extras.length > 0) {
    item.extras.forEach((extra) => {
      text += `  + ${extra.quantity}x ${extra.extra_name}\n`;
    });
  }

  text += "\n";
  return text;
}

// ================= RESUMEN DE PREPARACIÓN =================

interface PrepSummary {
  totalMeat: number;
  totalFries: number;
}

function calculatePrepSummary(order: OrderWithItems): PrepSummary {
  let totalMeat = 0;
  let totalFries = 0;

  order.items.forEach((item) => {
    if (item.combo_id) {
      let customizations:
        | ComboCustomization[]
        | BurgerCustomization[]
        | undefined = item.parsedCustomizations;

      if (!customizations && item.customizations) {
        try {
          customizations = JSON.parse(item.customizations);
        } catch {
          customizations = undefined;
        }
      }

      if (customizations) {
        customizations.forEach((slot: any) => {
          if (slot.burgers) {
            slot.burgers.forEach((burger: any) => {
              totalMeat += burger.meatCount * burger.quantity;

              if (burger.friesQuantity !== undefined) {
                totalFries += burger.friesQuantity * burger.quantity;
              }
            });
          }
        });
      }
    } else {
      let parsedCustom: any = null;

      if (item.customizations) {
        try {
          parsedCustom = JSON.parse(item.customizations);
        } catch {}
      }

      const meatCount = parsedCustom?.meatCount ?? 2;
      const friesQuantity = parsedCustom?.friesQuantity ?? 1;

      totalMeat += meatCount * item.quantity;
      totalFries += friesQuantity * item.quantity;
    }
  });

  return { totalMeat, totalFries };
}

function formatPrepSummary(order: OrderWithItems): string {
  const { totalMeat, totalFries } = calculatePrepSummary(order);
  const thinLine = "-".repeat(LINE_WIDTH);
  let text = "";

  text += `${thinLine}\n`;
  text += `${BOLD_ON}RESUMEN PREPARACIÓN${BOLD_OFF}\n`;
  text += formatLine("Medallones:", `${totalMeat}`) + "\n";
  text +=
    formatLine("Papas:", `${totalFries === 0 ? "Sin papas" : totalFries}`) +
    "\n";

  return text;
}

// ================= FORMATO PRINCIPAL =================

export function formatOrder(order: OrderWithItems): string {
  let text = "";
  const line = "=".repeat(LINE_WIDTH);
  const thinLine = "-".repeat(LINE_WIDTH);
  const deliveryText = translateDeliveryType(order.delivery_type) ?? "";
  const paymentText = translatePaymentMethod(order.payment_method);
  const deliveryHeader = order.delivery_time
    ? `${deliveryText.toUpperCase()} | ${order.delivery_time}`
    : deliveryText.toUpperCase();

  // Header
  text += "\n";
  text += `${ALIGN_CENTER}${BOLD_ON}${deliveryHeader}${BOLD_OFF}${ALIGN_LEFT}\n`;
  text += "\n";
  text += `${ALIGN_CENTER}${BOLD_ON}JEBBS BURGERS${BOLD_OFF}${ALIGN_LEFT}\n`;
  text += `${line}\n`;
  text += `${BOLD_ON}PEDIDO #${order.order_number}${BOLD_OFF}\n`;
  text += `${new Date(order.created_at).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}\n`;
  text += `${line}\n\n`;

  // Cliente
  text += `${BOLD_ON}CLIENTE${BOLD_OFF}\n`;
  text += `${order.customer_name}\n`;

  if (order.customerAddress) {
    text += `${order.customerAddress.label}: ${order.customerAddress.address}\n`;
    if (order.customerAddress.notes) {
      text += `Nota: ${order.customerAddress.notes}\n`;
    }
  }

  text += `\n${thinLine}\n\n`;

  // Items
  text += `${BOLD_ON}DETALLE DEL PEDIDO${BOLD_OFF}\n\n`;

  order.items.forEach((item) => {
    if (item.combo_id) {
      text += formatComboItem(item);
    } else {
      text += formatBurgerItem(item);
    }
  });

  // Resumen de preparación (medallones + papas)
  text += formatPrepSummary(order);

  text += `\n${thinLine}\n\n`;

  // Totals
  const subtotalBeforeDiscount =
    order.total_amount + order.discount_amount - order.delivery_fee;

  if (order.discount_amount > 0) {
    text +=
      formatLine("Subtotal", formatCurrency(subtotalBeforeDiscount)) + "\n";

    const discountLabel =
      order.discount_type === "percentage"
        ? `Descuento (${order.discount_value}%)`
        : "Descuento";

    text +=
      formatLine(discountLabel, `-${formatCurrency(order.discount_amount)}`) +
      "\n";
  }

  if (order.delivery_fee > 0) {
    text += formatLine("Envío", formatCurrency(order.delivery_fee)) + "\n";
  }

  text += `${thinLine}\n`;
  text += `${BOLD_ON}${formatLine("TOTAL", formatCurrency(order.total_amount))}${BOLD_OFF}\n`;
  text += `${line}\n\n`;

  // Delivery & Payment
  text += `${BOLD_ON}ENTREGA${BOLD_OFF}\n`;
  text += `${deliveryText}\n\n`;

  text += `${BOLD_ON}PAGO${BOLD_OFF}\n`;
  text += `${paymentText}\n`;

  if (order.notes) {
    text += `\n${thinLine}\n`;
    text += `${BOLD_ON}NOTAS${BOLD_OFF}\n`;
    text += `${order.notes}\n`;
  }

  text += `\n${ALIGN_CENTER}Gracias por su compra${ALIGN_LEFT}\n`;
  text += "\n\n\n";

  return text;
}
